const defaultQuery = `("network" OR "telecom" OR "5G" OR "6G") AND
("AI" OR "machine learning" OR "deep learning" OR "LLM" OR "large language model" OR "foundation model") AND
("anomaly detection" OR "traffic prediction" OR "network optimization" OR "root cause analysis" OR
"digital twin network" OR "intent-based networking" OR "network automation" OR "orchestration" OR
"multi-agent" OR "AI agent" OR "autonomous agent" OR "agent-based system")`;

const dimensionLabels = {
  domainFit: "网络相关",
  aiFit: "AI相关",
  taskFit: "场景相关",
  novelty: "新颖性信号",
  practicalValue: "工程价值",
  evidence: "证据强度"
};

const queryKeywordGroups = [
  {
    id: "domain",
    title: "网络与通信",
    terms: ["network", "telecom", "5G", "6G"]
  },
  {
    id: "ai",
    title: "AI 方法",
    terms: ["AI", "machine learning", "deep learning", "LLM", "large language model", "foundation model"]
  },
  {
    id: "task",
    title: "任务场景",
    terms: [
      "anomaly detection",
      "traffic prediction",
      "network optimization",
      "root cause analysis",
      "digital twin network",
      "intent-based networking",
      "network automation",
      "orchestration",
      "multi-agent",
      "AI agent",
      "autonomous agent",
      "agent-based system"
    ]
  }
];

const storageKeys = {
  reports: "paper-insight:weekly",
  query: "paper-insight:query",
  queryMode: "paper-insight:query-mode",
  querySelection: "paper-insight:query-selection",
  apiKey: "paper-insight:deepseek-key",
  model: "paper-insight:deepseek-model"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  apiDialog: $("#apiDialog"),
  apiForm: $("#apiForm"),
  apiKeyInput: $("#apiKeyInput"),
  apiModel: $("#apiModel"),
  apiStatus: $("#apiStatus"),
  openApiDialog: $("#openApiDialog"),
  clearApiKey: $("#clearApiKey"),
  filters: $("#filters"),
  queryText: $("#queryText"),
  queryBuilder: $("#queryBuilder"),
  limitInput: $("#limit"),
  thresholdInput: $("#threshold"),
  thresholdValue: $("#thresholdValue"),
  dateWindow: $("#dateWindow"),
  restoreQuery: $("#restoreQuery"),
  taskDialog: $("#taskDialog"),
  taskTitle: $("#taskTitle"),
  taskDescription: $("#taskDescription"),
  taskClose: $("#taskClose"),
  taskSteps: $("#taskSteps"),
  taskStatus: $("#taskStatus"),
  taskRetry: $("#taskRetry"),
  taskCandidatePanel: $("#taskCandidatePanel"),
  taskProgressPanel: $("#taskProgressPanel"),
  taskDonePanel: $("#taskDonePanel"),
  taskDoneSummary: $("#taskDoneSummary"),
  breadcrumb: $("#breadcrumb"),
  pageEyebrow: $("#pageEyebrow"),
  pageTitle: $("#pageTitle"),
  pageDescription: $("#pageDescription"),
  backToReports: $("#backToReports"),
  statusPanel: $("#statusPanel"),
  retryButton: $("#retryButton"),
  homeView: $("#homeView"),
  reportView: $("#reportView"),
  paperView: $("#paperView"),
  reportHomeList: $("#reportHomeList"),
  candidateList: $("#candidateList"),
  selectAllCandidates: $("#selectAllCandidates"),
  confirmCandidates: $("#confirmCandidates"),
  progressTitle: $("#progressTitle"),
  progressPercent: $("#progressPercent"),
  progressFill: $("#progressFill"),
  progressCurrent: $("#progressCurrent"),
  progressElapsed: $("#progressElapsed"),
  candidateCount: $("#candidateCount"),
  recommendedCount: $("#recommendedCount"),
  hiddenCount: $("#hiddenCount"),
  analysisMode: $("#analysisMode"),
  paperList: $("#paperList"),
  analysisDetail: $("#analysisDetail"),
  paperTemplate: $("#paperTemplate")
};

const paperViewButtons = $$("[data-paper-view]");
const sortButtons = $$("[data-sort]");
const queryModeButtons = $$("[data-query-mode]");

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric"
});

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit"
});

const savedQuery = localStorage.getItem(storageKeys.query);
const savedQueryMode = localStorage.getItem(storageKeys.queryMode);

const state = {
  reports: loadReports(),
  runtimeApiKey: sessionStorage.getItem(storageKeys.apiKey) || "",
  runtimeModel: sessionStorage.getItem(storageKeys.model) || "deepseek-v4-flash",
  view: "home",
  currentReport: null,
  currentPaper: null,
  currentPaperView: "recommended",
  currentSort: "score",
  queryMode: savedQueryMode || (savedQuery ? "manual" : "builder"),
  currentThreshold: 70,
  candidatePapers: [],
  selectedCandidateIds: new Set(),
  lastAnalyzePapers: [],
  progressTimer: 0,
  sourceStatusTimer: 0,
  progressState: null,
  taskLocked: false,
  taskCloseTimer: 0
};

renderKeywordBuilder();
elements.queryText.value = savedQuery || buildQueryFromSelectedKeywords() || defaultQuery;
setQueryMode(state.queryMode === "manual" ? "manual" : "builder", { sync: !savedQuery });
elements.apiModel.value = state.runtimeModel;
state.currentThreshold = Number(elements.thresholdInput.value || 70);

function loadReports() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKeys.reports) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistReports() {
  localStorage.setItem(storageKeys.reports, JSON.stringify(state.reports));
}

function quoteQueryTerm(term) {
  return `"${String(term).replace(/"/g, "").trim()}"`;
}

function defaultQuerySelection() {
  return Object.fromEntries(queryKeywordGroups.map((group) => [group.id, [...group.terms]]));
}

function loadQuerySelection() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKeys.querySelection) || "{}");
    const fallback = defaultQuerySelection();

    queryKeywordGroups.forEach((group) => {
      const selected = Array.isArray(parsed[group.id])
        ? parsed[group.id].filter((term) => group.terms.includes(term))
        : fallback[group.id];

      parsed[group.id] = selected.length ? selected : fallback[group.id];
    });

    return parsed;
  } catch {
    return defaultQuerySelection();
  }
}

