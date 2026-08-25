import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { WeeklyReportJobManager } from "../weekly-report/job-manager.js";
import {
  assembleWeeklyReport,
  calibrateWeeklyReportPapers,
  extractWeeklyReportEvidence,
  planWeeklyReportEditorial,
  prepareWeeklyReportJob,
  repairWeeklyReportOnce,
  runWeeklyReportDeterministicQa,
  runWeeklyReportPaperSemanticQa,
  runWeeklyReportReportSemanticQa,
  reviewWeeklyReportPapers,
  selectWeeklyReportPapers,
  writeWeeklyReportHeadTail,
  writeWeeklyReportPaperSections
} from "../weekly-report/orchestrator.js";
import { WeeklyReportTraceStore } from "../weekly-report/trace-store.js";

const tempDirectories = [];
const waitForManualReview = async (manager, jobId) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await manager.getJob(jobId);
    if (job?.manualReview) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for weekly report manual review.");
};
const inWeek = "2026-07-30T00:00:00.000Z";
const inputRange = {
  weekStart: "2026-07-27T00:00:00.000Z",
  weekEnd: "2026-08-03T00:00:00.000Z"
};

const packetFor = (paperId, passed = true) => ({
  paperId,
  source: "arxiv-html",
  status: passed ? "available" : "insufficient_full_text",
  qualityGate: {
    passed,
    reasons: passed ? [] : ["body_text_too_short"]
  }
});

const evidencePacketFor = (paperId) => ({
  paperId,
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

const evidenceResponseFor = (paperId, { valid = true } = {}) => ({
  evidenceCard: {
    paperId,
    problem: {
      summary: "Autonomous agents can issue unsafe actions.",
      status: "supported",
      sources: [{
        anchor: "S1",
        section: "1 Introduction",
        excerpt: valid ? "Autonomous agents can issue unsafe actions." : "Fabricated evidence."
      }]
    },
    method: {
      summary: "The guardrail validates actions before execution.",
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
    paperId,
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

const reviewResponseFor = (paperId, {
  valid = true,
  evidenceStatus = "pass"
} = {}) => ({
  paperId,
  evidenceValidation: {
    status: evidenceStatus,
    issues: evidenceStatus === "pass" ? [] : [{
      field: "method",
      code: "claim_overstates_excerpt",
      message: "The method summary overstates the bound excerpt."
    }]
  },
  scores: valid ? {
    scenarioProblemValue: 80,
    methodNovelty: 90,
    practicalValue: 70,
    evidence: 60
  } : {
    scenarioProblemValue: 101,
    methodNovelty: 90,
    practicalValue: 70,
    evidence: 60
  },
  scoreReason: "The method is strong but evidence remains simulation-only.",
  weakness: "Production traffic is not evaluated.",
  uncertainty: "Operational generalization remains unclear.",
  interestFit: "target_network_autonomy",
  interestReason: "The work studies safety for autonomous network actions.",
  affiliations: ["示例大学"],
  affiliationEvidenceRefs: ["affiliations:0"],
  rawScore: 100
});

const calibrationResponseFor = (paperIds, optionsByPaper = {}) => ({
  results: paperIds.map((paperId) => ({
    paperId,
    status: optionsByPaper[paperId]?.status || "consistent",
    relativePosition: "The paper is aligned with the middle of this cohort.",
    suspectedMisjudgments: optionsByPaper[paperId]?.suspectedMisjudgments || [],
    readingTier: optionsByPaper[paperId]?.readingTier || "worth_reading",
    calibrationReason: "The relative position matches the compact Evidence and Review artifacts."
  }))
});

const calibratedItemFor = (paperId, rawScore, readingTier, {
  calibrationStatus = "consistent",
  oldScore = 100
} = {}) => {
  const artifacts = evidenceResponseFor(paperId);
  const reviewResult = reviewResponseFor(paperId);
  reviewResult.rawScore = rawScore;
  return {
    paper: {
      id: paperId,
      published: inWeek,
      readingListReview: { score: oldScore },
      analysis: { score: oldScore }
    },
    contextPacket: evidencePacketFor(paperId),
    ...artifacts,
    reviewResult,
    calibrationResult: {
      paperId,
      status: calibrationStatus,
      relativePosition: "cohort position",
      suspectedMisjudgments: [],
      readingTier,
      calibrationReason: "calibrated"
    }
  };
};

const editorialPlanFor = (selectedItems) => {
  const ids = selectedItems.map((item) => item.paper.id);
  return {
    coreTheme: "Pre-execution validation is becoming a shared safety mechanism.",
    titleAngle: "Verifiable action constraints",
    trends: [{
      claim: "Multiple papers move safety validation before autonomous action execution.",
      supportingPaperIds: ids.slice(0, 2),
      evidenceRefs: [`${ids[0]}:method:0`, `${ids[1]}:results:0`],
      maturity: "developing",
      caveat: "Current evaluation remains simulation-oriented."
    }],
    singlePaperObservations: ids.slice(2).map((paperId) => ({
      paperId,
      claim: "This paper adds a complementary constraint-validation perspective.",
      evidenceRefs: [`${paperId}:method:0`],
      caveat: "Its production applicability remains unevaluated."
    })),
    readingOrder: ids.map((paperId) => ({
      paperId,
      reason: "Read in the deterministic final priority order."
    }))
  };
};

const paperDraftFor = (paperId) => {
  const grounded = (text, evidenceRefs) => ({ text, evidenceRefs });
  return {
    paperId,
    oneSentenceTakeaway: grounded(
      "The paper makes autonomous execution safer through pre-execution validation.",
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
      "A guardrail validates actions before they are executed.",
      ["method:0"]
    ),
    experimentsAndResults: grounded(
      "In simulated failure scenarios, unsafe actions are reduced by 37%.",
      ["experiments:0", "results:0"]
    ),
    limitationsAndConstraints: [
      grounded("Production traffic is not evaluated.", ["limitations:0"]),
      grounded("The evaluation is limited to simulated failure scenarios.", ["experiments:0"])
    ],
    adnInsight: grounded(
      "The guardrail may constrain autonomous network actions, with simulation as the current boundary.",
      ["method:0", "experiments:0"]
    ),
    readingValue: {
      whyWorthReading: grounded(
        "It provides a concrete action-validation mechanism.",
        ["method:0"]
      ),
      recommendedFocus: grounded(
        "Focus on the validation mechanism and evaluation boundary.",
        ["method:0", "experiments:0"]
      ),
      evidenceBoundary: grounded(
        "Production applicability remains unresolved.",
        ["limitations:0"]
      )
    }
  };
};

const headTailFor = (editorialPlan, selectedItems) => ({
  titleAngle: "Verifiable action constraints",
  description: "Grounded guidance for safer autonomous execution.",
  tags: ["network autonomy", "safety", "validation"],
  reportIntroduction: "The selected work centers on validating autonomous actions before execution while keeping deployment boundaries explicit.",
  trendJudgments: editorialPlan.trends.map((trend, trendIndex) => ({
    trendIndex,
    claim: "Across the selected work, safety validation moves ahead of autonomous action execution.",
    caveat: "The available evaluation remains dominated by simulation."
  })),
  singlePaperObservations: editorialPlan.singlePaperObservations.map((observation, observationIndex) => ({
    observationIndex,
    claim: "This paper is best used as a complementary validation perspective.",
    caveat: "Its production applicability remains unresolved."
  })),
  readingOrder: selectedItems.map((entry) => ({
    paperId: entry.paper.id,
    reason: "Read in the deterministic final priority order."
  })),
  closingSummary: "Read the mechanism first, compare evaluation boundaries next, and treat production transfer as an open question."
});

const paperSemanticPassFor = (paperId) => ({
  paperId,
  verdict: "pass",
  summary: "The final paper section is grounded in its bound Evidence.",
  checks: {
    factsGrounded: true,
    methodGrounded: true,
    experimentsGrounded: true,
    numbersGrounded: true,
    affiliationsGrounded: true,
    limitationsGrounded: true,
    recommendationToneAligned: true,
    readerLanguageChinese: true
  },
  issues: []
});

const reportSemanticPass = () => ({
  verdict: "pass",
  summary: "The report-level narrative is supported by the selected cohort.",
  checks: {
    titleGrounded: true,
    introductionGrounded: true,
    trendsMultiPaperGrounded: true,
    observationsNotPromoted: true,
    readingOrderAligned: true,
    headTailIsolated: true,
    readerLanguageChinese: true
  },
  issues: []
});

const fakeExecutionContext = (overrides = {}) => {
  const updates = [];
  const events = [];
  const sections = new Map();
  return {
    updates,
    events,
    sections,
    context: {
      jobId: "job-prepare",
      traceId: "trace-prepare",
      signal: new AbortController().signal,
      updateStage: async (stage, patch) => {
        updates.push({ stage, patch });
      },
      recordTrace: async (event) => {
        events.push(event);
      },
      writeTrace: async (name, value) => {
        sections.set(name, value);
      },
      ...overrides
    }
  };
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

test("Orchestrator 按 prepare_candidate_pool → prepare_context 顺序执行并落 Trace", async () => {
  const execution = fakeExecutionContext();
  const attempts = [];
  const input = {
    ...inputRange,
    minSelectedCount: 2,
    paperConcurrency: 2,
    primaryPapers: [
      { id: "p-good", published: inWeek },
      { id: "p-bad", published: inWeek },
      { id: "p-hidden", hidden: true, published: inWeek },
      { id: "p-old", published: "2026-07-01T00:00:00.000Z" }
    ],
    reservePapers: [
      { id: "p-good", published: inWeek },
      { id: "r-good", published: inWeek },
      { id: "r-unused", published: inWeek }
    ],
    sourceSnapshot: [{ id: "snapshot-paper", score: 99 }]
  };
  const originalInput = structuredClone(input);
  const prepared = await prepareWeeklyReportJob(input, execution.context, {
    buildContext: async (paper) => {
      attempts.push(paper.id);
      return packetFor(paper.id, ["p-good", "r-good"].includes(paper.id));
    }
  });

  assert.deepEqual(input, originalInput);
  assert.deepEqual(attempts, ["p-good", "p-bad", "r-good"]);
  assert.deepEqual(
    [...new Set(execution.updates.map((update) => update.stage))],
    ["prepare_candidate_pool", "prepare_context"]
  );
  assert.equal(prepared.nextStage, "extract_evidence");
  assert.deepEqual(prepared.eligiblePapers.map((paper) => paper.id), ["p-good", "r-good"]);
  assert.deepEqual(prepared.counts, {
    primary: 2,
    reserve: 2,
    fullTextEligible: 2,
    reviewed: 0,
    calibrated: 0,
    selected: 0,
    excluded: 4
  });
  assert.deepEqual(execution.sections.get("candidate-pool").sourceSnapshot, input.sourceSnapshot);
  assert.equal(execution.sections.get("context-packets").eligible.length, 2);
  assert.equal(execution.sections.get("context-packets").excluded.length, 1);
  assert.equal(execution.events.some((event) => event.type === "stage_completed" && event.stage === "prepare_context"), true);
});

test("零篇合格原文时抛出结构化拒绝错误并保留排除 Trace", async () => {
  const execution = fakeExecutionContext();
  let caught;

  try {
    await prepareWeeklyReportJob({
      ...inputRange,
      minSelectedCount: 3,
      primaryPapers: [{ id: "invalid", published: inWeek }],
      reservePapers: []
    }, execution.context, {
      buildContext: async (paper) => packetFor(paper.id, false)
    });
  } catch (error) {
    caught = error;
  }

  assert.equal(caught.code, "READING_LIST_NO_ELIGIBLE_PAPERS");
  assert.equal(caught.stage, "prepare_context");
  assert.equal(caught.traceId, "trace-prepare");
  assert.equal(caught.retryable, false);
  assert.equal(caught.rejectJob, true);
  assert.equal(execution.sections.get("context-packets").excluded.length, 1);
  assert.equal(execution.events.some((event) => event.type === "reject_requested"), true);
});

test("取消信号中止 prepare_context，且不再启动 reserve 增补", async () => {
  const controller = new AbortController();
  const execution = fakeExecutionContext({ signal: controller.signal });
  let reserveAttempts = 0;

  await assert.rejects(
    () => prepareWeeklyReportJob({
      ...inputRange,
      minSelectedCount: 2,
      primaryPapers: [{ id: "primary", published: inWeek }],
      reservePapers: [{ id: "reserve", published: inWeek }]
    }, execution.context, {
      buildContext: async (paper) => {
        if (paper.id === "primary") {
          controller.abort();
          const error = new Error("cancelled");
          error.name = "AbortError";
          throw error;
        }
        reserveAttempts += 1;
        return packetFor(paper.id);
      }
    }),
    (error) => error.name === "AbortError"
  );

  assert.equal(reserveAttempts, 0);
  assert.equal(execution.events.some((event) => event.type === "stage_cancelled"), true);
});

test("Orchestrator 通过 JobManager 持久化计数、阶段和 Trace artifacts", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "paper-insight-orchestrator-"));
  tempDirectories.push(rootDir);
  const traceStore = new WeeklyReportTraceStore({ rootDir: join(rootDir, "traces") });
  const manager = new WeeklyReportJobManager({
    jobsDir: join(rootDir, "jobs"),
    traceStore,
    execute: async (input, context) => {
      await prepareWeeklyReportJob(input, context, {
        buildContext: async (paper) => packetFor(paper.id)
      });
      return { state: "reject", reason: "test_stop_after_preparation" };
    }
  });
  await manager.initialize();
  const created = await manager.createOrReuse({
    reportKey: "2026-W31",
    ...inputRange,
    minSelectedCount: 1,
    primaryPapers: [{ id: "2607.12345", published: inWeek }],
    reservePapers: [],
    sourceSnapshot: [{ id: "2607.12345", llmApiKey: "must-redact" }]
  });
  await waitForManualReview(manager, created.jobId);
  await manager.decide(created.jobId, { action: "exit_task" });
  const completed = await manager.waitForCompletion(created.jobId);
  const trace = await traceStore.readTrace(created.traceId);

  assert.equal(completed.state, "reject");
  assert.equal(completed.agentStage, "reject");
  assert.equal(completed.counts.fullTextEligible, 1);
  assert.equal(completed.counts.excluded, 0);
  assert.equal(trace.artifacts["candidate-pool"].sourceSnapshot[0].llmApiKey, "[REDACTED]");
  assert.equal(trace.artifacts["context-packets"].eligible[0].contextPacket.paperId, "2607.12345");
  assert.equal(trace.timeline.some((event) => event.stage === "prepare_context"), true);
});

test("Orchestrator 整体拒绝原因会成为 Job 的直接结果，而不是笼统 execution_failed", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "paper-insight-orchestrator-reject-"));
  tempDirectories.push(rootDir);
  const traceStore = new WeeklyReportTraceStore({ rootDir: join(rootDir, "traces") });
  const manager = new WeeklyReportJobManager({
    jobsDir: join(rootDir, "jobs"),
    traceStore,
    execute: (input, context) => prepareWeeklyReportJob(input, context, {
      buildContext: async (paper) => packetFor(paper.id, false)
    })
  });
  await manager.initialize();
  const created = await manager.createOrReuse({
    reportKey: "2026-W31",
    ...inputRange,
    primaryPapers: [{ id: "invalid", published: inWeek }],
    reservePapers: []
  });
  const waiting = await waitForManualReview(manager, created.jobId);

  assert.equal(waiting.state, "running");
  assert.equal(waiting.agentStage, "prepare_context");
  assert.equal(waiting.manualReview.kind, "execution_failure");
  assert.deepEqual(waiting.manualReview.allowedActions, ["retry_job", "exit_task"]);

  await manager.decide(created.jobId, { action: "exit_task" });
  const completed = await manager.waitForCompletion(created.jobId);
  assert.equal(completed.state, "reject");
  assert.equal(completed.result.reason, "admin_rejected");
  assert.equal(completed.error.code, "READING_LIST_NO_ELIGIBLE_PAPERS");
  assert.equal(completed.error.stage, "prepare_context");
  assert.equal(completed.error.rejectJob, true);
});

test("extract_evidence persists each model call and normalized artifacts", async () => {
  const execution = fakeExecutionContext();
  const prepared = await prepareWeeklyReportJob({
    ...inputRange,
    minSelectedCount: 1,
    paperConcurrency: 2,
    primaryPapers: [{ id: "2607.10001", published: inWeek }],
    reservePapers: []
  }, execution.context, {
    buildContext: async (paper) => evidencePacketFor(paper.id)
  });
  const extracted = await extractWeeklyReportEvidence(prepared, execution.context, {
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      return evidenceResponseFor(payload.paper.paperId);
    },
    buildContext: async (paper) => evidencePacketFor(paper.id),
    networkRetryDelayMs: 0
  });

  assert.equal(extracted.nextStage, "review");
  assert.deepEqual(extracted.evidenceItems.map((item) => item.paper.id), ["2607.10001"]);
  assert.equal(extracted.counts.fullTextEligible, 1);
  assert.equal(extracted.counts.excluded, 0);
  assert.equal(execution.updates.at(-1).stage, "extract_evidence");
  assert.equal(execution.sections.get("evidence-artifacts").succeeded.length, 1);
  const callArtifacts = [...execution.sections.entries()]
    .filter(([name]) => name.startsWith("evidence-call-"))
    .map(([, value]) => value);
  assert.equal(callArtifacts.length, 1);
  assert.match(callArtifacts[0].prompt, /weekly_report_extract_evidence/);
  assert.equal(callArtifacts[0].validation.valid, true);
  assert.equal(execution.events.some((event) => (
    event.type === "stage_completed"
    && event.stage === "extract_evidence"
  )), true);
});

