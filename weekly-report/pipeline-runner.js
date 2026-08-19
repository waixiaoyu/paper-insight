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
        const review = current?.manualReview && typeof current.manualReview === "object"
          ? current.manualReview
          : {};
        const decision = await context.requestManualReview(review);
        const action = String(decision?.action || "");
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
        if (action === "continue_repair") {
          current = {
            ...current,
            nextStage: "repair_once",
            manualReview: null,
            qaReport: {
              ...current?.qaReport,
              status: "repair_required",
              adminRepairApproved: true
            }
          };
          continue;
        }
        if (action === "skip_paper") {
          const paperId = String(decision?.paperId || review.paperId || "").trim();
          if (!paperId) {
            throw new WeeklyReportPipelineError(
              "Administrator skip-paper decision requires one concrete paperId.",
              {
                code: "READING_LIST_MANUAL_REVIEW_ACTION_INVALID",
                stage: String(review.stage || "manual_review"),
                traceId: context.traceId
              }
            );
          }
          current = {
            ...current,
            nextStage: "calibrate",
            manualReview: null,
            counts: current?.counts ? { ...current.counts, selected: 0 } : current?.counts,
            manualExcludedPaperIds: [...new Set([
              ...(Array.isArray(current?.manualExcludedPaperIds) ? current.manualExcludedPaperIds : []),
              paperId
            ])]
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
            stage: String(review.stage || "manual_review"),
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
