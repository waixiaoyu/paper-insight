import assert from "node:assert/strict";
import test from "node:test";
import {
  EditorialAgentError,
  runEditorialPlanAgent,
  runHeadTailWriter,
  validateEditorialPlan,
  validateHeadTailDraft
} from "../weekly-report/editorial-agent.js";
import {
  buildEditorialPlanPrompt,
  buildEditorialPlanRepairPrompt,
  buildHeadTailPrompt,
  buildHeadTailRepairPrompt
} from "../weekly-report/prompts.js";

const source = (anchor, section, excerpt) => ({ anchor, section, excerpt });

const selectedItemFor = (paperId, rank, {
  rawScore = 85 - rank,
  readingTier = rank === 1 ? "must_read" : "worth_reading"
} = {}) => ({
  paper: {
    id: paperId,
    title: "OLD_TITLE_MUST_NOT_ENTER_EDITORIAL_PLAN",
    summary: "ABSTRACT_MUST_NOT_ENTER_EDITORIAL_PLAN",
    score: 100,
    analysis: { score: 99 }
  },
  contextPacket: {
    paperId,
    inputText: "LONG_ORIGINAL_TEXT_MUST_NOT_ENTER_EDITORIAL_PLAN",
    inputSections: [{ text: "LONG_SECTION_MUST_NOT_ENTER_EDITORIAL_PLAN" }]
  },
  evidenceCard: {
    paperId,
    problem: {
      summary: "Autonomous actions require pre-execution safety checks.",
      status: "supported",
      sources: [source("S1", "1 Introduction", "SECRET_EXCERPT autonomous actions require safety checks.")]
    },
    method: {
      summary: "The method validates actions against explicit constraints.",
      status: "supported",
      sources: [source("S2", "2 Method", "SECRET_EXCERPT the method validates actions against explicit constraints.")]
    },
    systemDesign: {
      summary: "A separate system decomposition is not present.",
      status: "not_present",
      sources: []
    },
    experiments: {
      summary: "The evaluation uses simulated failure scenarios.",
      status: "supported",
      sources: [source("S3", "3 Evaluation", "SECRET_EXCERPT simulated failure scenarios are evaluated.")]
    },
    results: {
      summary: "Unsafe actions are reduced by 37%.",
      status: "supported",
      sources: [source("S4", "4 Results", "SECRET_EXCERPT unsafe actions are reduced by 37%.")]
    },
    limitations: {
      summary: "Production traffic is not evaluated.",
      status: "supported",
      sources: [source("S5", "5 Limitations", "SECRET_EXCERPT production traffic is not evaluated.")]
    },
    affiliations: {
      summary: "The authors are affiliated with Example University.",
      status: "supported",
      sources: [source("S0", "Paper metadata", "SECRET_EXCERPT Example University")]
    },
    evidenceInsufficient: false,
    warnings: []
  },
  valueSignals: {
    paperId,
    signals: [{
      dimension: "methodNovelty",
      claim: "Constraint validation is the reusable method signal.",
      evidenceRefs: ["method:0"],
      readerImplication: "Read the validation mechanism first.",
      adnImplication: {
        relevance: "direct",
        angle: "safety",
        insight: "The mechanism may constrain closed-loop network actions.",
        limit: "The evidence is simulation-only."
      },
      caveat: "No production deployment is evaluated."
    }]
  },
  reviewResult: {
    paperId,
    evidenceValidation: { status: "pass", issues: [] },
    scores: {
      scenarioProblemValue: 82,
      methodNovelty: 86,
      practicalValue: 76,
      evidence: 70
    },
    rawScore,
    scoreReason: "The method is valuable but evidence is simulation-only.",
    weakness: "No production evaluation.",
    uncertainty: "Operational generalization remains unclear.",
    interestFit: "target_network_autonomy",
    interestReason: "The work studies autonomous network safety."
  },
  calibrationResult: {
    paperId,
    status: "consistent",
    relativePosition: "High within this cohort.",
    suspectedMisjudgments: [],
    readingTier,
    calibrationReason: "The final score and tier are consistent."
  },
  selection: {
    selected: true,
    selectionReason: rank === 1 ? "threshold" : "fallback",
    finalScore: rawScore,
    readingTier,
    thresholdMet: rank === 1,
    rank
  }
});

const selectedItems = [
  selectedItemFor("2607.50001", 1),
  selectedItemFor("2607.50002", 2),
  selectedItemFor("2607.50003", 3, { readingTier: "background_only" })
];

const validPlan = () => ({
  coreTheme: "执行前约束验证正在成为网络智能体安全闭环的共同技术信号",
  titleAngle: "从自主执行转向可验证的规则约束安全闭环",
  trends: [{
    claim: "多篇论文共同把安全检查前移到自主动作执行之前。",
    supportingPaperIds: ["2607.50001", "2607.50002"],
    evidenceRefs: ["2607.50001:method:0", "2607.50002:results:0"],
    maturity: "developing",
    caveat: "现有支撑仍以仿真评估为主。"
  }],
  singlePaperObservations: [{
    paperId: "2607.50003",
    claim: "该论文可作为约束验证方法的背景补充。",
    evidenceRefs: ["2607.50003:method:0"],
    caveat: "其阅读层级为背景参考。"
  }],
  readingOrder: [
    { paperId: "2607.50001", reason: "先理解最高优先级的约束验证机制。" },
    { paperId: "2607.50002", reason: "再对照结果证据与适用边界。" },
    { paperId: "2607.50003", reason: "最后作为背景材料补充阅读。" }
  ]
});

test("Editorial Plan prompt uses bound excerpts as its only factual input", () => {
  const prompt = buildEditorialPlanPrompt({ selectedItems });
  const payload = JSON.parse(prompt);

  assert.equal(payload.task, "weekly_report_editorial_plan");
  assert.deepEqual(payload.papers.map((paper) => paper.paperId), [
    "2607.50001",
    "2607.50002",
    "2607.50003"
  ]);
  assert.equal(payload.papers[0].selection.finalScore, selectedItems[0].selection.finalScore);
  assert.equal(payload.papers[0].selection.selectionReason, undefined);
  assert.match(payload.rules.join(" "), /Simplified Chinese/i);
  assert.match(payload.rules.join(" "), /editorial aids, not factual Evidence/i);
  assert.match(payload.rules.join(" "), /neutral, literal technical prose/i);
  assert.match(payload.rules.join(" "), /Target 20-28 characters/i);
  assert.match(payload.rules.join(" "), /count every ASCII letter individually/i);
  assert.match(payload.rules.join(" "), /揭示\/reveal/);
  assert.match(prompt, /SECRET_EXCERPT the method validates actions against explicit constraints/);
  assert.equal(payload.papers[0].evidence.method.summary, undefined);
  assert.equal(payload.papers[0].valueSignals[0].claim, undefined);
  assert.equal(payload.papers[0].valueSignals[0].readerImplication, undefined);
  assert.equal(payload.papers[0].review.scoreReason, undefined);
  assert.equal(payload.papers[0].review.weakness, undefined);
  assert.equal(payload.papers[0].calibration.calibrationReason, undefined);
  assert.doesNotMatch(prompt, /LONG_ORIGINAL_TEXT|LONG_SECTION|ABSTRACT_MUST|OLD_TITLE_MUST|Constraint validation is the reusable method signal|The method is valuable but evidence is simulation-only|The final score and tier are consistent|"score":100|"score":99|fallback/);
});