test("Evidence failure refills from reserve through context gate and Evidence", async () => {
  const execution = fakeExecutionContext();
  const contextAttempts = [];
  const input = {
    ...inputRange,
    minSelectedCount: 2,
    paperConcurrency: 2,
    primaryPapers: [
      { id: "2607.11001", published: inWeek },
      { id: "2607.11002", published: inWeek }
    ],
    reservePapers: [
      { id: "2607.11003", published: inWeek },
      { id: "2607.11004", published: inWeek }
    ]
  };
  const buildContext = async (paper) => {
    contextAttempts.push(paper.id);
    return evidencePacketFor(paper.id);
  };
  const prepared = await prepareWeeklyReportJob(input, execution.context, { buildContext });
  const extracted = await extractWeeklyReportEvidence(prepared, execution.context, {
    buildContext,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const paperId = JSON.parse(prompt).paper.paperId;
      return evidenceResponseFor(paperId, { valid: paperId !== "2607.11002" });
    }
  });

  assert.deepEqual(contextAttempts, ["2607.11001", "2607.11002", "2607.11003"]);
  assert.deepEqual(
    extracted.evidenceItems.map((item) => item.paper.id),
    ["2607.11001", "2607.11003"]
  );
  assert.deepEqual(extracted.evidenceResult.excluded.map((item) => item.paper.id), ["2607.11002"]);
  assert.equal(extracted.refill.contextEligible.length, 1);
  assert.equal(extracted.counts.fullTextEligible, 3);
  assert.equal(extracted.counts.excluded, 1);
  assert.equal(execution.events.some((event) => event.type === "refill_requested"), true);
});

test("Evidence rejects only after all primary and reserve papers fail", async () => {
  const execution = fakeExecutionContext();
  const prepared = await prepareWeeklyReportJob({
    ...inputRange,
    minSelectedCount: 1,
    primaryPapers: [{ id: "2607.12001", published: inWeek }],
    reservePapers: [{ id: "2607.12002", published: inWeek }]
  }, execution.context, {
    buildContext: async (paper) => evidencePacketFor(paper.id)
  });

  await assert.rejects(
    () => extractWeeklyReportEvidence(prepared, execution.context, {
      buildContext: async (paper) => evidencePacketFor(paper.id),
      networkRetryDelayMs: 0,
      callModel: async (prompt) => evidenceResponseFor(
        JSON.parse(prompt).paper.paperId,
        { valid: false }
      )
    }),
    (error) => (
      error instanceof Error
      && error.code === "READING_LIST_NO_EVIDENCE_PAPERS"
      && error.stage === "extract_evidence"
      && error.rejectJob === true
    )
  );

  assert.equal(execution.sections.get("evidence-artifacts").succeeded.length, 0);
  assert.equal(execution.sections.get("evidence-artifacts").excluded.length, 2);
  assert.equal(execution.events.some((event) => (
    event.type === "reject_requested"
    && event.stage === "extract_evidence"
  )), true);
});

test("Evidence below target continues when at least one paper succeeds", async () => {
  const execution = fakeExecutionContext();
  const prepared = await prepareWeeklyReportJob({
    ...inputRange,
    minSelectedCount: 2,
    primaryPapers: [
      { id: "2607.12003", published: inWeek },
      { id: "2607.12004", published: inWeek }
    ],
    reservePapers: []
  }, execution.context, {
    buildContext: async (paper) => evidencePacketFor(paper.id)
  });
  const partial = await extractWeeklyReportEvidence(prepared, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const paperId = JSON.parse(prompt).paper.paperId;
      return evidenceResponseFor(paperId, { valid: paperId === "2607.12003" });
    }
  });

  assert.equal(partial.evidenceItems.length, 1);
  assert.equal(partial.warnings.some((warning) => (
    warning.code === "READING_LIST_EVIDENCE_BELOW_TARGET"
  )), true);
});

test("Evidence model transport failures preserve other papers and record processing failure", async () => {
  const execution = fakeExecutionContext();
  const prepared = await prepareWeeklyReportJob({
    ...inputRange,
    minSelectedCount: 2,
    paperConcurrency: 1,
    primaryPapers: [
      { id: "2607.12005", published: inWeek },
      { id: "2607.12006", published: inWeek }
    ],
    reservePapers: []
  }, execution.context, {
    buildContext: async (paper) => evidencePacketFor(paper.id)
  });

  const partial = await extractWeeklyReportEvidence(prepared, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const paperId = JSON.parse(prompt).paper.paperId;
      if (paperId === "2607.12005") {
        const error = new Error("model transport failed");
        error.code = "READING_LIST_AGENT_CALL_FAILED";
        error.modelCallFailed = true;
        error.retryable = true;
        throw error;
      }
      return evidenceResponseFor(paperId);
    }
  });

  assert.equal(partial.nextStage, "review");
  assert.deepEqual(partial.evidenceItems.map((item) => item.paper.id), ["2607.12006"]);
  assert.equal(partial.evidenceResult.excluded.length, 0);
  assert.equal(partial.evidenceResult.processingFailed.length, 1);
  assert.equal(partial.evidenceResult.processingFailed[0].paper.id, "2607.12005");
  assert.equal(partial.counts.excluded, 0);
  assert.equal(partial.warnings.some((warning) => (
    warning.code === "READING_LIST_EVIDENCE_PROCESSING_FAILED"
    && warning.paperId === "2607.12005"
  )), true);
  assert.equal(execution.events.some((event) => (
    event.type === "evidence_processing_failed" && event.paperId === "2607.12005"
  )), true);
});

