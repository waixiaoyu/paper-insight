import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  const completed = await manager.waitForCompletion(created.jobId);

  assert.equal(completed.state, "reject");
  assert.equal(completed.result.reason, "invalid_job_result");
  assert.equal(legacyFallbackCalls, 0);
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

  const restartedManager = new WeeklyReportJobManager({
    jobsDir,
    traceStore,
    execute: async () => ({ state: "reject", reason: "test_complete" })
  });
  await restartedManager.initialize();

  const interrupted = await restartedManager.getJob(running.jobId);
  assert.equal(interrupted.state, "reject");
  assert.equal(interrupted.result.reason, "agent_interrupted");
  assert.equal((await restartedManager.getActive()), null);

  const next = await restartedManager.createOrReuse({ reportKey: "2026-W32" });
  assert.equal(next.reusedActiveJob, false);
  assert.notEqual(next.jobId, running.jobId);
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
