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
        excerpt: "Example University"
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
  affiliations: ["示例大学（Example University）"],
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

const reviewItemWithTwoAffiliations = () => {
  const item = reviewItemFor();
  item.contextPacket.inputSections[0].text = [
    "Paper author affiliations",
    "",
    "Original institution: Example University",
    "Source: Alice Example, Example University",
    "",
    "Original institution: Second Institute",
    "Source: Bob Example, Second Institute"
  ].join("\n");
  const registry = buildEvidenceSourceRegistry(item.contextPacket);
  const source = registry.sections.find((section) => section.anchor === "S0").units[0];
  item.evidenceCard.affiliations.sources = [{
    sourceId: source.sourceId,
    anchor: source.anchor,
    section: source.section,
    excerpt: source.text,
    rawExcerpt: source.rawText
  }];
  return item;
};

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
  assert.match(payload.rules.join(" "), /中文译名（英文原名）/);
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

test("Review 不能在单位 Evidence 已受支持时返回空单位列表", () => {
  const response = reviewResponseFor();
  response.affiliations = [];
  response.affiliationEvidenceRefs = [];

  const validation = validateReviewResult(response, { item: reviewItemFor() });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => (
    entry.code === "supported_affiliations_omitted"
  )), true);
});

test("Review 单位译名必须保留 Evidence 中的英文原名", () => {
  const response = reviewResponseFor();
  response.affiliations = ["示例大学"];

  const validation = validateReviewResult(response, { item: reviewItemFor() });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => (
    entry.code === "affiliation_original_name_missing"
  )), true);
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

test("Review 单位括号内英文原名必须精确匹配受支持 Evidence", () => {
  const mismatch = reviewResponseFor();
  mismatch.affiliations = ["示例大学（Wrong University）"];

  const invalid = validateReviewResult(mismatch, { item: reviewItemFor() });

  assert.equal(invalid.valid, false);
  assert.deepEqual(
    invalid.issues.filter((entry) => entry.code === "affiliation_original_name_mismatch"),
    [{
      code: "affiliation_original_name_mismatch",
      path: "affiliations[0]",
      detail: "Affiliation original name must exactly match a supported affiliation Evidence source."
    }]
  );

  const normalized = reviewResponseFor();
  normalized.affiliations = ["示例大学（  Example   University  ）"];
  assert.equal(validateReviewResult(normalized, { item: reviewItemFor() }).valid, true);

  const changedCase = reviewResponseFor();
  changedCase.affiliations = ["示例大学（example university）"];
  assert.equal(validateReviewResult(changedCase, { item: reviewItemFor() }).valid, false);
});

test("Review 接受原文明确出现但没有可靠中文译名的机构品牌", () => {
  const item = reviewItemFor("2509.26200");
  item.contextPacket.publicationMetadata = {
    status: "not_provided",
    affiliations: [],
    warnings: []
  };
  item.evidenceCard.affiliations.sources = [{
    anchor: "S1",
    section: "Paper frontmatter",
    excerpt: "F. Rezazadeh is with the BrainOmega and the Technical University of Catalonia (UPC), Barcelona, Spain."
  }];
  const response = reviewResponseFor("2509.26200");
  response.affiliations = ["BrainOmega（BrainOmega）"];
  response.affiliationEvidenceRefs = ["affiliations:0"];

  const validation = validateReviewResult(response, { item });

  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.reviewResult.affiliations, ["BrainOmega（BrainOmega）"]);
});

test("Review 拒绝通过追加第二个匹配括号伪造单位原名", () => {
  const response = reviewResponseFor();
  response.affiliations = ["伪造单位（Wrong University）（Example University）"];

  const validation = validateReviewResult(response, { item: reviewItemFor() });

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.issues.filter((entry) => (
    entry.code === "affiliation_display_format_invalid"
  )), [{
    code: "affiliation_display_format_invalid",
    path: "affiliations[0]",
    detail: "Affiliation must use exactly one final 中文译名（英文原名） wrapper with no trailing text."
  }]);
});

test("Review 拒绝单位原名闭合括号后的尾随文本", () => {
  const response = reviewResponseFor();
  response.affiliations = ["示例大学（Example University）额外说明"];

  const validation = validateReviewResult(response, { item: reviewItemFor() });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => (
    entry.code === "affiliation_display_format_invalid"
  )), true);
});

