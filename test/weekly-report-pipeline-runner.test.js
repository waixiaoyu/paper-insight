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

test("Pipeline Runner waits for an administrator after repair exhaustion and grants one additional repair", async () => {
  const calls = [];
  const decisions = ["continue_repair", "exit_task"];
  const reviews = [];
  const context = {
    ...executionContext(),
    requestManualReview: async (review) => {
      reviews.push(review);
      return { action: decisions.shift() };
    }
  };
  const steps = {
    prepare: transition("prepare", "manual_review", calls, {
      markdown: "# Inspectable draft",
      qaReport: {
        status: "rejected",
        repairAttempted: true,
        repairCount: 3,
        paperIssues: [{ paperId: "2608.50002", repairTarget: "paper_section", repairable: true }]
      },
      manualReview: {
        stage: "paper_semantic_qa",
        paperId: "2608.50002",
        issues: [{ code: "unsupported_fact" }],
        repairAttempts: 3,
        allowedActions: ["continue_repair", "exit_task", "skip_paper"]
      }
    }),
    repair: transition("repair_once", "manual_review", calls, {
      qaReport: { status: "rejected", repairAttempted: true, repairCount: 4 },
      manualReview: {
        stage: "paper_semantic_qa",
        paperId: "2608.50002",
        issues: [{ code: "unsupported_fact" }],
        repairAttempts: 4,
        allowedActions: ["continue_repair", "exit_task", "skip_paper"]
      }
    })
  };

  const result = await runWeeklyReportAgentLoop({}, context, {
    buildContext: async () => ({}),
    callModel: async () => ({}),
    steps
  });

  assert.deepEqual(calls, ["prepare", "repair_once"]);
  assert.equal(reviews.length, 2);
  assert.equal(reviews[0].repairAttempts, 3);
  assert.equal(result.state, "reject");
  assert.equal(result.reason, "admin_rejected");
  assert.equal(result.markdown, "# Inspectable draft");
});

test("Pipeline Runner forwards every pending manual-review backlog item as one queue", async () => {
  let requestedReview = null;
  const context = {
    ...executionContext(),
    requestManualReview: async (review) => {
      requestedReview = review;
      return { action: "exit_task", itemId: "evidence-2609.03001" };
    }
  };
  const steps = {
    prepare: transition("prepare", "manual_review", [], {
      manualReviewBacklog: [{
        itemId: "evidence-2609.03001",
        paperId: "2609.03001",
        kind: "processing_failure",
        scope: "paper",
        sourceStage: "extract_evidence",
        summary: "Evidence 调用未完成。",
        allowedActions: ["retry_paper", "exit_task"]
      }, {
        itemId: "selection-2609.03002",
        paperId: "2609.03002",
        kind: "quality_below_threshold",
        scope: "paper",
        sourceStage: "select",
        summary: "实际 67 分，低于 70 分。",
        scoreSnapshot: { finalScore: 67, threshold: 70 },
        gateStatus: { fullText: "passed", identity: "passed", evidence: "passed", crossPaper: "passed" },
        allowedActions: ["include_below_threshold", "keep_excluded", "exit_task"]
      }]
    })
  };

  const result = await runWeeklyReportAgentLoop(
    { reportKey: "2026-W37" },
    context,
    { buildContext: async () => ({}), callModel: async () => ({}), steps }
  );

  assert.equal(result.state, "reject");
  assert.equal(requestedReview.items.length, 2);
  assert.equal(requestedReview.activeItemId, "evidence-2609.03001");
});

