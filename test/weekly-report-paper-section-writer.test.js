import assert from "node:assert/strict";
import test from "node:test";
import {
  PaperSectionWriterError,
  runPaperSectionWriter,
  validatePaperDraft,
  writePaperSectionsBatch
} from "../weekly-report/report-writer.js";
import {
  buildPaperSectionPrompt,
  buildPaperSectionRepairPrompt
} from "../weekly-report/prompts.js";

const source = (anchor, section, excerpt) => ({ anchor, section, excerpt });

const selectedItemFor = (paperId, rank = 1) => ({
  paper: {
    id: paperId,
    title: `Trusted title ${paperId}`,
    absLink: `https://arxiv.org/abs/${paperId}`,
    summary: "ABSTRACT_MUST_NOT_ENTER_WRITER",
    score: 100,
    analysis: { score: 99, secret: "OLD_ANALYSIS_MUST_NOT_ENTER_WRITER" }
  },
  contextPacket: {
    paperId,
    inputText: "LONG_ORIGINAL_TEXT_MUST_NOT_ENTER_WRITER",
    inputSections: [{ text: "LONG_SECTION_MUST_NOT_ENTER_WRITER" }]
  },
  evidenceCard: {
    paperId,
    problem: {
      summary: "Autonomous actions require pre-execution safety checks.",
      status: "supported",
      sources: [source("S1", "1 Introduction", "Autonomous actions require pre-execution safety checks.")]
    },
    method: {
      summary: "The method validates actions against explicit constraints.",
      status: "supported",
      sources: [source("S2", "2 Method", "The method validates actions against explicit constraints.")]
    },
    systemDesign: {
      summary: "The validator is placed between planning and execution.",
      status: "supported",
      sources: [source("S2", "2 Method", "The validator is placed between planning and execution.")]
    },
    experiments: {
      summary: "The evaluation uses simulated failure scenarios.",
      status: "supported",
      sources: [source("S3", "3 Evaluation", "The evaluation uses simulated failure scenarios.")]
    },
    results: {
      summary: "Unsafe actions are reduced by 37%.",
      status: "supported",
      sources: [source("S4", "4 Results", "Unsafe actions are reduced by 37%.")]
    },
    limitations: {
      summary: "Production traffic and validation latency are not evaluated.",
      status: "supported",
      sources: [
        source("S5", "5 Limitations", "Production traffic is not evaluated."),
        source("S5", "5 Limitations", "Validation latency is not quantified.")
      ]
    },
    affiliations: {
      summary: "The authors are affiliated with Example University.",
      status: "supported",
      sources: [source("S0", "Paper metadata", "Alice Example, Example University")]
    },
    evidenceInsufficient: false,
    warnings: []
  },
  valueSignals: {
    paperId,
    signals: [{
      dimension: "methodNovelty",
      claim: "Pre-execution validation is the reusable method signal.",
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
    rawScore: 79,
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
    readingTier: rank === 1 ? "must_read" : "worth_reading",
    calibrationReason: "The final tier is consistent."
  },
  selection: {
    selected: true,
    selectionReason: rank === 1 ? "threshold" : "fallback",
    finalScore: 79 - rank,
    readingTier: rank === 1 ? "must_read" : "worth_reading",
    thresholdMet: rank === 1,
    rank
  }
});

const item = selectedItemFor("2607.60001");

const grounded = (text, evidenceRefs) => ({ text, evidenceRefs });

const validDraft = (paperId = "2607.60001") => ({
  paperId,
  oneSentenceTakeaway: grounded(
    "The paper makes autonomous execution safer through pre-execution constraint validation.",
    ["method:0"]
  ),
  researchProblem: grounded(
    "Autonomous actions need safety checks before execution.",
    ["problem:0"]
  ),
  coreContribution: grounded(
    "It turns explicit constraints into a reusable validation mechanism.",
    ["method:0"]
  ),
  methodFramework: grounded(
    "A validator sits between planning and execution and checks proposed actions.",
    ["method:0", "systemDesign:0"]
  ),
  experimentsAndResults: grounded(
    "In simulated failure scenarios, unsafe actions are reduced by 37%.",
    ["experiments:0", "results:0"]
  ),
  limitationsAndConstraints: [
    grounded("Production traffic is not evaluated.", ["limitations:0"]),
    grounded("Validation latency is not quantified.", ["limitations:1"])
  ],
  adnInsight: grounded(
    "The mechanism may constrain closed-loop network actions, but current evidence is simulation-only.",
    ["method:0", "experiments:0"]
  ),
  readingValue: {
    whyWorthReading: grounded(
      "It offers a concrete mechanism for validating autonomous actions.",
      ["method:0"]
    ),
    recommendedFocus: grounded(
      "Focus on the validation mechanism and its placement before execution.",
      ["method:0", "systemDesign:0"]
    ),
    evidenceBoundary: grounded(
      "Treat production applicability as unresolved.",
      ["limitations:0"]
    )
  }
});

test("Paper Section prompt contains one paper's bound artifacts and never carries original text, abstracts, old scores, or selection internals", () => {
  const other = selectedItemFor("2607.60002", 2);
  other.evidenceCard.method.sources[0].excerpt = "OTHER_PAPER_SECRET";
  const prompt = buildPaperSectionPrompt({ item });
  const payload = JSON.parse(prompt);

  assert.equal(payload.task, "weekly_report_write_paper_section");
  assert.equal(payload.paper.paperId, "2607.60001");
  assert.equal(payload.selection.finalScore, item.selection.finalScore);
  assert.match(payload.rules.join(" "), /Simplified Chinese/i);
  assert.match(payload.rules.join(" "), /editorial aids, not factual Evidence/i);
  assert.match(payload.rules.join(" "), /Preserve cohort, track, dataset, and model-version scope/i);
  assert.match(payload.rules.join(" "), /plain, neutral technical prose/i);
  assert.match(payload.rules.join(" "), /揭示\/reveal/);
  assert.match(prompt, /The method validates actions against explicit constraints/);
  assert.equal(payload.evidence.method.summary, undefined);
  assert.equal(payload.valueSignals[0].claim, undefined);
  assert.equal(payload.valueSignals[0].readerImplication, undefined);
  assert.equal(payload.review.scoreReason, undefined);
  assert.equal(payload.review.weakness, undefined);
  assert.equal(payload.calibration.calibrationReason, undefined);
  assert.doesNotMatch(prompt, /OTHER_PAPER_SECRET|ABSTRACT_MUST|OLD_ANALYSIS_MUST|LONG_ORIGINAL_TEXT|LONG_SECTION|Pre-execution validation is the reusable method signal|The method is valuable but evidence is simulation-only|The final tier is consistent|"score":100|"score":99|selectionReason|thresholdMet|fallback/);
});

test("a grounded paperDraft passes and receives server-owned publication metadata", () => {
  const validation = validatePaperDraft(validDraft(), { item });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
  assert.equal(validation.paperDraft.publicationMeta.finalScore, item.selection.finalScore);
  assert.equal(validation.paperDraft.publicationMeta.readingTier, "must_read");
  assert.equal(validation.paperDraft.publicationMeta.title, item.paper.title);
});

test("unknown Evidence refs and exact numbers absent from cited Evidence are rejected", () => {
  const draft = validDraft();
  draft.methodFramework.evidenceRefs = ["method:99"];
  draft.experimentsAndResults.text = "Unsafe actions are reduced by 42%.";
  const validation = validatePaperDraft(draft, { item });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "evidence_ref_unknown"), true);
  assert.equal(validation.issues.some((issue) => issue.code === "numeric_claim_not_in_evidence"), true);
});

