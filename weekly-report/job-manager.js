import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertWeeklyReportJob,
  createWeeklyReportJob,
  finalizeWeeklyReportJob
} from "./schema.js";
import { redactTraceValue } from "./trace-store.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const MANUAL_REVIEW_ACTIONS = new Set([
  "continue_repair",
  "retry_job",
  "exit_task",
  "skip_paper",
  "ignore_warning"
]);

const readJsonIfPresent = async (path, fallback = null) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
};

const writeJsonAtomic = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");

  try {
    await rename(temporaryPath, path);
  } catch (error) {
    if (["EEXIST", "EPERM"].includes(error?.code)) {
      await rm(path, { force: true });
      await rename(temporaryPath, path);
    } else {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
};

const publicJob = (job, reusedActiveJob = false) => ({
  ...clone(job),
  reusedActiveJob
});

const persistedResult = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const { state: _state, markdown: _markdown, ...rest } = value;
  return redactTraceValue(rest);
};

const errorRecord = (error) => redactTraceValue({
  code: String(error?.code || "READING_LIST_PUBLISH_REJECTED"),
  message: String(error?.message || "Weekly report Job failed."),
  stage: String(error?.stage || ""),
  paperId: String(error?.paperId || ""),
  retryable: Boolean(error?.retryable),
  traceId: String(error?.traceId || ""),
  detail: typeof error?.detail === "string" ? error.detail : "",
  rejectJob: Boolean(error?.rejectJob)
});

export class WeeklyReportJobManager {
  constructor({
    jobsDir,
    traceStore,
    execute = async () => ({ state: "reject", reason: "not_implemented" }),
    publish = async () => {}
  } = {}) {
    if (!String(jobsDir || "").trim()) {
      throw new TypeError("Weekly report jobsDir is required.");
    }

    if (!traceStore) {
      throw new TypeError("Weekly report traceStore is required.");
    }

    this.jobsDir = jobsDir;
    this.traceStore = traceStore;
    this.execute = execute;
    this.publish = publish;
    this.activeJob = null;
    this.jobs = new Map();
    this.abortControllers = new Map();
    this.completions = new Map();
    this.finalizations = new Map();
    this.manualReviews = new Map();
  }

  get activePath() {
    return join(this.jobsDir, "active.json");
  }

  jobPath(jobId) {
    return join(this.jobsDir, `job-${String(jobId)}.json`);
  }

  async initialize() {
    await mkdir(this.jobsDir, { recursive: true });
    const persistedActive = await readJsonIfPresent(this.activePath);

    if (!persistedActive) {
      this.activeJob = null;
      return null;
    }

    assertWeeklyReportJob(persistedActive);

    if (persistedActive.state !== "running") {
      await rm(this.activePath, { force: true });
      this.jobs.set(persistedActive.jobId, persistedActive);
      this.activeJob = null;
      return null;
    }

    const interrupted = finalizeWeeklyReportJob(persistedActive, {
      state: "reject",
      reason: "agent_interrupted",
      error: {
        code: "READING_LIST_JOB_INTERRUPTED",
        message: "The service restarted before the weekly report Job completed.",
        retryable: true
      }
    });
    await this.persistJob(interrupted, { active: false });
    this.jobs.set(interrupted.jobId, interrupted);
    this.activeJob = null;
    const existingTrace = await this.traceStore.readTrace(interrupted.traceId);

    if (!existingTrace) {
      await this.traceStore.createTrace({
        traceId: interrupted.traceId,
        jobId: interrupted.jobId,
        input: {
          recoveredAfterInterruption: true,
          originalCreatedAt: persistedActive.createdAt,
          reportKey: persistedActive.reportKey
        }
      });
    }

    await this.traceStore.appendTimeline(interrupted.traceId, {
      type: "job_interrupted",
      stage: persistedActive.agentStage,
      outcome: "reject",
      reason: "agent_interrupted"
    });
    await this.traceStore.updateMeta(interrupted.traceId, {
      state: "reject",
      result: interrupted.result,
      completedAt: interrupted.completedAt
    });
    return publicJob(interrupted);
  }

