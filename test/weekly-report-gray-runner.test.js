import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  arxivIdsFromMarkdown,
  buildGrayEvaluation,
  normalizeGrayInput,
  parseGrayArgs,
  runGrayJob,
  writeGrayArtifacts
} from "../scripts/run-weekly-report-gray.mjs";

const paper = (id = "2608.00001", extra = {}) => ({
  id,
  title: `Real candidate ${id}`,
  absLink: `https://arxiv.org/abs/${id}`,
  published: "2026-08-03T00:00:00.000Z",
  ...extra
});

const grayInput = () => ({
  reportKey: "2026-W32-real-gray",
  date: "2026-08-03",
  weekStart: "2026-08-02T16:00:00.000Z",
  weekEnd: "2026-08-09T16:00:00.000Z",
  primaryPapers: [paper()],
  reservePapers: [paper("2608.00002")]
});

test("真实灰度输入拒绝密钥、隐藏论文和跨池重复论文", () => {
  assert.throws(
    () => normalizeGrayInput({ ...grayInput(), llmApiKey: "must-not-be-in-file" }),
    /敏感字段/
  );
  assert.throws(
    () => normalizeGrayInput({ ...grayInput(), primaryPapers: [paper("2608.00003", { hidden: true })] }),
    /隐藏论文/
  );
  assert.throws(
    () => normalizeGrayInput({ ...grayInput(), reservePapers: [paper()] }),
    /重复论文/
  );
});

test("真实灰度输入规范化并强制全文模式与有限配置", () => {
  const normalized = normalizeGrayInput({
    ...grayInput(),
    useOriginalText: false,
    paperConcurrency: 99,
    calibrationMaxPapers: 100,
    maxSelectedCount: 99
  });
  assert.equal(normalized.useOriginalText, true);
  assert.equal(normalized.paperConcurrency, 5);
  assert.equal(normalized.calibrationMaxPapers, 30);
  assert.equal(normalized.maxSelectedCount, 20);
  assert.deepEqual(normalized.primaryPapers.map((item) => item.id), ["2608.00001"]);
});

test("灰度运行器通过异步 Job API 轮询终态并读取结果和 Trace", async () => {
  let jobPolls = 0;
  const calls = [];
  const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body || "" });
    if (url.endsWith("/api/reading-list/jobs") && options.method === "POST") {
      return json({ jobId: "job-1", traceId: "trace-1", reportKey: "2026-W32-real-gray", state: "running", agentStage: "prepare_context", counts: {} }, 202);
    }
    if (url.endsWith("/jobs/job-1/result")) {
      return json({ state: "publish", reason: "quality_gates_passed", markdown: "https://arxiv.org/abs/2608.00001", result: { qaReport: { status: "passed" } } });
    }
    if (url.endsWith("/jobs/job-1/trace")) {
      return json({ meta: { traceId: "trace-1" }, timeline: [], artifacts: {} });
    }
    if (url.endsWith("/jobs/job-1")) {
      jobPolls += 1;
      return json(jobPolls === 1
        ? { jobId: "job-1", traceId: "trace-1", reportKey: "2026-W32-real-gray", state: "running", agentStage: "review", counts: { reviewed: 1 } }
        : { jobId: "job-1", traceId: "trace-1", reportKey: "2026-W32-real-gray", state: "publish", agentStage: "publish", counts: { reviewed: 1, selected: 1 }, result: { reason: "quality_gates_passed" } });
    }
    return json({ message: "not found" }, 404);
  };

  const stages = [];
  const run = await runGrayJob({
    baseUrl: "http://gray.local",
    input: grayInput(),
    fetchImpl,
    pollMs: 10,
    onProgress: (job) => stages.push(job.agentStage)
  });

  assert.equal(run.result.state, "publish");
  assert.deepEqual(stages, ["prepare_context", "review", "publish"]);
  assert.equal(calls.some((call) => call.url.endsWith("/jobs/job-1/trace")), true);
  const submitted = JSON.parse(calls.find((call) => call.method === "POST").body);
  assert.equal(submitted.useOriginalText, true);
  assert.equal(Object.keys(submitted).some((key) => /api.?key/i.test(key)), false);
});

test("灰度验收单记录阶段耗时、修正、新旧稿差异并落盘", async () => {
  const run = {
    input: normalizeGrayInput(grayInput()),
    job: { jobId: "job-2", traceId: "trace-2", state: "publish", warnings: [] },
    result: {
      state: "publish",
      reason: "quality_gates_passed",
      markdown: "# 新稿\n\nhttps://arxiv.org/abs/2608.00001",
      result: { qaReport: { status: "passed", repairAttempted: true }, warnings: [] }
    },
    trace: {
      meta: { traceId: "trace-2" },
      timeline: [
        { type: "model_call_completed", stage: "review", attemptType: "initial" },
        { type: "model_call_completed", stage: "review", attemptType: "repair" },
        { type: "stage_completed", stage: "review", durationMs: 123, decision: "continue" }
      ],
      artifacts: {
        "selection-artifacts": { selected: [{ paper: paper() }] }
      }
    }
  };
  const baseline = "# 旧稿\n\nhttps://arxiv.org/abs/2608.00002";
  const evaluation = buildGrayEvaluation({ ...run, baselineMarkdown: baseline });
  assert.match(evaluation, /review \| 123/);
  assert.match(evaluation, /非 initial 调用 1 次/);
  assert.match(evaluation, /新增论文链接：2608\.00001/);
  assert.match(evaluation, /移除论文链接：2608\.00002/);

  const root = await mkdtemp(join(tmpdir(), "weekly-report-gray-"));
  try {
    const directory = await writeGrayArtifacts({ outputRoot: root, run, baselineMarkdown: baseline });
    assert.match(await readFile(join(directory, "evaluation.md"), "utf8"), /真实灰度验收/);
    assert.match(await readFile(join(directory, "result.md"), "utf8"), /2608\.00001/);
    assert.doesNotMatch(await readFile(join(directory, "input.json"), "utf8"), /apiKey/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("灰度命令参数要求显式输入文件并支持旧稿对照", () => {
  assert.throws(() => parseGrayArgs([]), /--input/);
  assert.deepEqual(parseGrayArgs([
    "--input", "real.json",
    "--baseline", "old.md",
    "--poll-ms", "50"
  ]), {
    input: "real.json",
    baseline: "old.md",
    output: "outputs/weekly-report-gray",
    baseUrl: "",
    pollMs: 50
  });
  assert.deepEqual(arxivIdsFromMarkdown("/abs/2608.00001v2 /abs/2608.00001"), []);
  assert.deepEqual(arxivIdsFromMarkdown("https://arxiv.org/abs/2608.00001v2"), ["2608.00001"]);
});

