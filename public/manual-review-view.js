import { describeWeeklyReportManualReview } from "./manual-review-details.js";

const typeLabels = Object.freeze({
  processing_failure: "系统处理失败",
  evidence_dispute: "证据争议",
  quality_below_threshold: "质量与分数不足"
});

const actionCopy = Object.freeze({
  continue_repair: { label: "继续定向修正", effect: "只修正当前列出的失败内容，并重新检查对应产物。" },
  retry_job: { label: "重新执行任务", effect: "从任务开始重新执行本次周报，已保存的 Trace 会保留。" },
  retry_paper: { label: "重试本论文", effect: "" },
  retry_stage: { label: "重试当前阶段", effect: "重新执行当前失败阶段，保留已经通过的逐篇产物。" },
  confirm_evidence: { label: "确认证据充分，继续任务", effect: "只放行当前展示的证据问题，其他检查仍会继续执行。" },
  include_below_threshold: { label: "人工纳入本期", effect: "保留真实分数，重新执行选稿之后的全部阶段。" },
  keep_excluded: { label: "保持不入选", effect: "不纳入该论文，并重新校准其余候选。" },
  skip_paper: { label: "跳过这篇论文", effect: "移除该论文后重新校准其余候选。" },
  ignore_warning: { label: "忽略本次提醒", effect: "记录本次处理后继续任务。" },
  exit_task: { label: "退出任务", effect: "结束本次任务，不发布新周报；现有 Trace 和草稿会保留。" }
});

const dimensionLabels = Object.freeze({
  scenarioProblemValue: "研究问题价值",
  methodNovelty: "方法新意",
  practicalValue: "系统价值",
  evidence: "证据强度"
});

const gateLabels = Object.freeze({
  fullText: "全文",
  identity: "身份一致",
  evidence: "证据",
  crossPaper: "跨论文隔离",
  sensitiveInfo: "敏感信息"
});

const gateStatusText = (status) => ({
  passed: "通过",
  failed: "未通过",
  unknown: "未记录"
}[String(status || "").trim().toLowerCase()] || "未记录");

const queueItems = (review = {}) => {
  if (Array.isArray(review?.items)) return review.items;
  return review && typeof review === "object" ? [review] : [];
};

const viewItem = (item = {}) => ({
  itemId: String(item.itemId || ""),
  paperId: String(item.paperId || ""),
  typeLabel: typeLabels[String(item.kind || "")] || "待复核问题",
  summary: String(item.summary || "未记录具体问题。"),
  sourceStage: String(item.sourceStage || item.stage || ""),
  scope: String(item.scope || "paper")
});

const actionView = (action, item = {}) => {
  const copy = actionCopy[action] || { label: action, effect: "执行当前管理员操作。" };
  const paperId = String(item.paperId || "").trim();
  const sourceStage = String(item.sourceStage || "当前阶段").trim();
  let effect = copy.effect;
  if (action === "retry_paper") {
    effect = paperId
      ? `只重试论文 ${paperId} 的${sourceStage}，不会重新生成其他论文。`
      : "只重试当前失败论文，不会重新生成其他论文。";
  }
  return { action, label: copy.label, effect };
};

const scoreRows = (scoreSnapshot = null) => {
  if (!scoreSnapshot || typeof scoreSnapshot !== "object") return [];
  const rows = [
    { label: "最终分数", value: `${Number(scoreSnapshot.finalScore)} 分` },
    { label: "默认入选线", value: `${Number(scoreSnapshot.threshold)} 分` }
  ];
  Object.entries(dimensionLabels).forEach(([key, label]) => {
    if (Number.isFinite(Number(scoreSnapshot?.dimensions?.[key]))) {
      rows.push({ label, value: `${Number(scoreSnapshot.dimensions[key])} 分` });
    }
  });
  if (String(scoreSnapshot.comparisonReason || "").trim()) {
    rows.push({ label: "横向比较说明", value: String(scoreSnapshot.comparisonReason).trim() });
  }
  return rows;
};

const gateRows = (status = {}) => Object.entries(gateLabels).map(([key, label]) => ({
  key,
  label,
  status: gateStatusText(status?.[key])
}));

export const weeklyReportManualReviewView = (review = {}, selectedItemId = "") => {
  const items = queueItems(review);
  const requestedItemId = String(selectedItemId || review?.activeItemId || "").trim();
  const activeItem = items.find((item) => String(item?.itemId || "") === requestedItemId) || items[0] || {};
  const description = describeWeeklyReportManualReview({
    ...activeItem,
    stage: activeItem.sourceStage || review?.stage
  });
  const allowedActions = Array.isArray(activeItem?.allowedActions) ? activeItem.allowedActions : [];
  return {
    items: items.map(viewItem),
    activeItem,
    title: description.title,
    summary: description.summary,
    details: description.details,
    evidenceReviews: description.evidenceReviews || [],
    scoreRows: scoreRows(activeItem.scoreSnapshot),
    gateRows: gateRows(activeItem.gateStatus),
    actions: allowedActions.map((action) => actionView(action, activeItem)),
    requiresReason: allowedActions.includes("include_below_threshold")
  };
};
