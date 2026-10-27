import assert from "node:assert/strict";
import test from "node:test";
import {
  ReportSemanticQaError,
  reviewReportSemantics
} from "../weekly-report/report-semantic-qa-agent.js";
import {
  buildReportSemanticQaPrompt,
  buildReportSemanticQaRepairPrompt
} from "../weekly-report/prompts.js";

const selectedItemFor = (paperId, rank) => ({
  paper: {
    id: paperId,
    title: `Trusted ${paperId}`,
    summary: "ABSTRACT_MUST_NOT_ENTER_REPORT_QA",
    analysis: { secret: "OLD_ANALYSIS_MUST_NOT_ENTER_REPORT_QA" }
  },
  contextPacket: {
    paperId,
    inputText: "FULL_ORIGINAL_TEXT_MUST_NOT_ENTER_REPORT_QA",
    inputSections: [{ text: "SOURCE_EXCERPT_MUST_NOT_ENTER_REPORT_QA" }]
  },
  evidenceCard: {
    paperId,
    method: { summary: "INTERNAL_EVIDENCE_CARD_MUST_NOT_ENTER_REPORT_QA" }
  },
  reviewResult: { paperId },
  selection: {
    selected: true,
    selectionReason: "threshold",
    thresholdMet: true,
    finalScore: 90 - rank,
    readingTier: rank === 1 ? "must_read" : "worth_reading",
    rank
  }
});

const paperDraftFor = (paperId, rank) => ({
  paperId,
  oneSentenceTakeaway: { text: `Takeaway ${paperId}`, evidenceRefs: ["method:0"] },
  limitationsAndConstraints: [
    { text: `Limitation A ${paperId}`, evidenceRefs: ["limitations:0"] },
    { text: `Limitation B ${paperId}`, evidenceRefs: ["limitations:1"] }
  ],
  readingValue: {
    whyWorthReading: { text: `Reading value ${paperId}`, evidenceRefs: ["method:0"] },
    recommendedFocus: { text: `Focus ${paperId}`, evidenceRefs: ["method:0"] },
    evidenceBoundary: { text: `Boundary ${paperId}`, evidenceRefs: ["limitations:0"] }
  },
  publicationMeta: {
    title: `Trusted ${paperId}`,
    finalScore: 90 - rank,
    readingTier: rank === 1 ? "must_read" : "worth_reading",
    rank
  }
});

const selectedItems = [
  selectedItemFor("2608.20001", 1),
  selectedItemFor("2608.20002", 2)
];
const paperDrafts = selectedItems.map((item, index) => paperDraftFor(item.paper.id, index + 1));
const editorialPlan = {
  coreTheme: "Pre-execution checks constrain autonomous actions.",
  titleAngle: "From autonomous execution to verifiable constraints",
  trends: [{
    claim: "Both papers move validation before autonomous execution.",
    supportingPaperIds: ["2608.20001", "2608.20002"],
    evidenceRefs: ["2608.20001:method:0", "2608.20002:method:0"],
    maturity: "developing",
    caveat: "Evaluation remains early."
  }],
  singlePaperObservations: [],
  readingOrder: [
    { paperId: "2608.20001", reason: "Read the stronger evidence first." },
    { paperId: "2608.20002", reason: "Then compare the complementary method." }
  ]
};
const headTailDraft = {
  titleAngle: "Verifiable constraints before autonomous execution",
  description: "A grounded comparison of pre-execution validation.",
  tags: ["autonomy", "validation"],
  reportIntroduction: "This week focuses on moving validation before autonomous execution.",
  trendJudgments: [{
    trendIndex: 0,
    title: "验证环节前移到自主执行之前",
    claim: "Across both papers, validation moves ahead of autonomous execution.",
    caveat: "The available evaluation remains early.",
    supportingPaperIds: ["2608.20001", "2608.20002"],
    evidenceRefs: ["2608.20001:method:0", "2608.20002:method:0"],
    maturity: "developing"
  }],
  singlePaperObservations: [],
  readingOrder: [
    { paperId: "2608.20001", reason: "Read the stronger evidence first." },
    { paperId: "2608.20002", reason: "Then compare the complementary method." }
  ],
  closingSummary: "Compare the validation mechanism before considering deployment transfer."
};
const report = {
  title: "论文周报 2026-08 第1周｜Verifiable constraints before autonomous execution",
  description: headTailDraft.description
};

