# Local Server Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the local PaperInsight backend on `127.0.0.1:3100` running independently of Codex execution sessions and automatically recover it after process or health failures.

**Architecture:** A repository-managed Node watchdog owns exactly one `server.js` child, probes the existing active-job endpoint, serializes recovery with bounded backoff, and writes local state and rotated logs. A Windows PowerShell installer registers that watchdog as a current-user, hidden, single-instance logon task and provides status and uninstall operations that never touch application data.

**Tech Stack:** Node.js 20+ standard library, Windows PowerShell ScheduledTasks module, Windows Task Scheduler, and Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-04-local-service-watchdog-json-recovery-design.md`

## Global Constraints

- Default to `127.0.0.1:3100` and health path `/api/reading-list/jobs/active`.
- The watchdog may stop only the child process object it created; never search for or kill arbitrary Node processes.
- Do not delete or migrate paper data, recommendation lists, reports, jobs, or Trace data.
- Keep configuration, state, stdout, stderr, and watchdog logs under `.cache/local-server-watchdog/`.
- Do not write API keys, HTTP bodies, or paper text to watchdog state or logs.
- Use the existing no-checkpoint job behavior after a backend restart.
- Add no production dependency.

---

### Task 1: Implement and test the local server watchdog core

**Files:**
- Create: `scripts/local-server-watchdog.mjs`
- Create: `test/local-server-watchdog.test.js`

**Interfaces:**
- Produces `normalizeLocalServerWatchdogConfig(value)`, `LocalServerWatchdog`, and `runLocalServerWatchdogFromCli(argv, dependencies)`.
- Config shape: `{ repositoryPath, nodePath?, port?, intervalMs?, startupGraceMs?, stateDirectory? }`, with defaults `3100`, `10000`, and `5000`.
- `LocalServerWatchdog` accepts injected `spawnServer`, `requestHealth`, timers, wait, clock, logger, state writer/remover, and `processId`; exposes `start()`, `checkOnce()`, `recover(reason)`, and `stop(reason)`.
- Persisted state shape: `{ pid, childPid, startedAt, childStartedAt, lastHealthyAt, restartAttempt, lastError }`.

- [ ] **Step 1: Write failing configuration and healthy-cycle tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalServerWatchdog,
  normalizeLocalServerWatchdogConfig
} from "../scripts/local-server-watchdog.mjs";

const config = normalizeLocalServerWatchdogConfig({ repositoryPath: "C:/work/code/paper-insight" });

test("local watchdog defaults to port 3100 and starts one owned server", async () => {
  const spawns = [];
  const watchdog = new LocalServerWatchdog({
    config,
    spawnServer: (command, args, options) => {
      spawns.push({ command, args, options });
      return { pid: 41, once() {}, kill() {} };
    },
    requestHealth: async () => ({ statusCode: 200 }),
    setTimer: () => 1,
    clearTimer() {},
    wait: async () => {},
    now: () => "2026-09-04T00:00:00.000Z",
    logger: { info() {}, error() {} },
    writeState: async () => {},
    removeState: async () => {},
    processId: 40
  });

  await watchdog.start();
  await watchdog.checkOnce();
  assert.equal(spawns.length, 1);
  assert.deepEqual(spawns[0].args, ["server.js"]);
  assert.equal(spawns[0].options.cwd, config.repositoryPath);
  assert.equal(spawns[0].options.env.PORT, "3100");
});
```

Add validation cases for an empty repository path, ports outside `1..65535`, intervals outside `1000..300000`, and startup grace outside `0..300000`.

- [ ] **Step 2: Run core tests and verify RED**

Run: `node --test test/local-server-watchdog.test.js`

Expected: FAIL because the watchdog module is absent.

- [ ] **Step 3: Implement validated configuration and one-child startup**

Follow the existing `scripts/tunnel-watchdog.mjs` injection pattern. Resolve paths during normalization; use `spawn(nodePath, ["server.js"], { cwd: repositoryPath, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", stdoutStream, stderrStream], windowsHide: true })` in the file-backed dependencies. Validate `server.js` with `access()` before constructing the real watchdog.

- [ ] **Step 4: Run healthy-cycle tests and verify GREEN**

Run: `node --check scripts/local-server-watchdog.mjs && node --test test/local-server-watchdog.test.js`

Expected: syntax check and initial tests pass.

- [ ] **Step 5: Write failing recovery, serialization, and ownership tests**

