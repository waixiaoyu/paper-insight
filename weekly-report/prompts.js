const paperIdFrom = (paper = {}, contextPacket = {}) => String(
  contextPacket.paperId || paper.id || paper.absLink || paper.link || ""
).trim();

const EVIDENCE_REPAIR_FIELDS = new Set([
  "problem",
  "method",
  "systemDesign",
  "experiments",
  "results",
  "limitations",
  "affiliations"
]);

const evidenceSections = (contextPacket = {}) => (
  Array.isArray(contextPacket.inputSections)
    ? contextPacket.inputSections.map((section) => ({
      anchor: String(section?.anchor || ""),
      heading: String(section?.heading || ""),
      kind: String(section?.kind || ""),
      text: String(section?.text || "")
    }))
    : []
);

const evidenceOutputSchema = {
  evidenceCard: {
    paperId: "same paperId as input",
    problem: "Evidence field",
    method: "Evidence field",
    systemDesign: "Evidence field",
    experiments: "Evidence field",
    results: "Evidence field",
    limitations: "Evidence field",
    affiliations: "Evidence field",
    evidenceInsufficient: false,
    warnings: []
  },
  evidenceField: {
    summary: "Evidence-bounded summary",
    status: "supported | not_present | insufficient",
    sources: [
      {
        section: "exact supplied section heading",
        anchor: "exact supplied section anchor",
        excerpt: "verbatim short excerpt from that section"
      }
    ]
  },
  valueSignals: {
    paperId: "same paperId as input",
    signals: [
      {
        dimension: "scenarioProblemValue | methodNovelty | practicalValue | evidence",
        claim: "Why this evidence matters",
        evidenceRefs: ["method:0"],
        readerImplication: "What the reader should inspect",
        adnImplication: {
          relevance: "direct | transferable | weak | none",
          angle: "intent | closed_loop | digital_twin | network_agent | cross_domain | ops | evaluation | safety | engineering | general | none",
          insight: "Evidence-bounded implication",
          limit: "Boundary of that implication"
        },
        caveat: "Important weakness"
      }
    ]
  }
};

const commonEvidenceRules = [
  "Use only the supplied arXiv HTML sections. Do not use the abstract, old analysis, recommendation score, outside knowledge, or another paper.",
  "Every supported fact must bind to an exact section anchor, the exact supplied section heading, and a short contiguous verbatim excerpt copied character-for-character from that section. Never normalize LaTeX, punctuation, whitespace, citations, or symbols inside excerpts.",
  "Each excerpt must be self-contained enough to identify its factual subject, comparison, and metric. Do not start an excerpt with unresolved anaphora such as 'It also' or 'They also'; include the contiguous antecedent sentence or choose another excerpt.",
  "The problem field must cite a sentence that states the research problem, gap, challenge, need, or capability being tested. A contribution-only sentence such as 'We introduce X' is not sufficient problem Evidence.",
  "The affiliations field may use only the supplied paper author or institution metadata. Product names, evaluated providers, customer names, citations, acknowledgements, and body-text organization mentions are not author affiliations; return affiliations as not_present when metadata is insufficient.",
  "Keep negative result scope exact. If long-document degradation is reported for commercial VLMs while named extraction systems remain close to their short-document scores, do not summarize this as most or current systems degrading. A results summary that mentions commercial VLMs on long documents must bind a results excerpt that explicitly names both commercial VLMs and the long-document scope.",
  "Before returning, verify every excerpt by exact substring matching against its selected section. If no exact excerpt can be copied, return not_present or insufficient instead of paraphrasing a source excerpt.",
  "Every exact number in a summary or value claim must appear in its bound excerpt. Otherwise add an exact supporting excerpt or remove the number from the claim; do not introduce citation or section numbers into summaries.",
  "Every Evidence field always requires a non-empty summary. For not_present or insufficient, explain the evidence boundary briefly and return sources as an empty array.",
  "Every Value Signal requires dimension and it must be exactly one of: scenarioProblemValue, methodNovelty, practicalValue, evidence.",
  "Every evidenceRefs item must point to an existing source using the exact field:index form, for example method:0. Never reference a source index that was not returned.",
  "Direction relevance never substitutes for research quality.",
  "Return one JSON object only, without Markdown fences."
];

const evidenceCompletenessContract = {
  evidenceCardRequiredFields: [
    "paperId",
    "problem",
    "method",
    "systemDesign",
    "experiments",
    "results",
    "limitations",
    "affiliations",
    "evidenceInsufficient",
    "warnings"
  ],
  everyEvidenceFieldRequiredFields: ["summary", "status", "sources"],
  everyEvidenceSourceRequiredFields: ["section", "anchor", "excerpt"],
  valueSignalsRequiredFields: ["paperId", "signals"],
  everyValueSignalRequiredFields: [
    "dimension",
    "claim",
    "evidenceRefs",
    "readerImplication",
    "adnImplication",
    "caveat"
  ],
  allowedDimensions: ["scenarioProblemValue", "methodNovelty", "practicalValue", "evidence"]
};

const baseEvidencePayload = ({ task, paper, contextPacket }) => ({
  task,
  agentRole: "evidence_extraction",
  paper: {
    paperId: paperIdFrom(paper, contextPacket),
    source: String(contextPacket?.source || ""),
    sourceUrl: String(contextPacket?.url || "")
  },
  context: {
    sections: evidenceSections(contextPacket)
  },
  rules: commonEvidenceRules,
  completenessContract: evidenceCompletenessContract,
  outputSchema: evidenceOutputSchema
});

export const buildEvidencePrompt = ({ paper, contextPacket } = {}) => JSON.stringify(
  baseEvidencePayload({
    task: "weekly_report_extract_evidence",
    paper,
    contextPacket
  })
);

const EVIDENCE_REPAIR_HINTS = Object.freeze({
  excerpt_not_in_source: "At this path, copy a shorter contiguous verbatim substring character-for-character from the exact bound section. Do not reconstruct, normalize, join non-contiguous sentences, or paraphrase the excerpt.",
  excerpt_not_self_contained: "At this path, include the contiguous antecedent that names the subject, comparison, and metric, or choose another self-contained excerpt. Do not start with It also or They also.",
  numeric_claim_not_in_excerpt: "At this path, remove the exact number or version from the summary or Value Signal unless the same field binds a verbatim excerpt containing that exact token. Do not move the unsupported number to another field.",
  problem_excerpt_not_problem_statement: "Replace the problem source with a verbatim sentence that directly states a problem, gap, challenge, need, risk, or tested capability. A contribution announcement is not problem Evidence.",
  commercial_vlm_long_document_source_missing: "Bind a verbatim results excerpt that explicitly names both commercial VLMs and the long-document scope, or remove that commercial-VLM long-document claim from the summary.",
  model_cohort_scope_overgeneralized: "Keep the negative result limited to the evaluated or named cohort. Do not rewrite commercial VLM, named-system, or best-system evidence as a result about most or current systems.",
  affiliation_source_not_metadata: "Remove body, appendix, product, provider, customer, citation, or acknowledgement sources from affiliations. Use author or institution metadata only; otherwise return not_present with no sources.",
  unknown_section_anchor: "Replace the source anchor with an exact anchor from the supplied context and copy the excerpt from that same section.",
  missing_evidence_source: "Add a valid bound source for this supported field or change the field to not_present or insufficient with an empty sources array."
});

const evidenceRepairIssue = (itemIssue) => {
  const result = {
    code: String(itemIssue?.code || "evidence_validation_failed"),
    path: String(itemIssue?.path || "")
  };
  const repairHint = EVIDENCE_REPAIR_HINTS[result.code];
  if (repairHint) {
    result.repairHints = [repairHint];
  }
  return result;
};

export const buildEvidenceRepairPrompt = ({
  paper,
  contextPacket,
  repairTargets = {},
  issues = []
} = {}) => JSON.stringify({
  ...baseEvidencePayload({
    task: "weekly_report_extract_evidence_repair",
    paper,
    contextPacket
  }),
  repairInstruction: "Regenerate the complete Evidence response for this paper. Fix the listed validation classes while preserving every required field in completenessContract. Do not omit a field merely because its path is not listed. Recheck exact excerpt substrings, section headings, numeric grounding, evidenceRefs, and every Value Signal dimension before returning.",
  repairTargets: {
    mode: String(repairTargets?.mode || "full_response"),
    evidenceFields: [...new Set((Array.isArray(repairTargets?.evidenceFields)
      ? repairTargets.evidenceFields
      : []).map(String).filter((field) => EVIDENCE_REPAIR_FIELDS.has(field)))],
    rebuildValueSignals: Boolean(repairTargets?.rebuildValueSignals)
  },
  serverMergePolicy: "Only fields named in repairTargets.evidenceFields and valueSignals when rebuildValueSignals is true may replace the retained normalized artifacts. Changes outside that scope are ignored. The merged complete artifacts are then fully revalidated.",
  issues: (Array.isArray(issues) ? issues : []).slice(0, 30).map(evidenceRepairIssue)
});

const reviewEvidenceFields = [
  "problem",
  "method",
  "systemDesign",
  "experiments",
  "results",
  "limitations",
  "affiliations"
];