function selectedKeywordTerms() {
  const selection = {};

  queryKeywordGroups.forEach((group) => {
    selection[group.id] = [...elements.queryBuilder.querySelectorAll(`input[data-query-group="${group.id}"]:checked`)]
      .map((input) => input.value);
  });

  return selection;
}

function persistQuerySelection(selection = selectedKeywordTerms()) {
  localStorage.setItem(storageKeys.querySelection, JSON.stringify(selection));
}

function buildQueryFromSelection(selection) {
  const groups = queryKeywordGroups
    .map((group) => {
      const terms = Array.isArray(selection[group.id]) ? selection[group.id] : [];
      return terms.length ? `(${terms.map(quoteQueryTerm).join(" OR ")})` : "";
    })
    .filter(Boolean);

  return groups.join(" AND ");
}

function buildQueryFromSelectedKeywords() {
  const query = buildQueryFromSelection(selectedKeywordTerms());
  return query || defaultQuery;
}

function syncQueryFromBuilder() {
  const query = buildQueryFromSelectedKeywords();
  elements.queryText.value = query;
  localStorage.setItem(storageKeys.query, query);
  persistQuerySelection();
  return query;
}

function setQueryMode(mode, options = {}) {
  const nextMode = mode === "manual" ? "manual" : "builder";
  state.queryMode = nextMode;
  localStorage.setItem(storageKeys.queryMode, nextMode);
  elements.queryBuilder.hidden = nextMode === "manual";
  elements.queryText.rows = nextMode === "manual" ? 9 : 5;
  queryModeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.queryMode === nextMode);
  });

  if (nextMode === "builder" && options.sync !== false) {
    syncQueryFromBuilder();
  }
}

function setAllKeywordSelection(checked) {
  elements.queryBuilder.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = checked;
  });
  persistQuerySelection();
}

function renderKeywordBuilder() {
  elements.queryBuilder.textContent = "";
  const selection = loadQuerySelection();

  queryKeywordGroups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "query-group";

    const title = document.createElement("h3");
    title.textContent = group.title;

    const choices = document.createElement("div");
    choices.className = "query-chip-list";

    group.terms.forEach((term) => {
      const label = document.createElement("label");
      label.className = "query-chip";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = term;
      checkbox.dataset.queryGroup = group.id;
      checkbox.checked = selection[group.id]?.includes(term) ?? true;
      checkbox.addEventListener("change", () => {
        setQueryMode("builder", { sync: true });
      });

      const text = document.createElement("span");
      text.textContent = term;

      label.append(checkbox, text);
      choices.append(label);
    });

    section.append(title, choices);
    elements.queryBuilder.append(section);
  });
}

function currentSearchQuery() {
  if (state.queryMode === "builder") {
    return syncQueryFromBuilder();
  }

  const query = elements.queryText.value.trim() || defaultQuery;
  localStorage.setItem(storageKeys.query, query);
  return query;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function secondsSince(start) {
  return Math.max(0, Math.round((performance.now() - start) / 1000));
}

function reportPapers(report = state.currentReport) {
  if (!report) {
    return [];
  }

  if (Array.isArray(report.items)) {
    return report.items;
  }

  return [
    ...(Array.isArray(report.recommendations) ? report.recommendations : []),
    ...(Array.isArray(report.hiddenPapers) ? report.hiddenPapers : [])
  ];
}

function thresholdFor(report = state.currentReport) {
  return Number(report?.threshold ?? state.currentThreshold ?? 70);
}

function paperScore(paper) {
  return clamp(paper?.analysis?.score ?? 0);
}

const scoreTierClasses = [
  "score-tier-priority",
  "score-tier-focus",
  "score-tier-scan",
  "score-tier-borderline",
  "score-tier-low"
];

function scoreTier(score) {
  const value = clamp(score);

  if (value >= 90) {
    return {
      label: "优先阅读",
      className: "score-tier-priority",
      description: "主题高度匹配，适合直接读正文。"
    };
  }

  if (value >= 80) {
    return {
      label: "重点关注",
      className: "score-tier-focus",
      description: "相关性较强，适合加入本周阅读。"
    };
  }

  if (value >= 70) {
    return {
      label: "快速扫读",
      className: "score-tier-scan",
      description: "有价值信号，先看摘要、结论和实验。"
    };
  }

  if (value >= 60) {
    return {
      label: "边缘相关",
      className: "score-tier-borderline",
      description: "有少量相关信号，按需复核。"
    };
  }

  return {
    label: "暂不纳入",
    className: "score-tier-low",
    description: "匹配度不足，暂时隐藏。"
  };
}

function setScorePill(pill, paper) {
  const score = paperScore(paper);
  const tier = scoreTier(score);
  pill.textContent = `${score} 分 · ${tier.label}`;
  pill.title = tier.description;
  pill.setAttribute("aria-label", `${score} 分，${tier.label}。${tier.description}`);
  pill.classList.remove(...scoreTierClasses);
  pill.classList.add(tier.className);
}

function isRecommendedPaper(paper, report = state.currentReport) {
  return paperScore(paper) >= thresholdFor(report);
}

function splitReport(report = state.currentReport) {
  const all = reportPapers(report);
  const recommended = all.filter((paper) => isRecommendedPaper(paper, report));
  const hidden = all.filter((paper) => !isRecommendedPaper(paper, report));
  return { all, recommended, hidden };
}

function modeLabel(mode) {
  if (mode === "deepseek") {
    return "DeepSeek";
  }

  if (mode === "llm") {
    return "LLM";
  }

  return mode || "-";
}

function weekStart(date = new Date()) {
  const start = new Date(date);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start;
}

function reportTitle() {
  return `${dateFormatter.format(weekStart())} 周推荐 · ${timeFormatter.format(new Date())}`;
}

function setActiveView(name) {
  state.view = name;
  Object.entries({
    home: elements.homeView,
    report: elements.reportView,
    paper: elements.paperView
  }).forEach(([key, view]) => {
    view.classList.toggle("active", key === name);
  });
}

function setHeader({ eyebrow, title, description, showBack = false }) {
  elements.pageEyebrow.textContent = eyebrow;
  elements.pageTitle.textContent = title;
  elements.pageDescription.textContent = description;
  elements.backToReports.hidden = !showBack;
}

function renderBreadcrumb(items) {
  elements.breadcrumb.textContent = "";
  elements.breadcrumb.hidden = !items.length;

  items.forEach((item, index) => {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "breadcrumb-separator";
      separator.textContent = ">";
      elements.breadcrumb.append(separator);
    }

    if (item.onClick) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", item.onClick);
      elements.breadcrumb.append(button);
      return;
    }

    const current = document.createElement("span");
    current.textContent = item.label;
    elements.breadcrumb.append(current);
  });
}

