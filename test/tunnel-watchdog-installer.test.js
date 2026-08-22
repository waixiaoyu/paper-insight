import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const installerUrl = new URL("../scripts/install-tunnel-watchdog.ps1", import.meta.url);

test("Windows installer creates a current-user logon task without password arguments", async () => {
  const source = await readFile(installerUrl, "utf8");

  assert.match(source, /PaperInsightTunnelWatchdog/);
  assert.match(source, /Register-ScheduledTask/);
  assert.match(source, /New-ScheduledTaskTrigger\s+-AtLogOn/);
  assert.match(source, /config\.json/);
  assert.doesNotMatch(source, /password|SSH_ASKPASS|Tv92/i);
});

test("Windows uninstall removes only the watchdog task and state file", async () => {
  const source = await readFile(installerUrl, "utf8");

  assert.match(source, /Unregister-ScheduledTask/);
  assert.match(source, /state\.json/);
  assert.doesNotMatch(source, /Remove-Item[^\n]+config\.json/i);
  assert.doesNotMatch(source, /Remove-Item[^\n]+IdentityPath/i);
});
