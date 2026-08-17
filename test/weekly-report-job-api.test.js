import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const waitForFinalJob = async (baseUrl, jobId, fetchImpl) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetchImpl(`${baseUrl}/api/reading-list/jobs/${jobId}`);
    const job = await response.json();
    if (job.state !== "running") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Weekly report Job did not finish in time.");
};

const waitForManualReview = async (baseUrl, jobId, fetchImpl) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetchImpl(`${baseUrl}/api/reading-list/jobs/${jobId}`);
    const job = await response.json();
    if (job.state === "running" && job.manualReview) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Weekly report Job did not reach manual review in time.");
};

test("异步周报 Job API 支持创建、复用、查询、Trace、结果和取消", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "paper-insight-job-api-"));
  const nativeFetch = globalThis.fetch;
  const arxivGate = deferred();
  const previousEnvironment = Object.fromEntries([
    "ARXIV_AUTO_SYNC",
    "ARXIV_MIN_INTERVAL_MS",
    "WEEKLY_REPORT_JOBS_DIR",
    "WEEKLY_REPORT_TRACES_DIR"
  ].map((key) => [key, process.env[key]]));
  let appServer;

  try {
    process.env.ARXIV_AUTO_SYNC = "0";
    process.env.ARXIV_MIN_INTERVAL_MS = "0";
    process.env.WEEKLY_REPORT_JOBS_DIR = join(rootDir, "jobs");
    process.env.WEEKLY_REPORT_TRACES_DIR = join(rootDir, "traces");
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("https://arxiv.org/html/")) {
        return arxivGate.promise;
      }
      return nativeFetch(input, init);
    };

    ({ server: appServer } = await import(`../server.js?weekly-job-api=${Date.now()}`));
    await new Promise((resolve, reject) => {
      appServer.once("error", reject);
      appServer.listen(0, "127.0.0.1", () => {
        appServer.off("error", reject);
        resolve();
      });
    });
    const address = appServer.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const emptyResponse = await fetch(`${baseUrl}/api/reading-list/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportKey: "empty" })
    });
    assert.equal(emptyResponse.status, 400);

    const hiddenResponse = await fetch(`${baseUrl}/api/reading-list/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reportKey: "2026-W32-hidden",
        date: "2026-08-05",
        weekStart: "2026-08-03T00:00:00.000Z",
        weekEnd: "2026-08-10T00:00:00.000Z",
        papers: [{
          id: "2608.41001",
          title: "Hidden candidate",
          published: "2026-08-05T00:00:00.000Z",
          hidden: true
        }]
      })
    });
    const hiddenCreated = await hiddenResponse.json();
    assert.equal(hiddenResponse.status, 202);
    assert.equal(hiddenCreated.state, "running");
    const hiddenWaiting = await waitForManualReview(baseUrl, hiddenCreated.jobId, fetch);
    assert.equal(hiddenWaiting.manualReview.kind, "execution_failure");
    assert.deepEqual(hiddenWaiting.manualReview.allowedActions, ["retry_job", "exit_task"]);

    const hiddenDecisionResponse = await fetch(`${baseUrl}/api/reading-list/jobs/${hiddenCreated.jobId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "exit_task" })
    });
    assert.equal(hiddenDecisionResponse.status, 200);

    const hiddenFinal = await waitForFinalJob(baseUrl, hiddenCreated.jobId, fetch);
    assert.equal(hiddenFinal.state, "reject");
    assert.equal(hiddenFinal.result.reason, "admin_rejected");
    assert.equal(hiddenFinal.error.code, "READING_LIST_NO_ELIGIBLE_PAPERS");

    const traceResponse = await fetch(`${baseUrl}/api/reading-list/jobs/${hiddenCreated.jobId}/trace`);
    const trace = await traceResponse.json();
    assert.equal(traceResponse.status, 200);
    assert.equal(trace.meta.jobId, hiddenCreated.jobId);
    assert.equal(trace.timeline.some((event) => event.type === "job_completed"), true);

    const resultResponse = await fetch(`${baseUrl}/api/reading-list/jobs/${hiddenCreated.jobId}/result`);
    const rejectedResult = await resultResponse.json();
    assert.equal(rejectedResult.state, "reject");
    assert.equal(rejectedResult.reason, "admin_rejected");

    const runningPayload = {
      reportKey: "2026-W32-running",
      date: "2026-08-05",
      weekStart: "2026-08-03T00:00:00.000Z",
      weekEnd: "2026-08-10T00:00:00.000Z",
      papers: [{
        id: "2608.41002",
        absLink: "https://arxiv.org/abs/2608.41002",
        title: "Running candidate",
        published: "2026-08-05T00:00:00.000Z"
      }]
    };
    const firstRunningResponse = await fetch(`${baseUrl}/api/reading-list/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runningPayload)
    });
    const firstRunning = await firstRunningResponse.json();
    const reusedResponse = await fetch(`${baseUrl}/api/reading-list/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...runningPayload, reportKey: "must-not-start" })
    });
    const reused = await reusedResponse.json();
    assert.equal(firstRunningResponse.status, 202);
    assert.equal(reused.jobId, firstRunning.jobId);
    assert.equal(reused.reusedActiveJob, true);

    const activeResponse = await fetch(`${baseUrl}/api/reading-list/jobs/active`);
    const active = await activeResponse.json();
    assert.equal(active.jobId, firstRunning.jobId);

    const staleDecisionResponse = await fetch(`${baseUrl}/api/reading-list/jobs/${firstRunning.jobId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "continue_repair" })
    });
    const staleDecision = await staleDecisionResponse.json();

    const cancelResponse = await fetch(`${baseUrl}/api/reading-list/jobs/${firstRunning.jobId}/cancel`, {
      method: "POST"
    });
    const cancelled = await cancelResponse.json();
    assert.equal(cancelResponse.status, 200);
    assert.equal(cancelled.state, "reject");
    assert.equal(cancelled.result.reason, "admin_cancelled");
    assert.equal(staleDecisionResponse.status, 409);
    assert.equal(staleDecision.error, "READING_LIST_MANUAL_REVIEW_NOT_PENDING");

    const activeAfterCancelResponse = await fetch(`${baseUrl}/api/reading-list/jobs/active`);
    assert.equal(await activeAfterCancelResponse.json(), null);
    arxivGate.resolve(new Response("Service unavailable", { status: 503 }));
  } finally {
    globalThis.fetch = nativeFetch;
    if (appServer?.listening) {
      await closeServer(appServer);
    }
    Object.entries(previousEnvironment).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    await rm(rootDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 20
    });
  }
});
