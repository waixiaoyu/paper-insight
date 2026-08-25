import assert from "node:assert/strict";
import test from "node:test";
import {
  weeklyReportArtifactSummary,
  weeklyReportDisconnectedJob,
  weeklyReportHealthState,
  weeklyReportPhaseStatus,
  weeklyReportRequestRetryable,
  weeklyReportSelectionRows
} from "../public/weekly-report-operations.js";

const paperEntry = (id, title = `Paper ${id}`) => ({
  paper: { id, title },
  contextPacket: { paperId: id }
});

test("A disconnected page restore keeps the remembered job id instead of creating a replacement", () => {
  const job = weeklyReportDisconnectedJob({
    jobId: "weekly-report-job-existing",
    reportKey: "2026-W34"
  }, { now: "2026-08-25T10:00:00.000Z" });

  assert.equal(job.jobId, "weekly-report-job-existing");
  assert.equal(job.reportKey, "2026-W34");
  assert.equal(job.state, "running");
  assert.equal(job.connectionInterrupted, true);
  assert.equal(job.progress.lastEventType, "connection_interrupted");
});

test("An artifact-only phase is completed rather than waiting or running", () => {
  assert.equal(weeklyReportPhaseStatus([], [["selection-artifacts", { sizeBytes: 10 }]]), "completed");
  assert.equal(weeklyReportPhaseStatus([], []), "pending");
  assert.equal(weeklyReportPhaseStatus([{ type: "stage_started" }], []), "running");
  assert.equal(weeklyReportPhaseStatus([{
    type: "manual_review_requested"
  }], []), "waiting_admin");
});

test("Evidence operations summary separates model processing failures from content exclusions", () => {
  const artifact = {
    succeeded: Array.from({ length: 4 }, (_, index) => paperEntry(`pass-${index + 1}`)),
    processingFailed: Array.from({ length: 5 }, (_, index) => ({
      ...paperEntry(`processing-${index + 1}`),
      error: { code: "READING_LIST_EVIDENCE_RESPONSE_INVALID" }
    })),
    excluded: Array.from({ length: 3 }, (_, index) => ({
      ...paperEntry(`content-${index + 1}`),
      error: { code: "READING_LIST_EVIDENCE_UNSUPPORTED" }
    }))
  };

  const summary = weeklyReportArtifactSummary("evidence-artifacts", artifact);

  assert.equal(summary.title, "证据提取结果");
  assert.deepEqual(summary.metrics, [
    { key: "succeeded", label: "证据通过", count: 4 },
    { key: "processing_failed", label: "模型处理或响应格式失败", count: 5 },
    { key: "content_excluded", label: "论据内容未通过", count: 3 }
  ]);
});

test("Selection operations rows explain threshold admission without exposing fallback wording", () => {
  const artifact = {
    threshold: 70,
    selected: [{
      ...paperEntry("2608.10001", "Threshold paper"),
      reviewResult: { rawScore: 76 },
      selection: { selected: true, finalScore: 76, selectionReason: "threshold", thresholdMet: true }
    }],
    notSelected: [{
      ...paperEntry("2608.10002", "Below-threshold paper"),
      reviewResult: { rawScore: 68 },
      selection: { selected: false, finalScore: 68, selectionReason: "below_threshold", thresholdMet: false }
    }, {
      ...paperEntry("2608.10003", "Over-limit paper"),
      reviewResult: { rawScore: 75 },
      selection: { selected: false, finalScore: 75, selectionReason: "max_selected_count", thresholdMet: true }
    }],
    ineligible: [{
      ...paperEntry("2608.10004", "Uncalibrated paper"),
      reviewResult: { rawScore: 80 },
      selection: { selected: false, finalScore: 80, selectionReason: "calibration_required", thresholdMet: false }
    }]
  };

  const rows = weeklyReportSelectionRows(artifact);

  assert.deepEqual(rows, [{
    paperId: "2608.10001",
    title: "Threshold paper",
    score: 76,
    threshold: 70,
    selected: true,
    admissionLabel: "达到 70 分入选"
  }, {
    paperId: "2608.10002",
    title: "Below-threshold paper",
    score: 68,
    threshold: 70,
    selected: false,
    admissionLabel: "未达到 70 分，不入选"
  }, {
    paperId: "2608.10003",
    title: "Over-limit paper",
    score: 75,
    threshold: 70,
    selected: false,
    admissionLabel: "达到 70 分，因篇数上限未入选"
  }, {
    paperId: "2608.10004",
    title: "Uncalibrated paper",
    score: 80,
    threshold: 70,
    selected: false,
    admissionLabel: "未完成横向校准，不具备入选资格"
  }]);
  assert.doesNotMatch(JSON.stringify(rows), /fallback|保底/i);
});

test("Operations health state distinguishes active, waiting, disconnected and stalled jobs", () => {
  const base = {
    state: "running",
    agentStage: "extract_evidence",
    createdAt: "2026-08-25T10:00:00.000Z",
    progress: {
      stageStartedAt: "2026-08-25T10:01:00.000Z",
      lastEventAt: "2026-08-25T10:04:30.000Z",
      lastEventType: "evidence_processing_completed",
      paperId: "2608.10001"
    },
    manualReview: null
  };
  const now = "2026-08-25T10:05:00.000Z";

  assert.equal(weeklyReportHealthState(base, { now }).key, "running_recent");
  assert.equal(weeklyReportHealthState({
    ...base,
    progress: { ...base.progress, lastEventType: "evidence_processing_started" }
  }, { now }).key, "waiting_model");
  assert.equal(weeklyReportHealthState({ ...base, manualReview: { stage: "extract_evidence" } }, { now }).key, "waiting_admin");
  assert.equal(weeklyReportHealthState(base, { now, connectionInterrupted: true }).key, "connection_interrupted");
  assert.equal(weeklyReportHealthState({ ...base, state: "publish" }, {
    now,
    connectionInterrupted: true
  }).key, "connection_interrupted");
  assert.equal(weeklyReportHealthState({
    ...base,
    progress: { ...base.progress, lastEventAt: "2026-08-25T09:55:00.000Z" }
  }, { now, staleAfterMs: 5 * 60 * 1000 }).key, "possibly_stalled");
  assert.equal(weeklyReportHealthState({ ...base, state: "publish" }, { now }).key, "publish");
  assert.equal(weeklyReportHealthState({ ...base, state: "reject" }, { now }).key, "reject");
});

test("Only temporary network and server errors are retried while reading a Job result", () => {
  assert.equal(weeklyReportRequestRetryable(new TypeError("Failed to fetch")), true);
  assert.equal(weeklyReportRequestRetryable(Object.assign(new Error("server error"), { status: 503 })), true);
  assert.equal(weeklyReportRequestRetryable(Object.assign(new Error("not found"), { status: 404 })), false);
});
