const manualReviewActionLabels = Object.freeze({
  continue_repair: "继续定向修正",
  retry_job: "重新执行任务",
  exit_task: "退出任务",
  skip_paper: "跳过这篇论文",
  ignore_warning: "忽略本次提醒"
});

export const manualReviewDecisionStatusText = (action, job = {}) => {
  const label = manualReviewActionLabels[String(action || "")] || String(action || "管理员决策");
  const outcome = action === "exit_task" || job?.state !== "running"
    ? "任务已退出。"
    : "任务已继续执行。";
  return `管理员决策已提交：${label}。${outcome}`;
};

export async function submitWeeklyReportManualReviewDecision({
  requestDecision,
  refreshJob,
  setPending,
  onAccepted
} = {}) {
  if (typeof requestDecision !== "function") {
    throw new TypeError("requestDecision is required");
  }

  setPending?.(true);
  try {
    const job = await requestDecision();
    onAccepted?.(job);
    return { job, error: null };
  } catch (error) {
    const refreshedJob = typeof refreshJob === "function"
      ? await refreshJob().catch(() => null)
      : null;
    return { job: refreshedJob, error };
  } finally {
    setPending?.(false);
  }
}