test("review stage persists model calls, server scores, and normalized artifacts", async () => {
  const execution = fakeExecutionContext();
  const prepared = await prepareWeeklyReportJob({
    ...inputRange,
    minSelectedCount: 1,
    primaryPapers: [{ id: "2607.13001", published: inWeek }],
    reservePapers: []
  }, execution.context, {
    buildContext: async (paper) => evidencePacketFor(paper.id)
  });
  const evidenced = await extractWeeklyReportEvidence(prepared, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async (prompt) => evidenceResponseFor(JSON.parse(prompt).paper.paperId)
  });
  const reviewed = await reviewWeeklyReportPapers(evidenced, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async (prompt) => reviewResponseFor(JSON.parse(prompt).paper.paperId)
  });

  assert.equal(reviewed.nextStage, "calibrate");
  assert.equal(reviewed.reviewItems.length, 1);
  assert.equal(reviewed.reviewItems[0].reviewResult.rawScore, 64);
  assert.equal(reviewed.counts.reviewed, 1);
  assert.equal(execution.updates.at(-1).stage, "review");
  assert.equal(execution.sections.get("review-artifacts").succeeded.length, 1);
  const reviewCalls = [...execution.sections.entries()]
    .filter(([name]) => name.startsWith("review-call-"))
    .map(([, value]) => value);
  assert.equal(reviewCalls.length, 1);
  assert.equal(reviewCalls[0].validation.valid, true);
});

test("Review failure refills through context, Evidence, and Review in order", async () => {
  const execution = fakeExecutionContext();
  const contextAttempts = [];
  const buildContext = async (paper) => {
    contextAttempts.push(paper.id);
    return evidencePacketFor(paper.id);
  };
  const input = {
    ...inputRange,
    minSelectedCount: 2,
    paperConcurrency: 2,
    primaryPapers: [
      { id: "2607.14001", published: inWeek },
      { id: "2607.14002", published: inWeek }
    ],
    reservePapers: [
      { id: "2607.14003", published: inWeek },
      { id: "2607.14004", published: inWeek }
    ]
  };
  const modelTasks = [];
  const callModel = async (prompt) => {
    const payload = JSON.parse(prompt);
    const id = payload.paper.paperId;
    modelTasks.push({ task: payload.task, paperId: id });
    if (payload.task.startsWith("weekly_report_extract_evidence")) {
      return evidenceResponseFor(id);
    }
    return reviewResponseFor(id, { valid: id !== "2607.14002" });
  };
  const prepared = await prepareWeeklyReportJob(input, execution.context, { buildContext });
  const evidenced = await extractWeeklyReportEvidence(prepared, execution.context, {
    buildContext,
    callModel,
    networkRetryDelayMs: 0
  });
  const reviewed = await reviewWeeklyReportPapers(evidenced, execution.context, {
    buildContext,
    callModel,
    networkRetryDelayMs: 0
  });

  assert.deepEqual(contextAttempts, ["2607.14001", "2607.14002", "2607.14003"]);
  assert.deepEqual(reviewed.reviewItems.map((item) => item.paper.id), ["2607.14001", "2607.14003"]);
  assert.deepEqual(reviewed.reviewResult.excluded.map((item) => item.paper.id), ["2607.14002"]);
  assert.equal(reviewed.counts.fullTextEligible, 3);
  assert.equal(reviewed.counts.reviewed, 2);
  assert.equal(reviewed.counts.excluded, 1);
  assert.equal(modelTasks.some((entry) => (
    entry.paperId === "2607.14003"
    && entry.task === "weekly_report_extract_evidence"
  )), true);
  assert.equal(modelTasks.some((entry) => (
    entry.paperId === "2607.14003"
    && entry.task === "weekly_report_review"
  )), true);
  assert.equal(execution.events.some((event) => (
    event.type === "refill_requested"
    && event.stage === "review"
  )), true);
});

test("Review exhausts reserve before rejecting a zero-paper result", async () => {
  const execution = fakeExecutionContext();
  const buildContext = async (paper) => evidencePacketFor(paper.id);
  const callModel = async (prompt) => {
    const payload = JSON.parse(prompt);
    const id = payload.paper.paperId;
    if (payload.task.startsWith("weekly_report_extract_evidence")) {
      return evidenceResponseFor(id);
    }
    return reviewResponseFor(id, { valid: false });
  };
  const prepared = await prepareWeeklyReportJob({
    ...inputRange,
    minSelectedCount: 1,
    primaryPapers: [{ id: "2607.15001", published: inWeek }],
    reservePapers: [{ id: "2607.15002", published: inWeek }]
  }, execution.context, { buildContext });
  const evidenced = await extractWeeklyReportEvidence(prepared, execution.context, {
    buildContext,
    callModel,
    networkRetryDelayMs: 0
  });

  await assert.rejects(
    () => reviewWeeklyReportPapers(evidenced, execution.context, {
      buildContext,
      callModel,
      networkRetryDelayMs: 0
    }),
    (error) => (
      error.code === "READING_LIST_NO_REVIEWED_PAPERS"
      && error.stage === "review"
      && error.rejectJob === true
    )
  );

  assert.equal(execution.sections.get("review-artifacts").succeeded.length, 0);
  assert.equal(execution.sections.get("review-artifacts").excluded.length, 2);
  assert.equal(execution.events.some((event) => (
    event.type === "reject_requested"
    && event.stage === "review"
  )), true);
});

test("Review Evidence challenge remains an administrator warning after successful repair", async () => {
  const execution = fakeExecutionContext();
  const buildContext = async (paper) => evidencePacketFor(paper.id);
  const prepared = await prepareWeeklyReportJob({
    ...inputRange,
    minSelectedCount: 1,
    primaryPapers: [{ id: "2607.16001", published: inWeek }],
    reservePapers: []
  }, execution.context, { buildContext });
  const evidenced = await extractWeeklyReportEvidence(prepared, execution.context, {
    buildContext,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => evidenceResponseFor(JSON.parse(prompt).paper.paperId)
  });
  let reviewCalls = 0;
  const reviewed = await reviewWeeklyReportPapers(evidenced, execution.context, {
    buildContext,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      const id = payload.paper.paperId;
      if (payload.task === "weekly_report_extract_evidence_repair") {
        return evidenceResponseFor(id);
      }
      reviewCalls += 1;
      return reviewCalls === 1
        ? reviewResponseFor(id, { evidenceStatus: "repair_required" })
        : reviewResponseFor(id);
    }
  });

  assert.equal(reviewed.reviewItems[0].evidenceRepairAttempted, true);
  assert.equal(reviewed.warnings.some((warning) => (
    warning.code === "READING_LIST_EVIDENCE_CHALLENGED_BY_REVIEW"
    && warning.paperId === "2607.16001"
  )), true);
  assert.equal(execution.sections.get("review-artifacts").warnings.some((warning) => (
    warning.code === "READING_LIST_EVIDENCE_CHALLENGED_BY_REVIEW"
  )), true);
});

test("calibrate stage persists compact cross-paper calls and calibrated artifacts", async () => {
  const execution = fakeExecutionContext();
  const buildContext = async (paper) => evidencePacketFor(paper.id);
  const input = {
    ...inputRange,
    minSelectedCount: 2,
    primaryPapers: [
      { id: "2607.17001", published: inWeek },
      { id: "2607.17002", published: inWeek }
    ],
    reservePapers: []
  };
  const prepared = await prepareWeeklyReportJob(input, execution.context, { buildContext });
  const evidenced = await extractWeeklyReportEvidence(prepared, execution.context, {
    buildContext,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => evidenceResponseFor(JSON.parse(prompt).paper.paperId)
  });
  const reviewed = await reviewWeeklyReportPapers(evidenced, execution.context, {
    buildContext,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => reviewResponseFor(JSON.parse(prompt).paper.paperId)
  });
  const calibrated = await calibrateWeeklyReportPapers(reviewed, execution.context, {
    buildContext,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      return calibrationResponseFor(payload.papers.map((paper) => paper.paperId));
    }
  });

  assert.equal(calibrated.nextStage, "select");
  assert.deepEqual(calibrated.calibratedItems.map((item) => item.paper.id), ["2607.17001", "2607.17002"]);
  assert.equal(calibrated.counts.calibrated, 2);
  assert.equal(execution.updates.at(-1).stage, "calibrate");
  assert.equal(execution.sections.get("calibration-artifacts").succeeded.length, 2);
  const calibrationCalls = [...execution.sections.entries()]
    .filter(([name]) => name.startsWith("calibration-call-"))
    .map(([, value]) => value);
  assert.equal(calibrationCalls.length, 1);
  assert.doesNotMatch(calibrationCalls[0].prompt, /LONG_ORIGINAL_TEXT|BOUND_EXCERPT/);
});

test("calibrate stage refills reserves until the threshold-qualified target is met", async () => {
  const execution = fakeExecutionContext();
  const contextAttempts = [];
  const buildContext = async (paper) => {
    contextAttempts.push(paper.id);
    return evidencePacketFor(paper.id);
  };
  const primaryIds = new Set(["2607.17021", "2607.17022"]);
  const input = {
    ...inputRange,
    reviewScoreThreshold: 70,
    minSelectedCount: 2,
    paperConcurrency: 2,
    primaryPapers: [
      { id: "2607.17021", published: inWeek },
      { id: "2607.17022", published: inWeek }
    ],
    reservePapers: [
      { id: "2607.17023", published: inWeek },
      { id: "2607.17024", published: inWeek }
    ]
  };
  const callModel = async (prompt) => {
    const payload = JSON.parse(prompt);
    if (payload.task.startsWith("weekly_report_extract_evidence")) {
      return evidenceResponseFor(payload.paper.paperId);
    }
    if (payload.task.startsWith("weekly_report_review")) {
      const response = reviewResponseFor(payload.paper.paperId);
      const score = primaryIds.has(payload.paper.paperId) ? 60 : 80;
      response.scores = {
        scenarioProblemValue: score,
        methodNovelty: score,
        practicalValue: score,
        evidence: score
      };
      return response;
    }
    return calibrationResponseFor(payload.papers.map((paper) => paper.paperId));
  };

  const prepared = await prepareWeeklyReportJob(input, execution.context, { buildContext });
  const evidenced = await extractWeeklyReportEvidence(prepared, execution.context, {
    buildContext,
    callModel,
    networkRetryDelayMs: 0
  });
  const reviewed = await reviewWeeklyReportPapers(evidenced, execution.context, {
    buildContext,
    callModel,
    networkRetryDelayMs: 0
  });
  const calibrated = await calibrateWeeklyReportPapers(reviewed, execution.context, {
    buildContext,
    callModel,
    networkRetryDelayMs: 0
  });

  assert.deepEqual(contextAttempts, ["2607.17021", "2607.17022", "2607.17023", "2607.17024"]);
  assert.equal(calibrated.calibrationResult.thresholdQualifiedCount, 2);
  assert.equal(calibrated.calibrationResult.reserveAttempted, 2);
  assert.equal(execution.events.some((event) => (
    event.type === "refill_requested"
    && event.stage === "calibrate"
    && event.reason === "threshold_qualified_below_target"
  )), true);
});

