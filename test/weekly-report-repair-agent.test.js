import assert from "node:assert/strict";
import test from "node:test";
import {
  RepairStageError,
  repairPaperSectionFromQa
} from "../weekly-report/repair-agent.js";
import {
  buildHeadTailQaRepairPrompt,
  buildPaperSectionQaRepairPrompt
} from "../weekly-report/prompts.js";

const source = (anchor, section, excerpt) => ({ anchor, section, excerpt });

const itemFor = (paperId) => ({
  paper: {
    id: paperId,
    title: `Trusted ${paperId}`,
    summary: "ABSTRACT_MUST_NOT_ENTER_REPAIR",
    analysis: { secret: "OLD_ANALYSIS_MUST_NOT_ENTER_REPAIR" }
  },
  contextPacket: {
    paperId,
    inputText: "FULL_ORIGINAL_TEXT_MUST_NOT_ENTER_REPAIR",
    inputSections: [{ text: "FULL_SECTION_MUST_NOT_ENTER_REPAIR" }]
  },
  evidenceCard: {
    paperId,
    problem: {
      summary: "Autonomous actions need safety checks.",
      status: "supported",
      sources: [source("S1", "Introduction", "Autonomous actions need safety checks.")]
    },
    method: {
      summary: "A guardrail validates actions.",
      status: "supported",
      sources: [source("S2", "Method", "A guardrail validates actions before execution.")]
    },
    systemDesign: {
      summary: "The guardrail sits before execution.",
      status: "supported",
      sources: [source("S2", "Method", "The guardrail sits before execution.")]
    },
    experiments: {
      summary: "Evaluation uses simulated scenarios.",
      status: "supported",
      sources: [source("S3", "Evaluation", "Evaluation uses simulated scenarios.")]
    },
    results: {
      summary: "Unsafe actions are reduced by 37%.",
      status: "supported",
      sources: [source("S4", "Results", "Unsafe actions are reduced by 37%.")]
    },
    limitations: {
      summary: "Production and latency remain unevaluated.",
      status: "supported",
      sources: [
        source("S5", "Limitations", "Production traffic is not evaluated."),
        source("S5", "Limitations", "Validation latency is not quantified.")
      ]
    },
    affiliations: {
      summary: "Example University.",
      status: "supported",
      sources: [source("S0", "Metadata", "Alice Example, Example University")]
    },
    evidenceInsufficient: false,
    warnings: []
  },
  valueSignals: {
    paperId,
    signals: [{
      dimension: "methodNovelty",
      claim: "Pre-execution validation is reusable.",
      evidenceRefs: ["method:0"],
      readerImplication: "Read the mechanism.",
      adnImplication: { relevance: "direct", angle: "safety", insight: "Useful for safe autonomy.", limit: "Simulation only." },
      caveat: "No production deployment."
    }]
  },
  reviewResult: {
    paperId,
    evidenceValidation: { status: "pass", issues: [] },
    scores: { scenarioProblemValue: 82, methodNovelty: 86, practicalValue: 76, evidence: 70 },
    rawScore: 79,
    scoreReason: "Useful mechanism with limited evidence.",
    weakness: "No production evaluation.",
    uncertainty: "Transfer remains unclear.",
    interestFit: "target_network_autonomy",
    interestReason: "Relevant to autonomy safety.",
    affiliations: ["Example University"]
  },
  calibrationResult: {
    paperId,
    status: "consistent",
    relativePosition: "High in cohort.",
    suspectedMisjudgments: [],
    readingTier: "must_read",
    calibrationReason: "Consistent."
  },
  selection: {
    selected: true,
    selectionReason: "threshold",
    finalScore: 79,
    readingTier: "must_read",
    thresholdMet: true,
    rank: 1
  }
});

const grounded = (text, evidenceRefs) => ({ text, evidenceRefs });
const draftFor = (paperId, takeaway = "A guardrail validates autonomous actions before execution.") => ({
  paperId,
  oneSentenceTakeaway: grounded(takeaway, ["method:0"]),
  researchProblem: grounded("Autonomous actions need safety checks.", ["problem:0"]),
  coreContribution: grounded("The work adds a pre-execution guardrail.", ["method:0"]),
  methodFramework: grounded("The guardrail sits before execution.", ["method:0", "systemDesign:0"]),
  experimentsAndResults: grounded("In simulated scenarios, unsafe actions are reduced by 37%.", ["experiments:0", "results:0"]),
  limitationsAndConstraints: [
    grounded("Production traffic is not evaluated.", ["limitations:0"]),
    grounded("Validation latency is not quantified.", ["limitations:1"])
  ],
  adnInsight: grounded("The guardrail may constrain autonomous actions.", ["method:0"]),
  readingValue: {
    whyWorthReading: grounded("It provides a concrete validation mechanism.", ["method:0"]),
    recommendedFocus: grounded("Focus on the mechanism and evidence boundary.", ["method:0", "experiments:0"]),
    evidenceBoundary: grounded("Production applicability remains unresolved.", ["limitations:0"])
  }
});

