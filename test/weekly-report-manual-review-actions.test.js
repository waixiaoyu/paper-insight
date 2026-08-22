import assert from "node:assert/strict";
import test from "node:test";
import { submitWeeklyReportManualReviewDecision } from "../public/manual-review-actions.js";

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
