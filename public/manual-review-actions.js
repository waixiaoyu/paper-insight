export async function submitWeeklyReportManualReviewDecision({
  requestDecision,
  refreshJob,
  setPending
} = {}) {
  if (typeof requestDecision !== "function") {
    throw new TypeError("requestDecision is required");
  }

  setPending?.(true);
  try {
    return { job: await requestDecision(), error: null };
  } catch (error) {
    const refreshedJob = typeof refreshJob === "function"
      ? await refreshJob().catch(() => null)
      : null;
    return { job: refreshedJob, error };
  } finally {
    setPending?.(false);
  }
}