test("calibrate excludes a paper skipped by the administrator before rebuilding the cohort", async () => {
  const execution = fakeExecutionContext();
  const buildContext = async (paper) => evidencePacketFor(paper.id);
  const prepared = await prepareWeeklyReportJob({
    ...inputRange,
    minSelectedCount: 1,
    primaryPapers: [
      { id: "2607.17011", published: inWeek },
      { id: "2607.17012", published: inWeek }
    ],
    reservePapers: []
  }, execution.context, { buildContext });
  const evidenced = await extractWeeklyReportEvidence(prepared, execution.context, {
    buildContext,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => evidenceResponseFor(JSON.parse(prompt).paper.paperId)
  });
  const reviewed = await reviewWeeklyReportPapers(evidenced, execution.context, {
    buildContext,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => reviewResponseFor(JSON.parse(prompt).paper.paperId)
  });
  const calibrated = await calibrateWeeklyReportPapers({
    ...reviewed,
    manualExcludedPaperIds: ["2607.17011"]
  }, execution.context, {
    buildContext,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      return calibrationResponseFor(payload.papers.map((paper) => paper.paperId));
    }
  });

  assert.deepEqual(calibrated.calibratedItems.map((item) => item.paper.id), ["2607.17012"]);
  assert.deepEqual(calibrated.manualExcludedPaperIds, ["2607.17011"]);
  assert.equal(calibrated.warnings.some((warning) => (
    warning.code === "READING_LIST_ADMIN_SKIPPED_PAPER" && warning.paperId === "2607.17011"
  )), true);
});

test("Calibration unresolved paper is replaced through the full pipeline and the cohort is recalibrated", async () => {
  const execution = fakeExecutionContext();
  const contextAttempts = [];
  const buildContext = async (paper) => {
    contextAttempts.push(paper.id);
    return evidencePacketFor(paper.id);
  };
  const input = {
    ...inputRange,
    minSelectedCount: 2,
    paperConcurrency: 2,
    primaryPapers: [
      { id: "2607.18001", published: inWeek },
      { id: "2607.18002", published: inWeek }
    ],
    reservePapers: [{ id: "2607.18003", published: inWeek }]
  };
  const baseCallModel = async (prompt) => {
    const payload = JSON.parse(prompt);
    if (payload.task.startsWith("weekly_report_extract_evidence")) {
      return evidenceResponseFor(payload.paper.paperId);
    }
    return reviewResponseFor(payload.paper.paperId);
  };
  const prepared = await prepareWeeklyReportJob(input, execution.context, { buildContext });
  const evidenced = await extractWeeklyReportEvidence(prepared, execution.context, {
    buildContext,
    callModel: baseCallModel,
    networkRetryDelayMs: 0
  });
  const reviewed = await reviewWeeklyReportPapers(evidenced, execution.context, {
    buildContext,
    callModel: baseCallModel,
    networkRetryDelayMs: 0
  });
  let calibrationRound = 0;
  const callModel = async (prompt) => {
    const payload = JSON.parse(prompt);
    if (payload.task.startsWith("weekly_report_extract_evidence")) {
      return evidenceResponseFor(payload.paper.paperId);
    }
    if (payload.task.startsWith("weekly_report_review")) {
      return reviewResponseFor(payload.paper.paperId);
    }
    if (payload.task === "weekly_report_targeted_rereview") {
      return {
        paperId: "2607.18002",
        dimensions: {
          methodNovelty: {
            score: 65,
            reason: "The mechanism combines established components."
          }
        }
      };
    }
    const ids = payload.papers.map((paper) => paper.paperId);
    if (payload.task === "weekly_report_calibration_confirm") {
      return calibrationResponseFor(ids, {
        "2607.18002": {
          status: "unresolved",
          suspectedMisjudgments: [{
            dimension: "methodNovelty",
            direction: "overrated",
            reason: "The revised method score remains inconsistent.",
            comparisonPaperIds: ["2607.18001"]
          }]
        }
      });
    }
    calibrationRound += 1;
    if (calibrationRound === 1) {
      return calibrationResponseFor(ids, {
        "2607.18002": {
          status: "rereview_required",
          suspectedMisjudgments: [{
            dimension: "methodNovelty",
            direction: "overrated",
            reason: "The method score is high relative to the cohort.",
            comparisonPaperIds: ["2607.18001"]
          }]
        }
      });
    }
    return calibrationResponseFor(ids);
  };
  const calibrated = await calibrateWeeklyReportPapers(reviewed, execution.context, {
    buildContext,
    callModel,
    networkRetryDelayMs: 0
  });

  assert.deepEqual(contextAttempts, ["2607.18001", "2607.18002", "2607.18003"]);
  assert.deepEqual(calibrated.calibratedItems.map((item) => item.paper.id), ["2607.18001", "2607.18003"]);
  assert.equal(calibrated.calibrationResult.excluded.some((item) => (
    item.paper.id === "2607.18002"
    && item.error.code === "READING_LIST_CALIBRATION_UNRESOLVED"
  )), true);
  assert.equal(calibrated.counts.fullTextEligible, 3);
  assert.equal(calibrated.counts.calibrated, 2);
  assert.equal(calibrated.counts.excluded, 1);
  assert.equal(calibrationRound, 2);
  assert.equal(calibrated.warnings.some((warning) => (
    warning.code === "READING_LIST_CALIBRATION_UNRESOLVED"
  )), true);
});

test("Calibration deterministically defers papers beyond the 30-paper ceiling", async () => {
  const execution = fakeExecutionContext();
  const reviewItems = Array.from({ length: 31 }, (_, index) => {
    const id = `2607.${String(40000 + index).padStart(5, "0")}`;
    const artifacts = evidenceResponseFor(id);
    const reviewResult = reviewResponseFor(id);
    reviewResult.rawScore = index;
    return {
      paper: { id },
      contextPacket: evidencePacketFor(id),
      ...artifacts,
      reviewResult
    };
  });
  const reviewed = {
    nextStage: "calibrate",
    options: { paperConcurrency: 2, calibrationMaxPapers: 30 },
    candidatePool: { reserveCandidates: [] },
    evidenceResult: { reserveAttempted: 0 },
    reviewResult: { reserveAttempted: 0, targetReviewedCount: 3 },
    reviewItems,
    counts: {
      primary: 31,
      reserve: 0,
      fullTextEligible: 31,
      reviewed: 31,
      calibrated: 0,
      selected: 0,
      excluded: 0
    },
    warnings: []
  };
  let calibratedIds = [];
  const calibrated = await calibrateWeeklyReportPapers(reviewed, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      calibratedIds = payload.papers.map((paper) => paper.paperId);
      return calibrationResponseFor(calibratedIds);
    }
  });

  assert.equal(calibratedIds.length, 30);
  assert.equal(calibratedIds.includes("2607.40000"), false);
  assert.equal(calibrated.deferred.length, 1);
  assert.equal(calibrated.deferred[0].paper.id, "2607.40000");
  assert.equal(calibrated.deferred[0].deferredReason, "deferred_by_calibration_limit");
  assert.equal(calibrated.counts.calibrated, 30);
});

test("Calibration replaces the lowest paper when a full cohort is below target and a reserve scores higher", async () => {
  const execution = fakeExecutionContext();
  const reviewItems = Array.from({ length: 30 }, (_, index) => {
    const id = `2607.${String(41000 + index).padStart(5, "0")}`;
    const artifacts = evidenceResponseFor(id);
    const reviewResult = reviewResponseFor(id);
    reviewResult.rawScore = 60;
    return {
      paper: { id },
      contextPacket: evidencePacketFor(id),
      ...artifacts,
      reviewResult
    };
  });
  const reserveId = "2607.41999";
  const reviewed = {
    nextStage: "calibrate",
    reviewScoreThreshold: 70,
    options: {
      paperConcurrency: 1,
      calibrationMaxPapers: 30,
      minSelectedCount: 1
    },
    candidatePool: { reserveCandidates: [{ id: reserveId, published: inWeek }] },
    evidenceResult: { reserveAttempted: 0 },
    reviewResult: { reserveAttempted: 0, targetReviewedCount: 1 },
    reviewItems,
    counts: {
      primary: 30,
      reserve: 1,
      fullTextEligible: 30,
      reviewed: 30,
      calibrated: 0,
      selected: 0,
      excluded: 0
    },
    warnings: []
  };
  const calibrated = await calibrateWeeklyReportPapers(reviewed, execution.context, {
    buildContext: async (paper) => evidencePacketFor(paper.id),
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      if (payload.task.startsWith("weekly_report_extract_evidence")) {
        return evidenceResponseFor(payload.paper.paperId);
      }
      if (payload.task.startsWith("weekly_report_review")) {
        const response = reviewResponseFor(payload.paper.paperId);
        response.scores = {
          scenarioProblemValue: 85,
          methodNovelty: 85,
          practicalValue: 85,
          evidence: 85
        };
        return response;
      }
      return calibrationResponseFor(payload.papers.map((paper) => paper.paperId));
    }
  });

  assert.equal(calibrated.calibrationResult.reserveAttempted, 1);
  assert.equal(calibrated.calibrationResult.thresholdQualifiedCount, 1);
  assert.equal(calibrated.calibratedItems.some((item) => item.paper.id === reserveId), true);
  assert.equal(calibrated.calibratedItems.length, 30);
  assert.equal(calibrated.deferred.length, 1);
  assert.equal(calibrated.deferred[0].deferredReason, "deferred_by_calibration_limit");
  assert.equal(execution.events.some((event) => event.type === "calibration_pool_rebalanced"), true);
});

test("select stage publishes only threshold-qualified papers and persists Trace", async () => {
  const execution = fakeExecutionContext();
  const calibratedItems = [
    calibratedItemFor("2607.19001", 82, "must_read", { oldScore: 1 }),
    calibratedItemFor("2607.19002", 69, "must_read", { oldScore: 100 }),
    calibratedItemFor("2607.19003", 68, "background_only", { oldScore: 100 }),
    calibratedItemFor("2607.19004", 67, "worth_reading", { oldScore: 100 })
  ];
  const calibrated = {
    nextStage: "select",
    reviewScoreThreshold: 70,
    options: {
      paperConcurrency: 2,
      calibrationMaxPapers: 30,
      minSelectedCount: 3,
      maxSelectedCount: 3
    },
    calibratedItems,
    counts: {
      primary: 4,
      reserve: 0,
      fullTextEligible: 4,
      reviewed: 4,
      calibrated: 4,
      selected: 0,
      excluded: 0
    },
    warnings: []
  };
  const selected = await selectWeeklyReportPapers(calibrated, execution.context);

  assert.equal(selected.nextStage, "editorial_plan");
  assert.deepEqual(selected.selectedItems.map((item) => item.paper.id), ["2607.19001"]);
  assert.deepEqual(selected.selectedItems.map((item) => item.selection.readingTier), ["must_read"]);
  assert.equal(selected.selectionResult.thresholdSelectedCount, 1);
  assert.equal(selected.selectionResult.fallbackCount, 0);
  assert.equal(selected.counts.selected, 1);
  assert.equal(execution.updates.at(-1).stage, "select");
  assert.equal(execution.sections.get("selection-artifacts").selected.length, 1);
  assert.equal(execution.events.some((event) => (
    event.type === "stage_completed"
    && event.stage === "select"
  )), true);
});

