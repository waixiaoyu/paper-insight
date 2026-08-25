const asArray = (value) => (Array.isArray(value) ? value : []);

const paperIdFor = (item = {}) => String(
  item?.contextPacket?.paperId
  || item?.reviewResult?.paperId
  || item?.selection?.paperId
  || item?.paperId
  || item?.paper?.id
  || ""
).replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "").replace(/\.pdf$/i, "");

const paperTitleFor = (item = {}, paperId = paperIdFor(item)) => String(
  item?.paper?.title || item?.title || paperId || "未记录论文标题"
);

export const weeklyReportArtifactSummary = (name, artifact = {}) => {
  const normalizedName = String(name || "").toLowerCase();
  if (["evidence-artifacts", "review-artifacts"].includes(normalizedName)) {
    const value = artifact?.preview || artifact;
    const counts = value?.counts || {};
    return {
      title: normalizedName === "evidence-artifacts" ? "证据提取结果" : "独立复评结果",
      metrics: [{
        key: "succeeded",
        label: normalizedName === "evidence-artifacts" ? "证据通过" : "复评通过",
        count: Number(counts.succeeded ?? asArray(value?.succeeded).length)
      }, {
        key: "processing_failed",
        label: "模型处理或响应格式失败",
        count: Number(counts.processingFailed ?? asArray(value?.processingFailed).length)
      }, {
        key: "content_excluded",
        label: normalizedName === "evidence-artifacts" ? "论据内容未通过" : "复评内容未通过",
        count: Number(counts.excluded ?? asArray(value?.excluded).length)
      }]
    };
  }

  return null;
};

export const weeklyReportSelectionRows = (artifact = {}) => {
  const value = artifact?.preview || artifact;
  const threshold = Number(value?.threshold);
  const normalizedThreshold = Number.isFinite(threshold) ? threshold : 70;
  return [...asArray(value?.selected), ...asArray(value?.notSelected), ...asArray(value?.ineligible)].map((item) => {
    const paperId = paperIdFor(item);
    const score = Number(item?.finalScore ?? item?.selection?.finalScore ?? item?.reviewResult?.rawScore ?? 0);
    const selected = item?.selected ?? item?.selection?.selected === true;
    const selectionReason = String(item?.selectionReason || item?.selection?.selectionReason || "");
    let admissionLabel;
    if (selected) {
      admissionLabel = `达到 ${normalizedThreshold} 分入选`;
    } else if (selectionReason === "max_selected_count") {
      admissionLabel = `达到 ${normalizedThreshold} 分，因篇数上限未入选`;
    } else if (selectionReason === "calibration_required") {
      admissionLabel = "未完成横向校准，不具备入选资格";
    } else {
      admissionLabel = `未达到 ${normalizedThreshold} 分，不入选`;
    }
    return {
      paperId,
      title: paperTitleFor(item, paperId),
      score,
      threshold: normalizedThreshold,
      selected,
      admissionLabel
    };
  });
};

export const weeklyReportRequestRetryable = (error) => {
  const status = Number(error?.status);
  return !Number.isFinite(status) || status >= 500;
};

const elapsedMs = (from, to) => {
  const start = new Date(from || "").getTime();
  const end = new Date(to || "").getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
};

export const weeklyReportDisconnectedJob = (remembered = {}, { now = new Date() } = {}) => {
  const timestamp = new Date(now).toISOString();
  return {
    jobId: String(remembered?.jobId || ""),
    reportKey: String(remembered?.reportKey || ""),
    state: "running",
    agentStage: "create_job",
    createdAt: timestamp,
    updatedAt: timestamp,
    counts: {},
    warnings: [],
    manualReview: null,
    connectionInterrupted: true,
    progress: {
      stageStartedAt: timestamp,
      lastEventAt: timestamp,
      lastEventType: "connection_interrupted",
      paperId: ""
    }
  };
};

export const weeklyReportHealthState = (job = {}, {
  now = new Date(),
  connectionInterrupted = false,
  staleAfterMs = 5 * 60 * 1000
} = {}) => {
  const currentTime = new Date(now).toISOString();
  const lastEventAgeMs = elapsedMs(job?.progress?.lastEventAt || job?.updatedAt, currentTime);
  const stageElapsedMs = elapsedMs(job?.progress?.stageStartedAt || job?.updatedAt, currentTime);
  const totalElapsedMs = elapsedMs(job?.createdAt, currentTime);
  const common = { lastEventAgeMs, stageElapsedMs, totalElapsedMs };

  if (connectionInterrupted) {
    return { key: "connection_interrupted", label: "连接中断，任务状态未知", detail: "浏览器暂时无法读取服务端状态；不会创建新任务，将继续查询当前任务。", ...common };
  }
  if (job?.state === "publish") {
    return { key: "publish", label: "已发布", detail: "任务已完成并保存发布稿。", ...common };
  }
  if (job?.state === "reject") {
    return { key: "reject", label: "已退出", detail: "任务已结束，未发布新版本。", ...common };
  }
  if (job?.manualReview) {
    return { key: "waiting_admin", label: "等待管理员处理", detail: "后台任务仍在，提交管理员选择后继续。", ...common };
  }
  if (lastEventAgeMs >= Math.max(1, Number(staleAfterMs) || 0)) {
    return { key: "possibly_stalled", label: "长时间没有新进展", detail: "任务仍标记为运行中，但最近没有新的阶段记录。可刷新状态；这项提示不会自动中止任务。", ...common };
  }
  if (String(job?.progress?.lastEventType || "") === "model_call_started"
    || /_processing_started$/.test(String(job?.progress?.lastEventType || ""))) {
    const paperId = String(job?.progress?.paperId || "").trim();
    return {
      key: "waiting_model",
      label: "正在等待模型响应",
      detail: paperId ? `服务端正在处理论文 ${paperId}，尚未收到本次模型响应。` : "服务端已发起当前步骤的模型调用，尚未收到响应。",
      ...common
    };
  }
  return { key: "running_recent", label: "正在运行", detail: "服务端最近仍有新的阶段记录。", ...common };
};

export const weeklyReportPhaseStatus = (events = [], artifacts = []) => {
  if (!events.length) return artifacts.length ? "completed" : "pending";
  const lastManualReviewEvent = [...events].reverse()
    .find((event) => event.type === "manual_review_requested" || event.type === "manual_review_decided");
  if (lastManualReviewEvent?.type === "manual_review_requested") return "waiting_admin";
  if (events.some((event) => /failed|cancelled|interrupted/.test(event.type || "") || event.outcome === "reject")) {
    return "attention";
  }
  if (events.some((event) => event.type === "stage_started")
    && !events.some((event) => event.type === "stage_completed")) {
    return "running";
  }
  return "completed";
};
