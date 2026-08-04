import assert from "node:assert/strict";
import test from "node:test";
import {
  WeeklyReportPipelineError,
  runWeeklyReportAgentLoop
} from "../weekly-report/pipeline-runner.js";

const executionContext = () => ({
  jobId: "job-pipeline",
  traceId: "trace-pipeline",
  signal: new AbortController().signal,
  updateStage: async () => {},
  recordTrace: async () => {},
  writeTrace: async () => {}
});

const transition = (name, nextStage, calls, patch = {}) => async (value = {}) => {
  calls.push(name);
  return { ...value, ...patch, nextStage };
};

test("Pipeline Runner executes every Agent Loop stage and returns publish only after both semantic QA stages pass", async () => {
  const calls = [];
  const steps = {
    prepare: transition("prepare", "extract_evidence", calls),
    evidence: transition("evidence", "review", calls),
    review: transition("review", "calibrate", calls),
    calibrate: transition("calibrate", "select", calls),
    select: transition("select", "editorial_plan", calls),
    editorialPlan: transition("editorial_plan", "write_paper_sections", calls),
    paperSections: transition("write_paper_sections", "write_head_tail", calls),
    headTail: transition("write_head_tail", "assemble", calls),
    assemble: transition("assemble", "deterministic_qa", calls, {
      markdown: "# Final weekly report",
      assemblyResult: { title: "Final title" },
      qaReport: { status: "pending", repairAttempted: false, repairResults: [] }
    }),
    deterministicQa: transition("deterministic_qa", "paper_semantic_qa", calls, {
      qaReport: { status: "passed", repairAttempted: false, repairResults: [] }
    }),
    paperSemanticQa: transition("paper_semantic_qa", "report_semantic_qa", calls, {
      qaReport: { status: "passed", repairAttempted: false, repairResults: [] }
    }),
    reportSemanticQa: transition("report_semantic_qa", "publish", calls, {
      qaReport: { status: "passed", repairAttempted: false, repairResults: [] }
    }),
    repair: transition("repair_once", "assemble", calls)
  };
  const result = await runWeeklyReportAgentLoop(
    { reportKey: "2026-W32", papers: [{ id: "2608.40001" }] },
    executionContext(),
    { buildContext: async () => ({}), callModel: async () => ({}), steps }
  );

  assert.deepEqual(calls, [
    "prepare",
    "evidence",
    "review",
    "calibrate",
    "select",
    "editorial_plan",
    "write_paper_sections",
    "write_head_tail",
    "assemble",
    "deterministic_qa",
    "paper_semantic_qa",
    "report_semantic_qa"
  ]);
  assert.equal(result.state, "publish");
  assert.equal(result.reason, "quality_gates_passed");
  assert.equal(result.markdown, "# Final weekly report");
  assert.equal(result.title, "Final title");
  assert.equal(result.reportKey, "2026-W32");
});