test("prepare normalizes and carries reviewScoreThreshold to deterministic Selection", async () => {
  const execution = fakeExecutionContext();
  const prepared = await prepareWeeklyReportJob({
    ...inputRange,
    date: "2026-07-29",
    month: "2026-07",
    weekOfMonth: 5,
    reviewScoreThreshold: 200,
    primaryPapers: [{ id: "2607.19101", published: inWeek }],
    reservePapers: []
  }, execution.context, {
    buildContext: async (paper) => evidencePacketFor(paper.id)
  });

  assert.equal(prepared.reviewScoreThreshold, 95);
  assert.deepEqual(prepared.reportMeta, {
    date: "2026-07-29",
    month: "2026-07",
    weekOfMonth: 5,
    weekStart: inputRange.weekStart,
    weekEnd: inputRange.weekEnd,
    reportKey: ""
  });
  assert.equal(execution.sections.get("candidate-pool").reviewScoreThreshold, 95);
  assert.deepEqual(execution.sections.get("candidate-pool").reportMeta, prepared.reportMeta);
});

test("select stage rejects instead of publishing an uncalibrated paper", async () => {
  const execution = fakeExecutionContext();
  const invalidItem = calibratedItemFor("2607.19201", 99, "must_read", {
    calibrationStatus: "unresolved"
  });
  const calibrated = {
    nextStage: "select",
    reviewScoreThreshold: 70,
    options: {
      minSelectedCount: 1,
      maxSelectedCount: 10
    },
    calibratedItems: [invalidItem],
    counts: {
      primary: 1,
      reserve: 0,
      fullTextEligible: 1,
      reviewed: 1,
      calibrated: 1,
      selected: 0,
      excluded: 0
    },
    warnings: []
  };

  await assert.rejects(
    () => selectWeeklyReportPapers(calibrated, execution.context),
    (error) => (
      error.code === "READING_LIST_NO_SELECTED_PAPERS"
      && error.stage === "select"
      && error.rejectJob === true
    )
  );
  assert.equal(execution.sections.get("selection-artifacts").ineligible.length, 1);
  assert.equal(execution.events.some((event) => (
    event.type === "reject_requested"
    && event.stage === "select"
  )), true);
});

test("editorial_plan validates the selected cohort and persists the complete model-call Trace", async () => {
  const execution = fakeExecutionContext();
  const calibratedItems = [
    calibratedItemFor("2607.19301", 88, "must_read"),
    calibratedItemFor("2607.19302", 78, "worth_reading"),
    calibratedItemFor("2607.19303", 71, "background_only")
  ];
  const selected = await selectWeeklyReportPapers({
    nextStage: "select",
    reviewScoreThreshold: 70,
    options: { minSelectedCount: 3, maxSelectedCount: 3 },
    calibratedItems,
    counts: {
      primary: 3,
      reserve: 0,
      fullTextEligible: 3,
      reviewed: 3,
      calibrated: 3,
      selected: 0,
      excluded: 0
    },
    warnings: []
  }, execution.context);
  const planned = await planWeeklyReportEditorial(selected, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async () => editorialPlanFor(selected.selectedItems)
  });

  assert.equal(planned.nextStage, "write_paper_sections");
  assert.equal(planned.editorialPlan.trends.length, 1);
  assert.deepEqual(planned.editorialPlan.readingOrder.map((entry) => entry.paperId), [
    "2607.19301",
    "2607.19302",
    "2607.19303"
  ]);
  assert.deepEqual(execution.sections.get("editorial-plan"), planned.editorialPlan);
  const calls = [...execution.sections.entries()]
    .filter(([name]) => name.startsWith("editorial-call-"))
    .map(([, value]) => value);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].validation.valid, true);
  assert.equal(execution.events.some((event) => (
    event.type === "stage_completed"
    && event.stage === "editorial_plan"
  )), true);
});

test("editorial_plan waits after three repairs and an administrator can grant one more repair", async () => {
  const manualReviews = [];
  const execution = fakeExecutionContext({
    requestManualReview: async (review) => {
      manualReviews.push(review);
      return { action: "continue_repair" };
    }
  });
  const calibratedItems = [
    calibratedItemFor("2607.19401", 88, "must_read"),
    calibratedItemFor("2607.19402", 78, "worth_reading")
  ];
  const selected = await selectWeeklyReportPapers({
    nextStage: "select",
    reviewScoreThreshold: 70,
    options: { minSelectedCount: 2, maxSelectedCount: 2 },
    calibratedItems,
    counts: {
      primary: 2,
      reserve: 0,
      fullTextEligible: 2,
      reviewed: 2,
      calibrated: 2,
      selected: 0,
      excluded: 0
    },
    warnings: []
  }, execution.context);
  const invalidPlan = editorialPlanFor(selected.selectedItems);
  invalidPlan.readingOrder = [];

  let callsMade = 0;
  const planned = await planWeeklyReportEditorial(selected, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      callsMade += 1;
      const payload = JSON.parse(prompt);
      if (payload.task === "weekly_report_editorial_plan") {
        return invalidPlan;
      }
      return {
        patches: [{
          path: "readingOrder",
          value: callsMade <= 4 ? [] : editorialPlanFor(selected.selectedItems).readingOrder
        }]
      };
    }
  });
  const calls = [...execution.sections.keys()]
    .filter((name) => name.startsWith("editorial-call-"));
  assert.equal(planned.nextStage, "write_paper_sections");
  assert.equal(calls.length, 5);
  assert.equal(manualReviews.length, 1);
  assert.equal(manualReviews[0].repairAttempts, 3);
  assert.deepEqual(manualReviews[0].allowedActions, ["continue_repair", "exit_task"]);
  assert.deepEqual(execution.events
    .filter((event) => event.type === "editorial_plan_repair_requested")
    .map((event) => event.repairAttempt), [1, 2, 3, 4]);
});

test("editorial_plan resumes calibration when an administrator skips the blocking paper", async () => {
  const manualReviews = [];
  const execution = fakeExecutionContext({
    requestManualReview: async (review) => {
      manualReviews.push(review);
      return { action: "skip_paper", paperId: "2607.19411" };
    }
  });
  const calibratedItems = [
    calibratedItemFor("2607.19411", 88, "must_read"),
    calibratedItemFor("2607.19412", 78, "worth_reading")
  ];
  const selected = await selectWeeklyReportPapers({
    nextStage: "select",
    reviewScoreThreshold: 70,
    options: { minSelectedCount: 2, maxSelectedCount: 2 },
    calibratedItems,
    counts: {
      primary: 2,
      reserve: 0,
      fullTextEligible: 2,
      reviewed: 2,
      calibrated: 2,
      selected: 0,
      excluded: 0
    },
    warnings: []
  }, execution.context);
  const invalidPlan = editorialPlanFor(selected.selectedItems);
  invalidPlan.readingOrder = [];

  const result = await planWeeklyReportEditorial(selected, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      return payload.task === "weekly_report_editorial_plan"
        ? invalidPlan
        : { patches: [{ path: "readingOrder", value: [] }] };
    }
  });

  assert.equal(result.nextStage, "calibrate");
  assert.deepEqual(result.manualExcludedPaperIds, ["2607.19411"]);
  assert.equal(result.counts.selected, 0);
  assert.equal(manualReviews.length, 1);
  assert.equal(execution.events.some((event) => event.type === "reject_requested"), false);
});

test("write_paper_sections generates one isolated paperDraft per selected paper and persists every call", async () => {
  const execution = fakeExecutionContext();
  const calibratedItems = [
    calibratedItemFor("2607.19501", 88, "must_read"),
    calibratedItemFor("2607.19502", 78, "worth_reading"),
    calibratedItemFor("2607.19503", 71, "background_only")
  ];
  const selected = await selectWeeklyReportPapers({
    nextStage: "select",
    reviewScoreThreshold: 70,
    options: { paperConcurrency: 2, minSelectedCount: 3, maxSelectedCount: 3 },
    calibratedItems,
    counts: {
      primary: 3,
      reserve: 0,
      fullTextEligible: 3,
      reviewed: 3,
      calibrated: 3,
      selected: 0,
      excluded: 0
    },
    warnings: []
  }, execution.context);
  const planned = await planWeeklyReportEditorial(selected, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async () => editorialPlanFor(selected.selectedItems)
  });
  const written = await writeWeeklyReportPaperSections(planned, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async (prompt) => paperDraftFor(JSON.parse(prompt).paper.paperId)
  });

  assert.equal(written.nextStage, "write_head_tail");
  assert.deepEqual(written.paperDrafts.map((draft) => draft.paperId), [
    "2607.19501",
    "2607.19502",
    "2607.19503"
  ]);
  assert.equal(written.paperDrafts[0].publicationMeta.finalScore, 88);
  assert.equal(written.paperDrafts[2].publicationMeta.readingTier, "background_only");
  assert.equal(execution.sections.get("paper-drafts").succeeded.length, 3);
  const calls = [...execution.sections.keys()]
    .filter((name) => name.startsWith("paper-writer-call-"));
  assert.equal(calls.length, 3);
  assert.equal(execution.events.some((event) => (
    event.type === "stage_completed"
    && event.stage === "write_paper_sections"
  )), true);
});

test("write_paper_sections preserves valid drafts while requesting an administrator decision", async () => {
  const execution = fakeExecutionContext();
  const selectedItems = [
    calibratedItemFor("2607.19601", 88, "must_read"),
    calibratedItemFor("2607.19602", 78, "worth_reading")
  ].map((entry, index) => ({
    ...entry,
    selection: {
      selected: true,
      finalScore: entry.reviewResult.rawScore,
      readingTier: entry.calibrationResult.readingTier,
      rank: index + 1
    }
  }));
  const planned = {
    nextStage: "write_paper_sections",
    options: { paperConcurrency: 2 },
    selectedItems,
    editorialPlan: editorialPlanFor(selectedItems),
    counts: {
      primary: 2,
      reserve: 0,
      fullTextEligible: 2,
      reviewed: 2,
      calibrated: 2,
      selected: 2,
      excluded: 0
    },
    warnings: []
  };

  const written = await writeWeeklyReportPaperSections(planned, execution.context, {
      networkRetryDelayMs: 0,
      callModel: async (prompt) => {
        const paperId = JSON.parse(prompt).paper.paperId;
        const draft = paperDraftFor(paperId);
        if (paperId === "2607.19602") {
          draft.limitationsAndConstraints = [];
        }
        return draft;
      }
    });
  assert.equal(written.nextStage, "manual_review");
  assert.equal(written.manualReview.paperId, "2607.19602");
  assert.deepEqual(written.manualReview.allowedActions, ["exit_task", "skip_paper"]);
  assert.equal(execution.sections.get("paper-drafts").succeeded.length, 1);
  assert.equal(execution.sections.get("paper-drafts").failed.length, 1);
  assert.equal(execution.events.some((event) => event.type === "reject_requested"), false);
});