const reviewEvidenceCard = (item = {}) => {
  const input = item.evidenceCard && typeof item.evidenceCard === "object"
    ? item.evidenceCard
    : {};
  const card = { paperId: String(input.paperId || "") };

  reviewEvidenceFields.forEach((field) => {
    const value = input[field] && typeof input[field] === "object" ? input[field] : {};
    card[field] = {
      summary: String(value.summary || ""),
      status: String(value.status || ""),
      sources: (Array.isArray(value.sources) ? value.sources : []).map((source) => ({
        section: String(source?.section || ""),
        anchor: String(source?.anchor || ""),
        excerpt: String(source?.excerpt || "")
      }))
    };
  });
  card.evidenceInsufficient = Boolean(input.evidenceInsufficient);
  card.warnings = (Array.isArray(input.warnings) ? input.warnings : []).map(String);
  return card;
};

const reviewValueSignals = (item = {}) => {
  const input = item.valueSignals && typeof item.valueSignals === "object"
    ? item.valueSignals
    : {};

  return {
    paperId: String(input.paperId || ""),
    signals: (Array.isArray(input.signals) ? input.signals : []).map((signal) => ({
      dimension: String(signal?.dimension || ""),
      claim: String(signal?.claim || ""),
      evidenceRefs: (Array.isArray(signal?.evidenceRefs) ? signal.evidenceRefs : []).map(String),
      readerImplication: String(signal?.readerImplication || ""),
      adnImplication: {
        relevance: String(signal?.adnImplication?.relevance || ""),
        angle: String(signal?.adnImplication?.angle || ""),
        insight: String(signal?.adnImplication?.insight || ""),
        limit: String(signal?.adnImplication?.limit || "")
      },
      caveat: String(signal?.caveat || "")
    }))
  };
};

const reviewSourceExcerpts = (evidenceCard) => reviewEvidenceFields.flatMap((field) => (
  (Array.isArray(evidenceCard?.[field]?.sources) ? evidenceCard[field].sources : [])
    .map((source, index) => ({
      evidenceRef: `${field}:${index}`,
      anchor: source.anchor,
      section: source.section,
      excerpt: source.excerpt
    }))
));

const reviewOutputSchema = {
  paperId: "same paperId as input",
  evidenceValidation: {
    status: "pass | repair_required",
    issues: [{
      field: "problem | method | systemDesign | experiments | results | limitations | affiliations | valueSignals",
      code: "specific_issue_code",
      message: "Why the Evidence summary is not faithful to its excerpt"
    }]
  },
  scores: {
    scenarioProblemValue: "integer 0-100",
    methodNovelty: "integer 0-100",
    practicalValue: "integer 0-100",
    evidence: "integer 0-100"
  },
  scoreReason: "Evidence-bounded reason for all four scores",
  weakness: "Most important research weakness",
  uncertainty: "Important uncertainty or evidence boundary",
  interestFit: "target_network_autonomy | general_ai_system | out_of_scope_domain | unclear",
  interestReason: "Direction-fit explanation that does not alter research scores",
  affiliations: ["Chinese institution name supported by affiliations evidence"],
  affiliationEvidenceRefs: ["affiliations:0"]
};

const commonReviewRules = [
  "First verify every independent sentence and clause in each Evidence Card summary against at least one bound verbatim excerpt from that same field.",
  "Also verify every Value Signal claim, reader implication, ADN implication, limit, and caveat against its declared evidenceRefs. If a Value Signal introduces an unsupported factual premise, request repair with field=valueSignals.",
  "If any summary materially overstates, contradicts, or invents information, return evidenceValidation.status=repair_required with specific issues. Do not accept scores in that response.",
  "If Evidence passes, score all four research-quality dimensions independently from 0 to 100.",
  "Direction fit is only a label. It must not increase or decrease any of the four research-quality scores.",
  "Use target_network_autonomy only when the paper's primary problem domain is directly about communication networks, telecom infrastructure, network operations, or network autonomy. A general AI/agent benchmark that may transfer to network autonomy is general_ai_system, not target_network_autonomy.",
  "Do not return rawScore. The server computes it with a fixed formula.",
  "Use only the supplied Evidence, Value Signals, and their bound excerpts. Do not use abstracts, old analysis, old scores, outside knowledge, or another paper.",
  "Affiliations must be Chinese institution names and must cite affiliations evidence refs. Return empty arrays when affiliation evidence is insufficient.",
  "Return one JSON object only, without Markdown fences."
];

const baseReviewPayload = ({ task, item }) => {
  const evidenceCard = reviewEvidenceCard(item);
  const valueSignals = reviewValueSignals(item);
  return {
    task,
    agentRole: "paper_review",
    paper: {
      paperId: String(item?.contextPacket?.paperId || evidenceCard.paperId || "")
    },
    evidence: { evidenceCard, valueSignals },
    sourceExcerpts: reviewSourceExcerpts(evidenceCard),
    scoring: {
      dimensions: {
        scenarioProblemValue: { weight: 0.2 },
        methodNovelty: { weight: 0.3 },
        practicalValue: { weight: 0.2 },
        evidence: { weight: 0.3 }
      },
      note: "Return dimension scores only. The server computes rawScore."
    },
    rules: commonReviewRules,
    outputSchema: reviewOutputSchema
  };
};

export const buildReviewPrompt = (item = {}) => JSON.stringify(baseReviewPayload({
  task: "weekly_report_review",
  item
}));

export const buildReviewRepairPrompt = ({ item, issues = [] } = {}) => JSON.stringify({
  ...baseReviewPayload({
    task: "weekly_report_review_repair",
    item
  }),
  repairInstruction: "Regenerate the complete Review response and correct the listed schema or validation classes.",
  issues: (Array.isArray(issues) ? issues : []).slice(0, 30).map((itemIssue) => ({
    code: String(itemIssue?.code || "review_validation_failed"),
    path: String(itemIssue?.path || "")
  }))
});

const calibrationEvidenceSummary = (item = {}) => Object.fromEntries(reviewEvidenceFields.map((field) => [
  field,
  {
    status: String(item?.evidenceCard?.[field]?.status || ""),
    summary: String(item?.evidenceCard?.[field]?.summary || ""),
    sourceCount: Array.isArray(item?.evidenceCard?.[field]?.sources)
      ? item.evidenceCard[field].sources.length
      : 0
  }
]));

const calibrationValueSummary = (item = {}) => (
  (Array.isArray(item?.valueSignals?.signals) ? item.valueSignals.signals : []).map((signal) => ({
    dimension: String(signal?.dimension || ""),
    claim: String(signal?.claim || ""),
    evidenceRefs: (Array.isArray(signal?.evidenceRefs) ? signal.evidenceRefs : []).map(String),
    readerImplication: String(signal?.readerImplication || ""),
    adnRelevance: String(signal?.adnImplication?.relevance || ""),
    adnAngle: String(signal?.adnImplication?.angle || ""),
    caveat: String(signal?.caveat || "")
  }))
);

const calibrationPaper = (item = {}) => ({
  paperId: String(item?.reviewResult?.paperId || item?.contextPacket?.paperId || ""),
  evidence: calibrationEvidenceSummary(item),
  valueSignals: calibrationValueSummary(item),
  review: {
    scores: {
      scenarioProblemValue: Number(item?.reviewResult?.scores?.scenarioProblemValue),
      methodNovelty: Number(item?.reviewResult?.scores?.methodNovelty),
      practicalValue: Number(item?.reviewResult?.scores?.practicalValue),
      evidence: Number(item?.reviewResult?.scores?.evidence)
    },
    rawScore: Number(item?.reviewResult?.rawScore),
    scoreReason: String(item?.reviewResult?.scoreReason || ""),
    weakness: String(item?.reviewResult?.weakness || ""),
    uncertainty: String(item?.reviewResult?.uncertainty || ""),
    interestFit: String(item?.reviewResult?.interestFit || ""),
    interestReason: String(item?.reviewResult?.interestReason || "")
  }
});

const calibrationOutputSchema = {
  results: [{
    paperId: "one supplied paperId",
    status: "consistent | rereview_required | repaired | unresolved",
    relativePosition: "Relative position within this cohort",
    suspectedMisjudgments: [{
      dimension: "scenarioProblemValue | methodNovelty | practicalValue | evidence",
      direction: "overrated | underrated",
      reason: "Specific cross-paper reason",
      comparisonPaperIds: ["another supplied paperId"]
    }],
    readingTier: "must_read | worth_reading | skim | background_only",
    calibrationReason: "Why the relative position and reading tier are justified"
  }]
};

const commonCalibrationRules = [
  "Compare only the supplied compact artifacts. No paper original text or abstract is available.",
  "Calibration must not change scores and must not return any score, score delta, calibrated score, or score adjustment.",
  "Only identify suspected score misjudgments by paperId, dimension, direction, reason, and comparison paperIds.",
  "Status must agree with suspectedMisjudgments: in initial Calibration, use rereview_required when the list is non-empty and consistent when it is empty; in confirmation, use unresolved when the list is non-empty and use repaired or consistent only when it is empty.",
  "Direction fit never substitutes for research quality.",
  "Every supplied paper must appear exactly once and no unknown paper may be returned.",
  "Return one JSON object only, without Markdown fences."
];

