import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, ms = 12000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn().catch(() => null); if (value) return value; await sleep(100); }
  throw new Error("process verification timed out");
};
test("real supervisor restarts its child, rejects duplicate supervisors, and leaves no orphan", { timeout: 25000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperinsight-watchdog-"));
  const stateDirectory = join(directory, "state");
  await mkdir(join(directory, "scripts"));
  await writeFile(join(directory, "package.json"), '{"type":"module"}');
  await copyFile(new URL("../scripts/local-server-child.mjs", import.meta.url), join(directory, "scripts", "local-server-child.mjs"));
  // A real HTTP child with no application data or model access.
  await writeFile(join(directory, "server.js"), 'import {createServer} from "node:http"; import {resolve} from "node:path"; import {fileURLToPath} from "node:url"; if (resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) createServer((req,res)=>res.end("healthy")).listen(Number(process.env.PORT),process.env.HOST);');
  const portServer = createServer();
  await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port; await new Promise((resolve) => portServer.close(resolve));
  const configPath = join(directory, "config.json");
  await writeFile(configPath, JSON.stringify({ repositoryPath: directory, nodePath: process.execPath, port, intervalMs: 1000, startupGraceMs: 0, stateDirectory }));
  const script = fileURLToPath(new URL("../scripts/local-server-watchdog.mjs", import.meta.url));
  await mkdir(stateDirectory);
  await writeFile(join(stateDirectory, "watchdog.lock"), "2147483647");
  const staleStopper = spawn(process.execPath, [script, "--config", configPath, "--stop"], { windowsHide: true, stdio: "pipe" });
  assert.equal(await new Promise((resolve) => staleStopper.once("exit", resolve)), 0);
  await assert.rejects(() => readFile(join(stateDirectory, "watchdog.lock")));
  const parent = spawn(process.execPath, [script, "--config", configPath], { windowsHide: true, stdio: "pipe" });
  let stderr = ""; parent.stderr.on("data", (chunk) => { stderr += chunk; });
  const state = async () => JSON.parse(await readFile(join(stateDirectory, "state.json"), "utf8"));
  try {
    const first = await until(async () => { const s = await state(); return s.status === "healthy" && s; });
    assert.equal(first.pid, parent.pid, stderr);
    const duplicate = spawn(process.execPath, [script, "--config", configPath], { windowsHide: true, stdio: "pipe" });
    let duplicateError = ""; duplicate.stderr.on("data", (chunk) => { duplicateError += chunk; });
    const duplicateCode = await new Promise((resolve) => duplicate.once("exit", resolve));
    assert.equal(duplicateCode, 1);
    assert.match(duplicateError, /已经运行/);
    // Read PID only from this test-owned supervisor's private state directory.
    process.kill(first.childPid);
    const replacement = await until(async () => { const s = await state(); return s.status === "healthy" && s.childPid !== first.childPid && s; });
    assert.ok(replacement.childPid > 0);
    const stopper = spawn(process.execPath, [script, "--config", configPath, "--stop"], { windowsHide: true, stdio: "pipe" });
    const stopCode = await new Promise((resolve) => stopper.once("exit", resolve));
    assert.equal(stopCode, 0);
    await until(async () => parent.exitCode !== null || parent.signalCode !== null);
    // Start again and prove an abrupt supervisor loss also closes its owned server.
    const restarted = spawn(process.execPath, [script, "--config", configPath], { windowsHide: true, stdio: "ignore" });
    try {
      const restartedState = await until(async () => { const s = await state(); return s.pid === restarted.pid && s.status === "healthy" && s; });
      restarted.kill();
      await until(async () => {
        try { process.kill(restartedState.childPid, 0); return false; } catch (error) { return error.code === "ESRCH"; }
      });
    } finally { if (restarted.exitCode === null && restarted.signalCode === null) restarted.kill(); }
    parent.kill();
    await until(async () => {
      try { process.kill(replacement.childPid, 0); return false; } catch (error) { return error.code === "ESRCH"; }
    });
    assert.match(await readFile(join(stateDirectory, "local-server-watchdog.log"), "utf8"), /exitCode=/);
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill();
    await sleep(200);
    await rm(directory, { recursive: true, force: true });
  }
});
