import {
  assembleWeeklyReport,
  calibrateWeeklyReportPapers,
  extractWeeklyReportEvidence,
  planWeeklyReportEditorial,
  prepareWeeklyReportJob,
  repairWeeklyReportOnce,
  reviewWeeklyReportPapers,
  runWeeklyReportDeterministicQa,
  runWeeklyReportPaperSemanticQa,
  runWeeklyReportReportSemanticQa,
  selectWeeklyReportPapers,
  writeWeeklyReportHeadTail,
  writeWeeklyReportPaperSections
} from "./orchestrator.js";
import {
  manualReviewItem,
  normalizeManualReviewRequest,
  withoutManualReviewItem
} from "./manual-review.js";

const DEFAULT_STEPS = Object.freeze({
  prepare: prepareWeeklyReportJob,
  evidence: extractWeeklyReportEvidence,
  review: reviewWeeklyReportPapers,
  calibrate: calibrateWeeklyReportPapers,
  select: selectWeeklyReportPapers,
  editorialPlan: planWeeklyReportEditorial,
  paperSections: writeWeeklyReportPaperSections,
  headTail: writeWeeklyReportHeadTail,
  assemble: assembleWeeklyReport,
  deterministicQa: runWeeklyReportDeterministicQa,
  paperSemanticQa: runWeeklyReportPaperSemanticQa,
  reportSemanticQa: runWeeklyReportReportSemanticQa,
  repair: repairWeeklyReportOnce
});

export class WeeklyReportPipelineError extends Error {
  constructor(message, {
    code = "READING_LIST_PIPELINE_STAGE_INVALID",
    stage = "pipeline",
    traceId = "",
    detail = ""
  } = {}) {
    super(message);
    this.name = "WeeklyReportPipelineError";
    this.code = code;
    this.stage = stage;
    this.paperId = "";
    this.retryable = false;
    this.traceId = traceId;
    this.detail = detail || message;
    this.rejectJob = true;
  }
}

const abortError = () => {
  const error = new Error("Weekly report Agent Loop was cancelled.");
  error.name = "AbortError";
  error.code = "READING_LIST_JOB_CANCELLED";
  error.stage = "pipeline";
  error.retryable = true;
  error.rejectJob = true;
  return error;
};

const assertCallableSteps = (steps) => {
  for (const [name, handler] of Object.entries(steps)) {
    if (typeof handler !== "function") {
      throw new TypeError(`Weekly report Pipeline step ${name} must be a function.`);
    }
  }
};

const manualReviewQueueForCurrent = (current = {}) => {
  if (current?.manualReview && typeof current.manualReview === "object") {
    return current.manualReview;
  }
  const items = Array.isArray(current?.manualReviewBacklog)
    ? current.manualReviewBacklog
    : [];
  if (!items.length) return {};
  const stage = String(items[0]?.sourceStage || "manual_review");
  return normalizeManualReviewRequest({
    stage,
    resumeStage: stage,
    activeItemId: items[0]?.itemId,
    items
  });
};

const selectedManualReviewItem = (review, decision = {}) => (
  Array.isArray(review?.items)
    ? manualReviewItem(review, decision?.itemId || review.activeItemId) || {}
    : review || {}
);

const consumeManualReviewItem = (current = {}, review = {}, selectedReview = {}) => {
  const itemId = String(selectedReview?.itemId || "").trim();
  if (!itemId) return { ...current, manualReview: null };
  if (Array.isArray(current?.manualReviewBacklog)) {
    return {
      ...current,
      manualReview: null,
      manualReviewBacklog: current.manualReviewBacklog.filter((item) => (
        String(item?.itemId || "").trim() !== itemId
      ))
    };
  }
  if (Array.isArray(review?.items)) {
    return {
      ...current,
      manualReview: withoutManualReviewItem(review, itemId)
    };
  }
  return { ...current, manualReview: null };
};

const appendSelectionOverride = (overrides, override) => {
  const paperId = String(override?.paperId || "").trim();
  const existing = Array.isArray(overrides) ? overrides : [];
  if (!paperId) return existing;
  return [
    ...existing.filter((item) => String(item?.paperId || "").trim() !== paperId),
    override
  ];
};