const baseCalibrationPayload = ({ task, items = [] }) => ({
  task,
  agentRole: "cross_paper_calibration",
  papers: (Array.isArray(items) ? items : []).map(calibrationPaper),
  rules: commonCalibrationRules,
  outputSchema: calibrationOutputSchema
});

export const buildCalibrationPrompt = ({ items = [] } = {}) => JSON.stringify(
  baseCalibrationPayload({ task: "weekly_report_calibration", items })
);

export const buildCalibrationRepairPrompt = ({ items = [], issues = [], phase = "initial" } = {}) => JSON.stringify({
  ...baseCalibrationPayload({
    task: phase === "confirm"
      ? "weekly_report_calibration_confirm_repair"
      : "weekly_report_calibration_repair",
    items
  }),
  repairInstruction: "Regenerate the complete Calibration response and correct only the listed schema or governance violations.",
  issues: (Array.isArray(issues) ? issues : []).slice(0, 40).map((itemIssue) => ({
    code: String(itemIssue?.code || "calibration_validation_failed"),
    path: String(itemIssue?.path || "")
  }))
});

export const buildCalibrationConfirmationPrompt = ({
  items = [],
  rereviewedDimensions = {}
} = {}) => JSON.stringify({
  ...baseCalibrationPayload({ task: "weekly_report_calibration_confirm", items }),
  confirmationInstruction: "Confirm the cohort after targeted Review. Return repaired only when the prior suspicion is resolved; return unresolved with suspectedMisjudgments when it is not.",
  rereviewedDimensions: Object.fromEntries(Object.entries(rereviewedDimensions || {}).map(([paperId, dimensions]) => [
    String(paperId),
    (Array.isArray(dimensions) ? dimensions : []).map(String)
  ]))
});

const targetedReviewOutputSchema = {
  paperId: "same paperId as input",
  dimensions: {
    requestedDimension: {
      score: "integer 0-100",
      reason: "Evidence-bounded reason for the reassessed dimension"
    }
  }
};

const targetedReviewPayload = ({ task, item, suspectedMisjudgments = [] }) => {
  const dimensions = [...new Set((Array.isArray(suspectedMisjudgments)
    ? suspectedMisjudgments
    : []).map((entry) => String(entry?.dimension || "")).filter(Boolean))];
  return {
    task,
    agentRole: "targeted_paper_review",
    paper: {
      paperId: String(item?.reviewResult?.paperId || item?.contextPacket?.paperId || "")
    },
    evidence: calibrationEvidenceSummary(item),
    valueSignals: calibrationValueSummary(item),
    currentReview: calibrationPaper(item).review,
    requestedDimensions: Object.fromEntries(dimensions.map((dimension) => [
      dimension,
      {
        currentScore: Number(item?.reviewResult?.scores?.[dimension]),
        suspectedDirection: String((suspectedMisjudgments || [])
          .find((entry) => entry?.dimension === dimension)?.direction || "")
      }
    ])),
    rules: [
      "Reassess only the requested dimensions for this paper.",
      "Do not return or modify any unrequested dimension.",
      "Use only this paper's compact Evidence, Value Signals, and current Review.",
      "Direction fit must not influence research-quality scores.",
      "Return one JSON object only, without Markdown fences."
    ],
    outputSchema: targetedReviewOutputSchema
  };
};

export const buildTargetedReviewPrompt = ({ item, suspectedMisjudgments = [] } = {}) => JSON.stringify(
  targetedReviewPayload({
    task: "weekly_report_targeted_rereview",
    item,
    suspectedMisjudgments
  })
);

export const buildTargetedReviewRepairPrompt = ({
  item,
  suspectedMisjudgments = [],
  issues = []
} = {}) => JSON.stringify({
  ...targetedReviewPayload({
    task: "weekly_report_targeted_rereview_repair",
    item,
    suspectedMisjudgments
  }),
  repairInstruction: "Regenerate the targeted Review response and correct only the listed schema violations.",
  issues: (Array.isArray(issues) ? issues : []).slice(0, 30).map((itemIssue) => ({
    code: String(itemIssue?.code || "targeted_review_validation_failed"),
    path: String(itemIssue?.path || "")
  }))
});

const editorialEvidenceRefs = (item = {}) => Object.fromEntries(reviewEvidenceFields.map((field) => [
  field,
  (Array.isArray(item?.evidenceCard?.[field]?.sources) ? item.evidenceCard[field].sources : [])
    .map((_, index) => `${field}:${index}`)
]));

const evidenceExcerptPayload = (item = {}) => Object.fromEntries(reviewEvidenceFields.map((field) => [
  field,
  {
    status: String(item?.evidenceCard?.[field]?.status || ""),
    sources: (Array.isArray(item?.evidenceCard?.[field]?.sources)
      ? item.evidenceCard[field].sources
      : []).map((source, index) => ({
      ref: `${field}:${index}`,
      anchor: String(source?.anchor || ""),
      section: String(source?.section || ""),
      excerpt: String(source?.excerpt || "")
    }))
  }
]));

const writingValueSignalGuidance = (item = {}) => (
  (Array.isArray(item?.valueSignals?.signals) ? item.valueSignals.signals : []).map((signal) => ({
    dimension: String(signal?.dimension || ""),
    evidenceRefs: (Array.isArray(signal?.evidenceRefs) ? signal.evidenceRefs : []).map(String),
    adnRelevance: String(signal?.adnImplication?.relevance || ""),
    adnAngle: String(signal?.adnImplication?.angle || "")
  }))
);

const writingReviewGuidance = (item = {}) => ({
  scores: {
    scenarioProblemValue: Number(item?.reviewResult?.scores?.scenarioProblemValue),
    methodNovelty: Number(item?.reviewResult?.scores?.methodNovelty),
    practicalValue: Number(item?.reviewResult?.scores?.practicalValue),
    evidence: Number(item?.reviewResult?.scores?.evidence)
  },
  interestFit: String(item?.reviewResult?.interestFit || "")
});

const editorialPaper = (item = {}) => ({
  paperId: String(item?.reviewResult?.paperId || item?.contextPacket?.paperId || ""),
  evidence: evidenceExcerptPayload(item),
  availableEvidenceRefs: editorialEvidenceRefs(item),
  valueSignals: writingValueSignalGuidance(item),
  review: writingReviewGuidance(item),
  calibration: {
    status: String(item?.calibrationResult?.status || ""),
    readingTier: String(item?.calibrationResult?.readingTier || "")
  },
  selection: {
    finalScore: Number(item?.selection?.finalScore),
    readingTier: String(item?.selection?.readingTier || ""),
    rank: Number(item?.selection?.rank)
  }
});

const editorialPlanOutputSchema = {
  coreTheme: "Concrete weekly technical theme grounded in selected papers",
  titleAngle: "Specific title angle, without generic promotional language",
  trends: [{
    claim: "Cross-paper trend supported by at least two papers",
    supportingPaperIds: ["selected paper A", "selected paper B"],
    evidenceRefs: ["paperA:method:0", "paperB:results:0"],
    maturity: "emerging | developing | mature | uncertain",
    caveat: "Important boundary of the trend"
  }],
  singlePaperObservations: [{
    paperId: "one selected paperId",
    claim: "Observation that must not be presented as a weekly trend",
    evidenceRefs: ["paperId:method:0"],
    caveat: "Boundary of the observation"
  }],
  readingOrder: [{
    paperId: "selected paperId in supplied rank order",
    reason: "Evidence-bounded reason to read it at this position"
  }]
};

const editorialPlanPatchOutputSchema = {
  patches: [{
    path: "one validation issue path",
    value: "replacement value for exactly that path"
  }]
};

