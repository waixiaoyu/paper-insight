import { spawn } from "node:child_process";
import { access, appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BACKOFF = [2000, 5000, 10000, 30000];
export const writeWatchdogState = async (path, state, {
  renameFile = rename, wait = (ms) => new Promise((done) => setTimeout(done, ms))
} = {}) => {
  await writeFile(`${path}.tmp`, JSON.stringify(state, null, 2));
  for (let attempt = 0; ; attempt++) {
    try { await renameFile(`${path}.tmp`, path); return; } catch (error) {
      // Windows readers may briefly hold state.json without FILE_SHARE_DELETE.
      if (!["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 4) throw error;
      await wait(50 * (attempt + 1));
    }
  }
};
export const normalizeLocalServerWatchdogConfig = (value = {}) => {
  if (!String(value.repositoryPath || "").trim()) throw new TypeError("本地守护配置缺少 repositoryPath。");
  const integer = (name, fallback, min, max) => {
    const number = Number(value[name] ?? fallback);
    if (!Number.isInteger(number) || number < min || number > max) throw new TypeError(`本地守护配置 ${name} 应在 ${min}–${max} 之间。`);
    return number;
  };
  const repositoryPath = resolve(value.repositoryPath);
  return Object.freeze({ repositoryPath, nodePath: value.nodePath || process.execPath,
    port: integer("port", 3100, 1, 65535), intervalMs: integer("intervalMs", 10000, 1000, 300000),
    startupGraceMs: integer("startupGraceMs", 5000, 0, 300000),
    stateDirectory: resolve(value.stateDirectory || join(repositoryPath, ".cache", "local-server-watchdog")) });
};

export class LocalServerWatchdog {
  constructor(dependencies) {
    Object.assign(this, dependencies);
    this.config = normalizeLocalServerWatchdogConfig(dependencies.config);
    this.child = null; this.running = false; this.recovery = null; this.timer = null;
    this.startedAt = 0; this.childStartedAt = 0; this.lastHealthyAt = 0;
    this.restartAttempt = 0; this.lastError = ""; this.status = "stopped";
  }
  state() {
    const iso = (time) => time ? new Date(time).toISOString() : "";
    return { pid: this.processId || process.pid, childPid: this.child?.pid || 0,
      startedAt: iso(this.startedAt), childStartedAt: iso(this.childStartedAt),
      lastHealthyAt: iso(this.lastHealthyAt), restartAttempt: this.restartAttempt,
      lastError: this.lastError, status: this.status };
  }
  async persist() { await this.writeState(this.state()); }
  async startChild() {
    try {
      const child = this.spawnServer(this.config.nodePath, ["scripts/local-server-child.mjs"], {
        cwd: this.config.repositoryPath, env: { ...process.env, PORT: String(this.config.port), HOST: "127.0.0.1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true
      });
      this.child = child;
      this.childStartedAt = this.now(); this.lastHealthyAt = 0; this.status = "starting";
      const failed = (reason) => {
        if (!this.running || this.child !== child || child.stopping) return;
        this.lastError = reason;
        this.recover(reason).catch((error) => this.log("error", error.message));
      };
      child.once("exit", (code, signal) => {
        child.exited = true;
        failed(`后端进程退出：exitCode=${code}，signal=${signal || "无"}`);
      });
      child.once("error", (error) => { child.exited = true; failed(`后端启动失败：${error.code || error.message}`); });
      await this.log("info", `启动后端 PID=${child.pid || 0}，端口=${this.config.port}`);
    } catch (error) {
      this.child = null; this.status = "recovering"; this.lastError = `后端启动失败：${error.message}`;
      await this.log("error", this.lastError);
    }
    await this.persist();
  }
  schedule() {
    if (!this.running) return;
    this.timer = this.setTimer(async () => {
      try { await this.checkOnce(); } catch (error) { await this.log("error", error.message); }
      finally { this.schedule(); }
    }, this.config.intervalMs);
  }
  async start() {
    if (this.running) return;
    this.running = true; this.startedAt = this.now();
    await this.startChild(); this.schedule();
  }
  async stopChild() {
    const child = this.child;
    if (!child) return;
    if (!child.exited) {
      child.stopping = true;
      // Await this exact child's exit before opening the same data files in a replacement server.
      await new Promise((resolveExit, reject) => {
        const timeout = setTimeout(() => reject(new Error("后端未确认退出，暂不启动第二个进程。")), 5000);
        child.once("exit", () => { clearTimeout(timeout); resolveExit(); });
        child.once("error", () => { clearTimeout(timeout); resolveExit(); });
        try { child.kill(); } catch (error) { clearTimeout(timeout); reject(error); }
      });
    }
    if (this.child === child) this.child = null;
  }
  recover(reason) {
    if (!this.running) return Promise.resolve();
    if (this.recovery) return this.recovery;
    this.recovery = Promise.resolve().then(async () => {
      this.status = "recovering"; this.lastError = reason;
      await this.stopChild();
      const delay = BACKOFF[Math.min(this.restartAttempt++, BACKOFF.length - 1)];
      await this.persist(); await this.log("error", `${reason}；${delay / 1000} 秒后重新启动。`);
      await this.wait(delay);
      if (this.running) await this.startChild();
    }).finally(() => { this.recovery = null; });
    return this.recovery;
  }
  async checkOnce() {
    if (!this.running) return;
    if (await this.shouldStop?.()) {
      await this.stop("external_request");
      return;
    }
    if (this.recovery) return this.recovery;
    if (!this.child || this.child.exited) return this.recover(this.lastError || "后端进程不存在");
    if (this.now() - this.childStartedAt < this.config.startupGraceMs) return;
    const checkedChild = this.child;
    try {
      await this.requestHealth();
      if (!this.running || this.child !== checkedChild || this.recovery) return;
      this.status = "healthy"; this.lastHealthyAt = this.now(); this.restartAttempt = 0; this.lastError = "";
      await this.persist();
    } catch (error) {
      if (this.running && this.child === checkedChild) await this.recover(`本地后端连接失败：${error.code || error.message}`);
    }
  }
  async stop(reason = "stopped") {
    this.running = false;
    if (this.timer) this.clearTimer(this.timer);
    await this.stopChild();
    if (this.recovery) await this.recovery;
    this.status = "stopped"; await this.log("info", `守护停止：${reason}`);
    await this.removeState();
    await this.afterStop?.();
  }
}

const health = (port) => new Promise((resolveHealth, reject) => {
  const request = http.get({ host: "127.0.0.1", port, path: "/api/reading-list/jobs/active" }, (response) => {
    response.resume(); resolveHealth({ statusCode: response.statusCode });
  });
  const timeout = setTimeout(() => request.destroy(new Error("HTTP 健康检查超过 5 秒")), 5000);
  request.once("close", () => clearTimeout(timeout)); request.once("error", reject);
});

// Serialized, bounded logs: no interleaved rotation or unbounded output queues.
const rotatedLog = (path) => {
  let pending = Promise.resolve();
  return (message) => {
    pending = pending.then(async () => {
      if ((await stat(path).catch(() => null))?.size >= 2 * 1024 * 1024) {
        await rm(`${path}.1`, { force: true }); await rename(path, `${path}.1`);
      }
      const text = String(message).replace(/(authorization|api[-_]?key|password)(\s*[=:]\s*)[^\s,]+/gi, "$1$2[REDACTED]");
      await appendFile(path, text.slice(0, 65536), "utf8");
    }).catch(() => {});
    return pending;
  };
};

export const runLocalServerWatchdogFromCli = async (argv = process.argv.slice(2)) => {
  const index = argv.indexOf("--config");
  if (index < 0 || !argv[index + 1]) throw new Error("需要 --config <配置文件路径>。");
  const config = normalizeLocalServerWatchdogConfig(JSON.parse((await readFile(resolve(argv[index + 1]), "utf8")).replace(/^\uFEFF/, "")));
  const lockPath = join(config.stateDirectory, "watchdog.lock");
  const stopRequestPath = join(config.stateDirectory, "stop.request");
  if (argv.includes("--stop")) {
    await mkdir(config.stateDirectory, { recursive: true });
    try { await access(lockPath); } catch { return null; }
    const ownerPid = Number(await readFile(lockPath, "utf8").catch(() => ""));
    if (!Number.isInteger(ownerPid) || ownerPid < 1) {
      await rm(lockPath, { force: true });
      return null;
    }
    try { process.kill(ownerPid, 0); } catch (error) {
      if (error.code !== "ESRCH") throw error;
      await rm(lockPath, { force: true });
      await rm(stopRequestPath, { force: true });
      return null;
    }
    await writeFile(stopRequestPath, new Date().toISOString() + "\n", "utf8");
    for (let attempt = 0; attempt < 160; attempt++) {
      await new Promise((done) => setTimeout(done, 100));
      try { await access(lockPath); } catch { return null; }
    }
    throw new Error("旧守护器在 16 秒内未停止，保留现有计划任务和进程。");
  }
  await access(join(config.repositoryPath, "server.js"));
  await access(join(config.repositoryPath, "scripts", "local-server-child.mjs"));
  await access(config.nodePath); await mkdir(config.stateDirectory, { recursive: true });
  const acquire = async () => {
    try { return await open(lockPath, "wx"); } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(await readFile(lockPath, "utf8"));
      if (!Number.isInteger(pid) || pid < 1) throw new Error("守护锁文件无效，请先检查已有守护进程。");
      try { process.kill(pid, 0); } catch (probeError) {
        if (probeError.code !== "ESRCH") throw probeError;
        await rm(lockPath); return open(lockPath, "wx");
      }
      throw new Error("本地服务守护已经运行，未启动第二个实例。");
    }
  };
  const lock = await acquire(); await lock.writeFile(String(process.pid)); await lock.close();
  await rm(stopRequestPath, { force: true });
  const eventLog = rotatedLog(join(config.stateDirectory, "local-server-watchdog.log"));
  const log = (level, message) => eventLog(`${new Date().toISOString()} ${level} ${message}\n`);
  const output = [rotatedLog(join(config.stateDirectory, "server.stdout.log")), rotatedLog(join(config.stateDirectory, "server.stderr.log"))];
  let stateQueue = Promise.resolve();
  const watchdog = new LocalServerWatchdog({ config, log, now: Date.now, setTimer: setTimeout, clearTimer: clearTimeout,
    wait: (delay) => new Promise((done) => setTimeout(done, delay)), requestHealth: () => health(config.port),
    shouldStop: async () => {
      try { await access(stopRequestPath); return true; } catch { return false; }
    },
    afterStop: async () => {
      await rm(stopRequestPath, { force: true });
      await rm(lockPath, { force: true });
    },
    spawnServer: (command, args, options) => {
      const child = spawn(command, args, options);
      [child.stdout, child.stderr].forEach((stream, index) => {
        stream?.setEncoding("utf8");
        stream?.on("data", (chunk) => { stream.pause(); output[index](chunk).finally(() => stream.resume()); });
      });
      return child;
    },
    writeState: (state) => {
      stateQueue = stateQueue.catch(() => {}).then(async () => {
        const statePath = join(config.stateDirectory, "state.json");
        await writeWatchdogState(statePath, state);
      }); return stateQueue;
    },
    removeState: async () => { await stateQueue.catch(() => {}); await rm(join(config.stateDirectory, "state.json"), { force: true }); }
  });
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return; stopping = true;
    await watchdog.stop(signal);
  };
  process.once("SIGINT", () => { stop("SIGINT").catch(() => { process.exitCode = 1; }); });
  process.once("SIGTERM", () => { stop("SIGTERM").catch(() => { process.exitCode = 1; }); });
  await watchdog.start(); return watchdog;
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runLocalServerWatchdogFromCli().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
