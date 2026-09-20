import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EvidenceAgentError,
  extractEvidenceNumericTokens,
  extractEvidenceBatch as extractEvidenceBatchImpl,
  normalizeEvidenceResponseShape,
  runEvidenceAgent as runEvidenceAgentImpl,
  validateEvidenceArtifacts
} from "../weekly-report/evidence-agent.js";
import {
  buildEvidencePrompt,
  buildEvidenceRepairPrompt,
  buildEvidenceResponseRepairPrompt
} from "../weekly-report/prompts.js";
import { buildEvidenceSourceRegistry } from "../weekly-report/evidence-source-registry.js";

const runEvidenceAgent = (options = {}) => runEvidenceAgentImpl({
  allowLegacyModelSources: true,
  ...options
});

const extractEvidenceBatch = (items, options = {}) => extractEvidenceBatchImpl(items, {
  allowLegacyModelSources: true,
  ...options
});

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
  assert.match(payload.rules.join(" "), /select one or more supplied sourceId/i);
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

test("研究目标可以作为 Problem Evidence，不需要命中固定问题关键词", () => {
  const contextPacket = contextPacketFor();
  const excerpt = "This paper assesses the deployment-time effectiveness of topology constraints in configuration workflows.";
  contextPacket.inputSections[1].text += ` ${excerpt}`;
  const response = validResponseFor();
  response.evidenceCard.problem = {
    summary: "The paper assesses the deployment-time effectiveness of topology constraints in configuration workflows.",
    status: "supported",
    sources: [source("S1", "1 Introduction", excerpt)]
  };

  const validation = validateEvidenceArtifacts(response, {
    contextPacket,
    expectedPaperId: contextPacket.paperId
  });

  assert.equal(validation.issues.some((entry) => entry.code === "problem_excerpt_not_problem_statement"), false);
});

test("研究缺口的否定表述可以作为 Problem Evidence", () => {
  const contextPacket = contextPacketFor();
  const excerpt = "However, these efforts largely stop at textual refusal or harmful-content detection; they do not assess whether agents can write runnable malicious code. Consequently, the threat surface of fully autonomous code agents remains under-characterized.";
  contextPacket.inputSections[1].text += " " + excerpt;
  const response = validResponseFor();
  response.evidenceCard.problem = {
    summary: "Existing safeguards do not assess whether autonomous agents can write runnable malicious code, leaving the threat surface under-characterized.",
    status: "supported",
    sources: [source("S1", "1 Introduction", excerpt)]
  };

  const validation = validateEvidenceArtifacts(response, {
    contextPacket,
    expectedPaperId: contextPacket.paperId
  });

  assert.equal(validation.issues.some((entry) => entry.code === "problem_excerpt_not_problem_statement"), false);
});

test("固定拓扑导致偏置和错误放大的表述可以作为 Problem Evidence", () => {
  const contextPacket = contextPacketFor();
  const excerpt = "Fixed topologies often introduce persistent positional biases, amplify unreliable agents, and cause high sensitivity to role assignments.";
  contextPacket.inputSections[1].text += " " + excerpt;
  const response = validResponseFor();
  response.evidenceCard.problem = {
    summary: "Fixed debate topologies introduce persistent positional bias and amplify unreliable agents.",
    status: "supported",
    sources: [source("S1", "1 Introduction", excerpt)]
  };

  const validation = validateEvidenceArtifacts(response, {
    contextPacket,
    expectedPaperId: contextPacket.paperId
  });

  assert.equal(validation.issues.some((entry) => entry.code === "problem_excerpt_not_problem_statement"), false);
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
  assert.equal(calls[1].repairTargets.rebuildValueSignals, false);
  assert.match(calls[1].serverMergePolicy, /ignored/i);
  assert.match(JSON.stringify(calls[1].issues), /excerpt_not_in_source/);
  const methodIssue = calls[1].issues.find((entry) => entry.path === "evidenceCard.method.sources[0].excerpt");
  assert.equal(methodIssue.detail, "Excerpt is not a verbatim substring of the bound source section.");
  assert.equal(methodIssue.previousValue, "A fabricated method excerpt from another paper.");
  assert.doesNotMatch(JSON.stringify(calls[1]), /ABSTRACT_SECRET|2607\.22222/);
  assert.deepEqual(callRecords.map((record) => record.attemptType), ["initial", "repair_1"]);
  assert.equal(
    result.evidenceCard.problem.sources[0].excerpt,
    validResponseFor().evidenceCard.problem.sources[0].excerpt
  );
  assert.equal(callRecords[1].validation.repairScope.mode, "field_scoped_merge");
  assert.deepEqual(callRecords[1].validation.repairScope.evidenceFields, ["method"]);
});