test("a valid Editorial Plan passes multi-paper trend, observation, refs, and reading-order validation", () => {
  const validation = validateEditorialPlan(validPlan(), { selectedItems });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
  assert.equal(validation.editorialPlan.readingOrder.length, 3);
});

test("Editorial Plan title angle must converge before Head/Tail", () => {
  const plan = validPlan();
  plan.titleAngle = "规则密集型战术推理评测覆盖完整战斗状态合法选项连续场景资源预算与模型表现差异";

  const validation = validateEditorialPlan(plan, { selectedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => (
    entry.code === "title_angle_length_invalid" && entry.path === "titleAngle"
  )), true);
});

test("Editorial Plan removes a leading benchmark label when the remaining title angle is valid", () => {
  const plan = validPlan();
  plan.titleAngle = "DungeonBench：规则约束下的战术推理评测与跨战斗表现落差";

  const validation = validateEditorialPlan(plan, { selectedItems });

  assert.equal(validation.valid, true);
  assert.equal(validation.editorialPlan.titleAngle, "规则约束下的战术推理评测与跨战斗表现落差");
});

test("Editorial Plan rejects a selected paper-name prefix when the remainder is too short to normalize", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[0].paper.title = "LEMUR: Learning to Align with Multi-Objective Reinforcement Learning";
  const plan = validPlan();
  plan.titleAngle = "LEMUR：基于偏好反馈的多目标强化学习框架";

  const validation = validateEditorialPlan(plan, { selectedItems: scopedItems });

  assert.equal(validation.valid, false);
  const validationIssue = validation.issues.find((entry) => entry.code === "title_paper_prefix_forbidden");
  assert.equal(validationIssue?.path, "titleAngle");
  assert.deepEqual(validationIssue?.repairKinds, ["paper_title_prefix"]);
});

test("a one-paper trend or a cross-paper mismatched evidence ref is rejected", () => {
  const singleSupport = validPlan();
  singleSupport.trends[0].supportingPaperIds = ["2607.50001"];
  singleSupport.trends[0].evidenceRefs = ["2607.50001:method:0"];
  const singleValidation = validateEditorialPlan(singleSupport, { selectedItems });
  assert.equal(singleValidation.valid, false);
  assert.equal(singleValidation.issues.some((issue) => issue.code === "trend_requires_two_papers"), true);

  const mismatch = validPlan();
  mismatch.trends[0].evidenceRefs = ["2607.50001:method:0", "2607.50003:results:0"];
  const mismatchValidation = validateEditorialPlan(mismatch, { selectedItems });
  assert.equal(mismatchValidation.valid, false);
  assert.equal(mismatchValidation.issues.some((issue) => issue.code === "trend_support_missing_evidence"), true);
});

test("Editorial Plan rejects a low-information benchmark trend", () => {
  const plan = validPlan();
  plan.trends[0].claim = "两项工作均构建基准以指出现有评测的不足和局限。";

  const validation = validateEditorialPlan(plan, { selectedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "trend_too_generic"
    && issue.path === "trends[0].claim"
  )), true);
});

test("Editorial Plan requires direct trend evidence and keeps a mixed methods cohort out of frontier-model wording", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[1].evidenceCard.experiments.sources[0].excerpt = "We evaluate 14 frontier methods spanning commercial VLMs, open-source extraction, coding agents, and specialized APIs.";
  const plan = validPlan();
  plan.titleAngle = "评测前沿模型在两类复杂任务中的性能边界";
  plan.trends[0].claim = "两篇论文均构建多维度评测指标，用于测试当前前沿模型的局限。";
  plan.trends[0].caveat = "评测未涵盖通用表格处理。";

  const validation = validateEditorialPlan(plan, { selectedItems: scopedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => entry.code === "mixed_method_cohort_recast_as_models"), true);
  const setupIssue = validation.issues.find((entry) => entry.code === "specific_setup_claim_not_in_evidence");
  assert.equal(setupIssue?.path, "trends[0]");
  assert.equal(setupIssue?.repairKinds.includes("multidimensional_evaluation_design"), true);
  assert.equal(setupIssue?.repairKinds.includes("generic_table_scope"), true);
});

test("readingOrder must cover selected papers exactly once in deterministic Selection order", () => {
  const reordered = validPlan();
  reordered.readingOrder.reverse();
  const validation = validateEditorialPlan(reordered, { selectedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "reading_order_mismatch"), true);
});

test("exact numbers in Editorial claims must exist in their referenced evidence", () => {
  const plan = validPlan();
  plan.trends[0].claim = "多篇论文共同报告了 42% 的安全改进。";
  const validation = validateEditorialPlan(plan, { selectedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "numeric_claim_not_in_evidence"), true);
});

test("Editorial numeric validation does not treat the 1 in F1 as an exact-number claim", () => {
  const plan = validPlan();
  plan.trends[0].claim = "多篇论文共同报告 F1 指标。";

  const validation = validateEditorialPlan(plan, { selectedItems });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "numeric_claim_not_in_evidence" && /number 1\b/.test(issue.detail)
  )), false);
});

test("English number words support equivalent Arabic digits in Chinese Editorial claims", () => {
  const wordNumberItems = structuredClone(selectedItems);
  wordNumberItems[2].evidenceCard.results.sources[0].excerpt += " The model clears two of five linked days.";
  const plan = validPlan();
  plan.singlePaperObservations[0].claim = "该模型在 5 个关联任务日中完成了 2 个。";
  plan.singlePaperObservations[0].evidenceRefs = ["2607.50003:results:0"];

  const validation = validateEditorialPlan(plan, { selectedItems: wordNumberItems });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((issue) => issue.code === "numeric_claim_not_in_evidence"), false);
});

test("Editorial Plan preserves best-model scope and rejects rhetorical prose outside the title", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.results.sources[0].excerpt = "On the Encounter track, Gemini 3.1 Pro and GPT-5.5 are the strongest models.";
  const plan = validPlan();
  plan.singlePaperObservations[0].claim = "Frontier LLMs achieve high win rates on single encounters.";
  plan.singlePaperObservations[0].evidenceRefs = ["2607.50003:results:0"];
  plan.readingOrder[0].reason = "Read this paper first because it reveals the model capability gap.";

  const validation = validateEditorialPlan(plan, { selectedItems: scopedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "model_cohort_scope_overgeneralized"
    && issue.path === "singlePaperObservations[0].claim"
  )), true);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "rhetorical_prose_style"
    && issue.path === "readingOrder[0].reason"
  )), true);
  assert.deepEqual(
    validation.issues.find((issue) => (
      issue.code === "rhetorical_prose_style"
      && issue.path === "readingOrder[0].reason"
    ))?.repairKinds,
    ["neutral_direct_statement"]
  );
});