const editorialPlanRules = [
  "Use only the supplied selected compact artifacts. Do not use original full text, abstracts, outside knowledge, or unselected papers.",
  "Only evidence field sources excerpts are factual Evidence. Evidence summaries and factual Value Signal prose are intentionally omitted; do not reconstruct or assume them.",
  "Write every reader-facing field in Simplified Chinese; paper titles and indispensable technical terms may remain in their original language.",
  "Use neutral, literal technical prose. State the research object, method, result, and limitation directly; avoid metaphors, personification, rhetorical contrasts, slogans, and promotional AI-style wording. Do not use 揭示/reveal, 而非 rhetorical contrasts, 赋能/unlock, 重塑/reshape, claims of 坚实量化证据, or generic claims of 较高的直接参考价值.",
  "titleAngle must contain 18-32 Unicode characters. Target 20-28 characters and count every ASCII letter individually. Do not prefix titleAngle with a paper, benchmark, or product name followed by a colon; Head/Tail already has paper context.",
  "Preserve every population and comparison qualifier. Evidence about the strongest, best-performing, or explicitly named models must not become a claim about frontier models or models as a whole.",
  "A long-document result limited to commercial VLMs must remain limited to that cohort, especially when named extraction systems are counterexamples. Do not rewrite it as a weakness of current or most systems.",
  "Preserve the evaluated object type. A cohort spanning VLMs, extraction tools, coding agents, and APIs is a cohort of methods or systems, not frontier models.",
  "Keep track-scoped model counts on that track only. An Encounter-only count cannot describe the combined Encounter and Day cohort. If a model clears none in a Day result, write that it clears no Day scenarios, not that it passes no track.",
  "Keep track-specific metrics separate. Encounter win rates and Day clear counts are different measures; do not call Day or cross-day outcomes win-rate differences unless a cited Day excerpt directly reports win rate.",
  "Preserve time-horizon scope. Translate medium-horizon as 中期 or describe the concrete multi-encounter span; do not expand it to 中长期, 长期, or 长周期 unless the Evidence explicitly says long-term or long-horizon. Do not use 中时间跨度.",
  "Review score reasons, weaknesses, uncertainty, and calibration comments are editorial aids, not factual Evidence. Never turn them into a factual claim unless the claim is independently supported by the cited Evidence excerpts.",
  "Evidence summaries and Value Signals do not replace cited excerpts. Do not write resource management, resource budgeting, state tracking, deterministic engines, persistent-state or short-rest mechanics, or separation from basic rules parsing unless the cited excerpts state those premises. Preserve resource budgeting as 资源预算 when it is directly supported.",
  "Preserve metric names exactly: grounding F1 is not grounding accuracy. A negative statement that fixed KIE benchmarks do not handle user-specified schemas does not by itself prove that the current benchmark supports them. Translate scanned forms as 扫描表单, not 扫描表格.",
  "Do not turn 'score zero at both grounding levels' into a zero-level grounding metric. Zero is the score; the level names must come from cited Evidence.",
  "Do not label a percentage as accuracy unless the cited excerpt containing that percentage identifies the metric as accuracy; add the metric-definition Evidence ref or keep the source metric name.",
  "A trend requires at least two distinct supporting papers and at least one valid evidence ref from every supporting paper.",
  "A cross-paper trend must name a shared concrete evaluation design, mechanism, metric discipline, comparison boundary, or engineering implication. Merely saying that multiple papers build benchmarks or identify limitations in prior evaluation is too generic.",
  "A cross-paper multidimensional-evaluation claim requires a cited excerpt from every supporting paper that directly states dimensions, axes, or multiple metrics. Do not invent an excluded scope such as general-purpose table processing unless the cited excerpt states it.",
  "A claim supported by only one paper must be placed in singlePaperObservations, never trends.",
  "Return at most one singlePaperObservations entry per paper. Combine its most useful supported findings and one material evidence boundary instead of repeating the paper title in several entries.",
  "Every trend and observation claim must cite existing evidence refs in paperId:field:index format.",
  "Any exact number in a claim must exist in its cited Evidence.",
  "readingOrder must include every selected paper exactly once in the supplied rank order. You provide reasons, not a new ranking.",
  "Do not mention internal selection reasons, score cutoffs, Agent stages, prompts, artifacts, or internal JSON.",
  "Return one JSON object only, without Markdown fences."
];

const WRITING_REPAIR_HINTS = Object.freeze({
  numeric_claim_not_in_evidence: "For every exact number in the affected claim, cite an existing Evidence ref whose excerpt contains that exact token, or remove the number. Do not retain a number merely because it occurs elsewhere in the paper.",
  resource_management: "At this path, remove resource management/资源管理 unless the cited excerpt directly states resource management; resource budgeting is not equivalent.",
  resource_budgeting: "At this path, remove resource budgeting/资源预算 unless the cited excerpt states that term or lists concrete cross-stage resources together with an immediate-versus-future tradeoff.",
  state_tracking: "At this path, remove state tracking/状态追踪 unless the cited excerpt directly states state tracking.",
  paper_title_prefix: "Rewrite titleAngle as a standalone 18-32 character technical claim. Do not begin it with a selected paper, benchmark, or product name followed by a colon.",
  missing_zai_before_condition: "Correct the Chinese grammar at this path: write 在奖励函数未知的情况下, not 旨在奖励函数未知的情况下.",
  multidimensional_evaluation_design: "Remove the multidimensional-evaluation claim unless every cited paper excerpt directly states dimensions, axes, or multiple metrics supporting it.",
  generic_table_scope: "Remove the general-purpose table-processing boundary unless the cited excerpt directly states that excluded scope.",
  mixed_method_cohort_subject: "Use methods or systems for a cohort spanning VLMs, extraction tools, coding agents, and APIs. Do not call the full cohort frontier models.",
  single_encounter_scope: "Replace single-step/单步 with single-encounter/单场战斗 when the cited result compares one encounter with linked encounter days.",
  persistent_hit_points_translation: "Translate persistent hit points as 跨战斗保留的生命值, not 持续生命值.",
  encounter_day_translation: "Translate cleared encounter days as 通过的战斗日 or Day 场景, not 日程.",
  duplicate_grounding_limitations: "Merge the repeated exact-evidence-linking limitation into one bullet and add a different supported scope, cohort, data, seed, comparison, or missing-validation boundary.",
  encounter_day_metric_scope: "Keep Encounter win rates separate from Day clear counts. Rewrite the affected statement to name the two measures independently: write Encounter: win rate; Day: cleared-day count. Do not describe Day or cross-day outcomes as win-rate differences unless the cited Day excerpt directly reports win rate.",
  track_scoped_model_count: "Attach a model count only to the track that supplied it. If the count comes from Encounter, keep Encounter in the same clause and do not attach that count to Day or to the whole paper.",
  neutral_direct_statement: "Rewrite this path as a direct neutral statement: state the supported scope and metric directly. Do not use 不等于、不等同于、而非、并非……而是、揭示 or promotional wording. Do not replace one forbidden contrast with another. If distinguishing two concepts, write two separate factual sentences with their own supported names.",
  preserve_metric_name: "Preserve the exact supported metric name. Use score, value F1, or grounding F1 as supplied; do not write accuracy/准确率 unless a cited Evidence excerpt explicitly uses accuracy for that claim.",
  performance_result_as_limitation: "Replace the repeated performance result with a supported study boundary such as evaluation scope, excluded comparison, data coverage, model/price time point, seed, or missing validation. A low or zero score and a system not returning evidence by default are results, not a second limitation by themselves.",
  single_paper_head_tail_repetition: "For a one-paper report, keep reportIntroduction to the problem and reading entry, keep the single-paper observation to one useful result and one evidence boundary, and keep closingSummary to a distinct final reading focus. Choose a different supplied reading dimension for closingSummary, such as an evidence boundary or final verification priority. Do not preserve or lightly paraphrase any long phrase from paperDraft recommendedFocus; changing only the tail of that sentence is insufficient."
});

const writingRepairIssue = (itemIssue, fallbackCode) => {
  const result = {
    code: String(itemIssue?.code || fallbackCode),
    path: String(itemIssue?.path || "")
  };
  const repairKinds = [
    ...(Array.isArray(itemIssue?.repairKinds) ? itemIssue.repairKinds : []),
    String(itemIssue?.code || "")
  ];
  const repairHints = [...new Set(
    repairKinds
      .map((kind) => WRITING_REPAIR_HINTS[String(kind || "")])
      .filter(Boolean)
  )];
  if (repairHints.length) {
    result.repairHints = repairHints;
  }
  return result;
};

const baseEditorialPlanPayload = ({ task, selectedItems = [] }) => ({
  task,
  agentRole: "editorial_planning",
  papers: (Array.isArray(selectedItems) ? selectedItems : []).map(editorialPaper),
  rules: editorialPlanRules,
  outputSchema: editorialPlanOutputSchema
});

export const buildEditorialPlanPrompt = ({ selectedItems = [] } = {}) => JSON.stringify(
  baseEditorialPlanPayload({
    task: "weekly_report_editorial_plan",
    selectedItems
  })
);

export const buildEditorialPlanRepairPrompt = ({
  selectedItems = [],
  currentEditorialPlan = {},
  issues = []
} = {}) => JSON.stringify({
  task: "weekly_report_editorial_plan_repair",
  agentRole: "editorial_planning",
  papers: (Array.isArray(selectedItems) ? selectedItems : []).map(editorialPaper),
  rules: editorialPlanRules,
  currentEditorialPlan,
  outputSchema: editorialPlanPatchOutputSchema,
  repairInstruction: "Return a JSON patch only. Each patch path must exactly equal one listed repairPaths item. Change only those values; every unpatched value is retained by the server. Do not regenerate the complete Editorial Plan.",
  repairPaths: [...new Set((Array.isArray(issues) ? issues : []).flatMap((itemIssue) => {
    const path = String(itemIssue?.path || "");
    const trendMatch = path.match(/^(trends\[\d+\])\.(supportingPaperIds|evidenceRefs)$/u);
    return trendMatch
      ? [path, `${trendMatch[1]}.${trendMatch[2] === "supportingPaperIds" ? "evidenceRefs" : "supportingPaperIds"}`]
      : [path];
  }).filter(Boolean))],
  issues: (Array.isArray(issues) ? issues : []).slice(0, 40)
    .map((itemIssue) => writingRepairIssue(itemIssue, "editorial_plan_validation_failed"))
});

