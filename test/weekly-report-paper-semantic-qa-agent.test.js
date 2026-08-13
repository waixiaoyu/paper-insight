import assert from "node:assert/strict";
import test from "node:test";
import {
  PaperSemanticQaError,
  reviewPaperSemantics,
  reviewPaperSemanticsBatch
} from "../weekly-report/paper-semantic-qa-agent.js";
import {
  buildPaperSemanticQaPrompt,
  buildPaperSemanticQaRepairPrompt
} from "../weekly-report/prompts.js";

const source = (anchor, section, excerpt) => ({ anchor, section, excerpt });

const itemFor = (paperId) => ({
  paper: {
    id: paperId,
    title: `Trusted ${paperId}`,
    summary: "ABSTRACT_MUST_NOT_ENTER_QA",
    analysis: { secret: "OLD_ANALYSIS_MUST_NOT_ENTER_QA" }
  },
  contextPacket: {
    paperId,
    inputText: "FULL_ORIGINAL_TEXT_MUST_NOT_ENTER_QA",
    inputSections: [{ text: "FULL_SOURCE_SECTION_MUST_NOT_ENTER_QA" }]
  },
  evidenceCard: {
    paperId,
    problem: {
      summary: "Autonomous actions need pre-execution safety checks.",
      status: "supported",
      sources: [source("S1", "Introduction", "Autonomous actions need pre-execution safety checks.")]
    },
    method: {
      summary: "A guardrail validates actions before execution.",
      status: "supported",
      sources: [source("S2", "Method", "A guardrail validates actions before execution.")]
    },
    systemDesign: {
      summary: "The guardrail sits between planning and execution.",
      status: "supported",
      sources: [source("S2", "Method", "The guardrail sits between planning and execution.")]
    },
    experiments: {
      summary: "The evaluation uses 120 simulated scenarios.",
      status: "supported",
      sources: [source("S3", "Evaluation", "We evaluate 120 simulated scenarios.")]
    },
    results: {
      summary: "Unsafe actions are reduced by 37%.",
      status: "supported",
      sources: [source("S4", "Results", "Unsafe actions are reduced by 37%.")]
    },
    limitations: {
      summary: "Production traffic and latency are not evaluated.",
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
  selection: {
    selectionReason: "threshold",
    thresholdMet: true
  }
});

const grounded = (text, evidenceRefs) => ({ text, evidenceRefs });

const draftFor = (paperId) => ({
  paperId,
  oneSentenceTakeaway: grounded("A guardrail validates autonomous actions before execution.", ["method:0"]),
  researchProblem: grounded("Autonomous actions need pre-execution safety checks.", ["problem:0"]),
  coreContribution: grounded("The work adds an explicit pre-execution guardrail.", ["method:0"]),
  methodFramework: grounded("The guardrail sits between planning and execution.", ["method:0", "systemDesign:0"]),
  experimentsAndResults: grounded("Across 120 simulated scenarios, unsafe actions are reduced by 37%.", ["experiments:0", "results:0"]),
  limitationsAndConstraints: [
    grounded("Production traffic is not evaluated.", ["limitations:0"]),
    grounded("Validation latency is not quantified.", ["limitations:1"])
  ],
  adnInsight: grounded("The mechanism may constrain autonomous network actions.", ["method:0"]),
  readingValue: {
    whyWorthReading: grounded("It provides a concrete action-validation mechanism.", ["method:0"]),
    recommendedFocus: grounded("Focus on the guardrail and simulation boundary.", ["method:0", "experiments:0"]),
    evidenceBoundary: grounded("Production applicability remains unresolved.", ["limitations:0"])
  },
  publicationMeta: {
    title: "Trusted title",
    affiliations: ["Example University"],
    finalScore: 82,
    readingTier: "must_read"
  }
});

const checks = (override = {}) => ({
  factsGrounded: true,
  methodGrounded: true,
  experimentsGrounded: true,
  numbersGrounded: true,
  affiliationsGrounded: true,
  limitationsGrounded: true,
  recommendationToneAligned: true,
  readerLanguageChinese: true,
  ...override
});

const passResponse = (paperId) => ({
  paperId,
  verdict: "pass",
  summary: "The section is grounded and preserves the evidence boundary.",
  checks: checks(),
  issues: []
});

test("Paper Semantic QA prompt contains one draft and bound Evidence excerpts only", () => {
  const item = itemFor("2608.10001");
  const prompt = buildPaperSemanticQaPrompt({ item, paperDraft: draftFor(item.paper.id) });
  const parsed = JSON.parse(prompt);
  const serialized = JSON.stringify(parsed);

  assert.equal(parsed.task, "weekly_report_paper_semantic_qa");
  assert.equal(parsed.agentRole, "paper_semantic_qa");
  assert.equal(parsed.paper.paperId, "2608.10001");
  assert.match(parsed.rules.join(" "), /citation's existence is not semantic support/i);
  assert.match(parsed.rules.join(" "), /Review reasons.*not factual support/i);
  assert.match(parsed.rules.join(" "), /Simplified Chinese/i);
  assert.match(parsed.rules.join(" "), /unordered field-level support set/i);
  assert.match(parsed.rules.join(" "), /across the whole paperDraft/i);
  assert.match(parsed.rules.join(" "), /do not require the same caveat to be repeated/i);
  assert.match(parsed.rules.join(" "), /Evidence summaries and Value Signals are not substitutes/i);
  assert.match(parsed.rules.join(" "), /fully observable future pressure/i);
  assert.match(parsed.rules.join(" "), /medium-horizon.*does not support/i);
  assert.match(parsed.rules.join(" "), /faithful Chinese translation and directly entailed paraphrase/i);
  assert.match(parsed.rules.join(" "), /metaphorical, personified, slogan-like/i);
  assert.equal(parsed.paperDraft.paperId, "2608.10001");
  assert.match(serialized, /Unsafe actions are reduced by 37%/);
  assert.doesNotMatch(serialized, /ABSTRACT_MUST_NOT_ENTER_QA/);
  assert.doesNotMatch(serialized, /OLD_ANALYSIS_MUST_NOT_ENTER_QA/);
  assert.doesNotMatch(serialized, /FULL_ORIGINAL_TEXT_MUST_NOT_ENTER_QA/);
  assert.doesNotMatch(serialized, /selectionReason|thresholdMet/);
});

test("Paper Semantic QA accepts a fully grounded paper without consuming repair_once", async () => {
  const item = itemFor("2608.10002");
  const result = await reviewPaperSemantics({
    item,
    paperDraft: draftFor(item.paper.id),
    networkRetryDelayMs: 0,
    callModel: async () => passResponse(item.paper.id)
  });

  assert.equal(result.qaResult.status, "passed");
  assert.equal(result.qaResult.repairTarget, null);
  assert.equal(result.responseRepairAttempted, false);
  assert.equal(result.calls.length, 1);
});

test("Paper Semantic QA deterministically blocks an English body when zh-CN is required", async () => {
  const item = itemFor("2608.10002-zh");
  const result = await reviewPaperSemantics({
    item,
    paperDraft: draftFor(item.paper.id),
    requiredLanguage: "zh-CN",
    networkRetryDelayMs: 0,
    callModel: async () => passResponse(item.paper.id)
  });

  assert.equal(result.qaResult.status, "repair_required");
  assert.equal(result.qaResult.checks.readerLanguageChinese, false);
  assert.equal(result.qaResult.issues.some((issue) => issue.code === "reader_language_mismatch"), true);
});

test("Paper Semantic QA keeps cited-but-not-entailed claims repairable", async () => {
  const item = itemFor("2608.10002-boundary");
  const result = await reviewPaperSemantics({
    item,
    paperDraft: draftFor(item.paper.id),
    networkRetryDelayMs: 0,
    callModel: async () => ({
      ...passResponse(item.paper.id),
      verdict: "repair_required",
      checks: checks({ factsGrounded: false }),
      issues: [{
        code: "unsupported_fact",
        severity: "high",
        field: "readingValue.evidenceBoundary",
        claim: "The benchmark used list prices and no task-specific tuning.",
        reason: "The cited excerpts contain neither qualifier, even though the refs exist.",
        evidenceRefs: ["problem:0", "results:0"]
      }]
    })
  });

  assert.equal(result.qaResult.status, "repair_required");
  assert.equal(result.qaResult.issues[0].field, "readingValue.evidenceBoundary");
  assert.deepEqual(result.qaResult.issues[0].evidenceRefs, ["problem:0", "results:0"]);
});

test("a failed semantic check overrides a model-requested pass and targets only that paper section", async () => {
  const item = itemFor("2608.10003");
  const result = await reviewPaperSemantics({
    item,
    paperDraft: draftFor(item.paper.id),
    networkRetryDelayMs: 0,
    callModel: async () => ({
      ...passResponse(item.paper.id),
      checks: checks({ numbersGrounded: false }),
      issues: [{
        code: "unsupported_number",
        severity: "high",
        field: "experimentsAndResults",
        claim: "The reported number is not supported.",
        reason: "The cited excerpt does not contain it.",
        evidenceRefs: ["results:0"]
      }]
    })
  });

  assert.equal(result.qaResult.status, "repair_required");
  assert.equal(result.qaResult.paperId, "2608.10003");
  assert.equal(result.qaResult.repairTarget, "paper_section");
  assert.equal(result.qaResult.issues[0].code, "unsupported_number");
});

test("invalid QA output gets one schema repair without carrying its prior raw response", async () => {
  const item = itemFor("2608.10004");
  const prompts = [];
  const result = await reviewPaperSemantics({
    item,
    paperDraft: draftFor(item.paper.id),
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      prompts.push(JSON.parse(prompt));
      return prompts.length === 1 ? { paperId: item.paper.id } : passResponse(item.paper.id);
    }
  });

  assert.equal(result.qaResult.status, "passed");
  assert.equal(result.responseRepairAttempted, true);
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].task, "weekly_report_paper_semantic_qa_response_repair");
  assert.equal("priorResponse" in prompts[1], false);
  assert.equal(Array.isArray(prompts[1].issues), true);
  assert.equal(prompts[1].issues.every((issue) => Object.keys(issue).every((key) => ["code", "path"].includes(key))), true);
});

