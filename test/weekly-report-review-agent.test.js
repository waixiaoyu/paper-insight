import assert from "node:assert/strict";
import test from "node:test";
import {
  ReviewAgentError,
  calculateReviewRawScore,
  reviewEvidenceBatch,
  runReviewAgent,
  validateReviewResult
} from "../weekly-report/review-agent.js";
import {
  buildReviewPrompt,
  buildReviewRepairPrompt
} from "../weekly-report/prompts.js";
import { buildEvidenceSourceRegistry } from "../weekly-report/evidence-source-registry.js";

const paperId = "2607.21001";

const contextPacketFor = (id = paperId) => ({
  paperId: id,
  source: "arxiv-html",
  status: "available",
  qualityGate: { passed: true, reasons: [] },
  inputSections: [
    {
      anchor: "S0",
      heading: "Paper metadata",
      kind: "metadata",
      text: "Paper metadata\n\nAlice Example, Example University"
    },
    {
      anchor: "S1",
      heading: "1 Introduction",
      kind: "introduction",
      text: "1 Introduction\n\nAutonomous agents can issue unsafe actions."
    },
    {
      anchor: "S2",
      heading: "2 Method",
      kind: "methodOrTheory",
      text: "2 Method\n\nThe guardrail validates every action before execution."
    },
    {
      anchor: "S3",
      heading: "3 Evaluation",
      kind: "experimentOrEvaluation",
      text: "3 Evaluation\n\nWe evaluate 120 simulated failure scenarios."
    },
    {
      anchor: "S4",
      heading: "4 Results",
      kind: "resultsOrDiscussion",
      text: "4 Results\n\nUnsafe actions are reduced by 37%."
    },
    {
      anchor: "S5",
      heading: "5 Limitations",
      kind: "limitations",
      text: "5 Limitations\n\nProduction traffic is not evaluated."
    }
  ]
});

const evidenceArtifactsFor = (id = paperId, { overstated = false } = {}) => ({
  evidenceCard: {
    paperId: id,
    problem: {
      summary: "Autonomous agents can issue unsafe actions.",
      status: "supported",
      sources: [{
        anchor: "S1",
        section: "1 Introduction",
        excerpt: "Autonomous agents can issue unsafe actions."
      }]
    },
    method: {
      summary: overstated
        ? "The guardrail guarantees safe production operation."
        : "The guardrail validates actions before execution.",
      status: "supported",
      sources: [{
        anchor: "S2",
        section: "2 Method",
        excerpt: "The guardrail validates every action before execution."
      }]
    },
    systemDesign: {
      summary: "A separate system design is not present.",
      status: "not_present",
      sources: []
    },
    experiments: {
      summary: "The evaluation uses 120 simulated failure scenarios.",
      status: "supported",
      sources: [{
        anchor: "S3",
        section: "3 Evaluation",
        excerpt: "We evaluate 120 simulated failure scenarios."
      }]
    },
    results: {
      summary: "Unsafe actions are reduced by 37%.",
      status: "supported",
      sources: [{
        anchor: "S4",
        section: "4 Results",
        excerpt: "Unsafe actions are reduced by 37%."
      }]
    },
    limitations: {
      summary: "Production traffic is not evaluated.",
      status: "supported",
      sources: [{
        anchor: "S5",
        section: "5 Limitations",
        excerpt: "Production traffic is not evaluated."
      }]
    },
    affiliations: {
      summary: "The authors are affiliated with Example University.",
      status: "supported",
      sources: [{
        anchor: "S0",
        section: "Paper metadata",
        excerpt: "Alice Example, Example University"
      }]
    },
    evidenceInsufficient: false,
    warnings: []
  },
  valueSignals: {
    paperId: id,
    signals: [{
      dimension: "evidence",
      claim: "The reported reduction is 37%.",
      evidenceRefs: ["results:0"],
      readerImplication: "Read the result with its evaluation boundary.",
      adnImplication: {
        relevance: "transferable",
        angle: "safety",
        insight: "The guardrail can constrain automated actions.",
        limit: "The evidence is simulation-only."
      },
      caveat: "No production traffic is evaluated."
    }]
  }
});

const evidenceArtifactsWithSourceIdsFor = (id = paperId, options = {}) => {
  const artifacts = structuredClone(evidenceArtifactsFor(id, options));
  const registry = buildEvidenceSourceRegistry(contextPacketFor(id));
  const idByAnchor = new Map(registry.sections.map((section) => [
    section.anchor,
    section.units[0]?.sourceId
  ]));
  for (const field of Object.values(artifacts.evidenceCard)) {
    if (!field || !Array.isArray(field.sources)) continue;
    field.sources = field.sources.map((sourceEntry) => ({
      sourceId: idByAnchor.get(sourceEntry.anchor)
    }));
  }
  return artifacts;
};

