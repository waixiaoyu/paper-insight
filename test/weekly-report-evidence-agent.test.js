import assert from "node:assert/strict";
import test from "node:test";
import {
  EvidenceAgentError,
  extractEvidenceBatch,
  runEvidenceAgent,
  validateEvidenceArtifacts
} from "../weekly-report/evidence-agent.js";
import {
  buildEvidencePrompt,
  buildEvidenceRepairPrompt
} from "../weekly-report/prompts.js";

const contextPacketFor = (paperId = "2607.11111") => {
  const inputSections = [
    {
      anchor: "S0",
      heading: "Traceable Network Agent",
      kind: "metadata",
      text: "Traceable Network Agent\n\nAlice Example, Example University"
    },
    {
      anchor: "S1",
      heading: "1 Introduction",
      kind: "introduction",
      text: "1 Introduction\n\nAutonomous network agents can issue unsafe configuration actions without pre-deployment validation."
    },
    {
      anchor: "S2",
      heading: "2 Method and System Architecture",
      kind: "methodOrTheory",
      text: "2 Method and System Architecture\n\nThe guardrail checks every candidate action against topology constraints before execution."
    },
    {
      anchor: "S3",
      heading: "3 Experimental Evaluation",
      kind: "experimentOrEvaluation",
      text: "3 Experimental Evaluation\n\nWe evaluate 120 failure scenarios against an unguarded agent baseline."
    },
    {
      anchor: "S4",
      heading: "4 Results and Discussion",
      kind: "resultsOrDiscussion",
      text: "4 Results and Discussion\n\nThe guardrail reduces unsafe actions by 37% while preserving task completion."
    },
    {
      anchor: "S5",
      heading: "5 Limitations",
      kind: "limitations",
      text: "5 Limitations\n\nThe evaluation uses simulated topologies and does not cover production traffic."
    }
  ];

  return {
    paperId,
    source: "arxiv-html",
    status: "available",
    url: `https://arxiv.org/html/${paperId}`,
    qualityGate: { passed: true, reasons: [] },
    inputSections,
    inputText: inputSections.map((section) => section.text).join("\n\n")
  };
};

const source = (anchor, section, excerpt) => ({ anchor, section, excerpt });

const validResponseFor = (paperId = "2607.11111") => ({
  evidenceCard: {
    paperId,
    problem: {
      summary: "Autonomous network agents can issue unsafe configuration actions.",
      status: "supported",
      sources: [source(
        "S1",
        "1 Introduction",
        "Autonomous network agents can issue unsafe configuration actions without pre-deployment validation."
      )]
    },
    method: {
      summary: "The method checks candidate actions against topology constraints before execution.",
      status: "supported",
      sources: [source(
        "S2",
        "2 Method and System Architecture",
        "The guardrail checks every candidate action against topology constraints before execution."
      )]
    },
    systemDesign: {
      summary: "A separate system decomposition is not present in the supplied source.",
      status: "not_present",
      sources: []
    },
    experiments: {
      summary: "The evaluation contains 120 simulated failure scenarios.",
      status: "supported",
      sources: [source(
        "S3",
        "3 Experimental Evaluation",
        "We evaluate 120 failure scenarios against an unguarded agent baseline."
      )]
    },
    results: {
      summary: "Unsafe actions are reduced by 37% while task completion is preserved.",
      status: "supported",
      sources: [source(
        "S4",
        "4 Results and Discussion",
        "The guardrail reduces unsafe actions by 37% while preserving task completion."
      )]
    },
    limitations: {
      summary: "The evidence is limited to simulated topologies without production traffic.",
      status: "supported",
      sources: [source(
        "S5",
        "5 Limitations",
        "The evaluation uses simulated topologies and does not cover production traffic."
      )]
    },
    affiliations: {
      summary: "The authors are affiliated with Example University.",
      status: "supported",
      sources: [source("S0", "Traceable Network Agent", "Alice Example, Example University")]
    },
    evidenceInsufficient: false,
    warnings: []
  },
  valueSignals: {
    paperId,
    signals: [
      {
        dimension: "methodNovelty",
        claim: "Pre-execution topology validation is the central reusable method signal.",
        evidenceRefs: ["method:0"],
        readerImplication: "Read the guardrail mechanism before the evaluation.",
        adnImplication: {
          relevance: "direct",
          angle: "safety",
          insight: "The mechanism can constrain closed-loop network actions.",
          limit: "The current evidence is simulation-only."
        },
        caveat: "The paper does not isolate every guardrail component."
      },
      {
        dimension: "evidence",
        claim: "The reported unsafe-action reduction is 37%.",
        evidenceRefs: ["results:0"],
        readerImplication: "Check the result together with the simulated-topology limitation.",
        adnImplication: {
          relevance: "transferable",
          angle: "evaluation",
          insight: "The metric can inform network-agent safety evaluation.",
          limit: "No production traffic is evaluated."
        },
        caveat: "The result is not yet production evidence."
      }
    ]
  }
});