test("Evidence Agent records unmatched numeric claims as warnings without content repair", async () => {
  const response = validResponseFor();
  response.evidenceCard.results.summary = "The method improves safety by 42%.";
  let calls = 0;

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    callModel: async () => {
      calls += 1;
      return response;
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.repairAttempted, false);
  assert.equal(result.validation.valid, true);
  assert.equal(result.validation.warnings.some((entry) => (
    entry.code === "numeric_claim_not_in_excerpt" && entry.blocking === false
  )), true);
});

test("定向 Evidence 修正只接收显式补丁并保留未修正字段", async () => {
  const initial = validResponseFor();
  initial.evidenceCard.method.sources[0].excerpt = "A fabricated method excerpt from another paper.";
  const expected = validResponseFor();
  const prompts = [];
  const callRecords = [];
  let calls = 0;

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    callModel: async (prompt) => {
      prompts.push(JSON.parse(prompt));
      calls += 1;
      return calls === 1
        ? initial
        : {
            paperId: "2607.11111",
            patch: { method: expected.evidenceCard.method }
          };
    },
    onCall: async (record) => callRecords.push(record)
  });

  assert.equal(result.validation.valid, true);
  assert.equal(calls, 2);
  assert.equal(prompts[1].outputContract, "evidence_patch");
  assert.deepEqual(Object.keys(prompts[1].outputSchema.patch), ["method"]);
  assert.equal(
    result.evidenceCard.problem.sources[0].excerpt,
    expected.evidenceCard.problem.sources[0].excerpt
  );
  assert.deepEqual(result.valueSignals, expected.valueSignals);
  assert.deepEqual(callRecords.map((record) => record.attemptType), ["initial", "repair_1"]);
});

test("证据字段和 Value Signal 同时失败时不强制在同一模型调用中重写", async () => {
  const initial = validResponseFor();
  initial.evidenceCard.method.sources[0].excerpt = "A fabricated method excerpt.";
  initial.valueSignals.signals[1].claim = "The result improves by 42%.";
  const expected = validResponseFor();
  const prompts = [];
  let calls = 0;

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    callModel: async (prompt) => {
      prompts.push(JSON.parse(prompt));
      calls += 1;
      if (calls === 1) return initial;
      if (calls === 2) {
        return { paperId: "2607.11111", patch: { method: expected.evidenceCard.method } };
      }
      return { paperId: "2607.11111", patch: {}, valueSignals: expected.valueSignals };
    }
  });

  assert.equal(result.validation.valid, true);
  assert.equal(calls, 2);
  assert.deepEqual(prompts[1].repairTargets.evidenceFields, ["method"]);
  assert.equal(prompts[1].repairTargets.rebuildValueSignals, false);
  assert.equal(result.valueSignals.signals.some((signal) => /42/.test(signal.claim)), true);
  assert.equal(result.validation.warnings.some((entry) => entry.code === "numeric_claim_not_in_excerpt"), true);
});

test("定向 Evidence 修正忽略越界字段，但仍只合并请求字段", async () => {
  const initial = validResponseFor();
  initial.evidenceCard.method.sources[0].excerpt = "A fabricated method excerpt from another paper.";
  const expected = validResponseFor();
  let calls = 0;

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    callModel: async () => {
      calls += 1;
      if (calls === 1) return initial;
      return {
        paperId: "2607.11111",
        patch: {
          method: expected.evidenceCard.method,
          results: {
            summary: "An unrequested and unsupported replacement.",
            status: "supported",
            sources: []
          }
        },
        valueSignals: expected.valueSignals,
        explanation: "This metadata is outside the patch contract."
      };
    }
  });

  assert.equal(result.validation.valid, true);
  assert.equal(calls, 2);
  assert.equal(result.evidenceCard.results.summary, expected.evidenceCard.results.summary);
});

