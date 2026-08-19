const fallbackDetail = "未记录具体失败原因。";

const issueDetail = (review = {}) => {
  const issue = Array.isArray(review.issues) ? review.issues[0] : null;
  return issue && typeof issue === "object" ? String(issue.detail || fallbackDetail) : fallbackDetail;
};

const retryOrExitDetail = "重新执行任务会从头生成本次周报；退出任务不会发布本次结果。";

const editorialIssueExplanation = (issue = {}) => {
  const field = String(issue.path || "编辑计划字段");
  const actualText = String(issue.triggerText || "").trim();
  const explanations = {
    rhetorical_prose_style: "措辞包含对比、修辞或宣传性表达。需要改为直接陈述研究对象、结果和适用边界。",
    numeric_claim_not_in_evidence: "该字段出现了证据中找不到的具体数字。需要删除该数字，或补充包含该数字的证据引用。",
    metric_label_not_in_evidence: "指标名称与引用证据不一致。需要保留证据中的原始指标名称。",
    specific_setup_claim_not_in_evidence: "该字段扩大了实验设置或适用范围。需要改为引用证据明确支持的表述。"
  };
  return {
    field,
    value: actualText ? `触发内容：“${actualText}”` : "未保存触发句，需按该字段的证据与结构要求修正。",
    requirement: explanations[String(issue.code || "")] || "该字段未满足编辑计划的证据、结构或中性技术表述要求。"
  };
};

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
        { label: "实际失败", value: missingDraft ? "没有找到该论文的原始候选项或修正后的逐篇稿件。" : detail },
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

  if (stage === "editorial_plan") {
    const explanation = editorialIssueExplanation(issue);
    const related = Array.isArray(review.relatedPaperIds) ? review.relatedPaperIds : [];
    return {
      title: paperId ? `论文 ${paperId} 的编辑计划需要修正` : "编辑计划需要修正",
      summary: "自动修正未满足质量门。继续修正只会修改下列失败字段，其他已通过内容保持不变。",
      details: [
        { label: "失败字段", value: explanation.field },
        { label: "触发内容", value: explanation.value },
        { label: "未达成要求", value: explanation.requirement },
        { label: "关联论文", value: related.length ? related.join("、") : paperId || "无法从该问题定位到单篇论文" },
        { label: "继续修正", value: "服务端仅接受失败字段的局部补丁，并重新检查整份编辑计划。" }
      ]
    };
  }

  return {
    title: `${stage}需要管理员决策`,
    summary: String(review.summary || "自动修正后仍未通过质量门，请选择后续处理方式。"),
    details: []
  };
}
