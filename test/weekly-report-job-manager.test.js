import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { WeeklyReportJobManager } from "../weekly-report/job-manager.js";
import { WeeklyReportTraceStore } from "../weekly-report/trace-store.js";

const tempDirectories = [];

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createHarness = async (options = {}) => {
  const rootDir = await mkdtemp(join(tmpdir(), "paper-insight-job-"));
  tempDirectories.push(rootDir);
  const jobsDir = join(rootDir, "jobs");
  const traceStore = new WeeklyReportTraceStore({ rootDir: join(rootDir, "traces") });
  const manager = new WeeklyReportJobManager({
    jobsDir,
    traceStore,
    ...options
  });
  await manager.initialize();
  return { jobsDir, manager, rootDir, traceStore };
};

const waitForManualReview = async (manager, jobId) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await manager.getJob(jobId);
    if (job?.manualReview) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for weekly report manual review.");
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

test("创建 Job 立即返回，后台继续执行且第二次创建复用活动任务", async () => {
  const gate = deferred();
  let executions = 0;
  const { manager } = await createHarness({
    execute: async (_input, context) => {
      executions += 1;
      await context.updateStage("extract_evidence");
      await gate.promise;
      return { state: "publish", markdown: "# 周报" };
    }
  });

  const first = await manager.createOrReuse({ reportKey: "2026-W31" });
  const second = await manager.createOrReuse({ reportKey: "another-report" });

  assert.equal(first.state, "running");
  assert.equal(first.reusedActiveJob, false);
  assert.equal(second.reusedActiveJob, true);
  assert.equal(second.jobId, first.jobId);
  assert.equal(executions, 1);

  gate.resolve();
  const completed = await manager.waitForCompletion(first.jobId);
  assert.equal(completed.state, "publish");
  assert.equal((await manager.getActive()), null);
});

test("阶段和 Trace 事件会更新活动任务的可观察进展并写入 active.json", async () => {
  const recorded = deferred();
  const release = deferred();
  const { jobsDir, manager } = await createHarness({
    execute: async (_input, context) => {
      await context.updateStage("extract_evidence");
      await context.recordTrace({
        type: "evidence_processing_completed",
        stage: "extract_evidence",
        paperId: "2608.10001",
        outcome: "continue"
      });
      recorded.resolve();
      await release.promise;
      return { state: "publish", markdown: "# 周报" };
    }
  });

  const created = await manager.createOrReuse({ reportKey: "2026-W34-progress" });
  await recorded.promise;
  const active = await manager.getActive();
  const persisted = JSON.parse(await readFile(join(jobsDir, "active.json"), "utf8"));

  assert.equal(active.progress.lastEventType, "evidence_processing_completed");
  assert.equal(active.progress.paperId, "2608.10001");
  assert.equal(active.progress.stageStartedAt, persisted.progress.stageStartedAt);
  assert.equal(active.progress.lastEventAt, persisted.progress.lastEventAt);
  assert.ok(Date.parse(active.progress.lastEventAt) >= Date.parse(created.createdAt));

  release.resolve();
  const completed = await manager.waitForCompletion(created.jobId);
  assert.equal(completed.progress.lastEventType, "job_completed");
  assert.equal(completed.progress.paperId, "2608.10001");
});

