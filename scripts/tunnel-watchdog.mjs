import { spawn } from "node:child_process";
import { access, appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BACKOFF_MS = [2000, 5000, 10000, 30000];

const positiveInteger = (value, name) => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    throw new TypeError(`Tunnel watchdog ${name} must be an integer between 1 and 65535.`);
  }
  return numeric;
};

export const normalizeWatchdogConfig = (value = {}) => {
  const required = ["host", "user", "identity"];
  for (const key of required) {
    if (!String(value[key] || "").trim()) {
      throw new TypeError(`Tunnel watchdog ${key} is required.`);
    }
  }
  const intervalMs = Number(value.intervalMs ?? 10000);
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 300000) {
    throw new TypeError("Tunnel watchdog intervalMs must be an integer between 1000 and 300000.");
  }
  return Object.freeze({
    host: String(value.host).trim(),
    user: String(value.user).trim(),
    identity: String(value.identity).trim(),
    localPort: positiveInteger(value.localPort ?? 3001, "localPort"),
    remotePort: positiveInteger(value.remotePort ?? 3000, "remotePort"),
    intervalMs,
    sshPath: String(value.sshPath || "ssh").trim() || "ssh",
    stateDirectory: resolve(String(value.stateDirectory || join(process.cwd(), ".cache", "tunnel-watchdog")))
  });
};

const waitFor = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

const requestLocalHealth = ({ localPort }) => new Promise((resolveHealth, rejectHealth) => {
  const request = http.get({
    host: "127.0.0.1",
    port: localPort,
    path: "/api/reading-list/jobs/active",
    timeout: 5000
  }, (response) => {
    response.resume();
    resolveHealth({ statusCode: response.statusCode || 0 });
  });
  request.once("timeout", () => request.destroy(new Error("Local tunnel health request timed out.")));
  request.once("error", rejectHealth);
});

const createLogger = (stateDirectory) => {
  const logPath = join(stateDirectory, "tunnel-watchdog.log");
  const write = async (level, message) => {
    try {
      await mkdir(stateDirectory, { recursive: true });
      const info = await stat(logPath).catch(() => null);
      if (info?.size >= 2 * 1024 * 1024) {
        await rm(`${logPath}.1`, { force: true });
        await rename(logPath, `${logPath}.1`);
      }
      await appendFile(logPath, `${new Date().toISOString()} ${level} ${String(message)}\n`, "utf8");
    } catch {
      // Logging must not stop the tunnel recovery loop.
    }
  };
  return { info: (message) => write("INFO", message), error: (message) => write("ERROR", message) };
};

