import {
  prepareContextCandidates,
  buildContextPacketFromLegacyPaper
} from "./context-builder.js";
import { extractEvidenceBatch } from "./evidence-agent.js";
import { reviewEvidenceBatch } from "./review-agent.js";
import { calibrateReviewBatch } from "./calibration-agent.js";
import {
  runEditorialPlanAgent,
  runHeadTailWriter
} from "./editorial-agent.js";
import {
  assembleWeeklyReportMarkdown,
  writePaperSectionsBatch
} from "./report-writer.js";
import {
  prepareReadingListCandidatePool,
  readingListWeekRange,
  selectCalibratedPapers
} from "./rules.js";
import { normalizeWeeklyReportJobOptions } from "./schema.js";
import { runDeterministicQa } from "./qa-checker.js";
import { reviewPaperSemanticsBatch } from "./paper-semantic-qa-agent.js";
import { reviewReportSemantics } from "./report-semantic-qa-agent.js";
import {
  repairHeadTailFromQa,
  repairPaperSectionFromQa
} from "./repair-agent.js";

const emptyCounts = () => ({
  primary: 0,
  reserve: 0,
  fullTextEligible: 0,
  reviewed: 0,
  calibrated: 0,
  selected: 0,
  excluded: 0
});

const totalPoolExclusions = (excluded = {}) => Object.values(excluded)
  .reduce((total, value) => total + Math.max(0, Number(value) || 0), 0);

const elapsed = (startedAt) => Math.max(0, Date.now() - startedAt);
const AUTOMATIC_CONTENT_REPAIR_LIMIT = 3;
const repairCountFor = (qaReport = {}) => {
  const count = Number(qaReport?.repairCount);
  if (Number.isInteger(count) && count >= 0) {
    return count;
  }
  return qaReport?.repairAttempted ? 1 : 0;
};
const repairTraceSuffix = (qaReport = {}) => {
  const count = repairCountFor(qaReport);
  return count > 0 ? `-repair-${count}` : "";
};

const normalizedReviewScoreThreshold = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(Math.max(Math.round(numeric), 40), 95)
    : 70;
};

const weekOfMonthForDate = (dateText) => {
  const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return 1;
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const firstDayOffset = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
  return Math.min(Math.max(Math.ceil((day + firstDayOffset) / 7), 1), 6);
};