test("并发 Trace 事件按调用顺序串行持久化且活动进度不会回退", async () => {
  const release = deferred();
  const { manager, traceStore } = await createHarness({
    execute: async (_input, context) => {
      await Promise.all([
        context.recordTrace({ type: "first_parallel_event", stage: "extract_evidence", paperId: "first" }),
        context.recordTrace({ type: "second_parallel_event", stage: "extract_evidence", paperId: "second" })
      ]);
      await release.promise;
      return { state: "publish", markdown: "# 周报" };
    }
  });
  const originalAppendTimeline = traceStore.appendTimeline.bind(traceStore);
  traceStore.appendTimeline = async (traceId, event) => {
    if (event.type === "first_parallel_event") {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return originalAppendTimeline(traceId, event);
  };

  const created = await manager.createOrReuse({ reportKey: "2026-W34-parallel-trace" });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const active = await manager.getActive();
    if (active?.progress?.lastEventType === "second_parallel_event") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const active = await manager.getActive();
  const trace = await traceStore.readTrace(created.traceId);
  const eventTypes = trace.timeline
    .filter((event) => event.type.endsWith("parallel_event"))
    .map((event) => event.type);

  assert.deepEqual(eventTypes, ["first_parallel_event", "second_parallel_event"]);
  assert.equal(active.progress.lastEventType, "second_parallel_event");
  assert.equal(active.progress.paperId, "second");

  release.resolve();
  await manager.waitForCompletion(created.jobId);
});

test("取消终态等待在途 Trace 落盘，持久化状态不会从 reject 回退为 running", async () => {
  const tracePersistStarted = deferred();
  const allowTracePersist = deferred();
  const tracePersisted = deferred();
  const { jobsDir, manager } = await createHarness({
    execute: async (_input, context) => {
      await context.recordTrace({ type: "slow_event", stage: "extract_evidence", paperId: "2608.10009" });
      if (!context.signal.aborted) {
        await new Promise((resolve) => context.signal.addEventListener("abort", resolve, { once: true }));
      }
      return { state: "reject", reason: "admin_cancelled" };
    }
  });
  const originalPersistJob = manager.persistJob.bind(manager);
  manager.persistJob = async (job, options) => {
    if (job.state === "running"
      && job.cancelRequested !== true
      && job.progress?.lastEventType === "slow_event") {
      tracePersistStarted.resolve();
      await allowTracePersist.promise;
      const result = await originalPersistJob(job, options);
      tracePersisted.resolve();
      return result;
    }
    return originalPersistJob(job, options);
  };

  const created = await manager.createOrReuse({ reportKey: "2026-W34-cancel-trace-race" });
  await tracePersistStarted.promise;
  const cancellation = manager.cancel(created.jobId);
  setTimeout(() => allowTracePersist.resolve(), 30);
  const [completed] = await Promise.all([cancellation, tracePersisted.promise]);
  const persisted = JSON.parse(await readFile(join(jobsDir, `job-${created.jobId}.json`), "utf8"));

  assert.equal(completed.state, "reject");
  assert.equal(persisted.state, "reject");
  await assert.rejects(() => readFile(join(jobsDir, "active.json"), "utf8"), { code: "ENOENT" });
});

test("管理员取消会中止后台信号、落为 reject 并且绝不调用发布写入", async () => {
  const started = deferred();
  const stopped = deferred();
  let publishCalls = 0;
  const { manager } = await createHarness({
    execute: async (_input, { signal }) => {
      started.resolve();
      await new Promise((resolve) => {
        signal.addEventListener("abort", resolve, { once: true });
      });
      stopped.resolve();
      return { state: "publish", markdown: "# 不应发布" };
    },
    publish: async () => {
      publishCalls += 1;
    }
  });

  const created = await manager.createOrReuse({ reportKey: "2026-W31" });
  await started.promise;
  const cancelled = await manager.cancel(created.jobId);
  await stopped.promise;
  const completed = await manager.waitForCompletion(created.jobId);

  assert.equal(cancelled.state, "reject");
  assert.equal(cancelled.result.reason, "admin_cancelled");
  assert.equal(completed.state, "reject");
  assert.equal(publishCalls, 0);
  assert.equal((await manager.getActive()), null);
});

test("发布提交一旦开始便只完成同一个终局，迟到的取消不能制造伪 reject", async () => {
  const publishStarted = deferred();
  const allowPublish = deferred();
  let publishCalls = 0;
  const { manager } = await createHarness({
    execute: async () => ({ state: "publish", markdown: "# 已通过质量门" }),
    publish: async () => {
      publishCalls += 1;
      publishStarted.resolve();
      await allowPublish.promise;
    }
  });

  const created = await manager.createOrReuse({ reportKey: "2026-W31" });
  await publishStarted.promise;
  const cancellation = manager.cancel(created.jobId);
  allowPublish.resolve();

  const [cancelResult, completed] = await Promise.all([
    cancellation,
    manager.waitForCompletion(created.jobId)
  ]);

  assert.equal(publishCalls, 1);
  assert.equal(cancelResult.state, "publish");
  assert.equal(completed.state, "publish");
  assert.equal(completed.cancelRequested, false);
});

test("执行失败和非法完成态统一转为 reject，不存在隐式旧链路降级", async () => {
  let legacyFallbackCalls = 0;
  const { manager } = await createHarness({
    execute: async () => ({ state: "review", markdown: "# 草稿" }),
    legacyFallback: async () => {
      legacyFallbackCalls += 1;
    }
  });

  const created = await manager.createOrReuse({ reportKey: "2026-W31" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const waiting = await manager.getActive();
  assert.equal(waiting.state, "running");
  assert.deepEqual(waiting.manualReview.allowedActions, ["retry_job", "exit_task"]);

  await manager.decide(created.jobId, { action: "exit_task" });
  const completed = await manager.waitForCompletion(created.jobId);

  assert.equal(completed.state, "reject");
  assert.equal(completed.result.reason, "admin_rejected");
  assert.equal(completed.error.code, "READING_LIST_PUBLISH_REJECTED");
  assert.equal(legacyFallbackCalls, 0);
});

test("自动拒绝先等待管理员决定，重试后才继续执行任务", async () => {
  const requestingReview = deferred();
  let executions = 0;
  const { manager, traceStore } = await createHarness({
    execute: async () => {
      executions += 1;
      if (executions === 1) {
        requestingReview.resolve();
        const error = new Error("Evidence model call failed twice.");
        error.code = "READING_LIST_AGENT_CALL_FAILED";
        error.stage = "extract_evidence";
        error.paperId = "2608.08996";
        error.retryable = true;
        error.rejectJob = true;
        throw error;
      }
      return { state: "publish", markdown: "# 已重试周报" };
    }
  });

  const created = await manager.createOrReuse({ reportKey: "2026-W32-retry" });
  await requestingReview.promise;
  await new Promise((resolve) => setTimeout(resolve, 10));
  const waiting = await manager.getActive();

  assert.equal(waiting.state, "running");
  assert.equal(waiting.manualReview.stage, "extract_evidence");
  assert.equal(waiting.manualReview.paperId, "2608.08996");
  assert.deepEqual(waiting.manualReview.allowedActions, ["retry_job", "exit_task"]);

  await manager.decide(created.jobId, { action: "retry_job" });
  const completed = await manager.waitForCompletion(created.jobId);
  const trace = await traceStore.readTrace(created.traceId);

  assert.equal(executions, 2);
  assert.equal(completed.state, "publish");
  assert.equal(trace.timeline.some((event) => event.type === "manual_review_decided" && event.action === "retry_job"), true);
});

test("未标记的执行异常也会等待管理员决定", async () => {
  const { manager } = await createHarness({
    execute: async () => {
      throw new Error("unexpected pipeline failure");
    }
  });

  const created = await manager.createOrReuse({ reportKey: "2026-W32-unmarked-error" });
  const waiting = await waitForManualReview(manager, created.jobId);
  assert.equal(waiting.manualReview.stage, "create_job");
  assert.equal(waiting.manualReview.issues[0].detail, "");
  assert.deepEqual(waiting.manualReview.allowedActions, ["retry_job", "exit_task"]);

  await manager.decide(created.jobId, { action: "exit_task" });
  const completed = await manager.waitForCompletion(created.jobId);
  assert.equal(completed.state, "reject");
  assert.equal(completed.result.reason, "admin_rejected");
  assert.match(completed.error.message, /unexpected pipeline failure/);
});

test("发布写入失败会等待管理员决定", async () => {
  let publishCalls = 0;
  const { manager } = await createHarness({
    execute: async () => ({ state: "publish", markdown: "# Report" }),
    publish: async () => {
      publishCalls += 1;
      throw new Error("report storage unavailable");
    }
  });

  const created = await manager.createOrReuse({ reportKey: "2026-W32-publish-failure" });
  const waiting = await waitForManualReview(manager, created.jobId);
  assert.equal(waiting.manualReview.stage, "publish");

  await manager.decide(created.jobId, { action: "exit_task" });
  const completed = await manager.waitForCompletion(created.jobId);
  assert.equal(publishCalls, 1);
  assert.equal(completed.result.reason, "admin_rejected");
  assert.equal(completed.error.code, "READING_LIST_PUBLISH_FAILED");
});

test("已确认的管理员退出不会再次请求任务重试", async () => {
  const { manager } = await createHarness({
    execute: async () => {
      const error = new Error("Administrator exited Editorial Plan review.");
      error.code = "READING_LIST_ADMIN_REJECTED";
      error.stage = "editorial_plan";
      error.rejectJob = true;
      throw error;
    }
  });

  const created = await manager.createOrReuse({ reportKey: "2026-W32-editorial-exit" });
  const completed = await manager.waitForCompletion(created.jobId);
  assert.equal(completed.state, "reject");
  assert.equal(completed.result.reason, "admin_rejected");
  assert.equal(completed.error.code, "READING_LIST_ADMIN_REJECTED");
  assert.equal((await manager.getActive()), null);
});

test("服务启动发现遗留 running Job 时标记 agent_interrupted 并释放全局锁", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "paper-insight-job-restart-"));
  tempDirectories.push(rootDir);
  const jobsDir = join(rootDir, "jobs");
  const traceStore = new WeeklyReportTraceStore({ rootDir: join(rootDir, "traces") });
  const firstManager = new WeeklyReportJobManager({
    jobsDir,
    traceStore,
    execute: async () => new Promise(() => {})
  });
  await firstManager.initialize();
  const running = await firstManager.createOrReuse({ reportKey: "2026-W31" });

  const persistedActive = JSON.parse(await readFile(join(jobsDir, "active.json"), "utf8"));
  assert.equal(persistedActive.state, "running");
  delete persistedActive.progress;
  await writeFile(join(jobsDir, "active.json"), `${JSON.stringify(persistedActive, null, 2)}\n`, "utf8");

  const restartedManager = new WeeklyReportJobManager({
    jobsDir,
    traceStore,
    execute: async () => ({ state: "reject", reason: "test_complete" })
  });
  await restartedManager.initialize();

  const interrupted = await restartedManager.getJob(running.jobId);
  assert.equal(interrupted.state, "reject");
  assert.equal(interrupted.result.reason, "agent_interrupted");
  assert.equal(interrupted.progress.lastEventType, "legacy_job_loaded");
  assert.equal((await restartedManager.getActive()), null);

  const next = await restartedManager.createOrReuse({ reportKey: "2026-W32" });
  assert.equal(next.reusedActiveJob, false);
  assert.notEqual(next.jobId, running.jobId);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await restartedManager.decide(next.jobId, { action: "exit_task" });
  await restartedManager.waitForCompletion(next.jobId);
});

