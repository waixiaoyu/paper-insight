import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("PaperInsight 2.1 version and release documentation stay aligned", async () => {
  const [packageText, readme, releaseNotes, specification] = await Promise.all([
    read("package.json"),
    read("README.md"),
    read("docs/releases/PAPER_INSIGHT_2.1.md"),
    read("WEEKLY_REPORT_AGENT_LOOP_DEV.md")
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(packageJson.version, "2.1.0");
  assert.match(readme, /当前版本：\*\*Paper Insight 2\.1\*\*（`2\.1\.0`）/);
  assert.match(readme, /docs\/releases\/PAPER_INSIGHT_2\.1\.md/);
  assert.match(releaseNotes, /^# Paper Insight 2\.1 Release Notes/m);
  assert.match(releaseNotes, /版本：`2\.1\.0`/);
  assert.match(releaseNotes, /Agent Harness/);
  assert.match(specification, /更新时间：2026-09-20/);
  assert.match(specification, /Paper Insight 2\.1/);
});

test("README describes the current credibility and manual-review policy", async () => {
  const readme = await read("README.md");

  assert.match(readme, /确定性硬门禁/);
  assert.match(readme, /语义告警/);
  assert.match(readme, /逐项人工复核/);
  assert.match(readme, /单篇论文范围内重试/);
  assert.doesNotMatch(readme, /Paper Insight 2\.0 的周报发布必须依次通过/);
});