test("Pipeline Runner returns an audited manual inclusion to Selection", async () => {
  let selectionInput = null;
  const context = {
    ...executionContext(),
    requestManualReview: async () => ({
      action: "include_below_threshold",
      itemId: "selection-2609.03002",
      reason: "论文证据门已通过，并直接补足本期主题。",
      decisionId: "154ff336-5cc4-4c6e-ac0d-a7802ca711ec",
      decidedAt: "2026-09-08T01:00:00.000Z"
    })
  };
  const steps = {
    prepare: transition("prepare", "manual_review", [], {
      manualReviewBacklog: [{
        itemId: "selection-2609.03002",
        paperId: "2609.03002",
        kind: "quality_below_threshold",
        scope: "paper",
        sourceStage: "select",
        summary: "实际 67 分，低于 70 分。",
        scoreSnapshot: { finalScore: 67, threshold: 70 },
        gateStatus: { fullText: "passed", identity: "passed", evidence: "passed", crossPaper: "passed" },
        allowedActions: ["include_below_threshold", "keep_excluded", "exit_task"]
      }]
    }),
    select: async (value) => {
      selectionInput = value;
      return {
        ...value,
        nextStage: "publish",
        markdown: "# Included",
        qaReport: { status: "passed" }
      };
    }
  };

  const result = await runWeeklyReportAgentLoop(
    { reportKey: "2026-W37" },
    context,
    { buildContext: async () => ({}), callModel: async () => ({}), steps }
  );

  assert.equal(result.state, "publish");
  assert.deepEqual(selectionInput.adminSelectionOverrides, [{
    paperId: "2609.03002",
    reason: "论文证据门已通过，并直接补足本期主题。",
    decisionId: "154ff336-5cc4-4c6e-ac0d-a7802ca711ec",
    decidedAt: "2026-09-08T01:00:00.000Z"
  }]);
  assert.deepEqual(selectionInput.manualReviewBacklog, []);
});

test("Pipeline Runner retries only the failed paper before continuing calibration", async () => {
  let evidenceInput = null;
  let reviewInput = null;
  let calibrationInput = null;
  const failedPaper = {
    contextPacket: { paperId: "2609.03003" },
    paper: { id: "2609.03003" }
  };
  const recoveredEvidence = {
    ...failedPaper,
    evidenceCard: { paperId: "2609.03003" }
  };
  const recoveredReview = {
    ...recoveredEvidence,
    reviewResult: { paperId: "2609.03003", rawScore: 76 }
  };
  const alreadyReviewed = {
    contextPacket: { paperId: "2609.03004" },
    paper: { id: "2609.03004" },
    evidenceCard: { paperId: "2609.03004" },
    reviewResult: { paperId: "2609.03004", rawScore: 82 }
  };
  const context = {
    ...executionContext(),
    requestManualReview: async () => ({
      action: "retry_paper",
      itemId: "evidence-2609.03003"
    })
  };
  const steps = {
    prepare: transition("prepare", "manual_review", [], {
      evidenceItems: [{
        contextPacket: { paperId: "2609.03004" },
        paper: { id: "2609.03004" },
        evidenceCard: { paperId: "2609.03004" }
      }],
      reviewItems: [alreadyReviewed],
      evidenceResult: { processingFailed: [failedPaper] },
      manualReviewBacklog: [{
        itemId: "evidence-2609.03003",
        paperId: "2609.03003",
        kind: "processing_failure",
        scope: "paper",
        sourceStage: "extract_evidence",
        summary: "Evidence 调用未完成。",
        allowedActions: ["retry_paper", "skip_paper", "exit_task"]
      }]
    }),
    evidence: async (value) => {
      evidenceInput = value;
      return { ...value, nextStage: "review", evidenceItems: [recoveredEvidence] };
    },
    review: async (value) => {
      reviewInput = value;
      return { ...value, nextStage: "calibrate", reviewItems: [recoveredReview] };
    },
    calibrate: async (value) => {
      calibrationInput = value;
      return { ...value, nextStage: "publish", markdown: "# Recovered", qaReport: { status: "passed" } };
    }
  };

  const result = await runWeeklyReportAgentLoop(
    { reportKey: "2026-W37" },
    context,
    { buildContext: async () => ({}), callModel: async () => ({}), steps }
  );

  assert.deepEqual(evidenceInput.contextResult.eligible, [failedPaper]);
  assert.deepEqual(reviewInput.evidenceItems, [recoveredEvidence]);
  assert.deepEqual(calibrationInput.reviewItems, [alreadyReviewed, recoveredReview]);
  assert.equal(result.state, "publish");
});