  async createOrReuse(input = {}) {
    if (this.activeJob?.state === "running") {
      return publicJob(this.activeJob, true);
    }

    const jobId = `weekly-report-job-${randomUUID()}`;
    const traceId = `weekly-report-trace-${randomUUID()}`;
    const job = createWeeklyReportJob({
      jobId,
      traceId,
      reportKey: input.reportKey,
      options: input.options || input
    });
    const controller = new AbortController();
    let resolveCompletion;
    const completion = new Promise((resolve) => {
      resolveCompletion = resolve;
    });

    this.activeJob = job;
    this.jobs.set(jobId, job);
    this.abortControllers.set(jobId, controller);
    this.completions.set(jobId, { promise: completion, resolve: resolveCompletion });

    try {
      await this.persistJob(job, { active: true });
      await this.traceStore.createTrace({
        traceId,
        jobId,
        input,
        createdAt: job.createdAt
      });
      await this.traceStore.appendTimeline(traceId, {
        type: "job_started",
        stage: "create_job",
        outcome: "continue"
      });
    } catch (error) {
      this.activeJob = null;
      this.jobs.delete(jobId);
      this.abortControllers.delete(jobId);
      this.completions.delete(jobId);
      await rm(this.activePath, { force: true });
      throw error;
    }

    void this.run(jobId, input, controller.signal);
    return publicJob(job, false);
  }

  async run(jobId, input, signal) {
    try {
      const output = await this.execute(input, {
        jobId,
        traceId: this.jobs.get(jobId)?.traceId,
        signal,
        updateStage: (stage, patch) => this.updateStage(jobId, stage, patch),
        recordTrace: (event) => this.recordTrace(jobId, event),
        writeTrace: (name, value) => this.writeTrace(jobId, name, value),
        requestManualReview: (review) => this.requestManualReview(jobId, review, signal)
      });

      if (!this.isActiveRunning(jobId)) {
        return;
      }

      if (this.activeJob.cancelRequested || signal.aborted) {
        await this.finish(jobId, {
          state: "reject",
          reason: "admin_cancelled"
        });
        return;
      }

      if (output?.state === "publish") {
        await this.finish(jobId, {
          state: "publish",
          reason: output.reason || "completed",
          result: persistedResult(output),
          markdown: output.markdown,
          publishOutput: output,
          publishInput: input,
          publishSignal: signal
        });
        return;
      }

      if (output?.state === "reject") {
        if (output.reason === "admin_rejected" || output.reason === "admin_cancelled") {
          await this.finish(jobId, {
            state: "reject",
            reason: output.reason,
            result: persistedResult(output),
            markdown: output.markdown
          });
          return;
        }
        const error = new Error(output.reason || "The Agent Loop rejected publication.");
        error.code = String(output?.error?.code || "READING_LIST_PUBLISH_REJECTED");
        error.stage = String(output?.stage || output?.agentStage || this.activeJob.agentStage || "pipeline");
        error.paperId = String(output?.paperId || "");
        error.retryable = Boolean(output?.error?.retryable);
        error.rejectJob = true;
        error.markdown = output.markdown;
        error.result = persistedResult(output);
        throw error;
      }

      const error = new Error("Agent Loop returned a final state other than publish or reject.");
      error.code = "READING_LIST_PUBLISH_REJECTED";
      error.stage = String(this.activeJob.agentStage || "pipeline");
      error.retryable = false;
      error.rejectJob = true;
      error.markdown = output?.markdown;
      throw error;
    } catch (error) {
      if (!this.isActiveRunning(jobId)) {
        return;
      }

      if (error?.code === "READING_LIST_JOB_CANCELLED") {
        await this.finish(jobId, {
          state: "reject",
          reason: "admin_cancelled",
          error: errorRecord(error),
          markdown: error?.markdown
        });
        return;
      }

      if (error?.code === "READING_LIST_ADMIN_REJECTED") {
        await this.finish(jobId, {
          state: "reject",
          reason: "admin_rejected",
          result: error?.result,
          error: errorRecord(error),
          markdown: error?.markdown
        });
        return;
      }

      let decision;
      try {
          decision = await this.requestManualReview(jobId, {
            kind: "execution_failure",
            stage: String(error?.stage || this.activeJob.agentStage || "pipeline"),
            paperId: String(error?.paperId || ""),
            summary: String(error?.detail || error?.message || "自动处理无法继续，需要管理员决定是否重试任务。"),
            issues: [errorRecord(error)],
            repairAttempts: 0,
            allowedActions: ["retry_job", "exit_task"]
          }, signal);
      } catch (reviewError) {
        await this.finish(jobId, {
          state: "reject",
          reason: reviewError?.code === "READING_LIST_JOB_CANCELLED"
            ? "admin_cancelled"
            : "manual_review_failed",
          error: errorRecord(reviewError),
          markdown: error?.markdown
        });
        return;
      }

      if (decision?.action === "retry_job") {
        await this.updateStage(jobId, "create_job");
        await this.run(jobId, input, signal);
        return;
      }

      await this.finish(jobId, {
        state: "reject",
        reason: "admin_rejected",
        result: error?.result,
        error: errorRecord(error),
        markdown: error?.markdown
      });
      return;

    }
  }