test("Paper Section numeric validation does not treat the 1 in F1 as an exact-number claim", () => {
  const draft = validDraft();
  draft.oneSentenceTakeaway = grounded(
    "该方法使用 value F1 作为评测指标。",
    ["method:0"]
  );

  const validation = validatePaperDraft(draft, { item });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "numeric_claim_not_in_evidence" && /Exact number 1\b/.test(issue.detail)
  )), false);
});

test("inline Evidence refs are rejected without treating their indexes as factual numbers", () => {
  const draft = validDraft();
  draft.oneSentenceTakeaway.text = "该方法验证动作约束 [method:0, results:1]。";

  const validation = validatePaperDraft(draft, { item });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "inline_evidence_ref_leak"), true);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "numeric_claim_not_in_evidence" && /Exact number [01]/.test(issue.detail)
  )), false);
});

test("English month names support equivalent numeric months in Chinese prose", () => {
  const datedItem = structuredClone(item);
  datedItem.evidenceCard.experiments.sources[0].excerpt += " Models and prices reflect those available as of July 1, 2026.";
  const supported = validDraft();
  supported.readingValue.evidenceBoundary = grounded(
    "模型和定价以 2026 年 7 月 1 日可用版本为准。",
    ["experiments:0"]
  );
  const supportedValidation = validatePaperDraft(supported, { item: datedItem });
  assert.equal(supportedValidation.valid, true);

  const unsupported = structuredClone(supported);
  unsupported.readingValue.evidenceBoundary.text = "模型和定价以 2026 年 8 月 1 日可用版本为准。";
  const unsupportedValidation = validatePaperDraft(unsupported, { item: datedItem });
  assert.equal(unsupportedValidation.valid, false);
  assert.equal(unsupportedValidation.issues.some((issue) => (
    issue.code === "numeric_claim_not_in_evidence" && /8/.test(issue.detail)
  )), true);
});