test("Pipeline Runner retries calibration from preserved Review artifacts", async () => {
  let calibrationInput = null;
  const reviewedItem = {
    contextPacket: { paperId: "2609.03005" },
    paper: { id: "2609.03005" },
    reviewResult: { paperId: "2609.03005", rawScore: 81 }
  };
  const context = {
    ...executionContext(),
    requestManualReview: async () => ({
      action: "retry_stage",
      itemId: "calibrate-job-failure"
    })
  };
  const steps = {
    prepare: transition("prepare", "manual_review", [], {
      reviewItems: [reviewedItem],
      manualReviewBacklog: [{
        itemId: "calibrate-job-failure",
        paperId: "",
        kind: "processing_failure",
        scope: "job",
        sourceStage: "calibrate",
        summary: "横向校准调用未完成。",
        allowedActions: ["retry_stage", "exit_task"]
      }]
    }),
    calibrate: async (value) => {
      calibrationInput = value;
      return { ...value, nextStage: "publish", markdown: "# Calibrated", qaReport: { status: "passed" } };
    }
  };

  const result = await runWeeklyReportAgentLoop(
    { reportKey: "2026-W37" }, context,
    { buildContext: async () => ({}), callModel: async () => ({}), steps }
  );

  assert.deepEqual(calibrationInput.reviewItems, [reviewedItem]);
  assert.deepEqual(calibrationInput.manualReviewBacklog, []);
  assert.equal(result.state, "publish");
});

test("Pipeline Runner keeps a selected low-score paper excluded without removing other items", async () => {
  let calibrationInput = null;
  const context = {
    ...executionContext(),
    requestManualReview: async () => ({
      action: "keep_excluded",
      itemId: "selection-2609.03006"
    })
  };
  const remainingItem = {
    itemId: "evidence-2609.03007",
    paperId: "2609.03007",
    kind: "processing_failure",
    scope: "paper",
    sourceStage: "review",
    summary: "Review 调用未完成。",
    allowedActions: ["retry_paper", "skip_paper", "exit_task"]
  };
  const steps = {
    prepare: transition("prepare", "manual_review", [], {
      reviewItems: [],
      manualReviewBacklog: [{
        itemId: "selection-2609.03006",
        paperId: "2609.03006",
        kind: "quality_below_threshold",
        scope: "paper",
        sourceStage: "select",
        summary: "实际 67 分，低于 70 分。",
        scoreSnapshot: { finalScore: 67, threshold: 70 },
        gateStatus: { fullText: "passed", identity: "passed", evidence: "passed", crossPaper: "passed" },
        allowedActions: ["include_below_threshold", "keep_excluded", "exit_task"]
      }, remainingItem]
    }),
    calibrate: async (value) => {
      calibrationInput = value;
      return { ...value, nextStage: "publish", markdown: "# Excluded", qaReport: { status: "passed" } };
    }
  };

  const result = await runWeeklyReportAgentLoop(
    { reportKey: "2026-W37" }, context,
    { buildContext: async () => ({}), callModel: async () => ({}), steps }
  );

  assert.deepEqual(calibrationInput.manualExcludedPaperIds, ["2609.03006"]);
  assert.deepEqual(calibrationInput.manualReviewBacklog, [remainingItem]);
  assert.equal(result.state, "publish");
});