```js
test("health failure replaces only the owned child after the first backoff", async () => {
  const killed = [];
  const waits = [];
  const children = [
    { pid: 51, once() {}, kill() { killed.push(51); } },
    { pid: 52, once() {}, kill() { killed.push(52); } }
  ];
  let healthCalls = 0;
  const watchdog = createWatchdog({
    spawnServer: () => children.shift(),
    requestHealth: async () => {
      healthCalls += 1;
      if (healthCalls === 1) throw new Error("connection refused");
      return { statusCode: 200 };
    },
    wait: async (milliseconds) => waits.push(milliseconds)
  });

  await watchdog.start();
  await watchdog.checkOnce();
  assert.deepEqual(killed, [51]);
  assert.deepEqual(waits, [2000]);
  assert.equal(watchdog.child.pid, 52);
});
```

Add cases that trigger a child `exit` callback and `checkOnce()` together and assert one replacement; verify backoff sequence `2000, 5000, 10000, 30000`; verify a successful health check resets the attempt count; verify `stop()` kills only the current owned child and removes only `state.json`.

- [ ] **Step 6: Run recovery tests and verify RED**

Run: `node --test test/local-server-watchdog.test.js`

Expected: new recovery and ownership tests fail.

- [ ] **Step 7: Implement serialized recovery, health checking, state, and logs**

Use the same `this.recovery` promise guard as the tunnel watchdog. Add a startup-grace wait before the first scheduled health check. A successful request updates `lastHealthyAt`, clears `lastError`, resets `restartAttempt`, and persists state. A failure records `lastError`, stops the owned child, waits using `[2000, 5000, 10000, 30000]`, and starts one replacement.

File dependencies must:

- Request `http://127.0.0.1:<port>/api/reading-list/jobs/active` with a 5-second timeout.
- Append rotated `local-server-watchdog.log` files capped at 2 MiB.
- Direct child output to `server.stdout.log` and `server.stderr.log` without copying request data into the watchdog log.
- Atomically replace `state.json` by writing a sibling temporary file and renaming it.

- [ ] **Step 8: Run the complete core suite**

Run: `node --check scripts/local-server-watchdog.mjs && node --test test/local-server-watchdog.test.js`

Expected: all core tests pass.

- [ ] **Step 9: Record the watchdog-core checkpoint**

Review only the new core and its tests. Confirm there is no `taskkill`, process enumeration, port-based termination, credential logging, or application-data deletion.

### Task 2: Implement and test the Windows scheduled-task installer

**Files:**
- Create: `scripts/install-local-server-watchdog.ps1`
- Create: `test/local-server-watchdog-installer.test.js`

**Interfaces:**
- Scheduled task name: `PaperInsightLocalServerWatchdog`.
- Supports mutually exclusive `-Install`, `-Uninstall`, and `-Status` parameter sets.
- `-Install` accepts `-RepositoryPath`, optional `-Port`, `-IntervalMs`, and `-StartupGraceMs`.
- `-Uninstall` removes only the named scheduled task and `.cache/local-server-watchdog/state.json`.

- [ ] **Step 1: Write failing static installer safety tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("local server installer registers a hidden current-user single-instance logon task", async () => {
  const source = await readFile(new URL("../scripts/install-local-server-watchdog.ps1", import.meta.url), "utf8");
  assert.match(source, /PaperInsightLocalServerWatchdog/);
  assert.match(source, /New-ScheduledTaskTrigger\s+-AtLogOn/);
  assert.match(source, /-WindowStyle\s+Hidden/);
  assert.match(source, /-MultipleInstances\s+IgnoreNew/);
  assert.match(source, /Start-ScheduledTask/);
});