test("English number words support equivalent Arabic digits in Chinese paper prose", () => {
  const wordNumberItem = structuredClone(item);
  wordNumberItem.evidenceCard.results.sources[0].excerpt += " The model clears two of five linked days.";
  const draft = validDraft();
  draft.oneSentenceTakeaway = grounded(
    "该模型在 5 个关联任务日中完成了 2 个。",
    ["results:0"]
  );

  const validation = validatePaperDraft(draft, { item: wordNumberItem });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((issue) => issue.code === "numeric_claim_not_in_evidence"), false);
});

test("Paper Section keeps strongest-model evidence scoped to the named or best-performing subset", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.results.sources[0].excerpt += " On the Encounter track, Gemini 3.1 Pro and GPT-5.5 are the strongest models.";
  const draft = validDraft();
  draft.oneSentenceTakeaway = grounded(
    "前沿大模型在单场战术任务中表现优异。",
    ["results:0"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "model_cohort_scope_overgeneralized"
    && issue.path === "oneSentenceTakeaway.text"
  )), true);
});

test("Paper Section does not expand a medium or multi-step horizon into long-term performance", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.method.sources[0].excerpt += " The challenge is not only long horizon or large branching factor.";
  const draft = validDraft();
  draft.coreContribution = grounded(
    "该方法用于评估中长期资源规划能力。",
    ["method:0"]
  );
  draft.readingValue.recommendedFocus = grounded(
    "重点关注中时间跨度的资源预算。",
    ["method:0"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "temporal_scope_overgeneralized"), true);
  assert.equal(validation.issues.some((issue) => issue.code === "awkward_literal_translation"), true);
});