test("Pipeline Runner routes a paper writer decision back to the failed paper", async () => {
  let retryInput;
  const context = {
    ...executionContext(),
    requestManualReview: async () => ({ action: "continue_repair" })
  };
  const steps = {
    prepare: async () => ({
      nextStage: "manual_review",
      paperDrafts: [{ paperId: "2608.51001" }],
      manualReview: {
        stage: "write_paper_sections",
        paperId: "2608.51002",
        issues: [{
          code: "READING_LIST_PAPER_SECTION_UNSUPPORTED",
          details: [{ code: "numeric_claim_not_in_evidence", path: "oneSentenceTakeaway.text" }]
        }],
        repairAttempts: 1,
        allowedActions: ["continue_repair", "exit_task", "skip_paper"]
      }
    }),
    paperSections: async (value) => {
      retryInput = value;
      return {
        ...value,
        nextStage: "publish",
        markdown: "# Repaired weekly report",
        qaReport: { status: "passed" }
      };
    }
  };

  const result = await runWeeklyReportAgentLoop({ reportKey: "2026-W35" }, context, {
    buildContext: async () => ({}),
    callModel: async () => ({}),
    steps
  });

  assert.equal(result.state, "publish");
  assert.equal(retryInput.nextStage, "write_paper_sections");
  assert.equal(retryInput.paperSectionRetry.paperId, "2608.51002");
  assert.deepEqual(retryInput.paperSectionRetry.issues, [
    { code: "numeric_claim_not_in_evidence", path: "oneSentenceTakeaway.text" }
  ]);
  assert.equal(retryInput.paperSectionRetry.attempt, 1);
  assert.equal(retryInput.paperSectionRepairAttempts["2608.51002"], 2);
  assert.deepEqual(retryInput.paperDrafts, [{ paperId: "2608.51001" }]);
});

test("Pipeline Runner restarts calibration after an administrator skips one paper", async () => {
  const calls = [];
  let calibrationInput;
  const context = {
    ...executionContext(),
    requestManualReview: async () => ({ action: "skip_paper" })
  };
  const steps = {
    prepare: transition("prepare", "manual_review", calls, {
      manualReview: {
        stage: "paper_semantic_qa",
        paperId: "2608.50003",
        issues: [{ code: "unsupported_fact" }],
        repairAttempts: 3,
        allowedActions: ["continue_repair", "exit_task", "skip_paper"]
      }
    }),
    calibrate: async (value) => {
      calls.push("calibrate");
      calibrationInput = value;
      return { ...value, nextStage: "select" };
    },
    select: transition("select", "editorial_plan", calls),
    editorialPlan: transition("editorial_plan", "write_paper_sections", calls),
    paperSections: transition("write_paper_sections", "write_head_tail", calls),
    headTail: transition("write_head_tail", "assemble", calls),
    assemble: transition("assemble", "deterministic_qa", calls, { markdown: "# Rebuilt" }),
    deterministicQa: transition("deterministic_qa", "paper_semantic_qa", calls, { qaReport: { status: "passed" } }),
    paperSemanticQa: transition("paper_semantic_qa", "report_semantic_qa", calls, { qaReport: { status: "passed" } }),
    reportSemanticQa: transition("report_semantic_qa", "publish", calls, { qaReport: { status: "passed" } })
  };

  const result = await runWeeklyReportAgentLoop({}, context, {
    buildContext: async () => ({}),
    callModel: async () => ({}),
    steps
  });

  assert.deepEqual(calibrationInput.manualExcludedPaperIds, ["2608.50003"]);
  assert.equal(result.state, "publish");
  assert.equal(result.markdown, "# Rebuilt");
});