test("定向补丁的格式修正仍要求同一补丁契约", async () => {
  const initial = validResponseFor();
  initial.evidenceCard.method.sources[0].excerpt = "A fabricated method excerpt from another paper.";
  const expected = validResponseFor();
  const prompts = [];
  let calls = 0;

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    callModel: async (prompt) => {
      prompts.push(JSON.parse(prompt));
      calls += 1;
      if (calls === 1) return initial;
      if (calls === 2) return "{\"paperId\":\"2607.11111\",\"patch\":";
      return {
        paperId: "2607.11111",
        patch: { method: expected.evidenceCard.method },
        valueSignals: expected.valueSignals
      };
    }
  });

  assert.equal(result.validation.valid, true);
  assert.equal(calls, 3);
  assert.equal(prompts[2].task, "weekly_report_extract_evidence_response_repair");
  assert.equal(prompts[2].outputContract, "evidence_patch");
  assert.deepEqual(Object.keys(prompts[2].outputSchema.patch), ["method"]);
});

test("malformed initial Evidence uses independent format recovery and keeps semantic doubts as warnings", async () => {
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

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket,
    callModel: async (prompt) => {
      calls += 1;
      prompts.push(JSON.parse(prompt));
      return calls === 1 ? "{\"evidenceCard\":" : repairedResponse;
    }
  });

  assert.equal(calls, 2);
  assert.equal(prompts[1].task, "weekly_report_extract_evidence_response_repair");
  assert.equal(prompts[1].responseIssues.some((entry) => entry.code === "invalid_json"), true);
  assert.equal(prompts.filter((prompt) => prompt.task === "weekly_report_extract_evidence_repair").length, 0);
  assert.equal(result.validation.warnings.some((entry) => entry.code === "commercial_vlm_long_document_source_missing"), true);
});

test("Evidence 格式错误最多独立修正两次，耗尽后记为处理失败而非内容排除", async () => {
  const events = [];
  const callRecords = [];
  let calls = 0;

  await assert.rejects(
    () => runEvidenceAgent({
      paper: { id: "2607.11111" },
      contextPacket: contextPacketFor(),
      callModel: async () => {
        calls += 1;
        return "{\"evidenceCard\":";
      },
      onCall: async (record) => callRecords.push(record),
      onEvent: async (event) => events.push(event)
    }),
    (error) => (
      error instanceof EvidenceAgentError
      && error.code === "READING_LIST_EVIDENCE_RESPONSE_INVALID"
      && error.processingFailed === true
      && error.excludePaper === false
    )
  );

  assert.equal(calls, 3);
  assert.deepEqual(callRecords.map((record) => record.attemptType), [
    "initial",
    "response_repair_1",
    "response_repair_2"
  ]);
  assert.equal(events.filter((event) => event.type === "evidence_response_repair_requested").length, 2);
});

test("Evidence 第二次格式修正成功后可以进入后续验证", async () => {
  const callRecords = [];
  let calls = 0;
  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    callModel: async () => {
      calls += 1;
      return calls < 3 ? "{\"evidenceCard\":" : validResponseFor();
    },
    onCall: async (record) => callRecords.push(record)
  });

  assert.equal(result.validation.valid, true);
  assert.equal(result.responseRepairAttempted, true);
  assert.equal(result.responseRepairCount, 2);
  assert.deepEqual(callRecords.map((record) => record.attemptType), [
    "initial",
    "response_repair_1",
    "response_repair_2"
  ]);
});

test("局部补丁的结构错误在首次格式修正耗尽后仍可获得独立修正", async () => {
  const invalidInitial = validResponseFor();
  invalidInitial.evidenceCard.method.sources[0].excerpt = "A fabricated method excerpt from another paper.";
  const expected = validResponseFor();
  const prompts = [];
  const callRecords = [];
  let calls = 0;

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    callModel: async (prompt) => {
      prompts.push(JSON.parse(prompt));
      calls += 1;
      if (calls < 3) return "{\"evidenceCard\":";
      if (calls === 3) return invalidInitial;
      if (calls === 4) {
        return {
          paperId: "2607.11111",
          patch: {
            method: {
              ...expected.evidenceCard.method,
              status: "verified"
            }
          },
          valueSignals: expected.valueSignals
        };
      }
      return {
        paperId: "2607.11111",
        patch: { method: expected.evidenceCard.method },
        valueSignals: expected.valueSignals
      };
    },
    onCall: async (record) => callRecords.push(record)
  });

  assert.equal(result.validation.valid, true);
  assert.equal(calls, 5);
  assert.equal(result.responseRepairCount, 3);
  assert.equal(prompts[4].task, "weekly_report_extract_evidence_response_repair");
  assert.equal(prompts[4].outputContract, "evidence_patch");
  assert.equal(prompts[4].responseIssues.some((issue) => issue.code === "schema_invalid"), true);
  assert.equal(prompts[4].responseIssues.some((issue) => issue.previousValue !== undefined), false);
  assert.match(JSON.stringify(prompts[4].responseIssues), /supported, not_present, or insufficient/i);
  assert.deepEqual(callRecords.map((record) => record.attemptType), [
    "initial",
    "response_repair_1",
    "response_repair_2",
    "repair_1",
    "response_repair_3"
  ]);
});