test("Paper Section does not rewrite a single-encounter result as single-step performance", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.results.sources[0].excerpt = "Strong single-encounter performance does not transfer cleanly to linked encounter days.";
  const draft = validDraft();
  draft.adnInsight = grounded(
    "单步骤内的强决策能力不足以保证连续任务表现。",
    ["results:0"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  const validationIssue = validation.issues.find((entry) => (
    entry.code === "single_encounter_recast_as_single_step"
  ));
  assert.equal(validationIssue?.path, "adnInsight.text");
  assert.deepEqual(validationIssue?.repairKinds, ["single_encounter_scope"]);
});

test("Paper Section keeps Encounter win rate separate from Day clear counts", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.results.sources.push(
    source("S4", "4 Results", "On the Encounter track, the strongest models have win rates of 83 and 82."),
    source("S4", "4 Results", "GPT-5.5 clears two of five days, while Grok 4.3 clears none.")
  );
  const draft = validDraft();
  draft.readingValue.recommendedFocus = grounded(
    "建议关注不同模型在单次遭遇与跨战斗日场景中的胜率差异。",
    ["results:1", "results:2"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  const validationIssue = validation.issues.find((entry) => entry.code === "track_metric_scope_mismatch");
  assert.equal(validationIssue?.path, "readingValue.recommendedFocus.text");
  assert.deepEqual(validationIssue?.repairKinds, ["encounter_day_metric_scope"]);
});

test("Paper Section accepts Encounter win rate and Day clear count in separate semicolon clauses", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.results.sources.push(
    source("S4", "4 Results", "On the Encounter track, the strongest models have win rates of 83 and 82."),
    source("S4", "4 Results", "GPT-5.5 clears two of five days, while Grok 4.3 clears none.")
  );
  const draft = validDraft();
  draft.readingValue.recommendedFocus = grounded(
    "Encounter 以胜率衡量；Day 以通过的战斗日数衡量。",
    ["results:1", "results:2"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((entry) => entry.code === "track_metric_scope_mismatch"), false);
});

test("Paper Section accepts Encounter win rate and Day clear count in separate comma clauses", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.results.sources.push(
    source("S4", "4 Results", "On the Encounter track, the strongest models have win rates of 83 and 82."),
    source("S4", "4 Results", "GPT-5.5 clears two of five days, while Grok 4.3 clears none.")
  );
  const draft = validDraft();
  draft.readingValue.recommendedFocus = grounded(
    "Encounter 以胜率衡量，Day 以通过的战斗日数衡量。",
    ["results:1", "results:2"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((entry) => entry.code === "track_metric_scope_mismatch"), false);
});

test("Paper Section accepts an explicit comparison of Encounter win rate and Day completion count", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.results.sources.push(
    source("S4", "4 Results", "On the Encounter track, the strongest models have win rates of 83 and 82."),
    source("S4", "4 Results", "GPT-5.5 clears two of five days, while Grok 4.3 clears none.")
  );
  const draft = validDraft();
  draft.readingValue.recommendedFocus = grounded(
    "建议关注 Encounter 胜率与 Day 场景完成数之间的差异。",
    ["results:1", "results:2"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((entry) => entry.code === "track_metric_scope_mismatch"), false);
});

test("Paper Section uses domain-appropriate Chinese for persistent hit points and encounter days", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.method.sources[0].excerpt = "Day links encounters through persistent hit points, spell slots, and consumables.";
  scopedItem.evidenceCard.results.sources[0].excerpt = "GPT-5.5 clears two of five days, while Grok 4.3 clears none.";
  const draft = validDraft();
  draft.coreContribution = grounded("该设计在场景之间保持持续生命值。", ["method:0"]);
  draft.experimentsAndResults = grounded("评估记录了不同模型通过日程的情况。", ["results:0"]);

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  const translationIssues = validation.issues.filter((entry) => entry.code === "awkward_domain_translation");
  assert.equal(translationIssues.length, 2);
  assert.deepEqual(
    translationIssues.flatMap((entry) => entry.repairKinds).sort(),
    ["encounter_day_translation", "persistent_hit_points_translation"]
  );
});

test("Paper Section requires cited excerpts for specific setup and observability premises", () => {
  const draft = validDraft();
  draft.methodFramework = grounded(
    "系统向策略提供完整战术观察和可执行选项。",
    ["method:0"]
  );
  draft.adnInsight = grounded(
    "未来压力完全可观察，因此隐藏信息复杂性较低。",
    ["method:0"]
  );
  draft.readingValue.evidenceBoundary = grounded(
    "评估使用启发式对手控制器。",
    ["experiments:0"]
  );

  const validation = validatePaperDraft(draft, { item });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.filter((issue) => (
    issue.code === "specific_setup_claim_not_in_evidence"
  )).length, 3);
});

test("Paper Section preserves same-versus-fixed and budgeting-versus-management qualifiers", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.experiments.sources[0].excerpt += " All opposing sides use the same heuristic planner.";
  scopedItem.evidenceCard.results.sources[0].excerpt += " Linked days expose failures in resource budgeting.";
  const draft = validDraft();
  draft.experimentsAndResults = grounded(
    "对方由固定的启发式规划器控制。",
    ["experiments:0"]
  );
  draft.oneSentenceTakeaway = grounded(
    "连续任务显示出资源管理问题。",
    ["results:0"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.filter((issue) => (
    issue.code === "specific_setup_claim_not_in_evidence"
  )).length, 2);
});

test("Paper Section requires direct field evidence for resource budgeting and state tracking", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.results.sources[0].excerpt = "Strong single-encounter performance does not transfer cleanly to linked encounter days.";
  const draft = validDraft();
  draft.adnInsight = grounded(
    "连续多场任务中的资源预算和状态追踪表现与单次决策存在差距。",
    ["results:0"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "specific_setup_claim_not_in_evidence"
    && issue.path === "adnInsight.text"
  )), true);
  const detail = validation.issues.find((issue) => (
    issue.code === "specific_setup_claim_not_in_evidence"
    && issue.path === "adnInsight.text"
  ))?.detail || "";
  assert.match(detail, /资源预算/u);
  assert.match(detail, /状态追踪/u);
  assert.match(detail, /Remove or replace these exact terms/u);
});