test("a false QA check without its detailed issue uses response repair instead of content repair", async () => {
  const item = itemFor("2608.10004-false-check");
  const prompts = [];
  const result = await reviewPaperSemantics({
    item,
    paperDraft: draftFor(item.paper.id),
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      prompts.push(JSON.parse(prompt));
      if (prompts.length === 1) {
        return {
          ...passResponse(item.paper.id),
          verdict: "repair_required",
          checks: checks({ recommendationToneAligned: false }),
          issues: [{
            code: "evidence_boundary",
            severity: "medium",
            field: "adnInsight",
            reason: "A factual qualifier is broader than its excerpt.",
            evidenceRefs: ["method:0"]
          }]
        };
      }
      return passResponse(item.paper.id);
    }
  });

  assert.equal(result.qaResult.status, "passed");
  assert.equal(result.responseRepairAttempted, true);
  assert.equal(prompts[1].task, "weekly_report_paper_semantic_qa_response_repair");
});

test("Paper Semantic QA batch uses finite concurrency and preserves paper order", async () => {
  const items = ["2608.10005", "2608.10006", "2608.10007"].map(itemFor);
  const drafts = items.map((item) => draftFor(item.paper.id));
  let active = 0;
  let maximumActive = 0;
  const result = await reviewPaperSemanticsBatch(items, drafts, {
    paperConcurrency: 2,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const paperId = JSON.parse(prompt).paper.paperId;
      await new Promise((resolve) => setTimeout(resolve, paperId.endsWith("5") ? 25 : 5));
      active -= 1;
      return passResponse(paperId);
    }
  });

  assert.equal(maximumActive, 2);
  assert.equal(result.concurrency, 2);
  assert.deepEqual(result.succeeded.map((entry) => entry.qaResult.paperId), items.map((item) => item.paper.id));
});