test("Evidence 结构缺项会以中文说明缺少的对象，并保留最后一次返回", async () => {
  await assert.rejects(
    () => runEvidenceAgent({
      paper: { id: "2607.11111" },
      contextPacket: contextPacketFor(),
      callModel: async () => "{}"
    }),
    (error) => (
      error instanceof EvidenceAgentError
      && error.code === "READING_LIST_EVIDENCE_RESPONSE_INVALID"
      && error.issues?.[0]?.code === "schema_invalid"
      && error.responseDiagnostic?.reason === "最后一次模型返回缺少完整的证据卡对象。"
      && error.responseDiagnostic?.responseExcerpt === "{}"
    )
  );
});

test("schema-incomplete Evidence content repair becomes a processing failure instead of content exclusion", async () => {
  const initial = validResponseFor();
  initial.evidenceCard.results.sources[0].excerpt = "A fabricated result excerpt.";
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
      && error.code === "READING_LIST_EVIDENCE_RESPONSE_INVALID"
      && error.processingFailed === true
      && error.excludePaper === false
    )
  );

  assert.equal(calls, 4);
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

test("Evidence numeric claims ignore alphanumeric identifiers", () => {
  assert.deepEqual(extractEvidenceNumericTokens("6G、3D、1B 与 F1"), []);
  assert.deepEqual(extractEvidenceNumericTokens("JAWS-0/1/M 是消融配置名称"), []);
  assert.deepEqual(
    extractEvidenceNumericTokens("10 秒内降低 37.5%，覆盖 120 samples"),
    ["10", "37.5%", "120"]
  );
});

test("Evidence numeric claims preserve decimal speedup values before x units", () => {
  assert.deepEqual(
    extractEvidenceNumericTokens("Speedups are 3.27x, 7.22X, 0.42×, and 18.17 times."),
    ["3.27", "7.22", "0.42", "18.17"]
  );
  assert.notDeepEqual(
    extractEvidenceNumericTokens("3.28x"),
    extractEvidenceNumericTokens("3.27 ×")
  );
});

test("flat Evidence envelope is wrapped before Schema validation", () => {
  const flatResponse = JSON.parse(readFileSync(
    new URL("./fixtures/weekly-report/gray-124-flat-evidence-response.json", import.meta.url),
    "utf8"
  ));

  const normalized = normalizeEvidenceResponseShape(flatResponse);
  assert.equal(normalized.normalized, true);
  assert.equal(normalized.value.evidenceCard.paperId, "2607.11111");

  const validation = validateEvidenceArtifacts(normalized.value, {
    contextPacket: contextPacketFor(),
    expectedPaperId: "2607.11111"
  });
  assert.equal(validation.valid, true);
});

test("stringified answer Evidence envelope is safely expanded before Schema validation", () => {
  const response = validResponseFor();
  const wrapped = { answer: JSON.stringify(response) };

  const normalized = normalizeEvidenceResponseShape(wrapped);
  assert.equal(normalized.normalized, true);
  assert.equal(normalized.reason, "stringified_answer_envelope");
  assert.deepEqual(normalized.value, response);

  const validation = validateEvidenceArtifacts(wrapped, {
    contextPacket: contextPacketFor(),
    expectedPaperId: "2607.11111"
  });
  assert.equal(validation.valid, true);
});

