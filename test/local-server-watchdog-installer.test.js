import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

test("Windows PowerShell resolves the default repository when invoked with File", { skip: process.platform !== "win32" }, async () => {
  const script = fileURLToPath(new URL("../scripts/install-local-server-watchdog.ps1", import.meta.url));
  const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Status"], { windowsHide: true });
  assert.match(stdout, /Task:/);
});

test("local installer has logon, hidden, unlimited-duration, single-instance contract", async () => {
  const source = await readFile(new URL("../scripts/install-local-server-watchdog.ps1", import.meta.url), "utf8");
  for (const pattern of [/PaperInsightLocalServerWatchdog/, /-AtLogOn/, /-WindowStyle Hidden/,
    /-MultipleInstances IgnoreNew/, /-ExecutionTimeLimit.*Zero/, /Stop-ScheduledTask/, /Start-ScheduledTask/]) {
    assert.match(source, pattern);
  }
  assert.doesNotMatch(source, /taskkill|Remove-Item.*-Recurse|Stop-Process/);
});
test("local watchdog is documented with data-preserving uninstall and a foreground command", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.equal(packageJson.scripts["server:watchdog"], "node scripts/local-server-watchdog.mjs");
  assert.match(readme, /install-local-server-watchdog\.ps1/);
  assert.match(readme, /\.cache\/local-server-watchdog/);
});