test("write_head_tail completes the existing Editorial Agent and persists its model call and normalized artifact", async () => {
  const execution = fakeExecutionContext();
  const calibratedItems = [
    calibratedItemFor("2607.19701", 88, "must_read"),
    calibratedItemFor("2607.19702", 78, "worth_reading"),
    calibratedItemFor("2607.19703", 71, "background_only")
  ];
  calibratedItems.forEach((entry, index) => {
    entry.paper.title = `Trusted assembled paper ${index + 1}`;
  });
  const selected = await selectWeeklyReportPapers({
    nextStage: "select",
    reportMeta: { date: "2026-08-03", month: "2026-08", weekOfMonth: 1 },
    reviewScoreThreshold: 70,
    options: { paperConcurrency: 2, minSelectedCount: 3, maxSelectedCount: 3 },
    calibratedItems,
    counts: {
      primary: 3,
      reserve: 0,
      fullTextEligible: 3,
      reviewed: 3,
      calibrated: 3,
      selected: 0,
      excluded: 0
    },
    warnings: []
  }, execution.context);
  const planned = await planWeeklyReportEditorial(selected, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async () => editorialPlanFor(selected.selectedItems)
  });
  const written = await writeWeeklyReportPaperSections(planned, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async (prompt) => paperDraftFor(JSON.parse(prompt).paper.paperId)
  });
  const completed = await writeWeeklyReportHeadTail(written, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async () => headTailFor(written.editorialPlan, written.selectedItems)
  });
  const assembled = await assembleWeeklyReport(completed, execution.context);
  const deterministicQa = await runWeeklyReportDeterministicQa(assembled, execution.context);

  assert.equal(completed.nextStage, "assemble");
  assert.equal(assembled.nextStage, "deterministic_qa");
  assert.equal(deterministicQa.nextStage, "paper_semantic_qa");
  assert.equal(deterministicQa.qaReport.status, "passed");
  assert.match(assembled.markdown, /## 完整论文清单/);
  assert.match(assembled.markdown, /## 背景参考/);
  assert.equal(completed.headTailDraft.trendJudgments.length, 1);
  assert.deepEqual(completed.headTailDraft.readingOrder.map((entry) => entry.paperId), [
    "2607.19701",
    "2607.19702",
    "2607.19703"
  ]);
  assert.deepEqual(execution.sections.get("head-tail-draft"), completed.headTailDraft);
  const calls = [...execution.sections.keys()]
    .filter((name) => name.startsWith("head-tail-call-"));
  assert.equal(calls.length, 1);
  assert.equal(execution.events.some((event) => (
    event.type === "stage_completed"
    && event.stage === "write_head_tail"
  )), true);
  assert.equal(execution.sections.get("assembled-report").markdown, assembled.markdown);
  assert.equal(execution.events.some((event) => (
    event.type === "stage_completed"
    && event.stage === "assemble"
  )), true);
  assert.equal(execution.sections.get("deterministic-qa").status, "passed");
});

test("write_head_tail rejects the report after its single repair remains invalid", async () => {
  const execution = fakeExecutionContext();
  const selectedItems = [
    calibratedItemFor("2607.19801", 88, "must_read"),
    calibratedItemFor("2607.19802", 78, "worth_reading")
  ].map((entry, index) => ({
    ...entry,
    selection: {
      selected: true,
      finalScore: entry.reviewResult.rawScore,
      readingTier: entry.calibrationResult.readingTier,
      rank: index + 1
    }
  }));
  const editorialPlan = editorialPlanFor(selectedItems);
  const written = {
    nextStage: "write_head_tail",
    options: { paperConcurrency: 2 },
    selectedItems,
    editorialPlan,
    paperDrafts: selectedItems.map((entry) => paperDraftFor(entry.paper.id)),
    counts: {
      primary: 2,
      reserve: 0,
      fullTextEligible: 2,
      reviewed: 2,
      calibrated: 2,
      selected: 2,
      excluded: 0
    },
    warnings: []
  };
  const invalid = headTailFor(editorialPlan, selectedItems);
  invalid.readingOrder = [];

  await assert.rejects(
    () => writeWeeklyReportHeadTail(written, execution.context, {
      networkRetryDelayMs: 0,
      callModel: async () => invalid
    }),
    (error) => (
      error.code === "READING_LIST_HEAD_TAIL_UNSUPPORTED"
      && error.stage === "write_head_tail"
      && error.rejectJob === true
    )
  );
  const calls = [...execution.sections.keys()]
    .filter((name) => name.startsWith("head-tail-call-"));
  assert.equal(calls.length, 2);
  assert.equal(execution.events.some((event) => (
    event.type === "reject_requested"
    && event.stage === "write_head_tail"
  )), true);
});

test("assemble rejects artifact identity mismatches and records a report-level decision", async () => {
  const execution = fakeExecutionContext();
  const selectedItems = [
    calibratedItemFor("2607.19901", 88, "must_read"),
    calibratedItemFor("2607.19902", 78, "worth_reading")
  ].map((entry, index) => ({
    ...entry,
    paper: { ...entry.paper, title: `Assembly mismatch paper ${index + 1}` },
    selection: {
      selected: true,
      selectionReason: "threshold",
      finalScore: entry.reviewResult.rawScore,
      readingTier: entry.calibrationResult.readingTier,
      rank: index + 1
    }
  }));
  const editorialPlan = editorialPlanFor(selectedItems);
  const headTailDraft = headTailFor(editorialPlan, selectedItems);

  await assert.rejects(
    () => assembleWeeklyReport({
      nextStage: "assemble",
      reportMeta: { date: "2026-08-03", month: "2026-08", weekOfMonth: 1 },
      selectedItems,
      editorialPlan,
      paperDrafts: [paperDraftFor("2607.19901")],
      headTailDraft,
      counts: {
        primary: 2,
        reserve: 0,
        fullTextEligible: 2,
        reviewed: 2,
        calibrated: 2,
        selected: 2,
        excluded: 0
      },
      warnings: []
    }, execution.context),
    (error) => (
      error.code === "READING_LIST_ASSEMBLY_ARTIFACT_MISMATCH"
      && error.stage === "assemble"
      && error.rejectJob === true
    )
  );
  assert.equal(execution.events.some((event) => (
    event.type === "reject_requested"
    && event.stage === "assemble"
  )), true);
});

test("deterministic_qa routes failures to repair and requests manual review after three attempts", async () => {
  const makeAssembled = async (execution) => {
    const selectedItems = [
      calibratedItemFor("2607.19911", 88, "must_read"),
      calibratedItemFor("2607.19912", 78, "worth_reading")
    ].map((entry, index) => ({
      ...entry,
      paper: { ...entry.paper, title: `Deterministic QA paper ${index + 1}` },
      selection: {
        selected: true,
        selectionReason: "threshold",
        finalScore: entry.reviewResult.rawScore,
        readingTier: entry.calibrationResult.readingTier,
        rank: index + 1
      }
    }));
    const editorialPlan = editorialPlanFor(selectedItems);
    return assembleWeeklyReport({
      nextStage: "assemble",
      reportMeta: { date: "2026-08-03", month: "2026-08", weekOfMonth: 1 },
      selectedItems,
      editorialPlan,
      paperDrafts: selectedItems.map((entry) => paperDraftFor(entry.paper.id)),
      headTailDraft: {
        ...headTailFor(editorialPlan, selectedItems),
        trendJudgments: [],
        singlePaperObservations: []
      },
      counts: {
        primary: 2,
        reserve: 0,
        fullTextEligible: 2,
        reviewed: 2,
        calibrated: 2,
        selected: 2,
        excluded: 0
      },
      warnings: []
    }, execution.context);
  };

  const firstExecution = fakeExecutionContext();
  const assembled = await makeAssembled(firstExecution);
  const tampered = {
    ...assembled,
    markdown: assembled.markdown.replace("阅读价值评分：88", "阅读价值评分：99")
  };
  const repair = await runWeeklyReportDeterministicQa(tampered, firstExecution.context);

  assert.equal(repair.nextStage, "repair_once");
  assert.equal(repair.qaReport.status, "repair_required");
  assert.equal(repair.qaReport.paperIssues.some((issue) => (
    issue.code === "published_score_mismatch"
    && issue.paperId === "2607.19911"
  )), true);
  assert.equal(firstExecution.events.some((event) => (
    event.type === "repair_requested"
    && event.stage === "deterministic_qa"
  )), true);
  assert.equal(firstExecution.events.some((event) => event.type === "reject_requested"), false);

  const secondExecution = fakeExecutionContext();
  const secondAssembled = await makeAssembled(secondExecution);
  const stillInvalid = {
    ...secondAssembled,
    markdown: secondAssembled.markdown.replace("阅读价值评分：88", "阅读价值评分：99"),
    qaReport: { repairAttempted: true, repairCount: 3 }
  };
  const manual = await runWeeklyReportDeterministicQa(stillInvalid, secondExecution.context);
  assert.equal(manual.nextStage, "manual_review");
  assert.equal(manual.manualReview.stage, "deterministic_qa");
  assert.equal(manual.manualReview.repairAttempts, 3);
  assert.deepEqual(manual.manualReview.allowedActions, ["continue_repair", "exit_task"]);
  assert.equal(secondExecution.events.some((event) => (
    event.type === "stage_failed"
    && event.stage === "deterministic_qa"
    && event.decision === "manual_review"
  )), true);
  assert.equal(secondExecution.events.some((event) => event.type === "reject_requested"), false);
});