test("Paper Section accepts resource budgeting when the excerpt states a cross-stage resource tradeoff", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.method.sources[0].excerpt = "Day links encounters through persistent hit points, spell slots, consumables, preparation, and short-rest timing, forcing policies to trade off immediate tactical advantage against future survivability.";
  const draft = validDraft();
  draft.adnInsight = grounded(
    "Day 赛道为连续任务中的资源预算提供了测试场景。",
    ["method:0"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((issue) => issue.code === "specific_setup_claim_not_in_evidence"), false);
});

test("Paper Section keeps a track-scoped model count in the same clause", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.experiments.sources[0].excerpt = "The encounter-track comparison evaluates five models: GPT-5.5, Claude Opus 4.7, Gemini 3.1 Pro, Grok 4.3, and DeepSeek V4.";
  const draft = validDraft();
  draft.readingValue.evidenceBoundary = grounded(
    "该论文的实验结果基于特定的五个模型版本。",
    ["experiments:0"]
  );

  const invalidValidation = validatePaperDraft(draft, { item: scopedItem });
  assert.equal(invalidValidation.valid, false);
  const validationIssue = invalidValidation.issues.find((issue) => (
    issue.code === "model_count_track_scope_missing"
    && issue.path === "readingValue.evidenceBoundary.text"
  ));
  assert.ok(validationIssue);
  assert.deepEqual(validationIssue.repairKinds, ["track_scoped_model_count"]);

  draft.readingValue.evidenceBoundary.text = "遭遇赛道的实验结果基于五个模型版本。";
  const validValidation = validatePaperDraft(draft, { item: scopedItem });
  assert.equal(validValidation.valid, true);
  assert.equal(validValidation.issues.some((issue) => issue.code === "model_count_track_scope_missing"), false);

  draft.readingValue.evidenceBoundary.text = "Encounter 赛道用于比较系统。该赛道共评估五个模型。";
  const referentialValidation = validatePaperDraft(draft, { item: scopedItem });
  assert.equal(referentialValidation.valid, true);
  assert.equal(referentialValidation.issues.some((issue) => issue.code === "model_count_track_scope_missing"), false);

  draft.readingValue.evidenceBoundary.text = "Encounter 和 Day 两个赛道对五个前沿模型进行评估。";
  const mismatchedValidation = validatePaperDraft(draft, { item: scopedItem });
  assert.equal(mismatchedValidation.valid, false);
  assert.equal(mismatchedValidation.issues.some((issue) => issue.code === "model_count_track_scope_mismatch"), true);
});

test("Paper Section does not turn a zero Day result into failure on every track", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.results.sources[0].excerpt = "GPT-5.5 clears two of five days, while Grok 4.3 clears none.";
  const draft = validDraft();
  draft.oneSentenceTakeaway = grounded(
    "Grok 4.3 未通过任何赛道。",
    ["results:0"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "specific_setup_claim_not_in_evidence"), true);
});

test("Paper Section accepts Chinese complete-observation wording from a plural English excerpt", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.limitations.sources[0].excerpt = "The main benchmark uses complete tactical observations and known encounter-day sequences.";
  const draft = validDraft();
  draft.limitationsAndConstraints[0] = grounded(
    "主要基准使用完整的战术观察和已知的战斗日序列。",
    ["limitations:0"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((issue) => issue.code === "specific_setup_claim_not_in_evidence"), false);
});

test("Paper Section requires direct excerpts for persistent-state and rules-parsing setup claims", () => {
  const draft = validDraft();
  draft.methodFramework = grounded(
    "Day 轨道通过持久状态和有限短休连接多次任务。",
    ["method:0"]
  );
  draft.readingValue.recommendedFocus = grounded(
    "重点检查系统如何将战术推理与基础规则解析隔离。",
    ["method:0"]
  );

  const validation = validatePaperDraft(draft, { item });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.filter((issue) => (
    issue.code === "specific_setup_claim_not_in_evidence"
  )).length, 2);
});