test("local server uninstall cannot remove application data", async () => {
  const source = await readFile(new URL("../scripts/install-local-server-watchdog.ps1", import.meta.url), "utf8");
  assert.match(source, /Unregister-ScheduledTask/);
  assert.match(source, /Remove-Item\s+-LiteralPath\s+\$statePath/);
  assert.doesNotMatch(source, /Remove-Item.+weekly-report|Remove-Item.+arxiv|Remove-Item.+trace/i);
});
```

- [ ] **Step 2: Run installer tests and verify RED**

Run: `node --test test/local-server-watchdog-installer.test.js`

Expected: FAIL because the installer script is absent.

- [ ] **Step 3: Implement install, status, and safe uninstall**

Mirror the established tunnel installer path handling. `-Install` resolves Node and repository paths, writes UTF-8 JSON configuration, and registers a PowerShell action using `-NoProfile -WindowStyle Hidden` to invoke Node with the watchdog script and config path. Use:

```powershell
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId (Get-TaskUserId) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
```

`-Status` prints the task state and local state JSON. `-Uninstall` unregisters only `PaperInsightLocalServerWatchdog` and removes only `state.json`; configuration and logs remain.

- [ ] **Step 4: Run installer tests and PowerShell syntax parsing**

Run: `node --test test/local-server-watchdog-installer.test.js`

Run: `powershell -NoProfile -Command '$errors=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "scripts/install-local-server-watchdog.ps1"),[ref]$null,[ref]$errors) > $null; if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }'`

Expected: tests pass and PowerShell reports no parse errors.

- [ ] **Step 5: Record the installer checkpoint**

Review the installer and confirm it contains no password parameter, no broad `.cache` removal, and no Node-process termination command.

### Task 3: Add commands, documentation, and install the local watchdog

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`

**Interfaces:**
- Adds package script `"server:watchdog": "node scripts/local-server-watchdog.mjs"`.
- Documents exact `-Install`, `-Status`, `-Uninstall`, log, and state commands.

- [ ] **Step 1: Write failing documentation contract assertions**

Extend `test/local-server-watchdog-installer.test.js` to assert:

```js
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
assert.equal(packageJson.scripts["server:watchdog"], "node scripts/local-server-watchdog.mjs");
assert.match(readme, /install-local-server-watchdog\.ps1/);
assert.match(readme, /\.cache\/local-server-watchdog/);
assert.match(readme, /3100/);
```

- [ ] **Step 2: Run the installer tests and verify RED**

Run: `node --test test/local-server-watchdog-installer.test.js`

Expected: FAIL until package metadata and README are updated.

- [ ] **Step 3: Add package command and administrator instructions**

Document these commands with the actual repository path:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-local-server-watchdog.ps1 -Install -RepositoryPath C:\work\code\paper-insight -Port 3100
powershell -ExecutionPolicy Bypass -File .\scripts\install-local-server-watchdog.ps1 -Status -RepositoryPath C:\work\code\paper-insight
powershell -ExecutionPolicy Bypass -File .\scripts\install-local-server-watchdog.ps1 -Uninstall -RepositoryPath C:\work\code\paper-insight
```

Explain that uninstall preserves configuration, logs, papers, lists, reports, tasks, and Trace data.

- [ ] **Step 4: Run documentation contract tests**

Run: `node --test test/local-server-watchdog-installer.test.js`

Expected: all installer and documentation assertions pass.

- [ ] **Step 5: Install and start the scheduled task**

Run the documented `-Install` command from an elevated PowerShell only if Task Scheduler registration requires elevation. Do not stop or delete unrelated processes before installation.

Expected: output says `Installed and started PaperInsightLocalServerWatchdog.`

- [ ] **Step 6: Verify task, HTTP health, state, and data preservation**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-local-server-watchdog.ps1 -Status -RepositoryPath C:\work\code\paper-insight
Invoke-WebRequest http://127.0.0.1:3100/api/reading-list/jobs/active -UseBasicParsing
Get-Item .cache\weekly-report-jobs, .cache\weekly-report-traces -ErrorAction SilentlyContinue
```

Expected: the scheduled task is running or ready with a live watchdog state, HTTP returns a valid response, and existing application-data directories remain present.

- [ ] **Step 7: Run focused and full regression verification**

Run: `node --test test/local-server-watchdog.test.js test/local-server-watchdog-installer.test.js test/tunnel-watchdog.test.js test/tunnel-watchdog-installer.test.js`

Run: `npm run check`

Expected: all focused and repository tests pass.

- [ ] **Step 8: Update GRAY-117 with exact evidence**

After the scheduled task and HTTP checks pass, change GRAY-117 status to “防护已实现，本机计划任务已验证”. Record the task name, port, state path, health URL, and exact verification time. Do not claim process-exit recovery until a controlled owned-child restart test or equivalent automated test has passed.

- [ ] **Step 9: Review the final watchdog diff**

Run: `git diff --check -- scripts/local-server-watchdog.mjs scripts/install-local-server-watchdog.ps1 test/local-server-watchdog.test.js test/local-server-watchdog-installer.test.js package.json README.md WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`

Expected: no whitespace errors.