function showStatus(message, type = "loading", action = "") {
  elements.statusPanel.className = `status-panel visible${type === "error" ? " error" : ""}${type === "warning" ? " warning" : ""}`;
  elements.statusPanel.querySelector("p").textContent = message;
  elements.retryButton.hidden = action !== "retry";
}

function hideStatus() {
  elements.statusPanel.className = "status-panel";
  elements.retryButton.hidden = true;
}

function updateApiStatus() {
  elements.apiStatus.textContent = state.runtimeApiKey ? `已设置：${state.runtimeModel}` : "未设置 API Key";
  elements.clearApiKey.disabled = !state.runtimeApiKey;
}

function showTaskDialog() {
  if (state.taskCloseTimer) {
    window.clearTimeout(state.taskCloseTimer);
    state.taskCloseTimer = 0;
  }

  if (typeof elements.taskDialog.showModal === "function" && !elements.taskDialog.open) {
    elements.taskDialog.showModal();
  }
}

function closeTaskDialog() {
  if (state.taskLocked) {
    return;
  }

  if (elements.taskDialog.open) {
    elements.taskDialog.close();
  }
}

function setTaskLocked(locked) {
  state.taskLocked = locked;
  elements.taskClose.disabled = locked;
}

function setTaskStep(step) {
  const labels = {
    fetch: ["获取候选论文", "正在连接论文数据源。"],
    confirm: ["确认候选论文", "保留值得分析的候选。"],
    analyze: ["AI 分析进行中", "逐篇生成摘要、分数和判断理由。"],
    done: ["推荐列表已生成", "最新列表已保存。"]
  };
  const order = ["fetch", "confirm", "analyze", "done"];
  const currentIndex = order.indexOf(step);

  elements.taskTitle.textContent = labels[step]?.[0] || "生成推荐列表";
  elements.taskDescription.textContent = labels[step]?.[1] || "";
  elements.taskSteps.querySelectorAll("[data-step]").forEach((item) => {
    const index = order.indexOf(item.dataset.step);
    item.classList.toggle("active", index === currentIndex);
    item.classList.toggle("complete", currentIndex > index);
  });
}

function setTaskStatus(message, type = "loading", action = "") {
  elements.taskStatus.className = `task-status visible${type === "error" ? " error" : ""}${type === "warning" ? " warning" : ""}${type === "success" ? " success" : ""}`;
  elements.taskStatus.querySelector("p").textContent = message;
  elements.taskRetry.hidden = action !== "retry";
}

function showTaskPanel(panelName) {
  elements.taskCandidatePanel.classList.toggle("active", panelName === "candidate");
  elements.taskProgressPanel.classList.toggle("active", panelName === "progress");
  elements.taskDonePanel.classList.toggle("active", panelName === "done");
}

function llmPayload() {
  return state.runtimeApiKey
    ? {
        llmApiKey: state.runtimeApiKey,
        llmProvider: "deepseek",
        llmModel: state.runtimeModel
      }
    : {};
}

function ensureApiKey(message = "请先输入 DeepSeek API Key。没有大模型 API 不会生成推荐。") {
  if (state.runtimeApiKey) {
    return true;
  }

  showStatus(message, "error");

  if (typeof elements.apiDialog.showModal === "function" && !elements.apiDialog.open) {
    elements.apiDialog.showModal();
  }

  return false;
}

function resetProgressTimer() {
  if (state.progressTimer) {
    window.clearInterval(state.progressTimer);
    state.progressTimer = 0;
  }
}

function resetSourceStatusTimer() {
  if (state.sourceStatusTimer) {
    window.clearInterval(state.sourceStatusTimer);
    state.sourceStatusTimer = 0;
  }
}

function resetTaskModal() {
  resetProgressTimer();
  resetSourceStatusTimer();
  setTaskLocked(false);
  setTaskStep("fetch");
  showTaskPanel("");
  elements.taskRetry.hidden = true;
  elements.candidateList.textContent = "";
  elements.progressFill.style.width = "0%";
  elements.progressPercent.textContent = "0%";
  elements.progressTitle.textContent = "等待开始";
  elements.progressCurrent.textContent = "尚未开始分析。";
  elements.progressElapsed.textContent = "总耗时 0 秒，本篇耗时 0 秒。";
  elements.taskDoneSummary.textContent = "最新列表已打开。";
}

function sourceLabel(source) {
  const labels = {
    arxiv: "arXiv",
    openalex: "OpenAlex",
    "semantic-scholar": "Semantic Scholar",
    cache: "本地缓存",
    none: "无可用数据源"
  };

  return labels[source] || source || "候选数据源";
}

function sourceReturnSummary(value) {
  if (!value) {
    return "";
  }

  const status = [value.status, value.statusText].filter(Boolean).join(" ");
  const parts = [
    `${sourceLabel(value.source)} ${status || "未知状态"}`,
    value.retryAfter ? `Retry-After=${value.retryAfter}` : "",
    value.contentType ? `Content-Type=${value.contentType}` : "",
    value.body ? `Body=${value.body}` : ""
  ].filter(Boolean);

  return parts.join("，");
}

function sourceReturnsSummary(values) {
  return (Array.isArray(values) ? values : [])
    .map(sourceReturnSummary)
    .filter(Boolean)
    .join("；");
}