test("Editorial Plan keeps negative results scoped to evaluated systems", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.results.sources[0].excerpt = "Even the best overall word-level grounding F1 remains below 50%.";
  const plan = validPlan();
  plan.singlePaperObservations[0].claim = "所有前沿模型在视觉定位能力上均表现不佳。";
  plan.singlePaperObservations[0].evidenceRefs = ["2607.50003:results:0"];

  const validation = validateEditorialPlan(plan, { selectedItems: scopedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "model_cohort_scope_overgeneralized"
    && issue.path === "singlePaperObservations[0].claim"
  )), true);
});

test("Editorial Plan keeps an Encounter-only model count off the combined Encounter and Day cohort", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.experiments.sources[0].excerpt = "The encounter-track comparison evaluates five models: GPT-5.5, Claude Opus 4.7, Gemini 3.1 Pro, Grok 4.3, and DeepSeek V4.";
  const plan = validPlan();
  plan.readingOrder[2].reason = "通过 Encounter 和 Day 赛道对五个前沿模型进行对照评估。";

  const validation = validateEditorialPlan(plan, { selectedItems: scopedItems });

  assert.equal(validation.valid, false);
  const validationIssue = validation.issues.find((issue) => (
    issue.code === "model_count_track_scope_mismatch"
    && issue.path === "readingOrder[2].reason"
  ));
  assert.ok(validationIssue);
  assert.deepEqual(validationIssue.repairKinds, ["track_scoped_model_count"]);
});

test("Editorial Plan does not turn a zero Day result into failure on every track", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.results.sources[0].excerpt = "GPT-5.5 clears two of five days, while Grok 4.3 clears none.";
  const plan = validPlan();
  plan.singlePaperObservations[0].claim = "Grok 4.3 未通过任何赛道。";
  plan.singlePaperObservations[0].evidenceRefs = ["2607.50003:results:0"];

  const validation = validateEditorialPlan(plan, { selectedItems: scopedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "specific_setup_claim_not_in_evidence"), true);
});

test("Editorial Plan keeps Encounter win rate separate from Day clear counts", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.results.sources = [
    source("S4", "4 Results", "On the Encounter track, the strongest models have win rates of 83 and 82."),
    source("S4", "4 Results", "GPT-5.5 clears two of five days, while Grok 4.3 clears none.")
  ];
  const plan = validPlan();
  plan.singlePaperObservations[0].claim = "不同模型在单次遭遇与跨战斗日场景中的胜率差异明显。";
  plan.singlePaperObservations[0].evidenceRefs = ["2607.50003:results:0", "2607.50003:results:1"];

  const validation = validateEditorialPlan(plan, { selectedItems: scopedItems });

  assert.equal(validation.valid, false);
  const validationIssue = validation.issues.find((entry) => entry.code === "track_metric_scope_mismatch");
  assert.equal(validationIssue?.path, "singlePaperObservations[0].claim");
  assert.deepEqual(validationIssue?.repairKinds, ["encounter_day_metric_scope"]);
});

test("Editorial Plan accepts Encounter win rate and Day clear count in separate semicolon clauses", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.results.sources = [
    source("S4", "4 Results", "On the Encounter track, the strongest models have win rates of 83 and 82."),
    source("S4", "4 Results", "GPT-5.5 clears two of five days, while Grok 4.3 clears none.")
  ];
  const plan = validPlan();
  plan.singlePaperObservations[0].claim = "Encounter 以胜率衡量；Day 以通过的战斗日数衡量。";
  plan.singlePaperObservations[0].evidenceRefs = ["2607.50003:results:0", "2607.50003:results:1"];

  const validation = validateEditorialPlan(plan, { selectedItems: scopedItems });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((entry) => entry.code === "track_metric_scope_mismatch"), false);
});

test("Editorial Plan accepts Encounter win rate and Day clear count in separate comma clauses", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.results.sources = [
    source("S4", "4 Results", "On the Encounter track, the strongest models have win rates of 83 and 82."),
    source("S4", "4 Results", "GPT-5.5 clears two of five days, while Grok 4.3 clears none.")
  ];
  const plan = validPlan();
  plan.singlePaperObservations[0].claim = "Encounter 以胜率衡量，Day 以通过的战斗日数衡量。";
  plan.singlePaperObservations[0].evidenceRefs = ["2607.50003:results:0", "2607.50003:results:1"];

  const validation = validateEditorialPlan(plan, { selectedItems: scopedItems });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((entry) => entry.code === "track_metric_scope_mismatch"), false);
});

test("Editorial Plan accepts an explicit comparison of Encounter win rate and Day completion count", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.results.sources = [
    source("S4", "4 Results", "On the Encounter track, the strongest models have win rates of 83 and 82."),
    source("S4", "4 Results", "GPT-5.5 clears two of five days, while Grok 4.3 clears none.")
  ];
  const plan = validPlan();
  plan.singlePaperObservations[0].claim = "建议比较 Encounter 胜率与 Day 场景完成数之间的差异。";
  plan.singlePaperObservations[0].evidenceRefs = ["2607.50003:results:0", "2607.50003:results:1"];

  const validation = validateEditorialPlan(plan, { selectedItems: scopedItems });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((entry) => entry.code === "track_metric_scope_mismatch"), false);
});

test("Head/Tail keeps strongest-model performance scoped to that subset", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.results.sources[0].excerpt = "On the Encounter track, Gemini 3.1 Pro and GPT-5.5 are the strongest models, with high win rates.";
  const headTail = validHeadTail();
  headTail.closingSummary = "前沿语言模型在单次战斗中可达到较高胜率，但在连续任务中的表现出现明显下降。";

  const validation = validateHeadTailDraft(headTail, {
    editorialPlan: validPlan(),
    selectedItems: scopedItems,
    paperDrafts
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "model_cohort_scope_overgeneralized"
    && issue.path === "closingSummary"
  )), true);
});

test("Editorial Plan and Head/Tail preserve medium-horizon scope and natural Chinese", () => {
  const plan = validPlan();
  plan.singlePaperObservations[0].claim = "该方法评估中长期资源规划，并覆盖中时间跨度的任务。";
  plan.singlePaperObservations[0].evidenceRefs = ["2607.50003:method:0"];
  const planValidation = validateEditorialPlan(plan, { selectedItems });

  assert.equal(planValidation.valid, false);
  assert.equal(planValidation.issues.some((issue) => issue.code === "temporal_scope_overgeneralized"), true);
  assert.equal(planValidation.issues.some((issue) => issue.code === "awkward_literal_translation"), true);

  const headTail = validHeadTail();
  headTail.closingSummary = "建议关注模型的长周期资源规划表现。";
  const headTailValidation = validateHeadTailDraft(headTail, {
    editorialPlan: validPlan(),
    selectedItems,
    paperDrafts
  });
  assert.equal(headTailValidation.valid, false);
  assert.equal(headTailValidation.issues.some((issue) => issue.code === "temporal_scope_overgeneralized"), true);

  const longRangePlan = validPlan();
  longRangePlan.readingOrder[2].reason = "用于评估模型的长程推理能力。";
  const longRangeValidation = validateEditorialPlan(longRangePlan, { selectedItems });
  assert.equal(longRangeValidation.valid, false);
  assert.equal(longRangeValidation.issues.some((issue) => issue.code === "temporal_scope_overgeneralized"), true);
});

