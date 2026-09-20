import assert from "node:assert/strict";
import test from "node:test";
import {
  MANUAL_REVIEW_ACTIONS,
  MANUAL_REVIEW_KINDS,
  manualReviewItem,
  normalizeManualReviewRequest,
  withoutManualReviewItem
} from "../weekly-report/manual-review.js";

test("unified manual-review queue normalizes all three review kinds", () => {
  const queue = normalizeManualReviewRequest({
    stage: "select",
    resumeStage: "select",
    items: [
      {
        itemId: "evidence-2609.02514",
        paperId: "2609.02514",
        relatedPaperIds: ["2609.02514", "2609.02514"],
        kind: "processing_failure",
        scope: "paper",
        sourceStage: "extract_evidence",
        summary: "Evidence 响应格式恢复后仍不可用。",
        details: [{
          text: "模型返回的外层字段不符合契约。",
          diagnosticReason: "最后一次模型返回缺少完整的证据卡对象。",
          responseExcerpt: "{\"evidenceCard\":"
        }],
        allowedActions: ["retry_paper", "retry_paper", "exit_task"]
      },
      {
        itemId: "dispute-2609.02515",
        paperId: "2609.02515",
        kind: "evidence_dispute",
        scope: "paper",
        sourceStage: "paper_semantic_qa",
        summary: "结果表述与已绑定原文摘录存在差异。",
        evidenceReviews: [{
          issueKey: "supported-claim|2609.02515|results|1",
          paperId: "2609.02515",
          fieldPath: "experimentsAndResults",
          fieldLabel: "实验与结果",
          reviewContext: "evidence_extraction",
          draftExcerpt: "正文片段",
          evidenceSources: [{ ref: "results:0", section: "Results", anchor: "S4", excerpt: "原文摘录" }]
        }],
        approvableIssueKeys: ["supported-claim|2609.02515|results|1"],
        allowedActions: ["confirm_evidence", "skip_paper", "exit_task"]
      },
      {
        itemId: "selection-2609.02516",
        paperId: "2609.02516",
        kind: "quality_below_threshold",
        scope: "paper",
        sourceStage: "select",
        summary: "横向校准后为 67 分，低于 70 分入选线。",
        scoreSnapshot: { finalScore: 67, threshold: 70, dimensions: { evidence: 68 } },
        gateStatus: { fullText: "passed", identity: "passed", evidence: "passed", crossPaper: "passed" },
        allowedActions: ["include_below_threshold", "keep_excluded", "exit_task"]
      }
    ]
  }, { requestedAt: "2026-09-08T00:00:00.000Z" });

  assert.deepEqual(MANUAL_REVIEW_KINDS, ["processing_failure", "evidence_dispute", "quality_below_threshold"]);
  assert.equal(MANUAL_REVIEW_ACTIONS.includes("retry_paper"), true);
  assert.equal(queue.status, "waiting_admin");
  assert.equal(queue.items.length, 3);
  assert.deepEqual(queue.items[0].relatedPaperIds, ["2609.02514"]);
  assert.deepEqual(queue.items[0].allowedActions, ["retry_paper", "exit_task"]);
  assert.deepEqual(queue.items[0].details[0], {
    title: "",
    requirement: "",
    actual: "",
    text: "模型返回的外层字段不符合契约。",
    path: "",
    code: "",
    diagnosticReason: "最后一次模型返回缺少完整的证据卡对象。",
    responseExcerpt: "{\"evidenceCard\":"
  });
  assert.equal(manualReviewItem(queue, "selection-2609.02516").scoreSnapshot.finalScore, 67);
  assert.equal(manualReviewItem(queue, "missing-item"), null);

  const remaining = withoutManualReviewItem(queue, "dispute-2609.02515");
  assert.deepEqual(remaining.items.map((item) => item.itemId), [
    "evidence-2609.02514",
    "selection-2609.02516"
  ]);
  assert.equal(remaining.activeItemId, "evidence-2609.02514");
});

test("legacy single-item manual review request is wrapped into a queue", () => {
  const queue = normalizeManualReviewRequest({
    stage: "paper_semantic_qa",
    paperId: "2609.02517",
    summary: "逐篇稿件需要管理员处理。",
    issues: [{ code: "unsupported_fact" }],
    repairAttempts: 3,
    allowedActions: ["continue_repair", "skip_paper", "exit_task"]
  }, { requestedAt: "2026-09-08T00:00:00.000Z" });

  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].kind, "evidence_dispute");
  assert.equal(queue.items[0].paperId, "2609.02517");
  assert.equal(queue.resumeStage, "paper_semantic_qa");
});

test("manual review keeps bounded trigger text and Evidence references for administrator diagnosis", () => {
  const queue = normalizeManualReviewRequest({
    stage: "editorial_plan",
    relatedPaperIds: ["2608.09312"],
    issues: [{
      code: "numeric_claim_not_in_evidence",
      path: "singlePaperObservations[0].claim",
      detail: "Exact number 100 does not occur in the cited Evidence.",
      triggerText: "该系统保持 100 微秒时限。",
      evidenceRefs: ["2608.09312:results:0"]
    }],
    allowedActions: ["confirm_evidence", "continue_repair", "exit_task"]
  });

  assert.equal(queue.items[0].issues[0].triggerText, "该系统保持 100 微秒时限。");
  assert.deepEqual(queue.items[0].issues[0].evidenceRefs, ["2608.09312:results:0"]);
});