test("Review 接受英文原名内部配对的 ASCII 缩写括号", () => {
  const originalName = "Korea Advanced Institute of Science and Technology (KAIST), Republic of Korea";
  const item = reviewItemFor();
  item.evidenceCard.affiliations.sources[0].excerpt = originalName;
  const response = reviewResponseFor();
  response.affiliations = [`韩国科学技术院（${originalName}）`];

  const validation = validateReviewResult(response, { item });

  assert.equal(validation.valid, true);
});

test("Review 可使用同一 Evidence source 中的全部单位原名", () => {
  const response = reviewResponseFor();
  response.affiliations = [
    "示例大学（Example University）",
    "第二研究院（Second Institute）"
  ];
  response.affiliationEvidenceRefs = ["affiliations:0"];

  const validation = validateReviewResult(response, {
    item: reviewItemWithTwoAffiliations()
  });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.reviewResult.affiliations, [
    "示例大学（Example University）",
    "第二研究院（Second Institute）"
  ]);
  assert.deepEqual(validation.reviewResult.affiliationEvidenceRefs, ["affiliations:0"]);
});


test("Review prompt 与校验器共享干净 Evidence 单位原名", () => {
  const payload = JSON.parse(buildReviewPrompt(reviewItemFor()));

  assert.deepEqual(payload.affiliationOriginals, ["Example University"]);
});

test("叙事型作者前言不能被当作精确单位原名", () => {
  const item = reviewItemFor("2509.26200");
  item.contextPacket.publicationMetadata = {
    status: "not_provided",
    affiliations: [],
    warnings: []
  };
  item.evidenceCard.paperId = "2509.26200";
  item.evidenceCard.affiliations.summary = "Authors are affiliated with i2CAT Foundation and University of Patras.";
  item.evidenceCard.affiliations.sources = [{
    anchor: "S0",
    section: "Paper frontmatter",
    excerpt: "Thanks: Hatim Chergui and Daniel Camps Mur are with the i2CAT Foundation, Spain. Christos Verikoukis is with ISI/ATH and University of Patras, Greece. (e-mail: author@example.org)"
  }];
  const response = reviewResponseFor("2509.26200");
  response.affiliations = [
    "i2CAT 基金会（i2CAT Foundation）",
    "帕特拉斯大学（University of Patras）"
  ];

  const promptPayload = JSON.parse(buildReviewPrompt(item));
  const validation = validateReviewResult(response, { item });

  assert.deepEqual(promptPayload.affiliationOriginals, []);
  assert.equal(validation.valid, true, validation.issues.map((issue) => issue.code).join(", "));
});

test("包含机构名的叙事短句不能被当作精确单位原名", () => {
  for (const excerpt of [
    "This work was conducted at Example University.",
    "The authors are from Example University.",
    "Alice Example, Example University",
    "Alice Example is at Example University.",
    "Alice Example works at Example University.",
    "Alice Example — Example University",
    "John Smith (Example University)",
    "Alice Example at Example University",
    "Alice Example in Example University",
    "Alice Example on Example University",
    "Alice Example of Example University",
    "Alice Example of the Department of Computer Science, Example University"
  ]) {
    const item = reviewItemFor();
    item.contextPacket.publicationMetadata = {
      status: "not_provided",
      affiliations: [],
      warnings: []
    };
    item.evidenceCard.affiliations.sources = [{
      anchor: "S0",
      section: "Paper frontmatter",
      excerpt
    }];

    const promptPayload = JSON.parse(buildReviewPrompt(item));
    const validation = validateReviewResult(reviewResponseFor(), { item });

    assert.deepEqual(promptPayload.affiliationOriginals, [], excerpt);
    assert.equal(validation.valid, true, `${excerpt}: ${validation.issues.map((issue) => issue.code).join(", ")}`);
  }
});