export const buildEditorialPlanResponseRepairPrompt = ({
  selectedItems = [],
  currentEditorialPlan = null,
  issues = [],
  responseIssues = []
} = {}) => JSON.stringify({
  ...(currentEditorialPlan ? {
    task: "weekly_report_editorial_plan_response_repair",
    agentRole: "editorial_planning",
    papers: (Array.isArray(selectedItems) ? selectedItems : []).map(editorialPaper),
    rules: editorialPlanRules,
    currentEditorialPlan,
    outputSchema: editorialPlanPatchOutputSchema,
    repairInstruction: "The preceding patch response was malformed. Return a valid JSON patch only, limited to the listed validation issue paths. Every unpatched value is retained by the server; do not regenerate the complete Editorial Plan. Do not reproduce the malformed response."
  } : baseEditorialPlanPayload({
    task: "weekly_report_editorial_plan_response_repair",
    selectedItems
  })),
  ...(!currentEditorialPlan ? {
    repairInstruction: "Regenerate the complete Editorial Plan with valid JSON and schema. Preserve the original content-repair scope when issues are present; do not introduce a second or broader content repair. Do not reproduce or depend on the prior malformed raw response."
  } : {}),
  issues: (Array.isArray(issues) ? issues : []).slice(0, 40)
    .map((itemIssue) => writingRepairIssue(itemIssue, "editorial_plan_validation_failed")),
  responseValidationIssues: (Array.isArray(responseIssues) ? responseIssues : []).slice(0, 40)
    .map((itemIssue) => ({
      code: String(itemIssue?.code || "editorial_plan_response_invalid"),
      path: String(itemIssue?.path || "response")
    }))
});

const paperSectionEvidence = evidenceExcerptPayload;

const paperSectionValueSignals = writingValueSignalGuidance;

const groundedPaperSectionSchema = {
  text: "Reader-facing prose grounded only in the cited Evidence",
  evidenceRefs: ["field:index"]
};

const paperDraftOutputSchema = {
  paperId: "same paperId as input",
  oneSentenceTakeaway: groundedPaperSectionSchema,
  researchProblem: groundedPaperSectionSchema,
  coreContribution: groundedPaperSectionSchema,
  methodFramework: groundedPaperSectionSchema,
  experimentsAndResults: groundedPaperSectionSchema,
  limitationsAndConstraints: [groundedPaperSectionSchema, groundedPaperSectionSchema],
  adnInsight: groundedPaperSectionSchema,
  readingValue: {
    whyWorthReading: groundedPaperSectionSchema,
    recommendedFocus: groundedPaperSectionSchema,
    evidenceBoundary: groundedPaperSectionSchema
  }
};

const paperSectionRules = [
  "Write only this paper's weekly-report body artifact. Do not return Markdown.",
  "Write every reader-facing text field in Simplified Chinese; paper titles and indispensable technical terms may remain in their original language.",
  "Use plain, neutral technical prose. Describe what the paper studies, how it works, what was measured, and what remains limited without metaphors, personification, rhetorical contrasts, or promotional AI-style wording. Do not use 揭示/reveal, 赋能/unlock, 重塑/reshape, or claims of 坚实量化证据.",
  "Do not use unqualified effectiveness claims such as 有效解决, 有效方法, 有效暴露, or 有效测试. State the measured result and its boundary instead.",
  "Preserve metric names exactly: F1 is not accuracy. A negative statement that another benchmark lacks a capability does not establish that this paper's system has it. Translate scanned forms as 扫描表单, not 扫描表格.",
  "Do not invent zero-level grounding from 'score zero at both grounding levels'; zero describes the score, not a metric level.",
  "A best observed score is not an intrinsic upper bound or ceiling. State it as the highest value in this evaluation unless the excerpt explicitly defines an upper bound.",
  "Do not strengthen a decline or gap with 显著/significant unless the cited excerpt uses that qualifier for the same result.",
  "Every factual statement must stay within the supplied Evidence and cite existing field:index refs.",
  "Only evidence field sources excerpts are factual Evidence. Evidence summaries and factual Value Signal prose are intentionally omitted; do not reconstruct or assume them.",
  "Put citations only in each field's evidenceRefs array. Never write [field:index], field:index, footnote markers, or citation annotations inside reader-facing text.",
  "Review score reasons, weaknesses, uncertainty, calibration comments, and selection metadata are editorial aids, not factual Evidence. Never present them as facts about the paper.",
  "Preserve cohort, track, dataset, and model-version scope. When different excerpts describe different experimental cohorts, qualify each statement separately instead of implying one shared cohort.",
  "A long-document result limited to commercial VLMs must remain limited to commercial VLMs. Preserve named extraction-system counterexamples and do not generalize the result to current or most systems.",
  "Keep an exact model count in the same clause as its track qualifier. If an excerpt says the Encounter track evaluates five models, do not summarize the paper's overall experiments as using five model versions, especially when Day results name a different cohort.",
  "Keep Encounter win rates separate from Day clear counts. Do not describe cross-day or Day results as win-rate differences unless the cited Day excerpt directly reports win rate.",
  "Do not rewrite a single-encounter result as single-step decision performance. Translate persistent hit points as 跨战斗保留的生命值 and cleared encounter days as 战斗日 or Day 场景; do not use 持续生命值 or 日程.",
  "A zero result keeps its measured object: clears none after a list of Day outcomes means no Day scenarios cleared, not failure on every track.",
  "Preserve setup and resource qualifiers literally: translate same heuristic planner as 同一个启发式规划器, not 固定的启发式规划器; translate resource budgeting as 资源预算, not the broader 资源管理. Resource budgeting requires either that phrase or an explicit cited inventory of cross-stage resources together with a present-versus-future tradeoff; state tracking still requires direct cited support.",
  "Preserve time-horizon scope. Translate medium-horizon as 中期 or describe the concrete multi-encounter span; do not expand it to 中长期, 长期, or 长周期 unless the cited Evidence explicitly says long-term or long-horizon. Do not use the unnatural phrase 中时间跨度.",
  "Preserve strongest, best-performing, subset, and named-model qualifiers exactly in meaning. Never rewrite a result about selected top models as a result about frontier models or models as a whole.",
  "Do not introduce facts from outside knowledge, abstracts, prior analysis, or any other paper.",
  "Any exact number must occur in the Evidence excerpts cited by that text field.",
  "Provide at least two separately grounded limitations or applicability constraints.",
  "The two required limitations must be materially independent. Do not split the same word-level grounding or exact-evidence-linking gap into two bullets; add a distinct supported scope, cohort, data, seed, comparison, or missing-validation boundary.",
  "A poor performance result is not by itself a separate study limitation. Limitations must describe experiment design, data, seeds, comparison setup, scope, missing validation, or applicability boundaries.",
  "ADN or network-autonomy implications must follow the supplied value signals and preserve their boundary. Value Signals are editorial hints, not factual Evidence: every factual premise must still be entailed by this field's cited Evidence excerpts. Omit unsupported premises instead of repeating them from a Value Signal.",
  "Use 自主决策系统, not the unnatural phrase 自主决策网络, unless the paper directly studies a communication network.",
  "Do not write persistent state, short-rest mechanics, deterministic engines, or separation from basic rules parsing unless those exact setup premises occur in this field's cited Evidence excerpts.",
  "Do not mention selection mechanics, score cutoffs, review or calibration workflow, Agent stages, prompts, artifacts, or internal JSON.",
  "Do not return scores, reading tiers, titles, links, affiliations, ranks, or other publication metadata; the server owns them.",
  "Return one JSON object only, without Markdown fences."
];

const basePaperSectionPayload = ({ task, item = {} }) => ({
  task,
  agentRole: "paper_section_writer",
  paper: {
    paperId: String(item?.reviewResult?.paperId || item?.contextPacket?.paperId || item?.paper?.id || "")
  },
  evidence: paperSectionEvidence(item),
  valueSignals: paperSectionValueSignals(item),
  review: writingReviewGuidance(item),
  calibration: {
    status: String(item?.calibrationResult?.status || ""),
    readingTier: String(item?.calibrationResult?.readingTier || "")
  },
  selection: {
    finalScore: Number(item?.selection?.finalScore),
    readingTier: String(item?.selection?.readingTier || ""),
    rank: Number(item?.selection?.rank)
  },
  rules: paperSectionRules,
  outputSchema: paperDraftOutputSchema
});

export const buildPaperSectionPrompt = ({ item } = {}) => JSON.stringify(
  basePaperSectionPayload({ task: "weekly_report_write_paper_section", item })
);

export const buildPaperSectionRepairPrompt = ({ item, issues = [] } = {}) => JSON.stringify({
  ...basePaperSectionPayload({ task: "weekly_report_write_paper_section_repair", item }),
  repairInstruction: "Regenerate the complete paperDraft and correct only the listed validation classes. Revalidate every field in the regenerated draft, not only the listed paths. For every exact number, cite all Evidence refs needed to support that number in the same text field or remove the number. Do not move an unsupported number to another field. Keep citations only in evidenceRefs arrays; never insert [field:index] or field:index into text.",
  issues: (Array.isArray(issues) ? issues : []).slice(0, 40)
    .map((itemIssue) => writingRepairIssue(itemIssue, "paper_section_validation_failed"))
});