const checks = (override = {}) => ({
  titleGrounded: true,
  introductionGrounded: true,
  trendsMultiPaperGrounded: true,
  observationsNotPromoted: true,
  readingOrderAligned: true,
  headTailIsolated: true,
  readerLanguageChinese: true,
  ...override
});

const passResponse = () => ({
  verdict: "pass",
  summary: "The report-level narrative is supported by the selected cohort.",
  checks: checks(),
  issues: []
});

test("Report Semantic QA prompt contains compact selected artifacts but no original or per-paper Evidence payload", () => {
  const prompt = buildReportSemanticQaPrompt({
    report,
    editorialPlan,
    headTailDraft,
    selectedItems,
    paperDrafts
  });
  const parsed = JSON.parse(prompt);
  const serialized = JSON.stringify(parsed);

  assert.equal(parsed.task, "weekly_report_report_semantic_qa");
  assert.equal(parsed.agentRole, "report_semantic_qa");
  assert.match(parsed.rules.join(" "), /copied from an editorial plan or review is still invalid/i);
  assert.match(parsed.rules.join(" "), /Simplified Chinese/i);
  assert.match(parsed.rules.join(" "), /metaphorical, personified, slogan-like/i);
  assert.equal(parsed.headTailDraft.trendJudgments[0].title, "验证环节前移到自主执行之前");
  assert.deepEqual(parsed.papers.map((paper) => paper.paperId), ["2608.20001", "2608.20002"]);
  assert.match(serialized, /Reading value 2608\.20001/);
  assert.doesNotMatch(serialized, /ABSTRACT_MUST_NOT_ENTER_REPORT_QA/);
  assert.doesNotMatch(serialized, /OLD_ANALYSIS_MUST_NOT_ENTER_REPORT_QA/);
  assert.doesNotMatch(serialized, /FULL_ORIGINAL_TEXT_MUST_NOT_ENTER_REPORT_QA/);
  assert.doesNotMatch(serialized, /SOURCE_EXCERPT_MUST_NOT_ENTER_REPORT_QA/);
  assert.doesNotMatch(serialized, /INTERNAL_EVIDENCE_CARD_MUST_NOT_ENTER_REPORT_QA/);
  assert.doesNotMatch(serialized, /selectionReason|thresholdMet/);
});

test("Report Semantic QA receives distinct validated mechanisms and results before judging a shared observation", () => {
  const cohort = [selectedItemFor("2610.18457", 1), selectedItemFor("2610.20780", 2)];
  const drafts = cohort.map((item, index) => paperDraftFor(item.paper.id, index + 1));
  drafts[0].methodFramework = { text: "Kairos 在隔离边界暂存文件效果，延迟到不可逆点裁决。", evidenceRefs: ["method:0"] };
  drafts[0].experimentsAndResults = { text: "AgentDojo 攻击成功率从 47.0% 降到 2.7%。", evidenceRefs: ["results:0"] };
  drafts[1].methodFramework = { text: "ARIA 在执行中检测轨迹并替换失败续写。", evidenceRefs: ["method:0"] };
  drafts[1].experimentsAndResults = { text: "受测任务中的修复成功率提高。", evidenceRefs: ["results:0"] };
  const proposed = structuredClone(headTailDraft);
  proposed.trendJudgments[0].claim = "两篇论文使用同一种延迟裁决机制。";
  proposed.trendJudgments[0].supportingPaperIds = cohort.map((item) => item.paper.id);

  const prompt = JSON.parse(buildReportSemanticQaPrompt({
    report,
    editorialPlan,
    headTailDraft: proposed,
    selectedItems: cohort,
    paperDrafts: drafts
  }));

  assert.match(prompt.papers[0].methodFramework, /隔离边界暂存文件效果/);
  assert.match(prompt.papers[0].experimentsAndResults, /47\.0% 降到 2\.7%/);
  assert.match(prompt.papers[1].methodFramework, /执行中检测轨迹并替换失败续写/);
  assert.match(prompt.rules.join(" "), /shared conclusion.*shared topic|shared topic.*shared conclusion/i);
  assert.match(prompt.rules.join(" "), /same mechanism/i);
});

test("Report Semantic QA passes a grounded report without consuming repair_once", async () => {
  const result = await reviewReportSemantics({
    report,
    editorialPlan,
    headTailDraft,
    selectedItems,
    paperDrafts,
    networkRetryDelayMs: 0,
    callModel: async () => passResponse()
  });

  assert.equal(result.qaResult.status, "passed");
  assert.equal(result.qaResult.repairTarget, null);
  assert.equal(result.responseRepairAttempted, false);
  assert.equal(result.calls.length, 1);
});