test("Paper Semantic QA batch matches an arXiv URL item to its canonical draft ID", async () => {
  const item = itemFor("https://arxiv.org/abs/2603.20986");
  const result = await reviewPaperSemanticsBatch([item], [draftFor("2603.20986")], {
    networkRetryDelayMs: 0,
    callModel: async () => passResponse("2603.20986")
  });

  assert.equal(result.failed.length, 0);
  assert.equal(result.succeeded.length, 1);
  assert.equal(result.succeeded[0].qaResult.paperId, "2603.20986");
});

test("a second invalid QA response fails closed", async () => {
  const item = itemFor("2608.10008");
  await assert.rejects(
    () => reviewPaperSemantics({
      item,
      paperDraft: draftFor(item.paper.id),
      networkRetryDelayMs: 0,
      callModel: async () => ({ paperId: item.paper.id })
    }),
    (error) => error instanceof PaperSemanticQaError
      && error.code === "READING_LIST_PAPER_QA_FAILED"
      && error.paperId === item.paper.id
  );
});

test("Paper Semantic QA repair prompt helper carries only validation classes", () => {
  const item = itemFor("2608.10009");
  const prompt = JSON.parse(buildPaperSemanticQaRepairPrompt({
    item,
    paperDraft: draftFor(item.paper.id),
    issues: [{ code: "schema_missing", path: "checks", message: "SECRET_DETAIL" }]
  }));
  assert.deepEqual(prompt.issues, [{ code: "schema_missing", path: "checks" }]);
  assert.doesNotMatch(JSON.stringify(prompt), /SECRET_DETAIL/);
});