test("Pipeline Runner performs repair_once once, reassembles, and rechecks every mandatory QA gate", async () => {
  const calls = [];
  let reportQaCalls = 0;
  const steps = {
    prepare: transition("prepare", "extract_evidence", calls),
    evidence: transition("evidence", "review", calls),
    review: transition("review", "calibrate", calls),
    calibrate: transition("calibrate", "select", calls),
    select: transition("select", "editorial_plan", calls),
    editorialPlan: transition("editorial_plan", "write_paper_sections", calls),
    paperSections: transition("write_paper_sections", "write_head_tail", calls),
    headTail: transition("write_head_tail", "assemble", calls),
    assemble: async (value = {}) => {
      calls.push("assemble");
      return { ...value, nextStage: "deterministic_qa", markdown: "# Reassembled", assemblyResult: { title: "Reassembled" } };
    },
    deterministicQa: transition("deterministic_qa", "paper_semantic_qa", calls, {
      qaReport: { status: "passed", repairAttempted: false, repairResults: [] }
    }),
    paperSemanticQa: transition("paper_semantic_qa", "report_semantic_qa", calls, {
      qaReport: { status: "passed", repairAttempted: false, repairResults: [] }
    }),
    reportSemanticQa: async (value = {}) => {
      calls.push("report_semantic_qa");
      reportQaCalls += 1;
      return reportQaCalls === 1
        ? { ...value, nextStage: "repair_once", qaReport: { status: "repair_required", repairAttempted: false, repairResults: [] } }
        : { ...value, nextStage: "publish", qaReport: { status: "passed", repairAttempted: true, repairResults: [{ repairTarget: "head_tail" }] } };
    },
    repair: async (value = {}) => {
      calls.push("repair_once");
      return { ...value, nextStage: "assemble", qaReport: { ...value.qaReport, repairAttempted: true } };
    }
  };
  const result = await runWeeklyReportAgentLoop(
    { reportKey: "2026-W32", papers: [{ id: "2608.40002" }] },
    executionContext(),
    { buildContext: async () => ({}), callModel: async () => ({}), steps }
  );

  assert.deepEqual(calls.slice(-6), [
    "report_semantic_qa",
    "repair_once",
    "assemble",
    "deterministic_qa",
    "paper_semantic_qa",
    "report_semantic_qa"
  ]);
  assert.equal(calls.filter((stage) => stage === "repair_once").length, 1);
  assert.equal(calls.filter((stage) => stage === "deterministic_qa").length, 2);
  assert.equal(calls.filter((stage) => stage === "paper_semantic_qa").length, 2);
  assert.equal(calls.filter((stage) => stage === "report_semantic_qa").length, 2);
  assert.equal(result.state, "publish");
  assert.equal(result.qaReport.repairAttempted, true);
});

test("Pipeline Runner preserves the latest assembled Markdown when a later quality gate rejects", async () => {
  const calls = [];
  const rejection = new Error("Semantic QA rejected the final content.");
  rejection.code = "READING_LIST_REPORT_QA_FAILED";
  rejection.stage = "report_semantic_qa";
  rejection.rejectJob = true;
  const steps = {
    prepare: transition("prepare", "extract_evidence", calls),
    evidence: transition("evidence", "review", calls),
    review: transition("review", "calibrate", calls),
    calibrate: transition("calibrate", "select", calls),
    select: transition("select", "editorial_plan", calls),
    editorialPlan: transition("editorial_plan", "write_paper_sections", calls),
    paperSections: transition("write_paper_sections", "write_head_tail", calls),
    headTail: transition("write_head_tail", "assemble", calls),
    assemble: transition("assemble", "deterministic_qa", calls, { markdown: "# Rejected but inspectable" }),
    deterministicQa: transition("deterministic_qa", "paper_semantic_qa", calls, { qaReport: { status: "passed" } }),
    paperSemanticQa: transition("paper_semantic_qa", "report_semantic_qa", calls, { qaReport: { status: "passed" } }),
    reportSemanticQa: async () => { throw rejection; },
    repair: transition("repair_once", "assemble", calls)
  };

  await assert.rejects(
    () => runWeeklyReportAgentLoop({}, executionContext(), {
      buildContext: async () => ({}),
      callModel: async () => ({}),
      steps
    }),
    (error) => error === rejection && error.markdown === "# Rejected but inspectable"
  );
});

test("Pipeline Runner rejects unknown transitions instead of falling back to the old weekly-report flow", async () => {
  await assert.rejects(
    () => runWeeklyReportAgentLoop({}, executionContext(), {
      buildContext: async () => ({}),
      callModel: async () => ({}),
      steps: {
        prepare: async () => ({ nextStage: "legacy_generate" })
      }
    }),
    (error) => error instanceof WeeklyReportPipelineError
      && error.code === "READING_LIST_PIPELINE_STAGE_INVALID"
      && error.rejectJob === true
  );
});