function decodeHeaderValue(value) {
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function startSourceStatusPolling(requestId) {
  resetSourceStatusTimer();
  state.sourceStatusTimer = window.setInterval(async () => {
    try {
      const response = await fetch(`/api/papers/status?requestId=${encodeURIComponent(requestId)}`);

      if (!response.ok) {
        return;
      }

      const data = await response.json();

      if (!data.message || data.state === "idle") {
        return;
      }

      const returnText = sourceReturnsSummary(data.sourceReturns);
      const detail = returnText && !data.message.includes("Body=") ? ` 返回值：${returnText}` : "";
      setTaskStatus(`${sourceLabel(data.source)}：${data.message}${detail}`, data.state === "error" ? "error" : "loading");

      if (data.state === "done" || data.state === "error") {
        resetSourceStatusTimer();
      }
    } catch {
      // Status polling is only for display; the main request still owns errors.
    }
  }, 700);
}

function setMetrics({ candidates = 0, recommended = 0, hidden = 0, mode = "-" } = {}) {
  elements.candidateCount.textContent = String(candidates);
  elements.recommendedCount.textContent = String(recommended);
  elements.hiddenCount.textContent = String(hidden);
  elements.analysisMode.textContent = modeLabel(mode);
}

function setMetricsForReport(report = state.currentReport) {
  const counts = splitReport(report);
  setMetrics({
    candidates: Number(report?.candidateCount ?? counts.all.length),
    recommended: counts.recommended.length,
    hidden: counts.hidden.length,
    mode: report?.mode || "-"
  });
}

function showHome(message = "") {
  resetProgressTimer();
  state.currentReport = null;
  state.currentPaper = null;
  setActiveView("home");
  setHeader({
    eyebrow: "Paper Insight",
    title: "推荐列表",
    description: "生成后的列表会保存在这里。",
    showBack: false
  });
  renderBreadcrumb([]);
  renderReportHome();

  if (message) {
    showStatus(message, "warning");
  } else if (!state.runtimeApiKey) {
    showStatus("请输入 DeepSeek API Key，然后点击左侧“生成推荐列表”。", "warning");
  } else {
    hideStatus();
  }
}

function clearWorkingState() {
  resetProgressTimer();
  state.currentReport = null;
  state.currentPaper = null;
  state.candidatePapers = [];
  state.selectedCandidateIds = new Set();
  state.lastAnalyzePapers = [];
  state.currentPaperView = "recommended";
  state.currentSort = "score";
  elements.candidateList.textContent = "";
  elements.paperList.textContent = "";
  elements.analysisDetail.textContent = "";
  setMetrics();
  updatePaperViewTabs(null);
}

function renderReportHome() {
  elements.reportHomeList.textContent = "";

  if (!state.reports.length) {
    const empty = document.createElement("div");
    empty.className = "report-empty-panel";
    const title = document.createElement("h3");
    title.textContent = "还没有推荐列表";
    const description = document.createElement("p");
    description.textContent = "设置搜索条件后，点击左侧“生成推荐列表”。";
    empty.append(title, description);
    elements.reportHomeList.append(empty);
    return;
  }

  state.reports.forEach((report) => {
    const counts = splitReport(report);
    const item = document.createElement("button");
    item.className = "report-card";
    item.type = "button";

    const title = document.createElement("strong");
    title.textContent = report.title || "未命名推荐列表";

    const meta = document.createElement("span");
    const created = report.createdAt ? `${dateFormatter.format(new Date(report.createdAt))} · ` : "";
    meta.textContent = `${created}${counts.recommended.length} 篇推荐 · ${counts.hidden.length} 篇隐藏 · 阈值 ${thresholdFor(report)} · ${modeLabel(report.mode)}`;

    item.append(title, meta);
    item.addEventListener("click", () => openReport(report));
    elements.reportHomeList.append(item);
  });
}

function text(node, selector) {
  return node.querySelector(selector)?.textContent?.trim() || "";
}

function parsePapers(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parseError = doc.querySelector("parsererror");

  if (parseError) {
    throw new Error("arXiv 返回内容无法解析。");
  }

  return [...doc.querySelectorAll("entry")]
    .map((entry) => {
      const id = text(entry, "id");
      const links = [...entry.querySelectorAll("link")];
      const pdf = links.find((link) => link.getAttribute("title") === "pdf");
      const abs = links.find((link) => link.getAttribute("rel") === "alternate");
      const categories = [...entry.querySelectorAll("category")].map((category) => category.getAttribute("term")).filter(Boolean);
      const primaryCategory = entry
        .getElementsByTagNameNS("http://arxiv.org/schemas/atom", "primary_category")[0]
        ?.getAttribute("term");
      const authors = [...entry.querySelectorAll("author name")].map((author) => author.textContent.trim());

      return {
        id,
        title: text(entry, "title").replace(/\s+/g, " "),
        authors,
        summary: text(entry, "summary").replace(/\s+/g, " "),
        published: text(entry, "published"),
        updated: text(entry, "updated"),
        link: pdf?.getAttribute("href") || id,
        absLink: abs?.getAttribute("href") || id,
        primaryCategory: primaryCategory || categories[0] || "arXiv",
        categories
      };
    })
    .filter((paper) => paper.id && paper.title);
}

function updateCandidateActionState() {
  const selectedCount = state.selectedCandidateIds.size;
  const allSelected = selectedCount > 0 && selectedCount === state.candidatePapers.length;
  elements.selectAllCandidates.textContent = allSelected ? "取消全选" : "全选";
  elements.confirmCandidates.disabled = selectedCount === 0;
  elements.confirmCandidates.textContent = selectedCount ? `确认并分析 ${selectedCount} 篇` : "至少选择 1 篇";
}

function showCandidateConfirmation(papers) {
  resetProgressTimer();
  state.candidatePapers = papers;
  state.selectedCandidateIds = new Set(papers.map((paper) => paper.id));
  state.currentReport = null;
  state.currentPaper = null;
  state.currentThreshold = Number(elements.thresholdInput.value || 70);
  elements.candidateList.textContent = "";
  setTaskLocked(false);
  setTaskStep("confirm");
  showTaskPanel("candidate");
  setTaskStatus(`已获取 ${papers.length} 篇候选论文。请确认要进入 AI 分析的论文。`, "warning");

  papers.forEach((paper, index) => {
    const label = document.createElement("label");
    label.className = "candidate-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.value = paper.id;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedCandidateIds.add(paper.id);
      } else {
        state.selectedCandidateIds.delete(paper.id);
      }
      updateCandidateActionState();
    });

    const body = document.createElement("div");
    const title = document.createElement("div");
    title.className = "candidate-title";
    title.textContent = `${index + 1}. ${paper.title}`;

    const meta = document.createElement("div");
    meta.className = "candidate-meta";
    meta.textContent = `${formatDate(paper.published)} · ${paper.primaryCategory} · ${paper.authors.slice(0, 4).join(", ") || "Unknown authors"}`;

    const summary = document.createElement("div");
    summary.className = "candidate-summary";
    summary.textContent = paper.summary.length > 280 ? `${paper.summary.slice(0, 280)}...` : paper.summary;

    body.append(title, meta, summary);
    label.append(checkbox, body);
    elements.candidateList.append(label);
  });

  updateCandidateActionState();
}