const reviewResponseFor = (id = paperId, {
  status = "pass",
  issues = [],
  scores = {
    scenarioProblemValue: 80,
    methodNovelty: 90,
    practicalValue: 70,
    evidence: 60
  },
  interestFit = "target_network_autonomy"
} = {}) => ({
  paperId: id,
  evidenceValidation: { status, issues },
  scores,
  scoreReason: "The problem and method are strong, but the evidence is simulation-only.",
  weakness: "No production traffic is evaluated.",
  uncertainty: "Generalization to operational networks is unclear.",
  interestFit,
  interestReason: "The paper studies safety controls for autonomous network actions.",
  affiliations: ["示例大学"],
  affiliationEvidenceRefs: ["affiliations:0"],
  rawScore: 100
});

const reviewItemFor = (id = paperId, options = {}) => ({
  paper: {
    id,
    title: "OLD_TITLE_MUST_NOT_ENTER_PROMPT",
    summary: "ABSTRACT_MUST_NOT_ENTER_PROMPT",
    score: 99,
    analysis: { score: 98 }
  },
  contextPacket: contextPacketFor(id),
  ...evidenceArtifactsFor(id, options)
});

test("Review prompt only carries one paper's verified artifacts and bound excerpts", () => {
  const prompt = buildReviewPrompt(reviewItemFor());
  const payload = JSON.parse(prompt);

  assert.equal(payload.task, "weekly_report_review");
  assert.equal(payload.paper.paperId, paperId);
  assert.match(payload.outputSchema.responseModes.repair_required, /complete Review response/i);
  assert.match(payload.outputSchema.scores.scenarioProblemValue, /always required/i);
  assert.equal(payload.evidence.evidenceCard.paperId, paperId);
  assert.equal(Array.isArray(payload.sourceExcerpts), true);
  assert.equal(payload.outputSchema.rawScore, undefined);
  assert.match(payload.rules.join(" "), /primary problem domain.*communication networks/i);
  assert.match(payload.rules.join(" "), /Value Signal claim.*ADN implication/i);
  assert.match(payload.rules.join(" "), /unit.*direction.*comparison subject.*scope/i);
  assert.doesNotMatch(prompt, /ABSTRACT_MUST_NOT_ENTER_PROMPT|OLD_TITLE_MUST_NOT_ENTER_PROMPT|"score":99|"score":98/);
  assert.doesNotMatch(prompt, /2607\.29999/);
});

test("rawScore is computed by the server formula and ignores model score or interest fit", () => {
  assert.equal(calculateReviewRawScore({
    scenarioProblemValue: 80,
    methodNovelty: 90,
    practicalValue: 70,
    evidence: 60
  }), 64);

  const direct = validateReviewResult(reviewResponseFor(paperId, {
    interestFit: "target_network_autonomy"
  }), { item: reviewItemFor() });
  const unrelated = validateReviewResult(reviewResponseFor(paperId, {
    interestFit: "out_of_scope_domain"
  }), { item: reviewItemFor() });

  assert.equal(direct.valid, true);
  assert.equal(direct.reviewResult.rawScore, 64);
  assert.equal(direct.reviewResult.interestFit, "general_ai_system");
  assert.equal(direct.normalizations[0].code, "interest_fit_target_not_grounded");
  assert.equal(unrelated.reviewResult.rawScore, 64);
});

test("Review accepts a Value Signal challenge as a targeted Evidence repair request", () => {
  const validation = validateReviewResult(reviewResponseFor(paperId, {
    status: "repair_required",
    issues: [{
      field: "valueSignals",
      code: "unsupported_adn_premise",
      message: "The claimed observability boundary is absent from the cited excerpts."
    }]
  }), { item: reviewItemFor() });

  assert.equal(validation.valid, true);
  assert.equal(validation.reviewResult.evidenceValidation.issues[0].field, "valueSignals");
});

test("Review normalizes pass with advisory Evidence issues instead of requesting schema repair", () => {
  const validation = validateReviewResult(reviewResponseFor(paperId, {
    status: "pass",
    issues: [{
      field: "valueSignals",
      code: "unsupported_numeric_premise",
      message: "The computing-cost figures are not present in the bound excerpts."
    }]
  }), { item: reviewItemFor() });

  assert.equal(validation.valid, true);
  assert.equal(validation.reviewResult.evidenceValidation.status, "repair_required");
  assert.equal(validation.reviewResult.evidenceValidation.issues.length, 1);
  assert.equal(validation.normalizations.some((entry) => (
    entry.code === "evidence_status_normalized_for_advisory_issues"
  )), true);
});