test("paper QA repair prompt contains one current draft, normalized issue details, and bound Evidence only", () => {
  const item = itemFor("2608.30001");
  const parsed = JSON.parse(buildPaperSectionQaRepairPrompt({
    item,
    paperDraft: draftFor(item.paper.id),
    issues: [{
      code: "unsupported_fact",
      field: "coreContribution",
      claim: "Overstated contribution.",
      reason: "The Evidence only supports a guardrail.",
      evidenceRefs: ["method:0"]
    }]
  }));
  const serialized = JSON.stringify(parsed);

  assert.equal(parsed.task, "weekly_report_repair_paper_section");
  assert.equal(parsed.paper.paperId, "2608.30001");
  assert.equal(parsed.currentPaperDraft.paperId, "2608.30001");
  assert.equal(parsed.issues[0].reason, "The Evidence only supports a guardrail.");
  assert.doesNotMatch(serialized, /ABSTRACT_MUST_NOT_ENTER_REPAIR/);
  assert.doesNotMatch(serialized, /OLD_ANALYSIS_MUST_NOT_ENTER_REPAIR/);
  assert.doesNotMatch(serialized, /FULL_ORIGINAL_TEXT_MUST_NOT_ENTER_REPAIR/);
  assert.doesNotMatch(serialized, /selectionReason|thresholdMet/);
});

test("paper QA repair is validated, preserves server metadata, and records one content repair", async () => {
  const item = itemFor("2608.30002");
  const events = [];
  const result = await repairPaperSectionFromQa({
    item,
    paperDraft: draftFor(item.paper.id, "Overstated current draft."),
    issues: [{
      code: "unsupported_fact",
      field: "oneSentenceTakeaway",
      claim: "Overstated current draft.",
      reason: "Narrow the claim to the supplied method Evidence.",
      evidenceRefs: ["method:0"]
    }],
    networkRetryDelayMs: 0,
    onEvent: async (event) => events.push(event),
    callModel: async () => draftFor(item.paper.id)
  });

  assert.equal(result.paperDraft.oneSentenceTakeaway.text, "A guardrail validates autonomous actions before execution.");
  assert.equal(result.paperDraft.publicationMeta.finalScore, 79);
  assert.equal(result.responseRepairAttempted, false);
  assert.equal(result.calls.length, 1);
  assert.equal(events.some((event) => event.type === "model_call_started" && event.paperId === item.paper.id), true);
});

test("an invalid repaired paper gets one response-schema correction without broadening content issues", async () => {
  const item = itemFor("2608.30003");
  const prompts = [];
  const result = await repairPaperSectionFromQa({
    item,
    paperDraft: draftFor(item.paper.id),
    issues: [{ code: "limitation_gap", field: "limitationsAndConstraints", reason: "Add a second supported boundary." }],
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      prompts.push(JSON.parse(prompt));
      return prompts.length === 1 ? { paperId: item.paper.id } : draftFor(item.paper.id);
    }
  });

  assert.equal(result.responseRepairAttempted, true);
  assert.equal(prompts[1].task, "weekly_report_repair_paper_section_response");
  assert.equal(prompts[1].issues[0].code, "limitation_gap");
  assert.equal(prompts[1].responseValidationIssues.every((issue) => Object.keys(issue).every((key) => ["code", "path"].includes(key))), true);
  assert.equal("priorResponse" in prompts[1], false);
});

test("Head/Tail QA repair prompt carries compact cohort artifacts and normalized report issues", () => {
  const item = itemFor("2608.30004");
  const paperDraft = { ...draftFor(item.paper.id), publicationMeta: { title: item.paper.title, finalScore: 79, readingTier: "must_read", rank: 1 } };
  const parsed = JSON.parse(buildHeadTailQaRepairPrompt({
    editorialPlan: { coreTheme: "Grounded theme", titleAngle: "Grounded angle", trends: [], singlePaperObservations: [], readingOrder: [{ paperId: item.paper.id, reason: "First" }] },
    selectedItems: [item],
    paperDrafts: [paperDraft],
    headTailDraft: { titleAngle: "Current title", description: "Current description", tags: ["safety"], reportIntroduction: "Current intro", trendJudgments: [], singlePaperObservations: [], readingOrder: [{ paperId: item.paper.id, reason: "First" }], closingSummary: "Current close" },
    issues: [{ code: "title_not_grounded", field: "titleAngle", reason: "The title is broader than the cohort." }]
  }));
  const serialized = JSON.stringify(parsed);
  assert.equal(parsed.task, "weekly_report_repair_head_tail");
  assert.equal(parsed.currentHeadTailDraft.titleAngle, "Current title");
  assert.equal(parsed.issues[0].reason, "The title is broader than the cohort.");
  assert.doesNotMatch(serialized, /FULL_ORIGINAL_TEXT_MUST_NOT_ENTER_REPAIR/);
});

test("a repaired paper that remains invalid fails the only content repair", async () => {
  const item = itemFor("2608.30005");
  await assert.rejects(
    () => repairPaperSectionFromQa({
      item,
      paperDraft: draftFor(item.paper.id),
      issues: [{ code: "unsupported_fact", field: "coreContribution", reason: "Unsupported." }],
      networkRetryDelayMs: 0,
      callModel: async () => ({ paperId: item.paper.id })
    }),
    (error) => error instanceof RepairStageError
      && error.code === "READING_LIST_QA_REPAIR_FAILED"
      && error.paperId === item.paper.id
  );
});
