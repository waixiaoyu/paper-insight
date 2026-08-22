import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeWatchdogConfig,
  TunnelWatchdog
} from "../scripts/tunnel-watchdog.mjs";

const createChild = (pid) => {
  const listeners = new Map();
  return {
    pid,
    killed: 0,
    once(event, listener) {
      listeners.set(event, listener);
    },
    kill() {
      this.killed += 1;
    },
    emit(event) {
      listeners.get(event)?.();
    }
  };
};

const createWatchdog = (overrides = {}) => {
  const writes = [];
  const timers = [];
  const base = {
    config: normalizeWatchdogConfig({
      host: "38.47.255.50",
      user: "guguji",
      identity: "C:/keys/paper_insight_ed25519"
    }),
    spawnSsh: () => createChild(1),
    requestHealth: async () => ({ statusCode: 200 }),
    setTimer: (callback, milliseconds) => {
      timers.push({ callback, milliseconds });
      return timers.length;
    },
    clearTimer() {},
    wait: async () => {},
    now: () => "2026-08-22T00:00:00.000Z",
    logger: { info() {}, error() {} },
    writeState: async (state) => writes.push(state),
    removeState: async () => {},
    processId: 9001
  };
  return {
    watchdog: new TunnelWatchdog({ ...base, ...overrides }),
    writes,
    timers
  };
};

test("watchdog creates one loopback SSH tunnel and keeps it when the health check succeeds", async () => {
  const spawned = [];
  const { watchdog, writes, timers } = createWatchdog({
    spawnSsh: (command, args) => {
      spawned.push({ command, args });
      return createChild(41);
    }
  });

  await watchdog.start();
  await watchdog.checkOnce();

  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, "ssh");
  assert.deepEqual(spawned[0].args.slice(-4), [
    "-N",
    "-L",
    "127.0.0.1:3001:127.0.0.1:3000",
    "guguji@38.47.255.50"
  ]);
  assert.equal(timers[0].milliseconds, 10000);
  assert.equal(writes.at(-1).lastHealthyAt, "2026-08-22T00:00:00.000Z");
});

test("watchdog rejects missing key configuration before starting SSH", () => {
  assert.throws(
    () => normalizeWatchdogConfig({ host: "host", user: "user", identity: "" }),
    /identity/i
  );
});

test("failed health check stops the owned child and reconnects after the first backoff", async () => {
  const first = createChild(51);
  const second = createChild(52);
  const children = [first, second];
  const waits = [];
  let healthCalls = 0;
  const { watchdog, writes } = createWatchdog({
    spawnSsh: () => children.shift(),
    requestHealth: async () => {
      healthCalls += 1;
      if (healthCalls === 1) throw new Error("connection refused");
      return { statusCode: 200 };
    },
    wait: async (milliseconds) => waits.push(milliseconds)
  });

  await watchdog.start();
  await watchdog.checkOnce();

  assert.equal(first.killed, 1);
  assert.equal(waits[0], 2000);
  assert.equal(watchdog.child.pid, 52);
  assert.equal(writes.at(-1).reconnectAttempt, 1);
});

test("an exited SSH child is replaced and stop never targets another process", async () => {
  const first = createChild(61);
  const second = createChild(62);
  const children = [first, second];
  const waits = [];
  let removed = 0;
  const { watchdog } = createWatchdog({
    spawnSsh: () => children.shift(),
    wait: async (milliseconds) => waits.push(milliseconds),
    removeState: async () => { removed += 1; }
  });

  await watchdog.start();
  first.emit("exit");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(waits[0], 2000);
  assert.equal(watchdog.child.pid, 62);
  await watchdog.stop("test");
  assert.equal(second.killed, 1);
  assert.equal(first.killed, 0);
  assert.equal(removed, 1);
});