test("Editorial Plan and Head/Tail reject setup premises copied only from summaries or Value Signals", () => {
  const plan = validPlan();
  plan.coreTheme = "模型多阶段资源管理评估";
  plan.singlePaperObservations[0].caveat = "该方法依赖确定性引擎。";
  const planValidation = validateEditorialPlan(plan, { selectedItems });

  assert.equal(planValidation.valid, false);
  assert.equal(planValidation.issues.some((issue) => (
    issue.code === "specific_setup_claim_not_in_evidence"
  )), true);

  const headTail = validHeadTail();
  headTail.description = "评估资源管理能力";
  headTail.closingSummary = "重点检查系统如何与基础规则解析隔离。";
  const headTailValidation = validateHeadTailDraft(headTail, {
    editorialPlan: validPlan(),
    selectedItems,
    paperDrafts
  });
  assert.equal(headTailValidation.valid, false);
  assert.equal(headTailValidation.issues.filter((issue) => (
    issue.code === "specific_setup_claim_not_in_evidence"
  )).length, 2);
});

test("Editorial Plan requires direct excerpts for resource budgeting and state tracking", () => {
  const plan = validPlan();
  plan.readingOrder[2].reason = "重点评估多步骤资源预算与状态追踪。";

  const validation = validateEditorialPlan(plan, { selectedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "specific_setup_claim_not_in_evidence"
    && issue.path === "readingOrder[2].reason"
  )), true);
  const detail = validation.issues.find((issue) => (
    issue.code === "specific_setup_claim_not_in_evidence"
    && issue.path === "readingOrder[2].reason"
  ))?.detail || "";
  assert.match(detail, /资源预算/u);
  assert.match(detail, /状态追踪/u);
  assert.match(detail, /Remove or replace these exact terms/u);
});

test("Editorial Plan and Head/Tail accept resource budgeting from an explicit cross-stage resource tradeoff", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.method.sources[0].excerpt = "Day links encounters through persistent hit points, spell slots, consumables, preparation, and short-rest timing, forcing policies to trade off immediate tactical advantage against future survivability.";
  const plan = validPlan();
  plan.readingOrder[2].reason = "重点关注连续任务中的资源预算。";

  const planValidation = validateEditorialPlan(plan, { selectedItems: scopedItems });
  assert.equal(planValidation.valid, true);
  assert.equal(planValidation.issues.some((issue) => issue.code === "specific_setup_claim_not_in_evidence"), false);

  const headTail = validHeadTail();
  headTail.reportIntroduction = "本期关注连续任务中的资源预算评测。";
  const headTailValidation = validateHeadTailDraft(headTail, {
    editorialPlan: planValidation.editorialPlan,
    selectedItems: scopedItems,
    paperDrafts
  });
  assert.equal(headTailValidation.valid, true);
  assert.equal(headTailValidation.issues.some((issue) => issue.code === "specific_setup_claim_not_in_evidence"), false);
});

test("Editorial Plan rejects rhetorical contrast and generic reference-value wording", () => {
  const plan = validPlan();
  plan.trends[0].claim = "多篇研究评估具体约束，而非仅追求任务完成率。";
  plan.readingOrder[1].reason = "该论文具有较高的直接参考价值。";
  plan.singlePaperObservations[0].claim = "单场高胜率并不等同于连续场景表现稳定。";

  const validation = validateEditorialPlan(plan, { selectedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.filter((issue) => issue.code === "rhetorical_prose_style").length, 3);
});

test("Editorial Plan preserves schema, form, and grounding metric semantics", () => {
  const scopedItems = structuredClone(selectedItems);
  const scoped = scopedItems[2];
  scoped.evidenceCard.problem.sources[0].excerpt = "Fixed KIE benchmarks do not handle user-specified schemas.";
  scoped.evidenceCard.method.sources[0].excerpt = "Humans verify values and grounding on scanned forms.";
  scoped.evidenceCard.results.sources[0].excerpt = "The best overall word-level grounding F1 remains below 50%.";
  const plan = validPlan();
  plan.singlePaperObservations[0].claim = "该基准支持用户自定义提取模式，人工验证扫描表格，grounding准确率仍低于预期。";
  plan.singlePaperObservations[0].evidenceRefs = [
    "2607.50003:problem:0",
    "2607.50003:method:0",
    "2607.50003:results:0"
  ];
  plan.singlePaperObservations[0].caveat = "不排除未来模型改进后消除该问题的可能性。";

  const validation = validateEditorialPlan(plan, { selectedItems: scopedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.filter((entry) => entry.code === "specific_setup_claim_not_in_evidence").length, 1);
  assert.equal(validation.issues.some((entry) => entry.code === "rhetorical_prose_style"), true);
});

test("Editorial Plan does not invent a zero-level grounding metric from a zero score", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.limitations.sources[0].excerpt = "VLMs and coding agents do not return evidence by default; they therefore score zero at both grounding levels.";
  const plan = validPlan();
  plan.singlePaperObservations[0].caveat = "溯源指标仅覆盖词级与零级。";
  plan.singlePaperObservations[0].evidenceRefs = ["2607.50003:limitations:0"];

  const validation = validateEditorialPlan(plan, { selectedItems: scopedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "specific_setup_claim_not_in_evidence"), true);
});

test("Editorial Plan requires the percentage-bearing excerpt to name the accuracy metric", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.results.sources[0].excerpt = "Method A reports 96.6% on short and 94.4% on long documents.";
  const plan = validPlan();
  plan.singlePaperObservations[0].claim = "Method A 在短文档和长文档上的准确率分别为 96.6% 和 94.4%。";
  plan.singlePaperObservations[0].evidenceRefs = ["2607.50003:results:0"];

  const validation = validateEditorialPlan(plan, { selectedItems: scopedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => entry.code === "metric_label_not_in_evidence"), true);
});

test("Editorial Plan binds an accuracy label only to percentages in the same clause", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.results.sources = [
    source("S4", "4 Results", "Method A reports accuracy of 87.9%."),
    source("S4", "4 Results", "The best word-level grounding F1 remains below 50%.")
  ];
  const plan = validPlan();
  plan.singlePaperObservations[0].claim = "Method A 的准确率为 87.9%，最优 word-level grounding F1 低于 50%。";
  plan.singlePaperObservations[0].evidenceRefs = ["2607.50003:results:0", "2607.50003:results:1"];

  const validation = validateEditorialPlan(plan, { selectedItems: scopedItems });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((entry) => entry.code === "metric_label_not_in_evidence"), false);
});

test("Editorial Plan allows only one combined observation for each paper", () => {
  const plan = validPlan();
  plan.singlePaperObservations.push(structuredClone(plan.singlePaperObservations[0]));

  const validation = validateEditorialPlan(plan, { selectedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => entry.code === "single_paper_observation_duplicate"), true);
});

test("internal terms such as fallback and thresholds are rejected from Editorial Plan text", () => {
  const plan = validPlan();
  plan.singlePaperObservations[0].caveat = "该论文是 fallback，因为没有达到内部阈值。";
  const validation = validateEditorialPlan(plan, { selectedItems });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "internal_term_leak"), true);
});