const fileDependencies = (config) => ({
  spawnSsh: (command, args) => spawn(command, args, { stdio: "ignore", windowsHide: true }),
  requestHealth: () => requestLocalHealth(config),
  setTimer: setTimeout,
  clearTimer: clearTimeout,
  wait: waitFor,
  now: () => new Date().toISOString(),
  logger: createLogger(config.stateDirectory),
  writeState: async (state) => {
    await mkdir(config.stateDirectory, { recursive: true });
    await writeFile(join(config.stateDirectory, "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  },
  removeState: async () => rm(join(config.stateDirectory, "state.json"), { force: true }),
  processId: process.pid
});

export class TunnelWatchdog {
  constructor({ config, spawnSsh, requestHealth, setTimer, clearTimer, wait, now, logger, writeState, removeState, processId } = {}) {
    this.config = normalizeWatchdogConfig(config);
    this.spawnSsh = spawnSsh;
    this.requestHealth = requestHealth;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.wait = wait;
    this.now = now;
    this.logger = logger;
    this.writeState = writeState;
    this.removeState = removeState;
    this.processId = processId || process.pid;
    this.child = null;
    this.timer = null;
    this.running = false;
    this.reconnectAttempt = 0;
    this.lastHealthyAt = "";
    this.recovery = null;
  }

  sshArgs() {
    return [
      "-i", this.config.identity,
      "-o", "BatchMode=yes",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
      "-N",
      "-L", `127.0.0.1:${this.config.localPort}:127.0.0.1:${this.config.remotePort}`,
      `${this.config.user}@${this.config.host}`
    ];
  }

  state() {
    return {
      pid: this.processId,
      childPid: this.child?.pid || 0,
      startedAt: this.startedAt || "",
      lastHealthyAt: this.lastHealthyAt,
      reconnectAttempt: this.reconnectAttempt
    };
  }

  async persistState() {
    await this.writeState?.(this.state());
  }

  scheduleCheck() {
    if (!this.running) return;
    this.timer = this.setTimer(async () => {
      await this.checkOnce();
      this.scheduleCheck();
    }, this.config.intervalMs);
  }

  async startChild(reason) {
    const child = this.spawnSsh(this.config.sshPath, this.sshArgs());
    if (!child || !Number.isInteger(child.pid) || child.pid < 1) {
      throw new Error("SSH tunnel process did not start.");
    }
    this.child = child;
    child.once?.("exit", () => {
      if (this.running && this.child === child) {
        this.child = null;
        this.recover("ssh_process_exited").catch((error) => this.logger?.error?.(error.message));
      }
    });
    child.once?.("error", (error) => {
      if (this.running && this.child === child) {
        this.recover(`ssh_process_error: ${error?.message || "unknown"}`).catch((recoveryError) => this.logger?.error?.(recoveryError.message));
      }
    });
    await this.persistState();
    this.logger?.info?.(`SSH tunnel started (${reason}).`);
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.startedAt = this.now();
    await this.startChild("startup");
    this.scheduleCheck();
  }

  async stopChild(reason) {
    const child = this.child;
    this.child = null;
    if (child?.pid && typeof child.kill === "function") {
      child.kill();
      this.logger?.info?.(`SSH tunnel stopped (${reason}).`);
    }
  }

  async recover(reason) {
    if (!this.running) return;
    if (this.recovery) return this.recovery;
    this.recovery = (async () => {
      await this.stopChild(reason);
      const delay = BACKOFF_MS[Math.min(this.reconnectAttempt, BACKOFF_MS.length - 1)];
      this.reconnectAttempt += 1;
      await this.persistState();
      this.logger?.error?.(`Tunnel recovery scheduled in ${delay}ms (${reason}).`);
      await this.wait(delay);
      if (this.running) await this.startChild("reconnect");
    })();
    try {
      await this.recovery;
    } finally {
      this.recovery = null;
    }
  }

  async checkOnce() {
    if (!this.running) return;
    if (!this.child) {
      await this.recover("ssh_process_missing");
      return;
    }
    try {
      await this.requestHealth();
      this.lastHealthyAt = this.now();
      this.reconnectAttempt = 0;
      await this.persistState();
    } catch (error) {
      await this.recover(`health_check_failed: ${error?.message || "unknown"}`);
    }
  }

  async stop(reason = "stopped") {
    this.running = false;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    await this.stopChild(reason);
    await this.removeState?.();
    this.logger?.info?.(`Tunnel watchdog stopped (${reason}).`);
  }
}

export const runWatchdogFromCli = async (argv = process.argv.slice(2), dependencies = {}) => {
  const configIndex = argv.indexOf("--config");
  const configPath = configIndex >= 0 ? String(argv[configIndex + 1] || "") : "";
  if (!configPath) throw new TypeError("Tunnel watchdog requires --config <path>.");
  const configText = (await readFile(resolve(configPath), "utf8")).replace(/^\uFEFF/u, "");
  const config = normalizeWatchdogConfig(JSON.parse(configText));
  await access(config.identity);
  const watchdog = new TunnelWatchdog({ config, ...fileDependencies(config), ...dependencies });
  await watchdog.start();
  const stop = async (signal) => {
    await watchdog.stop(signal);
    process.exitCode = 0;
  };
  process.once("SIGINT", () => { stop("SIGINT").catch(() => { process.exitCode = 1; }); });
  process.once("SIGTERM", () => { stop("SIGTERM").catch(() => { process.exitCode = 1; }); });
  return watchdog;
};

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  runWatchdogFromCli().catch((error) => {
    process.stderr.write(`Tunnel watchdog failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
