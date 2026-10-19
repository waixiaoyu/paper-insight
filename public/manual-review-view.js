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
  skip_paper: { label: "从本期周报移除这篇论文", effect: "不采用当前稿件，并从本期周报中移除该论文，然后重新校准其余候选。" },
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
  if (action === "confirm_evidence" && sourceStage === "write_paper_sections") {
    return {
      action,
      label: "保留这一处表述",
      effect: "只确认当前这一处表述，不确认同一稿件的其他问题；全部问题处理完后才会采用整篇稿件。"
    };
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

export const weeklyReportManualReviewPresentationKey = (job = {}) => {
  const review = job?.manualReview;
  if (!review || typeof review !== "object") return "";
  return [
    String(job?.jobId || ""),
    String(review.activeItemId || ""),
    String(review.requestedAt || "")
  ].join("|");
};

export const weeklyReportManualReviewRenderKey = ({
  presentationKey = "",
  selectedItemId = "",
  reason = ""
} = {}) => JSON.stringify([
  String(presentationKey),
  String(selectedItemId),
  String(reason)
]);

export const weeklyReportManualReviewInFlightView = ({
  jobId = "",
  decisionId = "",
  action = "continue_repair",
  selectedItem = {},
  startedAt = ""
} = {}) => {
  const paperId = String(selectedItem?.paperId || "").trim();
  const itemId = String(selectedItem?.itemId || "").trim();
  const sourceStage = String(selectedItem?.sourceStage || selectedItem?.stage || "manual_review").trim();
  const repairItem = {
    ...selectedItem,
    itemId,
    paperId,
    sourceStage,
    allowedActions: []
  };
  const subject = paperId ? `论文 ${paperId}` : "当前任务";
  const copy = {
    continue_repair: {
      eyebrow: "正在执行定向修正",
      title: `正在定向修正${subject} 的当前问题`,
      summary: "本次只修改当前这一项，其他已通过内容保持不变。修正完成后，系统会重新检查；如仍有问题，将再次显示人工复核。"
    },
    confirm_evidence: {
      eyebrow: "正在应用人工确认",
      title: `正在保留${subject} 的当前这一处表述`,
      summary: "本次只确认并保留当前展示的这一处表述，不会同时确认其他问题。系统将记录本次决定并继续后续检查。"
    },
    retry_job: {
      eyebrow: "正在重新执行任务",
      title: "正在重新执行当前周报任务",
      summary: "管理员决定已经记录，系统正在重新执行任务。已有 Trace 会继续保留。"
    },
    retry_paper: {
      eyebrow: "正在重试当前论文",
      title: `正在重新处理${subject}`,
      summary: "本次只重新处理当前论文，其他已完成论文的产物保持不变。"
    },
    retry_stage: {
      eyebrow: "正在重试当前阶段",
      title: "正在重新执行当前阶段",
      summary: "管理员决定已经记录，系统正在重新执行当前失败阶段。"
    },
    include_below_threshold: {
      eyebrow: "正在应用人工纳入",
      title: `正在将${subject}纳入本期候选`,
      summary: "论文真实分数保持不变，系统正在按管理员决定重新执行选稿后的阶段。"
    },
    keep_excluded: {
      eyebrow: "正在应用不入选决定",
      title: `正在保持${subject}不入选`,
      summary: "管理员决定已经记录，系统将基于其余候选继续执行。"
    },
    skip_paper: {
      eyebrow: "正在移除当前论文",
      title: `正在从本期周报移除${subject}`,
      summary: "当前稿件不会被采用，系统正在重新校准其余候选。"
    },
    ignore_warning: {
      eyebrow: "正在继续任务",
      title: "正在记录本次提醒并继续",
      summary: "管理员决定已经记录，系统正在继续后续检查。"
    }
  }[String(action || "continue_repair")] || {
    eyebrow: "正在应用管理员决定",
    title: "正在继续当前任务",
    summary: "管理员决定已经记录，系统正在继续执行。"
  };
  return {
    presentationKey: [
      String(jobId),
      String(action || "admin_action"),
      String(decisionId || itemId),
      String(startedAt)
    ].join("|"),
    ...copy,
    review: {
      stage: sourceStage,
      status: "repairing",
      requestedAt: String(startedAt),
      activeItemId: itemId,
      items: [repairItem]
    }
  };
};

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