test("paper_semantic_qa reviews one paper per call, persists Trace, and continues only when all pass", async () => {
  const execution = fakeExecutionContext();
  const selectedItems = [
    calibratedItemFor("2608.19921", 88, "must_read"),
    calibratedItemFor("2608.19922", 78, "worth_reading")
  ].map((entry, index) => ({
    ...entry,
    paper: { ...entry.paper, title: `Paper semantic QA ${index + 1}` },
    selection: {
      selected: true,
      selectionReason: "threshold",
      finalScore: entry.reviewResult.rawScore,
      readingTier: entry.calibrationResult.readingTier,
      rank: index + 1
    }
  }));
  const editorialPlan = editorialPlanFor(selectedItems);
  const assembled = await assembleWeeklyReport({
    nextStage: "assemble",
    reportMeta: { date: "2026-08-03", month: "2026-08", weekOfMonth: 1 },
    selectedItems,
    editorialPlan,
    paperDrafts: selectedItems.map((entry) => paperDraftFor(entry.paper.id)),
    headTailDraft: {
      ...headTailFor(editorialPlan, selectedItems),
      trendJudgments: [],
      singlePaperObservations: []
    },
    counts: {
      primary: 2,
      reserve: 0,
      fullTextEligible: 2,
      reviewed: 2,
      calibrated: 2,
      selected: 2,
      excluded: 0
    },
    options: { paperConcurrency: 2 },
    warnings: []
  }, execution.context);
  const deterministic = await runWeeklyReportDeterministicQa(assembled, execution.context);
  const seenPaperIds = [];
  const result = await runWeeklyReportPaperSemanticQa(deterministic, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const parsed = JSON.parse(prompt);
      seenPaperIds.push(parsed.paper.paperId);
      assert.equal("otherPapers" in parsed, false);
      return paperSemanticPassFor(parsed.paper.paperId);
    }
  });
  const reportQa = await runWeeklyReportReportSemanticQa(result, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async () => reportSemanticPass()
  });

  assert.equal(result.nextStage, "report_semantic_qa");
  assert.equal(reportQa.nextStage, "publish");
  assert.deepEqual(seenPaperIds.sort(), ["2608.19921", "2608.19922"]);
  assert.equal(result.qaReport.status, "passed");
  assert.equal(result.qaReport.paperSemanticResults.length, 2);
  assert.equal(execution.sections.get("paper-semantic-qa").status, "passed");
  assert.equal([...execution.sections.keys()].filter((key) => key.startsWith("paper-semantic-qa-call-")).length, 2);
  assert.equal(execution.events.some((event) => (
    event.type === "stage_completed"
    && event.stage === "paper_semantic_qa"
    && event.decision === "continue"
  )), true);
  assert.equal(execution.sections.get("report-semantic-qa").status, "passed");
  assert.equal(execution.events.some((event) => (
    event.type === "stage_completed"
    && event.stage === "report_semantic_qa"
    && event.decision === "publish"
  )), true);
});

test("paper_semantic_qa allows three repairs and requests manual review after exhaustion", async () => {
  const makeInput = (execution, repairCount = 0) => {
    const paperId = "2608.19931";
    const item = calibratedItemFor(paperId, 88, "must_read");
    item.paper.title = "Paper semantic repair routing";
    item.selection = {
      selected: true,
      selectionReason: "threshold",
      finalScore: 88,
      readingTier: "must_read",
      rank: 1
    };
    const draft = paperDraftFor(paperId);
    draft.publicationMeta = {
      title: item.paper.title,
      affiliations: item.reviewResult.affiliations,
      finalScore: 88,
      scores: item.reviewResult.scores,
      readingTier: "must_read",
      rank: 1,
      canonicalLink: `https://arxiv.org/abs/${paperId}`
    };
    return {
      nextStage: "paper_semantic_qa",
      selectedItems: [item],
      paperDrafts: [draft],
      counts: { primary: 1, reserve: 0, fullTextEligible: 1, reviewed: 1, calibrated: 1, selected: 1, excluded: 0 },
      options: { paperConcurrency: 2 },
      warnings: [],
      qaReport: {
        status: "passed",
        deterministicIssues: [],
        paperIssues: [],
        reportIssues: [],
        repairAttempted: repairCount > 0,
        repairCount
      }
    };
  };
  const issueResponse = (paperId) => ({
    ...paperSemanticPassFor(paperId),
    verdict: "repair_required",
    checks: {
      ...paperSemanticPassFor(paperId).checks,
      recommendationToneAligned: false
    },
    issues: [{
      code: "recommendation_tone_mismatch",
      severity: "medium",
      field: "readingValue.whyWorthReading",
      claim: "The recommendation is stronger than the evidence.",
      reason: "The evidence is simulation-only.",
      evidenceRefs: ["experiments:0"]
    }]
  });

  const firstExecution = fakeExecutionContext();
  const repair = await runWeeklyReportPaperSemanticQa(
    makeInput(firstExecution),
    firstExecution.context,
    { networkRetryDelayMs: 0, callModel: async (prompt) => issueResponse(JSON.parse(prompt).paper.paperId) }
  );
  assert.equal(repair.nextStage, "repair_once");
  assert.equal(repair.qaReport.status, "repair_required");
  assert.equal(repair.qaReport.paperIssues[0].paperId, "2608.19931");
  assert.equal(repair.qaReport.paperIssues[0].repairTarget, "paper_section");
  assert.equal(firstExecution.events.some((event) => (
    event.type === "repair_requested"
    && event.stage === "paper_semantic_qa"
  )), true);

  const secondRepair = await runWeeklyReportPaperSemanticQa(
    makeInput(firstExecution, 1),
    firstExecution.context,
    { networkRetryDelayMs: 0, callModel: async (prompt) => issueResponse(JSON.parse(prompt).paper.paperId) }
  );
  assert.equal(secondRepair.nextStage, "repair_once");
  const manual = await runWeeklyReportPaperSemanticQa(
    makeInput(firstExecution, 3),
    firstExecution.context,
    { networkRetryDelayMs: 0, callModel: async (prompt) => issueResponse(JSON.parse(prompt).paper.paperId) }
  );
  assert.equal(manual.nextStage, "manual_review");
  assert.equal(manual.manualReview.paperId, "2608.19931");
  assert.equal(manual.manualReview.repairAttempts, 3);
  assert.deepEqual(manual.manualReview.allowedActions, ["continue_repair", "exit_task", "skip_paper"]);
  assert.equal(firstExecution.sections.has("paper-semantic-qa-call-0000"), true);
  assert.equal(firstExecution.sections.has("paper-semantic-qa-repair-1-call-0000"), true);
  assert.equal(firstExecution.sections.has("paper-semantic-qa-repair-3-call-0000"), true);
  assert.equal(firstExecution.sections.has("paper-semantic-qa"), true);
  assert.equal(firstExecution.sections.has("paper-semantic-qa-repair-3"), true);
});

test("paper_semantic_qa artifact mismatch waits for an administrator instead of rejecting the whole report", async () => {
  const execution = fakeExecutionContext();
  const paperId = "2608.19932";
  const item = calibratedItemFor(paperId, 88, "must_read");
  item.selection = {
    selected: true,
    selectionReason: "threshold",
    finalScore: 88,
    readingTier: "must_read",
    rank: 1
  };
  const result = await runWeeklyReportPaperSemanticQa({
    nextStage: "paper_semantic_qa",
    selectedItems: [item],
    paperDrafts: [paperDraftFor("2608.99999")],
    counts: { primary: 1, reserve: 0, fullTextEligible: 1, reviewed: 1, calibrated: 1, selected: 1, excluded: 0 },
    options: { paperConcurrency: 1 },
    warnings: [],
    qaReport: { status: "passed", repairAttempted: false, repairCount: 0 }
  }, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async () => {
      throw new Error("Identity mismatch must fail before a model call.");
    }
  });

  assert.equal(result.nextStage, "manual_review");
  assert.equal(result.manualReview.paperId, paperId);
  assert.deepEqual(result.manualReview.allowedActions, ["exit_task", "skip_paper"]);
  assert.equal(result.manualReview.issues[0].code, "READING_LIST_PAPER_QA_FAILED");
  assert.equal(execution.events.some((event) => (
    event.type === "stage_failed"
    && event.stage === "paper_semantic_qa"
    && event.decision === "manual_review"
  )), true);
  assert.equal(execution.events.some((event) => event.type === "reject_requested"), false);
});

test("paper_semantic_qa malformed model responses still fail closed instead of offering skip", async () => {
  const execution = fakeExecutionContext();
  const paperId = "2608.19933";
  const item = calibratedItemFor(paperId, 88, "must_read");
  item.selection = {
    selected: true,
    selectionReason: "threshold",
    finalScore: 88,
    readingTier: "must_read",
    rank: 1
  };
  await assert.rejects(
    () => runWeeklyReportPaperSemanticQa({
      nextStage: "paper_semantic_qa",
      selectedItems: [item],
      paperDrafts: [paperDraftFor(paperId)],
      counts: { primary: 1, reserve: 0, fullTextEligible: 1, reviewed: 1, calibrated: 1, selected: 1, excluded: 0 },
      options: { paperConcurrency: 1 },
      warnings: [],
      qaReport: { status: "passed", repairAttempted: false, repairCount: 0 }
    }, execution.context, {
      networkRetryDelayMs: 0,
      callModel: async () => ({ paperId })
    }),
    (error) => error.code === "READING_LIST_PAPER_QA_FAILED"
      && error.stage === "paper_semantic_qa"
      && error.rejectJob === true
  );
  assert.equal(execution.events.some((event) => (
    event.type === "reject_requested" && event.stage === "paper_semantic_qa"
  )), true);
});

test("report_semantic_qa allows three repairs and requests manual review after exhaustion", async () => {
  const makeInput = (repairCount = 0) => {
    const selectedItems = [
      calibratedItemFor("2608.19941", 88, "must_read"),
      calibratedItemFor("2608.19942", 78, "worth_reading")
    ].map((entry, index) => ({
      ...entry,
      paper: { ...entry.paper, title: `Report semantic QA ${index + 1}` },
      selection: {
        selected: true,
        selectionReason: "threshold",
        finalScore: entry.reviewResult.rawScore,
        readingTier: entry.calibrationResult.readingTier,
        rank: index + 1
      }
    }));
    const plan = editorialPlanFor(selectedItems);
    const drafts = selectedItems.map((entry) => {
      const draft = paperDraftFor(entry.paper.id);
      draft.publicationMeta = {
        title: entry.paper.title,
        affiliations: entry.reviewResult.affiliations,
        finalScore: entry.selection.finalScore,
        scores: entry.reviewResult.scores,
        readingTier: entry.selection.readingTier,
        rank: entry.selection.rank,
        canonicalLink: `https://arxiv.org/abs/${entry.paper.id}`
      };
      return draft;
    });
    return {
      nextStage: "report_semantic_qa",
      selectedItems,
      editorialPlan: plan,
      paperDrafts: drafts,
      headTailDraft: headTailFor(plan, selectedItems),
      publishReport: {
        title: "论文周报 2026-08 第1周｜Verifiable action constraints",
        description: "Grounded guidance for safer autonomous execution."
      },
      counts: { primary: 2, reserve: 0, fullTextEligible: 2, reviewed: 2, calibrated: 2, selected: 2, excluded: 0 },
      warnings: [],
      qaReport: {
        status: "passed",
        deterministicIssues: [],
        paperIssues: [],
        reportIssues: [],
        paperSemanticResults: [],
        repairAttempted: repairCount > 0,
        repairCount
      }
    };
  };
  const issueResponse = () => ({
    ...reportSemanticPass(),
    verdict: "repair_required",
    checks: {
      ...reportSemanticPass().checks,
      trendsMultiPaperGrounded: false
    },
    issues: [{
      code: "trend_not_multi_paper",
      severity: "high",
      field: "trendJudgments[0]",
      claim: "The wording overstates cohort support.",
      reason: "The broad claim is not supported by multiple selected papers.",
      supportingPaperIds: ["2608.19941"]
    }]
  });

  const firstExecution = fakeExecutionContext();
  const repair = await runWeeklyReportReportSemanticQa(
    makeInput(),
    firstExecution.context,
    { networkRetryDelayMs: 0, callModel: async () => issueResponse() }
  );
  assert.equal(repair.nextStage, "repair_once");
  assert.equal(repair.qaReport.status, "repair_required");
  assert.equal(repair.qaReport.reportIssues[0].repairTarget, "head_tail");
  assert.equal(firstExecution.events.some((event) => (
    event.type === "repair_requested"
    && event.stage === "report_semantic_qa"
  )), true);

  const secondRepair = await runWeeklyReportReportSemanticQa(
    makeInput(1),
    firstExecution.context,
    { networkRetryDelayMs: 0, callModel: async () => issueResponse() }
  );
  assert.equal(secondRepair.nextStage, "repair_once");
  const manual = await runWeeklyReportReportSemanticQa(
    makeInput(3),
    firstExecution.context,
    { networkRetryDelayMs: 0, callModel: async () => issueResponse() }
  );
  assert.equal(manual.nextStage, "manual_review");
  assert.equal(manual.manualReview.paperId, "");
  assert.equal(manual.manualReview.repairAttempts, 3);
  assert.deepEqual(manual.manualReview.allowedActions, ["continue_repair", "exit_task"]);
  assert.equal(firstExecution.sections.has("report-semantic-qa-call-0000"), true);
  assert.equal(firstExecution.sections.has("report-semantic-qa-repair-1-call-0000"), true);
  assert.equal(firstExecution.sections.has("report-semantic-qa-repair-3-call-0000"), true);
  assert.equal(firstExecution.sections.has("report-semantic-qa"), true);
  assert.equal(firstExecution.sections.has("report-semantic-qa-repair-3"), true);

  const unavailableExecution = fakeExecutionContext();
  await assert.rejects(
    () => runWeeklyReportReportSemanticQa(
      makeInput(),
      unavailableExecution.context,
      { networkRetryDelayMs: 0, callModel: async () => ({ verdict: "pass" }) }
    ),
    (error) => error.code === "READING_LIST_REPORT_QA_FAILED"
      && error.stage === "report_semantic_qa"
      && error.rejectJob === true
  );
  assert.equal(unavailableExecution.updates.some((entry) => (
    entry.stage === "report_semantic_qa"
    && entry.patch.warnings?.some((warning) => warning.code === "READING_LIST_REPORT_QA_FAILED")
  )), true);
});