test("Review requires scoring fields even when semantic Evidence warnings are present", () => {
  const validation = validateReviewResult({
    paperId,
    evidenceValidation: {
      status: "repair_required",
      issues: [{
        field: "results",
        code: "unit_mismatch",
        message: "The summary says seconds, while the bound source says milliseconds."
      }]
    }
  }, { item: reviewItemFor() });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => entry.code === "score_out_of_range"), true);
  assert.equal(validation.issues.some((entry) => entry.code === "required_text_missing"), true);
});

test("Review records an Evidence semantic challenge as a warning and still completes scoring", async () => {
  const tasks = [];
  const events = [];
  const result = await runReviewAgent({
    item: reviewItemFor(paperId, { overstated: true }),
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      tasks.push(payload.task);
      return reviewResponseFor(paperId, {
        status: "repair_required",
        issues: [{
            field: "method",
            code: "claim_overstates_excerpt",
            message: "The source does not establish a production safety guarantee."
        }]
      });
    },
    onEvent: async (event) => events.push(event)
  });

  assert.deepEqual(tasks, ["weekly_report_review"]);
  assert.equal(result.evidenceRepairAttempted, false);
  assert.equal(result.reviewResult.evidenceValidation.status, "repair_required");
  assert.equal(result.reviewResult.rawScore, 64);
  assert.equal(result.evidenceCard.method.summary, "The guardrail guarantees safe production operation.");
  assert.equal(events.some((event) => event.type === "evidence_challenged"), true);
});

test("invalid Review schema gets one structured repair without leaking another paper", async () => {
  const prompts = [];
  const result = await runReviewAgent({
    item: reviewItemFor(),
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      prompts.push(payload);
      if (payload.task === "weekly_report_review") {
        return reviewResponseFor(paperId, {
          scores: {
            scenarioProblemValue: 101,
            methodNovelty: 90,
            practicalValue: 70,
            evidence: 60
          }
        });
      }
      return reviewResponseFor();
    }
  });

  assert.equal(result.reviewRepairAttempted, true);
  assert.deepEqual(prompts.map((payload) => payload.task), [
    "weekly_report_review",
    "weekly_report_review_repair"
  ]);
  assert.doesNotMatch(JSON.stringify(prompts[1]), /2607\.29999|ABSTRACT_MUST_NOT_ENTER_PROMPT/);
});

test("an unresolved Review semantic challenge does not exclude the paper", async () => {
  const result = await runReviewAgent({
      item: reviewItemFor(paperId, { overstated: true }),
      networkRetryDelayMs: 0,
      callModel: async () => reviewResponseFor(paperId, {
          status: "repair_required",
          issues: [{
            field: "method",
            code: "claim_overstates_excerpt",
            message: "The method summary remains unsupported."
          }]
      })
  });
  assert.equal(result.reviewResult.rawScore, 64);
  assert.equal(result.reviewResult.evidenceValidation.issues.length, 1);
  assert.equal(result.evidenceRepairAttempted, false);
});

test("Review model network failure retries once", async () => {
  let calls = 0;
  const result = await runReviewAgent({
    item: reviewItemFor(),
    networkRetryDelayMs: 0,
    callModel: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("rate limited");
        error.code = "RATE_LIMITED";
        throw error;
      }
      return reviewResponseFor();
    }
  });

  assert.equal(calls, 2);
  assert.equal(result.reviewResult.rawScore, 64);
});

test("Review batch records a repeated transport failure and continues with other papers", async () => {
  const events = [];
  const result = await reviewEvidenceBatch([
    reviewItemFor("2607.21001"),
    reviewItemFor("2607.21002")
  ], {
    paperConcurrency: 1,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const paperId = JSON.parse(prompt).paper.paperId;
      if (paperId === "2607.21001") {
        const error = new Error("connection reset");
        error.code = "READING_LIST_AGENT_CALL_FAILED";
        error.retryable = true;
        throw error;
      }
      return reviewResponseFor(paperId);
    },
    onEvent: async (event) => events.push(event)
  });

  assert.deepEqual(result.succeeded.map((item) => item.paper.id), ["2607.21002"]);
  assert.equal(result.excluded.length, 0);
  assert.equal(result.processingFailed.length, 1);
  assert.equal(result.processingFailed[0].paper.id, "2607.21001");
  assert.equal(events.some((event) => event.type === "review_processing_failed"), true);
  assert.equal(events.some((event) => event.type === "review_excluded"), false);
  assert.equal(events.some((event) => event.type === "review_processing_started" && event.paperId === "2607.21001"), true);
});