test("Evidence prompt 只包含单篇原文允许字段，不包含摘要、旧分数或旧分析", () => {
  const contextPacket = contextPacketFor();
  const prompt = buildEvidencePrompt({
    paper: {
      id: "2607.11111",
      title: "OLD_TITLE_SHOULD_NOT_BE_TRUSTED",
      summary: "ABSTRACT_SECRET",
      score: 99,
      analysis: { score: 98, tldr: "OLD_ANALYSIS_SECRET" },
      readingListReview: { score: 97 }
    },
    contextPacket
  });
  const payload = JSON.parse(prompt);

  assert.equal(payload.task, "weekly_report_extract_evidence");
  assert.equal(payload.paper.paperId, "2607.11111");
  assert.equal(payload.context.sections.length, contextPacket.inputSections.length);
  assert.match(payload.rules.join(" "), /contiguous verbatim excerpt/i);
  assert.match(payload.rules.join(" "), /Every Evidence field always requires a non-empty summary/i);
  assert.match(payload.rules.join(" "), /Every Value Signal requires dimension/i);
  assert.match(payload.rules.join(" "), /exact field:index form/i);
  assert.doesNotMatch(prompt, /ABSTRACT_SECRET|OLD_ANALYSIS_SECRET|OLD_TITLE_SHOULD_NOT_BE_TRUSTED|"score":99|"score":98|"score":97/);
  assert.doesNotMatch(prompt, /2607\.22222/);
});

test("合法 Evidence 与 Value artifacts 能通过原文章节、摘录和数字验证", () => {
  const response = validResponseFor();
  const validation = validateEvidenceArtifacts(response, {
    contextPacket: contextPacketFor(),
    expectedPaperId: "2607.11111"
  });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
  assert.equal(validation.evidenceRefCount >= 6, true);
});

test("Affiliation Evidence cannot use a product or provider mention outside paper metadata", () => {
  const contextPacket = contextPacketFor();
  contextPacket.inputSections.push({
    anchor: "S6",
    heading: "Appendix C Evaluation Protocol",
    kind: "other",
    text: "Appendix C Evaluation Protocol\n\nLlamaExtract Agentic Plus uses a credit-based extraction rate."
  });
  const response = validResponseFor();
  response.evidenceCard.affiliations = {
    summary: "The paper has an industry affiliation related to LlamaExtract.",
    status: "supported",
    sources: [source(
      "S6",
      "Appendix C Evaluation Protocol",
      "LlamaExtract Agentic Plus uses a credit-based extraction rate."
    )]
  };

  const validation = validateEvidenceArtifacts(response, {
    contextPacket,
    expectedPaperId: contextPacket.paperId
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => (
    entry.code === "affiliation_source_not_metadata"
    && entry.path === "evidenceCard.affiliations.sources[0]"
  )), true);
});

test("Evidence results cannot generalize a commercial-VLM long-document result to most systems", () => {
  const contextPacket = contextPacketFor();
  const excerpt = "On long documents the commercial VLMs fall below 40%, while Claude Code Opus 4.8 and Reducto Deep Extract remain close to their short-document scores.";
  contextPacket.inputSections[4].text += ` ${excerpt}`;
  const response = validResponseFor();
  response.evidenceCard.results = {
    summary: "Most systems degrade significantly on long documents.",
    status: "supported",
    sources: [source("S4", "4 Results and Discussion", excerpt)]
  };
  response.valueSignals.signals = [response.valueSignals.signals[0]];

  const validation = validateEvidenceArtifacts(response, {
    contextPacket,
    expectedPaperId: contextPacket.paperId
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => (
    entry.code === "model_cohort_scope_overgeneralized"
    && entry.path === "evidenceCard.results.summary"
  )), true);

  response.evidenceCard.results.summary = "Commercial VLMs degrade on long documents, while the named extraction systems remain close to their short-document scores.";
  const qualifiedValidation = validateEvidenceArtifacts(response, {
    contextPacket,
    expectedPaperId: contextPacket.paperId
  });
  assert.equal(qualifiedValidation.issues.some((entry) => entry.code === "model_cohort_scope_overgeneralized"), false);
});