const paperIdForRetry = (item = {}) => String(
  item?.paperId
  || item?.contextPacket?.paperId
  || item?.paper?.id
  || item?.reviewResult?.paperId
  || ""
).trim().replace(/v\d+$/i, "");

const retryFailureForPaper = (current = {}, sourceStage, paperId) => {
  const normalizedPaperId = String(paperId || "").trim().replace(/v\d+$/i, "");
  const source = sourceStage === "extract_evidence"
    ? current?.evidenceResult
    : current?.reviewResult;
  const failures = [
    ...(Array.isArray(source?.processingFailed) ? source.processingFailed : []),
    ...(Array.isArray(source?.evidenceDisputes) ? source.evidenceDisputes : []),
    ...(Array.isArray(source?.reviewDisputes) ? source.reviewDisputes : [])
  ];
  return failures.find((item) => paperIdForRetry(item) === normalizedPaperId) || null;
};

const mergePaperItems = (existing, recovered) => {
  const merged = new Map();
  (Array.isArray(existing) ? existing : []).forEach((item) => {
    const paperId = paperIdForRetry(item);
    if (paperId) merged.set(paperId, item);
  });
  (Array.isArray(recovered) ? recovered : []).forEach((item) => {
    const paperId = paperIdForRetry(item);
    if (paperId) merged.set(paperId, item);
  });
  return [...merged.values()];
};

