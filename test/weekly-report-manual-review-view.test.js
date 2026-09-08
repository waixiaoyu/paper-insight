import assert from "node:assert/strict";
import test from "node:test";
import { weeklyReportManualReviewView } from "../public/manual-review-view.js";

const reviewQueue = {
  stage: "select",
  activeItemId: "processing-2609.04001",
  items: [{
    itemId: "processing-2609.04001",
    paperId: "2609.04001",
    kind: "processing_failure",
    scope: "paper",
    sourceStage: "extract_evidence",
    summary: "Evidence 调用未完成，未将该论文视为质量不足。",
    details: [{ title: "实际失败", text: "模型响应超时。" }],
    allowedActions: ["retry_paper", "skip_paper", "exit_task"]
  }, {
    itemId: "evidence-2609.04002",
    paperId: "2609.04002",
    kind: "evidence_dispute",
    scope: "paper",
    sourceStage: "paper_semantic_qa",
    summary: "稿件中的实验结论需要核对原文证据。",
    evidenceReviews: [{
      issueKey: "unsupported_fact|2609.04002|experimentsAndResults",
      paperId: "2609.04002",
      fieldPath: "experimentsAndResults",
      fieldLabel: "实验与结果",
      draftExcerpt: "系统在全部场景中优于基线。",
      evidenceSources: [{ section: "4 Results", anchor: "S12", excerpt: "结果仅覆盖两个评测场景。" }]
    }],
    approvableIssueKeys: ["unsupported_fact|2609.04002|experimentsAndResults"],
    allowedActions: ["confirm_evidence", "continue_repair", "skip_paper", "exit_task"]
  }, {
    itemId: "selection-2609.04003",
    paperId: "2609.04003",
    kind: "quality_below_threshold",
    scope: "paper",
    sourceStage: "select",
    summary: "横向校准后为 67 分，低于 70 分默认入选线。",
    scoreSnapshot: {
      finalScore: 67,
      threshold: 70,
      dimensions: { scenarioProblemValue: 70, methodNovelty: 66, practicalValue: 63, evidence: 73 },
      comparisonReason: "与本期候选相比，应用场景较窄。"
    },
    gateStatus: { fullText: "passed", identity: "passed", evidence: "passed", crossPaper: "passed" },
    allowedActions: ["include_below_threshold", "keep_excluded", "exit_task"]
  }]
};

test("manual review view labels all queue kinds in Chinese without treating processing failure as low quality", () => {
  const view = weeklyReportManualReviewView(reviewQueue);

  assert.deepEqual(view.items.map((item) => item.typeLabel), ["系统处理失败", "证据争议", "质量与分数不足"]);
  assert.match(view.items[0].summary, /未将该论文视为质量不足/);
  assert.equal(view.activeItem.itemId, "processing-2609.04001");
  assert.match(view.actions.find((action) => action.action === "retry_paper").effect, /只重试论文 2609\.04001/);
});

test("manual review view exposes local evidence comparison for the selected evidence dispute", () => {
  const view = weeklyReportManualReviewView(reviewQueue, "evidence-2609.04002");

  assert.equal(view.activeItem.paperId, "2609.04002");
  assert.equal(view.evidenceReviews.length, 1);
  assert.equal(view.evidenceReviews[0].draftExcerpt, "系统在全部场景中优于基线。");
  assert.equal(view.evidenceReviews[0].evidenceSources[0].section, "4 Results");
  assert.deepEqual(view.actions.map((action) => action.action), ["confirm_evidence", "continue_repair", "skip_paper", "exit_task"]);
});

test("manual review view exposes score and credibility gates for below-threshold inclusion", () => {
  const view = weeklyReportManualReviewView(reviewQueue, "selection-2609.04003");

  assert.equal(view.requiresReason, true);
  assert.deepEqual(view.scoreRows.map((row) => row.label), [
    "最终分数", "默认入选线", "研究问题价值", "方法新意", "系统价值", "证据强度", "横向比较说明"
  ]);
  assert.deepEqual(view.gateRows.map((row) => [row.label, row.status]), [
    ["全文", "通过"], ["身份一致", "通过"], ["证据", "通过"], ["跨论文隔离", "通过"], ["敏感信息", "未记录"]
  ]);
  assert.deepEqual(view.actions.map((action) => action.action), ["include_below_threshold", "keep_excluded", "exit_task"]);
});