  isActiveRunning(jobId) {
    return this.activeJob?.jobId === jobId && this.activeJob.state === "running";
  }

  async updateStage(jobId, stage, patch = {}) {
    if (!this.isActiveRunning(jobId)) {
      return this.getJob(jobId);
    }

    if (!String(stage || "").trim()) {
      throw new TypeError("Weekly report agentStage is required.");
    }

    const safePatch = redactTraceValue(patch);
    const next = {
      ...this.activeJob,
      ...safePatch,
      jobId: this.activeJob.jobId,
      traceId: this.activeJob.traceId,
      reportKey: this.activeJob.reportKey,
      state: "running",
      agentStage: String(stage),
      updatedAt: new Date().toISOString(),
      counts: safePatch.counts
        ? { ...this.activeJob.counts, ...safePatch.counts }
        : this.activeJob.counts,
      result: null,
      completedAt: ""
    };
    assertWeeklyReportJob(next);
    this.activeJob = next;
    this.jobs.set(jobId, next);
    await this.persistJob(next, { active: true });
    await this.traceStore.appendTimeline(next.traceId, {
      type: "stage_updated",
      stage: next.agentStage,
      outcome: "continue"
    });
    return publicJob(next);
  }

  async recordTrace(jobId, event) {
    const job = this.jobs.get(jobId) || await this.getJob(jobId);
    if (!job) {
      return null;
    }
    return this.traceStore.appendTimeline(job.traceId, event);
  }

  async writeTrace(jobId, name, value) {
    const job = this.jobs.get(jobId) || await this.getJob(jobId);
    if (!job) {
      return null;
    }
    return this.traceStore.writeJson(job.traceId, name, value);
  }

