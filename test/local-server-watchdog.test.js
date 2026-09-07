import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { LocalServerWatchdog, normalizeLocalServerWatchdogConfig, writeWatchdogState } from "../scripts/local-server-watchdog.mjs";
import { mkdtemp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("state replacement retries Windows sharing violations and preserves previous state on permanent failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "watchdog-state-"));
  const path = join(dir, "state.json");
  try {
    await writeFile(path, '{"status":"previous"}');
    let calls = 0;
    const waits = [];
    await writeWatchdogState(path, { status: "healthy" }, { wait: async (ms) => waits.push(ms), renameFile: async (from, to) => {
      if (++calls === 1) throw Object.assign(new Error("file in use"), { code: "EPERM" });
      return rename(from, to);
    } });
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { status: "healthy" });
    assert.equal(waits.length, 1);
    await assert.rejects(() => writeWatchdogState(path, { status: "broken" }, {
      wait: async () => {}, renameFile: async () => { throw Object.assign(new Error("busy"), { code: "EPERM" }); }
    }), /busy/);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { status: "healthy" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const createWatchdog = (overrides = {}) => {
  const children = [], waits = [], states = [], timers = [];
  const deps = {
    config: { repositoryPath: process.cwd(), startupGraceMs: 0 },
    spawnServer: (command, args, options) => {
      const child = new EventEmitter();
      Object.assign(child, { pid: 100 + children.length, killed: false, command, args, options,
        kill() { this.killed = true; this.emit("exit", 1, "SIGTERM"); return true; } });
      children.push(child); return child;
    },
    requestHealth: async () => ({ statusCode: 200 }),
    setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimer() {}, wait: async (delay) => waits.push(delay), now: () => Date.now(),
    writeState: async (state) => states.push(state), removeState: async () => {},
    log: async () => {}, ...overrides
  };
  return { watchdog: new LocalServerWatchdog(deps), children, waits, states, timers };
};

test("watchdog validates ports, paths, timing", () => {
  assert.equal(normalizeLocalServerWatchdogConfig({ repositoryPath: process.cwd() }).port, 3100);
  for (const config of [{}, { repositoryPath: " " }, { port: 0 }, { port: 65536 }, { intervalMs: 1 }, { startupGraceMs: -1 }]) {
    assert.throws(() => normalizeLocalServerWatchdogConfig(config.repositoryPath === undefined && Object.keys(config).length
      ? { repositoryPath: process.cwd(), ...config } : config));
  }
});
test("healthy watchdog starts once and uses loopback environment", async () => {
  const { watchdog, children, states } = createWatchdog();
  await watchdog.start(); await watchdog.start(); await watchdog.checkOnce();
  assert.equal(children.length, 1);
  assert.equal(children[0].options.env.PORT, "3100");
  assert.equal(children[0].options.env.HOST, "127.0.0.1");
  assert.equal(children[0].options.cwd, process.cwd());
  assert.equal(states.at(-1).status, "healthy");
  await watchdog.stop(); assert.equal(children[0].killed, true);
});
test("health failure replaces only owned child using capped backoff", async () => {
  let healthy = false;
  const { watchdog, children, waits } = createWatchdog({ requestHealth: async () => {
    if (!healthy) throw new Error("connection refused");
  } });
  await watchdog.start();
  for (let i = 0; i < 5; i++) await watchdog.checkOnce();
  assert.match(watchdog.state().lastError, /connection refused/);
  assert.deepEqual(waits, [2000, 5000, 10000, 30000, 30000]);
  assert.equal(children.slice(0, -1).every((child) => child.killed), true);
  healthy = true; await watchdog.checkOnce();
  assert.equal(watchdog.state().restartAttempt, 0);
  await watchdog.stop();
});
test("exit and health recovery cannot create duplicate children", async () => {
  const { watchdog, children } = createWatchdog();
  await watchdog.start();
  children[0].emit("exit", 2, null);
  await Promise.all([watchdog.checkOnce(), watchdog.recover("same failure")]);
  assert.equal(children.length, 2);
  await watchdog.stop();
});
test("stop during recovery never starts another child", async () => {
  let release;
  const { watchdog, children } = createWatchdog({ wait: () => new Promise((resolve) => { release = resolve; }) });
  await watchdog.start();
  const recovery = watchdog.recover("failure");
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  const stopped = watchdog.stop(); release(); await recovery; await stopped;
  assert.equal(children.length, 1);
});
test("failed process start remains recoverable on later health checks", async () => {
  const { watchdog, children } = createWatchdog();
  const spawn = watchdog.spawnServer;
  watchdog.spawnServer = () => { throw new Error("spawn unavailable"); };
  await watchdog.start();
  assert.equal(watchdog.state().status, "recovering");
  watchdog.spawnServer = spawn;
  await watchdog.checkOnce();
  assert.equal(children.length, 1);
  await watchdog.stop();
});
test("startup grace avoids restarting a server before it is ready", async () => {
  const { watchdog, children } = createWatchdog({ config: { repositoryPath: process.cwd(), startupGraceMs: 5000 },
    requestHealth: async () => { throw new Error("not ready"); } });
  await watchdog.start(); await watchdog.checkOnce();
  assert.equal(children.length, 1);
  await watchdog.stop();
});