test("Evidence commercial-VLM long-document result requires a directly bound excerpt", () => {
  const contextPacket = contextPacketFor();
  const response = validResponseFor();
  response.evidenceCard.results.summary = "Commercial VLMs degrade significantly on long documents.";

  const validation = validateEvidenceArtifacts(response, {
    contextPacket,
    expectedPaperId: contextPacket.paperId
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => (
    entry.code === "commercial_vlm_long_document_source_missing"
    && entry.path === "evidenceCard.results.summary"
  )), true);

  const excerpt = "On long documents the commercial VLMs fall below 40%.";
  contextPacket.inputSections[4].text += ` ${excerpt}`;
  response.evidenceCard.results.sources[0] = source("S4", "4 Results and Discussion", excerpt);
  const groundedValidation = validateEvidenceArtifacts(response, {
    contextPacket,
    expectedPaperId: contextPacket.paperId
  });
  assert.equal(groundedValidation.issues.some((entry) => entry.code === "commercial_vlm_long_document_source_missing"), false);
});

test("Evidence excerpts must not start with an unresolved comparison subject", () => {
  const contextPacket = contextPacketFor();
  contextPacket.inputSections[4].text += " It also outperforms another method at lower cost.";
  const response = validResponseFor();
  response.evidenceCard.results.sources[0].excerpt = "It also outperforms another method at lower cost.";
  response.evidenceCard.results.summary = "The method outperforms another method at lower cost.";

  const validation = validateEvidenceArtifacts(response, {
    contextPacket,
    expectedPaperId: contextPacket.paperId
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => entry.code === "excerpt_not_self_contained"), true);
});

test("Problem Evidence must state a problem or capability instead of only announcing the contribution", () => {
  const contextPacket = contextPacketFor();
  contextPacket.inputSections[1].text += " We introduce DungeonBench, a benchmark built to cover combat-relevant rules.";
  const response = validResponseFor();
  response.evidenceCard.problem.sources[0].excerpt = "We introduce DungeonBench, a benchmark built to cover combat-relevant rules.";
  response.evidenceCard.problem.summary = "The paper introduces DungeonBench as a combat benchmark.";

  const validation = validateEvidenceArtifacts(response, {
    contextPacket,
    expectedPaperId: contextPacket.paperId
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => entry.code === "problem_excerpt_not_problem_statement"), true);
});

test("伪造摘录触发一次定向修正，修正 prompt 仍只读取当前论文", async () => {
  const invalid = validResponseFor();
  invalid.evidenceCard.method.sources[0].excerpt = "A fabricated method excerpt from another paper.";
  const repairedResponse = validResponseFor();
  repairedResponse.evidenceCard.problem = {
    summary: "An unrelated contribution announcement.",
    status: "supported",
    sources: [source("S1", "1 Introduction", "We introduce an unrelated benchmark.")]
  };
  const calls = [];
  const callRecords = [];
  const result = await runEvidenceAgent({
    paper: { id: "2607.11111", summary: "ABSTRACT_SECRET" },
    contextPacket: contextPacketFor(),
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      calls.push(payload);
      return calls.length === 1 ? invalid : repairedResponse;
    },
    onCall: async (record) => callRecords.push(record)
  });

  assert.equal(result.repairAttempted, true);
  assert.equal(result.validation.valid, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].task, "weekly_report_extract_evidence_repair");
  assert.deepEqual(calls[1].repairTargets.evidenceFields, ["method"]);
  assert.equal(calls[1].repairTargets.rebuildValueSignals, true);
  assert.match(calls[1].serverMergePolicy, /ignored/i);
  assert.match(JSON.stringify(calls[1].issues), /excerpt_not_in_source/);
  assert.doesNotMatch(JSON.stringify(calls[1]), /ABSTRACT_SECRET|2607\.22222/);
  assert.deepEqual(callRecords.map((record) => record.attemptType), ["initial", "repair"]);
  assert.equal(
    result.evidenceCard.problem.sources[0].excerpt,
    validResponseFor().evidenceCard.problem.sources[0].excerpt
  );
  assert.equal(callRecords[1].validation.repairScope.mode, "field_scoped_merge");
  assert.deepEqual(callRecords[1].validation.repairScope.evidenceFields, ["method"]);
});

