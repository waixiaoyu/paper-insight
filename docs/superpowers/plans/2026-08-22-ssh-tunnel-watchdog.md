# SSH Tunnel Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a repository-managed local SSH tunnel watchdog that restores `localhost:3001` access to the remote paper-insight service after the SSH tunnel fails.

**Architecture:** `scripts/tunnel-watchdog.mjs` owns one SSH child process, periodically requests the local health endpoint, and restarts only the child process it created after a failure. `scripts/install-tunnel-watchdog.ps1` writes per-machine configuration under `.cache`, registers a Windows logon task, and never receives or persists an SSH password.

**Tech Stack:** Node.js 20+ standard library (`child_process`, `fs`, `http`, `path`, `process`), Windows PowerShell, Windows Task Scheduler, OpenSSH.

**Spec:** `docs/superpowers/specs/2026-08-22-ssh-tunnel-watchdog-design.md`

## Global Constraints

- Do not store passwords, private keys, remote tasks, reports, or Trace data in Git.
- Use key-based SSH authentication only, with `BatchMode=yes` and `ExitOnForwardFailure=yes`.
- Bind the local tunnel only to `127.0.0.1`; do not open remote port 3000 publicly.
- The watchdog may terminate only its own recorded SSH child process; it must not search for or kill other SSH processes.
- Keep the Node watchdog portable; Windows Task Scheduler integration is the only platform-specific part in this change.
- Use Node's built-in test runner; introduce no production dependency.
- Keep runtime state and logs in `.cache/tunnel-watchdog/`, which is already ignored by Git.

---

### Task 1: Implement and test the portable watchdog core

**Files:**
- Create: `scripts/tunnel-watchdog.mjs`
- Create: `test/tunnel-watchdog.test.js`

**Interfaces:**
- Produces `normalizeWatchdogConfig(value)`, `TunnelWatchdog`, and `runWatchdogFromCli(argv, dependencies)` from `scripts/tunnel-watchdog.mjs`.
- `normalizeWatchdogConfig` accepts `{ host, user, identity, localPort?, remotePort?, intervalMs?, sshPath?, stateDirectory? }` and returns a frozen validated object with defaults `3001`, `3000`, and `10000`.
- `TunnelWatchdog` accepts `{ config, spawnSsh, requestHealth, setTimer, clearTimer, wait, now, logger, writeState, removeState }` and exposes `start()`, `checkOnce()`, and `stop(reason)`.
- `start()` creates at most one SSH child, schedules health checks, and persists `{ pid, childPid, startedAt, lastHealthyAt, reconnectAttempt }`.
- `checkOnce()` keeps a healthy child unchanged; otherwise it stops its own child, waits using `2_000`, `5_000`, `10_000`, then `30_000` milliseconds, and starts one replacement.

- [ ] **Step 1: Write failing configuration and healthy-cycle tests**

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeWatchdogConfig, TunnelWatchdog } from "../scripts/tunnel-watchdog.mjs";

test("watchdog uses loopback defaults and starts one SSH child for a healthy tunnel", async () => {
  const spawned = [];
  const watchdog = new TunnelWatchdog({
    config: normalizeWatchdogConfig({ host: "38.47.255.50", user: "guguji", identity: "C:/keys/paper" }),
    spawnSsh: (command, args) => {
      spawned.push({ command, args });
      return { pid: 41, once() {}, kill() {} };
    },
    requestHealth: async () => ({ statusCode: 200 }),
    setTimer: () => 1,
    clearTimer() {},
    wait: async () => {},
    now: () => "2026-08-22T00:00:00.000Z",
    logger: { info() {}, error() {} },
    writeState: async () => {},
    removeState: async () => {}
  });

  await watchdog.start();
  await watchdog.checkOnce();
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].args.slice(-4), ["-N", "-L", "127.0.0.1:3001:127.0.0.1:3000", "guguji@38.47.255.50"]);
  assert.equal(watchdog.config.localPort, 3001);
});