test("Pipeline Runner records one evidence approval and rechecks deterministic QA", async () => {
  const calls = [];
  let recheckInput;
  const evidenceReview = {
    issueKey: "unsupported_exact_number|2608.50004|experimentsAndResults|37.5%",
    paperId: "2608.50004",
    fieldPath: "experimentsAndResults",
    draftExcerpt: "危险动作比例降低了 37.5%。",
    evidenceSources: [{
      ref: "results:0",
      section: "4 Results",
      anchor: "S4",
      excerpt: "Unsafe actions are reduced by 37%."
    }]
  };
  const unconfirmedReview = {
    ...evidenceReview,
    issueKey: "unsupported_exact_number|2608.50004|experimentsAndResults|88%",
    draftExcerpt: "另一个结论声称成功率为 88%。"
  };
  const context = {
    ...executionContext(),
    requestManualReview: async () => ({
      action: "confirm_evidence",
      approvedIssueKeys: [evidenceReview.issueKey],
      evidenceReviews: [evidenceReview],
      decidedAt: "2026-09-07T03:00:00.000Z"
    })
  };
  const steps = {
    prepare: transition("prepare", "manual_review", calls, {
      markdown: "# Inspectable draft",
      qaReport: { status: "rejected", repairAttempted: true, repairCount: 3 },
      manualReview: {
        stage: "deterministic_qa",
        paperId: "2608.50004",
        issues: [{ code: "unsupported_exact_number" }],
        evidenceReviews: [evidenceReview, unconfirmedReview],
        approvableIssueKeys: [evidenceReview.issueKey, unconfirmedReview.issueKey],
        repairAttempts: 3,
        allowedActions: ["confirm_evidence", "continue_repair", "exit_task", "skip_paper"]
      }
    }),
    deterministicQa: async (value) => {
      calls.push("deterministic_qa");
      recheckInput = value;
      return { ...value, nextStage: "paper_semantic_qa", qaReport: { status: "passed" } };
    },
    paperSemanticQa: transition("paper_semantic_qa", "report_semantic_qa", calls, { qaReport: { status: "passed" } }),
    reportSemanticQa: transition("report_semantic_qa", "publish", calls, { qaReport: { status: "passed" } })
  };

  const result = await runWeeklyReportAgentLoop({}, context, {
    buildContext: async () => ({}),
    callModel: async () => ({}),
    steps
  });

  assert.deepEqual(calls, ["prepare", "deterministic_qa", "paper_semantic_qa", "report_semantic_qa"]);
  assert.equal(result.state, "publish");
  assert.deepEqual(recheckInput.manualEvidenceApprovals, [{
    issueKey: evidenceReview.issueKey,
    paperId: evidenceReview.paperId,
    fieldPath: evidenceReview.fieldPath,
    draftExcerpt: evidenceReview.draftExcerpt,
    evidenceSources: evidenceReview.evidenceSources,
    decidedAt: "2026-09-07T03:00:00.000Z"
  }]);
});

test("Pipeline Runner returns a semantic evidence approval to paper semantic QA", async () => {
  const calls = [];
  const issueKey = "unsupported_fact|2608.50005|coreContribution|all datasets";
  const context = {
    ...executionContext(),
    requestManualReview: async () => ({
      action: "confirm_evidence",
      approvedIssueKeys: [issueKey],
      evidenceReviews: [{
        issueKey,
        paperId: "2608.50005",
        fieldPath: "coreContribution",
        draftExcerpt: "该方法在所有数据集上都优于基线。",
        evidenceSources: [{ ref: "results:0", excerpt: "The method improves one benchmark." }]
      }],
      decidedAt: "2026-09-07T03:10:00.000Z"
    })
  };
  const steps = {
    prepare: transition("prepare", "manual_review", calls, {
      markdown: "# Inspectable draft",
      qaReport: { status: "rejected", repairAttempted: true, repairCount: 3 },
      manualReview: {
        stage: "paper_semantic_qa",
        paperId: "2608.50005",
        issues: [{ code: "unsupported_fact" }],
        evidenceReviews: [{
          issueKey,
          paperId: "2608.50005",
          fieldPath: "coreContribution",
          draftExcerpt: "该方法在所有数据集上都优于基线。",
          evidenceSources: [{ ref: "results:0", excerpt: "The method improves one benchmark." }]
        }],
        approvableIssueKeys: [issueKey],
        repairAttempts: 3,
        allowedActions: ["confirm_evidence", "continue_repair", "exit_task", "skip_paper"]
      }
    }),
    deterministicQa: async () => {
      throw new Error("evidence approval returned to the wrong QA stage");
    },
    paperSemanticQa: transition("paper_semantic_qa", "report_semantic_qa", calls, { qaReport: { status: "passed" } }),
    reportSemanticQa: transition("report_semantic_qa", "publish", calls, { qaReport: { status: "passed" } })
  };

  const result = await runWeeklyReportAgentLoop({}, context, {
    buildContext: async () => ({}),
    callModel: async () => ({}),
    steps
  });

  assert.deepEqual(calls, ["prepare", "paper_semantic_qa", "report_semantic_qa"]);
  assert.equal(result.state, "publish");
});