async function fetchCandidates() {
  if (!ensureApiKey()) {
    return;
  }

  state.candidatePapers = [];
  state.selectedCandidateIds = new Set();
  state.lastAnalyzePapers = [];
  state.currentThreshold = Number(elements.thresholdInput.value || 70);
  resetTaskModal();
  showTaskDialog();
  setTaskLocked(true);
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  setTaskStatus("arXiv：正在获取候选论文。");
  const query = currentSearchQuery();
  const candidateLimit = Math.max(5, Math.min(30, Number(elements.limitInput.value) || 10));
  const params = new URLSearchParams({
    query,
    limit: String(candidateLimit),
    days: elements.dateWindow.value,
    requestId
  });

  startSourceStatusPolling(requestId);

  try {
    const response = await fetch(`/api/papers?${params.toString()}`);
    resetSourceStatusTimer();
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      const payload = contentType.includes("application/json") ? await response.json() : {};
      const retryHint = payload.retryAfterSeconds
        ? ` 建议等待约 ${Math.ceil(payload.retryAfterSeconds / 60)} 分钟后再试。`
        : "";
      const returnText = sourceReturnsSummary(payload.sourceReturns);
      const baseMessage = payload.detail || payload.message || "论文数据源请求失败。";
      const returnHint = returnText && !baseMessage.includes("Body=") ? ` 返回值：${returnText}` : "";
      throw new Error(`${baseMessage}${returnHint}${retryHint}`);
    }

    const cacheStatus = response.headers.get("x-paper-insight-arxiv-cache") || "";
    const source = response.headers.get("x-paper-insight-source") || "arxiv";
    const cacheAge = Number(response.headers.get("x-paper-insight-cache-age-seconds") || 0);
    const warning = response.headers.get("x-paper-insight-arxiv-warning");
    const sourceReturn = decodeHeaderValue(response.headers.get("x-paper-insight-source-return"));
    const returnHint = sourceReturn ? ` 返回值：${sourceReturn}` : "";
    const papers = parsePapers(await response.text()).slice(0, candidateLimit);

    if (!papers.length) {
      setTaskLocked(false);
      setTaskStatus("arXiv 没有返回匹配论文。可以放宽查询条件或扩大时间范围。", "warning");
      return;
    }

    showCandidateConfirmation(papers);
    if (cacheStatus === "stale") {
      const minutes = Math.max(1, Math.round(cacheAge / 60));
      const text = warning ? decodeURIComponent(warning) : "arXiv 暂时不可用，已使用本地缓存。";
      setTaskStatus(`${sourceLabel(source)}：${text}${returnHint} 缓存约 ${minutes} 分钟前更新，请确认候选论文。`, "warning");
    } else if (cacheStatus === "hit") {
      setTaskStatus(`${sourceLabel(source)}：已从本地缓存读取 ${papers.length} 篇候选论文，请确认要进入 AI 分析的论文。`, "warning");
    } else if (cacheStatus === "fallback") {
      const text = warning ? decodeURIComponent(warning) : "已使用备用数据源。";
      setTaskStatus(`${sourceLabel(source)}：${text}${returnHint} 已获取 ${papers.length} 篇候选论文，请确认。`, "warning");
    } else {
      setTaskStatus(`${sourceLabel(source)}：已获取 ${papers.length} 篇候选论文，请确认要进入 AI 分析的论文。`, "warning");
    }
  } catch (error) {
    resetSourceStatusTimer();
    setTaskLocked(false);
    setTaskStatus(`暂时无法获取候选论文：${error.message}`, "error");
  }
}

function updateProgress(progress) {
  const { done, total, paper, phase, startedAt, paperStartedAt } = progress;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const displayIndex = phase === "done" ? done : done + 1;
  elements.progressTitle.textContent = phase === "done" ? "本篇分析完成" : "DeepSeek 正在分析";
  elements.progressFill.style.width = `${percent}%`;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressCurrent.textContent = paper
    ? `${phase === "done" ? "已完成" : "正在分析"}第 ${Math.min(displayIndex, total)}/${total} 篇：${paper.title}`
    : "正在准备分析任务。";
  elements.progressElapsed.textContent = `总耗时 ${secondsSince(startedAt)} 秒，本篇耗时 ${secondsSince(paperStartedAt || startedAt)} 秒。`;
}

function showProgressView(total) {
  showTaskDialog();
  setTaskLocked(true);
  setTaskStep("analyze");
  showTaskPanel("progress");
  elements.progressFill.style.width = "0%";
  elements.progressPercent.textContent = "0%";
  elements.progressTitle.textContent = "准备分析";
  elements.progressCurrent.textContent = `已确认 ${total} 篇论文，准备调用 DeepSeek。`;
  elements.progressElapsed.textContent = "总耗时 0 秒，本篇耗时 0 秒。";
  setTaskStatus(`已确认 ${total} 篇候选论文，正在逐篇分析...`);
}

function analysisErrorFromPayload(data) {
  const missing = Array.isArray(data.missingPapers) && data.missingPapers.length
    ? ` 缺失分析：${data.missingPapers.slice(0, 3).map((paper) => paper.title).join("；")}${data.missingPapers.length > 3 ? "；..." : ""}`
    : "";
  const invalid = Array.isArray(data.invalidAnalyses) && data.invalidAnalyses.length
    ? ` 字段不完整：${data.invalidAnalyses.slice(0, 3).map((paper) => `${paper.title}(${paper.missing.join(", ")})`).join("；")}${data.invalidAnalyses.length > 3 ? "；..." : ""}`
    : "";
  const error = new Error(`${data.detail || data.message || "论文分析失败。"}${missing}${invalid}`);
  error.retryable = Boolean(data.retryable);
  return error;
}