test("watchdog rejects a missing identity file path before it starts SSH", () => {
  assert.throws(
    () => normalizeWatchdogConfig({ host: "host", user: "user", identity: "" }),
    /identity/i
  );
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/tunnel-watchdog.test.js`

Expected: FAIL because `scripts/tunnel-watchdog.mjs` does not export the watchdog interface.

- [ ] **Step 3: Add the minimal configuration and healthy tunnel implementation**

```js
export const normalizeWatchdogConfig = (value = {}) => {
  const required = ["host", "user", "identity"];
  for (const key of required) {
    if (!String(value[key] || "").trim()) throw new TypeError(`Tunnel watchdog ${key} is required.`);
  }
  return Object.freeze({
    host: String(value.host).trim(), user: String(value.user).trim(), identity: String(value.identity).trim(),
    localPort: Number(value.localPort || 3001), remotePort: Number(value.remotePort || 3000),
    intervalMs: Number(value.intervalMs || 10000), sshPath: String(value.sshPath || "ssh")
  });
};

export class TunnelWatchdog {
  async start() { this.child = this.spawnSsh(this.config.sshPath, this.sshArgs()); }
  async checkOnce() { await this.requestHealth(); }
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test test/tunnel-watchdog.test.js`

Expected: PASS for both configuration and healthy-cycle cases.

- [ ] **Step 5: Write the failing reconnect, ownership, and CLI tests**

```js
test("failed health check replaces only the watchdog SSH child after the first backoff", async () => {
  const createWatchdogForTest = (overrides = {}) => new TunnelWatchdog({
    config: normalizeWatchdogConfig({ host: "host", user: "user", identity: "C:/keys/paper" }),
    spawnSsh: () => ({ pid: 1, once() {}, kill() {} }), requestHealth: async () => ({ statusCode: 200 }),
    setTimer: () => 1, clearTimer() {}, wait: async () => {}, now: () => "2026-08-22T00:00:00.000Z",
    logger: { info() {}, error() {} }, writeState: async () => {}, removeState: async () => {}, ...overrides
  });
  const children = [{ pid: 51, once() {}, killCalled: 0, kill() { this.killCalled += 1; } }, { pid: 52, once() {}, kill() {} }];
  const waits = [];
  let requestCount = 0;
  const watchdog = createWatchdogForTest({
    spawnSsh: () => children.shift(),
    requestHealth: async () => {
      requestCount += 1;
      if (requestCount === 1) throw new Error("connection refused");
      return { statusCode: 200 };
    },
    wait: async (milliseconds) => waits.push(milliseconds)
  });

  await watchdog.start();
  await watchdog.checkOnce();
  assert.equal(waits[0], 2000);
  assert.equal(watchdog.child.pid, 52);
});

test("stop terminates the owned child and does not invoke process-wide SSH cleanup", async () => {
  const createWatchdogForTest = (overrides = {}) => new TunnelWatchdog({
    config: normalizeWatchdogConfig({ host: "host", user: "user", identity: "C:/keys/paper" }),
    spawnSsh: () => ({ pid: 1, once() {}, kill() {} }), requestHealth: async () => ({ statusCode: 200 }),
    setTimer: () => 1, clearTimer() {}, wait: async () => {}, now: () => "2026-08-22T00:00:00.000Z",
    logger: { info() {}, error() {} }, writeState: async () => {}, removeState: async () => {}, ...overrides
  });
  const child = { pid: 61, once() {}, killCalled: 0, kill() { this.killCalled += 1; } };
  const watchdog = createWatchdogForTest({ spawnSsh: () => child });
  await watchdog.start();
  await watchdog.stop("test");
  assert.equal(child.killCalled, 1);
});
```

- [ ] **Step 6: Run the focused test to verify it fails**

Run: `node --test test/tunnel-watchdog.test.js`

Expected: FAIL because reconnect, backoff, state ownership, and CLI configuration loading are not implemented.

- [ ] **Step 7: Implement SSH arguments, restart loop, state, logging, and CLI**

```js
sshArgs() {
  return [
    "-i", this.config.identity, "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
    "-N", "-L", `127.0.0.1:${this.config.localPort}:127.0.0.1:${this.config.remotePort}`,
    `${this.config.user}@${this.config.host}`
  ];
}

async restart(reason) {
  await this.stopChild(reason);
  await this.wait([2000, 5000, 10000, 30000][Math.min(this.reconnectAttempt++, 3)]);
  this.child = this.spawnSsh(this.config.sshPath, this.sshArgs());
  await this.writeState(this.state());
}
```

Implement `runWatchdogFromCli` so `node scripts/tunnel-watchdog.mjs --config <absolute-path>` reads the JSON configuration, injects real standard-library dependencies, logs only status and errors, and handles `SIGINT`/`SIGTERM` by calling `stop`.

- [ ] **Step 8: Run the core test suite and syntax check**

Run: `node --check scripts/tunnel-watchdog.mjs && node --test test/tunnel-watchdog.test.js`

Expected: syntax check succeeds; all watchdog tests pass.

- [ ] **Step 9: Commit the portable watchdog core**

```bash
git add scripts/tunnel-watchdog.mjs test/tunnel-watchdog.test.js
git commit -m "feat: add ssh tunnel watchdog core"
```

### Task 2: Implement and test the Windows installer

**Files:**
- Create: `scripts/install-tunnel-watchdog.ps1`
- Create: `test/tunnel-watchdog-installer.test.js`

**Interfaces:**
- Consumes `scripts/tunnel-watchdog.mjs` and writes `.cache/tunnel-watchdog/config.json` in the selected repository.
- Produces the scheduled task name `PaperInsightTunnelWatchdog` and supports `-Install`, `-Uninstall`, and `-Status`.
- `-Install` accepts `-RepositoryPath`, `-Host`, `-User`, `-IdentityPath`, optional `-SshPath`, `-LocalPort`, `-RemotePort`, and `-IntervalMs`.
- `-Uninstall` removes only `PaperInsightTunnelWatchdog` and `.cache/tunnel-watchdog/state.json`; it must not remove configuration, logs, identity files, or repository files.

- [ ] **Step 1: Write failing static installer contract tests**

```js
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

test("Windows installer creates a current-user logon task without password arguments", async () => {
  const source = await readFile(new URL("../scripts/install-tunnel-watchdog.ps1", import.meta.url), "utf8");
  assert.match(source, /PaperInsightTunnelWatchdog/);
  assert.match(source, /Register-ScheduledTask/);
  assert.match(source, /AtLogOn/);
  assert.doesNotMatch(source, /password|SSH_ASKPASS|Tv92/i);
});

test("Windows uninstall removes only the watchdog task and state file", async () => {
  const source = await readFile(new URL("../scripts/install-tunnel-watchdog.ps1", import.meta.url), "utf8");
  assert.match(source, /Unregister-ScheduledTask/);
  assert.match(source, /state\.json/);
  assert.doesNotMatch(source, /Remove-Item.+config\.json/i);
});
```

- [ ] **Step 2: Run the installer tests to verify they fail**

Run: `node --test test/tunnel-watchdog-installer.test.js`

Expected: FAIL because the installer script is absent.

- [ ] **Step 3: Implement the installer with per-machine configuration**

```powershell
[CmdletBinding(DefaultParameterSetName = "Status")]
param(
  [Parameter(ParameterSetName = "Install", Mandatory = $true)][switch]$Install,
  [Parameter(ParameterSetName = "Uninstall", Mandatory = $true)][switch]$Uninstall,
  [Parameter(ParameterSetName = "Status", Mandatory = $true)][switch]$Status,
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..")),
  [string]$Host, [string]$User, [string]$IdentityPath, [string]$SshPath = "ssh",
  [int]$LocalPort = 3001, [int]$RemotePort = 3000, [int]$IntervalMs = 10000
)

$taskName = "PaperInsightTunnelWatchdog"
$stateDirectory = Join-Path $RepositoryPath ".cache\\tunnel-watchdog"
$configPath = Join-Path $stateDirectory "config.json"
```

For `-Install`, validate paths, create the state directory, write a UTF-8 JSON config, then register a `New-ScheduledTaskAction` that executes `node.exe` with `scripts/tunnel-watchdog.mjs --config <configPath>`. Use `New-ScheduledTaskTrigger -AtLogOn` and `Register-ScheduledTask -User "$env:USERDOMAIN\\$env:USERNAME" -RunLevel Limited`; no password parameter is used. For `-Status`, print task state and parsed state JSON. For `-Uninstall`, unregister only the named task if it exists and remove only `state.json`.

- [ ] **Step 4: Run the installer tests to verify they pass**

Run: `node --test test/tunnel-watchdog-installer.test.js`

Expected: PASS; the script names the logon task, uses no password value, and limits uninstall scope.

- [ ] **Step 5: Parse the installer in PowerShell**

Run: `powershell -NoProfile -Command "[void][scriptblock]::Create((Get-Content -Raw scripts/install-tunnel-watchdog.ps1))"`

Expected: exit code 0 with no parser errors.

- [ ] **Step 6: Commit the Windows installer**

```bash
git add scripts/install-tunnel-watchdog.ps1 test/tunnel-watchdog-installer.test.js
git commit -m "feat: add Windows tunnel watchdog installer"
```

### Task 3: Document operation and run full regression

**Files:**
- Modify: `README.md:317-327`
- Modify: `package.json:7-12`

**Interfaces:**
- Adds `npm run tunnel:watchdog -- --config <path>` as the manual foreground command.
- Documents the Windows installation command and the local only configuration location.

- [ ] **Step 1: Write a failing README and package-script contract test**

```js
test("repository documents a key-only watchdog install and exposes the foreground command", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(readme, /install-tunnel-watchdog\.ps1/);
  assert.match(readme, /config\.json/);
  assert.equal(packageJson.scripts["tunnel:watchdog"], "node scripts/tunnel-watchdog.mjs");
});
```

- [ ] **Step 2: Run the documentation test to verify it fails**

Run: `node --test test/tunnel-watchdog-installer.test.js`

Expected: FAIL because neither the npm script nor installation instructions are present.

- [ ] **Step 3: Add the foreground command and README instructions**

```json
{
  "scripts": {
    "tunnel:watchdog": "node scripts/tunnel-watchdog.mjs"
  }
}
```

Document these commands, substituting values for each machine and retaining the private key outside version control:

```powershell
.\scripts\install-tunnel-watchdog.ps1 -Install -RepositoryPath C:\work\code\paper-insight -Host <server> -User <user> -IdentityPath C:\keys\paper_insight_ed25519
.\scripts\install-tunnel-watchdog.ps1 -Status -RepositoryPath C:\work\code\paper-insight
.\scripts\install-tunnel-watchdog.ps1 -Uninstall -RepositoryPath C:\work\code\paper-insight
```

- [ ] **Step 4: Run watchdog tests, project regression, and diff checks**

Run: `node --test test/tunnel-watchdog.test.js test/tunnel-watchdog-installer.test.js && npm test && git diff --check`

Expected: all watchdog tests and project tests pass; no whitespace errors.

- [ ] **Step 5: Commit documentation and package command**

```bash
git add README.md package.json test/tunnel-watchdog-installer.test.js
git commit -m "docs: document tunnel watchdog setup"
```

## Plan Self-Review

- Spec coverage: Task 1 covers key-only SSH configuration, ownership, health checking, reconnect backoff, state, logs, and shutdown. Task 2 covers Windows login persistence and bounded uninstall. Task 3 covers portable repository setup and verification. Remote service mutation, public port exposure, password persistence, and Linux/macOS installers remain explicitly out of scope.
- Completeness scan: no deferred implementation markers are present; each implementation and test step names concrete files, interfaces, assertions, and commands.
- Type consistency: all later tasks consume the Task 1 CLI command (`node scripts/tunnel-watchdog.mjs --config <path>`) and its JSON configuration path; the scheduled task and npm script invoke the same entry point.