  async requestManualReview(jobId, review = {}, signal) {
    if (!this.isActiveRunning(jobId)) {
      throw new Error("Only the active running weekly report Job can request manual review.");
    }
    if (this.manualReviews.has(jobId) || this.activeJob.manualReview) {
      throw new Error("The weekly report Job is already waiting for an administrator decision.");
    }

    const allowedActions = [...new Set((Array.isArray(review.allowedActions) ? review.allowedActions : [])
      .map((action) => String(action || "").trim())
      .filter((action) => MANUAL_REVIEW_ACTIONS.has(action)))];
    if (!allowedActions.length) {
      throw new TypeError("Manual review requires at least one allowed administrator action.");
    }
    const requestedAt = new Date().toISOString();
    const relatedPaperIds = [...new Set((Array.isArray(review.relatedPaperIds) ? review.relatedPaperIds : [])
      .map((paperId) => String(paperId || "").trim())
      .filter(Boolean))];
    const manualReview = redactTraceValue({
      kind: String(review.kind || "quality_repair"),
      stage: String(review.stage || this.activeJob.agentStage || "manual_review"),
      paperId: String(review.paperId || ""),
      relatedPaperIds,
      summary: String(review.summary || "Content remains invalid after automatic repairs."),
      issues: Array.isArray(review.issues) ? review.issues.slice(0, 50) : [],
      repairAttempts: Math.max(0, Math.trunc(Number(review.repairAttempts) || 0)),
      allowedActions,
      requestedAt
    });
    const waiting = {
      ...this.activeJob,
      agentStage: manualReview.stage,
      manualReview,
      updatedAt: requestedAt
    };
    let resolveDecision;
    let rejectDecision;
    const promise = new Promise((resolve, reject) => {
      resolveDecision = resolve;
      rejectDecision = reject;
    });
    const abort = () => {
      const error = new Error("Weekly report manual review was cancelled.");
      error.name = "AbortError";
      error.code = "READING_LIST_JOB_CANCELLED";
      rejectDecision(error);
    };
    signal?.addEventListener("abort", abort, { once: true });
    this.manualReviews.set(jobId, {
      resolve: resolveDecision,
      reject: rejectDecision,
      promise,
      cleanup: () => signal?.removeEventListener("abort", abort)
    });
    assertWeeklyReportJob(waiting);
    this.activeJob = waiting;
    this.jobs.set(jobId, waiting);
    try {
      await this.persistJob(waiting, { active: true });
      await this.traceStore.appendTimeline(waiting.traceId, {
        type: "manual_review_requested",
        kind: manualReview.kind,
        stage: manualReview.stage,
        scope: manualReview.paperId ? "paper" : "job",
        paperId: manualReview.paperId,
        relatedPaperIds: manualReview.relatedPaperIds,
        summary: manualReview.summary,
        issues: manualReview.issues,
        repairAttempts: manualReview.repairAttempts,
        allowedActions
      });
    } catch (error) {
      this.manualReviews.get(jobId)?.cleanup?.();
      this.manualReviews.delete(jobId);
      throw error;
    }

    try {
      return await promise;
    } finally {
      this.manualReviews.get(jobId)?.cleanup?.();
      this.manualReviews.delete(jobId);
    }
  }

  async decide(jobId, decision = {}) {
    if (!this.isActiveRunning(jobId) || !this.activeJob.manualReview) {
      const error = new Error("The weekly report Job is not waiting for an administrator decision.");
      error.code = "READING_LIST_MANUAL_REVIEW_NOT_PENDING";
      error.statusCode = 409;
      throw error;
    }
    const pending = this.manualReviews.get(jobId);
    if (!pending) {
      const error = new Error("The in-memory administrator decision request is unavailable.");
      error.code = "READING_LIST_MANUAL_REVIEW_UNAVAILABLE";
      error.statusCode = 409;
      throw error;
    }
    const action = String(decision.action || "").trim();
    if (!this.activeJob.manualReview.allowedActions.includes(action)) {
      const error = new Error("The requested administrator action is not allowed for this issue.");
      error.code = "READING_LIST_MANUAL_REVIEW_ACTION_INVALID";
      error.statusCode = 409;
      throw error;
    }
    const requestedPaperId = String(decision.paperId || "").trim();
    const relatedPaperIds = Array.isArray(this.activeJob.manualReview.relatedPaperIds)
      ? this.activeJob.manualReview.relatedPaperIds
      : [];
    let paperId = "";
    if (action === "skip_paper") {
      paperId = requestedPaperId || String(this.activeJob.manualReview.paperId || "").trim();
      const allowedPaperIds = new Set([
        ...relatedPaperIds,
        String(this.activeJob.manualReview.paperId || "").trim()
      ].filter(Boolean));
      if (!paperId || !allowedPaperIds.has(paperId)) {
        const error = new Error("Skip-paper requires the administrator to select one related paper.");
        error.code = "READING_LIST_MANUAL_REVIEW_ACTION_INVALID";
        error.statusCode = 409;
        throw error;
      }
    }

    const decidedAt = new Date().toISOString();
    const next = {
      ...this.activeJob,
      manualReview: null,
      updatedAt: decidedAt
    };
    assertWeeklyReportJob(next);
    await this.traceStore.appendTimeline(next.traceId, {
      type: "manual_review_decided",
      stage: next.agentStage,
      scope: paperId ? "paper" : "job",
      action,
      paperId,
      decidedAt
    });
    await this.persistJob(next, { active: true });
    this.activeJob = next;
    this.jobs.set(jobId, next);
    pending.resolve({ action, paperId, decidedAt });
    return publicJob(next);
  }