test("malformed initial Evidence is repaired once and the recovered content still passes every evidence guard", async () => {
  const contextPacket = contextPacketFor();
  contextPacket.inputSections[4].text += " Commercial VLMs show weaker results. Long documents remain a separate challenge.";
  const repairedResponse = validResponseFor();
  repairedResponse.evidenceCard.results = {
    summary: "Commercial VLMs show weaker results on long documents.",
    status: "supported",
    sources: [
      source("S4", "4 Results and Discussion", "Commercial VLMs show weaker results."),
      source("S4", "4 Results and Discussion", "Long documents remain a separate challenge.")
    ]
  };
  repairedResponse.valueSignals.signals[1] = {
    ...repairedResponse.valueSignals.signals[1],
    claim: "Commercial VLM performance requires separate long-document verification.",
    evidenceRefs: ["results:0", "results:1"]
  };
  const prompts = [];
  let calls = 0;

  await assert.rejects(
    () => runEvidenceAgent({
      paper: { id: "2607.11111" },
      contextPacket,
      callModel: async (prompt) => {
        calls += 1;
        prompts.push(JSON.parse(prompt));
        return calls === 1 ? "{\"evidenceCard\":" : repairedResponse;
      }
    }),
    (error) => (
      error instanceof EvidenceAgentError
      && error.code === "READING_LIST_EVIDENCE_UNSUPPORTED"
      && error.issues.some((entry) => entry.code === "commercial_vlm_long_document_source_missing")
    )
  );

  assert.equal(calls, 2);
  assert.equal(prompts[1].task, "weekly_report_extract_evidence_repair");
  assert.equal(prompts[1].repairTargets.mode, "full_response");
  assert.equal(prompts[1].issues.some((entry) => entry.code === "invalid_json"), true);
});

test("a schema-incomplete Evidence content repair fails closed instead of reaching numeric sanitization", async () => {
  const initial = validResponseFor();
  initial.evidenceCard.results.summary = "Unsafe actions are reduced by 42%.";
  const malformedRepair = validResponseFor();
  delete malformedRepair.valueSignals.signals[1].claim;
  let calls = 0;

  await assert.rejects(
    () => runEvidenceAgent({
      paper: { id: "2607.11111" },
      contextPacket: contextPacketFor(),
      callModel: async () => {
        calls += 1;
        return calls === 1 ? initial : malformedRepair;
      }
    }),
    (error) => (
      error instanceof EvidenceAgentError
      && error.code === "READING_LIST_EVIDENCE_UNSUPPORTED"
      && error.issues.some((entry) => (
        entry.code === "invalid_json" && /requires claim and evidenceRefs/.test(entry.detail)
      ))
    )
  );

  assert.equal(calls, 2);
});

test("Review-requested Evidence repair preserves fields outside the challenged scope", async () => {
  const currentArtifacts = validResponseFor();
  const repairedResponse = validResponseFor();
  repairedResponse.evidenceCard.results.summary = "Unsafe actions are reduced by 37% while completion is preserved.";
  repairedResponse.evidenceCard.problem.sources[0].excerpt = "This unrelated sentence is not in the source.";
  const prompts = [];

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    currentArtifacts,
    repairIssues: [{ code: "review_claim_not_supported", path: "evidenceCard.results.summary" }],
    callModel: async (prompt) => {
      prompts.push(JSON.parse(prompt));
      return repairedResponse;
    }
  });

  assert.equal(result.validation.valid, true);
  assert.equal(result.repairSource, "review");
  assert.deepEqual(prompts[0].repairTargets.evidenceFields, ["results"]);
  assert.equal(
    result.evidenceCard.problem.sources[0].excerpt,
    currentArtifacts.evidenceCard.problem.sources[0].excerpt
  );
});

test("精确数字不在绑定摘录中时验证失败", () => {
  const response = validResponseFor();
  response.evidenceCard.results.summary = "Unsafe actions are reduced by 42%.";
  response.valueSignals.signals[1].claim = "The reported unsafe-action reduction is 42%.";
  const validation = validateEvidenceArtifacts(response, {
    contextPacket: contextPacketFor(),
    expectedPaperId: "2607.11111"
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "numeric_claim_not_in_excerpt"), true);
});