export const buildPaperSectionResponseRepairPrompt = ({
  item,
  issues = [],
  responseIssues = []
} = {}) => JSON.stringify({
  ...basePaperSectionPayload({ task: "weekly_report_write_paper_section_response_repair", item }),
  repairInstruction: "Regenerate the complete paperDraft with valid JSON and schema. Preserve the original content-repair scope when issues are present; do not introduce a second or broader content repair. Revalidate the complete result and do not reproduce or depend on the prior malformed raw response.",
  issues: (Array.isArray(issues) ? issues : []).slice(0, 40)
    .map((itemIssue) => writingRepairIssue(itemIssue, "paper_section_validation_failed")),
  responseValidationIssues: (Array.isArray(responseIssues) ? responseIssues : []).slice(0, 40)
    .map((itemIssue) => ({
      code: String(itemIssue?.code || "paper_section_response_invalid"),
      path: String(itemIssue?.path || "response")
    }))
});

const paperSemanticQaChecks = {
  factsGrounded: "Every factual statement is supported by the cited Evidence excerpts.",
  methodGrounded: "Method and system descriptions match the bound Evidence.",
  experimentsGrounded: "Experiment setting, comparisons, and results preserve the Evidence boundary.",
  numbersGrounded: "Every exact number occurs in the cited Evidence excerpts.",
  affiliationsGrounded: "Publication affiliations match the affiliation Evidence.",
  limitationsGrounded: "At least two material limitations or applicability constraints are supported.",
  recommendationToneAligned: "Reading recommendation strength matches finalScore, readingTier, and evidence maturity.",
  readerLanguageChinese: "Every reader-facing field is written in Simplified Chinese, except paper titles and indispensable technical terms."
};

const paperSemanticQaOutputSchema = {
  paperId: "same paperId as input",
  verdict: "pass | repair_required",
  summary: "Concise administrator-facing QA conclusion",
  checks: Object.fromEntries(Object.keys(paperSemanticQaChecks).map((key) => [key, true])),
  issues: [{
    code: "unsupported_fact | method_mismatch | experiment_mismatch | unsupported_number | affiliation_mismatch | limitation_gap | recommendation_tone_mismatch | reader_language_mismatch | cross_paper_contamination | evidence_boundary | other",
    severity: "high | medium | low",
    field: "paperDraft field path",
    claim: "Problematic reader-facing claim",
    reason: "Why it conflicts with the supplied Evidence or publication metadata",
    evidenceRefs: ["field:index"]
  }]
};

const semanticGroundedText = (value = {}) => ({
  text: String(value?.text || ""),
  evidenceRefs: (Array.isArray(value?.evidenceRefs) ? value.evidenceRefs : []).map(String)
});

const paperSemanticDraft = (paperDraft = {}) => ({
  paperId: String(paperDraft?.paperId || ""),
  oneSentenceTakeaway: semanticGroundedText(paperDraft?.oneSentenceTakeaway),
  researchProblem: semanticGroundedText(paperDraft?.researchProblem),
  coreContribution: semanticGroundedText(paperDraft?.coreContribution),
  methodFramework: semanticGroundedText(paperDraft?.methodFramework),
  experimentsAndResults: semanticGroundedText(paperDraft?.experimentsAndResults),
  limitationsAndConstraints: (Array.isArray(paperDraft?.limitationsAndConstraints)
    ? paperDraft.limitationsAndConstraints
    : []).map(semanticGroundedText),
  adnInsight: semanticGroundedText(paperDraft?.adnInsight),
  readingValue: {
    whyWorthReading: semanticGroundedText(paperDraft?.readingValue?.whyWorthReading),
    recommendedFocus: semanticGroundedText(paperDraft?.readingValue?.recommendedFocus),
    evidenceBoundary: semanticGroundedText(paperDraft?.readingValue?.evidenceBoundary)
  },
  publicationMeta: {
    affiliations: (Array.isArray(paperDraft?.publicationMeta?.affiliations)
      ? paperDraft.publicationMeta.affiliations
      : []).map(String),
    finalScore: Number(paperDraft?.publicationMeta?.finalScore),
    readingTier: String(paperDraft?.publicationMeta?.readingTier || "")
  }
});

const paperSemanticQaRules = [
  "Review only this paperDraft against this paper's bound Evidence excerpts.",
  "Do not use outside knowledge, the abstract, original full text, prior analysis, or any other paper.",
  "Evaluate facts, method, experiments, exact numbers, affiliations, limitations, and recommendation tone separately.",
  "A cited Evidence ref does not make an unsupported claim valid; compare the actual claim with the cited excerpt.",
  "Evidence summaries and Value Signals are not substitutes for their cited excerpts. Reject factual premises that appear only in a summary or Value Signal, including claims about complete observations, fully observable future pressure, hidden-information complexity, heuristic opponent controllers, or other setup details absent from the cited excerpts.",
  "paperDraft evidenceRefs are an unordered field-level support set, not a one-to-one positional mapping to sentences. A sentence is grounded when any listed ref clearly supports it.",
  "Evaluate evidence boundaries across the whole paperDraft. If limitationsAndConstraints or readingValue.evidenceBoundary already states a limitation clearly, do not require the same caveat to be repeated in experimentsAndResults or report it as missing there.",
  "Audit every sentence and every qualifier independently. A citation's existence is not semantic support.",
  "Allow faithful Chinese translation and directly entailed paraphrase; do not require the draft to repeat the excerpt's exact terminology.",
  "Reject qualifiers such as only, no tuning, heavy reliance, bias, production-ready, or causal language unless the cited excerpt clearly entails that exact boundary.",
  "Review reasons, weaknesses, uncertainty, calibration comments, and selection metadata are not factual support. Flag any factual claim derived only from them.",
  "Treat stronger claims than the supplied evidence boundary as issues.",
  "Preserve time-horizon qualifiers exactly: medium-horizon or linked multi-encounter evidence does not support 中长期, 长期, 长周期, long-term, or long-horizon claims.",
  "Treat a missing population qualifier as an evidence-boundary issue: strongest, best-performing, subset, or named-model results cannot be generalized to all frontier models.",
  "All reader-facing fields must be Simplified Chinese, except paper titles and indispensable technical terms.",
  "Treat metaphorical, personified, slogan-like, promotional, or rhetorical wording as a recommendation-tone issue; require direct technical description.",
  "Set every check explicitly. Return pass only when every check is true and issues is empty.",
  "Every false check must have a corresponding detailed issue using its check-specific code; do not return a false check without an actionable claim and reason.",
  "Do not rewrite the paperDraft. Return one JSON object only, without Markdown fences."
];

const basePaperSemanticQaPayload = ({ task, item = {}, paperDraft = {} }) => ({
  task,
  agentRole: "paper_semantic_qa",
  paper: {
    paperId: String(item?.evidenceCard?.paperId || item?.contextPacket?.paperId || item?.paper?.id || "")
  },
  paperDraft: paperSemanticDraft(paperDraft),
  evidence: paperSectionEvidence(item),
  requiredChecks: paperSemanticQaChecks,
  rules: paperSemanticQaRules,
  outputSchema: paperSemanticQaOutputSchema
});

export const buildPaperSemanticQaPrompt = ({ item, paperDraft } = {}) => JSON.stringify(
  basePaperSemanticQaPayload({ task: "weekly_report_paper_semantic_qa", item, paperDraft })
);

export const buildPaperSemanticQaRepairPrompt = ({ item, paperDraft, issues = [] } = {}) => JSON.stringify({
  ...basePaperSemanticQaPayload({
    task: "weekly_report_paper_semantic_qa_response_repair",
    item,
    paperDraft
  }),
  repairInstruction: "Regenerate the complete QA result and correct only the listed response validation classes. Do not rewrite the paperDraft.",
  issues: (Array.isArray(issues) ? issues : []).slice(0, 40).map((itemIssue) => ({
    code: String(itemIssue?.code || "paper_semantic_qa_schema_invalid"),
    path: String(itemIssue?.path || "")
  }))
});

const normalizedContentRepairIssues = (issues = []) => (
  (Array.isArray(issues) ? issues : []).slice(0, 40).map((itemIssue) => ({
    code: String(itemIssue?.code || "qa_content_issue"),
    path: String(itemIssue?.path || itemIssue?.field || ""),
    claim: String(itemIssue?.claim || ""),
    reason: String(itemIssue?.reason || itemIssue?.message || ""),
    evidenceRefs: (Array.isArray(itemIssue?.evidenceRefs) ? itemIssue.evidenceRefs : []).map(String),
    supportingPaperIds: (Array.isArray(itemIssue?.supportingPaperIds)
      ? itemIssue.supportingPaperIds
      : []).map(String)
  }))
);

