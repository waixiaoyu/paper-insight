import assert from "node:assert/strict";
import test from "node:test";
import {
  weeklyReportManualReviewInFlightView,
  weeklyReportManualReviewPresentationKey,
  weeklyReportManualReviewView
} from "../public/manual-review-view.js";

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

test("paper-section review explains the exact mismatch and distinguishes using the draft from excluding the paper", () => {
  const issueKey = "numeric_evidence|2609.08482|experimentsAndResults|37.5|1";
  const view = weeklyReportManualReviewView({
    stage: "write_paper_sections",
    activeItemId: "paper-section-2609.08482",
    items: [{
      itemId: "paper-section-2609.08482",
      paperId: "2609.08482",
      kind: "evidence_dispute",
      scope: "paper",
      sourceStage: "write_paper_sections",
      summary: "逐篇稿件有一处数字表达需要核对。",
      issues: [{
        code: "unsupported_exact_number",
        path: "experimentsAndResults",
        reason: "Exact number 37.5% is not supported by bound Evidence.",
        triggerText: "在模拟故障场景中，不安全动作减少了 37.5%。",
        evidenceRefs: ["results:0"]
      }],
      evidenceReviews: [{
        issueKey,
        paperId: "2609.08482",
        fieldPath: "experimentsAndResults",
        fieldLabel: "实验与结果",
        draftExcerpt: "在模拟故障场景中，不安全动作减少了 37.5%。",
        evidenceSources: [{ ref: "results:0", section: "4 Results", excerpt: "Unsafe actions are reduced by 37%." }]
      }],
      approvableIssueKeys: [issueKey],
      allowedActions: ["confirm_evidence", "continue_repair", "skip_paper", "exit_task"]
    }]
  });

  assert.match(view.title, /当前稿件需要人工复核/u);
  assert.equal(view.evidenceReviews.length, 1);
  assert.match(view.evidenceReviews[0].draftExcerpt, /37\.5%/u);
  assert.match(view.evidenceReviews[0].evidenceSources[0].excerpt, /37%/u);
  assert.equal(view.actions.find((action) => action.action === "confirm_evidence").label, "保留这一处表述");
  assert.match(view.actions.find((action) => action.action === "confirm_evidence").effect, /只确认当前这一处/u);
  assert.match(view.actions.find((action) => action.action === "skip_paper").label, /从本期周报移除/u);
});

test("manual review presentation key changes for the next issue and for a repeated repair attempt", () => {
  const first = {
    jobId: "weekly-report-job-1",
    manualReview: {
      requestedAt: "2026-09-15T10:00:00.000Z",
      activeItemId: "write_paper_sections:2609.00049:1:1"
    }
  };
  const nextIssue = {
    ...first,
    manualReview: {
      ...first.manualReview,
      activeItemId: "write_paper_sections:2609.00049:1:2"
    }
  };
  const repeatedAfterRepair = {
    ...first,
    manualReview: {
      ...first.manualReview,
      requestedAt: "2026-09-15T10:02:00.000Z"
    }
  };

  assert.notEqual(
    weeklyReportManualReviewPresentationKey(first),
    weeklyReportManualReviewPresentationKey(nextIssue)
  );
  assert.notEqual(
    weeklyReportManualReviewPresentationKey(first),
    weeklyReportManualReviewPresentationKey(repeatedAfterRepair)
  );
});

test("a targeted repair keeps the selected issue visible without offering another decision", () => {
  const selectedItem = reviewQueue.items[1];
  const inFlight = weeklyReportManualReviewInFlightView({
    jobId: "weekly-report-job-1",
    decisionId: "decision-1",
    selectedItem,
    startedAt: "2026-09-15T13:04:00.000Z"
  });

  assert.match(inFlight.title, /正在定向修正论文 2609\.04002/u);
  assert.match(inFlight.summary, /只修改当前这一项/u);
  assert.equal(inFlight.review.activeItemId, selectedItem.itemId);
  assert.equal(inFlight.review.items.length, 1);
  assert.deepEqual(inFlight.review.items[0].allowedActions, []);
  assert.equal(inFlight.review.items[0].evidenceReviews[0].draftExcerpt, "系统在全部场景中优于基线。");
  assert.match(inFlight.presentationKey, /decision-1/u);
});

test("confirming one evidence issue keeps that exact issue visible while the task continues", () => {
  const selectedItem = reviewQueue.items[1];
  const inFlight = weeklyReportManualReviewInFlightView({
    jobId: "weekly-report-job-1",
    decisionId: "decision-confirm-1",
    action: "confirm_evidence",
    selectedItem,
    startedAt: "2026-09-15T13:10:43.000Z"
  });

  assert.equal(inFlight.eyebrow, "正在应用人工确认");
  assert.match(inFlight.title, /正在保留论文 2609\.04002 的当前这一处表述/u);
  assert.match(inFlight.summary, /不会同时确认其他问题/u);
  assert.equal(inFlight.review.items[0].evidenceReviews[0].draftExcerpt, "系统在全部场景中优于基线。");
  assert.deepEqual(inFlight.review.items[0].allowedActions, []);
});