test("repair_once fixes assembly-only drift without calling an Agent and marks the single opportunity consumed", async () => {
  const execution = fakeExecutionContext();
  const input = {
    nextStage: "repair_once",
    counts: { primary: 1, reserve: 0, fullTextEligible: 1, reviewed: 1, calibrated: 1, selected: 1, excluded: 0 },
    warnings: [],
    qaReport: {
      status: "repair_required",
      deterministicIssues: [{
        code: "published_score_mismatch",
        path: "paper.score.2608.19951",
        message: "Published score differs from trusted Review.",
        severity: "high",
        scope: "paper",
        paperId: "2608.19951",
        repairTarget: "assemble",
        repairable: true
      }],
      paperIssues: [],
      reportIssues: [],
      repairAttempted: false,
      repairResults: []
    }
  };
  const result = await repairWeeklyReportOnce(input, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async () => {
      throw new Error("Assembly-only repair must not call a model.");
    }
  });

  assert.equal(result.nextStage, "assemble");
  assert.equal(result.qaReport.repairAttempted, true);
  assert.equal(result.qaReport.repairResults.length, 1);
  assert.equal(result.qaReport.repairResults[0].repairTarget, "assemble");
  assert.equal(result.qaReport.repairResults[0].method, "server_reassemble");
  assert.equal(execution.sections.get("repair-result").repairResults.length, 1);
});

test("repair_once rewrites only targeted paper sections and Head/Tail, records diffs, then returns to assemble", async () => {
  const execution = fakeExecutionContext();
  const selectedItems = [
    calibratedItemFor("2608.19961", 88, "must_read"),
    calibratedItemFor("2608.19962", 78, "worth_reading")
  ].map((entry, index) => ({
    ...entry,
    paper: { ...entry.paper, title: `Repair target ${index + 1}` },
    selection: {
      selected: true,
      selectionReason: "threshold",
      finalScore: entry.reviewResult.rawScore,
      readingTier: entry.calibrationResult.readingTier,
      rank: index + 1
    }
  }));
  const editorialPlan = editorialPlanFor(selectedItems);
  const paperDrafts = selectedItems.map((entry) => {
    const draft = paperDraftFor(entry.paper.id);
    draft.publicationMeta = {
      title: entry.paper.title,
      affiliations: entry.reviewResult.affiliations,
      finalScore: entry.selection.finalScore,
      scores: entry.reviewResult.scores,
      readingTier: entry.selection.readingTier,
      rank: entry.selection.rank,
      canonicalLink: `https://arxiv.org/abs/${entry.paper.id}`
    };
    return draft;
  });
  paperDrafts[0].oneSentenceTakeaway.text = "Overstated current takeaway.";
  const originalUntargetedDraft = structuredClone(paperDrafts[1]);
  const input = {
    nextStage: "repair_once",
    selectedItems,
    editorialPlan,
    paperDrafts,
    headTailDraft: headTailFor(editorialPlan, selectedItems),
    reportMeta: { date: "2026-08-03", month: "2026-08", weekOfMonth: 1 },
    counts: { primary: 2, reserve: 0, fullTextEligible: 2, reviewed: 2, calibrated: 2, selected: 2, excluded: 0 },
    options: { paperConcurrency: 2 },
    warnings: [],
    qaReport: {
      status: "repair_required",
      deterministicIssues: [],
      paperIssues: [{
        code: "unsupported_fact",
        field: "oneSentenceTakeaway",
        path: "oneSentenceTakeaway",
        claim: "Overstated current takeaway.",
        reason: "Narrow the claim to the method Evidence.",
        evidenceRefs: ["method:0"],
        severity: "high",
        scope: "paper",
        paperId: "2608.19961",
        repairTarget: "paper_section",
        repairable: true
      }],
      reportIssues: [{
        code: "title_not_grounded",
        field: "titleAngle",
        path: "titleAngle",
        claim: "The title is too broad.",
        reason: "Use the validated Editorial Plan scope.",
        supportingPaperIds: ["2608.19961", "2608.19962"],
        severity: "medium",
        scope: "report",
        paperId: "",
        repairTarget: "head_tail",
        repairable: true
      }],
      repairAttempted: false,
      repairResults: []
    }
  };
  const tasks = [];
  const result = await repairWeeklyReportOnce(input, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const parsed = JSON.parse(prompt);
      tasks.push(parsed.task);
      if (parsed.task === "weekly_report_repair_paper_section") {
        return paperDraftFor(parsed.paper.paperId);
      }
      if (parsed.task === "weekly_report_repair_head_tail") {
        return {
          ...headTailFor(editorialPlan, selectedItems),
          closingSummary: "Repaired guidance keeps the validated cohort scope explicit."
        };
      }
      throw new Error(`Unexpected repair task ${parsed.task}`);
    }
  });
  const reassembled = await assembleWeeklyReport(result, execution.context);
  const rechecked = await runWeeklyReportDeterministicQa(reassembled, execution.context);

  assert.equal(result.nextStage, "assemble");
  assert.equal(result.qaReport.repairAttempted, true);
  assert.deepEqual(tasks.sort(), ["weekly_report_repair_head_tail", "weekly_report_repair_paper_section"]);
  assert.equal(result.paperDrafts[0].oneSentenceTakeaway.text.includes("Overstated"), false);
  assert.deepEqual(result.paperDrafts[1], originalUntargetedDraft);
  assert.equal(result.qaReport.repairResults.length, 2);
  assert.equal(result.qaReport.repairResults.every((entry) => entry.changed === true), true);
  assert.equal(rechecked.nextStage, "paper_semantic_qa");
  assert.equal(rechecked.qaReport.status, "passed");
  assert.equal(rechecked.qaReport.repairAttempted, true);
  assert.equal(rechecked.qaReport.repairResults.length, 2);
  assert.equal(execution.events.some((event) => (
    event.type === "stage_completed"
    && event.stage === "repair_once"
    && event.decision === "reassemble_and_recheck"
  )), true);
});

test("repair_once cannot be entered after the content repair opportunity was consumed", async () => {
  const execution = fakeExecutionContext();
  await assert.rejects(
    () => repairWeeklyReportOnce({
      nextStage: "repair_once",
      counts: {},
      warnings: [],
      qaReport: {
        status: "repair_required",
        deterministicIssues: [],
        paperIssues: [],
        reportIssues: [{ repairTarget: "head_tail", repairable: true }],
        repairAttempted: true,
        repairCount: 3,
        repairResults: []
      }
    }, execution.context, { callModel: async () => ({}) }),
    (error) => error.code === "READING_LIST_QA_REPAIR_FAILED"
      && error.stage === "repair_once"
      && error.rejectJob === true
  );
  assert.equal(execution.events.some((event) => (
    event.type === "reject_requested"
    && event.stage === "repair_once"
  )), true);
});

test("an administrator can grant exactly one repair after the three automatic attempts", async () => {
  const execution = fakeExecutionContext();
  const result = await repairWeeklyReportOnce({
    nextStage: "repair_once",
    counts: {},
    warnings: [],
    qaReport: {
      status: "repair_required",
      deterministicIssues: [{
        code: "published_score_mismatch",
        path: "paper.score.2608.19951",
        message: "Published score differs from trusted Review.",
        severity: "high",
        scope: "paper",
        paperId: "2608.19951",
        repairTarget: "assemble",
        repairable: true
      }],
      paperIssues: [],
      reportIssues: [],
      repairAttempted: true,
      repairCount: 3,
      adminRepairApproved: true,
      repairResults: []
    }
  }, execution.context, {
    callModel: async () => {
      throw new Error("Assembly-only repair must not call a model.");
    }
  });

  assert.equal(result.nextStage, "assemble");
  assert.equal(result.qaReport.repairCount, 4);
  assert.equal(result.qaReport.adminRepairApproved, false);
  assert.equal(execution.sections.has("repair-result-4"), true);
});
test("write_paper_sections exposes a skip decision for one unsupported selected paper", async () => {
  const execution = fakeExecutionContext();
  const selectedItems = [
    calibratedItemFor("2607.19601", 88, "must_read"),
    calibratedItemFor("2607.19602", 78, "worth_reading")
  ].map((entry, index) => ({
    ...entry,
    selection: {
      selected: true,
      finalScore: entry.reviewResult.rawScore,
      readingTier: entry.calibrationResult.readingTier,
      rank: index + 1
    }
  }));
  const planned = {
    nextStage: "write_paper_sections",
    options: { paperConcurrency: 2 },
    selectedItems,
    editorialPlan: editorialPlanFor(selectedItems),
    counts: {
      primary: 2,
      reserve: 0,
      fullTextEligible: 2,
      reviewed: 2,
      calibrated: 2,
      selected: 2,
      excluded: 0
    },
    warnings: []
  };

  const written = await writeWeeklyReportPaperSections(planned, execution.context, {
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const paperId = JSON.parse(prompt).paper.paperId;
      const draft = paperDraftFor(paperId);
      if (paperId === "2607.19602") draft.limitationsAndConstraints = [];
      return draft;
    }
  });

  assert.equal(written.nextStage, "manual_review");
  assert.equal(written.manualReview.paperId, "2607.19602");
  assert.deepEqual(written.manualReview.allowedActions, ["exit_task", "skip_paper"]);
  assert.equal(execution.events.some((event) => event.type === "reject_requested"), false);
});