test("stringified answer Evidence envelope is not expanded when sibling fields make it ambiguous", () => {
  const response = validResponseFor();
  const wrapped = {
    answer: JSON.stringify(response),
    status: "complete"
  };

  const normalized = normalizeEvidenceResponseShape(wrapped);
  assert.equal(normalized.normalized, false);
  assert.equal(normalized.value, wrapped);
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

test("unsupported numeric prose is retained as a non-blocking Evidence warning", async () => {
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

  assert.equal(calls, 1);
  assert.equal(result.validation.valid, true);
  assert.equal(result.deterministicSanitizationApplied, undefined);
  assert.match(result.evidenceCard.results.summary, /42/);
  assert.equal(result.valueSignals.signals.some((signal) => /42/.test(signal.claim)), true);
  assert.equal(result.validation.warnings.some((entry) => entry.code === "numeric_claim_not_in_excerpt"), true);
  assert.equal(events.some((event) => event.type === "evidence_numeric_claims_sanitized"), false);
});

test("unbound numeric sentences remain visible and are recorded as warnings", async () => {
  const invalid = validResponseFor();
  invalid.evidenceCard.results.summary = "The benchmark evaluates extraction reliability. Unsafe actions are reduced by 42%.";
  invalid.valueSignals.signals[1].claim = "The reported unsafe-action reduction is 42%.";

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    callModel: async () => invalid
  });

  assert.equal(result.validation.valid, true);
  assert.equal(result.deterministicSanitizationApplied, undefined);
  assert.equal(result.evidenceCard.results.status, "supported");
  assert.match(result.evidenceCard.results.summary, /42/);
  assert.equal(result.evidenceCard.results.sources.length > 0, true);
  assert.equal(result.valueSignals.signals.some((signal) => /42/.test(signal.claim)), true);
  assert.equal(result.validation.warnings.some((entry) => entry.code === "numeric_claim_not_in_excerpt"), true);
});

test("三次内容修正后仍不合格会抛出可排除单篇的 Evidence 错误", async () => {
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

  assert.equal(calls, 4);
});