test("Editorial Plan gets one structured repair and does not include the prior raw response", async () => {
  const invalid = validPlan();
  invalid.trends[0].supportingPaperIds = ["2607.50001"];
  invalid.trends[0].evidenceRefs = ["2607.50001:method:0"];
  const prompts = [];
  const result = await runEditorialPlanAgent({
    selectedItems,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      prompts.push(payload);
      return payload.task === "weekly_report_editorial_plan" ? invalid : validPlan();
    }
  });

  assert.equal(result.repairAttempted, true);
  assert.deepEqual(prompts.map((payload) => payload.task), [
    "weekly_report_editorial_plan",
    "weekly_report_editorial_plan_repair"
  ]);
  assert.doesNotMatch(JSON.stringify(prompts[1]), /SECRET_PRIOR_RAW_RESPONSE/);
});

test("Editorial Plan gets one response-format repair after a malformed content repair", async () => {
  const invalid = validPlan();
  invalid.singlePaperObservations[0].caveat = "该指标得分为零，而非指标本身为零。";
  const prompts = [];
  const result = await runEditorialPlanAgent({
    selectedItems,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      prompts.push(payload);
      if (payload.task === "weekly_report_editorial_plan") {
        return invalid;
      }
      if (payload.task === "weekly_report_editorial_plan_repair") {
        return '{"coreTheme":"broken"';
      }
      return validPlan();
    }
  });

  assert.equal(result.repairAttempted, true);
  assert.equal(result.responseRepairAttempted, true);
  assert.deepEqual(prompts.map((payload) => payload.task), [
    "weekly_report_editorial_plan",
    "weekly_report_editorial_plan_repair",
    "weekly_report_editorial_plan_response_repair"
  ]);
  assert.equal(prompts[2].issues[0].code, "rhetorical_prose_style");
  assert.equal(prompts[2].responseValidationIssues[0].code, "invalid_json");
  assert.doesNotMatch(JSON.stringify(prompts[2]), /\{\"coreTheme\":\"broken\"/);
});

test("Editorial Plan network failure retries once", async () => {
  let calls = 0;
  const result = await runEditorialPlanAgent({
    selectedItems,
    networkRetryDelayMs: 0,
    callModel: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("rate limited");
      }
      return validPlan();
    }
  });

  assert.equal(calls, 2);
  assert.equal(result.editorialPlan.trends.length, 1);
});

test("Editorial Plan still invalid after repair becomes a report-level reject error", async () => {
  const invalid = validPlan();
  invalid.readingOrder = [];

  await assert.rejects(
    () => runEditorialPlanAgent({
      selectedItems,
      networkRetryDelayMs: 0,
      callModel: async () => invalid
    }),
    (error) => (
      error instanceof EditorialAgentError
      && error.code === "READING_LIST_EDITORIAL_PLAN_UNSUPPORTED"
      && error.rejectJob === true
    )
  );
});

test("Editorial repair prompt includes issue paths but not issue details", () => {
  const prompt = buildEditorialPlanRepairPrompt({
    selectedItems,
    issues: [{
      code: "reading_order_mismatch",
      path: "readingOrder",
      detail: "SECRET_PRIOR_RAW_RESPONSE"
    }, {
      code: "rhetorical_prose_style",
      path: "singlePaperObservations[0].caveat",
      repairKinds: ["neutral_direct_statement"]
    }, {
      code: "specific_setup_claim_not_in_evidence",
      path: "readingOrder[2].reason",
      repairKinds: [
        "resource_budgeting",
        "state_tracking",
        "multidimensional_evaluation_design",
        "generic_table_scope",
        "mixed_method_cohort_subject",
        "track_scoped_model_count",
        "encounter_day_metric_scope"
      ]
    }]
  });

  assert.match(prompt, /weekly_report_editorial_plan_repair/);
  assert.match(prompt, /readingOrder/);
  assert.match(prompt, /remove resource budgeting\/资源预算/i);
  assert.match(prompt, /remove state tracking\/状态追踪/i);
  assert.match(prompt, /Remove the multidimensional-evaluation claim/i);
  assert.match(prompt, /Remove the general-purpose table-processing boundary/i);
  assert.match(prompt, /cohort spanning VLMs, extraction tools, coding agents, and APIs/i);
  assert.match(prompt, /Attach a model count only to the track that supplied it/i);
  assert.match(prompt, /write Encounter: win rate; Day: cleared-day count/i);
  assert.match(prompt, /state the supported scope and metric directly/i);
  assert.match(prompt, /Do not replace one forbidden contrast with another/i);
  assert.doesNotMatch(prompt, /SECRET_PRIOR_RAW_RESPONSE/);
});

const paperDrafts = selectedItems.map((selectedItem) => ({
  paperId: selectedItem.reviewResult.paperId,
  oneSentenceTakeaway: {
    text: "The paper studies pre-execution validation for safer autonomous actions.",
    evidenceRefs: ["method:0"]
  },
  limitationsAndConstraints: [{
    text: "Production traffic is not evaluated.",
    evidenceRefs: ["limitations:0"]
  }],
  readingValue: {
    whyWorthReading: {
      text: "It offers a concrete constraint-validation mechanism.",
      evidenceRefs: ["method:0"]
    },
    recommendedFocus: {
      text: "Focus on the validation mechanism.",
      evidenceRefs: ["method:0"]
    },
    evidenceBoundary: {
      text: "Current evidence remains simulation-oriented.",
      evidenceRefs: ["experiments:0"]
    }
  },
  publicationMeta: {
    title: `Trusted title ${selectedItem.reviewResult.paperId}`,
    finalScore: selectedItem.selection.finalScore,
    readingTier: selectedItem.selection.readingTier,
    rank: selectedItem.selection.rank,
    secret: "SERVER_META_SECRET_MUST_NOT_ENTER_HEAD_TAIL"
  }
}));

const validHeadTail = () => ({
  titleAngle: "Verifiable action constraints",
  description: "Grounded guidance for safer autonomous execution.",
  tags: ["network autonomy", "safety", "validation"],
  reportIntroduction: "This week's selected work centers on validating autonomous actions before execution while keeping deployment boundaries explicit.",
  trendJudgments: [{
    trendIndex: 0,
    claim: "Across the selected work, safety validation moves ahead of autonomous action execution.",
    caveat: "The available evaluation remains dominated by simulation."
  }],
  singlePaperObservations: [{
    observationIndex: 0,
    claim: "The final paper is best used as a complementary validation perspective.",
    caveat: "Its production applicability remains unresolved."
  }],
  readingOrder: [
    { paperId: "2607.50001", reason: "Start with the strongest validation mechanism." },
    { paperId: "2607.50002", reason: "Then compare its result evidence and boundary." },
    { paperId: "2607.50003", reason: "Finish with the complementary background perspective." }
  ],
  closingSummary: "Read the mechanism first, compare the evaluation boundary second, and treat production transfer as an open question."
});