  async cancel(jobId) {
    const existingFinalization = this.finalizations.get(jobId);

    if (existingFinalization) {
      return existingFinalization;
    }

    if (!this.isActiveRunning(jobId)) {
      return this.getJob(jobId);
    }

    const cancelling = {
      ...this.activeJob,
      cancelRequested: true,
      updatedAt: new Date().toISOString()
    };
    this.activeJob = cancelling;
    this.jobs.set(jobId, cancelling);
    await this.persistJob(cancelling, { active: true });
    this.abortControllers.get(jobId)?.abort();
    await this.traceStore.appendTimeline(cancelling.traceId, {
      type: "job_cancel_requested",
      stage: cancelling.agentStage,
      outcome: "reject",
      reason: "admin_cancelled"
    });
    return this.finish(jobId, {
      state: "reject",
      reason: "admin_cancelled",
      error: {
        code: "READING_LIST_JOB_CANCELLED",
        message: "The weekly report Job was cancelled by the administrator.",
        retryable: true
      }
    });
  }

  async finish(jobId, options = {}) {
    const existingFinalization = this.finalizations.get(jobId);

    if (existingFinalization) {
      return existingFinalization;
    }

    const operation = this.finishOnce(jobId, options);
    this.finalizations.set(jobId, operation);
    try {
      return await operation;
    } catch (error) {
      this.finalizations.delete(jobId);
      throw error;
    }
  }

  async finishOnce(jobId, {
    state,
    reason,
    result,
    error,
    markdown,
    publishOutput,
    publishInput,
    publishSignal
  } = {}) {
    if (!this.isActiveRunning(jobId)) {
      return this.getJob(jobId);
    }

    let finalState = state;
    let finalReason = reason;
    let finalResult = result;
    let finalError = error;

    if (state === "publish") {
      try {
        await this.publish(publishOutput, {
          job: publicJob(this.activeJob),
          input: publishInput,
          signal: publishSignal
        });
      } catch (publishError) {
        const error = publishError instanceof Error
          ? publishError
          : new Error(String(publishError || "Weekly report publication failed."));
        error.code = String(error.code || "READING_LIST_PUBLISH_FAILED");
        error.stage = "publish";
        error.retryable = Boolean(error.retryable);
        error.rejectJob = true;
        throw error;
      }
    }

    const job = finalizeWeeklyReportJob(this.activeJob, {
      state: finalState,
      reason: finalReason,
      result: finalResult,
      error: finalError ? redactTraceValue(finalError) : null
    });

    if (markdown) {
      await this.traceStore.writeResult(job.traceId, markdown);
    }

    await this.traceStore.appendTimeline(job.traceId, {
      type: "job_completed",
      stage: finalState,
      outcome: finalState,
      reason: job.result.reason
    });
    await this.traceStore.updateMeta(job.traceId, {
      state: finalState,
      result: job.result,
      error: job.error,
      completedAt: job.completedAt
    });
    await this.persistJob(job, { active: false });
    this.jobs.set(jobId, job);
    this.activeJob = null;
    this.abortControllers.delete(jobId);
    this.manualReviews.delete(jobId);
    const completion = this.completions.get(jobId);
    completion?.resolve(publicJob(job));
    this.completions.delete(jobId);
    return publicJob(job);
  }

  async persistJob(job, { active }) {
    assertWeeklyReportJob(job);
    const persisted = redactTraceValue(job);
    await writeJsonAtomic(this.jobPath(job.jobId), persisted);

    if (active) {
      await writeJsonAtomic(this.activePath, persisted);
    } else {
      await rm(this.activePath, { force: true });
    }
  }

  async getActive() {
    return this.activeJob?.state === "running" ? publicJob(this.activeJob) : null;
  }

  async getJob(jobId) {
    const memoryJob = this.jobs.get(jobId);
    if (memoryJob) {
      return publicJob(memoryJob);
    }

    const persisted = await readJsonIfPresent(this.jobPath(jobId));
    if (!persisted) {
      return null;
    }

    assertWeeklyReportJob(persisted);
    this.jobs.set(jobId, persisted);
    return publicJob(persisted);
  }

  async waitForCompletion(jobId) {
    const completion = this.completions.get(jobId);
    if (completion) {
      return completion.promise;
    }

    return this.getJob(jobId);
  }
}