test("逗号分隔的独立院系单位仍可作为精确原名", () => {
  const originalName = "Department of Electrical Engineering, Example University, London, U.K.";
  const item = reviewItemFor();
  item.contextPacket.publicationMetadata = {
    status: "not_provided",
    affiliations: [],
    warnings: []
  };
  item.evidenceCard.affiliations.sources = [{
    anchor: "S0",
    section: "Paper frontmatter",
    excerpt: originalName
  }];
  const response = reviewResponseFor();
  response.affiliations = [`示例大学电气工程系（${originalName}）`];

  const promptPayload = JSON.parse(buildReviewPrompt(item));
  const validation = validateReviewResult(response, { item });

  assert.deepEqual(promptPayload.affiliationOriginals, [originalName]);
  assert.equal(validation.valid, true, validation.issues.map((issue) => issue.code).join(", "));
});
test("单位类结构化修正耗尽后保留 Review 并使用 Evidence 原名回退", async () => {
  const events = [];
  let calls = 0;
  const result = await runReviewAgent({
    item: reviewItemFor(),
    networkRetryDelayMs: 0,
    callModel: async () => {
      calls += 1;
      const response = reviewResponseFor();
      if (calls === 1) {
        response.affiliations = [];
        response.affiliationEvidenceRefs = [];
        return response;
      }
      response.scoreReason = "The repaired scoring explanation must be preserved.";
      response.affiliations = ["示例大学（Wrong University）"];
      return response;
    },
    onEvent: async (event) => events.push(event)
  });

  assert.equal(calls, 2);
  assert.equal(result.reviewRepairAttempted, true);
  assert.equal(result.reviewResult.scoreReason, "The repaired scoring explanation must be preserved.");
  assert.deepEqual(result.reviewResult.affiliations, [
    "原文单位（Example University）"
  ]);
  assert.deepEqual(result.reviewResult.affiliationEvidenceRefs, ["affiliations:0"]);
  assert.equal(result.reviewResult.rawScore, 64);
  assert.equal(events.some((event) => event.type === "review_affiliations_fallback_applied"), true);
});

test("单位类修正耗尽后回退同一 Evidence source 中的全部单位原名", async () => {
  let calls = 0;
  const result = await runReviewAgent({
    item: reviewItemWithTwoAffiliations(),
    networkRetryDelayMs: 0,
    callModel: async () => {
      calls += 1;
      const response = reviewResponseFor();
      if (calls === 1) {
        response.affiliations = [];
        response.affiliationEvidenceRefs = [];
        return response;
      }
      response.affiliations = ["示例大学（Wrong University）"];
      return response;
    }
  });

  assert.equal(calls, 2);
  assert.deepEqual(result.reviewResult.affiliations, [
    "原文单位（Example University）",
    "原文单位（Second Institute）"
  ]);
  assert.deepEqual(result.reviewResult.affiliationEvidenceRefs, ["affiliations:0"]);
});

const reviewItemWithPublicationMetadata = (originalNames, { sourceText = "" } = {}) => {
  const item = reviewItemFor();
  const evidenceText = sourceText || originalNames.join("; ");
  item.contextPacket.publicationMetadata = {
    status: "extracted",
    affiliations: originalNames.map((originalName) => ({
      originalName,
      sourceText: evidenceText,
      sourceType: "arxiv_frontmatter_note",
      confidence: "medium"
    })),
    warnings: []
  };
  item.contextPacket.inputSections[0].text = `Paper metadata\n\n${evidenceText}`;
  item.evidenceCard.affiliations.sources = [{
    anchor: "S0",
    section: "Paper metadata",
    excerpt: evidenceText
  }];
  return item;
};

test("Review 接受中文机构正式名称中的校区括号并绑定最后一组英文原名", () => {
  const originals = [
    "Shenzhen Research Institute of Big Data, Shenzhen, China",
    "The Chinese University of Hong Kong, Shenzhen, China",
    "Sun Yat-Sen University, Shenzhen, China",
    "Shenzhen Loop Area Institute, Shenzhen, China"
  ];
  const item = reviewItemWithPublicationMetadata(originals);
  const response = reviewResponseFor();
  response.affiliations = [
    `深圳大数据研究院（${originals[0]}）`,
    `香港中文大学（深圳）（${originals[1]}）`,
    `中山大学（深圳）（${originals[2]}）`,
    `深圳河套研究院（${originals[3]}）`
  ];

  const validation = validateReviewResult(response, { item });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.reviewResult.affiliations, response.affiliations);
});