const normalizedReportMeta = (input, range) => {
  const suppliedDate = String(input?.date || "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(suppliedDate)
    ? suppliedDate
    : String(range?.start || "").slice(0, 10);
  const suppliedMonth = String(input?.month || "").trim();
  const month = /^\d{4}-\d{2}$/.test(suppliedMonth) ? suppliedMonth : date.slice(0, 7);
  const suppliedWeek = Number(input?.weekOfMonth);
  return {
    date,
    month,
    weekOfMonth: Number.isInteger(suppliedWeek) && suppliedWeek >= 1 && suppliedWeek <= 6
      ? suppliedWeek
      : weekOfMonthForDate(date),
    weekStart: range.start,
    weekEnd: range.end,
    reportKey: String(input?.reportKey || "")
  };
};

export class WeeklyReportOrchestratorError extends Error {
  constructor(message, {
    code,
    stage,
    paperId = "",
    retryable = false,
    traceId = "",
    detail = "",
    rejectJob = false
  } = {}) {
    super(message);
    this.name = "WeeklyReportOrchestratorError";
    this.code = code || "READING_LIST_PUBLISH_REJECTED";
    this.stage = stage || "";
    this.paperId = paperId;
    this.retryable = Boolean(retryable);
    this.traceId = traceId;
    this.detail = detail || message;
    this.rejectJob = Boolean(rejectJob);
  }
}

const assertExecutionContext = (context) => {
  for (const method of ["updateStage", "recordTrace", "writeTrace"]) {
    if (typeof context?.[method] !== "function") {
      throw new TypeError(`Weekly report Orchestrator context.${method} is required.`);
    }
  }
};

const warningsForContextResult = (result) => {
  const warnings = [];
  const attempted = result.primaryAttempted + result.reserveAttempted;
  const failureRate = attempted ? result.excluded.length / attempted : 0;

  if (attempted >= 2 && failureRate >= 0.5) {
    warnings.push({
      code: "READING_LIST_CONTEXT_HIGH_FAILURE_RATE",
      stage: "prepare_context",
      message: `原文质量门排除了 ${result.excluded.length}/${attempted} 篇已尝试论文。`,
      severity: "warning"
    });
  }

  if (result.underTarget && result.eligible.length) {
    warnings.push({
      code: "READING_LIST_CONTEXT_BELOW_TARGET",
      stage: "prepare_context",
      message: `候选池耗尽后仅有 ${result.eligible.length}/${result.targetEligibleCount} 篇论文通过原文质量门。`,
      severity: "warning"
    });
  }

  return warnings;
};

export const prepareWeeklyReportJob = async (input = {}, context = {}, {
  buildContext = (paper) => buildContextPacketFromLegacyPaper(paper)
} = {}) => {
  assertExecutionContext(context);
  const range = readingListWeekRange(input);
  const reportMeta = normalizedReportMeta(input, range);
  const options = normalizeWeeklyReportJobOptions({
    ...(input.options && typeof input.options === "object" ? input.options : {}),
    paperConcurrency: input.paperConcurrency ?? input.options?.paperConcurrency,
    calibrationMaxPapers: input.calibrationMaxPapers ?? input.options?.calibrationMaxPapers,
    minSelectedCount: input.minSelectedCount ?? input.options?.minSelectedCount,
    maxSelectedCount: input.maxSelectedCount ?? input.options?.maxSelectedCount
  });
  const minEligibleCount = options.minSelectedCount;
  const paperConcurrency = options.paperConcurrency;
  const reviewScoreThreshold = normalizedReviewScoreThreshold(
    input.reviewScoreThreshold ?? input.options?.reviewScoreThreshold
  );
  const sourceSnapshot = Array.isArray(input.sourceSnapshot)
    ? structuredClone(input.sourceSnapshot)
    : [];
  const outputLanguage = String(input.outputLanguage || "").trim();
  const initialCounts = emptyCounts();
  const candidateStageStartedAt = Date.now();

  await context.updateStage("prepare_candidate_pool", { counts: initialCounts });
  await context.recordTrace({
    type: "stage_started",
    stage: "prepare_candidate_pool",
    scope: "job"
  });

  const candidatePool = prepareReadingListCandidatePool({
    primaryPapers: input.primaryPapers,
    reservePapers: input.reservePapers,
    range
  });
  const poolExcludedCount = totalPoolExclusions(candidatePool.excluded);
  const candidateCounts = {
    ...initialCounts,
    primary: candidatePool.primaryCandidates.length,
    reserve: candidatePool.reserveCandidates.length,
    excluded: poolExcludedCount
  };
  const candidateArtifact = {
    reportMeta,
    outputLanguage,
    weekStart: range.start,
    weekEnd: range.end,
    minEligibleCount,
    reviewScoreThreshold,
    paperConcurrency,
    maxSelectedCount: options.maxSelectedCount,
    primaryCandidates: candidatePool.primaryCandidates,
    reserveCandidates: candidatePool.reserveCandidates,
    sourceSnapshot,
    excluded: candidatePool.excluded
  };

  await context.writeTrace("candidate-pool", candidateArtifact);
  await context.recordTrace({
    type: "stage_completed",
    stage: "prepare_candidate_pool",
    scope: "job",
    durationMs: elapsed(candidateStageStartedAt),
    counts: candidateCounts,
    decision: "continue"
  });

  const contextStageStartedAt = Date.now();
  await context.updateStage("prepare_context", { counts: candidateCounts });
  await context.recordTrace({
    type: "stage_started",
    stage: "prepare_context",
    scope: "job",
    concurrency: paperConcurrency
  });

  let contextResult;

  try {
    contextResult = await prepareContextCandidates({
      primaryCandidates: candidatePool.primaryCandidates,
      reserveCandidates: candidatePool.reserveCandidates,
      minEligibleCount,
      paperConcurrency,
      buildContext,
      signal: context.signal,
      onEvent: (event) => context.recordTrace(event)
    });
  } catch (error) {
    if (error?.name === "AbortError" || context.signal?.aborted) {
      await context.recordTrace({
        type: "stage_cancelled",
        stage: "prepare_context",
        scope: "job",
        durationMs: elapsed(contextStageStartedAt),
        reason: "admin_cancelled"
      });
    }
    throw error;
  }

  const warnings = warningsForContextResult(contextResult);
  const counts = {
    ...candidateCounts,
    fullTextEligible: contextResult.eligible.length,
    excluded: poolExcludedCount + contextResult.excluded.length
  };
  const contextArtifact = {
    targetEligibleCount: contextResult.targetEligibleCount,
    primaryAttempted: contextResult.primaryAttempted,
    reserveAttempted: contextResult.reserveAttempted,
    reserveRemaining: contextResult.reserveRemaining,
    underTarget: contextResult.underTarget,
    eligible: contextResult.eligible,
    excluded: contextResult.excluded,
    warnings
  };

  await context.writeTrace("context-packets", contextArtifact);
  await context.updateStage("prepare_context", { counts, warnings });
  await context.recordTrace({
    type: "stage_completed",
    stage: "prepare_context",
    scope: "job",
    durationMs: elapsed(contextStageStartedAt),
    counts,
    warnings,
    decision: contextResult.outcome
  });

  if (contextResult.outcome === "reject") {
    const error = new WeeklyReportOrchestratorError(
      "没有任何论文通过原文质量门，本次周报任务已拒绝。",
      {
        code: "READING_LIST_NO_ELIGIBLE_PAPERS",
        stage: "prepare_context",
        retryable: false,
        traceId: context.traceId,
        detail: "primary 和 reserve 候选均已耗尽，零篇论文具有可用于发布的有效 arXiv HTML 原文。",
        rejectJob: true
      }
    );
    await context.recordTrace({
      type: "reject_requested",
      stage: "prepare_context",
      scope: "job",
      code: error.code,
      reason: error.detail
    });
    throw error;
  }

  return {
    nextStage: "extract_evidence",
    range,
    reportMeta,
    outputLanguage,
    options,
    reviewScoreThreshold,
    candidatePool,
    contextResult,
    eligiblePapers: contextResult.eligible.map((item) => item.paper),
    contextPackets: contextResult.eligible.map((item) => item.contextPacket),
    counts,
    warnings
  };
};

const evidenceStageWarnings = ({ attempted, excluded, accepted, target }) => {
  const warnings = [];
  const failureRate = attempted ? excluded / attempted : 0;

  if (attempted >= 2 && failureRate >= 0.5) {
    warnings.push({
      code: "READING_LIST_EVIDENCE_HIGH_FAILURE_RATE",
      stage: "extract_evidence",
      message: `${excluded}/${attempted} 篇已尝试论文未能生成可验证的 Evidence。`,
      severity: "warning"
    });
  }

  if (accepted > 0 && accepted < target) {
    warnings.push({
      code: "READING_LIST_EVIDENCE_BELOW_TARGET",
      stage: "extract_evidence",
      message: `候选池耗尽后仅有 ${accepted}/${target} 篇论文通过 Evidence 验证，将按实际合格数量继续。`,
      severity: "warning"
    });
  }

  return warnings;
};

export const extractWeeklyReportEvidence = async (prepared, context = {}, {
  callModel,
  buildContext = (paper) => buildContextPacketFromLegacyPaper(paper),
  networkRetryDelayMs = 50
} = {}) => {
  assertExecutionContext(context);

  if (!prepared || prepared.nextStage !== "extract_evidence") {
    throw new TypeError("A completed prepare_context result is required before extract_evidence.");
  }
  if (typeof callModel !== "function") {
    throw new TypeError("extract_evidence callModel is required.");
  }

  const stageStartedAt = Date.now();
  const target = Math.max(1, Number(prepared.contextResult?.targetEligibleCount) || 1);
  const concurrency = Math.min(Math.max(
    Math.trunc(Number(prepared.options?.paperConcurrency) || 2),
    1
  ), 5);
  const reserveCandidates = Array.isArray(prepared.candidatePool?.reserveCandidates)
    ? prepared.candidatePool.reserveCandidates
    : [];
  let reserveCursor = Math.max(0, Number(prepared.contextResult?.reserveAttempted) || 0);
  let callSequence = 0;
  let counts = { ...prepared.counts };
  const evidenceItems = [];
  const evidenceExcluded = [];
  const evidenceProcessingFailed = [];
  const refillContextEligible = [];
  const refillContextExcluded = [];

  await context.updateStage("extract_evidence", { counts, warnings: prepared.warnings || [] });
  await context.recordTrace({
    type: "stage_started",
    stage: "extract_evidence",
    scope: "job",
    concurrency,
    queued: prepared.contextResult.eligible.length,
    reserveRemaining: Math.max(0, reserveCandidates.length - reserveCursor)
  });

  const persistCall = async (record) => {
    const sequence = callSequence;
    callSequence += 1;
    await context.writeTrace(
      `evidence-call-${String(sequence).padStart(4, "0")}`,
      record
    );
    await context.recordTrace({
      type: record.error ? "model_call_failed" : "model_call_completed",
      stage: "extract_evidence",
      scope: "paper",
      role: record.role,
      paperId: record.paperId,
      attemptType: record.attemptType,
      durationMs: record.durationMs,
      validation: record.validation,
      error: record.error
    });
  };

  const runEvidence = async (items) => {
    if (!items.length) {
      return;
    }

    const result = await extractEvidenceBatch(items, {
      paperConcurrency: concurrency,
      callModel,
      signal: context.signal,
      networkRetryDelayMs,
      onCall: persistCall,
      onEvent: (event) => context.recordTrace(event)
    });
    evidenceItems.push(...result.succeeded);
    evidenceExcluded.push(...result.excluded);
    evidenceProcessingFailed.push(...result.processingFailed);
    counts = {
      ...counts,
      excluded: counts.excluded + result.excluded.length
    };
  };

  try {
    await runEvidence(prepared.contextResult.eligible);

    while (evidenceItems.length < target && reserveCursor < reserveCandidates.length) {
      const needed = target - evidenceItems.length;
      const batchSize = Math.min(concurrency, needed, reserveCandidates.length - reserveCursor);
      const batch = reserveCandidates.slice(reserveCursor, reserveCursor + batchSize);
      const refillOffset = reserveCursor;
      reserveCursor += batch.length;

      await context.recordTrace({
        type: "refill_requested",
        stage: "extract_evidence",
        scope: "job",
        reason: "evidence_below_target",
        requested: batch.length,
        reserveRemaining: Math.max(0, reserveCandidates.length - reserveCursor)
      });

      const refill = await prepareContextCandidates({
        primaryCandidates: batch,
        reserveCandidates: [],
        minEligibleCount: batch.length,
        paperConcurrency: concurrency,
        buildContext,
        signal: context.signal,
        onEvent: (event) => context.recordTrace({
          ...event,
          type: event.type === "context_accepted"
            ? "refill_context_accepted"
            : "refill_context_excluded",
          stage: "extract_evidence",
          origin: "reserve",
          reserveIndex: refillOffset
        })
      });
      const eligible = refill.eligible.map((item) => ({ ...item, origin: "reserve" }));
      const excluded = refill.excluded.map((item) => ({ ...item, origin: "reserve" }));
      refillContextEligible.push(...eligible);
      refillContextExcluded.push(...excluded);
      counts = {
        ...counts,
        fullTextEligible: counts.fullTextEligible + eligible.length,
        excluded: counts.excluded + excluded.length
      };
      await context.updateStage("extract_evidence", { counts });
      await runEvidence(eligible);
    }
  } catch (error) {
    if (error?.name === "AbortError" || context.signal?.aborted) {
      await context.recordTrace({
        type: "stage_cancelled",
        stage: "extract_evidence",
        scope: "job",
        durationMs: elapsed(stageStartedAt),
        reason: "admin_cancelled"
      });
    }
    throw error;
  }

  const warnings = [
    ...(Array.isArray(prepared.warnings) ? prepared.warnings : []),
    ...evidenceStageWarnings({
      attempted: evidenceItems.length + evidenceExcluded.length + evidenceProcessingFailed.length,
      excluded: evidenceExcluded.length,
      accepted: evidenceItems.length,
      target
    }),
    ...evidenceProcessingFailed.map((item) => ({
      code: "READING_LIST_EVIDENCE_PROCESSING_FAILED",
      stage: "extract_evidence",
      paperId: String(item?.contextPacket?.paperId || item?.paper?.id || ""),
      message: "该论文的 Evidence 模型调用在自动重试后仍未完成，已继续处理其它论文。",
      severity: "warning"
    }))
  ];
  const evidenceResult = {
    targetEligibleCount: target,
    attempted: evidenceItems.length + evidenceExcluded.length + evidenceProcessingFailed.length,
    concurrency,
    reserveAttempted: reserveCursor,
    reserveRemaining: Math.max(0, reserveCandidates.length - reserveCursor),
    underTarget: evidenceItems.length < target,
    succeeded: evidenceItems,
    excluded: evidenceExcluded,
    processingFailed: evidenceProcessingFailed
  };
  const refill = {
    contextEligible: refillContextEligible,
    contextExcluded: refillContextExcluded
  };

  await context.writeTrace("evidence-artifacts", {
    ...evidenceResult,
    refill,
    warnings
  });
  await context.updateStage("extract_evidence", { counts, warnings });
  await context.recordTrace({
    type: "stage_completed",
    stage: "extract_evidence",
    scope: "job",
    durationMs: elapsed(stageStartedAt),
    counts,
    warnings,
    decision: evidenceItems.length ? "continue" : "reject"
  });

  if (!evidenceItems.length) {
    const error = new WeeklyReportOrchestratorError(
      "没有任何论文生成可验证的 Evidence，本次周报任务已拒绝。",
      {
        code: "READING_LIST_NO_EVIDENCE_PAPERS",
        stage: "extract_evidence",
        retryable: false,
        traceId: context.traceId,
        detail: "primary 和 reserve 候选均已耗尽，所有可用原文都在 Evidence 提取或验证阶段失败。",
        rejectJob: true
      }
    );
    await context.recordTrace({
      type: "reject_requested",
      stage: "extract_evidence",
      scope: "job",
      code: error.code,
      reason: error.detail
    });
    throw error;
  }

  return {
    ...prepared,
    nextStage: "review",
    evidenceItems,
    evidenceResult,
    refill,
    counts,
    warnings
  };
};

const reviewStageWarnings = ({ attempted, excluded, accepted, target }) => {
  const warnings = [];
  const failureRate = attempted ? excluded / attempted : 0;

  if (attempted >= 2 && failureRate >= 0.5) {
    warnings.push({
      code: "READING_LIST_REVIEW_HIGH_FAILURE_RATE",
      stage: "review",
      message: `${excluded}/${attempted} 篇已尝试论文未能通过 Review。`,
      severity: "warning"
    });
  }
  if (accepted > 0 && accepted < target) {
    warnings.push({
      code: "READING_LIST_REVIEW_BELOW_TARGET",
      stage: "review",
      message: `候选池耗尽后仅有 ${accepted}/${target} 篇论文通过 Review，将按实际合格数量继续。`,
      severity: "warning"
    });
  }
  return warnings;
};

export const reviewWeeklyReportPapers = async (evidenced, context = {}, {
  callModel,
  buildContext = (paper) => buildContextPacketFromLegacyPaper(paper),
  networkRetryDelayMs = 50
} = {}) => {
  assertExecutionContext(context);

  if (!evidenced || evidenced.nextStage !== "review") {
    throw new TypeError("A completed extract_evidence result is required before review.");
  }
  if (typeof callModel !== "function") {
    throw new TypeError("review callModel is required.");
  }

  const stageStartedAt = Date.now();
  const target = Math.max(1, Number(evidenced.evidenceResult?.targetEligibleCount) || 1);
  const concurrency = Math.min(Math.max(
    Math.trunc(Number(evidenced.options?.paperConcurrency) || 2),
    1
  ), 5);
  const reserveCandidates = Array.isArray(evidenced.candidatePool?.reserveCandidates)
    ? evidenced.candidatePool.reserveCandidates
    : [];
  let reserveCursor = Math.max(0, Number(evidenced.evidenceResult?.reserveAttempted) || 0);
  let callSequence = 0;
  let counts = { ...evidenced.counts };
  const reviewItems = [];
  const excluded = [];
  const processingFailed = [];
  const refillContextEligible = [];
  const refillContextExcluded = [];
  const refillEvidenceSucceeded = [];
  const refillEvidenceExcluded = [];
  const administratorWarnings = [];

  await context.updateStage("review", { counts, warnings: evidenced.warnings || [] });
  await context.recordTrace({
    type: "stage_started",
    stage: "review",
    scope: "job",
    concurrency,
    queued: evidenced.evidenceItems.length,
    reserveRemaining: Math.max(0, reserveCandidates.length - reserveCursor)
  });

  const persistCall = async (record) => {
    const sequence = callSequence;
    callSequence += 1;
    await context.writeTrace(
      `review-call-${String(sequence).padStart(4, "0")}`,
      record
    );
    await context.recordTrace({
      type: record.error ? "model_call_failed" : "model_call_completed",
      stage: "review",
      scope: "paper",
      role: record.role,
      paperId: record.paperId,
      attemptType: record.attemptType,
      durationMs: record.durationMs,
      validation: record.validation,
      error: record.error
    });
  };

  const recordAgentEvent = async (event, extra = {}) => {
    const normalizedEvent = { ...event, ...extra };
    if (event?.type === "evidence_challenged") {
      administratorWarnings.push({
        code: "READING_LIST_EVIDENCE_CHALLENGED_BY_REVIEW",
        stage: "review",
        paperId: String(event.paperId || ""),
        message: `Review 发现论文 ${String(event.paperId || "")} 的 Evidence 可能误读原文，已触发一次定向修正。`,
        severity: "warning"
      });
    }
    await context.recordTrace(normalizedEvent);
  };

  const runReview = async (items) => {
    if (!items.length) {
      return;
    }
    const result = await reviewEvidenceBatch(items, {
      paperConcurrency: concurrency,
      callModel,
      signal: context.signal,
      networkRetryDelayMs,
      onCall: persistCall,
      onEvent: recordAgentEvent
    });
    reviewItems.push(...result.succeeded);
    excluded.push(...result.excluded.map((item) => ({ ...item, failedStage: "review" })));
    processingFailed.push(...result.processingFailed.map((item) => ({ ...item, failedStage: "review" })));
    counts = {
      ...counts,
      reviewed: reviewItems.length,
      excluded: counts.excluded + result.excluded.length
    };
  };

  try {
    await runReview(evidenced.evidenceItems);

    while (reviewItems.length < target && reserveCursor < reserveCandidates.length) {
      const needed = target - reviewItems.length;
      const batchSize = Math.min(concurrency, needed, reserveCandidates.length - reserveCursor);
      const batch = reserveCandidates.slice(reserveCursor, reserveCursor + batchSize);
      const refillOffset = reserveCursor;
      reserveCursor += batch.length;

      await context.recordTrace({
        type: "refill_requested",
        stage: "review",
        scope: "job",
        reason: "review_below_target",
        requested: batch.length,
        reserveRemaining: Math.max(0, reserveCandidates.length - reserveCursor)
      });
      const refillContext = await prepareContextCandidates({
        primaryCandidates: batch,
        reserveCandidates: [],
        minEligibleCount: batch.length,
        paperConcurrency: concurrency,
        buildContext,
        signal: context.signal,
        onEvent: (event) => context.recordTrace({
          ...event,
          type: event.type === "context_accepted"
            ? "refill_context_accepted"
            : "refill_context_excluded",
          stage: "review",
          refillStage: "prepare_context",
          origin: "reserve",
          reserveIndex: refillOffset
        })
      });
      const contextEligible = refillContext.eligible.map((item) => ({ ...item, origin: "reserve" }));
      const contextExcluded = refillContext.excluded.map((item) => ({
        ...item,
        origin: "reserve",
        failedStage: "prepare_context"
      }));
      refillContextEligible.push(...contextEligible);
      refillContextExcluded.push(...contextExcluded);
      excluded.push(...contextExcluded);
      counts = {
        ...counts,
        fullTextEligible: counts.fullTextEligible + contextEligible.length,
        excluded: counts.excluded + contextExcluded.length
      };

      const evidenceResult = await extractEvidenceBatch(contextEligible, {
        paperConcurrency: concurrency,
        callModel,
        signal: context.signal,
        networkRetryDelayMs,
        onCall: persistCall,
        onEvent: (event) => recordAgentEvent(event, {
          stage: "review",
          refillStage: "extract_evidence"
        })
      });
      refillEvidenceSucceeded.push(...evidenceResult.succeeded);
      processingFailed.push(...evidenceResult.processingFailed.map((item) => ({
        ...item,
        failedStage: "extract_evidence"
      })));
      const evidenceFailures = evidenceResult.excluded.map((item) => ({
        ...item,
        failedStage: "extract_evidence"
      }));
      refillEvidenceExcluded.push(...evidenceFailures);
      excluded.push(...evidenceFailures);
      counts = {
        ...counts,
        excluded: counts.excluded + evidenceFailures.length
      };
      await context.updateStage("review", { counts });
      await runReview(evidenceResult.succeeded);
    }
  } catch (error) {
    if (error?.name === "AbortError" || context.signal?.aborted) {
      await context.recordTrace({
        type: "stage_cancelled",
        stage: "review",
        scope: "job",
        durationMs: elapsed(stageStartedAt),
        reason: "admin_cancelled"
      });
    }
    throw error;
  }

  const warnings = [
    ...(Array.isArray(evidenced.warnings) ? evidenced.warnings : []),
    ...administratorWarnings,
    ...reviewStageWarnings({
      attempted: reviewItems.length + excluded.length + processingFailed.length,
      excluded: excluded.length,
      accepted: reviewItems.length,
      target
    }),
    ...processingFailed.map((item) => ({
      code: "READING_LIST_REVIEW_PROCESSING_FAILED",
      stage: String(item.failedStage || "review"),
      paperId: String(item?.contextPacket?.paperId || item?.paper?.id || ""),
      message: "该论文的模型调用在自动重试后仍未完成，已继续处理其它论文。",
      severity: "warning"
    }))
  ];
  const reviewResult = {
    targetReviewedCount: target,
    attempted: reviewItems.length + excluded.length + processingFailed.length,
    concurrency,
    reserveAttempted: reserveCursor,
    reserveRemaining: Math.max(0, reserveCandidates.length - reserveCursor),
    underTarget: reviewItems.length < target,
    succeeded: reviewItems,
    excluded,
    processingFailed
  };
  const refill = {
    contextEligible: refillContextEligible,
    contextExcluded: refillContextExcluded,
    evidenceSucceeded: refillEvidenceSucceeded,
    evidenceExcluded: refillEvidenceExcluded
  };

  await context.writeTrace("review-artifacts", {
    ...reviewResult,
    refill,
    warnings
  });
  await context.updateStage("review", { counts, warnings });
  await context.recordTrace({
    type: "stage_completed",
    stage: "review",
    scope: "job",
    durationMs: elapsed(stageStartedAt),
    counts,
    warnings,
    decision: reviewItems.length ? "continue" : "reject"
  });

  if (!reviewItems.length) {
    const error = new WeeklyReportOrchestratorError(
      "没有任何论文通过 Evidence 复核与 Review，本次周报任务已拒绝。",
      {
        code: "READING_LIST_NO_REVIEWED_PAPERS",
        stage: "review",
        retryable: false,
        traceId: context.traceId,
        detail: "primary 和 reserve 候选均已耗尽，没有论文形成可信的 Review 结果。",
        rejectJob: true
      }
    );
    await context.recordTrace({
      type: "reject_requested",
      stage: "review",
      scope: "job",
      code: error.code,
      reason: error.detail
    });
    throw error;
  }

  return {
    ...evidenced,
    nextStage: "calibrate",
    reviewItems,
    reviewResult,
    refill,
    counts,
    warnings
  };
};

const paperIdForStage = (item = {}) => String(
  item?.reviewResult?.paperId
  || item?.contextPacket?.paperId
  || item?.paper?.id
  || ""
).trim();

const calibrationErrorRecord = (error, paperId = "") => ({
  code: String(error?.code || "READING_LIST_CALIBRATION_FAILED"),
  message: String(error?.message || "Calibration failed."),
  stage: String(error?.stage || "calibrate"),
  paperId: String(error?.paperId || paperId || ""),
  retryable: Boolean(error?.retryable),
  excludePaper: error?.excludePaper !== false,
  issues: Array.isArray(error?.issues) ? error.issues : []
});

const uniqueWarnings = (warnings) => {
  const seen = new Set();
  return warnings.filter((warning) => {
    const key = `${warning?.code}|${warning?.paperId}|${warning?.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const calibrateWeeklyReportPapers = async (reviewed, context = {}, {
  callModel,
  buildContext = (paper) => buildContextPacketFromLegacyPaper(paper),
  networkRetryDelayMs = 50
} = {}) => {
  assertExecutionContext(context);

  if (!reviewed || reviewed.nextStage !== "calibrate") {
    throw new TypeError("A completed review result is required before calibrate.");
  }
  if (typeof callModel !== "function") {
    throw new TypeError("calibrate callModel is required.");
  }

  const stageStartedAt = Date.now();
  const target = Math.max(1, Number(reviewed.reviewResult?.targetReviewedCount) || 1);
  const concurrency = Math.min(Math.max(
    Math.trunc(Number(reviewed.options?.paperConcurrency) || 2),
    1
  ), 5);
  const calibrationMaximum = Math.min(Math.max(
    Math.trunc(Number(reviewed.options?.calibrationMaxPapers) || 30),
    1
  ), 30);
  const manualExcludedPaperIds = [...new Set((Array.isArray(reviewed.manualExcludedPaperIds)
    ? reviewed.manualExcludedPaperIds
    : []).map((paperId) => String(paperId || "").replace(/v\d+$/i, "")).filter(Boolean))];
  const manuallyExcluded = new Set(manualExcludedPaperIds);
  const reserveCandidates = (Array.isArray(reviewed.candidatePool?.reserveCandidates)
    ? reviewed.candidatePool.reserveCandidates
    : []).filter((item) => !manuallyExcluded.has(paperIdForStage(item).replace(/v\d+$/i, "")));
  let reserveCursor = Math.max(0, Number(reviewed.reviewResult?.reserveAttempted) || 0);
  let callSequence = 0;
  let counts = { ...reviewed.counts };
  let rereviewedPaperIds = [];
  const allExcluded = [];
  const cycles = [];
  const administratorWarnings = manualExcludedPaperIds.map((paperId) => ({
    code: "READING_LIST_ADMIN_SKIPPED_PAPER",
    stage: "calibrate",
    paperId,
    message: `管理员已跳过论文 ${paperId}，重新执行横向校准及后续阶段。`,
    severity: "warning"
  }));
  const refillContextEligible = [];
  const refillContextExcluded = [];
  const refillEvidenceSucceeded = [];
  const refillEvidenceExcluded = [];
  const refillReviewSucceeded = [];
  const refillReviewExcluded = [];

  const ranked = [...reviewed.reviewItems]
    .filter((item) => !manuallyExcluded.has(paperIdForStage(item).replace(/v\d+$/i, "")))
    .sort((left, right) => (
    Number(right?.reviewResult?.rawScore || 0) - Number(left?.reviewResult?.rawScore || 0)
    || paperIdForStage(left).localeCompare(paperIdForStage(right))
    ));
  let calibrationPool = ranked.slice(0, calibrationMaximum);
  const deferred = ranked.slice(calibrationMaximum).map((item) => ({
    ...item,
    deferredReason: "deferred_by_calibration_limit"
  }));
  counts = {
    ...counts,
    excluded: counts.excluded + deferred.length
  };

  await context.updateStage("calibrate", { counts, warnings: reviewed.warnings || [] });
  await context.recordTrace({
    type: "stage_started",
    stage: "calibrate",
    scope: "job",
    batchSize: calibrationPool.length,
    maximumBatchSize: calibrationMaximum,
    deferred: deferred.length,
    reserveRemaining: Math.max(0, reserveCandidates.length - reserveCursor)
  });

  const persistCall = async (record) => {
    const sequence = callSequence;
    callSequence += 1;
    await context.writeTrace(
      `calibration-call-${String(sequence).padStart(4, "0")}`,
      record
    );
    await context.recordTrace({
      type: record.error ? "model_call_failed" : "model_call_completed",
      stage: "calibrate",
      scope: record.paperId ? "paper" : "job",
      role: record.role,
      paperId: record.paperId,
      attemptType: record.attemptType,
      durationMs: record.durationMs,
      validation: record.validation,
      error: record.error
    });
  };

  const recordAgentEvent = async (event, extra = {}) => {
    const normalized = { ...event, ...extra };
    if (event?.type === "targeted_rereview_requested") {
      administratorWarnings.push({
        code: "READING_LIST_CALIBRATION_TARGETED_REREVIEW",
        stage: "calibrate",
        paperId: String(event.paperId || ""),
        message: `Calibration 发现论文 ${String(event.paperId || "")} 的相对评分可能误判，已触发一次定向 Review。`,
        severity: "warning"
      });
    }
    if (event?.type === "calibration_unresolved") {
      administratorWarnings.push({
        code: "READING_LIST_CALIBRATION_UNRESOLVED",
        stage: "calibrate",
        paperId: String(event.paperId || ""),
        message: `论文 ${String(event.paperId || "")} 定向 Review 后仍无法通过横向校准，已排除并尝试增补。`,
        severity: "warning"
      });
    }
    await context.recordTrace(normalized);
  };

  const refillEarlierStages = async () => {
    const needed = target - calibrationPool.length;
    if (needed <= 0 || reserveCursor >= reserveCandidates.length) {
      return;
    }
    const batchSize = Math.min(concurrency, needed, reserveCandidates.length - reserveCursor);
    const batch = reserveCandidates.slice(reserveCursor, reserveCursor + batchSize);
    const refillOffset = reserveCursor;
    reserveCursor += batch.length;
    await context.recordTrace({
      type: "refill_requested",
      stage: "calibrate",
      scope: "job",
      reason: "calibration_below_target",
      requested: batch.length,
      reserveRemaining: Math.max(0, reserveCandidates.length - reserveCursor)
    });

    const contextResult = await prepareContextCandidates({
      primaryCandidates: batch,
      reserveCandidates: [],
      minEligibleCount: batch.length,
      paperConcurrency: concurrency,
      buildContext,
      signal: context.signal,
      onEvent: (event) => context.recordTrace({
        ...event,
        type: event.type === "context_accepted"
          ? "refill_context_accepted"
          : "refill_context_excluded",
        stage: "calibrate",
        refillStage: "prepare_context",
        origin: "reserve",
        reserveIndex: refillOffset
      })
    });
    const contextEligible = contextResult.eligible.map((item) => ({ ...item, origin: "reserve" }));
    const contextExcluded = contextResult.excluded.map((item) => ({
      ...item,
      origin: "reserve",
      failedStage: "prepare_context"
    }));
    refillContextEligible.push(...contextEligible);
    refillContextExcluded.push(...contextExcluded);
    allExcluded.push(...contextExcluded);
    counts = {
      ...counts,
      fullTextEligible: counts.fullTextEligible + contextEligible.length,
      excluded: counts.excluded + contextExcluded.length
    };

    const evidenceResult = await extractEvidenceBatch(contextEligible, {
      paperConcurrency: concurrency,
      callModel,
      signal: context.signal,
      networkRetryDelayMs,
      onCall: persistCall,
      onEvent: (event) => recordAgentEvent(event, {
        stage: "calibrate",
        refillStage: "extract_evidence"
      })
    });
    refillEvidenceSucceeded.push(...evidenceResult.succeeded);
    const evidenceExcluded = evidenceResult.excluded.map((item) => ({
      ...item,
      failedStage: "extract_evidence"
    }));
    refillEvidenceExcluded.push(...evidenceExcluded);
    allExcluded.push(...evidenceExcluded);
    counts = {
      ...counts,
      excluded: counts.excluded + evidenceExcluded.length
    };

    const reviewResult = await reviewEvidenceBatch(evidenceResult.succeeded, {
      paperConcurrency: concurrency,
      callModel,
      signal: context.signal,
      networkRetryDelayMs,
      onCall: persistCall,
      onEvent: (event) => recordAgentEvent(event, {
        stage: "calibrate",
        refillStage: "review"
      })
    });
    refillReviewSucceeded.push(...reviewResult.succeeded);
    const reviewExcluded = reviewResult.excluded.map((item) => ({
      ...item,
      failedStage: "review"
    }));
    refillReviewExcluded.push(...reviewExcluded);
    allExcluded.push(...reviewExcluded);
    counts = {
      ...counts,
      reviewed: counts.reviewed + reviewResult.succeeded.length,
      excluded: counts.excluded + reviewExcluded.length
    };
    calibrationPool.push(...reviewResult.succeeded);
    await context.updateStage("calibrate", { counts });
  };

  try {
    while (true) {
      if (calibrationPool.length) {
        let cycle;
        try {
          cycle = await calibrateReviewBatch(calibrationPool, {
            calibrationMaxPapers: calibrationMaximum,
            paperConcurrency: concurrency,
            callModel,
            signal: context.signal,
            networkRetryDelayMs,
            rereviewedPaperIds,
            onCall: persistCall,
            onEvent: recordAgentEvent
          });
        } catch (error) {
          if (error?.name === "AbortError" || context.signal?.aborted) {
            throw error;
          }
          const failed = calibrationPool.map((item) => ({
            ...item,
            failedStage: "calibrate",
            error: calibrationErrorRecord(error, paperIdForStage(item))
          }));
          allExcluded.push(...failed);
          counts = {
            ...counts,
            excluded: counts.excluded + failed.length
          };
          cycles.push({
            inputPaperIds: calibrationPool.map(paperIdForStage),
            succeeded: [],
            excluded: failed,
            error: calibrationErrorRecord(error)
          });
          calibrationPool = [];
          await context.recordTrace({
            type: "calibration_batch_excluded",
            stage: "calibrate",
            code: error?.code || "READING_LIST_CALIBRATION_FAILED",
            paperIds: failed.map(paperIdForStage)
          });
        }

        if (cycle) {
          allExcluded.push(...cycle.excluded);
          counts = {
            ...counts,
            excluded: counts.excluded + cycle.excluded.length
          };
          rereviewedPaperIds = cycle.rereviewedPaperIds;
          cycles.push({
            inputPaperIds: calibrationPool.map(paperIdForStage),
            succeeded: cycle.succeeded,
            excluded: cycle.excluded,
            initialResults: cycle.initialResults,
            confirmationResults: cycle.confirmationResults,
            rereviewedPaperIds: cycle.rereviewedPaperIds
          });
          calibrationPool = cycle.succeeded;
        }
      }

      if (calibrationPool.length >= target || reserveCursor >= reserveCandidates.length) {
        break;
      }
      await refillEarlierStages();
    }
  } catch (error) {
    if (error?.name === "AbortError" || context.signal?.aborted) {
      await context.recordTrace({
        type: "stage_cancelled",
        stage: "calibrate",
        scope: "job",
        durationMs: elapsed(stageStartedAt),
        reason: "admin_cancelled"
      });
    }
    throw error;
  }

  counts = { ...counts, calibrated: calibrationPool.length };
  const stageWarnings = [];
  if (calibrationPool.length > 0 && calibrationPool.length < target) {
    stageWarnings.push({
      code: "READING_LIST_CALIBRATION_BELOW_TARGET",
      stage: "calibrate",
      message: `候选池耗尽后仅有 ${calibrationPool.length}/${target} 篇论文完成校准，将按实际合格数量继续。`,
      severity: "warning"
    });
  }
  if (deferred.length) {
    stageWarnings.push({
      code: "READING_LIST_CALIBRATION_LIMIT_DEFERRED",
      stage: "calibrate",
      message: `${deferred.length} 篇论文因单批 30 篇上限被延后，不进入本次发布。`,
      severity: "warning"
    });
  }
  const warnings = uniqueWarnings([
    ...(Array.isArray(reviewed.warnings) ? reviewed.warnings : []),
    ...administratorWarnings,
    ...stageWarnings
  ]);
  const calibrationResult = {
    targetCalibratedCount: target,
    maximumBatchSize: calibrationMaximum,
    reserveAttempted: reserveCursor,
    reserveRemaining: Math.max(0, reserveCandidates.length - reserveCursor),
    underTarget: calibrationPool.length < target,
    succeeded: calibrationPool,
    excluded: allExcluded,
    deferred,
    cycles,
    rereviewedPaperIds
  };
  const refill = {
    contextEligible: refillContextEligible,
    contextExcluded: refillContextExcluded,
    evidenceSucceeded: refillEvidenceSucceeded,
    evidenceExcluded: refillEvidenceExcluded,
    reviewSucceeded: refillReviewSucceeded,
    reviewExcluded: refillReviewExcluded
  };

  await context.writeTrace("calibration-artifacts", {
    ...calibrationResult,
    refill,
    warnings
  });
  await context.updateStage("calibrate", { counts, warnings });
  await context.recordTrace({
    type: "stage_completed",
    stage: "calibrate",
    scope: "job",
    durationMs: elapsed(stageStartedAt),
    counts,
    warnings,
    decision: calibrationPool.length ? "continue" : "reject"
  });

  if (!calibrationPool.length) {
    const error = new WeeklyReportOrchestratorError(
      "没有任何论文完成横向校准，本次周报任务已拒绝。",
      {
        code: "READING_LIST_NO_CALIBRATED_PAPERS",
        stage: "calibrate",
        retryable: false,
        traceId: context.traceId,
        detail: "候选与 reserve 均已耗尽，没有论文形成收敛的 calibrationResult。",
        rejectJob: true
      }
    );
    await context.recordTrace({
      type: "reject_requested",
      stage: "calibrate",
      scope: "job",
      code: error.code,
      reason: error.detail
    });
    throw error;
  }

  return {
    ...reviewed,
    nextStage: "select",
    calibratedItems: calibrationPool,
    calibrationResult,
    deferred,
    refill,
    counts,
    warnings
  };
};

export const selectWeeklyReportPapers = async (calibrated, context = {}) => {
  assertExecutionContext(context);

  if (!calibrated || calibrated.nextStage !== "select") {
    throw new TypeError("A completed calibrate result is required before select.");
  }

  const stageStartedAt = Date.now();
  const threshold = normalizedReviewScoreThreshold(calibrated.reviewScoreThreshold);
  await context.updateStage("select", {
    counts: calibrated.counts,
    warnings: calibrated.warnings || []
  });
  await context.recordTrace({
    type: "stage_started",
    stage: "select",
    scope: "job",
    candidateCount: calibrated.calibratedItems.length,
    threshold,
    minSelectedCount: calibrated.options?.minSelectedCount,
    maxSelectedCount: calibrated.options?.maxSelectedCount
  });

  const selection = selectCalibratedPapers(calibrated.calibratedItems, {
    threshold,
    minSelectedCount: calibrated.options?.minSelectedCount,
    maxSelectedCount: calibrated.options?.maxSelectedCount
  });
  const counts = {
    ...calibrated.counts,
    selected: selection.selected.length,
    excluded: calibrated.counts.excluded
      + selection.notSelected.length
      + selection.ineligible.length
  };
  const selectionWarnings = [];

  if (selection.selected.length > 0 && selection.selected.length < selection.requestedMinSelectedCount) {
    selectionWarnings.push({
      code: "READING_LIST_SELECTION_BELOW_TARGET",
      stage: "select",
      message: `最终只有 ${selection.selected.length}/${selection.requestedMinSelectedCount} 篇论文可入选，将按实际合格数量继续。`,
      severity: "warning"
    });
  }
  const warnings = uniqueWarnings([
    ...(Array.isArray(calibrated.warnings) ? calibrated.warnings : []),
    ...selectionWarnings
  ]);
  const selectionResult = {
    ...selection,
    selectedPaperIds: selection.selected.map(paperIdForStage),
    notSelectedPaperIds: selection.notSelected.map(paperIdForStage),
    ineligiblePaperIds: selection.ineligible.map(paperIdForStage)
  };

  await context.writeTrace("selection-artifacts", selectionResult);
  await context.updateStage("select", { counts, warnings });
  await context.recordTrace({
    type: "stage_completed",
    stage: "select",
    scope: "job",
    durationMs: elapsed(stageStartedAt),
    counts,
    threshold,
    thresholdSelectedCount: selection.thresholdSelectedCount,
    fallbackCount: selection.fallbackCount,
    decision: selection.selected.length ? "continue" : "reject"
  });

  if (!selection.selected.length) {
    const error = new WeeklyReportOrchestratorError(
      "没有任何已校准论文满足最终 Selection 安全条件，本次周报任务已拒绝。",
      {
        code: "READING_LIST_NO_SELECTED_PAPERS",
        stage: "select",
        retryable: false,
        traceId: context.traceId,
        detail: "Selection 只接受 Evidence 已通过且 calibrationResult 已收敛的论文。",
        rejectJob: true
      }
    );
    await context.recordTrace({
      type: "reject_requested",
      stage: "select",
      scope: "job",
      code: error.code,
      reason: error.detail
    });
    throw error;
  }

  return {
    ...calibrated,
    nextStage: "editorial_plan",
    selectedItems: selection.selected,
    selectionResult,
    counts,
    warnings
  };
};

export const planWeeklyReportEditorial = async (selected, context = {}, {
  callModel,
  networkRetryDelayMs = 50
} = {}) => {
  assertExecutionContext(context);

  if (!selected || selected.nextStage !== "editorial_plan") {
    throw new TypeError("A completed select result is required before editorial_plan.");
  }
  if (typeof callModel !== "function") {
    throw new TypeError("editorial_plan callModel is required.");
  }

  const stageStartedAt = Date.now();
  let callSequence = 0;
  await context.updateStage("editorial_plan", {
    counts: selected.counts,
    warnings: selected.warnings || []
  });
  await context.recordTrace({
    type: "stage_started",
    stage: "editorial_plan",
    scope: "job",
    selectedPaperIds: selected.selectedItems.map(paperIdForStage)
  });

  const persistCall = async (record) => {
    const sequence = callSequence;
    callSequence += 1;
    await context.writeTrace(
      `editorial-call-${String(sequence).padStart(4, "0")}`,
      record
    );
    await context.recordTrace({
      type: record.error ? "model_call_failed" : "model_call_completed",
      stage: "editorial_plan",
      scope: "job",
      role: record.role,
      paperId: "",
      attemptType: record.attemptType,
      durationMs: record.durationMs,
      validation: record.validation,
      error: record.error
    });
  };

  try {
    const result = await runEditorialPlanAgent({
      selectedItems: selected.selectedItems,
      callModel,
      signal: context.signal,
      networkRetryDelayMs,
      onCall: persistCall,
      onEvent: (event) => context.recordTrace(event),
      onRepairExhausted: typeof context.requestManualReview === "function"
        ? ({ issues, repairAttempts, paperId, relatedPaperIds }) => context.requestManualReview({
          stage: "editorial_plan",
          paperId,
          relatedPaperIds,
          summary: "编辑计划在三次自动修正后仍未通过证据和结构检查。",
          issues,
          repairAttempts,
          allowedActions: ["continue_repair", "exit_task", ...(paperId || relatedPaperIds?.length ? ["skip_paper"] : [])]
        })
        : undefined
    });

    await context.writeTrace("editorial-plan", result.editorialPlan);
    await context.updateStage("editorial_plan", {
      counts: selected.counts,
      warnings: selected.warnings || []
    });
    await context.recordTrace({
      type: "stage_completed",
      stage: "editorial_plan",
      scope: "job",
      durationMs: elapsed(stageStartedAt),
      selectedPaperIds: selected.selectedItems.map(paperIdForStage),
      repairAttempted: result.repairAttempted,
      responseRepairAttempted: result.responseRepairAttempted,
      decision: "continue"
    });

    return {
      ...selected,
      nextStage: "write_paper_sections",
      editorialPlan: result.editorialPlan,
      editorialResult: result
    };
  } catch (error) {
    if (error?.name === "AbortError" || context.signal?.aborted) {
      await context.recordTrace({
        type: "stage_cancelled",
        stage: "editorial_plan",
        scope: "job",
        durationMs: elapsed(stageStartedAt),
        reason: "admin_cancelled"
      });
      throw error;
    }

    if (error?.code === "READING_LIST_ADMIN_SKIPPED_PAPER" && String(error?.paperId || "").trim()) {
      const paperId = String(error.paperId).trim();
      await context.recordTrace({
        type: "paper_skipped_by_administrator",
        stage: "editorial_plan",
        scope: "paper",
        paperId,
        relatedPaperIds: Array.isArray(error.relatedPaperIds) ? error.relatedPaperIds : [],
        repairAttempts: Number(error.repairAttempts) || 0,
        issues: Array.isArray(error.issues) ? error.issues : []
      });
      return {
        ...selected,
        nextStage: "calibrate",
        counts: selected.counts ? { ...selected.counts, selected: 0 } : selected.counts,
        manualExcludedPaperIds: [...new Set([
          ...(Array.isArray(selected.manualExcludedPaperIds) ? selected.manualExcludedPaperIds : []),
          paperId
        ])]
      };
    }

    const rejected = error instanceof WeeklyReportOrchestratorError
      ? error
      : new WeeklyReportOrchestratorError(
        "Editorial Plan failed its evidence and structure validation.",
        {
          code: error?.code || "READING_LIST_EDITORIAL_PLAN_FAILED",
          stage: "editorial_plan",
          retryable: false,
          traceId: context.traceId,
          detail: error?.message || "Editorial Plan failed.",
          rejectJob: true
        }
      );
    await context.recordTrace({
      type: "stage_failed",
      stage: "editorial_plan",
      scope: "job",
      durationMs: elapsed(stageStartedAt),
      code: rejected.code,
      reason: rejected.detail,
      issues: Array.isArray(error?.issues) ? error.issues : []
    });
    await context.recordTrace({
      type: "reject_requested",
      stage: "editorial_plan",
      scope: "job",
      code: rejected.code,
      reason: rejected.detail
    });
    throw rejected;
  }
};

export const writeWeeklyReportPaperSections = async (planned, context = {}, {
  callModel,
  networkRetryDelayMs = 50
} = {}) => {
  assertExecutionContext(context);

  if (!planned || planned.nextStage !== "write_paper_sections") {
    throw new TypeError("A completed editorial_plan result is required before write_paper_sections.");
  }
  if (typeof callModel !== "function") {
    throw new TypeError("write_paper_sections callModel is required.");
  }

  const stageStartedAt = Date.now();
  const concurrency = Math.min(Math.max(
    Math.trunc(Number(planned.options?.paperConcurrency) || 2),
    1
  ), 5);
  let callSequence = 0;
  await context.updateStage("write_paper_sections", {
    counts: planned.counts,
    warnings: planned.warnings || []
  });
  await context.recordTrace({
    type: "stage_started",
    stage: "write_paper_sections",
    scope: "job",
    concurrency,
    queued: planned.selectedItems.length,
    selectedPaperIds: planned.selectedItems.map(paperIdForStage)
  });

  const persistCall = async (record) => {
    const sequence = callSequence;
    callSequence += 1;
    await context.writeTrace(
      `paper-writer-call-${String(sequence).padStart(4, "0")}`,
      record
    );
    await context.recordTrace({
      type: record.error ? "model_call_failed" : "model_call_completed",
      stage: "write_paper_sections",
      scope: "paper",
      role: record.role,
      paperId: record.paperId,
      attemptType: record.attemptType,
      durationMs: record.durationMs,
      validation: record.validation,
      error: record.error
    });
  };

  let result;
  try {
    result = await writePaperSectionsBatch(planned.selectedItems, {
      paperConcurrency: concurrency,
      callModel,
      signal: context.signal,
      networkRetryDelayMs,
      onCall: persistCall,
      onEvent: (event) => context.recordTrace(event)
    });
  } catch (error) {
    if (error?.name === "AbortError" || context.signal?.aborted) {
      await context.recordTrace({
        type: "stage_cancelled",
        stage: "write_paper_sections",
        scope: "job",
        durationMs: elapsed(stageStartedAt),
        reason: "admin_cancelled"
      });
    }
    throw error;
  }

  const artifact = {
    concurrency: result.concurrency,
    attempted: result.attempted,
    succeeded: result.succeeded.map((entry) => ({
      paperId: entry.paperDraft.paperId,
      paperDraft: entry.paperDraft,
      repairAttempted: entry.repairAttempted,
      responseRepairAttempted: entry.responseRepairAttempted
    })),
    failed: result.failed.map((entry) => ({
      paperId: paperIdForStage(entry.item),
      error: entry.error
    }))
  };
  await context.writeTrace("paper-drafts", artifact);

  if (result.failed.length) {
    const firstFailure = result.failed[0];
    const rejected = new WeeklyReportOrchestratorError(
      "At least one selected paper failed Paper Section writing.",
      {
        code: firstFailure.error.code || "READING_LIST_PAPER_SECTION_FAILED",
        stage: "write_paper_sections",
        paperId: firstFailure.error.paperId || paperIdForStage(firstFailure.item),
        retryable: false,
        traceId: context.traceId,
        detail: firstFailure.error.message || "A selected paper did not produce a valid paperDraft.",
        rejectJob: true
      }
    );
    await context.recordTrace({
      type: "stage_failed",
      stage: "write_paper_sections",
      scope: "job",
      durationMs: elapsed(stageStartedAt),
      code: rejected.code,
      paperId: rejected.paperId,
      failedPaperIds: result.failed.map((entry) => paperIdForStage(entry.item)),
      reason: rejected.detail
    });
    await context.recordTrace({
      type: "reject_requested",
      stage: "write_paper_sections",
      scope: "job",
      code: rejected.code,
      paperId: rejected.paperId,
      reason: rejected.detail
    });
    throw rejected;
  }

  const paperDrafts = result.succeeded.map((entry) => entry.paperDraft);
  await context.updateStage("write_paper_sections", {
    counts: planned.counts,
    warnings: planned.warnings || []
  });
  await context.recordTrace({
    type: "stage_completed",
    stage: "write_paper_sections",
    scope: "job",
    durationMs: elapsed(stageStartedAt),
    concurrency,
    completed: paperDrafts.length,
    repairCount: result.succeeded.filter((entry) => entry.repairAttempted).length,
    decision: "continue"
  });

  return {
    ...planned,
    nextStage: "write_head_tail",
    paperDrafts,
    paperDraftResult: result
  };
};

export const writeWeeklyReportHeadTail = async (written, context = {}, {
  callModel,
  networkRetryDelayMs = 50
} = {}) => {
  assertExecutionContext(context);

  if (!written || written.nextStage !== "write_head_tail") {
    throw new TypeError("A completed write_paper_sections result is required before write_head_tail.");
  }
  if (typeof callModel !== "function") {
    throw new TypeError("write_head_tail callModel is required.");
  }

  const stageStartedAt = Date.now();
  let callSequence = 0;
  await context.updateStage("write_head_tail", {
    counts: written.counts,
    warnings: written.warnings || []
  });
  await context.recordTrace({
    type: "stage_started",
    stage: "write_head_tail",
    scope: "job",
    selectedPaperIds: written.selectedItems.map(paperIdForStage),
    trendCount: written.editorialPlan?.trends?.length || 0,
    observationCount: written.editorialPlan?.singlePaperObservations?.length || 0
  });

  const persistCall = async (record) => {
    const sequence = callSequence;
    callSequence += 1;
    await context.writeTrace(
      `head-tail-call-${String(sequence).padStart(4, "0")}`,
      record
    );
    await context.recordTrace({
      type: record.error ? "model_call_failed" : "model_call_completed",
      stage: "write_head_tail",
      scope: "job",
      role: record.role,
      paperId: "",
      attemptType: record.attemptType,
      durationMs: record.durationMs,
      validation: record.validation,
      error: record.error
    });
  };

  try {
    const result = await runHeadTailWriter({
      editorialPlan: written.editorialPlan,
      selectedItems: written.selectedItems,
      paperDrafts: written.paperDrafts,
      callModel,
      signal: context.signal,
      networkRetryDelayMs,
      onCall: persistCall,
      onEvent: (event) => context.recordTrace(event)
    });

    await context.writeTrace("head-tail-draft", result.headTailDraft);
    await context.updateStage("write_head_tail", {
      counts: written.counts,
      warnings: written.warnings || []
    });
    await context.recordTrace({
      type: "stage_completed",
      stage: "write_head_tail",
      scope: "job",
      durationMs: elapsed(stageStartedAt),
      repairAttempted: result.repairAttempted,
      responseRepairAttempted: result.responseRepairAttempted,
      decision: "continue"
    });

    return {
      ...written,
      nextStage: "assemble",
      headTailDraft: result.headTailDraft,
      headTailResult: result
    };
  } catch (error) {
    if (error?.name === "AbortError" || context.signal?.aborted) {
      await context.recordTrace({
        type: "stage_cancelled",
        stage: "write_head_tail",
        scope: "job",
        durationMs: elapsed(stageStartedAt),
        reason: "admin_cancelled"
      });
      throw error;
    }

    const rejected = error instanceof WeeklyReportOrchestratorError
      ? error
      : new WeeklyReportOrchestratorError(
        "Head/Tail writing failed its Editorial Plan validation.",
        {
          code: error?.code || "READING_LIST_HEAD_TAIL_FAILED",
          stage: "write_head_tail",
          retryable: false,
          traceId: context.traceId,
          detail: error?.message || "Head/Tail writing failed.",
          rejectJob: true
        }
      );
    await context.recordTrace({
      type: "stage_failed",
      stage: "write_head_tail",
      scope: "job",
      durationMs: elapsed(stageStartedAt),
      code: rejected.code,
      reason: rejected.detail,
      issues: Array.isArray(error?.issues) ? error.issues : []
    });
    await context.recordTrace({
      type: "reject_requested",
      stage: "write_head_tail",
      scope: "job",
      code: rejected.code,
      reason: rejected.detail
    });
    throw rejected;
  }
};

export const assembleWeeklyReport = async (completed, context = {}) => {
  assertExecutionContext(context);

  if (!completed || completed.nextStage !== "assemble") {
    throw new TypeError("A completed write_head_tail result is required before assemble.");
  }

  const stageStartedAt = Date.now();
  await context.updateStage("assemble", {
    counts: completed.counts,
    warnings: completed.warnings || []
  });
  await context.recordTrace({
    type: "stage_started",
    stage: "assemble",
    scope: "job",
    selectedPaperIds: completed.selectedItems.map(paperIdForStage)
  });

  if (context.signal?.aborted) {
    const error = new Error("Weekly report assembly was cancelled.");
    error.name = "AbortError";
    error.code = "ABORT_ERR";
    await context.recordTrace({
      type: "stage_cancelled",
      stage: "assemble",
      scope: "job",
      durationMs: elapsed(stageStartedAt),
      reason: "admin_cancelled"
    });
    throw error;
  }

  try {
    const result = assembleWeeklyReportMarkdown({
      reportMeta: completed.reportMeta,
      selectedItems: completed.selectedItems,
      paperDrafts: completed.paperDrafts,
      headTailDraft: completed.headTailDraft
    });
    await context.writeTrace("assembled-report", result);
    await context.updateStage("assemble", {
      counts: completed.counts,
      warnings: completed.warnings || []
    });
    await context.recordTrace({
      type: "stage_completed",
      stage: "assemble",
      scope: "job",
      durationMs: elapsed(stageStartedAt),
      markdownChars: result.markdown.length,
      paperCount: result.publishedPapers.length,
      decision: "continue"
    });
    return {
      ...completed,
      nextStage: "deterministic_qa",
      markdown: result.markdown,
      assemblyResult: result,
      publishedPapers: result.publishedPapers,
      publishReport: result.report,
      footerNote: result.footerNote
    };
  } catch (error) {
    if (error?.name === "AbortError" || context.signal?.aborted) {
      throw error;
    }
    const rejected = error instanceof WeeklyReportOrchestratorError
      ? error
      : new WeeklyReportOrchestratorError(
        "Weekly report artifacts could not be assembled into a valid publication structure.",
        {
          code: error?.code || "READING_LIST_ASSEMBLY_FAILED",
          stage: "assemble",
          paperId: error?.paperId || "",
          retryable: false,
          traceId: context.traceId,
          detail: error?.message || "Weekly report assembly failed.",
          rejectJob: true
        }
      );
    await context.recordTrace({
      type: "stage_failed",
      stage: "assemble",
      scope: "job",
      durationMs: elapsed(stageStartedAt),
      code: rejected.code,
      paperId: rejected.paperId,
      reason: rejected.detail,
      issues: Array.isArray(error?.issues) ? error.issues : []
    });
    await context.recordTrace({
      type: "reject_requested",
      stage: "assemble",
      scope: "job",
      code: rejected.code,
      paperId: rejected.paperId,
      reason: rejected.detail
    });
    throw rejected;
  }
};

export const runWeeklyReportDeterministicQa = async (assembled, context = {}) => {
  assertExecutionContext(context);

  if (!assembled || assembled.nextStage !== "deterministic_qa") {
    throw new TypeError("A completed assemble result is required before deterministic_qa.");
  }

  const stageStartedAt = Date.now();
  await context.updateStage("deterministic_qa", {
    counts: assembled.counts,
    warnings: assembled.warnings || []
  });
  await context.recordTrace({
    type: "stage_started",
    stage: "deterministic_qa",
    scope: "report",
    markdownChars: String(assembled.markdown || "").length,
    paperCount: assembled.publishedPapers?.length || 0,
    repairAttempted: Boolean(assembled.qaReport?.repairAttempted)
  });

  if (context.signal?.aborted) {
    const error = new Error("Weekly report deterministic QA was cancelled.");
    error.name = "AbortError";
    error.code = "ABORT_ERR";
    await context.recordTrace({
      type: "stage_cancelled",
      stage: "deterministic_qa",
      scope: "report",
      durationMs: elapsed(stageStartedAt),
      reason: "admin_cancelled"
    });
    throw error;
  }

  const repairCount = repairCountFor(assembled.qaReport);
  let qaReport;
  try {
    qaReport = runDeterministicQa({
      markdown: assembled.markdown,
      publishedPapers: assembled.publishedPapers,
      report: assembled.publishReport,
      footerNote: assembled.footerNote,
      repairAttempted: repairCount >= AUTOMATIC_CONTENT_REPAIR_LIMIT
    });
    qaReport = {
      ...qaReport,
      repairAttempted: repairCount > 0,
      repairCount,
      repairResults: Array.isArray(assembled.qaReport?.repairResults)
        ? assembled.qaReport.repairResults
        : [],
      finalIssues: qaReport.status === "passed" ? [] : qaReport.deterministicIssues
    };
  } catch (error) {
    const rejected = new WeeklyReportOrchestratorError(
      "Deterministic QA could not validate the assembled publication context.",
      {
        code: error?.code || "READING_LIST_DETERMINISTIC_QA_FAILED",
        stage: "deterministic_qa",
        retryable: false,
        traceId: context.traceId,
        detail: error?.message || "Deterministic QA failed.",
        rejectJob: true
      }
    );
    await context.recordTrace({
      type: "stage_failed",
      stage: "deterministic_qa",
      scope: "report",
      durationMs: elapsed(stageStartedAt),
      code: rejected.code,
      reason: rejected.detail
    });
    await context.recordTrace({
      type: "reject_requested",
      stage: "deterministic_qa",
      scope: "job",
      code: rejected.code,
      reason: rejected.detail
    });
    throw rejected;
  }

  await context.writeTrace("deterministic-qa", qaReport);
  if (qaReport.status === "passed") {
    await context.updateStage("deterministic_qa", {
      counts: assembled.counts,
      warnings: assembled.warnings || []
    });
    await context.recordTrace({
      type: "stage_completed",
      stage: "deterministic_qa",
      scope: "report",
      durationMs: elapsed(stageStartedAt),
      issueCount: 0,
      decision: "continue"
    });
    return {
      ...assembled,
      nextStage: "paper_semantic_qa",
      qaReport
    };
  }

  if (qaReport.status === "repair_required") {
    const repairWarning = {
      code: "READING_LIST_DETERMINISTIC_QA_REPAIR_REQUIRED",
      stage: "deterministic_qa",
      message: `确定性质量门发现 ${qaReport.deterministicIssues.length} 个问题，已进入唯一一次定向修正。`,
      severity: "warning"
    };
    const warnings = uniqueWarnings([...(assembled.warnings || []), repairWarning]);
    await context.updateStage("deterministic_qa", {
      counts: assembled.counts,
      warnings
    });
    await context.recordTrace({
      type: "repair_requested",
      stage: "deterministic_qa",
      scope: "report",
      issues: qaReport.deterministicIssues
    });
    await context.recordTrace({
      type: "stage_completed",
      stage: "deterministic_qa",
      scope: "report",
      durationMs: elapsed(stageStartedAt),
      issueCount: qaReport.deterministicIssues.length,
      decision: "repair"
    });
    return {
      ...assembled,
      nextStage: "repair_once",
      qaReport,
      warnings
    };
  }

  const detail = qaReport.deterministicIssues.slice(0, 5)
    .map((entry) => entry.message)
    .join("；") || "Deterministic QA remains invalid after repair.";
  await context.recordTrace({
    type: "stage_failed",
    stage: "deterministic_qa",
    scope: "report",
    durationMs: elapsed(stageStartedAt),
    code: "READING_LIST_DETERMINISTIC_QA_FAILED",
    issues: qaReport.deterministicIssues,
    reason: detail,
    decision: "manual_review"
  });
  return {
    ...assembled,
    nextStage: "manual_review",
    qaReport,
    manualReview: {
      stage: "deterministic_qa",
      paperId: "",
      summary: "确定性质量检查在三次自动修正后仍未通过。",
      issues: qaReport.deterministicIssues,
      repairAttempts: repairCount,
      allowedActions: ["continue_repair", "exit_task"]
    }
  };
};

export const runWeeklyReportPaperSemanticQa = async (checked, context = {}, {
  callModel,
  networkRetryDelayMs = 50
} = {}) => {
  assertExecutionContext(context);

  if (!checked || checked.nextStage !== "paper_semantic_qa") {
    throw new TypeError("A passed deterministic_qa result is required before paper_semantic_qa.");
  }
  if (checked.qaReport?.status !== "passed") {
    throw new TypeError("paper_semantic_qa requires a passed deterministic qaReport.");
  }
  if (typeof callModel !== "function") {
    throw new TypeError("paper_semantic_qa callModel is required.");
  }

  const stageStartedAt = Date.now();
  const concurrency = Math.min(Math.max(
    Math.trunc(Number(checked.options?.paperConcurrency) || 2),
    1
  ), 5);
  const selectedItems = Array.isArray(checked.selectedItems) ? checked.selectedItems : [];
  const paperDrafts = Array.isArray(checked.paperDrafts) ? checked.paperDrafts : [];
  const repairCount = repairCountFor(checked.qaReport);
  const traceSuffix = repairTraceSuffix(checked.qaReport);
  let callSequence = 0;

  await context.updateStage("paper_semantic_qa", {
    counts: checked.counts,
    warnings: checked.warnings || []
  });
  await context.recordTrace({
    type: "stage_started",
    stage: "paper_semantic_qa",
    scope: "job",
    concurrency,
    queued: selectedItems.length,
    selectedPaperIds: selectedItems.map(paperIdForStage),
    repairAttempted: Boolean(checked.qaReport?.repairAttempted)
  });

  const persistCall = async (record) => {
    const sequence = callSequence;
    callSequence += 1;
    await context.writeTrace(
      `paper-semantic-qa${traceSuffix}-call-${String(sequence).padStart(4, "0")}`,
      record
    );
    await context.recordTrace({
      type: record.error ? "model_call_failed" : "model_call_completed",
      stage: "paper_semantic_qa",
      scope: "paper",
      role: record.role,
      paperId: record.paperId,
      attemptType: record.attemptType,
      durationMs: record.durationMs,
      validation: record.validation,
      error: record.error
    });
  };

  let result;
  try {
    result = await reviewPaperSemanticsBatch(selectedItems, paperDrafts, {
      paperConcurrency: concurrency,
      requiredLanguage: checked.outputLanguage,
      callModel,
      signal: context.signal,
      networkRetryDelayMs,
      onCall: persistCall,
      onEvent: (event) => context.recordTrace(event)
    });
  } catch (error) {
    if (error?.name === "AbortError" || context.signal?.aborted) {
      await context.recordTrace({
        type: "stage_cancelled",
        stage: "paper_semantic_qa",
        scope: "job",
        durationMs: elapsed(stageStartedAt),
        reason: "admin_cancelled"
      });
    }
    throw error;
  }

  const paperSemanticResults = result.succeeded.map((entry) => entry.qaResult);
  const paperIssues = paperSemanticResults.flatMap((entry) => entry.issues);
  const baseArtifact = {
    concurrency: result.concurrency,
    attempted: result.attempted,
    paperSemanticResults,
    paperIssues,
    responseRepairCount: result.succeeded.filter((entry) => entry.responseRepairAttempted).length,
    failed: result.failed.map((entry) => ({
      paperId: paperIdForStage(entry.item),
      error: entry.error
    })),
    repairAttempted: Boolean(checked.qaReport?.repairAttempted)
  };

  if (result.failed.length) {
    const artifact = { ...baseArtifact, status: "failed" };
    await context.writeTrace(`paper-semantic-qa${traceSuffix}`, artifact);
    const firstFailure = result.failed[0];
    const failureCode = firstFailure.error.code || "READING_LIST_PAPER_QA_FAILED";
    const failedPaperId = firstFailure.error.paperId || paperIdForStage(firstFailure.item);
    const failureDetail = firstFailure.error.message || "Paper Semantic QA failed closed.";
    const isArtifactIdentityMismatch = Array.isArray(firstFailure.error.issues)
      && firstFailure.error.issues.some((issue) => issue?.code === "input_identity_mismatch");
    if (!isArtifactIdentityMismatch) {
      const rejected = new WeeklyReportOrchestratorError(
        "At least one selected paper could not complete semantic QA.",
        {
          code: failureCode,
          stage: "paper_semantic_qa",
          paperId: failedPaperId,
          retryable: false,
          traceId: context.traceId,
          detail: failureDetail,
          rejectJob: true
        }
      );
      await context.recordTrace({
        type: "stage_failed",
        stage: "paper_semantic_qa",
        scope: "job",
        durationMs: elapsed(stageStartedAt),
        code: rejected.code,
        paperId: rejected.paperId,
        failedPaperIds: result.failed.map((entry) => paperIdForStage(entry.item)),
        reason: rejected.detail
      });
      await context.recordTrace({
        type: "reject_requested",
        stage: "paper_semantic_qa",
        scope: "job",
        code: rejected.code,
        paperId: rejected.paperId,
        reason: rejected.detail
      });
      throw rejected;
    }
    const failureIssues = [{
      code: failureCode,
      paperId: failedPaperId,
      reason: failureDetail,
      details: Array.isArray(firstFailure.error.issues) ? firstFailure.error.issues : []
    }];
    await context.recordTrace({
      type: "stage_failed",
      stage: "paper_semantic_qa",
      scope: "job",
      durationMs: elapsed(stageStartedAt),
      code: failureCode,
      paperId: failedPaperId,
      failedPaperIds: result.failed.map((entry) => paperIdForStage(entry.item)),
      reason: failureDetail,
      decision: "manual_review"
    });
    return {
      ...checked,
      nextStage: "manual_review",
      qaReport: {
        ...checked.qaReport,
        status: "rejected",
        paperSemanticResults,
        paperIssues: failureIssues,
        repairAttempted: repairCount > 0,
        repairCount
      },
      manualReview: {
        stage: "paper_semantic_qa",
        paperId: failedPaperId,
        summary: "单篇论文的语义 QA 无法完成，请查看错误详情后决定是否跳过该论文或退出任务。",
        issues: failureIssues,
        repairAttempts: repairCount,
        allowedActions: failedPaperId ? ["exit_task", "skip_paper"] : ["exit_task"]
      }
    };
  }

  if (paperIssues.length === 0) {
    const qaReport = {
      ...checked.qaReport,
      status: "passed",
      paperSemanticResults,
      paperIssues: [],
      warnings: checked.qaReport?.warnings || []
    };
    await context.writeTrace(`paper-semantic-qa${traceSuffix}`, {
      ...baseArtifact,
      status: "passed"
    });
    await context.updateStage("paper_semantic_qa", {
      counts: checked.counts,
      warnings: checked.warnings || []
    });
    await context.recordTrace({
      type: "stage_completed",
      stage: "paper_semantic_qa",
      scope: "job",
      durationMs: elapsed(stageStartedAt),
      concurrency,
      completed: paperSemanticResults.length,
      issueCount: 0,
      decision: "continue"
    });
    return {
      ...checked,
      nextStage: "report_semantic_qa",
      qaReport
    };
  }

  const repairAttempted = repairCount > 0;
  const automaticRepairAvailable = repairCount < AUTOMATIC_CONTENT_REPAIR_LIMIT;
  const qaReport = {
    ...checked.qaReport,
    status: automaticRepairAvailable ? "repair_required" : "rejected",
    paperSemanticResults,
    paperIssues,
    repairAttempted,
    repairCount,
    warnings: checked.qaReport?.warnings || []
  };
  await context.writeTrace(`paper-semantic-qa${traceSuffix}`, {
    ...baseArtifact,
    status: qaReport.status
  });

  if (automaticRepairAvailable) {
    const repairWarning = {
      code: "READING_LIST_PAPER_QA_REPAIR_REQUIRED",
      stage: "paper_semantic_qa",
      message: `逐篇语义 QA 发现 ${paperIssues.length} 个问题，准备进行第 ${repairCount + 1}/${AUTOMATIC_CONTENT_REPAIR_LIMIT} 次自动定向修正。`,
      severity: "warning"
    };
    const warnings = uniqueWarnings([...(checked.warnings || []), repairWarning]);
    await context.updateStage("paper_semantic_qa", {
      counts: checked.counts,
      warnings
    });
    await context.recordTrace({
      type: "repair_requested",
      stage: "paper_semantic_qa",
      scope: "job",
      paperIds: [...new Set(paperIssues.map((entry) => entry.paperId))],
      issues: paperIssues
    });
    await context.recordTrace({
      type: "stage_completed",
      stage: "paper_semantic_qa",
      scope: "job",
      durationMs: elapsed(stageStartedAt),
      issueCount: paperIssues.length,
      decision: "repair"
    });
    return {
      ...checked,
      nextStage: "repair_once",
      qaReport,
      warnings
    };
  }

  const paperIds = [...new Set(paperIssues.map((entry) => String(entry.paperId || "")).filter(Boolean))];
  const paperId = paperIds.length === 1 ? paperIds[0] : "";
  const detail = paperIssues.slice(0, 5).map((entry) => entry.reason).join("；");
  await context.recordTrace({
    type: "stage_failed",
    stage: "paper_semantic_qa",
    scope: "job",
    durationMs: elapsed(stageStartedAt),
    code: "READING_LIST_QA_REPAIR_FAILED",
    paperId,
    issues: paperIssues,
    reason: detail || "Paper Semantic QA still contains unsupported content.",
    decision: "manual_review"
  });
  return {
    ...checked,
    nextStage: "manual_review",
    qaReport,
    manualReview: {
      stage: "paper_semantic_qa",
      paperId,
      summary: "逐篇语义检查在三次自动修正后仍发现阻断问题。",
      issues: paperIssues,
      repairAttempts: repairCount,
      allowedActions: paperId
        ? ["continue_repair", "exit_task", "skip_paper"]
        : ["continue_repair", "exit_task"]
    }
  };
};

export const runWeeklyReportReportSemanticQa = async (checked, context = {}, {
  callModel,
  networkRetryDelayMs = 50
} = {}) => {
  assertExecutionContext(context);

  if (!checked || checked.nextStage !== "report_semantic_qa") {
    throw new TypeError("A passed paper_semantic_qa result is required before report_semantic_qa.");
  }
  if (checked.qaReport?.status !== "passed") {
    throw new TypeError("report_semantic_qa requires a passed qaReport.");
  }
  if (typeof callModel !== "function") {
    throw new TypeError("report_semantic_qa callModel is required.");
  }

  const stageStartedAt = Date.now();
  const repairCount = repairCountFor(checked.qaReport);
  const traceSuffix = repairTraceSuffix(checked.qaReport);
  await context.updateStage("report_semantic_qa", {
    counts: checked.counts,
    warnings: checked.warnings || []
  });
  await context.recordTrace({
    type: "stage_started",
    stage: "report_semantic_qa",
    scope: "report",
    selectedPaperIds: (checked.selectedItems || []).map(paperIdForStage),
    repairAttempted: Boolean(checked.qaReport?.repairAttempted)
  });

  let callSequence = 0;
  const persistCall = async (record) => {
    const sequence = callSequence;
    callSequence += 1;
    await context.writeTrace(
      `report-semantic-qa${traceSuffix}-call-${String(sequence).padStart(4, "0")}`,
      record
    );
    await context.recordTrace({
      type: record.error ? "model_call_failed" : "model_call_completed",
      stage: "report_semantic_qa",
      scope: "report",
      role: record.role,
      attemptType: record.attemptType,
      durationMs: record.durationMs,
      validation: record.validation,
      error: record.error
    });
  };

  let result;
  try {
    result = await reviewReportSemantics({
      report: {
        ...(checked.publishReport || {}),
        title: checked.assemblyResult?.title || checked.publishReport?.title || "",
        description: checked.headTailDraft?.description || checked.publishReport?.description || ""
      },
      editorialPlan: checked.editorialPlan,
      headTailDraft: checked.headTailDraft,
      selectedItems: checked.selectedItems,
      paperDrafts: checked.paperDrafts,
      requiredLanguage: checked.outputLanguage,
      callModel,
      signal: context.signal,
      networkRetryDelayMs,
      onCall: persistCall,
      onEvent: (event) => context.recordTrace(event)
    });
  } catch (error) {
    if (error?.name === "AbortError" || context.signal?.aborted) {
      await context.recordTrace({
        type: "stage_cancelled",
        stage: "report_semantic_qa",
        scope: "report",
        durationMs: elapsed(stageStartedAt),
        reason: "admin_cancelled"
      });
      throw error;
    }

    const rejected = new WeeklyReportOrchestratorError(
      "Report Semantic QA could not complete.",
      {
        code: error?.code || "READING_LIST_REPORT_QA_FAILED",
        stage: "report_semantic_qa",
        retryable: false,
        traceId: context.traceId,
        detail: error?.message || "Report Semantic QA failed closed.",
        rejectJob: true
      }
    );
    const failureWarning = {
      code: "READING_LIST_REPORT_QA_FAILED",
      stage: "report_semantic_qa",
      message: "报告级语义质量检查不可用，本次稿件已拒绝，上一份有效周报保持不变。",
      severity: "error"
    };
    const warnings = uniqueWarnings([...(checked.warnings || []), failureWarning]);
    await context.writeTrace(`report-semantic-qa${traceSuffix}`, {
      status: "failed",
      repairAttempted: Boolean(checked.qaReport?.repairAttempted),
      error: {
        code: rejected.code,
        message: rejected.detail,
        issues: Array.isArray(error?.issues) ? error.issues : []
      }
    });
    await context.updateStage("report_semantic_qa", {
      counts: checked.counts,
      warnings
    });
    await context.recordTrace({
      type: "stage_failed",
      stage: "report_semantic_qa",
      scope: "report",
      durationMs: elapsed(stageStartedAt),
      code: rejected.code,
      reason: rejected.detail
    });
    await context.recordTrace({
      type: "reject_requested",
      stage: "report_semantic_qa",
      scope: "job",
      code: rejected.code,
      reason: rejected.detail
    });
    throw rejected;
  }

  const reportIssues = result.qaResult.issues;
  const repairAttempted = repairCount > 0;
  const automaticRepairAvailable = repairCount < AUTOMATIC_CONTENT_REPAIR_LIMIT;
  const qaReport = {
    ...checked.qaReport,
    status: reportIssues.length === 0
      ? "passed"
      : automaticRepairAvailable ? "repair_required" : "rejected",
    reportSemanticResult: result.qaResult,
    reportIssues,
    repairAttempted,
    repairCount
  };
  await context.writeTrace(`report-semantic-qa${traceSuffix}`, {
    status: qaReport.status,
    reportSemanticResult: result.qaResult,
    reportIssues,
    responseRepairAttempted: result.responseRepairAttempted,
    repairAttempted
  });

  if (reportIssues.length === 0) {
    await context.updateStage("report_semantic_qa", {
      counts: checked.counts,
      warnings: checked.warnings || []
    });
    await context.recordTrace({
      type: "stage_completed",
      stage: "report_semantic_qa",
      scope: "report",
      durationMs: elapsed(stageStartedAt),
      issueCount: 0,
      decision: "publish"
    });
    return {
      ...checked,
      nextStage: "publish",
      qaReport
    };
  }

  if (automaticRepairAvailable) {
    const repairWarning = {
      code: "READING_LIST_REPORT_QA_REPAIR_REQUIRED",
      stage: "report_semantic_qa",
      message: `报告级语义 QA 发现 ${reportIssues.length} 个问题，准备进行第 ${repairCount + 1}/${AUTOMATIC_CONTENT_REPAIR_LIMIT} 次自动定向修正。`,
      severity: "warning"
    };
    const warnings = uniqueWarnings([...(checked.warnings || []), repairWarning]);
    await context.updateStage("report_semantic_qa", {
      counts: checked.counts,
      warnings
    });
    await context.recordTrace({
      type: "repair_requested",
      stage: "report_semantic_qa",
      scope: "report",
      repairTarget: "head_tail",
      issues: reportIssues
    });
    await context.recordTrace({
      type: "stage_completed",
      stage: "report_semantic_qa",
      scope: "report",
      durationMs: elapsed(stageStartedAt),
      issueCount: reportIssues.length,
      decision: "repair"
    });
    return {
      ...checked,
      nextStage: "repair_once",
      qaReport,
      warnings
    };
  }

  const detail = reportIssues.slice(0, 5).map((entry) => entry.reason).join("；");
  const failureWarning = {
    code: "READING_LIST_MANUAL_REVIEW_REQUIRED",
    stage: "report_semantic_qa",
    message: "报告级语义问题在三次自动修正后仍存在，等待管理员处理。",
    severity: "warning"
  };
  const warnings = uniqueWarnings([...(checked.warnings || []), failureWarning]);
  await context.updateStage("report_semantic_qa", {
    counts: checked.counts,
    warnings
  });
  await context.recordTrace({
    type: "stage_failed",
    stage: "report_semantic_qa",
    scope: "report",
    durationMs: elapsed(stageStartedAt),
    code: "READING_LIST_QA_REPAIR_FAILED",
    issues: reportIssues,
    reason: detail || "Report-level narrative remains unsupported after repair.",
    decision: "manual_review"
  });
  return {
    ...checked,
    nextStage: "manual_review",
    qaReport,
    warnings,
    manualReview: {
      stage: "report_semantic_qa",
      paperId: "",
      summary: "整稿语义检查在三次自动修正后仍发现阻断问题。",
      issues: reportIssues,
      repairAttempts: repairCount,
      allowedActions: ["continue_repair", "exit_task"]
    }
  };
};

export const repairWeeklyReportOnce = async (repairable, context = {}, {
  callModel,
  networkRetryDelayMs = 50
} = {}) => {
  assertExecutionContext(context);

  if (!repairable || repairable.nextStage !== "repair_once") {
    throw new TypeError("A repair_required QA result is required before repair_once.");
  }
  if (repairable.qaReport?.status !== "repair_required") {
    throw new TypeError("repair_once requires qaReport.status=repair_required.");
  }

  const repairCount = repairCountFor(repairable.qaReport);
  const nextRepairCount = repairCount + 1;
  const stageStartedAt = Date.now();
  await context.updateStage("repair_once", {
    counts: repairable.counts,
    warnings: repairable.warnings || []
  });
  await context.recordTrace({
    type: "stage_started",
    stage: "repair_once",
    scope: "job",
    alreadyAttempted: repairCount > 0,
    repairAttempt: nextRepairCount,
    administratorApproved: Boolean(repairable.qaReport?.adminRepairApproved)
  });

  const rejectRepair = async ({
    code = "READING_LIST_QA_REPAIR_FAILED",
    paperId = "",
    detail,
    issues = [],
    partialResults = []
  }) => {
    const rejected = new WeeklyReportOrchestratorError(
      "The weekly report could not complete its single targeted repair.",
      {
        code,
        stage: "repair_once",
        paperId,
        retryable: false,
        traceId: context.traceId,
        detail: detail || "The single targeted repair failed.",
        rejectJob: true
      }
    );
    const warning = {
      code: rejected.code,
      stage: "repair_once",
      message: "唯一一次定向修正失败，本次稿件已拒绝，上一份有效周报保持不变。",
      severity: "error"
    };
    const warnings = uniqueWarnings([...(repairable.warnings || []), warning]);
    const failedArtifact = {
      status: "failed",
      repairAttempted: true,
      repairCount: nextRepairCount,
      repairResults: partialResults,
      finalIssues: issues,
      error: {
        code: rejected.code,
        paperId: rejected.paperId,
        detail: rejected.detail
      }
    };
    await context.writeTrace(`repair-result-${nextRepairCount}`, failedArtifact);
    await context.writeTrace("repair-result", failedArtifact);
    await context.updateStage("repair_once", {
      counts: repairable.counts,
      warnings
    });
    await context.recordTrace({
      type: "stage_failed",
      stage: "repair_once",
      scope: "job",
      durationMs: elapsed(stageStartedAt),
      code: rejected.code,
      paperId: rejected.paperId,
      issues,
      reason: rejected.detail
    });
    await context.recordTrace({
      type: "reject_requested",
      stage: "repair_once",
      scope: "job",
      code: rejected.code,
      paperId: rejected.paperId,
      reason: rejected.detail
    });
    throw rejected;
  };

  if (repairCount >= AUTOMATIC_CONTENT_REPAIR_LIMIT && !repairable.qaReport?.adminRepairApproved) {
    return rejectRepair({
      detail: "The automatic repair budget was exhausted without administrator approval.",
      issues: [
        ...(repairable.qaReport?.paperIssues || []),
        ...(repairable.qaReport?.reportIssues || [])
      ]
    });
  }

  const issueKey = (entry = {}) => [
    entry.code,
    entry.path || entry.field,
    entry.paperId,
    entry.repairTarget,
    entry.reason || entry.message
  ].map((part) => String(part || "")).join("|");
  const issueMap = new Map();
  [
    ...(repairable.qaReport?.deterministicIssues || []),
    ...(repairable.qaReport?.paperIssues || []),
    ...(repairable.qaReport?.reportIssues || [])
  ].forEach((entry) => {
    if (entry && typeof entry === "object") {
      issueMap.set(issueKey(entry), entry);
    }
  });
  const issues = [...issueMap.values()];
  if (!issues.length) {
    return rejectRepair({ detail: "repair_once received no normalized QA issue." });
  }
  const unsupportedIssues = issues.filter((entry) => (
    entry.repairable === false
    || !["assemble", "paper_section", "head_tail"].includes(String(entry.repairTarget || ""))
  ));
  if (unsupportedIssues.length) {
    return rejectRepair({
      detail: "repair_once received an unsupported or non-repairable QA issue.",
      issues: unsupportedIssues
    });
  }

  const assembleIssues = issues.filter((entry) => entry.repairTarget === "assemble");
  const paperIssues = issues.filter((entry) => entry.repairTarget === "paper_section");
  const headTailIssues = issues.filter((entry) => entry.repairTarget === "head_tail");
  if ((paperIssues.length || headTailIssues.length) && typeof callModel !== "function") {
    throw new TypeError("repair_once callModel is required for content repair targets.");
  }

  let callSequence = 0;
  const persistCall = async (record) => {
    const sequence = callSequence;
    callSequence += 1;
    await context.writeTrace(
      `repair-${nextRepairCount}-call-${String(sequence).padStart(4, "0")}`,
      record
    );
    await context.writeTrace(`repair-call-${String(sequence).padStart(4, "0")}`, record);
    await context.recordTrace({
      type: record.error ? "model_call_failed" : "model_call_completed",
      stage: "repair_once",
      scope: record.paperId ? "paper" : "report",
      role: record.role,
      paperId: record.paperId,
      attemptType: record.attemptType,
      durationMs: record.durationMs,
      validation: record.validation,
      error: record.error
    });
  };

  const changedFields = (before, after) => {
    const keys = new Set([
      ...Object.keys(before && typeof before === "object" ? before : {}),
      ...Object.keys(after && typeof after === "object" ? after : {})
    ]);
    return [...keys].filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
  };
  const resultEntries = assembleIssues.length ? [{
    repairTarget: "assemble",
    method: "server_reassemble",
    issueCodes: [...new Set(assembleIssues.map((entry) => entry.code))],
    changed: true,
    changedFields: ["markdown"],
    responseRepairAttempted: false
  }] : [];

  const selectedItems = Array.isArray(repairable.selectedItems) ? repairable.selectedItems : [];
  let repairedPaperDrafts = Array.isArray(repairable.paperDrafts)
    ? [...repairable.paperDrafts]
    : [];
  const groupedPaperIssues = new Map();
  paperIssues.forEach((entry) => {
    const paperId = String(entry.paperId || "").replace(/v\d+$/i, "");
    if (!groupedPaperIssues.has(paperId)) {
      groupedPaperIssues.set(paperId, []);
    }
    groupedPaperIssues.get(paperId).push(entry);
  });
  const paperTargets = [...groupedPaperIssues.entries()];
  const concurrency = Math.min(Math.max(
    Math.trunc(Number(repairable.options?.paperConcurrency) || 2),
    1
  ), 5);
  const mappedResults = new Array(paperTargets.length);
  let nextPaperTarget = 0;
  const worker = async () => {
    while (nextPaperTarget < paperTargets.length) {
      const index = nextPaperTarget;
      nextPaperTarget += 1;
      const [paperId, targetIssues] = paperTargets[index];
      const item = selectedItems.find((entry) => paperIdForStage(entry) === paperId);
      const paperDraft = repairedPaperDrafts.find((entry) => String(entry?.paperId || "").replace(/v\d+$/i, "") === paperId);
      if (!item || !paperDraft) {
        throw new WeeklyReportOrchestratorError("A targeted paper repair could not resolve its artifacts.", {
          code: "READING_LIST_QA_REPAIR_FAILED",
          stage: "repair_once",
          paperId,
          retryable: false,
          traceId: context.traceId,
          detail: "Targeted paper item or paperDraft is missing.",
          rejectJob: true
        });
      }
      const repaired = await repairPaperSectionFromQa({
        item,
        paperDraft,
        issues: targetIssues,
        callModel,
        signal: context.signal,
        onCall: persistCall,
        onEvent: (event) => context.recordTrace(event),
        networkRetryDelayMs
      });
      mappedResults[index] = { paperId, targetIssues, before: paperDraft, repaired };
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, paperTargets.length) }, () => worker()));
    for (const entry of mappedResults) {
      if (!entry) {
        continue;
      }
      const draftIndex = repairedPaperDrafts.findIndex((draft) => (
        String(draft?.paperId || "").replace(/v\d+$/i, "") === entry.paperId
      ));
      repairedPaperDrafts[draftIndex] = entry.repaired.paperDraft;
      const fields = changedFields(entry.before, entry.repaired.paperDraft);
      resultEntries.push({
        repairTarget: "paper_section",
        method: "paper_section_writer",
        paperId: entry.paperId,
        issueCodes: [...new Set(entry.targetIssues.map((issue) => issue.code))],
        changed: fields.length > 0,
        changedFields: fields,
        responseRepairAttempted: entry.repaired.responseRepairAttempted
      });
    }
  } catch (error) {
    if (error?.name === "AbortError" || context.signal?.aborted) {
      await context.recordTrace({
        type: "stage_cancelled",
        stage: "repair_once",
        scope: "job",
        durationMs: elapsed(stageStartedAt),
        reason: "admin_cancelled"
      });
      throw error;
    }
    return rejectRepair({
      code: error?.code || "READING_LIST_QA_REPAIR_FAILED",
      paperId: error?.paperId || "",
      detail: error?.message || "Targeted paper repair failed.",
      issues: Array.isArray(error?.issues) ? error.issues : paperIssues,
      partialResults: resultEntries
    });
  }

  let repairedHeadTailDraft = repairable.headTailDraft;
  if (headTailIssues.length) {
    try {
      const repaired = await repairHeadTailFromQa({
        editorialPlan: repairable.editorialPlan,
        selectedItems,
        paperDrafts: repairedPaperDrafts,
        headTailDraft: repairable.headTailDraft,
        issues: headTailIssues,
        callModel,
        signal: context.signal,
        onCall: persistCall,
        onEvent: (event) => context.recordTrace(event),
        networkRetryDelayMs
      });
      repairedHeadTailDraft = repaired.headTailDraft;
      const fields = changedFields(repairable.headTailDraft, repairedHeadTailDraft);
      resultEntries.push({
        repairTarget: "head_tail",
        method: "editorial_head_tail_writer",
        paperId: "",
        issueCodes: [...new Set(headTailIssues.map((entry) => entry.code))],
        changed: fields.length > 0,
        changedFields: fields,
        responseRepairAttempted: repaired.responseRepairAttempted
      });
    } catch (error) {
      if (error?.name === "AbortError" || context.signal?.aborted) {
        await context.recordTrace({
          type: "stage_cancelled",
          stage: "repair_once",
          scope: "job",
          durationMs: elapsed(stageStartedAt),
          reason: "admin_cancelled"
        });
        throw error;
      }
      return rejectRepair({
        code: error?.code || "READING_LIST_QA_REPAIR_FAILED",
        detail: error?.message || "Targeted Head/Tail repair failed.",
        issues: Array.isArray(error?.issues) ? error.issues : headTailIssues,
        partialResults: resultEntries
      });
    }
  }

  const qaReport = {
    ...repairable.qaReport,
    status: "repair_required",
    repairAttempted: true,
    repairCount: nextRepairCount,
    adminRepairApproved: false,
    repairResults: [
      ...(repairable.qaReport?.repairResults || []),
      ...resultEntries
    ],
    finalIssues: []
  };
  const artifact = {
    status: "completed",
    repairAttempted: true,
    repairCount: nextRepairCount,
    issueCount: issues.length,
    concurrency,
    repairResults: resultEntries,
    nextStage: "assemble"
  };
  await context.writeTrace(`repair-result-${nextRepairCount}`, artifact);
  await context.writeTrace("repair-result", artifact);
  await context.updateStage("repair_once", {
    counts: repairable.counts,
    warnings: repairable.warnings || []
  });
  await context.recordTrace({
    type: "stage_completed",
    stage: "repair_once",
    scope: "job",
    durationMs: elapsed(stageStartedAt),
    issueCount: issues.length,
    repairedPaperIds: paperTargets.map(([paperId]) => paperId),
    repairedHeadTail: headTailIssues.length > 0,
    serverReassemble: assembleIssues.length > 0,
    decision: "reassemble_and_recheck"
  });

  return {
    ...repairable,
    nextStage: "assemble",
    paperDrafts: repairedPaperDrafts,
    headTailDraft: repairedHeadTailDraft,
    qaReport
  };
};
