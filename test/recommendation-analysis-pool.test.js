import assert from "node:assert/strict";
import { test } from "node:test";

const analysisPool = await import("../public/analysis-pool.js").catch(() => null);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("recommendation progress separates successful and failed paper counts", () => {
  assert.ok(analysisPool, "analysis pool module should exist");
  assert.equal(typeof analysisPool.analysisProgressCounts, "function");
  assert.deepEqual(analysisPool.analysisProgressCounts({
    settled: 5,
    failed: 1,
    total: 5
  }), {
    settled: 5,
    successful: 4,
    failed: 1,
    total: 5,
    percent: 100
  });
});

test("paper analysis pool runs at most three single-paper tasks and preserves input order", async () => {
  assert.ok(analysisPool, "analysis pool module should exist");

  let active = 0;
  let maxActive = 0;
  const items = [0, 1, 2, 3, 4, 5, 6];
  const outcome = await analysisPool.runConcurrentTasks(items, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await wait((6 - item) % 3 + 1);
    active -= 1;
    return item * 10;
  }, { concurrency: 3 });

  assert.equal(maxActive, 3);
  assert.deepEqual(outcome.results.map(({ index, item, value }) => ({ index, item, value })), [
    { index: 0, item: 0, value: 0 },
    { index: 1, item: 1, value: 10 },
    { index: 2, item: 2, value: 20 },
    { index: 3, item: 3, value: 30 },
    { index: 4, item: 4, value: 40 },
    { index: 5, item: 5, value: 50 },
    { index: 6, item: 6, value: 60 }
  ]);
  assert.deepEqual(outcome.errors, []);
  assert.equal(outcome.skipped.length, 0);
});

test("one paper failure does not cancel other paper analyses", async () => {
  assert.ok(analysisPool, "analysis pool module should exist");

  const started = [];
  const settled = [];
  const items = ["a", "b", "c", "d"];
  const outcome = await analysisPool.runConcurrentTasks(items, async (item) => {
    started.push(item);
    await wait(1);
    if (item === "b") {
      throw new Error("paper b failed");
    }
    return item.toUpperCase();
  }, {
    concurrency: 3,
    onSettled: (entry) => settled.push([entry.item, entry.status])
  });

  assert.deepEqual(started.sort(), items);
  assert.deepEqual(outcome.results.map(({ item, value }) => [item, value]), [
    ["a", "A"],
    ["c", "C"],
    ["d", "D"]
  ]);
  assert.equal(outcome.errors.length, 1);
  assert.equal(outcome.errors[0].item, "b");
  assert.match(outcome.errors[0].error.message, /paper b failed/);
  assert.equal(settled.length, 4);
});

test("paper analysis pool stops scheduling new work after the caller reaches its target", async () => {
  assert.ok(analysisPool, "analysis pool module should exist");

  const started = [];
  const outcome = await analysisPool.runConcurrentTasks([0, 1, 2, 3, 4, 5], async (item) => {
    started.push(item);
    await wait(1);
    return item;
  }, {
    concurrency: 3,
    onSettled: () => false
  });

  assert.equal(started.length, 3);
  assert.equal(outcome.results.length, 3);
  assert.equal(outcome.skipped.length, 3);
});

test("skipping the current failed paper preserves successes and keeps later failures available", () => {
  assert.ok(analysisPool, "analysis pool module should exist");
  assert.equal(typeof analysisPool.skipFailedAnalysisPaper, "function");

  const successful = { id: "success", title: "Successful paper" };
  const firstFailure = { id: "1301", title: "Paper blocked by 1301" };
  const secondFailure = { id: "other", title: "Another failed paper" };
  const session = {
    analyzed: [successful],
    failedPapers: [firstFailure, secondFailure],
    failedPaper: firstFailure,
    skippedAnalysisPapers: []
  };

  const firstResult = analysisPool.skipFailedAnalysisPaper(session);

  assert.equal(firstResult.skipped, firstFailure);
  assert.deepEqual(session.analyzed, [successful]);
  assert.deepEqual(session.failedPapers, [secondFailure]);
  assert.equal(session.failedPaper, secondFailure);
  assert.deepEqual(session.skippedAnalysisPapers, [firstFailure]);

  const secondResult = analysisPool.skipFailedAnalysisPaper(session);

  assert.equal(secondResult.skipped, secondFailure);
  assert.deepEqual(session.failedPapers, []);
  assert.equal(session.failedPaper, null);
  assert.deepEqual(session.skippedAnalysisPapers, [firstFailure, secondFailure]);
});