const validSinglePaperPlan = () => ({
  coreTheme: "奖励函数未知时的多目标权衡",
  titleAngle: "偏好反馈支持未知奖励下的多目标策略学习",
  trends: [],
  singlePaperObservations: [{
    paperId: "2607.50001",
    claim: "该方法在未知奖励下学习多目标权衡。",
    evidenceRefs: ["2607.50001:method:0"],
    caveat: "现有评估仍以仿真场景为主。"
  }],
  readingOrder: [{
    paperId: "2607.50001",
    reason: "重点核对方法流程和仿真评估边界。"
  }]
});

const validSinglePaperHeadTail = () => ({
  titleAngle: "偏好反馈支持未知奖励下的多目标策略学习",
  description: "关注方法流程、主要结果和现有评估边界。",
  tags: ["偏好反馈", "多目标强化学习"],
  reportIntroduction: "本期关注奖励函数未知时的多目标权衡问题，并说明阅读时需要核对的方法入口。",
  trendJudgments: [],
  singlePaperObservations: [{
    observationIndex: 0,
    claim: "该方法在未知奖励下学习多目标权衡。",
    caveat: "现有评估仍以仿真场景为主。"
  }],
  readingOrder: [{
    paperId: "2607.50001",
    reason: "重点核对方法流程和仿真评估边界。"
  }],
  closingSummary: "阅读时重点检查反馈如何形成训练信号。"
});

test("Head/Tail prompt uses only editorialPlan and compact trusted artifacts", () => {
  const prompt = buildHeadTailPrompt({
    editorialPlan: validPlan(),
    selectedItems,
    paperDrafts
  });
  const payload = JSON.parse(prompt);

  assert.equal(payload.task, "weekly_report_write_head_tail");
  assert.deepEqual(payload.papers.map((paper) => paper.paperId), [
    "2607.50001",
    "2607.50002",
    "2607.50003"
  ]);
  assert.match(prompt, /Trusted title 2607\.50001/);
  assert.match(payload.rules.join(" "), /Simplified Chinese/i);
  assert.match(payload.rules.join(" "), /not factual support/i);
  assert.match(payload.rules.join(" "), /揭示\/reveal/);
  assert.deepEqual(payload.publicationConstraints.titleAngleUnicodeCharacters, {
    minimum: 18,
    maximum: 32,
    preferredMinimum: 20,
    preferredMaximum: 28
  });
  assert.match(payload.rules.join(" "), /Count titleAngle by Unicode characters/i);
  assert.match(payload.rules.join(" "), /For a one-paper report, assign distinct roles/i);
  assert.doesNotMatch(prompt, /SECRET_EXCERPT|LONG_ORIGINAL_TEXT|LONG_SECTION|ABSTRACT_MUST|OLD_TITLE_MUST|SERVER_META_SECRET|selectionReason|fallback/);
});

test("a valid Head/Tail draft is bound back to Editorial Plan trends, observations, and reading order", () => {
  const validation = validateHeadTailDraft(validHeadTail(), {
    editorialPlan: validPlan(),
    selectedItems,
    paperDrafts
  });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
  assert.deepEqual(
    validation.headTailDraft.trendJudgments[0].supportingPaperIds,
    ["2607.50001", "2607.50002"]
  );
  assert.deepEqual(
    validation.headTailDraft.trendJudgments[0].evidenceRefs,
    ["2607.50001:method:0", "2607.50002:results:0"]
  );
});

test("one-paper Head/Tail keeps introduction, observation, and closing roles distinct", () => {
  const validation = validateHeadTailDraft(validSinglePaperHeadTail(), {
    editorialPlan: validSinglePaperPlan(),
    selectedItems: [selectedItems[0]],
    paperDrafts: [paperDrafts[0]]
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((issue) => issue.code === "head_tail_repeated_content"), false);
});

test("Head/Tail canonicalizes an omitted collection only when Editorial Plan expects it empty", () => {
  const onePaperDraft = validSinglePaperHeadTail();
  delete onePaperDraft.trendJudgments;
  const emptyExpected = validateHeadTailDraft(onePaperDraft, {
    editorialPlan: validSinglePaperPlan(),
    selectedItems: [selectedItems[0]],
    paperDrafts: [paperDrafts[0]]
  });

  assert.equal(emptyExpected.valid, true);
  assert.deepEqual(emptyExpected.headTailDraft.trendJudgments, []);

  const multiPaperDraft = validHeadTail();
  delete multiPaperDraft.trendJudgments;
  const entriesExpected = validateHeadTailDraft(multiPaperDraft, {
    editorialPlan: validPlan(),
    selectedItems,
    paperDrafts
  });
  assert.equal(entriesExpected.valid, false);
  assert.equal(entriesExpected.issues.some((entry) => entry.code === "head_tail_collection_invalid"), true);
});

test("one-paper Head/Tail rejects a long repeated method or result phrase across reader fields", () => {
  const draft = validSinglePaperHeadTail();
  const repeated = "该框架通过无监督预训练、偏好反馈奖励学习与多目标强化学习训练三个阶段处理未知奖励函数";
  draft.reportIntroduction = `本期关注多目标权衡。${repeated}。`;
  draft.singlePaperObservations[0].claim = `${repeated}，并给出实验结果。`;
  draft.closingSummary = `阅读时重点核对：${repeated}。`;

  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validSinglePaperPlan(),
    selectedItems: [selectedItems[0]],
    paperDrafts: [paperDrafts[0]]
  });

  assert.equal(validation.valid, false);
  const validationIssue = validation.issues.find((issue) => issue.code === "head_tail_repeated_content");
  assert.equal(validationIssue?.path, "headTailDraft");
  assert.deepEqual(validationIssue?.repairKinds, ["single_paper_head_tail_repetition"]);
});

test("one-paper Head/Tail does not treat a repeated long technical identifier as repeated content", () => {
  const draft = validSinglePaperHeadTail();
  draft.singlePaperObservations[0].claim = "LlamaExtract Agentic Plus 在长文档场景中保持稳定表现。";
  draft.closingSummary = "阅读时重点核对 LlamaExtract Agentic Plus 在成本与评估指标间的取舍。";

  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validSinglePaperPlan(),
    selectedItems: [selectedItems[0]],
    paperDrafts: [paperDrafts[0]]
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((issue) => issue.code === "head_tail_repeated_content"), false);
});

test("one-paper Head/Tail cannot copy the paper recommended focus into the closing", () => {
  const draft = validSinglePaperHeadTail();
  const scopedPaperDrafts = [structuredClone(paperDrafts[0])];
  const repeated = "建议关注长文档场景下各系统的性能差异以及成本与价值指标之间的权衡数据";
  scopedPaperDrafts[0].readingValue.recommendedFocus.text = repeated;
  draft.closingSummary = repeated;

  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validSinglePaperPlan(),
    selectedItems: [selectedItems[0]],
    paperDrafts: scopedPaperDrafts
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "head_tail_repeated_content"), true);
});

test("one-paper Head/Tail rejects a semantic paraphrase of the paper recommended focus", () => {
  const draft = validSinglePaperHeadTail();
  const scopedPaperDrafts = [structuredClone(paperDrafts[0])];
  scopedPaperDrafts[0].readingValue.recommendedFocus.text = "建议关注不同系统在长文档处理上的表现差异，以及各系统在词级证据定位方面的具体测量结果。";
  draft.closingSummary = "建议重点关注各系统在长文档条件下得分的衰减幅度，以及不同系统架构在词级证据定位任务上的具体测量差异。";

  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validSinglePaperPlan(),
    selectedItems: [selectedItems[0]],
    paperDrafts: scopedPaperDrafts
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "head_tail_repeated_content"), true);
});

