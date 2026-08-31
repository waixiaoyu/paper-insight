const normalizedConcurrency = (value, itemCount) => Math.min(
  Math.max(1, Math.floor(Number(value) || 1)),
  Math.max(1, itemCount)
);

export function analysisProgressCounts({ settled = 0, failed = 0, total = 0 } = {}) {
  const normalizedTotal = Math.max(0, Math.floor(Number(total) || 0));
  const normalizedSettled = Math.min(
    normalizedTotal,
    Math.max(0, Math.floor(Number(settled) || 0))
  );
  const normalizedFailed = Math.min(
    normalizedSettled,
    Math.max(0, Math.floor(Number(failed) || 0))
  );

  return {
    settled: normalizedSettled,
    successful: normalizedSettled - normalizedFailed,
    failed: normalizedFailed,
    total: normalizedTotal,
    percent: normalizedTotal ? Math.round((normalizedSettled / normalizedTotal) * 100) : 0
  };
}

export function skipFailedAnalysisPaper(session = {}) {
  const failedPapers = Array.isArray(session.failedPapers) ? [...session.failedPapers] : [];
  const skipped = failedPapers.shift() || null;
  session.failedPapers = failedPapers;
  session.failedPaper = failedPapers[0] || null;
  session.skippedAnalysisPapers = Array.isArray(session.skippedAnalysisPapers)
    ? session.skippedAnalysisPapers
    : [];

  if (skipped) {
    session.skippedAnalysisPapers.push(skipped);
  }

  return {
    skipped,
    remaining: [...failedPapers]
  };
}

export async function runConcurrentTasks(items, worker, options = {}) {
  const tasks = Array.isArray(items) ? items : [];

  if (!tasks.length) {
    return { results: [], errors: [], skipped: [], completed: 0 };
  }

  const concurrency = normalizedConcurrency(options.concurrency, tasks.length);
  const results = [];
  const errors = [];
  const settledIndexes = new Set();
  let nextIndex = 0;
  let stopped = false;
  let completed = 0;

  const runWorker = async () => {
    while (!stopped) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= tasks.length) {
        return;
      }

      const item = tasks[index];
      let entry;

      try {
        const value = await worker(item, index);
        entry = { status: "fulfilled", index, item, value };
        results.push(entry);
      } catch (error) {
        entry = { status: "rejected", index, item, error };
        errors.push(entry);
      }

      settledIndexes.add(index);
      completed += 1;
      const shouldContinue = await options.onSettled?.({
        ...entry,
        completed,
        total: tasks.length
      });

      if (shouldContinue === false) {
        stopped = true;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, runWorker));
  results.sort((a, b) => a.index - b.index);
  errors.sort((a, b) => a.index - b.index);

  const skipped = tasks
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !settledIndexes.has(index));

  return { results, errors, skipped, completed };
}