export const buildPaperSectionQaRepairPrompt = ({ item, paperDraft, issues = [] } = {}) => JSON.stringify({
  ...basePaperSectionPayload({ task: "weekly_report_repair_paper_section", item }),
  currentPaperDraft: paperSemanticDraft(paperDraft),
  repairInstruction: "Regenerate this paper's complete paperDraft. Correct only the normalized QA issues while preserving all supported content and evidence boundaries.",
  issues: normalizedContentRepairIssues(issues)
});

export const buildPaperSectionQaRepairResponsePrompt = ({
  item,
  paperDraft,
  issues = [],
  responseIssues = []
} = {}) => JSON.stringify({
  ...basePaperSectionPayload({ task: "weekly_report_repair_paper_section_response", item }),
  currentPaperDraft: paperSemanticDraft(paperDraft),
  repairInstruction: "Regenerate the complete repaired paperDraft and correct the response validation classes. Do not broaden the requested content repair.",
  issues: normalizedContentRepairIssues(issues),
  responseValidationIssues: (Array.isArray(responseIssues) ? responseIssues : []).slice(0, 40)
    .map((itemIssue) => ({
      code: String(itemIssue?.code || "paper_section_validation_failed"),
      path: String(itemIssue?.path || "")
    }))
});

const headTailPaper = (item = {}, paperDrafts = []) => {
  const paperId = String(item?.reviewResult?.paperId || item?.contextPacket?.paperId || item?.paper?.id || "")
    .replace(/v\d+$/i, "");
  const draft = (Array.isArray(paperDrafts) ? paperDrafts : []).find((entry) => (
    String(entry?.paperId || "").replace(/v\d+$/i, "") === paperId
  )) || {};
  return {
    paperId,
    title: String(draft?.publicationMeta?.title || item?.paper?.title || ""),
    selection: {
      finalScore: Number(item?.selection?.finalScore),
      readingTier: String(item?.selection?.readingTier || ""),
      rank: Number(item?.selection?.rank)
    },
    oneSentenceTakeaway: String(draft?.oneSentenceTakeaway?.text || ""),
    limitationsAndConstraints: (Array.isArray(draft?.limitationsAndConstraints)
      ? draft.limitationsAndConstraints
      : []).map((entry) => String(entry?.text || "")),
    readingValue: {
      whyWorthReading: String(draft?.readingValue?.whyWorthReading?.text || ""),
      recommendedFocus: String(draft?.readingValue?.recommendedFocus?.text || ""),
      evidenceBoundary: String(draft?.readingValue?.evidenceBoundary?.text || "")
    }
  };
};

const headTailOutputSchema = {
  titleAngle: "Specific 18-32 character technical viewpoint used after the deterministic weekly title prefix",
  description: "Concise report description, at most 55 characters",
  tags: ["one to five concise reader-facing topic tags"],
  reportIntroduction: "Grounded report introduction",
  trendJudgments: [{
    trendIndex: "zero-based index of one supplied editorialPlan trend",
    claim: "Reader-facing expression of that trend",
    caveat: "Reader-facing boundary of that trend"
  }],
  singlePaperObservations: [{
    observationIndex: "zero-based index of one supplied single-paper observation",
    claim: "Reader-facing expression that remains a single-paper observation",
    caveat: "Reader-facing boundary"
  }],
  readingOrder: [{
    paperId: "selected paperId in the supplied order",
    reason: "Concise evidence-bounded reason to read it at this position"
  }],
  closingSummary: "Concise closing reading guidance"
};

const headTailRules = [
  "Use only editorialPlan and the supplied compact selected-paper artifacts. No paper original text, excerpts, abstracts, or outside knowledge is available.",
  "Write every reader-facing field in Simplified Chinese; paper titles and indispensable technical terms may remain in their original language.",
  "Use neutral, literal technical prose throughout. State the topic and findings directly; avoid metaphors, personification, rhetorical contrast patterns such as X is not Y, slogans, and promotional AI-style wording. Do not use 揭示/reveal, 赋能/unlock, 重塑/reshape, or claims of 坚实量化证据.",
  "Preserve strongest, best-performing, subset, and named-model qualifiers from the supplied artifacts. Do not generalize them to frontier models or models as a whole.",
  "Keep commercial-VLM long-document results scoped to commercial VLMs and retain named extraction-system counterexamples. Do not generalize them to current or most systems.",
  "Preserve track-specific metrics. Encounter win rates and Day clear counts must remain separate; do not attach win rate to Day or cross-day outcomes without direct support.",
  "Preserve the evaluated object type. A mixed cohort of VLMs, extraction tools, coding agents, and APIs must remain methods or systems, not frontier models.",
  "Do not confuse frontier-model ensembles used to construct or annotate a dataset with the mixed cohort evaluated by that benchmark. A grounded construction method may retain frontier-model ensembles; the evaluated VLM/tool/agent/API cohort must still be called methods or systems.",
  "For a one-paper report, closingSummary must provide a distinct final reading focus and must not copy the compact paperDraft recommendedFocus or repeat the same result sentence.",
  "Preserve time-horizon scope from the supplied artifacts. Do not expand medium-horizon or multi-encounter findings to 中长期, 长期, 长周期, long-term, or long-horizon, and do not use 中时间跨度.",
  "Keep single-encounter distinct from single-step. Use 跨战斗保留的生命值 for persistent hit points and 战斗日 or Day 场景 for cleared encounter days; do not use 持续生命值 or 日程.",
  "Review reasons, weaknesses, uncertainty, and calibration comments are not factual support. Do not promote them into report claims unless the supplied validated paper artifacts independently support them.",
  "Preserve resource budgeting as 资源预算 rather than the broader 资源管理. Do not introduce deterministic engines, persistent-state or short-rest mechanics, or separation from basic rules parsing unless those premises exist in the supplied validated artifacts.",
  "Return every supplied trend and single-paper observation exactly once by its zero-based source index.",
  "Do not promote a single-paper observation into a weekly trend.",
  "For a one-paper report, assign distinct roles to the reader-facing fields: reportIntroduction states the problem and reading entry; the single-paper observation states one useful result and one evidence boundary; closingSummary states only the final reading focus. Do not repeat the same method or result across these fields.",
  "Do not introduce an exact number unless it already occurs in the corresponding plan entry or supplied compact artifact.",
  "readingOrder must contain every selected paper exactly once in the supplied rank order.",
  "The title angle must be specific and must not use generic slogans such as new paradigm, worth watching, or accelerated adoption.",
  "titleAngle must be a standalone technical claim. Do not prefix it with a selected paper, benchmark, or product name followed by a colon.",
  "Count titleAngle by Unicode characters before returning. It must contain 18-32 characters inclusive; prefer 20-28 characters so a repair does not cross either boundary.",
  "Use complete Chinese condition phrases. Write 在奖励函数未知的情况下; do not write 旨在奖励函数未知的情况下.",
  "Do not mention selection mechanics, score cutoffs, review or calibration workflow, Agent stages, prompts, artifacts, or internal JSON.",
  "Do not return YAML, Markdown headings, a complete paper list, a footer, paper body sections, scores, or links; the server owns them.",
  "Return one JSON object only, without Markdown fences."
];

const baseHeadTailPayload = ({
  task,
  editorialPlan = {},
  selectedItems = [],
  paperDrafts = []
}) => ({
  task,
  agentRole: "editorial_head_tail_writer",
  editorialPlan,
  papers: (Array.isArray(selectedItems) ? selectedItems : []).map((item) => (
    headTailPaper(item, paperDrafts)
  )),
  publicationConstraints: {
    titleAngleUnicodeCharacters: { minimum: 18, maximum: 32, preferredMinimum: 20, preferredMaximum: 28 },
    descriptionUnicodeCharacters: { maximum: 55 }
  },
  rules: headTailRules,
  outputSchema: headTailOutputSchema
});

export const buildHeadTailPrompt = (options = {}) => JSON.stringify(
  baseHeadTailPayload({ task: "weekly_report_write_head_tail", ...options })
);

export const buildHeadTailRepairPrompt = ({ issues = [], ...options } = {}) => JSON.stringify({
  ...baseHeadTailPayload({ task: "weekly_report_write_head_tail_repair", ...options }),
  repairInstruction: "Regenerate the complete headTailDraft and correct only the listed validation classes. Count titleAngle by Unicode characters before returning and keep it within the explicit publicationConstraints range.",
  issues: (Array.isArray(issues) ? issues : []).slice(0, 40)
    .map((itemIssue) => writingRepairIssue(itemIssue, "head_tail_validation_failed"))
});

export const buildHeadTailResponseRepairPrompt = ({
  issues = [],
  responseIssues = [],
  ...options
} = {}) => JSON.stringify({
  ...baseHeadTailPayload({ task: "weekly_report_write_head_tail_response_repair", ...options }),
  repairInstruction: "Regenerate the complete headTailDraft with valid JSON and schema. Preserve the original content-repair scope when issues are present; do not introduce a second or broader content repair. Revalidate the complete result and do not reproduce or depend on the prior malformed raw response.",
  issues: (Array.isArray(issues) ? issues : []).slice(0, 40)
    .map((itemIssue) => writingRepairIssue(itemIssue, "head_tail_validation_failed")),
  responseValidationIssues: (Array.isArray(responseIssues) ? responseIssues : []).slice(0, 40)
    .map((itemIssue) => ({
      code: String(itemIssue?.code || "head_tail_response_invalid"),
      path: String(itemIssue?.path || "response")
    }))
});