export const runWeeklyReportAgentLoop = async (input = {}, context = {}, {
  buildContext,
  callModel,
  networkRetryDelayMs = 50,
  steps: stepOverrides = {}
} = {}) => {
  if (typeof buildContext !== "function") {
    throw new TypeError("Weekly report Pipeline buildContext is required.");
  }
  if (typeof callModel !== "function") {
    throw new TypeError("Weekly report Pipeline callModel is required.");
  }
  const steps = { ...DEFAULT_STEPS, ...stepOverrides };
  assertCallableSteps(steps);
  let current = null;

  try {
    if (context.signal?.aborted) {
      throw abortError();
    }
    current = await steps.prepare(input, context, { buildContext });

    for (let transitionCount = 0; transitionCount < 40; transitionCount += 1) {
      if (context.signal?.aborted) {
        throw abortError();
      }
      const nextStage = String(current?.nextStage || "");
      const modelOptions = { callModel, networkRetryDelayMs };

      if (nextStage === "extract_evidence") {
        current = await steps.evidence(current, context, modelOptions);
      } else if (nextStage === "review") {
        current = await steps.review(current, context, modelOptions);
      } else if (nextStage === "calibrate") {
        if (current?.manualRetry?.mergeReviewItems) {
          current = {
            ...current,
            reviewItems: mergePaperItems(
              current.manualRetry.mergeReviewItems,
              current.reviewItems
            ),
            manualRetry: null
          };
        }
        current = await steps.calibrate(current, context, modelOptions);
      } else if (nextStage === "select") {
        current = await steps.select(current, context);
      } else if (nextStage === "editorial_plan") {
        current = await steps.editorialPlan(current, context, modelOptions);
      } else if (nextStage === "write_paper_sections") {
        current = await steps.paperSections(current, context, modelOptions);
      } else if (nextStage === "write_head_tail") {
        current = await steps.headTail(current, context, modelOptions);
      } else if (nextStage === "assemble") {
        current = await steps.assemble(current, context);
      } else if (nextStage === "deterministic_qa") {
        current = await steps.deterministicQa(current, context);
      } else if (nextStage === "paper_semantic_qa") {
        current = await steps.paperSemanticQa(current, context, modelOptions);
      } else if (nextStage === "report_semantic_qa") {
        current = await steps.reportSemanticQa(current, context, modelOptions);
      } else if (nextStage === "repair_once") {
        current = await steps.repair(current, context, modelOptions);
      } else if (nextStage === "manual_review") {
        if (typeof context.requestManualReview !== "function") {
          throw new WeeklyReportPipelineError(
            "Weekly report Pipeline cannot wait for an administrator decision.",
            {
              code: "READING_LIST_MANUAL_REVIEW_UNAVAILABLE",
              stage: String(current?.manualReview?.stage || "manual_review"),
              traceId: context.traceId
            }
          );
        }
        const review = manualReviewQueueForCurrent(current);
        const decision = await context.requestManualReview(review);
        const action = String(decision?.action || "");
        const selectedReview = selectedManualReviewItem(review, decision);
        const allowedActions = new Set(Array.isArray(selectedReview?.allowedActions)
          ? selectedReview.allowedActions
          : []);
        if (action !== "exit_task" && !allowedActions.has(action)) {
          throw new WeeklyReportPipelineError(
            "Weekly report Pipeline received an invalid administrator decision.",
            {
              code: "READING_LIST_MANUAL_REVIEW_ACTION_INVALID",
              stage: String(selectedReview.sourceStage || review.stage || "manual_review"),
              traceId: context.traceId
            }
          );
        }
        if (action === "exit_task") {
          return {
            state: "reject",
            reason: "admin_rejected",
            reportKey: String(input.reportKey || current?.reportMeta?.reportKey || ""),
            markdown: current?.markdown,
            counts: current?.counts,
            warnings: current?.warnings || []
          };
        }
        if (action === "include_below_threshold") {
          const paperId = String(selectedReview.paperId || "").trim();
          const reason = String(decision?.reason || "").trim();
          const decisionId = String(decision?.decisionId || "").trim();
          if (selectedReview.kind !== "quality_below_threshold" || !paperId
            || !decisionId || reason.length < 8) {
            throw new WeeklyReportPipelineError(
              "Administrator inclusion requires a reviewable below-threshold paper and a concrete reason.",
              {
                code: "READING_LIST_MANUAL_REVIEW_ACTION_INVALID",
                stage: "select",
                traceId: context.traceId
              }
            );
          }
          current = {
            ...consumeManualReviewItem(current, review, selectedReview),
            nextStage: "select",
            counts: current?.counts ? { ...current.counts, selected: 0 } : current?.counts,
            adminSelectionOverrides: appendSelectionOverride(current?.adminSelectionOverrides, {
              paperId,
              reason,
              decisionId,
              decidedAt: String(decision?.decidedAt || new Date().toISOString())
            })
          };
          continue;
        }
        if (action === "keep_excluded") {
          const paperId = String(selectedReview.paperId || "").trim();
          if (selectedReview.kind !== "quality_below_threshold" || !paperId) {
            throw new WeeklyReportPipelineError(
              "Administrator exclusion requires a reviewable paper.",
              {
                code: "READING_LIST_MANUAL_REVIEW_ACTION_INVALID",
                stage: "select",
                traceId: context.traceId
              }
            );
          }
          current = {
            ...consumeManualReviewItem(current, review, selectedReview),
            nextStage: "calibrate",
            counts: current?.counts ? { ...current.counts, selected: 0 } : current?.counts,
            manualExcludedPaperIds: [...new Set([
              ...(Array.isArray(current?.manualExcludedPaperIds) ? current.manualExcludedPaperIds : []),
              paperId
            ])]
          };
          continue;
        }
        if (action === "retry_paper") {
          const paperId = String(selectedReview.paperId || "").trim();
          const sourceStage = String(selectedReview.sourceStage || "").trim();
          const failedItem = retryFailureForPaper(current, sourceStage, paperId);
          if (!paperId || !failedItem || !["extract_evidence", "review"].includes(sourceStage)) {
            throw new WeeklyReportPipelineError(
              "Paper retry requires the retained artifact for the selected failed paper.",
              {
                code: "READING_LIST_MANUAL_REVIEW_ACTION_INVALID",
                stage: sourceStage || "manual_review",
                traceId: context.traceId
              }
            );
          }
          if (sourceStage === "extract_evidence") {
            current = {
              ...consumeManualReviewItem(current, review, selectedReview),
              nextStage: "extract_evidence",
              contextResult: {
                ...(current?.contextResult || {}),
                eligible: [failedItem],
                targetEligibleCount: 1
              },
              candidatePool: {
                ...(current?.candidatePool || {}),
                reserveCandidates: []
              },
              manualRetry: {
                sourceStage,
                paperId,
                mergeReviewItems: current?.reviewItems || []
              }
            };
            continue;
          }
          current = {
            ...consumeManualReviewItem(current, review, selectedReview),
            nextStage: "review",
            evidenceItems: [failedItem],
            manualRetry: {
              sourceStage,
              paperId,
              mergeReviewItems: current?.reviewItems || []
            }
          };
          continue;
        }
        if (action === "retry_stage") {
          const sourceStage = String(selectedReview.sourceStage || "").trim();
          if (sourceStage !== "calibrate" || !Array.isArray(current?.reviewItems)) {
            throw new WeeklyReportPipelineError(
              "Stage retry requires retained Review artifacts for calibration.",
              {
                code: "READING_LIST_MANUAL_REVIEW_ACTION_INVALID",
                stage: sourceStage || "manual_review",
                traceId: context.traceId
              }
            );
          }
          current = {
            ...consumeManualReviewItem(current, review, selectedReview),
            nextStage: "calibrate"
          };
          continue;
        }
        if (action === "retry_job") {
          current = await steps.prepare(input, context, { buildContext });
          continue;
        }
        if (action === "continue_repair") {
          if (String(selectedReview.sourceStage || review.stage || "") === "write_paper_sections") {
            const paperId = String(selectedReview.paperId || "").trim();
            if (!paperId) {
              throw new WeeklyReportPipelineError(
                "Paper Section administrator repair requires one concrete paperId.",
                {
                  code: "READING_LIST_MANUAL_REVIEW_ACTION_INVALID",
                  stage: "write_paper_sections",
                  traceId: context.traceId
                }
              );
            }
            const repairIssues = (Array.isArray(selectedReview.issues) ? selectedReview.issues : []).flatMap((itemIssue) => (
              Array.isArray(itemIssue?.details) && itemIssue.details.length
                ? itemIssue.details
                : [itemIssue]
            ));
            const previousAttempts = Math.max(
              1,
              Math.trunc(Number(current?.paperSectionRepairAttempts?.[paperId]) || 0),
              Math.trunc(Number(selectedReview.repairAttempts) || 0)
            );
            current = {
              ...consumeManualReviewItem(current, review, selectedReview),
              nextStage: "write_paper_sections",
              paperSectionRetry: {
                paperId,
                issues: repairIssues,
                attempt: Math.max(0, Math.trunc(Number(current?.paperSectionRetry?.attempt) || 0)) + 1
              },
              paperSectionRepairAttempts: {
                ...(current?.paperSectionRepairAttempts || {}),
                [paperId]: previousAttempts + 1
              }
            };
            continue;
          }
          current = {
            ...consumeManualReviewItem(current, review, selectedReview),
            nextStage: "repair_once",
            qaReport: {
              ...current?.qaReport,
              status: "repair_required",
              adminRepairApproved: true
            }
          };
          continue;
        }
        if (action === "skip_paper") {
          const paperId = String(decision?.paperId || selectedReview.paperId || "").trim();
          if (!paperId) {
            throw new WeeklyReportPipelineError(
              "Administrator skip-paper decision requires one concrete paperId.",
              {
                code: "READING_LIST_MANUAL_REVIEW_ACTION_INVALID",
                stage: String(selectedReview.sourceStage || review.stage || "manual_review"),
                traceId: context.traceId
              }
            );
          }
          current = {
            ...consumeManualReviewItem(current, review, selectedReview),
            nextStage: "calibrate",
            counts: current?.counts ? { ...current.counts, selected: 0 } : current?.counts,
            manualExcludedPaperIds: [...new Set([
              ...(Array.isArray(current?.manualExcludedPaperIds) ? current.manualExcludedPaperIds : []),
              paperId
            ])]
          };
          continue;
        }
        if (action === "confirm_evidence") {
          const reviewableIssueKeys = new Set(
            (Array.isArray(selectedReview.approvableIssueKeys) ? selectedReview.approvableIssueKeys : [])
              .map((issueKey) => String(issueKey || "").trim())
              .filter(Boolean)
          );
          const approvedIssueKeys = [...new Set(
            (Array.isArray(decision?.approvedIssueKeys) ? decision.approvedIssueKeys : [])
              .map((issueKey) => String(issueKey || "").trim())
              .filter(Boolean)
          )];
          const decisionReviews = new Map(
            (Array.isArray(decision?.evidenceReviews) ? decision.evidenceReviews : [])
              .filter((entry) => entry && typeof entry === "object")
              .map((entry) => [String(entry?.issueKey || "").trim(), entry])
              .filter(([issueKey]) => issueKey)
          );
          const approvalIsValid = approvedIssueKeys.length > 0
            && approvedIssueKeys.every((issueKey) => (
              reviewableIssueKeys.has(issueKey) && decisionReviews.has(issueKey)
            ))
            && [...decisionReviews.keys()].every((issueKey) => approvedIssueKeys.includes(issueKey));
          if (!approvalIsValid) {
            throw new WeeklyReportPipelineError(
              "Evidence confirmation requires at least one reviewable issue.",
              {
                code: "READING_LIST_MANUAL_REVIEW_ACTION_INVALID",
                stage: String(selectedReview.sourceStage || review.stage || "manual_review"),
                traceId: context.traceId
              }
            );
          }
          const approvals = approvedIssueKeys.map((issueKey) => ({
            ...decisionReviews.get(issueKey),
            issueKey,
            decidedAt: String(decision?.decidedAt || new Date().toISOString())
          }));
          const approvalByKey = new Map(
            (Array.isArray(current?.manualEvidenceApprovals) ? current.manualEvidenceApprovals : [])
              .map((entry) => [String(entry?.issueKey || ""), entry])
          );
          approvals.forEach((entry) => approvalByKey.set(entry.issueKey, entry));
          current = {
            ...consumeManualReviewItem(current, review, selectedReview),
            nextStage: ["deterministic_qa", "paper_semantic_qa", "report_semantic_qa"]
              .includes(String(selectedReview.sourceStage || review.stage || ""))
              ? String(selectedReview.sourceStage || review.stage)
              : "deterministic_qa",
            manualEvidenceApprovals: [...approvalByKey.values()]
          };
          continue;
        }
        if (action === "ignore_warning" && review.allowIgnore && review.continueStage) {
          current = {
            ...current,
            nextStage: String(review.continueStage),
            manualReview: null
          };
          continue;
        }
        throw new WeeklyReportPipelineError(
          "Weekly report Pipeline received an invalid administrator decision.",
          {
            code: "READING_LIST_MANUAL_REVIEW_ACTION_INVALID",
            stage: String(selectedReview.sourceStage || review.stage || "manual_review"),
            traceId: context.traceId
          }
        );
      } else if (nextStage === "publish") {
        if (!String(current?.markdown || "").trim() || current?.qaReport?.status !== "passed") {
          throw new WeeklyReportPipelineError(
            "Weekly report Pipeline reached publish without a passed final QA report and Markdown.",
            {
              code: "READING_LIST_PUBLISH_REJECTED",
              stage: "publish",
              traceId: context.traceId
            }
          );
        }
        await context.recordTrace?.({
          type: "publish_requested",
          stage: "publish",
          scope: "job",
          markdownChars: current.markdown.length,
          repairAttempted: Boolean(current.qaReport?.repairAttempted)
        });
        return {
          state: "publish",
          reason: "quality_gates_passed",
          reportKey: String(input.reportKey || current.reportMeta?.reportKey || ""),
          markdown: current.markdown,
          title: String(current.assemblyResult?.title || ""),
          counts: current.counts,
          warnings: current.warnings || [],
          qaReport: current.qaReport,
          paperCount: current.publishedPapers?.length || current.counts?.selected || 0
        };
      } else {
        throw new WeeklyReportPipelineError(
          `Weekly report Pipeline returned an unsupported next stage: ${nextStage || "empty"}.`,
          {
            stage: nextStage || "pipeline",
            traceId: context.traceId,
            detail: "No legacy weekly-report fallback is allowed from the Agent Loop."
          }
        );
      }
    }

    throw new WeeklyReportPipelineError(
      "Weekly report Pipeline exceeded its finite transition safety limit.",
      {
        code: "READING_LIST_PIPELINE_STAGE_INVALID",
        stage: String(current?.nextStage || "pipeline"),
        traceId: context.traceId
      }
    );
  } catch (error) {
    if (current?.markdown && !error.markdown) {
      error.markdown = current.markdown;
    }
    if (!error.traceId && context.traceId) {
      error.traceId = context.traceId;
    }
    throw error;
  }
};