test("Paper Section accepts heuristic-opponent wording when the cited excerpt directly describes the opposing sides", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.experiments.sources[0].excerpt = "In every episode, all opposing sides are controlled by the same heuristic planner.";
  const draft = validDraft();
  draft.readingValue.evidenceBoundary = grounded(
    "评估使用由同一个启发式规划器控制的对方，也就是固定的启发式对手设置。",
    ["experiments:0"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
});

test("Paper Section rejects unqualified effectiveness wording", () => {
  const draft = validDraft();
  draft.oneSentenceTakeaway = grounded(
    "该框架有效解决了奖励函数未知的问题。",
    ["method:0"]
  );

  const validation = validatePaperDraft(draft, { item });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "rhetorical_prose_style"
    && issue.path === "oneSentenceTakeaway.text"
  )), true);
});

test("Paper Section rejects the rhetorical contrast phrase 并不等同于", () => {
  const draft = validDraft();
  draft.adnInsight = grounded(
    "单场高胜率并不等同于连续场景表现稳定。",
    ["results:0"]
  );

  const validation = validatePaperDraft(draft, { item });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "rhetorical_prose_style" && issue.path === "adnInsight.text"
  )), true);
});

test("Paper Section preserves schema, form, and grounding metric semantics", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.problem.sources[0].excerpt = "Fixed KIE benchmarks do not handle user-specified schemas.";
  scopedItem.evidenceCard.method.sources[0].excerpt = "Humans verify values and grounding on scanned forms.";
  scopedItem.evidenceCard.results.sources[0].excerpt = "The best overall word-level grounding F1 remains below 50%.";
  const draft = validDraft();
  draft.researchProblem = grounded("该基准支持用户自定义提取模式。", ["problem:0"]);
  draft.coreContribution = grounded("人工验证扫描表格。", ["method:0"]);
  draft.readingValue.recommendedFocus = grounded("建议关注 grounding 准确率。", ["results:0"]);

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.filter((entry) => entry.code === "specific_setup_claim_not_in_evidence").length, 3);
});

test("Paper Section does not invent a zero-level grounding metric from a zero score", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.limitations.sources[0].excerpt = "VLMs and coding agents do not return evidence by default; they therefore score zero at both grounding levels.";
  const draft = validDraft();
  draft.limitationsAndConstraints[0] = grounded(
    "溯源指标覆盖词级与零级。",
    ["limitations:0"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "specific_setup_claim_not_in_evidence"), true);
});

test("Paper Section keeps negative results scoped to evaluated systems", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.results.sources[0].excerpt = "Gemini accuracy degraded significantly on long documents.";
  const draft = validDraft();
  draft.oneSentenceTakeaway = grounded("现有前沿模型在长文档处理上存在显著不足。", ["results:0"]);

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => entry.code === "model_cohort_scope_overgeneralized"), true);

  draft.oneSentenceTakeaway.text = "参与测试的模型在长文档处理上存在显著不足。";
  const qualifiedValidation = validatePaperDraft(draft, { item: scopedItem });
  assert.equal(qualifiedValidation.issues.some((entry) => entry.code === "model_cohort_scope_overgeneralized"), false);
});

test("Paper Section does not generalize a commercial-VLM long-document result to current systems", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.results.sources[0].excerpt = "On long documents the commercial VLMs fall below 40%, while Claude Code Opus 4.8 and Reducto Deep Extract remain close to their short-document scores.";
  const draft = validDraft();
  draft.oneSentenceTakeaway = grounded(
    "现有系统在长文档处理方面仍存在明显不足。",
    ["results:0"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => entry.code === "model_cohort_scope_overgeneralized"), true);

  draft.oneSentenceTakeaway.text = "商业 VLM 在长文档上表现不足，而两个点名抽取系统接近其短文档表现。";
  const qualifiedValidation = validatePaperDraft(draft, { item: scopedItem });
  assert.equal(qualifiedValidation.issues.some((entry) => entry.code === "model_cohort_scope_overgeneralized"), false);
});

test("Paper Section does not relabel an unlabeled percentage as accuracy", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.results.sources[0].excerpt = "Method A achieves 95.6% F1.";
  const draft = validDraft();
  draft.experimentsAndResults = grounded("Method A 的准确率为 95.6%。", ["results:0"]);

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => entry.code === "metric_label_not_in_evidence"), true);
});