test("Report Semantic QA deterministically blocks English Head/Tail when zh-CN is required", async () => {
  const result = await reviewReportSemantics({
    report,
    editorialPlan,
    headTailDraft,
    selectedItems,
    paperDrafts,
    requiredLanguage: "zh-CN",
    networkRetryDelayMs: 0,
    callModel: async () => passResponse()
  });

  assert.equal(result.qaResult.status, "repair_required");
  assert.equal(result.qaResult.checks.readerLanguageChinese, false);
  assert.equal(result.qaResult.issues.some((issue) => issue.code === "reader_language_mismatch"), true);
});

test("Report Semantic QA includes trend titles in reader-language validation", async () => {
  const titleOnlyDraft = {
    ...headTailDraft,
    titleAngle: "",
    description: "",
    tags: [],
    reportIntroduction: "",
    trendJudgments: [{
      ...headTailDraft.trendJudgments[0],
      title: "自主系统正在把关键验证环节前移到实际动作执行之前",
      claim: "",
      caveat: ""
    }],
    readingOrder: headTailDraft.readingOrder.map((entry) => ({ ...entry, reason: "" })),
    closingSummary: ""
  };
  const result = await reviewReportSemantics({
    report: { title: "T", description: "D" },
    editorialPlan,
    headTailDraft: titleOnlyDraft,
    selectedItems,
    paperDrafts,
    requiredLanguage: "zh-CN",
    networkRetryDelayMs: 0,
    callModel: async () => passResponse()
  });

  assert.equal(result.qaResult.status, "passed");
  assert.equal(result.qaResult.checks.readerLanguageChinese, true);
});

test("a failed report check overrides a requested pass and targets head_tail only", async () => {
  const result = await reviewReportSemantics({
    report,
    editorialPlan,
    headTailDraft,
    selectedItems,
    paperDrafts,
    networkRetryDelayMs: 0,
    callModel: async () => ({
      ...passResponse(),
      checks: checks({ trendsMultiPaperGrounded: false }),
      issues: [{
        code: "trend_not_multi_paper",
        severity: "high",
        field: "trendJudgments[0]",
        claim: "A single-paper observation is presented as a weekly trend.",
        reason: "Only one selected paper supports the broader wording.",
        supportingPaperIds: ["2608.20001"]
      }]
    })
  });

  assert.equal(result.qaResult.status, "repair_required");
  assert.equal(result.qaResult.repairTarget, "head_tail");
  assert.equal(result.qaResult.issues[0].scope, "report");
  assert.equal(result.qaResult.issues[0].code, "trend_not_multi_paper");
});

test("invalid report QA output gets one schema repair without carrying prior raw output", async () => {
  const prompts = [];
  const result = await reviewReportSemantics({
    report,
    editorialPlan,
    headTailDraft,
    selectedItems,
    paperDrafts,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      prompts.push(JSON.parse(prompt));
      return prompts.length === 1 ? { verdict: "pass" } : passResponse();
    }
  });

  assert.equal(result.qaResult.status, "passed");
  assert.equal(result.responseRepairAttempted, true);
  assert.equal(prompts[1].task, "weekly_report_report_semantic_qa_response_repair");
  assert.equal("priorResponse" in prompts[1], false);
  assert.equal(prompts[1].issues.every((issue) => Object.keys(issue).every((key) => ["code", "path"].includes(key))), true);
});

test("a second invalid report QA response fails closed", async () => {
  await assert.rejects(
    () => reviewReportSemantics({
      report,
      editorialPlan,
      headTailDraft,
      selectedItems,
      paperDrafts,
      networkRetryDelayMs: 0,
      callModel: async () => ({ verdict: "pass" })
    }),
    (error) => error instanceof ReportSemanticQaError
      && error.code === "READING_LIST_REPORT_QA_FAILED"
      && error.stage === "report_semantic_qa"
  );
});

test("Report Semantic QA repair prompt carries validation classes only", () => {
  const parsed = JSON.parse(buildReportSemanticQaRepairPrompt({
    report,
    editorialPlan,
    headTailDraft,
    selectedItems,
    paperDrafts,
    issues: [{ code: "checks_required", path: "checks", message: "SECRET_DETAIL" }]
  }));
  assert.deepEqual(parsed.issues, [{ code: "checks_required", path: "checks" }]);
  assert.doesNotMatch(JSON.stringify(parsed), /SECRET_DETAIL/);
});