async function analyzeOnePaper(paper) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query: currentSearchQuery(),
      threshold: state.currentThreshold,
      maxRecommendations: 1,
      maxAnalyze: 1,
      totalCandidates: 1,
      papers: [paper],
      ...llmPayload()
    })
  });
  const data = await response.json();

  if (!response.ok) {
    throw analysisErrorFromPayload(data);
  }

  const analyzedPaper = data.analyzedPapers?.[0] || data.recommendations?.[0] || data.hiddenPapers?.[0];

  if (!analyzedPaper) {
    const error = new Error("LLM 没有返回本篇论文的分析结果。");
    error.retryable = true;
    throw error;
  }

  return {
    mode: modeLabel(data.mode),
    paper: analyzedPaper
  };
}

async function analyzeConfirmedPapers(papers) {
  if (!ensureApiKey("请先输入 DeepSeek API Key，然后再开始 AI 分析。")) {
    return;
  }

  state.lastAnalyzePapers = papers;
  state.currentThreshold = Number(elements.thresholdInput.value || 70);
  state.currentPaperView = "recommended";
  state.currentSort = "score";
  const analyzed = [];
  let mode = "DeepSeek";
  const startedAt = performance.now();

  showProgressView(papers.length);

  try {
    for (let index = 0; index < papers.length; index += 1) {
      const paper = papers[index];
      const paperStartedAt = performance.now();
      state.progressState = { done: index, total: papers.length, paper, phase: "running", startedAt, paperStartedAt };
      updateProgress(state.progressState);
      resetProgressTimer();
      state.progressTimer = window.setInterval(() => updateProgress(state.progressState), 500);

      const result = await analyzeOnePaper(paper);
      mode = result.mode;
      analyzed.push(result.paper);

      const tempReport = {
        threshold: state.currentThreshold,
        candidateCount: papers.length,
        mode,
        items: analyzed
      };
      const counts = splitReport(tempReport);
      setMetrics({
        candidates: papers.length,
        recommended: counts.recommended.length,
        hidden: counts.hidden.length,
        mode
      });

      state.progressState = { done: index + 1, total: papers.length, paper, phase: "done", startedAt, paperStartedAt };
      updateProgress(state.progressState);
    }
  } finally {
    resetProgressTimer();
  }

  const report = {
    key: `${weekStart().toISOString().slice(0, 10)}-${Date.now()}`,
    title: reportTitle(),
    createdAt: new Date().toISOString(),
    mode,
    threshold: state.currentThreshold,
    candidateCount: papers.length,
    items: analyzed
  };
  state.reports = [report, ...state.reports].slice(0, 20);
  persistReports();
  openReport(report);
  setTaskLocked(false);
  setTaskStep("done");
  showTaskPanel("done");
  const counts = splitReport(report);
  elements.taskDoneSummary.textContent = `推荐 ${counts.recommended.length} 篇，隐藏 ${counts.hidden.length} 篇。`;
  setTaskStatus("最新列表已生成。", "success");
  state.taskCloseTimer = window.setTimeout(() => {
    closeTaskDialog();
  }, 1200);
}

function createScoreRow(label, value) {
  const row = document.createElement("div");
  row.className = "score-row";

  const heading = document.createElement("div");
  heading.className = "score-row-heading";

  const name = document.createElement("span");
  name.textContent = label;

  const score = document.createElement("strong");
  score.textContent = String(Math.round(clamp(value)));

  const bar = document.createElement("div");
  bar.className = "score-bar";

  const fill = document.createElement("span");
  fill.style.width = `${clamp(value)}%`;

  heading.append(name, score);
  bar.append(fill);
  row.append(heading, bar);
  return row;
}

function updatePaperViewTabs(report = state.currentReport) {
  const counts = report ? splitReport(report) : { recommended: [], hidden: [], all: [] };

  paperViewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.paperView === state.currentPaperView);

    if (button.dataset.paperView === "recommended") {
      button.textContent = `推荐论文 ${counts.recommended.length}`;
    } else if (button.dataset.paperView === "hidden") {
      button.textContent = `隐藏论文 ${counts.hidden.length}`;
    } else {
      button.textContent = `全部分析 ${counts.all.length}`;
    }
  });
}

function currentVisiblePapers() {
  const groups = splitReport(state.currentReport);
  const items = state.currentPaperView === "hidden"
    ? groups.hidden
    : state.currentPaperView === "all"
      ? groups.all
      : groups.recommended;

  return [...items].sort((a, b) => {
    if (state.currentSort === "latest") {
      return new Date(b.published) - new Date(a.published);
    }

    return paperScore(b) - paperScore(a) || new Date(b.published) - new Date(a.published);
  });
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知日期" : dateFormatter.format(date);
}

function analysisText(paper, field, fallback = "DeepSeek 未返回该部分内容。") {
  const value = paper?.analysis?.[field];

  if (value) {
    return value;
  }

  if (field === "background" || field === "technicalDetails") {
    return paper?.summary || fallback;
  }

  if (field === "experiment") {
    return "摘要中没有足够实验细节。建议打开论文页面后重点查看 experiments/evaluation 部分，确认数据集、指标、基线和消融实验。";
  }

  if (field === "recommendedReadingPath") {
    return "建议先读摘要和引言确认问题，再读方法图或系统架构，随后看实验设置、主要结果和局限讨论。";
  }

  return fallback;
}

async function translatePaper(paper, button, target) {
  if (!ensureApiKey("请先输入 DeepSeek API Key，摘要翻译必须使用大模型 API。")) {
    return;
  }

  button.disabled = true;
  button.textContent = "翻译中...";

  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        title: paper.title,
        summary: paper.summary,
        ...llmPayload()
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || data.message || "翻译失败。");
    }

    target.hidden = false;
    target.textContent = data.translation;
    button.textContent = "重新翻译";
  } catch (error) {
    target.hidden = false;
    target.textContent = `暂时无法翻译：${error.message}`;
    button.textContent = "翻译摘要";
  } finally {
    button.disabled = false;
  }
}