test("Paper Section binds an accuracy label only to percentages in the same clause", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.results.sources = [
    source("S4", "4 Results", "Method A reports accuracy of 87.9%."),
    source("S4", "4 Results", "The best word-level grounding F1 remains below 50%.")
  ];
  const draft = validDraft();
  draft.experimentsAndResults = grounded(
    "Method A 的准确率为 87.9%，最优 word-level grounding F1 低于 50%。",
    ["results:0", "results:1"]
  );

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((entry) => entry.code === "metric_label_not_in_evidence"), false);
});

test("Paper Section does not turn an observed maximum into an intrinsic upper bound", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.results.sources[0].excerpt = "The best overall word-level grounding F1 remains below 50%.";
  const draft = validDraft();
  draft.readingValue.evidenceBoundary = grounded("本次评测的词级 grounding F1 存在低于 50% 的明确上限。", ["results:0"]);

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => entry.code === "specific_setup_claim_not_in_evidence"), true);
});

test("Paper Section does not add significant to an unqualified decline", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.results.sources[0].excerpt = "Performance does not transfer cleanly to linked tasks.";
  const draft = validDraft();
  draft.adnInsight = grounded("参与测试的模型在连续任务中的决策质量显著下降。", ["results:0"]);

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => entry.code === "specific_setup_claim_not_in_evidence"), true);
});

test("Paper Section limitations must state a study boundary instead of restating poor performance", () => {
  const draft = validDraft();
  draft.limitationsAndConstraints[1] = grounded(
    "结果差距表明当前模型在连续任务中的表现仍存在局限。",
    ["results:0"]
  );

  const validation = validatePaperDraft(draft, { item });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => entry.code === "limitation_not_study_boundary"), true);
});

test("Paper Section rejects the unnatural phrase 自主决策网络", () => {
  const draft = validDraft();
  draft.adnInsight.text = "该机制可用于自主决策网络。";

  const validation = validatePaperDraft(draft, { item });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => entry.code === "awkward_literal_translation"), true);
});

test("Paper Section rejects promotional evidence-strength wording after semantic repair", () => {
  const draft = validDraft();
  draft.readingValue.whyWorthReading = grounded(
    "该论文为方法有效性提供了坚实量化证据。",
    ["results:0"]
  );

  const validation = validatePaperDraft(draft, { item });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "rhetorical_prose_style"
    && issue.path === "readingValue.whyWorthReading.text"
  )), true);
});

test("paperDraft requires two separately grounded limitations or applicability constraints", () => {
  const draft = validDraft();
  draft.limitationsAndConstraints = draft.limitationsAndConstraints.slice(0, 1);
  const validation = validatePaperDraft(draft, { item });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "limitations_insufficient"), true);
});

test("Paper Section rejects two bullets that split the same grounding limitation", () => {
  const scopedItem = structuredClone(item);
  scopedItem.evidenceCard.limitations.sources = [source(
    "S5",
    "5 Limitations",
    "Even the best overall word-level grounding F1 remains below 50%. Systems often identify source pages, but reliably connecting each value to its exact supporting evidence remains open."
  )];
  const draft = validDraft();
  draft.limitationsAndConstraints = [
    grounded("最优词级 grounding F1 仍低于当前评估要求。", ["limitations:0"]),
    grounded("系统能识别来源页面，但精确证据关联仍是未解问题。", ["limitations:0"])
  ];

  const validation = validatePaperDraft(draft, { item: scopedItem });

  assert.equal(validation.valid, false);
  const validationIssue = validation.issues.find((entry) => entry.code === "limitations_not_independent");
  assert.equal(validationIssue?.path, "limitationsAndConstraints");
  assert.deepEqual(validationIssue?.repairKinds, ["duplicate_grounding_limitations"]);
});

test("Writer output cannot expose workflow terms, other arXiv papers, or model-owned score fields", () => {
  const draft = validDraft();
  draft.coreContribution.text = "This fallback paper missed the internal threshold; see arXiv:2607.60002.";
  draft.finalScore = 100;
  const validation = validatePaperDraft(draft, { item });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "internal_term_leak"), true);
  assert.equal(validation.issues.some((issue) => issue.code === "cross_paper_reference"), true);
  assert.equal(validation.issues.some((issue) => issue.code === "writer_field_forbidden"), true);
});