test("F1 等字母数字指标名不会被拆成独立数字事实", () => {
  const response = validResponseFor();
  response.evidenceCard.method.summary += " The evaluation also reports F1.";
  const validation = validateEvidenceArtifacts(response, {
    contextPacket: contextPacketFor(),
    expectedPaperId: "2607.11111"
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.some((issue) => (
    issue.code === "numeric_claim_not_in_excerpt" && /token 1\b/.test(issue.detail)
  )), false);
});

test("Evidence section heading is deterministically rebound from a valid server anchor", () => {
  const response = validResponseFor();
  response.evidenceCard.results.sources[0].section = "model-shortened-heading";

  const validation = validateEvidenceArtifacts(response, {
    contextPacket: contextPacketFor(),
    expectedPaperId: response.evidenceCard.paperId
  });

  assert.equal(validation.valid, true);
  assert.equal(
    validation.artifacts.evidenceCard.results.sources[0].section,
    contextPacketFor().inputSections.find((section) => (
      section.anchor === response.evidenceCard.results.sources[0].anchor
    ))?.heading
  );
});

test("unsupported numeric prose after the one repair is safely removed without accepting fabricated Evidence", async () => {
  const invalid = validResponseFor();
  invalid.evidenceCard.results.summary = "Unsafe actions are reduced by 42%.";
  invalid.valueSignals.signals[1].claim = "The reported unsafe-action reduction is 42%.";
  const events = [];
  let calls = 0;

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    callModel: async () => {
      calls += 1;
      return invalid;
    },
    onEvent: async (event) => events.push(event)
  });

  assert.equal(calls, 2);
  assert.equal(result.validation.valid, true);
  assert.equal(result.deterministicSanitizationApplied, true);
  assert.doesNotMatch(result.evidenceCard.results.summary, /42/);
  assert.equal(result.evidenceCard.results.status, "insufficient");
  assert.deepEqual(result.evidenceCard.results.sources, []);
  assert.doesNotMatch(result.evidenceCard.results.summary, /Exact numeric details|omitted|grounded/i);
  assert.equal(result.valueSignals.signals.some((signal) => /42/.test(signal.claim)), false);
  assert.equal(events.some((event) => event.type === "evidence_numeric_claims_sanitized"), true);
});

test("numeric sanitization keeps supported paper content and removes only sentences with unbound numbers", async () => {
  const invalid = validResponseFor();
  invalid.evidenceCard.results.summary = "The benchmark evaluates extraction reliability. Unsafe actions are reduced by 42%.";
  invalid.valueSignals.signals[1].claim = "The reported unsafe-action reduction is 42%.";

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    callModel: async () => invalid
  });

  assert.equal(result.validation.valid, true);
  assert.equal(result.deterministicSanitizationApplied, true);
  assert.equal(result.evidenceCard.results.status, "supported");
  assert.equal(result.evidenceCard.results.summary, "The benchmark evaluates extraction reliability.");
  assert.doesNotMatch(result.evidenceCard.results.summary, /42|Exact numeric details|omitted|grounded/i);
  assert.equal(result.evidenceCard.results.sources.length > 0, true);
  assert.equal(result.valueSignals.signals.some((signal) => /42/.test(signal.claim)), false);
});

test("一次修正后仍不合格会抛出可排除单篇的 Evidence 错误", async () => {
  const invalid = validResponseFor();
  invalid.evidenceCard.results.sources[0].anchor = "S999";
  let calls = 0;

  await assert.rejects(
    () => runEvidenceAgent({
      paper: { id: "2607.11111" },
      contextPacket: contextPacketFor(),
      callModel: async () => {
        calls += 1;
        return invalid;
      }
    }),
    (error) => (
      error instanceof EvidenceAgentError
      && error.code === "READING_LIST_EVIDENCE_UNSUPPORTED"
      && error.stage === "extract_evidence"
      && error.paperId === "2607.11111"
      && error.excludePaper === true
    )
  );

  assert.equal(calls, 2);
});

test("网络错误自动重试一次，不消耗结构化修正机会", async () => {
  let calls = 0;
  const callRecords = [];
  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    callModel: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("rate limited");
        error.code = "RATE_LIMITED";
        throw error;
      }
      return validResponseFor();
    },
    onCall: async (record) => callRecords.push(record)
  });

  assert.equal(result.repairAttempted, false);
  assert.equal(calls, 2);
  assert.deepEqual(callRecords.map((record) => record.attemptType), ["initial", "network_retry"]);
});

