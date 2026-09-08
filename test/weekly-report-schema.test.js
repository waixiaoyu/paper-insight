import assert from "node:assert/strict";
import test from "node:test";
import {
  assertWeeklyReportJob,
  createWeeklyReportJob,
  finalizeWeeklyReportJob,
  normalizeWeeklyReportJobOptions
} from "../weekly-report/schema.js";

test("Job 配置按规格限制并发、校准规模和最终篇数", () => {
  assert.deepEqual(normalizeWeeklyReportJobOptions({}), {
    paperConcurrency: 2,
    calibrationMaxPapers: 30,
    minSelectedCount: 3,
    maxSelectedCount: 10
  });

  assert.deepEqual(normalizeWeeklyReportJobOptions({
    paperConcurrency: 99,
    calibrationMaxPapers: 99,
    minSelectedCount: 18,
    maxSelectedCount: 4
  }), {
    paperConcurrency: 5,
    calibrationMaxPapers: 30,
    minSelectedCount: 4,
    maxSelectedCount: 4
  });

  assert.deepEqual(normalizeWeeklyReportJobOptions({
    paperConcurrency: 0,
    calibrationMaxPapers: 0,
    minSelectedCount: 0,
    maxSelectedCount: 100
  }), {
    paperConcurrency: 1,
    calibrationMaxPapers: 1,
    minSelectedCount: 1,
    maxSelectedCount: 20
  });
});

test("Job 运行期间只有 running，完成后只有 publish 或 reject", () => {
  const job = createWeeklyReportJob({
    jobId: "weekly-report-job-1",
    traceId: "weekly-report-trace-1",
    reportKey: "2026-W31",
    now: "2026-08-01T10:00:00.000Z"
  });

  assert.equal(job.state, "running");
  assert.equal(job.agentStage, "create_job");
  assert.deepEqual(job.progress, {
    stageStartedAt: "2026-08-01T10:00:00.000Z",
    lastEventAt: "2026-08-01T10:00:00.000Z",
    lastEventType: "job_started",
    paperId: ""
  });
  assert.doesNotThrow(() => assertWeeklyReportJob(job));

  for (const state of ["draft", "review", "publishable", "queued", "cancelled"]) {
    assert.throws(
      () => finalizeWeeklyReportJob(job, { state }),
      /publish or reject/
    );
  }

  const rejected = finalizeWeeklyReportJob(job, {
    state: "reject",
    reason: "admin_cancelled",
    result: { reason: "must_not_override" },
    now: "2026-08-01T10:01:00.000Z"
  });

  assert.equal(rejected.state, "reject");
  assert.equal(rejected.result.reason, "admin_cancelled");
  assert.equal(rejected.completedAt, "2026-08-01T10:01:00.000Z");
});

test("Job Schema 拒绝缺少时间或使用非法时间的进展记录", () => {
  const job = createWeeklyReportJob({
    jobId: "weekly-report-job-progress",
    traceId: "weekly-report-trace-progress",
    reportKey: "2026-W31"
  });

  assert.throws(
    () => assertWeeklyReportJob({ ...job, progress: { ...job.progress, lastEventAt: "" } }),
    /progress.lastEventAt/
  );
  assert.throws(
    () => assertWeeklyReportJob({ ...job, progress: { ...job.progress, stageStartedAt: "not-a-date" } }),
    /valid date/
  );
});

test("Job Schema 拒绝完成态缺少结果以及非法计数", () => {
  const job = createWeeklyReportJob({
    jobId: "weekly-report-job-2",
    traceId: "weekly-report-trace-2",
    reportKey: "2026-W31"
  });

  assert.throws(
    () => assertWeeklyReportJob({ ...job, state: "publish", result: null }),
    /result/
  );
  assert.throws(
    () => assertWeeklyReportJob({
      ...job,
      counts: { ...job.counts, selected: -1 }
    }),
    /counts.selected/
  );
});