test("Paper Section Writer gets one structured repair without carrying its prior raw response", async () => {
  const invalid = validDraft();
  invalid.limitationsAndConstraints = [];
  const prompts = [];
  const result = await runPaperSectionWriter({
    item,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      prompts.push(payload);
      return payload.task === "weekly_report_write_paper_section" ? invalid : validDraft();
    }
  });

  assert.equal(result.repairAttempted, true);
  assert.deepEqual(prompts.map((payload) => payload.task), [
    "weekly_report_write_paper_section",
    "weekly_report_write_paper_section_repair"
  ]);
  assert.doesNotMatch(JSON.stringify(prompts[1]), /SECRET_PRIOR_RAW_RESPONSE/);
});

test("Paper Section Writer network failure retries once", async () => {
  let calls = 0;
  const result = await runPaperSectionWriter({
    item,
    networkRetryDelayMs: 0,
    callModel: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("rate limited");
      }
      return validDraft();
    }
  });

  assert.equal(calls, 2);
  assert.equal(result.paperDraft.paperId, "2607.60001");
});

test("Paper Section Writer still invalid after repair becomes a report-level reject error", async () => {
  const invalid = validDraft();
  invalid.readingValue = {};

  await assert.rejects(
    () => runPaperSectionWriter({
      item,
      networkRetryDelayMs: 0,
      callModel: async () => invalid
    }),
    (error) => (
      error instanceof PaperSectionWriterError
      && error.code === "READING_LIST_PAPER_SECTION_UNSUPPORTED"
      && error.paperId === "2607.60001"
      && error.rejectJob === true
    )
  );
});

test("Paper Section repair prompt includes issue paths but never issue details", () => {
  const prompt = buildPaperSectionRepairPrompt({
    item,
    issues: [{
      code: "limitations_insufficient",
      path: "limitationsAndConstraints",
      detail: "SECRET_PRIOR_RAW_RESPONSE"
    }, {
      code: "specific_setup_claim_not_in_evidence",
      path: "adnInsight.text",
      repairKinds: [
        "resource_budgeting",
        "single_encounter_scope",
        "persistent_hit_points_translation",
        "encounter_day_translation",
        "duplicate_grounding_limitations",
        "encounter_day_metric_scope",
        "track_scoped_model_count"
      ]
    }]
  });

  assert.match(prompt, /weekly_report_write_paper_section_repair/);
  assert.match(prompt, /limitationsAndConstraints/);
  assert.match(prompt, /Revalidate every field in the regenerated draft/i);
  assert.match(prompt, /cite all Evidence refs needed to support that number/i);
  assert.match(prompt, /Do not move an unsupported number to another field/i);
  assert.match(prompt, /remove resource budgeting\/资源预算/i);
  assert.match(prompt, /immediate-versus-future tradeoff/i);
  assert.match(prompt, /single-encounter\/单场战斗/i);
  assert.match(prompt, /跨战斗保留的生命值/i);
  assert.match(prompt, /战斗日 or Day 场景/i);
  assert.match(prompt, /Merge the repeated exact-evidence-linking limitation/i);
  assert.match(prompt, /Keep Encounter win rates separate from Day clear counts/i);
  assert.match(prompt, /write Encounter: win rate; Day: cleared-day count/i);
  assert.match(prompt, /Attach a model count only to the track that supplied it/i);
  assert.doesNotMatch(prompt, /SECRET_PRIOR_RAW_RESPONSE/);
});

test("Paper Section batch uses finite concurrency and preserves Selection rank order", async () => {
  const items = [
    selectedItemFor("2607.60011", 1),
    selectedItemFor("2607.60012", 2),
    selectedItemFor("2607.60013", 3),
    selectedItemFor("2607.60014", 4)
  ];
  let active = 0;
  let maximumActive = 0;
  const result = await writePaperSectionsBatch(items, {
    paperConcurrency: 2,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const paperId = JSON.parse(prompt).paper.paperId;
      await new Promise((resolve) => setTimeout(resolve, paperId.endsWith("11") ? 20 : 5));
      active -= 1;
      return validDraft(paperId);
    }
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(result.succeeded.map((entry) => entry.paperDraft.paperId), [
    "2607.60011",
    "2607.60012",
    "2607.60013",
    "2607.60014"
  ]);
  assert.deepEqual(result.failed, []);
});