test("two incomplete model responses fail the Evidence stage instead of excluding the paper", async () => {
  let calls = 0;
  const events = [];

  await assert.rejects(
    () => extractEvidenceBatch([{
      paper: { id: "2607.11111" },
      contextPacket: contextPacketFor()
    }], {
      paperConcurrency: 1,
      networkRetryDelayMs: 0,
      callModel: async () => {
        calls += 1;
        const error = new Error("structured response incomplete");
        error.code = "READING_LIST_AGENT_RESPONSE_INCOMPLETE";
        error.retryable = true;
        error.stopReason = "max_tokens";
        throw error;
      },
      onEvent: async (event) => events.push(event)
    }),
    (error) => (
      error.code === "READING_LIST_AGENT_RESPONSE_INCOMPLETE"
      && error.retryable === true
      && error.stage === "extract_evidence"
      && error.paperId === "2607.11111"
    )
  );

  assert.equal(calls, 2);
  assert.equal(events.some((event) => event.type === "network_retry"), true);
  assert.equal(events.find((event) => event.type === "network_retry")?.error?.stopReason, "max_tokens");
  assert.equal(events.some((event) => event.type === "repair_requested"), false);
  assert.equal(events.some((event) => event.type === "evidence_excluded"), false);
});

test("Evidence 批处理有限并发、保持候选顺序，并只排除失败论文", async () => {
  const items = ["2607.10001", "2607.10002", "2607.10003"].map((paperId) => ({
    paper: { id: paperId },
    contextPacket: contextPacketFor(paperId)
  }));
  let active = 0;
  let maximumActive = 0;
  const promptsByPaper = new Map();
  const result = await extractEvidenceBatch(items, {
    paperConcurrency: 2,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      const paperId = payload.paper.paperId;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      promptsByPaper.set(paperId, [...(promptsByPaper.get(paperId) || []), prompt]);
      await new Promise((resolve) => setTimeout(resolve, paperId.endsWith("1") ? 15 : 2));
      active -= 1;

      if (paperId.endsWith("2")) {
        const invalid = validResponseFor(paperId);
        invalid.evidenceCard.problem.sources[0].excerpt = "fabricated";
        return invalid;
      }

      return validResponseFor(paperId);
    }
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(result.succeeded.map((item) => item.paper.id), ["2607.10001", "2607.10003"]);
  assert.deepEqual(result.excluded.map((item) => item.paper.id), ["2607.10002"]);
  for (const [paperId, prompts] of promptsByPaper) {
    assert.equal(prompts.every((prompt) => prompt.includes(paperId)), true);
    assert.equal(prompts.every((prompt) => items.filter((item) => item.paper.id !== paperId)
      .every((item) => !prompt.includes(item.paper.id))), true);
  }
});

test("repair prompt 不携带上次原始响应，只包含当前原文和问题列表", () => {
  const prompt = buildEvidenceRepairPrompt({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    repairTargets: {
      mode: "field_scoped_merge",
      evidenceFields: ["problem", "results"],
      rebuildValueSignals: true
    },
    issues: [
      { code: "paper_id_mismatch", detail: "Returned 2607.22222" },
      { code: "excerpt_not_in_source", path: "evidenceCard.systemDesign.sources[0].excerpt" },
      { code: "excerpt_not_self_contained", path: "evidenceCard.results.sources[0].excerpt" },
      { code: "numeric_claim_not_in_excerpt", path: "evidenceCard.results.summary" },
      { code: "problem_excerpt_not_problem_statement", path: "evidenceCard.problem.sources" },
      { code: "commercial_vlm_long_document_source_missing", path: "evidenceCard.results.summary" }
    ]
  });

  assert.match(prompt, /weekly_report_extract_evidence_repair/);
  assert.doesNotMatch(prompt, /2607\.22222/);
  const payload = JSON.parse(prompt);
  assert.deepEqual(payload.completenessContract.everyValueSignalRequiredFields, [
    "dimension",
    "claim",
    "evidenceRefs",
    "readerImplication",
    "adnImplication",
    "caveat"
  ]);
  assert.deepEqual(payload.completenessContract.allowedDimensions, [
    "scenarioProblemValue",
    "methodNovelty",
    "practicalValue",
    "evidence"
  ]);
  assert.match(payload.repairInstruction, /Do not omit a field/);
  assert.deepEqual(payload.repairTargets.evidenceFields, ["problem", "results"]);
  assert.equal(payload.repairTargets.rebuildValueSignals, true);
  assert.match(payload.serverMergePolicy, /ignored/i);
  const repairHints = payload.issues.flatMap((entry) => entry.repairHints || []).join(" ");
  assert.match(repairHints, /shorter contiguous verbatim substring/i);
  assert.match(repairHints, /contiguous antecedent/i);
  assert.match(repairHints, /remove the exact number/i);
  assert.match(repairHints, /problem, gap, challenge/i);
  assert.match(repairHints, /both commercial VLMs and the long-document scope/i);
});