test("Head/Tail does not relabel a score or F1 result as accuracy without source support", () => {
  const draft = validSinglePaperHeadTail();
  draft.closingSummary = "建议关注各系统在长文档条件下准确率的衰减幅度。";

  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validSinglePaperPlan(),
    selectedItems: [selectedItems[0]],
    paperDrafts: [paperDrafts[0]]
  });

  assert.equal(validation.valid, false);
  const validationIssue = validation.issues.find((issue) => (
    issue.code === "metric_label_not_in_evidence" && issue.path === "closingSummary"
  ));
  assert.deepEqual(validationIssue?.repairKinds, ["preserve_metric_name"]);
});

test("Head/Tail cannot omit Editorial Plan entries or reorder selected papers", () => {
  const draft = validHeadTail();
  draft.trendJudgments = [];
  draft.readingOrder.reverse();
  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validPlan(),
    selectedItems,
    paperDrafts
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "head_tail_trend_mapping_mismatch"), true);
  assert.equal(validation.issues.some((issue) => issue.code === "reading_order_mismatch"), true);
});

test("Head/Tail cannot invent new exact numbers, generic title slogans, internal terms, or unknown papers", () => {
  const draft = validHeadTail();
  draft.titleAngle = "A new paradigm worth watching";
  draft.trendJudgments[0].claim = "The internal fallback threshold produced a 42% gain; see arXiv:2607.59999.";
  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validPlan(),
    selectedItems,
    paperDrafts
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "generic_title_angle"), true);
  assert.equal(validation.issues.some((issue) => issue.code === "numeric_claim_not_in_source"), true);
  assert.equal(validation.issues.some((issue) => issue.code === "internal_term_leak"), true);
  assert.equal(validation.issues.some((issue) => issue.code === "cross_paper_reference"), true);
});

test("Head/Tail numeric validation does not treat the 1 in F1 as an exact-number claim", () => {
  const draft = validHeadTail();
  draft.trendJudgments[0].claim = "入选工作共同报告 F1 指标。";

  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validPlan(),
    selectedItems,
    paperDrafts
  });

  assert.equal(validation.issues.some((issue) => (
    issue.code === "numeric_claim_not_in_source" && /number 1\b/.test(issue.detail)
  )), false);
});

test("Head/Tail title rejects rhetorical or promotional AI-style wording", () => {
  const draft = validHeadTail();
  draft.titleAngle = "单次任务高分不等于持续任务中的规划能力充分";
  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validPlan(),
    selectedItems,
    paperDrafts
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "rhetorical_title_style"), true);
});

test("Head/Tail rejects a selected paper-name title prefix and incomplete Chinese condition phrase", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[0].paper.title = "LEMUR: Learning to Align with Multi-Objective Reinforcement Learning";
  const draft = validHeadTail();
  draft.titleAngle = "LEMUR：基于偏好反馈的多目标强化学习框架";
  draft.reportIntroduction = "该框架旨在奖励函数未知的情况下平衡多个冲突目标。";

  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validPlan(),
    selectedItems: scopedItems,
    paperDrafts
  });

  assert.equal(validation.valid, false);
  const titleIssue = validation.issues.find((entry) => entry.code === "title_paper_prefix_forbidden");
  const grammarIssue = validation.issues.find((entry) => entry.code === "awkward_chinese_grammar");
  assert.deepEqual(titleIssue?.repairKinds, ["paper_title_prefix"]);
  assert.equal(grammarIssue?.path, "reportIntroduction");
  assert.deepEqual(grammarIssue?.repairKinds, ["missing_zai_before_condition"]);
});

test("Head/Tail keeps a mixed methods cohort out of collective frontier-model wording", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[1].evidenceCard.experiments.sources[0].excerpt = "We evaluate 14 frontier methods spanning commercial VLMs, open-source extraction, coding agents, and specialized APIs.";
  const draft = validHeadTail();
  draft.closingSummary = "本周论文给出了当前前沿模型在两类任务中的性能数据。";

  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validPlan(),
    selectedItems: scopedItems,
    paperDrafts
  });

  assert.equal(validation.valid, false);
  const validationIssue = validation.issues.find((entry) => (
    entry.code === "mixed_method_cohort_recast_as_models"
    && entry.path === "closingSummary"
  ));
  assert.deepEqual(validationIssue?.repairKinds, ["mixed_method_cohort_subject"]);
});

test("Head/Tail allows frontier-model ensembles as a grounded construction method", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[1].evidenceCard.experiments.sources[0].excerpt = "We evaluate 14 frontier methods spanning commercial VLMs, open-source extraction, coding agents, and specialized APIs.";
  scopedItems[1].evidenceCard.systemDesign.sources = [source(
    "S2",
    "2 ExtractBench",
    "We combine three sources, using frontier-model ensembles for real documents, programmatic generation for synthetic lists, and human labelers for scanned forms."
  )];
  const draft = validHeadTail();
  draft.closingSummary = "建议关注该基准如何结合前沿模型集成、程序化生成与人工标注处理不同来源文档。";

  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validPlan(),
    selectedItems: scopedItems,
    paperDrafts
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((entry) => entry.code === "mixed_method_cohort_recast_as_models"), false);
});

test("Head/Tail does not attach Encounter win rate to cross-day outcomes", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.results.sources = [
    source("S4", "4 Results", "On the Encounter track, the strongest models have win rates of 83 and 82."),
    source("S4", "4 Results", "GPT-5.5 clears two of five days, while Grok 4.3 clears none.")
  ];
  const draft = validHeadTail();
  draft.closingSummary = "多赛道数据展示了模型在单次遭遇与跨战斗日场景中的胜率差异。";

  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validPlan(),
    selectedItems: scopedItems,
    paperDrafts
  });

  assert.equal(validation.valid, false);
  const validationIssue = validation.issues.find((entry) => (
    entry.code === "track_metric_scope_mismatch" && entry.path === "closingSummary"
  ));
  assert.deepEqual(validationIssue?.repairKinds, ["encounter_day_metric_scope"]);
});

test("Head/Tail accepts Encounter win rate and Day clear count in separate semicolon clauses", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.results.sources = [
    source("S4", "4 Results", "On the Encounter track, the strongest models have win rates of 83 and 82."),
    source("S4", "4 Results", "GPT-5.5 clears two of five days, while Grok 4.3 clears none.")
  ];
  const draft = validHeadTail();
  draft.closingSummary = "Encounter 以胜率衡量；Day 以通过的战斗日数衡量。";

  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validPlan(),
    selectedItems: scopedItems,
    paperDrafts
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((entry) => entry.code === "track_metric_scope_mismatch"), false);
});