test("证据提取内容修正失败会保留最后一次证据产物供管理员复核", async () => {
  const invalid = validResponseFor();
  invalid.evidenceCard.results.sources[0].anchor = "S999";

  await assert.rejects(
    () => runEvidenceAgent({
      paper: { id: "2607.11111" },
      contextPacket: contextPacketFor(),
      callModel: async () => invalid
    }),
    (error) => (
      error instanceof EvidenceAgentError
      && error.code === "READING_LIST_EVIDENCE_UNSUPPORTED"
      && error.artifacts?.evidenceCard?.results?.sources?.[0]?.anchor === "S999"
    )
  );
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

test("concurrent paper retries use deterministic different wait values", async () => {
  const events = [];
  const attempts = new Map();
  const result = await extractEvidenceBatch([
    { paper: { id: "2607.11111" }, contextPacket: contextPacketFor("2607.11111") },
    { paper: { id: "2607.11112" }, contextPacket: contextPacketFor("2607.11112") }
  ], {
    paperConcurrency: 2,
    networkRetryDelayMs: 100,
    callModel: async (_prompt, options) => {
      const count = (attempts.get(options.paperId) || 0) + 1;
      attempts.set(options.paperId, count);
      if (count === 1) {
        const error = new Error("temporary upstream failure");
        error.code = "READING_LIST_AGENT_CALL_FAILED";
        throw error;
      }
      return validResponseFor(options.paperId);
    },
    onEvent: async (event) => events.push(event)
  });

  const retries = events.filter((event) => event.type === "network_retry");
  assert.equal(result.succeeded.length, 2);
  assert.equal(retries.length, 2);
  assert.equal(new Set(retries.map((event) => event.waitMs)).size, 2);
  assert.equal([...attempts.values()].every((count) => count === 2), true);
});

test("two incomplete model responses are recorded without excluding the paper", async () => {
  let calls = 0;
  const events = [];

  const result = await extractEvidenceBatch([{
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
  });

  assert.equal(calls, 2);
  assert.equal(result.succeeded.length, 0);
  assert.equal(result.excluded.length, 0);
  assert.equal(result.processingFailed[0].error.code, "READING_LIST_AGENT_RESPONSE_INCOMPLETE");
  assert.equal(events.some((event) => event.type === "network_retry"), true);
  assert.equal(events.find((event) => event.type === "network_retry")?.error?.stopReason, "max_tokens");
  assert.equal(events.some((event) => event.type === "repair_requested"), false);
  assert.equal(events.some((event) => event.type === "evidence_excluded"), false);
  assert.equal(events.some((event) => event.type === "evidence_processing_failed"), true);
  assert.equal(events.some((event) => event.type === "evidence_processing_started" && event.paperId === "2607.11111"), true);
  assert.equal(events.filter((event) => event.type === "model_call_started").length, 2);
});

test("Evidence 格式恢复耗尽后批处理继续其它论文，不产生 evidence_excluded", async () => {
  const events = [];
  const result = await extractEvidenceBatch([
    { paper: { id: "2607.11111" }, contextPacket: contextPacketFor("2607.11111") },
    { paper: { id: "2607.11112" }, contextPacket: contextPacketFor("2607.11112") }
  ], {
    paperConcurrency: 1,
    callModel: async (_prompt, options) => (
      options.paperId === "2607.11111" ? "{\"apiKey\":\"top-secret\",\"evidenceCard\":" : validResponseFor("2607.11112")
    ),
    onEvent: async (event) => events.push(event)
  });

  assert.equal(result.succeeded.length, 1);
  assert.equal(result.succeeded[0].evidenceCard.paperId, "2607.11112");
  assert.equal(result.excluded.length, 0);
  assert.equal(result.processingFailed.length, 1);
  assert.equal(result.processingFailed[0].error.code, "READING_LIST_EVIDENCE_RESPONSE_INVALID");
  assert.deepEqual(result.processingFailed[0].error.responseDiagnostic, {
    reason: "最后一次模型返回不是完整的 JSON 对象，无法解析为证据卡和阅读价值信号。",
    responseExcerpt: "{\"apiKey\":[REDACTED],\"evidenceCard\":"
  });
  assert.equal(events.some((event) => event.type === "evidence_excluded"), false);
  assert.equal(events.some((event) => event.type === "evidence_processing_failed"), true);
});

test("two model transport failures are recorded without excluding the paper", async () => {
  let calls = 0;
  const events = [];
  const callRecords = [];

  const result = await extractEvidenceBatch([{
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor()
  }], {
    paperConcurrency: 1,
    networkRetryDelayMs: 0,
    callModel: async () => {
      calls += 1;
      const error = new Error("upstream connection reset authorization=Bearer transport-private");
      error.code = "READING_LIST_AGENT_CALL_FAILED";
      error.retryable = true;
      throw error;
    },
    onEvent: async (event) => events.push(event),
    onCall: async (record) => callRecords.push(record)
  });

  assert.equal(calls, 2);
  assert.equal(result.succeeded.length, 0);
  assert.equal(result.excluded.length, 0);
  assert.equal(result.processingFailed.length, 1);
  assert.equal(result.processingFailed[0].error.code, "READING_LIST_AGENT_CALL_FAILED");
  assert.doesNotMatch(JSON.stringify(callRecords), /transport-private/);
  assert.doesNotMatch(JSON.stringify(events), /transport-private/);
  assert.match(callRecords[0].error.message, /\[REDACTED\]/);
  assert.equal(events.some((event) => event.type === "network_retry"), true);
  assert.equal(events.some((event) => event.type === "repair_requested"), false);
  assert.equal(events.some((event) => event.type === "evidence_excluded"), false);
  assert.equal(events.some((event) => event.type === "evidence_processing_failed"), true);
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

test("定向 repair prompt 只声明局部补丁契约，不混入完整卡片契约", () => {
  const currentArtifacts = validResponseFor();
  const prompt = buildEvidenceRepairPrompt({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    currentArtifacts,
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
  assert.equal(Object.hasOwn(payload.completenessContract, "evidenceCardRequiredFields"), false);
  assert.deepEqual(payload.completenessContract.patchRequiredEvidenceFields, ["problem", "results"]);
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
  assert.equal(payload.outputContract, "evidence_patch");
  assert.match(payload.repairInstruction, /patch must contain exactly/i);
  assert.deepEqual(Object.keys(payload.outputSchema.patch), ["problem", "results"]);
  assert.equal(Object.hasOwn(payload.outputSchema, "evidenceField"), false);
  assert.deepEqual(Object.keys(payload.outputSchema.patch.problem), ["summary", "status", "sources"]);
  assert.deepEqual(payload.repairTargets.evidenceFields, ["problem", "results"]);
  assert.equal(payload.repairTargets.rebuildValueSignals, true);
  assert.match(payload.serverMergePolicy, /ignored/i);
  assert.deepEqual(
    payload.currentEvidenceReferenceCatalog.results.map((entry) => entry.ref),
    ["results:0"]
  );
  assert.match(payload.evidenceRefInstruction, /field:index/i);
  assert.match(payload.evidenceRefInstruction, /section names such as intro/i);
  const repairHints = payload.issues.flatMap((entry) => entry.repairHints || []).join(" ");
  assert.match(repairHints, /supplied sourceId/i);
  assert.match(repairHints, /antecedent/i);
  assert.match(repairHints, /remove the exact number/i);
  assert.match(repairHints, /problem, gap, challenge/i);
  assert.match(repairHints, /both commercial VLMs and the long-document scope/i);
});

test("invalid Value Signal references are pruned without discarding supported Evidence", async () => {
  const invalid = validResponseFor();
  invalid.valueSignals.signals[1].evidenceRefs = ["results:0", "results:23"];
  const events = [];

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      if (payload.task === "weekly_report_extract_evidence") return invalid;
      return {
        paperId: "2607.11111",
        patch: {},
        valueSignals: invalid.valueSignals
      };
    },
    onEvent: async (event) => events.push(event)
  });

  assert.equal(result.validation.valid, true);
  assert.equal(result.evidenceCard.results.summary, invalid.evidenceCard.results.summary);
  assert.deepEqual(result.valueSignals.signals[1].evidenceRefs, ["results:0"]);
  assert.equal(result.deterministicValueSignalSanitizationApplied, true);
  assert.equal(events.some((event) => event.type === "evidence_value_signals_sanitized"), true);
});

test("Evidence prompt exposes server-owned source units and requests IDs instead of copied excerpts", () => {
  const payload = JSON.parse(buildEvidencePrompt({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor()
  }));

  assert.match(payload.context.sections[0].units[0].sourceId, /^2607\.11111:S0:U000$/);
  assert.equal(typeof payload.context.sections[0].units[0].text, "string");
  assert.deepEqual(payload.outputSchema.evidenceField.sources, [
    { sourceId: "one supplied sourceId" }
  ]);
  assert.deepEqual(payload.completenessContract.everyEvidenceSourceRequiredFields, ["sourceId"]);
  assert.doesNotMatch(JSON.stringify(payload.outputSchema), /verbatim short excerpt/iu);
  assert.match(payload.rules.join(" "), /server.*materialize|sourceId/iu);
});

test("Evidence Agent materializes source IDs before exact-number validation", async () => {
  const contextPacket = contextPacketFor();
  const registry = buildEvidenceSourceRegistry(contextPacket);
  const response = validResponseFor();
  const idByAnchor = new Map(registry.sections.map((section) => [
    section.anchor,
    section.units[0].sourceId
  ]));
  for (const field of Object.values(response.evidenceCard)) {
    if (!field || typeof field !== "object" || !Array.isArray(field.sources)) continue;
    field.sources = field.sources.map((entry) => ({ sourceId: idByAnchor.get(entry.anchor) }));
  }

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket,
    callModel: async () => response
  });

  const resultUnit = registry.byId.get(idByAnchor.get("S4"));
  assert.equal(result.validation.valid, true);
  assert.equal(result.evidenceCard.results.sources[0].sourceId, resultUnit.sourceId);
  assert.equal(result.evidenceCard.results.sources[0].excerpt, resultUnit.text);
  assert.equal(result.evidenceCard.results.sources[0].rawExcerpt, resultUnit.rawText);
  assert.equal(result.evidenceCard.results.sources[0].section, "4 Results and Discussion");
});

test("scoped Evidence patches materialize IDs before merging", async () => {
  const contextPacket = contextPacketFor();
  const registry = buildEvidenceSourceRegistry(contextPacket);
  const initial = validResponseFor();
  initial.evidenceCard.method.sources[0].excerpt = "A fabricated method excerpt.";
  const methodUnit = registry.sections.find((section) => section.anchor === "S2").units[0];
  let calls = 0;

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket,
    callModel: async () => {
      calls += 1;
      if (calls === 1) return initial;
      return {
        paperId: "2607.11111",
        patch: {
          method: {
            ...validResponseFor().evidenceCard.method,
            sources: [{ sourceId: methodUnit.sourceId }]
          }
        }
      };
    }
  });

  assert.equal(result.validation.valid, true);
  assert.equal(result.evidenceCard.method.sources[0].sourceId, methodUnit.sourceId);
  assert.equal(result.evidenceCard.method.sources[0].excerpt, methodUnit.text);
  assert.equal(
    result.evidenceCard.problem.sources[0].excerpt,
    validResponseFor().evidenceCard.problem.sources[0].excerpt
  );
});