const reportSemanticQaChecks = {
  titleGrounded: "The final title is specifically supported by the selected cohort.",
  introductionGrounded: "The report introduction accurately represents the selected papers and their boundaries.",
  trendsMultiPaperGrounded: "Every weekly trend is supported by at least two selected papers.",
  observationsNotPromoted: "Single-paper observations remain explicitly scoped and are not presented as cohort trends.",
  readingOrderAligned: "Reading order and reasons align with rank, tier, score, and reader value.",
  headTailIsolated: "Title, introduction, trends, order guidance, and closing contain no unselected or other-week paper.",
  readerLanguageChinese: "Every reader-facing report field is written in Simplified Chinese, except paper titles and indispensable technical terms."
};

const reportSemanticQaOutputSchema = {
  verdict: "pass | repair_required",
  summary: "Concise administrator-facing report QA conclusion",
  checks: Object.fromEntries(Object.keys(reportSemanticQaChecks).map((key) => [key, true])),
  issues: [{
    code: "title_not_grounded | introduction_not_grounded | trend_not_multi_paper | observation_promoted_to_trend | reading_order_mismatch | head_tail_contamination | reader_language_mismatch | evidence_boundary | other",
    severity: "high | medium | low",
    field: "headTailDraft or report field path",
    claim: "Problematic report-level claim",
    reason: "Why the claim, scope, or order conflicts with the supplied cohort artifacts",
    supportingPaperIds: ["selected paperId"]
  }]
};

const compactEditorialPlanForQa = (editorialPlan = {}) => ({
  coreTheme: String(editorialPlan?.coreTheme || ""),
  titleAngle: String(editorialPlan?.titleAngle || ""),
  trends: (Array.isArray(editorialPlan?.trends) ? editorialPlan.trends : []).map((entry) => ({
    claim: String(entry?.claim || ""),
    supportingPaperIds: (Array.isArray(entry?.supportingPaperIds)
      ? entry.supportingPaperIds
      : []).map(String),
    evidenceRefs: (Array.isArray(entry?.evidenceRefs) ? entry.evidenceRefs : []).map(String),
    maturity: String(entry?.maturity || ""),
    caveat: String(entry?.caveat || "")
  })),
  singlePaperObservations: (Array.isArray(editorialPlan?.singlePaperObservations)
    ? editorialPlan.singlePaperObservations
    : []).map((entry) => ({
    paperId: String(entry?.paperId || ""),
    claim: String(entry?.claim || ""),
    evidenceRefs: (Array.isArray(entry?.evidenceRefs) ? entry.evidenceRefs : []).map(String),
    caveat: String(entry?.caveat || "")
  })),
  readingOrder: (Array.isArray(editorialPlan?.readingOrder) ? editorialPlan.readingOrder : []).map((entry) => ({
    paperId: String(entry?.paperId || ""),
    reason: String(entry?.reason || "")
  }))
});

const compactHeadTailForQa = (headTailDraft = {}) => ({
  titleAngle: String(headTailDraft?.titleAngle || ""),
  description: String(headTailDraft?.description || ""),
  reportIntroduction: String(headTailDraft?.reportIntroduction || ""),
  trendJudgments: (Array.isArray(headTailDraft?.trendJudgments)
    ? headTailDraft.trendJudgments
    : []).map((entry) => ({
    trendIndex: Number(entry?.trendIndex),
    claim: String(entry?.claim || ""),
    caveat: String(entry?.caveat || ""),
    supportingPaperIds: (Array.isArray(entry?.supportingPaperIds)
      ? entry.supportingPaperIds
      : []).map(String),
    evidenceRefs: (Array.isArray(entry?.evidenceRefs) ? entry.evidenceRefs : []).map(String),
    maturity: String(entry?.maturity || "")
  })),
  singlePaperObservations: (Array.isArray(headTailDraft?.singlePaperObservations)
    ? headTailDraft.singlePaperObservations
    : []).map((entry) => ({
    observationIndex: Number(entry?.observationIndex),
    paperId: String(entry?.paperId || ""),
    claim: String(entry?.claim || ""),
    caveat: String(entry?.caveat || ""),
    evidenceRefs: (Array.isArray(entry?.evidenceRefs) ? entry.evidenceRefs : []).map(String)
  })),
  readingOrder: (Array.isArray(headTailDraft?.readingOrder) ? headTailDraft.readingOrder : []).map((entry) => ({
    paperId: String(entry?.paperId || ""),
    reason: String(entry?.reason || "")
  })),
  closingSummary: String(headTailDraft?.closingSummary || "")
});

export const buildHeadTailQaRepairPrompt = ({
  editorialPlan = {},
  selectedItems = [],
  paperDrafts = [],
  headTailDraft = {},
  issues = []
} = {}) => JSON.stringify({
  ...baseHeadTailPayload({
    task: "weekly_report_repair_head_tail",
    editorialPlan,
    selectedItems,
    paperDrafts
  }),
  currentHeadTailDraft: compactHeadTailForQa(headTailDraft),
  repairInstruction: "Regenerate the complete Head/Tail draft. Correct only the normalized report QA issues and preserve supported unaffected content.",
  issues: normalizedContentRepairIssues(issues)
});

export const buildHeadTailQaRepairResponsePrompt = ({
  editorialPlan = {},
  selectedItems = [],
  paperDrafts = [],
  headTailDraft = {},
  issues = [],
  responseIssues = []
} = {}) => JSON.stringify({
  ...baseHeadTailPayload({
    task: "weekly_report_repair_head_tail_response",
    editorialPlan,
    selectedItems,
    paperDrafts
  }),
  currentHeadTailDraft: compactHeadTailForQa(headTailDraft),
  repairInstruction: "Regenerate the complete repaired Head/Tail draft and correct the response validation classes. Do not broaden the requested report repair.",
  issues: normalizedContentRepairIssues(issues),
  responseValidationIssues: (Array.isArray(responseIssues) ? responseIssues : []).slice(0, 40)
    .map((itemIssue) => ({
      code: String(itemIssue?.code || "head_tail_validation_failed"),
      path: String(itemIssue?.path || "")
    }))
});

const reportSemanticQaRules = [
  "Review report-level narrative only. Per-paper factual grounding has already been checked separately.",
  "Use only the supplied validated Editorial Plan, final Head/Tail draft, server report metadata, and compact selected-paper reading artifacts.",
  "Do not use outside knowledge, abstracts, original paper text, Evidence excerpts, old analysis, or unselected papers.",
  "A weekly trend requires support from at least two selected papers; keep single-paper observations scoped to one paper.",
  "Judge reading order against the supplied deterministic rank, reading tier, final score, reading value, and evidence boundary.",
  "Audit every report sentence independently. A claim copied from an editorial plan or review is still invalid when the supplied validated paper artifacts do not support it.",
  "Review reasons, weaknesses, uncertainty, and calibration comments are editorial aids, not factual support; flag any promoted speculation or stronger qualifier.",
  "All reader-facing report fields must be Simplified Chinese, except paper titles and indispensable technical terms.",
  "Flag metaphorical, personified, slogan-like, promotional, or rhetorical report wording; the report must use direct technical description.",
  "Flag population-scope broadening: strongest, best-performing, subset, or named-model results must not be restated as applying to frontier models or models as a whole.",
  "Set every check explicitly. Return pass only when every check is true and issues is empty.",
  "Do not rewrite the Head/Tail draft. Return one JSON object only, without Markdown fences."
];

const baseReportSemanticQaPayload = ({
  task,
  report = {},
  editorialPlan = {},
  headTailDraft = {},
  selectedItems = [],
  paperDrafts = []
}) => ({
  task,
  agentRole: "report_semantic_qa",
  report: {
    title: String(report?.title || ""),
    description: String(report?.description || "")
  },
  editorialPlan: compactEditorialPlanForQa(editorialPlan),
  headTailDraft: compactHeadTailForQa(headTailDraft),
  papers: (Array.isArray(selectedItems) ? selectedItems : []).map((item) => (
    headTailPaper(item, paperDrafts)
  )),
  requiredChecks: reportSemanticQaChecks,
  rules: reportSemanticQaRules,
  outputSchema: reportSemanticQaOutputSchema
});

export const buildReportSemanticQaPrompt = (options = {}) => JSON.stringify(
  baseReportSemanticQaPayload({ task: "weekly_report_report_semantic_qa", ...options })
);

export const buildReportSemanticQaRepairPrompt = ({ issues = [], ...options } = {}) => JSON.stringify({
  ...baseReportSemanticQaPayload({
    task: "weekly_report_report_semantic_qa_response_repair",
    ...options
  }),
  repairInstruction: "Regenerate the complete QA result and correct only the listed response validation classes. Do not rewrite the report.",
  issues: (Array.isArray(issues) ? issues : []).slice(0, 40).map((itemIssue) => ({
    code: String(itemIssue?.code || "report_semantic_qa_schema_invalid"),
    path: String(itemIssue?.path || "")
  }))
});