function renderPaperCards() {
  elements.paperList.textContent = "";
  updatePaperViewTabs();
  const papers = currentVisiblePapers();

  if (!papers.length) {
    const viewName = state.currentPaperView === "hidden" ? "隐藏论文" : state.currentPaperView === "all" ? "全部分析" : "推荐论文";
    showStatus(`${viewName}里暂无论文。可以切换上方视图，或从左侧重新生成推荐列表。`, "warning");
    return;
  }

  hideStatus();

  papers.forEach((paper) => {
    const fragment = elements.paperTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".paper-card");
    const analysis = paper.analysis || {};
    const recommended = isRecommendedPaper(paper);

    card.classList.toggle("hidden-paper", !recommended);
    setScorePill(fragment.querySelector(".score-pill"), paper);
    fragment.querySelector(".date-pill").textContent = formatDate(paper.published);
    fragment.querySelector(".category-pill").textContent = paper.primaryCategory || "arXiv";
    fragment.querySelector("h3").textContent = paper.title || "未命名论文";
    fragment.querySelector(".authors").textContent = paper.authors?.slice(0, 8).join(", ") || "Unknown authors";
    fragment.querySelector(".tldr").textContent = analysis.tldr || "DeepSeek 未返回一句话概要。";
    fragment.querySelector(".abstract").textContent = paper.summary || "";
    fragment.querySelector(".abs-link").href = paper.absLink || paper.id || "#";

    const scoreGrid = fragment.querySelector(".score-grid");
    Object.entries(dimensionLabels).forEach(([key, label]) => {
      scoreGrid.append(createScoreRow(label, analysis.scores?.[key] || 0));
    });

    const matched = Array.isArray(analysis.matchedKeywords) ? analysis.matchedKeywords : [];
    fragment.querySelector(".keyword-line").textContent = matched.length
      ? `命中关键词：${matched.join("、")}`
      : "未提取到明显关键词，建议人工复核摘要。";

    const guideItems = Array.isArray(analysis.readingGuide) ? analysis.readingGuide : [];
    const readingSection = fragment.querySelector(".reading-section");
    const guide = fragment.querySelector(".reading-guide");
    guideItems.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      guide.append(li);
    });

    if (!guideItems.length) {
      readingSection.hidden = true;
    }

    const abstractSection = fragment.querySelector(".abstract-section");
    const translateButton = fragment.querySelector(".translate-button");
    const translation = fragment.querySelector(".translation");

    if (!paper.summary) {
      abstractSection.hidden = true;
    } else {
      translateButton.addEventListener("click", () => translatePaper(paper, translateButton, translation));
    }

    fragment.querySelector(".detail-button").addEventListener("click", () => openPaper(paper));
    elements.paperList.append(fragment);
  });
}

function openReport(report, options = {}) {
  state.currentReport = report;
  state.currentPaper = null;

  if (!options.keepPaperView) {
    state.currentPaperView = "recommended";
  }

  setActiveView("report");
  const counts = splitReport(report);
  const created = report.createdAt ? `${formatDate(report.createdAt)} 生成，` : "";
  const candidateTotal = report.candidateCount ?? counts.all.length;

  setHeader({
    eyebrow: "推荐报告",
    title: report.title || "未命名推荐列表",
    description: `${created}${candidateTotal} 篇候选，推荐 ${counts.recommended.length} 篇，隐藏 ${counts.hidden.length} 篇。`,
    showBack: true
  });
  renderBreadcrumb([
    { label: "推荐列表", onClick: () => showHome() },
    { label: report.title || "推荐报告" }
  ]);
  setMetricsForReport(report);
  renderPaperCards();
}

function createDetailSection(title, items) {
  const section = document.createElement("section");
  const heading = document.createElement("h4");
  heading.textContent = title;
  section.append(heading);

  const paragraphs = Array.isArray(items) ? items : [{ body: items }];
  paragraphs.forEach((item) => {
    const paragraph = document.createElement("p");

    if (item.label) {
      const label = document.createElement("strong");
      label.textContent = `${item.label}：`;
      paragraph.append(label, document.createTextNode(item.body));
    } else {
      paragraph.textContent = item.body;
    }

    section.append(paragraph);
  });

  return section;
}