test("server-owned source IDs tolerate arXiv duplicate numbers and LaTeX typography", async () => {
  const contextPacket = contextPacketFor();
  contextPacket.inputSections[2].text = "2 Method and System Architecture\n\nThe method improves F1 by 5.1 5.1 points with loss \\(L=x^2\\).";
  contextPacket.inputText = contextPacket.inputSections.map((section) => section.text).join("\n\n");
  const registry = buildEvidenceSourceRegistry(contextPacket);
  const methodUnit = registry.sections.find((section) => section.anchor === "S2").units[0];
  const response = validResponseFor();
  response.evidenceCard.method = {
    summary: "The method improves F1 by 5.1 points.",
    status: "supported",
    sources: [{ sourceId: methodUnit.sourceId }]
  };

  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket,
    callModel: async () => response
  });

  assert.equal(result.validation.valid, true);
  assert.match(result.evidenceCard.method.sources[0].excerpt, /5\.1 points/);
  assert.doesNotMatch(result.evidenceCard.method.sources[0].excerpt, /5\.1 5\.1|\\[()]/);
});

test("arXiv 重复数字标记可唯一匹配时由服务端还原为原文摘录", () => {
  const contextPacket = contextPacketFor();
  const canonicalExcerpt = "JAWS-0 consists of 182 182 textual jailbreaking prompts, covering three attack classes.";
  const modelExcerpt = "JAWS-0 consists of 182 textual jailbreaking prompts covering three attack classes.";
  contextPacket.inputSections[2].text += " " + canonicalExcerpt;
  const response = validResponseFor();
  response.evidenceCard.systemDesign = {
    summary: "JAWS-0 contains 182 textual jailbreaking prompts across three attack classes.",
    status: "supported",
    sources: [source("S2", "2 Method and System Architecture", modelExcerpt)]
  };

  const validation = validateEvidenceArtifacts(response, {
    contextPacket,
    expectedPaperId: contextPacket.paperId
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.artifacts.evidenceCard.systemDesign.sources[0].excerpt, canonicalExcerpt);
});

test("interpretability 是有效的 Value Signal 分析角度", () => {
  const response = validResponseFor();
  response.valueSignals.signals[0].adnImplication.angle = "interpretability";

  const validation = validateEvidenceArtifacts(response, {
    contextPacket: contextPacketFor(),
    expectedPaperId: "2607.11111"
  });

  assert.equal(validation.valid, true);
});

test("Value Signal 枚举错误会指出具体字段、实际值和允许值", () => {
  const response = validResponseFor();
  response.valueSignals.signals[0].adnImplication.angle = "totally_unknown_angle";

  const validation = validateEvidenceArtifacts(response, {
    contextPacket: contextPacketFor(),
    expectedPaperId: "2607.11111"
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues[0].code, "schema_invalid");
  assert.match(validation.issues[0].detail, /adnImplication\.angle/);
  assert.match(validation.issues[0].detail, /totally_unknown_angle/);
  assert.match(validation.issues[0].detail, /closed_loop/);
});

test("定向 response repair 沿用局部补丁契约", () => {
  const payload = JSON.parse(buildEvidenceResponseRepairPrompt({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    repairTargets: {
      mode: "field_scoped_merge",
      evidenceFields: ["method"],
      rebuildValueSignals: true
    },
    issues: [{ code: "schema_invalid", path: "response", detail: "unsupported field" }]
  }));

  assert.equal(payload.outputContract, "evidence_patch");
  assert.equal(Object.hasOwn(payload.completenessContract, "evidenceCardRequiredFields"), false);
  assert.deepEqual(payload.completenessContract.patchRequiredEvidenceFields, ["method"]);
  assert.equal(Object.hasOwn(payload.outputSchema, "evidenceField"), false);
  assert.deepEqual(Object.keys(payload.outputSchema.patch.method), ["summary", "status", "sources"]);
});

test("Evidence Agent 接受唯一完整 JSON 后的普通说明，但不跳过证据校验", async () => {
  const response = validResponseFor();
  let calls = 0;
  const result = await runEvidenceAgent({
    paper: { id: "2607.11111" },
    contextPacket: contextPacketFor(),
    callModel: async () => {
      calls += 1;
      return JSON.stringify(response) + "\nNote: the JSON object above is the complete response.";
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.validation.valid, true);
  assert.equal(result.evidenceCard.paperId, "2607.11111");
});

test("Evidence Agent realtime model responses cannot use legacy copied excerpts", async () => {
  let calls = 0;

  await assert.rejects(
    () => runEvidenceAgentImpl({
      paper: { id: "2607.11111" },
      contextPacket: contextPacketFor(),
      callModel: async () => {
        calls += 1;
        return validResponseFor();
      }
    }),
    (error) => (
      error instanceof EvidenceAgentError
      && error.code === "READING_LIST_EVIDENCE_RESPONSE_INVALID"
      && error.processingFailed === true
      && error.issues.some((entry) => /must use sourceId/iu.test(entry.detail))
    )
  );

  assert.equal(calls, 3);
});
