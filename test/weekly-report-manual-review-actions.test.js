import assert from "node:assert/strict";
import test from "node:test";
import {
  manualReviewDecisionStatusText,
  submitWeeklyReportManualReviewDecision
} from "../public/manual-review-actions.js";

test("manual review decision re-enables administrator controls after a network failure", async () => {
  const pendingStates = [];

  const result = await submitWeeklyReportManualReviewDecision({
    requestDecision: async () => {
      throw new Error("network unavailable");
    },
    refreshJob: async () => {
      throw new Error("network unavailable");
    },
    setPending: (pending) => pendingStates.push(pending)
  });

  assert.equal(result.job, null);
  assert.match(result.error.message, /network unavailable/);
  assert.deepEqual(pendingStates, [true, false]);
});

test("manual review decision returns the refreshed active task after a failed submission", async () => {
  const activeJob = { jobId: "weekly-report-job-1", state: "running" };

  const result = await submitWeeklyReportManualReviewDecision({
    requestDecision: async () => {
      throw new Error("request interrupted");
    },
    refreshJob: async () => activeJob,
    setPending: () => {}
  });

  assert.equal(result.job, activeJob);
  assert.match(result.error.message, /request interrupted/);
});

test("manual review decision reports acceptance before any later Trace refresh", async () => {
  const accepted = [];
  const job = { jobId: "weekly-report-job-accepted", state: "running" };

  const result = await submitWeeklyReportManualReviewDecision({
    requestDecision: async () => job,
    onAccepted: (received) => accepted.push(received),
    setPending: () => {}
  });

  assert.equal(result.error, null);
  assert.deepEqual(accepted, [job]);
});

test("exit-task decision is not described as continued execution", () => {
  assert.equal(
    manualReviewDecisionStatusText("exit_task", { state: "running" }),
    "管理员决策已提交：退出任务。任务已退出。"
  );
  assert.equal(
    manualReviewDecisionStatusText("skip_paper", { state: "running" }),
    "管理员决策已提交：跳过这篇论文。任务已继续执行。"
  );
});
