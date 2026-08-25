import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  redactTraceValue,
  WeeklyReportTraceStore
} from "../weekly-report/trace-store.js";

const tempDirectories = [];

const makeTempDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "paper-insight-trace-"));
  tempDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

test("Trace 深度脱敏认证字段和嵌入字符串，但保留模型 token 配置", () => {
  const redacted = redactTraceValue({
    apiKey: "sk-secret",
    headers: {
      Authorization: "Bearer access-secret",
      Cookie: "session=private",
      "content-type": "application/json"
    },
    prompt: "Authorization: Bearer prompt-secret\nCookie: sid=prompt-private\n正文",
    model: {
      maxTokens: 4096,
      temperature: 0.2
    }
  });

  assert.equal(redacted.apiKey, "[REDACTED]");
  assert.equal(redacted.headers.Authorization, "[REDACTED]");
  assert.equal(redacted.headers.Cookie, "[REDACTED]");
  assert.equal(redacted.headers["content-type"], "application/json");
  assert.doesNotMatch(redacted.prompt, /prompt-secret|prompt-private/);
  assert.match(redacted.prompt, /正文/);
  assert.equal(redacted.model.maxTokens, 4096);
});

test("Trace 所有落盘入口都执行脱敏，reject 也保存最终稿", async () => {
  const rootDir = await makeTempDirectory();
  const store = new WeeklyReportTraceStore({ rootDir });

  await store.createTrace({
    traceId: "trace-reject",
    jobId: "job-reject",
    input: { llmApiKey: "input-secret", reportKey: "2026-W31" },
    createdAt: "2026-08-01T10:00:00.000Z"
  });
  await store.appendTimeline("trace-reject", {
    stage: "review",
    requestHeaders: { authorization: "Bearer timeline-secret" }
  });
  await store.writeJson("trace-reject", "artifacts", {
    paperId: "2607.00001",
    cookie: "artifact-secret"
  });
  await store.writeResult("trace-reject", "# 被拒绝稿件\n\n可供管理员复盘。\n");

  const diskText = await readFile(join(rootDir, "trace-reject", "meta.json"), "utf8")
    + await readFile(join(rootDir, "trace-reject", "timeline.ndjson"), "utf8")
    + await readFile(join(rootDir, "trace-reject", "artifacts.json"), "utf8");
  const resultMarkdown = await readFile(join(rootDir, "trace-reject", "result.md"), "utf8");

  assert.doesNotMatch(diskText, /input-secret|timeline-secret|artifact-secret/);
  assert.match(diskText, /\[REDACTED\]/);
  assert.match(resultMarkdown, /被拒绝稿件/);
});

test("Trace 同时执行最近 20 次与最长 30 天保留策略", async () => {
  const rootDir = await makeTempDirectory();
  const now = new Date("2026-08-01T12:00:00.000Z");
  const store = new WeeklyReportTraceStore({
    rootDir,
    maxJobs: 20,
    retentionDays: 30,
    now: () => now
  });

  await store.createTrace({
    traceId: "trace-expired",
    jobId: "job-expired",
    createdAt: "2026-06-01T00:00:00.000Z"
  });

  for (let index = 0; index < 22; index += 1) {
    await store.createTrace({
      traceId: `trace-${String(index).padStart(2, "0")}`,
      jobId: `job-${index}`,
      createdAt: new Date(Date.UTC(2026, 6, 10, 0, index)).toISOString()
    });
  }

  const remaining = await store.prune();

  assert.equal(remaining.length, 20);
  assert.equal(remaining.some((item) => item.traceId === "trace-expired"), false);
  assert.equal(remaining.some((item) => item.traceId === "trace-00"), false);
  assert.equal(remaining.some((item) => item.traceId === "trace-01"), false);
  assert.equal(remaining.some((item) => item.traceId === "trace-21"), true);
});

test("Trace summary returns compact artifact previews without exposing large payloads", async () => {
  const rootDir = await makeTempDirectory();
  const store = new WeeklyReportTraceStore({ rootDir });
  await store.createTrace({ traceId: "trace-summary", jobId: "job-summary" });
  await store.appendTimeline("trace-summary", { stage: "review", type: "stage_started" });
  await store.writeJson("trace-summary", "evidence-artifacts", {
    succeeded: [{ paper: { id: "2608.10001", title: "Passed paper" } }],
    processingFailed: [{
      paper: { id: "2608.10002", title: "Format failure" },
      error: { code: "READING_LIST_EVIDENCE_RESPONSE_INVALID" }
    }],
    excluded: [{
      paper: { id: "2608.10003", title: "Content failure" },
      error: { code: "READING_LIST_EVIDENCE_UNSUPPORTED" }
    }],
    payload: "x".repeat(1024 * 1024)
  });
  await store.writeJson("trace-summary", "selection-artifacts", {
    threshold: 70,
    selected: [{
      paper: { id: "2608.10001", title: "Passed paper" },
      reviewResult: { rawScore: 76 },
      selection: { selected: true, finalScore: 76, selectionReason: "threshold" },
      evidenceCard: { secret: "must-not-enter-summary" }
    }],
    notSelected: [{
      paper: { id: "2608.10004", title: "Below threshold" },
      reviewResult: { rawScore: 68 },
      selection: { selected: false, finalScore: 68, selectionReason: "below_threshold" }
    }],
    ineligible: [{
      paper: { id: "2608.10005", title: "Missing calibration" },
      reviewResult: { rawScore: 81 },
      selection: { selected: false, finalScore: 81, selectionReason: "calibration_required" },
      evidenceCard: { secret: "must-not-enter-summary-either" }
    }]
  });

  const summary = await store.readTraceSummary("trace-summary");

  assert.equal(summary.timeline.length, 1);
  assert.equal(summary.artifacts["evidence-artifacts"].sizeBytes > 1024 * 1024, true);
  assert.deepEqual(summary.artifacts["evidence-artifacts"].preview.counts, {
    succeeded: 1,
    processingFailed: 1,
    excluded: 1
  });
  assert.equal(summary.artifacts["selection-artifacts"].preview.threshold, 70);
  assert.deepEqual(summary.artifacts["selection-artifacts"].preview.selected[0], {
    paperId: "2608.10001",
    title: "Passed paper",
    finalScore: 76,
    selected: true,
    selectionReason: "threshold"
  });
  assert.deepEqual(summary.artifacts["selection-artifacts"].preview.ineligible[0], {
    paperId: "2608.10005",
    title: "Missing calibration",
    finalScore: 81,
    selected: false,
    selectionReason: "calibration_required"
  });
  assert.equal(JSON.stringify(summary).includes("x".repeat(100)), false);
  assert.equal(JSON.stringify(summary).includes("must-not-enter-summary"), false);
});