test("Review semantic warnings do not enter the Evidence response-repair path", async () => {
  const events = [];
  const result = await reviewEvidenceBatch([
    reviewItemFor("2607.21001", { overstated: true }),
    reviewItemFor("2607.21002")
  ], {
    paperConcurrency: 1,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      if (payload.paper.paperId === "2607.21001") {
        return reviewResponseFor("2607.21001", {
          status: "repair_required",
          issues: [{
            field: "method",
            code: "claim_overstates_excerpt",
            message: "The method summary is broader than its source excerpt."
          }]
        });
      }
      return reviewResponseFor("2607.21002");
    },
    onEvent: async (event) => events.push(event)
  });

  assert.deepEqual(result.succeeded.map((item) => item.paper.id), ["2607.21001", "2607.21002"]);
  assert.equal(result.excluded.length, 0);
  assert.equal(result.processingFailed.length, 0);
  assert.equal(events.some((event) => event.type === "evidence_challenged"), true);
  assert.equal(events.some((event) => event.type === "review_excluded"), false);
});

test("Review input precheck records Evidence numeric warnings and continues scoring", async () => {
  const item = reviewItemFor("2609.08482");
  item.evidenceCard.results.summary = "Unsafe actions are reduced by 37% across 20 deployments.";
  const events = [];
  let modelCalls = 0;

  const result = await runReviewAgent({
    item,
    callModel: async () => {
      modelCalls += 1;
      return reviewResponseFor("2609.08482");
    },
    onEvent: async (event) => events.push(event)
  });

  assert.equal(modelCalls, 1);
  assert.equal(result.reviewResult.paperId, "2609.08482");
  const warning = events.find((event) => event.type === "evidence_input_warning");
  assert.ok(warning);
  assert.equal(warning.paperId, "2609.08482");
  assert.equal(warning.issues.some((issue) => issue.code === "numeric_claim_not_in_excerpt"), true);
});

test("Review input precheck still blocks deterministic paper identity mismatches", async () => {
  const item = reviewItemFor("2609.08482");
  item.evidenceCard.paperId = "2609.00000";
  let modelCalls = 0;

  await assert.rejects(
    () => runReviewAgent({
      item,
      callModel: async () => {
        modelCalls += 1;
        return reviewResponseFor("2609.08482");
      }
    }),
    (error) => error instanceof ReviewAgentError
      && error.code === "READING_LIST_REVIEW_INPUT_INVALID"
      && error.issues.some((issue) => issue.code === "paper_id_mismatch")
  );
  assert.equal(modelCalls, 0);
});

test("Review batch propagates a non-paper system failure instead of excluding the paper", async () => {
  await assert.rejects(
    () => reviewEvidenceBatch([reviewItemFor("2607.21003")], {
      networkRetryDelayMs: 0,
      callModel: async () => reviewResponseFor("2607.21003"),
      onEvent: async () => {
        throw new Error("trace storage unavailable");
      }
    }),
    /trace storage unavailable/
  );
});

test("Review batch has finite concurrency, stable order, and paper-level exclusion", async () => {
  const items = ["2607.22001", "2607.22002", "2607.22003"].map((id) => reviewItemFor(id));
  let active = 0;
  let maximumActive = 0;
  const result = await reviewEvidenceBatch(items, {
    paperConcurrency: 2,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      const id = payload.paper.paperId;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, id.endsWith("1") ? 15 : 2));
      active -= 1;
      if (id.endsWith("2")) {
        return { invalid: true };
      }
      return reviewResponseFor(id);
    }
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(result.succeeded.map((item) => item.paper.id), ["2607.22001", "2607.22003"]);
  assert.deepEqual(result.excluded.map((item) => item.paper.id), ["2607.22002"]);
});

test("Review repair prompt reports schema paths but omits prior raw output", () => {
  const prompt = buildReviewRepairPrompt({
    item: reviewItemFor(),
    issues: [{
      code: "score_out_of_range",
      path: "scores.evidence",
      detail: "Previous raw output contained SECRET_RAW_RESPONSE."
    }]
  });

  assert.match(prompt, /weekly_report_review_repair/);
  assert.match(prompt, /scores\.evidence/);
  assert.doesNotMatch(prompt, /SECRET_RAW_RESPONSE/);
});

test("Review prompt consistently treats semantic Evidence issues as advisory while keeping scores", () => {
  const payload = JSON.parse(buildReviewPrompt(reviewItemFor()));
  const rules = payload.rules.join(" ");

  assert.match(rules, /semantic Evidence issues are advisory/i);
  assert.match(rules, /status=repair_required/i);
  assert.doesNotMatch(rules, /return only paperId and evidenceValidation|omit scores/i);
});