test("遗留 active.json 即使缺少 Trace 目录也能恢复为 agent_interrupted", async () => {
  const { jobsDir, manager } = await createHarness({
    execute: async () => new Promise(() => {})
  });
  const running = await manager.createOrReuse({ reportKey: "2026-W31" });
  await rm(join(dirname(jobsDir), "traces", running.traceId), { recursive: true, force: true });

  const restartedTraceStore = new WeeklyReportTraceStore({ rootDir: join(dirname(jobsDir), "traces") });
  const restartedManager = new WeeklyReportJobManager({
    jobsDir,
    traceStore: restartedTraceStore
  });
  await restartedManager.initialize();

  const interrupted = await restartedManager.getJob(running.jobId);
  const trace = await restartedTraceStore.readTrace(running.traceId);
  assert.equal(interrupted.state, "reject");
  assert.equal(interrupted.result.reason, "agent_interrupted");
  assert.equal(trace.meta.state, "reject");
  assert.equal(trace.timeline.some((event) => event.type === "job_interrupted"), true);
});

test("Job 输入只以脱敏快照进入 Trace，认证信息不写入 Job 文件", async () => {
  const { jobsDir, manager, traceStore } = await createHarness({
    execute: async () => ({ state: "reject", reason: "no_eligible_papers", markdown: "# 拒绝稿" })
  });
  const created = await manager.createOrReuse({
    reportKey: "2026-W31",
    llmApiKey: "job-file-secret",
    headers: { Cookie: "sid=job-cookie" }
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await manager.decide(created.jobId, { action: "exit_task" });
  await manager.waitForCompletion(created.jobId);

  const jobText = await readFile(join(jobsDir, `job-${created.jobId}.json`), "utf8");
  const trace = await traceStore.readTrace(created.traceId);
  const traceText = JSON.stringify(trace);

  assert.doesNotMatch(jobText, /job-file-secret|job-cookie/);
  assert.doesNotMatch(traceText, /job-file-secret|job-cookie/);
  assert.match(traceText, /\[REDACTED\]/);
});

test("manual review keeps the Job running until the administrator decides", async () => {
  const requestingReview = deferred();
  const { manager, traceStore } = await createHarness({
    execute: async (_input, context) => {
      requestingReview.resolve();
      const decision = await context.requestManualReview({
        stage: "paper_semantic_qa",
        paperId: "2608.50001",
        issues: [{ code: "unsupported_fact", reason: "The claim is unsupported." }],
        repairAttempts: 3,
        allowedActions: ["continue_repair", "exit_task", "skip_paper"]
      });
      return decision.action === "exit_task"
        ? { state: "reject", reason: "admin_rejected" }
        : { state: "publish", markdown: "# Unexpected" };
    }
  });

  const created = await manager.createOrReuse({ reportKey: "2026-W32-manual" });
  await requestingReview.promise;
  await new Promise((resolve) => setTimeout(resolve, 10));
  const waiting = await manager.getActive();

  assert.equal(waiting.state, "running");
  assert.equal(waiting.agentStage, "paper_semantic_qa");
  assert.equal(waiting.manualReview.paperId, "2608.50001");
  assert.equal(waiting.manualReview.repairAttempts, 3);
  assert.deepEqual(waiting.manualReview.allowedActions, ["continue_repair", "exit_task", "skip_paper"]);

  const decided = await manager.decide(created.jobId, { action: "exit_task" });
  const completed = await manager.waitForCompletion(created.jobId);
  const trace = await traceStore.readTrace(created.traceId);

  assert.equal(decided.state, "running");
  assert.equal(decided.manualReview, null);
  assert.equal(completed.state, "reject");
  assert.equal(completed.result.reason, "admin_rejected");
  assert.equal(trace.timeline.some((event) => event.type === "manual_review_requested"), true);
  assert.equal(trace.timeline.some((event) => event.type === "manual_review_decided" && event.action === "exit_task"), true);
});

test("manual review requires skip-paper to select one related paper and records that selection", async () => {
  const requestingReview = deferred();
  const { manager, traceStore } = await createHarness({
    execute: async (_input, context) => {
      requestingReview.resolve();
      const decision = await context.requestManualReview({
        stage: "editorial_plan",
        paperId: "",
        relatedPaperIds: ["2608.02764", "2608.08037"],
        issues: [{ code: "rhetorical_prose_style", path: "trends[0].caveat" }],
        repairAttempts: 3,
        allowedActions: ["skip_paper", "exit_task"]
      });
      return decision.action === "skip_paper" && decision.paperId === "2608.08037"
        ? { state: "reject", reason: "admin_rejected" }
        : { state: "reject", reason: "unexpected_decision" };
    }
  });
  const created = await manager.createOrReuse({ reportKey: "2026-W32-scoped-skip" });
  await requestingReview.promise;
  await new Promise((resolve) => setTimeout(resolve, 10));

  await assert.rejects(
    () => manager.decide(created.jobId, { action: "skip_paper" }),
    /select one related paper/i
  );
  await manager.decide(created.jobId, { action: "skip_paper", paperId: "2608.08037" });
  await manager.waitForCompletion(created.jobId);
  const trace = await traceStore.readTrace(created.traceId);

  assert.equal(trace.timeline.some((event) => event.type === "manual_review_decided"
    && event.action === "skip_paper" && event.paperId === "2608.08037"), true);
});

test("a failed decision Trace write leaves manual review visible and retryable", async () => {
  const requestingReview = deferred();
  const { manager, traceStore } = await createHarness({
    execute: async (_input, context) => {
      requestingReview.resolve();
      const decision = await context.requestManualReview({
        stage: "paper_semantic_qa",
        paperId: "2608.50002",
        issues: [{ code: "input_identity_mismatch" }],
        repairAttempts: 0,
        allowedActions: ["exit_task", "skip_paper"]
      });
      return { state: "reject", reason: decision.action === "exit_task" ? "admin_rejected" : "paper_skipped" };
    }
  });
  const originalAppendTimeline = traceStore.appendTimeline.bind(traceStore);
  let failDecisionTrace = true;
  traceStore.appendTimeline = async (traceId, event) => {
    if (failDecisionTrace && event?.type === "manual_review_decided") {
      throw new Error("simulated trace write failure");
    }
    return originalAppendTimeline(traceId, event);
  };

  const created = await manager.createOrReuse({ reportKey: "2026-W33-trace-retry" });
  await requestingReview.promise;
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(
    () => manager.decide(created.jobId, { action: "exit_task" }),
    /simulated trace write failure/
  );
  const stillWaiting = await manager.getActive();
  assert.equal(stillWaiting.state, "running");
  assert.equal(stillWaiting.manualReview.paperId, "2608.50002");

  failDecisionTrace = false;
  await manager.decide(created.jobId, { action: "exit_task" });
  const completed = await manager.waitForCompletion(created.jobId);
  assert.equal(completed.state, "reject");
  assert.equal(completed.result.reason, "admin_rejected");
});