test("Review prompt 给模型明确的服务端单位原名列表", () => {
  const item = reviewItemWithPublicationMetadata([
    "University of Ottawa",
    "University of Bologna"
  ]);

  const payload = JSON.parse(buildReviewPrompt(item));

  assert.deepEqual(payload.affiliationOriginals, [
    "University of Ottawa",
    "University of Bologna"
  ]);
  assert.match(payload.rules.join(" "), /copy English original names only from affiliationOriginals/i);
});

test("单位修正耗尽时从结构化元数据回退而不是使用受污染 Evidence 整句", async () => {
  const sourceText = "Andrea Test is with University of Ottawa and University of Bologna (e-mails: test@example.edu).";
  const item = reviewItemWithPublicationMetadata([
    "University of Ottawa",
    "University of Bologna"
  ], { sourceText });
  let calls = 0;

  const result = await runReviewAgent({
    item,
    networkRetryDelayMs: 0,
    callModel: async () => {
      calls += 1;
      const response = reviewResponseFor();
      response.affiliations = ["错误单位（Wrong University）"];
      return response;
    }
  });

  assert.equal(calls, 2);
  assert.deepEqual(result.reviewResult.affiliations, [
    "原文单位（University of Ottawa）",
    "原文单位（University of Bologna）"
  ]);
  assert.deepEqual(result.reviewResult.affiliationEvidenceRefs, ["affiliations:0"]);
});


test("Review 少返回一个结构化单位时自动修正并最终完整回退", async () => {
  const item = reviewItemWithPublicationMetadata([
    "University of Ottawa",
    "University of Bologna"
  ]);
  let calls = 0;

  const result = await runReviewAgent({
    item,
    networkRetryDelayMs: 0,
    callModel: async () => {
      calls += 1;
      const response = reviewResponseFor();
      response.affiliations = ["渥太华大学（University of Ottawa）"];
      return response;
    }
  });

  assert.equal(calls, 2);
  assert.deepEqual(result.reviewResult.affiliations, [
    "原文单位（University of Ottawa）",
    "原文单位（University of Bologna）"
  ]);
  assert.equal(result.calls[1].validation.issues.some((issue) => (
    issue.code === "supported_affiliations_incomplete"
  )), true);
});

test("Review 重试已保留的旧 contextPacket 时即时清洗受污染单位", async () => {
  const polluted = "Yuyao Wang, Gaoze Mu, and Yongan Zheng are with the National Engineering Research Center, Beijing University of Posts and Telecommunications, and also with Department of Broadband Communication, Peng Cheng Laboratory (e-mails: test@example.edu).";
  const item = reviewItemWithPublicationMetadata([polluted], { sourceText: polluted });
  let calls = 0;

  const result = await runReviewAgent({
    item,
    networkRetryDelayMs: 0,
    callModel: async () => {
      calls += 1;
      const response = reviewResponseFor();
      response.affiliations = ["错误单位（Wrong University）"];
      return response;
    }
  });

  assert.equal(calls, 2);
  assert.deepEqual(result.reviewResult.affiliations, [
    "原文单位（National Engineering Research Center, Beijing University of Posts and Telecommunications）",
    "原文单位（Department of Broadband Communication, Peng Cheng Laboratory）"
  ]);
  const promptPayload = JSON.parse(result.calls[0].prompt);
  assert.deepEqual(promptPayload.affiliationOriginals, [
    "National Engineering Research Center, Beijing University of Posts and Telecommunications",
    "Department of Broadband Communication, Peng Cheng Laboratory"
  ]);
});
test("单位英文原名只差尾部标点时不会触发结构化修正", () => {
  const item = reviewItemWithPublicationMetadata(["Coinbase, Inc"]);
  const response = reviewResponseFor();
  response.affiliations = ["Coinbase 公司（Coinbase, Inc.）"];

  assert.equal(validateReviewResult(response, { item }).valid, true);
});

test("Review 接受 answer 对象外层包装", async () => {
  let calls = 0;
  const result = await runReviewAgent({
    item: reviewItemFor(),
    callModel: async () => {
      calls += 1;
      return { answer: reviewResponseFor() };
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.reviewResult.paperId, paperId);
});

test("Review 接受 answer 内字符串化 JSON 外层包装", async () => {
  let calls = 0;
  const result = await runReviewAgent({
    item: reviewItemFor(),
    callModel: async () => {
      calls += 1;
      return { answer: JSON.stringify(reviewResponseFor()) };
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.reviewResult.paperId, paperId);
});