function openPaper(paper) {
  state.currentPaper = paper;
  setActiveView("paper");
  setHeader({
    eyebrow: "论文分析",
    title: "分析详情",
    description: "先看结论，再看方法、证据和局限。",
    showBack: true
  });
  renderBreadcrumb([
    { label: "推荐列表", onClick: () => showHome() },
    { label: state.currentReport?.title || "推荐报告", onClick: () => openReport(state.currentReport, { keepPaperView: true }) },
    { label: paper.title || "论文详情" }
  ]);
  hideStatus();
  renderPaperDetail(paper);
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function renderPaperDetail(paper) {
  elements.analysisDetail.textContent = "";

  const header = document.createElement("header");
  header.className = "analysis-detail-header";

  const meta = document.createElement("div");
  meta.className = "paper-meta";

  const score = document.createElement("span");
  score.className = "score-pill";
  setScorePill(score, paper);

  const date = document.createElement("span");
  date.className = "date-pill";
  date.textContent = formatDate(paper.published);

  const category = document.createElement("span");
  category.className = "category-pill";
  category.textContent = paper.primaryCategory || "arXiv";

  meta.append(score, date, category);

  const title = document.createElement("h3");
  title.textContent = paper.title || "未命名论文";

  const authors = document.createElement("p");
  authors.className = "authors";
  authors.textContent = paper.authors?.slice(0, 12).join(", ") || "Unknown authors";

  const tldr = document.createElement("p");
  tldr.className = "tldr";
  tldr.textContent = analysisText(paper, "tldr", "DeepSeek 未返回一句话概要。");

  const actions = document.createElement("div");
  actions.className = "paper-actions";

  const back = document.createElement("button");
  back.className = "secondary-action";
  back.type = "button";
  back.textContent = "返回报告";
  back.addEventListener("click", () => openReport(state.currentReport, { keepPaperView: true }));

  const absLink = document.createElement("a");
  absLink.className = "paper-link";
  absLink.target = "_blank";
  absLink.rel = "noreferrer";
  absLink.href = paper.absLink || paper.id || "#";
  absLink.textContent = "打开论文页面";

  actions.append(back, absLink);
  header.append(meta, title, authors, tldr, actions);

  const sections = document.createElement("div");
  sections.className = "analysis-detail-body";
  sections.append(
    createDetailSection("背景与问题", [
      { label: "背景", body: analysisText(paper, "background") },
      { label: "问题", body: analysisText(paper, "problem") }
    ]),
    createDetailSection("方法与技术路线", [
      { label: "核心方法", body: analysisText(paper, "method") },
      { label: "技术细节", body: analysisText(paper, "technicalDetails") }
    ]),
    createDetailSection("贡献、实验与可信度", [
      { label: "主要贡献", body: analysisText(paper, "contribution") },
      { label: "实验与证据", body: analysisText(paper, "experiment") }
    ]),
    createDetailSection("网络价值与局限", [
      { label: "潜在价值", body: analysisText(paper, "networkUseCase") },
      { label: "局限风险", body: analysisText(paper, "limitations") }
    ]),
    createDetailSection("阅读建议与推荐理由", [
      { label: "阅读建议", body: analysisText(paper, "recommendedReadingPath") },
      { label: "推荐理由", body: analysisText(paper, "whyRecommend") }
    ])
  );

  elements.analysisDetail.append(header, sections);
}

async function confirmCandidates() {
  const selected = state.candidatePapers.filter((paper) => state.selectedCandidateIds.has(paper.id));

  if (!selected.length) {
    showStatus("请至少选择 1 篇候选论文。", "warning");
    return;
  }

  try {
    await analyzeConfirmedPapers(selected);
  } catch (error) {
    resetProgressTimer();
    setTaskLocked(false);
    setTaskStatus(`AI 分析失败：${error.message}`, "error", error.retryable ? "retry" : "");
  }
}

elements.filters.addEventListener("submit", (event) => {
  event.preventDefault();
  fetchCandidates();
});

elements.thresholdInput.addEventListener("input", () => {
  elements.thresholdValue.textContent = elements.thresholdInput.value;
  state.currentThreshold = Number(elements.thresholdInput.value);
});

queryModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setQueryMode(button.dataset.queryMode, { sync: button.dataset.queryMode === "builder" });
  });
});

elements.queryText.addEventListener("input", () => {
  setQueryMode("manual", { sync: false });
  localStorage.setItem(storageKeys.query, elements.queryText.value.trim());
});

elements.restoreQuery.addEventListener("click", () => {
  setAllKeywordSelection(true);
  setQueryMode("builder", { sync: true });
});

elements.backToReports.addEventListener("click", () => {
  showHome();
});

elements.selectAllCandidates.addEventListener("click", () => {
  const allSelected = state.selectedCandidateIds.size === state.candidatePapers.length;
  state.selectedCandidateIds = allSelected
    ? new Set()
    : new Set(state.candidatePapers.map((paper) => paper.id));
  elements.candidateList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = !allSelected;
  });
  updateCandidateActionState();
});

elements.confirmCandidates.addEventListener("click", confirmCandidates);

elements.taskClose.addEventListener("click", () => {
  closeTaskDialog();
});

elements.taskDialog.addEventListener("cancel", (event) => {
  if (state.taskLocked) {
    event.preventDefault();
  }
});

elements.taskRetry.addEventListener("click", async () => {
  if (!state.lastAnalyzePapers.length) {
    setTaskStatus("没有可重试的候选论文，请重新生成推荐列表。", "warning");
    return;
  }

  elements.taskRetry.hidden = true;

  try {
    await analyzeConfirmedPapers(state.lastAnalyzePapers);
  } catch (error) {
    resetProgressTimer();
    setTaskLocked(false);
    setTaskStatus(`重试失败：${error.message}`, "error", error.retryable ? "retry" : "");
  }
});

elements.retryButton.addEventListener("click", async () => {
  if (!state.lastAnalyzePapers.length) {
    showStatus("没有可重试的候选论文，请重新生成推荐任务。", "warning");
    return;
  }

  elements.retryButton.hidden = true;

  try {
    await analyzeConfirmedPapers(state.lastAnalyzePapers);
  } catch (error) {
    resetProgressTimer();
    showStatus(`重试失败：${error.message}`, "error", error.retryable ? "retry" : "");
  }
});

paperViewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.currentPaperView = button.dataset.paperView;
    renderPaperCards();
  });
});

sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    sortButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.currentSort = button.dataset.sort;
    renderPaperCards();
  });
});

elements.openApiDialog.addEventListener("click", () => {
  elements.apiKeyInput.value = "";
  elements.apiModel.value = state.runtimeModel;

  if (typeof elements.apiDialog.showModal === "function") {
    elements.apiDialog.showModal();
  }
});

elements.clearApiKey.addEventListener("click", () => {
  state.runtimeApiKey = "";
  sessionStorage.removeItem(storageKeys.apiKey);
  updateApiStatus();
  showStatus("DeepSeek API Key 已清除。生成推荐和翻译前需要重新设置。", "warning");
});

elements.apiForm.addEventListener("submit", (event) => {
  const key = elements.apiKeyInput.value.trim();

  if (!key) {
    event.preventDefault();
    elements.apiKeyInput.focus();
    return;
  }

  state.runtimeApiKey = key;
  state.runtimeModel = elements.apiModel.value;
  sessionStorage.setItem(storageKeys.apiKey, state.runtimeApiKey);
  sessionStorage.setItem(storageKeys.model, state.runtimeModel);
  updateApiStatus();
  showStatus("DeepSeek API Key 已加载，可以生成推荐列表。", "warning");
});

// Defensive cleanup for reports generated by earlier local iterations.
state.reports = state.reports.filter((report) => report && (report.key || report.title));
state.reports = state.reports.slice(0, 20);
persistReports();
updateApiStatus();
showHome();

if (!state.runtimeApiKey && typeof elements.apiDialog.showModal === "function") {
  elements.apiDialog.showModal();
}