test("Head/Tail accepts Encounter win rate and Day clear count in separate comma clauses", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.results.sources = [
    source("S4", "4 Results", "On the Encounter track, the strongest models have win rates of 83 and 82."),
    source("S4", "4 Results", "GPT-5.5 clears two of five days, while Grok 4.3 clears none.")
  ];
  const draft = validHeadTail();
  draft.closingSummary = "Encounter 以胜率衡量，Day 以通过的战斗日数衡量。";

  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validPlan(),
    selectedItems: scopedItems,
    paperDrafts
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((entry) => entry.code === "track_metric_scope_mismatch"), false);
});

test("Head/Tail accepts an explicit comparison of Encounter win rate and Day completion count", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[2].evidenceCard.results.sources = [
    source("S4", "4 Results", "On the Encounter track, the strongest models have win rates of 83 and 82."),
    source("S4", "4 Results", "GPT-5.5 clears two of five days, while Grok 4.3 clears none.")
  ];
  const draft = validHeadTail();
  draft.closingSummary = "建议比较 Encounter 胜率与 Day 场景完成数之间的差异。";

  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validPlan(),
    selectedItems: scopedItems,
    paperDrafts
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((entry) => entry.code === "track_metric_scope_mismatch"), false);
});

test("Head/Tail rejects rhetorical body prose and broadens neither strongest-model evidence nor its subject", () => {
  const scopedItems = structuredClone(selectedItems);
  scopedItems[0].evidenceCard.results.sources[0].excerpt = "On the Encounter track, Gemini 3.1 Pro and GPT-5.5 are the strongest models.";
  const draft = validHeadTail();
  draft.titleAngle = "前沿大模型单场战术表现优异但多局规划明显不足";
  draft.reportIntroduction = "该基准量化揭示了模型在不同任务长度下的能力差距。";

  const validation = validateHeadTailDraft(draft, {
    editorialPlan: validPlan(),
    selectedItems: scopedItems,
    paperDrafts
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "model_cohort_scope_overgeneralized" && issue.path === "titleAngle"
  )), true);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "rhetorical_prose_style" && issue.path === "reportIntroduction"
  )), true);
});

test("Head/Tail gets one structured repair and never carries the previous raw response", async () => {
  const invalid = validHeadTail();
  invalid.readingOrder = [];
  const prompts = [];
  const result = await runHeadTailWriter({
    editorialPlan: validPlan(),
    selectedItems,
    paperDrafts,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      prompts.push(payload);
      return payload.task === "weekly_report_write_head_tail" ? invalid : validHeadTail();
    }
  });

  assert.equal(result.repairAttempted, true);
  assert.deepEqual(prompts.map((payload) => payload.task), [
    "weekly_report_write_head_tail",
    "weekly_report_write_head_tail_repair"
  ]);
  assert.doesNotMatch(JSON.stringify(prompts[1]), /SECRET_PRIOR_RAW_RESPONSE/);
});

test("Head/Tail gets one response-format repair after a malformed content repair", async () => {
  const invalid = validHeadTail();
  invalid.reportIntroduction = "该结果揭示了任务差异。";
  const prompts = [];
  const result = await runHeadTailWriter({
    editorialPlan: validPlan(),
    selectedItems,
    paperDrafts,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      prompts.push(payload);
      if (payload.task === "weekly_report_write_head_tail") {
        return invalid;
      }
      if (payload.task === "weekly_report_write_head_tail_repair") {
        return '{"titleAngle":"broken"';
      }
      return validHeadTail();
    }
  });

  assert.equal(result.repairAttempted, true);
  assert.equal(result.responseRepairAttempted, true);
  assert.deepEqual(prompts.map((payload) => payload.task), [
    "weekly_report_write_head_tail",
    "weekly_report_write_head_tail_repair",
    "weekly_report_write_head_tail_response_repair"
  ]);
  assert.equal(prompts[2].issues[0].code, "rhetorical_prose_style");
  assert.equal(prompts[2].responseValidationIssues[0].code, "invalid_json");
  assert.doesNotMatch(JSON.stringify(prompts[2]), /\{\"titleAngle\":\"broken\"/);
});

test("Head/Tail network failure retries once", async () => {
  let calls = 0;
  const result = await runHeadTailWriter({
    editorialPlan: validPlan(),
    selectedItems,
    paperDrafts,
    networkRetryDelayMs: 0,
    callModel: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("rate limited");
      }
      return validHeadTail();
    }
  });

  assert.equal(calls, 2);
  assert.equal(result.headTailDraft.readingOrder.length, 3);
});

test("Head/Tail still invalid after repair rejects the report", async () => {
  const invalid = validHeadTail();
  invalid.description = "";

  await assert.rejects(
    () => runHeadTailWriter({
      editorialPlan: validPlan(),
      selectedItems,
      paperDrafts,
      networkRetryDelayMs: 0,
      callModel: async () => invalid
    }),
    (error) => (
      error instanceof EditorialAgentError
      && error.code === "READING_LIST_HEAD_TAIL_UNSUPPORTED"
      && error.stage === "write_head_tail"
      && error.rejectJob === true
    )
  );
});

test("Head/Tail repair prompt carries issue codes and paths but not issue details", () => {
  const prompt = buildHeadTailRepairPrompt({
    editorialPlan: validPlan(),
    selectedItems,
    paperDrafts,
    issues: [{
      code: "reading_order_mismatch",
      path: "readingOrder",
      detail: "SECRET_PRIOR_RAW_RESPONSE"
    }, {
      code: "rhetorical_prose_style",
      path: "closingSummary",
      repairKinds: ["neutral_direct_statement"]
    }, {
      code: "specific_setup_claim_not_in_evidence",
      path: "reportIntroduction",
      repairKinds: [
        "resource_management",
        "paper_title_prefix",
        "missing_zai_before_condition",
        "track_scoped_model_count",
        "encounter_day_metric_scope",
        "single_paper_head_tail_repetition",
        "preserve_metric_name"
      ]
    }]
  });

  assert.match(prompt, /weekly_report_write_head_tail_repair/);
  assert.match(prompt, /readingOrder/);
  const payload = JSON.parse(prompt);
  assert.equal(payload.publicationConstraints.titleAngleUnicodeCharacters.minimum, 18);
  assert.equal(payload.publicationConstraints.titleAngleUnicodeCharacters.maximum, 32);
  assert.match(payload.repairInstruction, /Count titleAngle by Unicode characters/i);
  assert.match(prompt, /remove resource management\/资源管理/i);
  assert.match(prompt, /standalone 18-32 character technical claim/i);
  assert.match(prompt, /在奖励函数未知的情况下/i);
  assert.match(prompt, /Attach a model count only to the track that supplied it/i);
  assert.match(prompt, /write Encounter: win rate; Day: cleared-day count/i);
  assert.match(prompt, /keep reportIntroduction to the problem and reading entry/i);
  assert.match(prompt, /choose a different supplied reading dimension/i);
  assert.match(prompt, /do not preserve or lightly paraphrase/i);
  assert.match(prompt, /state the supported scope and metric directly/i);
  assert.match(prompt, /Do not replace one forbidden contrast with another/i);
  assert.match(prompt, /Preserve the exact supported metric name/i);
  assert.doesNotMatch(prompt, /SECRET_PRIOR_RAW_RESPONSE/);
});