test("Job Schema validates unified manual-review queues and keeps legacy reviews readable", () => {
  const job = createWeeklyReportJob({
    jobId: "weekly-report-job-review-queue",
    traceId: "weekly-report-trace-review-queue",
    reportKey: "2026-W37",
    now: "2026-09-08T00:00:00.000Z"
  });
  const review = {
    status: "waiting_admin",
    stage: "select",
    resumeStage: "select",
    activeItemId: "selection-2609.02516",
    requestedAt: "2026-09-08T00:00:00.000Z",
    items: [{
      itemId: "selection-2609.02516",
      paperId: "2609.02516",
      relatedPaperIds: ["2609.02516"],
      kind: "quality_below_threshold",
      scope: "paper",
      sourceStage: "select",
      summary: "横向校准后为 67 分。",
      details: [],
      issues: [],
      evidenceReviews: [],
      approvableIssueKeys: [],
      scoreSnapshot: { finalScore: 67, threshold: 70, dimensions: {} },
      gateStatus: { fullText: "passed", identity: "passed", evidence: "passed", crossPaper: "passed" },
      repairAttempts: 0,
      allowedActions: ["include_below_threshold", "keep_excluded", "exit_task"]
    }]
  };

  assert.doesNotThrow(() => assertWeeklyReportJob({ ...job, manualReview: review }));
  assert.throws(() => assertWeeklyReportJob({
    ...job,
    manualReview: { ...review, items: [{ ...review.items[0], kind: "unknown_kind" }] }
  }), /known itemId and kind/);
  assert.throws(() => assertWeeklyReportJob({
    ...job,
    manualReview: { ...review, items: [{ ...review.items[0], allowedActions: ["not_an_action"] }] }
  }), /allowedActions/);
  assert.throws(() => assertWeeklyReportJob({
    ...job,
    manualReview: { ...review, items: [review.items[0], { ...review.items[0] }] }
  }), /item IDs must be unique/);
  assert.throws(() => assertWeeklyReportJob({
    ...job,
    manualReview: { ...review, resumeStage: "" }
  }), /resumeStage/);
  assert.throws(() => assertWeeklyReportJob({
    ...job,
    manualReview: {
      ...review,
      items: [{ ...review.items[0], scoreSnapshot: { finalScore: "unknown", threshold: 70 } }]
    }
  }), /finite finalScore/);
  assert.throws(() => assertWeeklyReportJob({
    ...job,
    manualReview: {
      ...review,
      items: [{
        ...review.items[0],
        gateStatus: { ...review.items[0].gateStatus, evidence: "failed" }
      }]
    }
  }), /credibility gate/);
  assert.doesNotThrow(() => assertWeeklyReportJob({
    ...job,
    manualReview: {
      stage: "paper_semantic_qa",
      requestedAt: "2026-09-08T00:00:00.000Z",
      paperId: "2609.02517",
      issues: [],
      repairAttempts: 3,
      allowedActions: ["continue_repair", "skip_paper", "exit_task"]
    }
  }));
});

test("Job Schema keeps bounded administrator decision receipts", () => {
  const job = createWeeklyReportJob({
    jobId: "weekly-report-job-receipts",
    traceId: "weekly-report-trace-receipts",
    reportKey: "2026-W37",
    now: "2026-09-08T00:00:00.000Z"
  });
  const receipt = {
    decisionId: "0b1d9743-4adc-4faf-a408-43635d62b35b",
    itemId: "selection-2609.02516",
    action: "include_below_threshold",
    decidedAt: "2026-09-08T00:01:00.000Z"
  };

  assert.deepEqual(job.adminDecisionReceipts, []);
  assert.doesNotThrow(() => assertWeeklyReportJob({
    ...job,
    adminDecisionReceipts: [receipt]
  }));
  assert.throws(() => assertWeeklyReportJob({
    ...job,
    adminDecisionReceipts: Array.from({ length: 51 }, () => receipt)
  }), /adminDecisionReceipts/);
  assert.throws(() => assertWeeklyReportJob({
    ...job,
    adminDecisionReceipts: [{ ...receipt, action: "forged_action" }]
  }), /adminDecisionReceipts entry/);
});
