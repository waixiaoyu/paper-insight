const issueDetail = (review = {}) => {
  const issue = Array.isArray(review.issues) ? review.issues[0] : null;
  if (!issue || typeof issue !== "object") {
    return "未记录具体失败原因。";
  }
  return String(issue.detail || "未记录具体失败原因。");
};

const retryOrExitDetail = "重新执行任务会从头生成本次周报；退出任务不会发布本次结果。";

export function describeWeeklyReportManualReview(review = {}) {
  const stage = String(review.stage || "当前阶段");
  const paperId = String(review.paperId || "");
  const issue = Array.isArray(review.issues) ? review.issues[0] : null;
  const code = String(issue?.code || "");
  const detail = issueDetail(review);

  if (review.kind === "execution_failure"
    && stage === "repair_once"
    && code === "READING_LIST_QA_REPAIR_FAILED"
    && paperId) {
    const missingDraft = /paperDraft|paper item/i.test(detail);
    return {
      title: `论文 ${paperId} 的自动修正未完成`,
      summary: missingDraft
        ? "修正后缺少可用的逐篇稿件，无法继续整稿检查。"
        : "该论文的定向修正未完成，无法继续整稿检查。",
      details: [
        { label: "修正目标", value: `论文 ${paperId} 的逐篇稿件（paperDraft）` },
        { label: "必须满足", value: "修正后必须存在与该论文 ID 一致的 paperDraft，才能重新执行检查。" },
        {
          label: "实际失败",
          value: missingDraft ? "没有找到该论文的原始候选项或修正后的逐篇稿件。" : detail
        },
        { label: "可选操作", value: retryOrExitDetail }
      ]
    };
  }

  if (review.kind === "execution_failure") {
    return {
      title: "自动处理未完成，需要管理员决定",
      summary: "系统未完成本次周报，尚未发布任何新结果。",
      details: [
        { label: "处理阶段", value: stage },
        { label: "实际失败", value: detail },
        { label: "可选操作", value: retryOrExitDetail }
      ]
    };
  }

  return {
    title: `${stage}需要管理员决策`,
    summary: String(review.summary || "自动修正后仍未通过质量门，请选择后续处理方式。"),
    details: []
  };
}
