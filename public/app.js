const legacyIndustrialDefaultQuery = `("network" OR "telecom" OR "5G" OR "6G") AND
("AI" OR "machine learning" OR "deep learning" OR "LLM" OR "large language model" OR "foundation model") AND
("anomaly detection" OR "traffic prediction" OR "network optimization" OR "root cause analysis" OR
"digital twin network" OR "intent-based networking" OR "network automation" OR "orchestration" OR
"multi-agent" OR "AI agent" OR "autonomous agent" OR "agent-based system")`;

const legacyResearchBalancedDefaultQuery = `("network" OR "wireless network" OR "mobile network" OR "wireless communication" OR "5G" OR "6G") AND
("AI" OR "machine learning" OR "deep learning" OR "foundation model" OR "graph neural network" OR
"reinforcement learning" OR "self-supervised learning" OR "LLM") AND
("network representation learning" OR "semantic communication" OR "edge intelligence" OR "network modeling" OR
"network measurement" OR "network simulation" OR "protocol learning" OR "routing" OR "resource allocation" OR
"spectrum management" OR "channel estimation" OR "traffic modeling" OR "network optimization" OR "digital twin network")`;

const legacyAgenticNetworkDefaultQuery = `("network" OR "wireless network" OR "mobile network" OR "telecommunication network" OR "5G" OR "6G") AND
("large language model" OR "LLM" OR "foundation model" OR "AI agent" OR "LLM agent" OR
"multi-agent" OR "agentic AI" OR "autonomous agent") AND
("autonomous network" OR "autonomous networking" OR "self-driving network" OR "zero-touch network" OR
"network digital twin" OR "digital twin network" OR "intent-based networking" OR "agent framework" OR
"agentic framework" OR "end-to-end framework" OR "closed-loop autonomy" OR "network automation")`;

const defaultQuery = `("large language model" OR "LLM" OR "foundation model" OR "AI agent" OR "LLM agent" OR
"multi-agent" OR "agentic AI" OR "autonomous agent") AND
("autonomous network" OR "autonomous networking" OR "self-driving network" OR "zero-touch network" OR
"network digital twin" OR "digital twin network" OR "intent-based networking" OR "agent framework" OR
"agentic framework" OR "end-to-end framework" OR "closed-loop autonomy" OR "network automation")`;

const dimensionLabels = {
  scenarioProblemValue: "研究问题价值",
  methodNovelty: "方法新意",
  practicalValue: "系统价值",
  evidence: "证据强度"
};

const dimensionWeights = {
  scenarioProblemValue: 0.2,
  methodNovelty: 0.3,
  practicalValue: 0.2,
  evidence: 0.3
};

const strictIctPattern = /\b(ICT|telecom|telecommunications?|5G|6G|O-RAN|RAN|radio access network|cellular network|mobile network|wireless network|wireless communications?|core network|edge network|network slicing|SDN|NFV|QoS|routing|spectrum|handover|service assurance|fault diagnosis|alarm correlation|optical network|satellite network)\b|通信网络|电信|无线通信|蜂窝|移动网络|无线接入|网络切片/i;
const candidateBatchMax = 100;
const recommendationTargetMax = 100;
const extraBatchMax = 10;
const readingListTitlePrefix = "【精选论文】";

const dimensionFallbacks = {
  scenarioProblemValue: ["scenarioProblemValue", "taskFit"],
  methodNovelty: ["methodNovelty", "novelty"],
  practicalValue: ["practicalValue"],
  evidence: ["evidence"]
};

const queryKeywordGroups = [
  {
    id: "domain",
    title: "背景领域（可选）",
    terms: [
      { value: "network", selected: false },
      { value: "wireless network", selected: false },
      { value: "mobile network", selected: false },
      { value: "telecommunication network", selected: false },
      { value: "5G", selected: false },
      { value: "6G", selected: false },
      { value: "wireless communication", selected: false },
      { value: "telecommunication", selected: false },
      { value: "telecom", selected: false },
      { value: "cellular network", selected: false },
      { value: "radio access network", selected: false },
      { value: "RAN", selected: false },
      { value: "O-RAN", selected: false },
      { value: "core network", selected: false },
      { value: "edge network", selected: false },
      { value: "cloud network", selected: false },
      { value: "multi-access edge computing", selected: false },
      { value: "network slicing", selected: false },
      { value: "SDN", selected: false },
      { value: "NFV", selected: false },
      { value: "private network", selected: false },
      { value: "IoT network", selected: false },
      { value: "satellite network", selected: false },
      { value: "optical network", selected: false }
    ]
  },
  {
    id: "ai",
    title: "大模型/智能体",
    terms: [
      "large language model",
      "LLM",
      "foundation model",
      "AI agent",
      "LLM agent",
      "multi-agent",
      "agentic AI",
      "autonomous agent",
      { value: "AI", selected: false },
      { value: "machine learning", selected: false },
      { value: "deep learning", selected: false },
      { value: "graph neural network", selected: false },
      { value: "reinforcement learning", selected: false },
      { value: "self-supervised learning", selected: false },
      { value: "planning", selected: false },
      { value: "tool use", selected: false },
      { value: "time series forecasting", selected: false },
      { value: "federated learning", selected: false },
      { value: "transfer learning", selected: false },
      { value: "retrieval augmented generation", selected: false },
      { value: "knowledge graph", selected: false },
      { value: "transformer", selected: false },
      { value: "generative AI", selected: false },
      { value: "Bayesian optimization", selected: false },
      { value: "causal inference", selected: false }
    ]
  },
  {
    id: "task",
    title: "研究方向",
    terms: [
      "autonomous network",
      "autonomous networking",
      "self-driving network",
      "zero-touch network",
      "network digital twin",
      "digital twin network",
      "intent-based networking",
      "agent framework",
      "agentic framework",
      "end-to-end framework",
      "closed-loop autonomy",
      "network automation",
      { value: "network orchestration", selected: false },
      { value: "closed-loop automation", selected: false },
      { value: "network management", selected: false },
      { value: "agent-based system", selected: false },
      { value: "multi-agent system", selected: false },
      { value: "semantic communication", selected: false },
      { value: "edge intelligence", selected: false },
      { value: "network modeling", selected: false },
      { value: "network simulation", selected: false },
      { value: "protocol learning", selected: false },
      { value: "network optimization", selected: false },
      { value: "anomaly detection", selected: false },
      { value: "traffic prediction", selected: false },
      { value: "root cause analysis", selected: false },
      { value: "orchestration", selected: false },
      { value: "fault diagnosis", selected: false },
      { value: "alarm correlation", selected: false },
      { value: "performance prediction", selected: false },
      { value: "QoS prediction", selected: false },
      { value: "routing optimization", selected: false },
      { value: "energy efficiency", selected: false },
      { value: "load balancing", selected: false },
      { value: "handover optimization", selected: false },
      { value: "capacity planning", selected: false },
      { value: "service assurance", selected: false },
      { value: "security monitoring", selected: false },
      { value: "intrusion detection", selected: false },
      { value: "policy optimization", selected: false }
    ]
  }
];

const storageKeys = {
  reports: "paper-insight:weekly",
  scoringRulesVersion: "paper-insight:scoring-rules-version",
  query: "paper-insight:query",
  queryMode: "paper-insight:query-mode",
  querySelection: "paper-insight:query-selection",
  queryDefaultsVersion: "paper-insight:query-defaults-version",
  apiKey: "paper-insight:llm-key",
  legacyApiKey: "paper-insight:deepseek-key",
  provider: "paper-insight:llm-provider",
  model: "paper-insight:llm-model",
  legacyModel: "paper-insight:deepseek-model"
};

const llmProviders = {
  "glm-coding-anthropic": {
    label: "GLM-5.2 (Anthropic)",
    defaultModel: "glm-5.2",
    keyPlaceholder: "请输入 BigModel API Key",
    models: [
      "glm-5.2"
    ]
  }
};

const normalizeProviderKey = (provider) => {
  const key = String(provider || "").trim();

  if (key === "glm" || key === "glm-coding") {
    return "glm-coding-anthropic";
  }

  return llmProviders[key] ? key : "glm-coding-anthropic";
};
const providerLabel = (provider = state.runtimeProvider) => llmProviders[normalizeProviderKey(provider)].label;
const providerDefaultModel = (provider) => llmProviders[normalizeProviderKey(provider)].defaultModel;
const providerModelStorageKey = (provider) => `${storageKeys.model}:${normalizeProviderKey(provider)}`;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  apiDialog: $("#apiDialog"),
  apiForm: $("#apiForm"),
  apiKeyInput: $("#apiKeyInput"),
  apiProvider: $("#apiProvider"),
  apiModel: $("#apiModel"),
  apiStatus: $("#apiStatus"),
  apiClose: $("#apiClose"),
  openApiDialog: $("#openApiDialog"),
  clearApiKey: $("#clearApiKey"),
  filters: $("#filters"),
  generateReport: $("#generateReport"),
  openRecommendations: $("#openRecommendations"),
  openExplore: $("#openExplore"),
  queryDialog: $("#queryDialog"),
  openQueryDialog: $("#openQueryDialog"),
  queryClose: $("#queryClose"),
  queryApply: $("#queryApply"),
  querySummary: $("#querySummary"),
  querySummaryDetails: $("#querySummaryDetails"),
  queryText: $("#queryText"),
  queryBuilder: $("#queryBuilder"),
  limitInput: $("#limit"),
  minRecommendedInput: $("#minRecommended"),
  thresholdInput: $("#threshold"),
  thresholdValue: $("#thresholdValue"),
  dateWindow: $("#dateWindow"),
  syncStatus: $("#syncStatus"),
  syncDetails: $("#syncDetails"),
  syncArxiv: $("#syncArxiv"),
  openSyncHistory: $("#openSyncHistory"),
  syncProgressDialog: $("#syncProgressDialog"),
  syncProgressMessage: $("#syncProgressMessage"),
  syncProgressCategories: $("#syncProgressCategories"),
  syncProgressClose: $("#syncProgressClose"),
  syncHistoryDialog: $("#syncHistoryDialog"),
  syncHistoryClose: $("#syncHistoryClose"),
  syncHistoryStatus: $("#syncHistoryStatus"),
  syncHistoryList: $("#syncHistoryList"),
  refreshSyncHistory: $("#refreshSyncHistory"),
  restoreQuery: $("#restoreQuery"),
  taskDialog: $("#taskDialog"),
  taskTitle: $("#taskTitle"),
  taskDescription: $("#taskDescription"),
  taskClose: $("#taskClose"),
  taskSteps: $("#taskSteps"),
  taskStatus: $("#taskStatus"),
  taskRefreshCandidates: $("#taskRefreshCandidates"),
  taskForceArxiv: $("#taskForceArxiv"),
  taskRetry: $("#taskRetry"),
  candidateForceArxiv: $("#candidateForceArxiv"),
  taskCandidatePanel: $("#taskCandidatePanel"),
  taskProgressPanel: $("#taskProgressPanel"),
  taskDonePanel: $("#taskDonePanel"),
  taskDoneSummary: $("#taskDoneSummary"),
  readingListDialog: $("#readingListDialog"),
  readingListTitle: $("#readingListTitle"),
  readingListStatus: $("#readingListStatus"),
  readingListUseOriginalText: $("#readingListUseOriginalText"),
  readingListInlineUseOriginalText: $("#readingListInlineUseOriginalText"),
  readingListCandidateFloor: $("#readingListCandidateFloor"),
  readingListCandidateFloorValue: $("#readingListCandidateFloorValue"),
  readingListReviewThreshold: $("#readingListReviewThreshold"),
  readingListReviewThresholdValue: $("#readingListReviewThresholdValue"),
  readingListMinSelected: $("#readingListMinSelected"),
  readingListReviewPreview: $("#readingListReviewPreview"),
  readingListProgress: $("#readingListProgress"),
  readingListProgressTitle: $("#readingListProgressTitle"),
  readingListProgressDetail: $("#readingListProgressDetail"),
  readingListProgressMeta: $("#readingListProgressMeta"),
  readingListSteps: $("#readingListSteps"),
  readingListSourcePanel: $("#readingListSourcePanel"),
  readingListSourceSummary: $("#readingListSourceSummary"),
  readingListSourceToggle: $("#readingListSourceToggle"),
  readingListSourceList: $("#readingListSourceList"),
  readingListOutput: $("#readingListOutput"),
  readingListClose: $("#readingListClose"),
  readingListRegenerate: $("#readingListRegenerate"),
  readingListDownload: $("#readingListDownload"),
  readingListCopy: $("#readingListCopy"),
  generateReadingList: $("#generateReadingList"),
  breadcrumb: $("#breadcrumb"),
  pageEyebrow: $("#pageEyebrow"),
  pageTitle: $("#pageTitle"),
  pageDescription: $("#pageDescription"),
  backToReports: $("#backToReports"),
  statusPanel: $("#statusPanel"),
  retryButton: $("#retryButton"),
  homeView: $("#homeView"),
  exploreView: $("#exploreView"),
  reportView: $("#reportView"),
  paperView: $("#paperView"),
  reportHomeList: $("#reportHomeList"),
  exploreSearch: $("#exploreSearch"),
  explorePaperList: $("#explorePaperList"),
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
const exploreSortButtons = $$("[data-explore-sort]");

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric"
});

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const queryDefaultsVersion = "agentic-autonomy-no-domain-2026-06";
const scoringRulesVersion = "research-quality-rubric-specific-lowreason-v2026-07-10";
const readingListStepOrder = ["collect", "submit", "source", "review", "generate", "receive", "save"];

function normalizeQueryText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function migrateStoredQueryDefaults() {
  if (localStorage.getItem(storageKeys.queryDefaultsVersion) === queryDefaultsVersion) {
    return;
  }

  const saved = localStorage.getItem(storageKeys.query);
  const usesLegacyDefault = !saved
    || normalizeQueryText(saved) === normalizeQueryText(legacyIndustrialDefaultQuery)
    || normalizeQueryText(saved) === normalizeQueryText(legacyResearchBalancedDefaultQuery)
    || normalizeQueryText(saved) === normalizeQueryText(legacyAgenticNetworkDefaultQuery);

  if (usesLegacyDefault) {
    localStorage.removeItem(storageKeys.query);
    localStorage.removeItem(storageKeys.queryMode);
    localStorage.removeItem(storageKeys.querySelection);
  }

  localStorage.setItem(storageKeys.queryDefaultsVersion, queryDefaultsVersion);
}

function migrateStoredReportsForScoringRules() {
  if (localStorage.getItem(storageKeys.scoringRulesVersion) === scoringRulesVersion) {
    return;
  }

  localStorage.removeItem(storageKeys.reports);
  localStorage.setItem(storageKeys.scoringRulesVersion, scoringRulesVersion);
}

migrateStoredQueryDefaults();
migrateStoredReportsForScoringRules();

const savedQuery = localStorage.getItem(storageKeys.query);
const savedQueryMode = localStorage.getItem(storageKeys.queryMode);
const savedProvider = normalizeProviderKey(sessionStorage.getItem(storageKeys.provider) || "glm-coding-anthropic");

const state = {
  reports: loadReports(),
  runtimeProvider: savedProvider,
  runtimeApiKey: sessionStorage.getItem(storageKeys.apiKey) || sessionStorage.getItem(storageKeys.legacyApiKey) || "",
  runtimeModel: sessionStorage.getItem(providerModelStorageKey(savedProvider))
    || (savedProvider === "deepseek" ? sessionStorage.getItem(storageKeys.model) : "")
    || (savedProvider === "deepseek" ? sessionStorage.getItem(storageKeys.legacyModel) : "")
    || providerDefaultModel(savedProvider),
  view: "home",
  currentReport: null,
  currentPaper: null,
  currentReadingListReport: null,
  currentPaperView: "recommended",
  currentSort: "score",
  exploreSort: "score",
  exploreSearch: "",
  paperReturnView: "report",
  paperReturnReport: null,
  queryMode: savedQueryMode || (savedQuery ? "manual" : "builder"),
  currentThreshold: 70,
  currentMinRecommended: 3,
  candidatePapers: [],
  selectedCandidateIds: new Set(),
  candidateSearch: null,
  lastAnalyzePapers: [],
  analysisSession: null,
  progressTimer: 0,
  sourceStatusTimer: 0,
  syncStatusTimer: 0,
  readingListTimer: 0,
  readingListStatusTimer: 0,
  readingListStartedAt: 0,
  readingListLiveStatus: null,
  readingListSourceExpanded: false,
  progressState: null,
  taskLocked: false,
  taskCloseTimer: 0
};

renderKeywordBuilder();
elements.queryText.value = savedQuery || buildQueryFromSelectedKeywords() || defaultQuery;
setQueryMode(state.queryMode === "manual" ? "manual" : "builder", { sync: !savedQuery });
renderApiModelOptions(state.runtimeProvider, state.runtimeModel);
state.currentThreshold = Number(elements.thresholdInput.value || 70);
state.currentMinRecommended = minRecommendedValue();

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

function replaceStoredReport(report) {
  if (!report) {
    return null;
  }

  state.reports = state.reports.map((item) => item.key === report.key ? report : item);

  if (state.currentReport?.key === report.key) {
    state.currentReport = report;
  }

  if (state.currentReadingListReport?.key === report.key) {
    state.currentReadingListReport = report;
  }

  persistReports();
  return report;
}

function quoteQueryTerm(term) {
  return `"${String(term).replace(/"/g, "").trim()}"`;
}

function queryTermValue(term) {
  return typeof term === "string" ? term : term.value;
}

function queryTermDefaultSelected(term) {
  return typeof term === "string" || term.selected !== false;
}

function queryGroupValues(group) {
  return group.terms.map(queryTermValue).filter(Boolean);
}

function defaultQuerySelection() {
  return Object.fromEntries(queryKeywordGroups.map((group) => [
    group.id,
    group.terms.filter(queryTermDefaultSelected).map(queryTermValue)
  ]));
}

function loadQuerySelection() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKeys.querySelection) || "{}");
    const fallback = defaultQuerySelection();

    queryKeywordGroups.forEach((group) => {
      const validTerms = queryGroupValues(group);
      const selected = Array.isArray(parsed[group.id])
        ? parsed[group.id].filter((term) => validTerms.includes(term))
        : fallback[group.id];

      parsed[group.id] = selected;
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

function querySelectionCounts(selection = selectedKeywordTerms()) {
  return queryKeywordGroups.map((group) => ({
    id: group.id,
    title: group.title,
    selected: Array.isArray(selection[group.id]) ? selection[group.id].length : 0,
    total: queryGroupValues(group).length
  }));
}

function updateQueryGroupControls() {
  const counts = querySelectionCounts();

  counts.forEach((item) => {
    const count = elements.queryBuilder.querySelector(`[data-query-group-count="${item.id}"]`);
    const selectAll = elements.queryBuilder.querySelector(`[data-query-group-select="${item.id}"]`);

    if (count) {
      count.textContent = `${item.selected}/${item.total}`;
    }

    if (selectAll) {
      selectAll.disabled = item.selected === item.total;
      selectAll.textContent = item.selected === item.total ? "已全选" : "全选";
    }
  });
}

function updateQuerySummary() {
  if (!elements.querySummary) {
    return;
  }

  elements.querySummaryDetails.textContent = "";

  if (state.queryMode === "manual") {
    const query = elements.queryText.value.trim() || defaultQuery;
    elements.querySummary.textContent = "手工输入";

    const preview = document.createElement("p");
    preview.className = "query-manual-preview";
    preview.textContent = query.length > 220 ? `${query.slice(0, 220)}...` : query;
    elements.querySummaryDetails.append(preview);
    return;
  }

  const selection = selectedKeywordTerms();
  const counts = querySelectionCounts(selection);
  elements.querySummary.textContent = counts
    .map((item) => `${item.title} ${item.selected}/${item.total}`)
    .join(" · ");

  counts.forEach((item) => {
    const row = document.createElement("div");
    row.className = "query-summary-row";

    const label = document.createElement("span");
    label.textContent = item.title;

    const terms = document.createElement("p");
    const selected = Array.isArray(selection[item.id]) ? selection[item.id] : [];
    terms.textContent = selected.length ? selected.join("、") : "未选择";

    row.append(label, terms);
    elements.querySummaryDetails.append(row);
  });
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
  updateQueryGroupControls();
  updateQuerySummary();
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

  updateQuerySummary();
}

function setKeywordSelection(selection) {
  elements.queryBuilder.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    const groupSelection = Array.isArray(selection[input.dataset.queryGroup])
      ? selection[input.dataset.queryGroup]
      : [];
    input.checked = groupSelection.includes(input.value);
  });
  persistQuerySelection();
  updateQueryGroupControls();
}

function setGroupKeywordSelection(groupId, checked) {
  elements.queryBuilder.querySelectorAll(`input[data-query-group="${groupId}"]`).forEach((input) => {
    input.checked = checked;
  });
  persistQuerySelection();
  updateQueryGroupControls();
}

function renderKeywordBuilder() {
  elements.queryBuilder.textContent = "";
  const selection = loadQuerySelection();

  queryKeywordGroups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "query-group";

    const heading = document.createElement("div");
    heading.className = "query-group-heading";

    const title = document.createElement("h3");
    title.textContent = group.title;

    const tools = document.createElement("div");
    tools.className = "query-group-tools";

    const count = document.createElement("span");
    count.dataset.queryGroupCount = group.id;

    const selectAll = document.createElement("button");
    selectAll.type = "button";
    selectAll.className = "query-group-select";
    selectAll.dataset.queryGroupSelect = group.id;
    selectAll.textContent = "全选";
    selectAll.addEventListener("click", () => {
      setGroupKeywordSelection(group.id, true);
      setQueryMode("builder", { sync: true });
    });

    tools.append(count, selectAll);
    heading.append(title, tools);

    const choices = document.createElement("div");
    choices.className = "query-chip-list";

    group.terms.forEach((term) => {
      const value = queryTermValue(term);
      const label = document.createElement("label");
      label.className = "query-chip";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = value;
      checkbox.dataset.queryGroup = group.id;
      checkbox.checked = selection[group.id]?.includes(value) ?? queryTermDefaultSelected(term);
      checkbox.addEventListener("change", () => {
        setQueryMode("builder", { sync: true });
      });

      const text = document.createElement("span");
      text.textContent = value;

      label.append(checkbox, text);
      choices.append(label);
    });

    section.append(heading, choices);
    elements.queryBuilder.append(section);
  });

  updateQueryGroupControls();
  updateQuerySummary();
}

function currentSearchQuery() {
  if (state.queryMode === "builder") {
    return syncQueryFromBuilder();
  }

  const query = elements.queryText.value.trim() || defaultQuery;
  localStorage.setItem(storageKeys.query, query);
  return query;
}

function modelForProvider(provider) {
  const key = normalizeProviderKey(provider);
  const savedModel = sessionStorage.getItem(providerModelStorageKey(key));
  return savedModel || providerDefaultModel(key);
}

function renderApiModelOptions(provider, selectedModel = "") {
  const key = normalizeProviderKey(provider);
  const config = llmProviders[key];
  const selected = selectedModel || modelForProvider(key);

  elements.apiProvider.value = key;
  elements.apiKeyInput.placeholder = config.keyPlaceholder;
  elements.apiModel.textContent = "";

  config.models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    elements.apiModel.append(option);
  });

  if (!config.models.includes(selected)) {
    const custom = document.createElement("option");
    custom.value = selected;
    custom.textContent = selected;
    elements.apiModel.append(custom);
  }

  elements.apiModel.value = selected;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function candidateLimitValue() {
  return Math.max(5, Math.min(candidateBatchMax, Number(elements.limitInput.value) || 10));
}

function minRecommendedValue() {
  return Math.max(0, Math.min(recommendationTargetMax, Number(elements.minRecommendedInput?.value) || 0));
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

function reportDisplayTitle(report) {
  if (report?.createdAt) {
    return `${formatDateTime(report.createdAt)} 推荐列表`;
  }

  return report?.title || "未命名推荐列表";
}

function normalizePaperKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "doi:")
    .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//, "arxiv:")
    .replace(/\.pdf$/, "")
    .replace(/[?#].*$/, "")
    .trim();
}

function normalizedTitleKey(title) {
  return normalizePaperKey(title)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function paperDuplicateKeys(paper) {
  return [
    normalizePaperKey(paper?.id),
    normalizePaperKey(paper?.absLink),
    normalizePaperKey(paper?.link),
    normalizedTitleKey(paper?.title)
  ].filter(Boolean);
}

function rememberPaperKeys(seen, paper) {
  paperDuplicateKeys(paper).forEach((key) => seen.add(key));
}

function uniqueCandidatePapers(papers, seen) {
  const unique = [];

  papers.forEach((paper) => {
    const keys = paperDuplicateKeys(paper);
    const duplicate = keys.some((key) => seen.has(key));

    if (duplicate) {
      return;
    }

    unique.push(paper);
    keys.forEach((key) => seen.add(key));
  });

  return unique;
}

function findHistoricalAnalysis(paper) {
  const keys = new Set(paperDuplicateKeys(paper));

  if (!keys.size) {
    return null;
  }

  for (const report of state.reports) {
    for (const item of reportPapers(report)) {
      if (!item?.analysis) {
        continue;
      }

      const matched = paperDuplicateKeys(item).some((key) => keys.has(key));

      if (matched) {
        return { report, paper: item };
      }
    }
  }

  return null;
}

function mergeHistoricalAnalysis(candidate, historical) {
  return {
    ...historical.paper,
    ...candidate,
    analysis: historical.paper.analysis,
    reusedAnalysis: {
      reportTitle: reportDisplayTitle(historical.report),
      createdAt: historical.report?.createdAt || ""
    }
  };
}

function annotateHistoricalAnalysis(paper) {
  const historical = findHistoricalAnalysis(paper);

  if (!historical) {
    return paper;
  }

  return mergeHistoricalAnalysis(paper, historical);
}

function thresholdFor(report = state.currentReport) {
  return Number(report?.threshold ?? state.currentThreshold ?? 70);
}

function recommendationTargetFor(report = state.currentReport) {
  return Math.max(0, Math.min(recommendationTargetMax, Number(report?.recommendedTarget ?? report?.minRecommended ?? 0) || 0));
}

function rawDimensionScore(paper, key) {
  const scores = paper?.analysis?.scores || {};
  const candidates = dimensionFallbacks[key] || [key];
  const value = candidates.map((candidate) => scores[candidate]).find((score) => Number.isFinite(Number(score)));
  return Number.isFinite(Number(value)) ? clamp(value) : null;
}

function dimensionScore(paper, key) {
  return rawDimensionScore(paper, key) ?? 0;
}

function weightedPaperScore(paper) {
  let weighted = 0;
  let totalWeight = 0;

  Object.entries(dimensionWeights).forEach(([key, weight]) => {
    const value = rawDimensionScore(paper, key);
    if (value === null) {
      return;
    }

    weighted += value * weight;
    totalWeight += weight;
  });

  if (!totalWeight) {
    return null;
  }

  const base = weighted / totalWeight;
  const method = rawDimensionScore(paper, "methodNovelty") ?? 0;
  const evidence = rawDimensionScore(paper, "evidence") ?? 0;
  const weakestResearchSignal = Math.min(method, evidence);
  const balancePenalty = Math.max(0, base - weakestResearchSignal) * 0.12;
  const weakEvidencePenalty = Math.max(0, 70 - evidence) * 0.2;

  return Math.round(clamp(base * 1.2 - 22 - balancePenalty - weakEvidencePenalty));
}

function paperScore(paper) {
  const weighted = weightedPaperScore(paper);
  return weighted ?? clamp(paper?.analysis?.score ?? 0);
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
      description: "研究贡献、方法和证据都较强，适合直接读正文。"
    };
  }

  if (value >= 80) {
    return {
      label: "重点关注",
      className: "score-tier-focus",
      description: "有明确研究价值，适合加入本周阅读。"
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

function recommendedPapersForReadingList(report = state.currentReport) {
  return [...splitReport(report).recommended].sort((a, b) => (
    paperScore(b) - paperScore(a)
    || new Date(b.published || b.updated) - new Date(a.published || a.updated)
  ));
}

function readingListDirection(paper) {
  const keywords = Array.isArray(paper?.analysis?.matchedKeywords) ? paper.analysis.matchedKeywords : [];
  const candidates = [
    ...keywords,
    paperCategoryLabel(paper)
  ].filter(Boolean);

  return candidates.slice(0, 4).join(" / ") || "相关研究";
}

function industryTagsForPaper(paper) {
  const explicit = Array.isArray(paper?.analysis?.industryTags) ? paper.analysis.industryTags : [];
  const tags = explicit.map((item) => String(item || "").trim()).filter(Boolean);
  const text = [
    paper?.title,
    paper?.summary,
    ...(Array.isArray(paper?.analysis?.matchedKeywords) ? paper.analysis.matchedKeywords : [])
  ].filter(Boolean).join(" ");
  const hasStrictIctSignal = strictIctPattern.test(text);
  const normalized = tags
    .map((tag) => (/^ICT$/i.test(tag) ? "ICT" : tag))
    .filter((tag) => !/\bICT\b/i.test(tag) || hasStrictIctSignal);

  return [...new Set(normalized)].slice(0, 4);
}

function appendIndustryTagPills(meta, paper) {
  industryTagsForPaper(paper).forEach((tag) => {
    const pill = document.createElement("span");
    pill.className = "industry-pill";
    pill.textContent = tag;
    pill.title = "产业/方向匹配标签，不参与推荐分计算。";
    meta.append(pill);
  });
}

function readingListPaperPayload(paper) {
  const analysis = paper.analysis || {};
  const dimensionDetails = Object.entries(dimensionLabels).map(([key, label]) => ({
    key,
    label,
    score: dimensionScore(paper, key)
  }));
  const matchedDimensions = dimensionDetails
    .filter((item) => item.score >= 70)
    .sort((a, b) => b.score - a.score)
    .map((item) => `${item.label} ${item.score}`);

  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    published: paper.published,
    updated: paper.updated,
    primaryCategory: paper.primaryCategory,
    categories: paper.categories,
    absLink: paper.absLink,
    link: paper.link,
    summary: paper.summary,
    direction: readingListDirection(paper),
    analysis: {
      score: paperScore(paper),
      scores: Object.fromEntries(dimensionDetails.map((item) => [item.key, item.score])),
      dimensionDetails,
      matchedDimensions,
      tldr: analysis.tldr || "",
      valueHighlight: highValueSignalForPaper(paper),
      problem: analysis.problem || "",
      background: analysis.background || "",
      method: analysis.method || "",
      technicalDetails: analysis.technicalDetails || "",
      contribution: analysis.contribution || "",
      experiment: analysis.experiment || "",
      networkUseCase: analysis.networkUseCase || "",
      limitations: analysis.limitations || "",
      recommendedReadingPath: analysis.recommendedReadingPath || "",
      whyRecommend: analysis.whyRecommend || "",
      notRecommendReason: notRecommendReasonForPaper(paper),
      readingGuide: Array.isArray(analysis.readingGuide) ? analysis.readingGuide : [],
      industryTags: industryTagsForPaper(paper),
      matchedKeywords: Array.isArray(analysis.matchedKeywords) ? analysis.matchedKeywords : []
    }
  };
}

function explorePapers() {
  const keyMap = new Map();
  const papers = [];

  state.reports.forEach((report) => {
    reportPapers(report).forEach((paper) => {
      if (!paper?.title) {
        return;
      }

      const keys = paperDuplicateKeys(paper);
      const existing = keys.map((key) => keyMap.get(key)).find(Boolean);
      const reportInfo = {
        title: reportDisplayTitle(report),
        createdAt: report.createdAt || "",
        report,
        recommended: isRecommendedPaper(paper, report)
      };

      if (existing) {
        existing._exploreReports.push(reportInfo);
        keys.forEach((key) => keyMap.set(key, existing));
        return;
      }

      const record = {
        ...paper,
        _exploreReports: [reportInfo],
        _exploreLatestReport: report
      };
      papers.push(record);
      keys.forEach((key) => keyMap.set(key, record));
    });
  });

  return papers;
}

function explorePaperOrigin(paper) {
  const reports = Array.isArray(paper?._exploreReports) ? paper._exploreReports : [];
  const latest = reports[0];
  const recommendedCount = reports.filter((report) => report.recommended).length;
  const countText = reports.length > 1 ? `${reports.length} 个列表出现` : "1 个列表出现";
  const recommendText = recommendedCount ? ` · ${recommendedCount} 次推荐` : "";
  const latestText = latest ? ` · 最近：${latest.title}` : "";

  return `${countText}${recommendText}${latestText}`;
}

function filteredExplorePapers() {
  const query = state.exploreSearch.trim().toLowerCase();
  const papers = explorePapers();
  const filtered = query
    ? papers.filter((paper) => [
        paper.title,
        paper.authors?.join(" "),
        paper.summary,
        paper.analysis?.tldr,
        paper.analysis?.matchedKeywords?.join(" "),
        paperCategoryLabel(paper)
      ].filter(Boolean).join(" ").toLowerCase().includes(query))
    : papers;

  return filtered.sort((a, b) => {
    if (state.exploreSort === "latest") {
      return new Date(b.published || b.updated) - new Date(a.published || a.updated);
    }

    return paperScore(b) - paperScore(a) || new Date(b.published || b.updated) - new Date(a.published || a.updated);
  });
}

function modeLabel(mode) {
  if (mode === "glm-coding-anthropic") {
    return "GLM-5.2 (Anthropic)";
  }

  return "GLM-5.2 (Anthropic)";
}

function weekStart(date = new Date()) {
  const start = new Date(date);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start;
}

function isoDate(value = new Date()) {
  const date = new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = safeDate.getFullYear();
  const month = String(safeDate.getMonth() + 1).padStart(2, "0");
  const day = String(safeDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekOfMonth(value = new Date()) {
  const date = new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return Math.floor((safeDate.getDate() - 1) / 7) + 1;
}

function reportTitle() {
  return `${dateTimeFormatter.format(new Date())} 推荐列表`;
}

function readingListTitle(report = state.currentReport) {
  const date = new Date(report?.createdAt || new Date());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${readingListTitlePrefix}${safeDate.getFullYear()}年${safeDate.getMonth() + 1}月第${weekOfMonth(safeDate)}月精选论文阅读清单`;
}

function setActiveView(name) {
  state.view = name;
  Object.entries({
    home: elements.homeView,
    explore: elements.exploreView,
    report: elements.reportView,
    paper: elements.paperView
  }).forEach(([key, view]) => {
    view.classList.toggle("active", key === name);
  });

  const activeMode = name === "explore" || (name === "paper" && state.paperReturnView === "explore") ? "explore" : "recommend";
  elements.openRecommendations.classList.toggle("active", activeMode === "recommend");
  elements.openExplore.classList.toggle("active", activeMode === "explore");
}

function setHeader({ eyebrow, title, description, showBack = false, backLabel = "返回列表", compact = false }) {
  elements.pageEyebrow.textContent = eyebrow;
  elements.pageTitle.textContent = title;
  elements.pageDescription.textContent = description;
  elements.backToReports.hidden = !showBack;
  elements.backToReports.textContent = backLabel;
  elements.breadcrumb.classList.toggle("compact-page", compact);
  elements.pageTitle.closest(".page-header").classList.toggle("compact-page", compact);
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
  elements.apiStatus.textContent = state.runtimeApiKey
    ? `已设置：${providerLabel()} / ${state.runtimeModel}`
    : `未设置 ${providerLabel()} API Key`;
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
  elements.generateReport.disabled = locked;
  elements.openRecommendations.disabled = locked;
  elements.openExplore.disabled = locked;
  elements.taskRefreshCandidates.disabled = locked;
  elements.taskForceArxiv.disabled = locked;
  elements.candidateForceArxiv.disabled = locked;
  elements.syncArxiv.disabled = locked;
  elements.generateReadingList.disabled = locked || !reportPapers(state.currentReport).length;
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
  const candidatePanelActive = elements.taskCandidatePanel.classList.contains("active");
  const showRefreshCandidates = action === "refresh";
  const showForceArxiv = (action === "refresh" || action === "force-arxiv") && !candidatePanelActive;

  elements.taskStatus.className = `task-status visible${type === "error" ? " error" : ""}${type === "warning" ? " warning" : ""}${type === "success" ? " success" : ""}`;
  elements.taskStatus.querySelector("p").textContent = message;
  elements.taskRefreshCandidates.hidden = !showRefreshCandidates;
  elements.taskForceArxiv.hidden = !showForceArxiv;
  elements.taskRetry.hidden = action !== "retry";
}

function showTaskPanel(panelName) {
  elements.taskCandidatePanel.classList.toggle("active", panelName === "candidate");
  elements.taskProgressPanel.classList.toggle("active", panelName === "progress");
  elements.taskDonePanel.classList.toggle("active", panelName === "done");
  elements.candidateForceArxiv.hidden = panelName !== "candidate";
}

function llmPayload() {
  return state.runtimeApiKey
    ? {
        llmApiKey: state.runtimeApiKey,
        llmProvider: state.runtimeProvider,
        llmModel: state.runtimeModel
      }
    : {};
}

function ensureApiKey(message = `请先输入 ${providerLabel()} API Key。没有大模型 API 不会生成推荐。`) {
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

function resetSyncStatusTimer() {
  if (state.syncStatusTimer) {
    window.clearInterval(state.syncStatusTimer);
    state.syncStatusTimer = 0;
  }
}

function resetReadingListTimer() {
  if (state.readingListTimer) {
    window.clearInterval(state.readingListTimer);
    state.readingListTimer = 0;
  }
}

function resetReadingListStatusTimer() {
  if (state.readingListStatusTimer) {
    window.clearInterval(state.readingListStatusTimer);
    state.readingListStatusTimer = 0;
  }
}

function setReadingListStep(activeStep = "") {
  const activeIndex = readingListStepOrder.indexOf(activeStep);
  elements.readingListSteps?.querySelectorAll("li").forEach((item) => {
    const itemIndex = readingListStepOrder.indexOf(item.dataset.readingStep);
    item.classList.toggle("active", item.dataset.readingStep === activeStep);
    item.classList.toggle("done", activeIndex >= 0 && itemIndex >= 0 && itemIndex < activeIndex);
  });
}

function setReadingListProgress(type, title, detail, { step = "", meta = "" } = {}) {
  elements.readingListDialog.classList.toggle("ready", type === "ready");
  elements.readingListDialog.classList.toggle("failed", type === "failed");
  elements.readingListProgressTitle.textContent = title;
  elements.readingListProgressDetail.textContent = detail;
  elements.readingListProgressMeta.textContent = meta;
  setReadingListStep(step);
}

function clearReadingListSourceStatus() {
  state.readingListLiveStatus = null;
  state.readingListSourceExpanded = false;

  if (elements.readingListSourcePanel) {
    elements.readingListSourcePanel.hidden = true;
    elements.readingListSourcePanel.classList.add("collapsed");
  }

  if (elements.readingListSourceSummary) {
    elements.readingListSourceSummary.textContent = "等待开始";
  }

  if (elements.readingListSourceToggle) {
    elements.readingListSourceToggle.textContent = "展开";
    elements.readingListSourceToggle.setAttribute("aria-expanded", "false");
  }

  if (elements.readingListSourceList) {
    elements.readingListSourceList.textContent = "";
    elements.readingListSourceList.hidden = true;
  }
}

function setReadingListSourceExpanded(expanded) {
  state.readingListSourceExpanded = Boolean(expanded);

  if (elements.readingListSourcePanel) {
    elements.readingListSourcePanel.classList.toggle("collapsed", !state.readingListSourceExpanded);
  }

  if (elements.readingListSourceToggle) {
    elements.readingListSourceToggle.textContent = state.readingListSourceExpanded ? "收起" : "展开";
    elements.readingListSourceToggle.setAttribute("aria-expanded", String(state.readingListSourceExpanded));
  }

  if (elements.readingListSourceList) {
    elements.readingListSourceList.hidden = !state.readingListSourceExpanded;
  }
}

function readingListSourceBadge(stateName) {
  const labels = {
    pending: "等待",
    running: "抓取中",
    available: "已获取",
    unavailable: "未获取"
  };

  return labels[stateName] || "未知";
}

function renderReadingListSourceStatus(data) {
  const items = Array.isArray(data?.originalTextItems) ? data.originalTextItems : [];

  if (!items.length || !elements.readingListSourcePanel || !elements.readingListSourceList) {
    if (elements.readingListSourcePanel) {
      elements.readingListSourcePanel.hidden = true;
    }
    return;
  }

  const summary = data.originalTextSummary || {};
  const total = Number(summary.total || items.length);
  const available = Number(summary.available || 0);
  const unavailable = Number(summary.unavailable || 0);
  const running = Number(summary.running || 0);
  const pending = Number(summary.pending || 0);
  elements.readingListSourcePanel.hidden = false;
  elements.readingListSourceSummary.textContent = `成功 ${available} · 未获取 ${unavailable} · 进行中 ${running} · 等待 ${pending} / ${total}`;
  setReadingListSourceExpanded(state.readingListSourceExpanded);

  if (!state.readingListSourceExpanded) {
    return;
  }

  elements.readingListSourceList.textContent = "";

  items.forEach((item) => {
    const row = document.createElement("li");
    row.className = item.state || "pending";

    const badge = document.createElement("span");
    badge.className = "source-badge";
    badge.textContent = readingListSourceBadge(item.state);

    const body = document.createElement("div");

    const title = document.createElement("span");
    title.className = "source-title";
    title.textContent = item.title || `论文 ${Number(item.index || 0) + 1}`;

    const detail = document.createElement("span");
    detail.className = "source-detail";
    const sourceText = item.source ? `${item.source}${item.cached ? " · 缓存" : ""}` : "";
    const charText = item.chars ? `约 ${item.chars} 字符` : "";
    detail.textContent = [item.message, sourceText, charText].filter(Boolean).join(" · ") || "等待服务端更新";

    body.append(title, detail);
    row.append(badge, body);
    elements.readingListSourceList.append(row);
  });
}

function renderReadingListLiveStatus(data, { paperCount, provider } = {}) {
  if (!data || data.source !== "reading-list" || data.state === "idle") {
    return false;
  }

  renderReadingListSourceStatus(data);

  const elapsed = secondsSince(state.readingListStartedAt);
  const meta = `已等待 ${elapsed} 秒 · ${paperCount || data.originalTextSummary?.total || 0} 篇 · ${provider || providerLabel()}`;
  const stage = data.stage || "";

  if (stage === "original-text") {
    setReadingListProgress("loading", "抓取论文原文", data.message || "正在抓取论文原文。", {
      step: "source",
      meta
    });
    elements.readingListStatus.textContent = data.currentTitle
      ? `正在抓取：${data.currentTitle}`
      : `${data.message || "正在抓取论文原文。"} 已等待 ${elapsed} 秒。`;
    return true;
  }

  if (stage === "generate") {
    setReadingListProgress("loading", "模型生成中", data.message || "原文上下文已准备，正在等待模型生成周报。", {
      step: "generate",
      meta
    });
    elements.readingListStatus.textContent = `${data.message || "模型生成中。"} 已等待 ${elapsed} 秒。`;
    return true;
  }

  if (stage === "review") {
    setReadingListProgress("loading", "周报复评中", data.message || "正在基于原文重新给出周报四维分数。", {
      step: "review",
      meta
    });
    elements.readingListStatus.textContent = `${data.message || "周报复评中。"} 已等待 ${elapsed} 秒。`;
    return true;
  }

  if (data.state === "error") {
    setReadingListProgress("failed", "生成失败", data.message || "周报生成失败。", {
      meta
    });
    elements.readingListStatus.textContent = data.message || "周报生成失败。";
    return true;
  }

  return false;
}

function setReadingListSourceStepLabel(useOriginalText = true) {
  const sourceLabel = elements.readingListSteps?.querySelector('[data-reading-step="source"] em');

  if (sourceLabel) {
    sourceLabel.textContent = useOriginalText ? "抓取原文" : "整理摘要";
  }
}

function waitForReadingListStep(ms = 240) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function readingListGenerationFocus(elapsed, paperCount, provider, useOriginalText = true) {
  if (!useOriginalText) {
    const summaryFocusItems = [
      {
        after: 0,
        step: "review",
        status: "服务端正在做周报复评...",
        detail: `请求已提交给 ${provider}。本次未启用原文抓取，将基于摘要和已有分析重新给四维分数。`
      },
      {
        after: 10,
        step: "review",
        status: "等待模型完成候选评分...",
        detail: "模型需要先给候选论文重新评分和排序，达到周报入选线后才会进入正文生成。"
      },
      {
        after: 24,
        step: "generate",
        status: "等待模型生成周报正文...",
        detail: "复评完成后，模型会围绕入选论文生成趋势判断、逐篇洞察和 ADN 启发。"
      },
      {
        after: 45,
        step: "generate",
        status: "等待模型整理发布格式...",
        detail: "模型可能正在整理报告导读、标题层级和可复制到洞察网站的 Markdown；返回前不会标记完成。"
      },
      {
        after: 70,
        step: "generate",
        status: "模型仍在生成长文...",
        detail: "长报告会受论文数量、趋势判断和逐篇 ADN 启发影响。页面没有卡死，正在等待服务端返回结果。"
      }
    ];

    return summaryFocusItems.reduce((current, item) => elapsed >= item.after ? item : current, summaryFocusItems[0]);
  }

  const focusItems = [
    {
      after: 0,
      step: "source",
      status: "服务端正在抓取论文原文...",
      detail: `请求已提交给 ${provider}。服务端会先尝试抓取 ${paperCount} 篇论文的 arXiv HTML 原文，再做周报复评。`
    },
    {
      after: 10,
      step: "source",
      status: "仍在整理原文上下文...",
      detail: "部分论文可能没有 arXiv HTML 版本，服务端会自动降级为摘要和已有分析，然后继续做周报复评。"
    },
    {
      after: 18,
      step: "review",
      status: "等待模型完成全文复评...",
      detail: "原文上下文准备后，模型会先重新给候选论文打四维分数，再按周报阈值筛选入选论文。"
    },
    {
      after: 30,
      step: "generate",
      status: "等待模型生成逐篇洞察...",
      detail: "复评完成后，模型正在处理入选论文的内容、方法、结果和 ADN 启发；真实进度仍以接口返回为准。"
    },
    {
      after: 48,
      step: "generate",
      status: "等待模型整理发布格式...",
      detail: "模型可能正在整理报告导读、标题层级和可复制到洞察网站的 Markdown；返回前不会标记完成。"
    },
    {
      after: 75,
      step: "generate",
      status: "模型仍在生成长文...",
      detail: "长报告会受论文数量、趋势判断和逐篇 ADN 启发影响。页面没有卡死，正在等待服务端返回结果。"
    }
  ];

  return focusItems.reduce((current, item) => elapsed >= item.after ? item : current, focusItems[0]);
}

function refreshReadingListGenerationProgress(paperCount, provider, useOriginalText = true) {
  if (renderReadingListLiveStatus(state.readingListLiveStatus, { paperCount, provider })) {
    return;
  }

  const elapsed = secondsSince(state.readingListStartedAt);
  const focus = readingListGenerationFocus(elapsed, paperCount, provider, useOriginalText);
  setReadingListProgress("loading", focus.step === "review" ? "周报复评中" : "模型生成中", focus.detail, {
    step: focus.step || "generate",
    meta: `已等待 ${elapsed} 秒 · ${paperCount} 篇 · ${provider}`
  });
  elements.readingListStatus.textContent = `${focus.status} 已等待 ${elapsed} 秒。`;
}

function resetTaskModal() {
  resetProgressTimer();
  resetSourceStatusTimer();
  resetSyncStatusTimer();
  setTaskLocked(false);
  setTaskStep("fetch");
  showTaskPanel("");
  elements.taskRefreshCandidates.hidden = true;
  elements.taskForceArxiv.hidden = true;
  elements.taskRetry.hidden = true;
  elements.candidateForceArxiv.hidden = true;
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
    "arxiv-rss": "arXiv RSS",
    "arxiv-library": "本地 arXiv 库",
    cache: "本地缓存",
    none: "无可用数据源"
  };

  return labels[source] || source || "候选数据源";
}

function candidateSourceInfo({ source = "", method = "", cacheStatus = "", forceArxiv = false } = {}) {
  if (forceArxiv || method === "api" || source === "arxiv") {
    const cached = cacheStatus === "hit" || cacheStatus === "stale";
    return {
      code: cached ? "arxiv-api-cache" : "arxiv-api",
      label: cached ? "arXiv API 缓存" : "arXiv API",
      detail: "通过 export.arxiv.org/api/query 直接查询"
    };
  }

  if (source === "arxiv-library" || method === "library") {
    return {
      code: "arxiv-library",
      label: "本地 arXiv 库",
      detail: "来自后端 RSS 同步后的本地论文库"
    };
  }

  if (source === "arxiv-rss") {
    return {
      code: "arxiv-rss",
      label: "arXiv RSS",
      detail: "来自 arXiv RSS 同步"
    };
  }

  return {
    code: "unknown",
    label: sourceLabel(source),
    detail: "来源未明确标记"
  };
}

function annotateCandidateSource(papers, info) {
  const fetchedAt = new Date().toISOString();
  return papers.map((paper) => ({
    ...paper,
    candidateSource: info.code,
    candidateSourceLabel: info.label,
    candidateSourceDetail: info.detail,
    candidateFetchedAt: fetchedAt
  }));
}

function selectedDateWindowLabel() {
  return elements.dateWindow.selectedOptions?.[0]?.textContent?.trim() || "当前时间范围";
}

function renderArxivSyncStatus(data = {}) {
  const count = Number(data.count || 0);
  const lastSync = data.lastSyncedAt ? formatDateTime(data.lastSyncedAt) : "尚未同步";
  elements.syncStatus.textContent = count
    ? `${count} 篇论文，最近同步 ${lastSync}`
    : "本地库暂无论文";
  elements.syncDetails.textContent = Array.isArray(data.categories) && data.categories.length
    ? `分类：${data.categories.join(", ")}`
    : "";
}

function syncHistoryStatusLabel(status) {
  const labels = {
    success: "成功",
    skipped: "跳过",
    failed: "失败"
  };

  return labels[status] || "未知";
}

function syncHistoryTriggerLabel(trigger) {
  const labels = {
    manual: "手动同步",
    auto: "自动同步",
    "auto-startup": "启动检查",
    "auto-next-due": "定时同步",
    "auto-retry": "失败重试",
    "candidate-fetch": "获取候选",
    "candidate-refresh": "刷新候选"
  };

  return labels[trigger] || trigger || "未知来源";
}

function formatDurationMs(value) {
  const ms = Math.max(0, Number(value) || 0);

  if (ms < 1000) {
    return `${ms} ms`;
  }

  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;
}

function renderSyncHistory(records = []) {
  elements.syncHistoryList.textContent = "";
  elements.syncHistoryStatus.textContent = records.length
    ? `最近 ${records.length} 次同步记录`
    : "暂无同步历史；下一次同步后会自动记录。";

  if (!records.length) {
    const empty = document.createElement("p");
    empty.className = "sync-history-empty";
    empty.textContent = "还没有可展示的同步记录。";
    elements.syncHistoryList.append(empty);
    return;
  }

  records.forEach((record) => {
    const item = document.createElement("article");
    item.className = `sync-history-item sync-history-${record.status || "unknown"}`;

    const heading = document.createElement("div");
    heading.className = "sync-history-item-heading";

    const badge = document.createElement("span");
    badge.className = "sync-history-badge";
    badge.textContent = syncHistoryStatusLabel(record.status);

    const title = document.createElement("strong");
    title.textContent = record.finishedAt ? formatDateTime(record.finishedAt) : "时间未知";

    const trigger = document.createElement("span");
    trigger.textContent = `${syncHistoryTriggerLabel(record.trigger)}${record.force ? " · 强制" : ""}`;

    heading.append(badge, title, trigger);

    const stats = document.createElement("div");
    stats.className = "sync-history-stats";
    [
      ["获取", record.fetched],
      ["新增", record.added],
      ["更新", record.updated],
      ["总量", record.total],
      ["耗时", formatDurationMs(record.durationMs)]
    ].forEach(([label, value]) => {
      const stat = document.createElement("span");
      stat.textContent = `${label} ${value}`;
      stats.append(stat);
    });

    const detail = document.createElement("p");
    detail.textContent = record.error?.detail || record.error?.message || record.message || "同步完成。";

    item.append(heading, stats, detail);
    elements.syncHistoryList.append(item);
  });
}

async function loadSyncHistory() {
  elements.syncHistoryStatus.textContent = "正在读取同步历史...";
  elements.syncHistoryList.textContent = "";

  try {
    const response = await fetch("/api/arxiv-sync/history?limit=50");
    const text = await response.text();
    let data = {};

    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        const preview = text.replace(/\s+/g, " ").trim().slice(0, 120);
        const message = response.status === 404
          ? "当前服务还没有同步历史接口，请部署最新代码后再试。"
          : `同步历史返回格式异常：${preview || "空响应"}`;
        throw new Error(message);
      }
    }

    if (!response.ok) {
      const message = response.status === 404
        ? "当前服务还没有同步历史接口，请部署最新代码后再试。"
        : data.message || data.detail || `读取同步历史失败（HTTP ${response.status}）。`;
      throw new Error(message);
    }

    renderSyncHistory(Array.isArray(data.records) ? data.records : []);
  } catch (error) {
    elements.syncHistoryStatus.textContent = `读取失败：${error.message}`;
    elements.syncHistoryList.textContent = "";
    const empty = document.createElement("p");
    empty.className = "sync-history-empty";
    empty.textContent = "暂时无法读取同步历史。";
    elements.syncHistoryList.append(empty);
  }
}

async function refreshArxivSyncStatus({ autoSync = false } = {}) {
  try {
    const response = await fetch("/api/arxiv-sync");
    const data = await response.json();
    renderArxivSyncStatus(data);

    if (autoSync && data.stale) {
      await syncArxivLibrary({ force: false, silent: true });
    }
  } catch {
    elements.syncStatus.textContent = "同步状态暂时不可用";
    elements.syncDetails.textContent = "";
  }
}

function showSyncProgressDialog(message = "正在同步...", categories = []) {
  elements.syncProgressMessage.textContent = message;
  elements.syncProgressCategories.textContent = categories.length ? `分类：${categories.join(", ")}` : "";
  elements.syncProgressClose.disabled = true;

  if (typeof elements.syncProgressDialog.showModal === "function") {
    elements.syncProgressDialog.showModal();
  }
}

function hideSyncProgressDialog() {
  elements.syncProgressClose.disabled = false;

  if (elements.syncProgressDialog.open) {
    elements.syncProgressDialog.close();
  }
}

async function syncArxivLibrary({ force = true, silent = false, trigger = "" } = {}) {
  elements.syncArxiv.disabled = true;

  if (!silent) {
    showSyncProgressDialog("正在连接 arXiv RSS...", ["cs.NI", "cs.AI", "cs.LG", "cs.MA", "cs.DC", "cs.IT", "eess.SP", "eess.SY"]);
    elements.syncStatus.textContent = "正在同步 arXiv RSS";
    elements.syncDetails.textContent = "";
  }

  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (!silent) {
    startSyncStatusPolling(requestId);
  }

  try {
    const params = new URLSearchParams();

    if (force) {
      params.set("force", "1");
    }

    params.set("trigger", trigger || (silent ? "auto" : "manual"));

    elements.syncProgressMessage.textContent = "正在获取论文列表...";
    const response = await fetch(`/api/arxiv-sync?${params.toString()}`, { method: "POST" });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || data.message || "同步失败。");
    }

    elements.syncProgressMessage.textContent = "正在处理数据...";
    await new Promise((resolve) => setTimeout(resolve, 300));
    renderArxivSyncStatus(data);

    if (!silent) {
      showStatus(`arXiv 同步完成：获取 ${data.fetched || 0} 篇，新增 ${data.added || 0} 篇。`, "warning");
    }

    if (elements.syncHistoryDialog.open) {
      await loadSyncHistory();
    }

    return data;
  } catch (error) {
    elements.syncStatus.textContent = "同步失败";
    elements.syncDetails.textContent = error.message;
    if (!silent) {
      showStatus(`arXiv 同步失败：${error.message}`, "error");
    }
    if (elements.syncHistoryDialog.open) {
      await loadSyncHistory();
    }
    return null;
  } finally {
    resetSyncStatusTimer();
    if (!silent) {
      hideSyncProgressDialog();
    }
    elements.syncArxiv.disabled = state.taskLocked;
  }
}

function paperCategoryLabel(paper) {
  const sourceNames = new Set(["arXiv RSS", "arXiv Library"]);
  const categories = Array.isArray(paper?.categories) ? paper.categories : [];
  const candidate = [paper?.primaryCategory, ...categories]
    .find((value) => value && !sourceNames.has(value));

  return candidate || "Paper";
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
      const type = data.state === "error"
        ? "error"
        : data.state === "done"
          ? "warning"
          : "loading";
      setTaskStatus(`${sourceLabel(data.source)}：${data.message}${detail}`, type);

      if (data.state === "done" || data.state === "error") {
        resetSourceStatusTimer();
      }
    } catch {
      // Status polling is only for display; the main request still owns errors.
    }
  }, 700);
}

function startSyncStatusPolling(requestId) {
  resetSyncStatusTimer();
  state.syncStatusTimer = window.setInterval(async () => {
    try {
      const response = await fetch(`/api/papers/status?requestId=${encodeURIComponent(requestId)}`);

      if (!response.ok) {
        return;
      }

      const data = await response.json();

      if (!data.message || data.state === "idle") {
        return;
      }

      if (data.source === "arxiv-rss") {
        elements.syncProgressMessage.textContent = data.message;
      }

      if (data.state === "done" || data.state === "error") {
        resetSyncStatusTimer();
      }
    } catch {
      // Sync status polling is only for display; the main request still owns errors.
    }
  }, 500);
}

function startReadingListStatusPolling(requestId, { paperCount, provider } = {}) {
  resetReadingListStatusTimer();
  state.readingListLiveStatus = null;
  state.readingListStatusTimer = window.setInterval(async () => {
    try {
      const response = await fetch(`/api/papers/status?requestId=${encodeURIComponent(requestId)}`);

      if (!response.ok) {
        return;
      }

      const data = await response.json();

      if (!data.message || data.state === "idle" || data.source !== "reading-list") {
        return;
      }

      state.readingListLiveStatus = data;
      renderReadingListLiveStatus(data, { paperCount, provider });

      if (data.state === "done" || data.state === "error") {
        resetReadingListStatusTimer();
      }
    } catch {
      // Reading list status polling is only for display; the main request still owns errors.
    }
  }, 850);
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
  state.paperReturnView = "report";
  state.paperReturnReport = null;
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
    showStatus(`请输入 ${providerLabel()} API Key，然后点击左侧“生成推荐列表”。`, "warning");
  } else {
    hideStatus();
  }
}

function showExplore() {
  resetProgressTimer();
  state.currentReport = null;
  state.currentPaper = null;
  setActiveView("explore");
  elements.exploreSearch.value = state.exploreSearch;
  renderBreadcrumb([]);
  renderExplorePapers();
}

function clearWorkingState() {
  resetProgressTimer();
  state.currentReport = null;
  state.currentPaper = null;
  state.currentReadingListReport = null;
  state.candidatePapers = [];
  state.selectedCandidateIds = new Set();
  state.candidateSearch = null;
  state.lastAnalyzePapers = [];
  state.analysisSession = null;
  state.currentPaperView = "recommended";
  state.currentSort = "score";
  elements.candidateList.textContent = "";
  elements.paperList.textContent = "";
  elements.explorePaperList.textContent = "";
  elements.analysisDetail.textContent = "";
  setMetrics();
  updatePaperViewTabs(null);
}

function renderExplorePapers() {
  const all = explorePapers();
  const papers = filteredExplorePapers();
  const reportCount = state.reports.length;

  setHeader({
    eyebrow: "",
    title: "",
    description: reportCount
      ? `汇总 ${reportCount} 个推荐列表，${all.length} 篇去重论文${state.exploreSearch ? `，当前筛选 ${papers.length} 篇` : ""}。`
      : "所有生成过的论文会集中显示在这里。",
    showBack: false,
    compact: true
  });

  exploreSortButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.exploreSort === state.exploreSort);
  });

  elements.explorePaperList.textContent = "";

  if (!state.reports.length) {
    showStatus("还没有推荐列表。先生成一次推荐列表后，这里会汇总展示所有论文。", "warning");
    return;
  }

  if (!papers.length) {
    showStatus("没有匹配的论文。可以换个关键词，或清空搜索框。", "warning");
    return;
  }

  hideStatus();
  papers.forEach((paper) => {
    appendExplorePaperRow(paper, elements.explorePaperList);
  });
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
    title.textContent = reportDisplayTitle(report);

    const meta = document.createElement("span");
    const created = report.createdAt ? `${formatDateTime(report.createdAt)} 生成 · ` : "";
    const target = recommendationTargetFor(report);
    const targetText = target ? ` · 最低达标 ${target}` : "";
    meta.textContent = `${created}${counts.recommended.length} 篇推荐 · ${counts.hidden.length} 篇隐藏 · 阈值 ${thresholdFor(report)}${targetText} · ${modeLabel(report.mode)}`;

    item.append(title, meta);
    item.addEventListener("click", () => openReport(report));
    elements.reportHomeList.append(item);
  });
}

function readingListMetadata(report = state.currentReport) {
  const date = new Date(report?.createdAt || new Date());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = safeDate.getFullYear();
  const month = safeDate.getMonth() + 1;

  return {
    title: readingListTitle(report),
    date: isoDate(safeDate),
    month: `${year}-${String(month).padStart(2, "0")}`,
    weekOfMonth: weekOfMonth(safeDate)
  };
}

function roundedScoreStep(value, fallback = 70) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : fallback;
  return Math.max(0, Math.min(95, Math.round(numeric / 5) * 5));
}

function defaultReadingListCandidateFloor(report = state.currentReport) {
  const saved = report?.readingList?.candidateFloor;

  if (Number.isFinite(Number(saved))) {
    return roundedScoreStep(saved, 60);
  }

  return roundedScoreStep(Math.max(0, thresholdFor(report) - 10), 60);
}

function defaultReadingListReviewThreshold(report = state.currentReport) {
  const saved = report?.readingList?.reviewScoreThreshold;

  if (Number.isFinite(Number(saved))) {
    return roundedScoreStep(saved, thresholdFor(report));
  }

  return roundedScoreStep(thresholdFor(report), 70);
}

function defaultReadingListMinSelected(report = state.currentReport) {
  const saved = report?.readingList?.minSelectedCount;

  if (Number.isFinite(Number(saved))) {
    return Math.max(1, Math.min(20, Math.round(Number(saved))));
  }

  return 3;
}

function readingListCandidateFloor() {
  return roundedScoreStep(elements.readingListCandidateFloor?.value, 60);
}

function readingListReviewThreshold() {
  return Math.max(40, roundedScoreStep(elements.readingListReviewThreshold?.value, 70));
}

function readingListMinSelectedCount() {
  return Math.max(1, Math.min(20, Math.round(Number(elements.readingListMinSelected?.value) || 3)));
}

function readingListCandidatePapers(report = state.currentReport) {
  const floor = readingListCandidateFloor();

  return reportPapers(report)
    .filter((paper) => paperScore(paper) >= floor)
    .sort((a, b) => (
      paperScore(b) - paperScore(a)
      || new Date(b.published || b.updated) - new Date(a.published || a.updated)
    ));
}

function setReadingListReviewControls(report = state.currentReport) {
  const floor = defaultReadingListCandidateFloor(report);
  const threshold = defaultReadingListReviewThreshold(report);
  const minSelected = defaultReadingListMinSelected(report);

  if (elements.readingListCandidateFloor) {
    elements.readingListCandidateFloor.value = String(floor);
  }

  if (elements.readingListReviewThreshold) {
    elements.readingListReviewThreshold.value = String(threshold);
  }

  if (elements.readingListMinSelected) {
    elements.readingListMinSelected.value = String(minSelected);
  }

  updateReadingListReviewPreview(report);
}

function updateReadingListReviewPreview(report = state.currentReadingListReport || state.currentReport) {
  const floor = readingListCandidateFloor();
  const threshold = readingListReviewThreshold();
  const minSelected = readingListMinSelectedCount();
  const total = reportPapers(report).length;
  const candidateCount = readingListCandidatePapers(report).length;

  if (elements.readingListCandidateFloorValue) {
    elements.readingListCandidateFloorValue.textContent = String(floor);
  }

  if (elements.readingListReviewThresholdValue) {
    elements.readingListReviewThresholdValue.textContent = String(threshold);
  }

  if (elements.readingListMinSelected) {
    elements.readingListMinSelected.value = String(Math.min(minSelected, 20));
  }

  if (elements.readingListReviewPreview) {
    const effectiveMin = candidateCount ? Math.min(minSelected, candidateCount) : 0;
    elements.readingListReviewPreview.textContent = `将从原列表 ${total} 篇中取 ${candidateCount} 篇进入周报复评；优先收录复评分达到 ${threshold} 分的论文，若不足 ${minSelected} 篇，则按复评分补足到 ${effectiveMin} 篇。`;
  }
}

function readingListUseOriginalText() {
  if (elements.readingListDialog?.open && elements.readingListUseOriginalText) {
    return elements.readingListUseOriginalText.checked;
  }

  if (elements.readingListInlineUseOriginalText) {
    return elements.readingListInlineUseOriginalText.checked;
  }

  return elements.readingListUseOriginalText ? elements.readingListUseOriginalText.checked : true;
}

function setReadingListUseOriginalText(useOriginalText = true) {
  if (elements.readingListUseOriginalText) {
    elements.readingListUseOriginalText.checked = useOriginalText !== false;
  }

  if (elements.readingListInlineUseOriginalText) {
    elements.readingListInlineUseOriginalText.checked = useOriginalText !== false;
  }

  setReadingListSourceStepLabel(useOriginalText !== false);
}

function readingListGeneratedStatus(readingList, paperCount) {
  const count = readingList?.paperCount || paperCount;

  if (!readingList) {
    return `准备从当前列表选择论文子集，全文复评后生成 Markdown。`;
  }

  const reviewedText = readingList.reviewedPaperCount
    ? `，复评 ${readingList.reviewedPaperCount} 篇、入选 ${count} 篇${readingList.fallbackSelectedCount ? `，其中 ${readingList.fallbackSelectedCount} 篇保底补入` : ""}`
    : `，入选 ${count} 篇`;

  if (!readingList?.useOriginalText) {
    return `已生成发布版 Markdown${reviewedText}，未启用论文原文抓取。`;
  }

  const originalTextCount = readingList?.originalTextCount || 0;
  if (originalTextCount) {
    return `已生成发布版 Markdown${reviewedText}，其中 ${originalTextCount} 篇使用了 arXiv HTML 原文。`;
  }

  return `已生成发布版 Markdown${reviewedText}，本次未获取到可用 arXiv HTML 原文。`;
}

function setReadingListBusy(busy) {
  const hasMarkdown = Boolean(elements.readingListOutput.value.trim());
  elements.generateReadingList.disabled = busy;
  elements.readingListRegenerate.disabled = busy;
  elements.readingListDownload.disabled = busy || !hasMarkdown;
  elements.readingListCopy.disabled = busy || !hasMarkdown;
  if (elements.readingListUseOriginalText) {
    elements.readingListUseOriginalText.disabled = busy;
  }
  if (elements.readingListInlineUseOriginalText) {
    elements.readingListInlineUseOriginalText.disabled = busy;
  }
  if (elements.readingListCandidateFloor) {
    elements.readingListCandidateFloor.disabled = busy;
  }
  if (elements.readingListReviewThreshold) {
    elements.readingListReviewThreshold.disabled = busy;
  }
  if (elements.readingListMinSelected) {
    elements.readingListMinSelected.disabled = busy;
  }
  elements.readingListClose.disabled = false;
}

function adjustReadingListOutputHeight() {
  if (!elements.readingListOutput) {
    return;
  }

  elements.readingListOutput.style.height = "";

  if (!elements.readingListDialog.classList.contains("ready") || !elements.readingListOutput.value.trim()) {
    return;
  }

  const viewportLimit = Math.max(220, Math.min(500, window.innerHeight - 330));
  const contentHeight = elements.readingListOutput.scrollHeight + 4;
  const nextHeight = Math.max(160, Math.min(contentHeight, viewportLimit));
  elements.readingListOutput.style.height = `${Math.round(nextHeight)}px`;
}

function openReadingListDialog(report = state.currentReport) {
  if (!report) {
    return;
  }

  const meta = readingListMetadata(report);
  const useOriginalText = report.readingList?.useOriginalText ?? true;
  state.currentReadingListReport = report;
  clearReadingListSourceStatus();
  setReadingListUseOriginalText(useOriginalText);
  setReadingListReviewControls(report);
  elements.readingListTitle.textContent = report.readingList?.title || meta.title;
  elements.readingListOutput.value = report.readingList?.markdown || "";
  const candidateCount = readingListCandidatePapers(report).length;
  const paperCount = report.readingList?.paperCount || candidateCount;
  const generatedStatus = readingListGeneratedStatus(report.readingList, paperCount);
  elements.readingListStatus.textContent = report.readingList?.generatedAt
    ? generatedStatus
    : "先确认周报候选范围和入选阈值，再开始全文复评与生成。";
  elements.readingListRegenerate.textContent = report.readingList?.markdown ? "重新生成" : "开始生成周报";
  setReadingListProgress(
    report.readingList?.markdown ? "ready" : "idle",
    report.readingList?.markdown ? "已生成" : "等待生成",
    report.readingList?.markdown ? "可以复制 Markdown，或点击“重新生成”刷新内容。" : "确认候选和阈值后，点击“开始生成周报”。",
    {
      step: report.readingList?.markdown ? "save" : "",
      meta: report.readingList?.markdown
        ? `${report.readingList.paperCount || paperCount} 篇 · 已保存`
        : "未开始"
    }
  );
  setReadingListBusy(false);

  if (typeof elements.readingListDialog.showModal === "function" && !elements.readingListDialog.open) {
    elements.readingListDialog.showModal();
  }

  window.requestAnimationFrame(adjustReadingListOutputHeight);
}

async function generateReadingListForReport(report = state.currentReport, { force = false } = {}) {
  if (!report) {
    return;
  }

  if (!ensureApiKey(`请先输入 ${providerLabel()} API Key，然后再生成发布版阅读清单。`)) {
    return;
  }

  const papers = readingListCandidatePapers(report);

  if (!papers.length) {
    showStatus("当前周报候选范围内没有论文，请调低复评候选下限后再生成。", "warning");
    return;
  }

  if (report.readingList?.markdown && !force) {
    openReadingListDialog(report);
    return;
  }

  const meta = readingListMetadata(report);
  const provider = providerLabel();
  const useOriginalText = readingListUseOriginalText();
  const candidateFloor = readingListCandidateFloor();
  const reviewScoreThreshold = readingListReviewThreshold();
  const minSelectedCount = readingListMinSelectedCount();
  const requestId = `reading-list-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const contextModeText = useOriginalText
    ? "准备抓取 arXiv HTML 原文，并重新给出周报四维分数。"
    : "将基于摘要和已有分析重新给出周报四维分数。";
  setReadingListSourceStepLabel(useOriginalText);
  openReadingListDialog(report);
  setReadingListUseOriginalText(useOriginalText);
  if (elements.readingListCandidateFloor) {
    elements.readingListCandidateFloor.value = String(candidateFloor);
  }
  if (elements.readingListReviewThreshold) {
    elements.readingListReviewThreshold.value = String(reviewScoreThreshold);
  }
  if (elements.readingListMinSelected) {
    elements.readingListMinSelected.value = String(minSelectedCount);
  }
  updateReadingListReviewPreview(report);
  clearReadingListSourceStatus();
  elements.readingListTitle.textContent = meta.title;
  elements.readingListOutput.value = "";
  elements.readingListOutput.style.height = "";
  elements.readingListStatus.textContent = `准备复评 ${papers.length} 篇候选论文，周报入选线 ${reviewScoreThreshold} 分，保底 ${minSelectedCount} 篇。`;
  setReadingListProgress("loading", "整理周报候选", `已从原列表按候选下限 ${candidateFloor} 分取出 ${papers.length} 篇论文，若达标不足 ${minSelectedCount} 篇会按复评分补足。${contextModeText}`, {
    step: "collect",
    meta: `0 秒 · ${papers.length} 篇 · ${provider}`
  });
  setReadingListBusy(true);
  state.readingListStartedAt = performance.now();
  resetReadingListTimer();
  state.readingListTimer = window.setInterval(() => {
    refreshReadingListGenerationProgress(papers.length, provider, useOriginalText);
  }, 1000);
  startReadingListStatusPolling(requestId, { paperCount: papers.length, provider });

  try {
    const submitDetail = useOriginalText
      ? `正在提交 ${papers.length} 篇周报候选；服务端会先抓取 arXiv HTML 原文，再做周报复评和发布版生成。`
      : `正在提交 ${papers.length} 篇周报候选；本次跳过原文抓取，直接做摘要复评和发布版生成。`;
    setReadingListProgress("loading", "发送生成请求", submitDetail, {
      step: "submit",
      meta: `0 秒 · ${papers.length} 篇 · ${provider}`
    });
    const responsePromise = fetch("/api/reading-list", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        requestId,
        ...meta,
        sourceReport: reportDisplayTitle(report),
        useOriginalText,
        reviewBeforeGenerate: true,
        reviewScoreThreshold,
        minSelectedCount,
        papers: papers.map(readingListPaperPayload),
        ...llmPayload()
      })
    });
    await waitForReadingListStep(260);
    refreshReadingListGenerationProgress(papers.length, provider, useOriginalText);
    const response = await responsePromise;
    resetReadingListTimer();
    setReadingListProgress("loading", "接收模型结果", "模型已经返回响应，正在解析生成的 Markdown 内容。", {
      step: "receive",
      meta: `${secondsSince(state.readingListStartedAt)} 秒 · ${papers.length} 篇 · ${provider}`
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || data.message || "阅读清单生成失败。");
    }

    setReadingListProgress("loading", "保存生成结果", "正在保存到当前推荐列表，并准备 Markdown 预览。", {
      step: "save",
      meta: `${secondsSince(state.readingListStartedAt)} 秒 · ${data.paperCount || papers.length} 篇 · 保存中`
    });
    await waitForReadingListStep(180);

    const updatedReport = replaceStoredReport({
      ...report,
      readingList: {
        title: data.title || meta.title,
        markdown: data.markdown || "",
        generatedAt: new Date().toISOString(),
        mode: modeLabel(data.mode),
        paperCount: data.paperCount || papers.length,
        candidateFloor,
        candidateCount: data.candidateCount || papers.length,
        reviewedPaperCount: data.reviewedPaperCount || papers.length,
        reviewScoreThreshold: data.reviewScoreThreshold ?? reviewScoreThreshold,
        minSelectedCount: data.minSelectedCount ?? minSelectedCount,
        thresholdSelectedCount: data.thresholdSelectedCount ?? data.paperCount ?? papers.length,
        fallbackSelectedCount: data.fallbackSelectedCount || 0,
        reviewBeforeGenerate: data.reviewBeforeGenerate ?? true,
        useOriginalText: data.useOriginalText ?? useOriginalText,
        originalTextCount: data.originalTextCount || 0,
        originalTextUnavailableCount: data.originalTextUnavailableCount || 0
      }
    });

    elements.readingListTitle.textContent = updatedReport.readingList.title;
    elements.readingListOutput.value = updatedReport.readingList.markdown;
    const charCount = updatedReport.readingList.markdown.length;
    const originalTextCount = updatedReport.readingList.originalTextCount || 0;
    const fallbackText = updatedReport.readingList.fallbackSelectedCount
      ? `，其中 ${updatedReport.readingList.fallbackSelectedCount} 篇为保底补入`
      : "";
    const reviewMeta = `，全文/摘要复评 ${updatedReport.readingList.reviewedPaperCount || papers.length} 篇、入选 ${updatedReport.readingList.paperCount} 篇${fallbackText}`;
    const originalTextMeta = !updatedReport.readingList.useOriginalText
      ? "，未启用论文原文抓取"
      : originalTextCount
      ? `，其中 ${originalTextCount} 篇使用了 arXiv HTML 原文`
      : "，本次未获取到可用 arXiv HTML 原文";
    elements.readingListStatus.textContent = `已生成 ${updatedReport.readingList.paperCount} 篇论文的发布版 Markdown${reviewMeta}${originalTextMeta}，约 ${charCount} 字符。`;
    setReadingListProgress("ready", "生成完成", `已保存到当前列表的周报结果${reviewMeta}${originalTextMeta}。可以复制 Markdown 到洞察网站，或点击“重新生成”。`, {
      step: "save",
      meta: `${secondsSince(state.readingListStartedAt)} 秒 · ${updatedReport.readingList.paperCount} 篇 · 完成`
    });
    adjustReadingListOutputHeight();
    elements.generateReadingList.textContent = "查看发布版周报";
    showStatus("发布版阅读清单已生成，可以复制到洞察网站。", "warning");
  } catch (error) {
    elements.readingListStatus.textContent = `生成失败：${error.message}`;
    setReadingListProgress("failed", "生成失败", error.message, {
      meta: `${secondsSince(state.readingListStartedAt)} 秒 · ${papers.length} 篇 · 失败`
    });
    showStatus(`阅读清单生成失败：${error.message}`, "error");
  } finally {
    resetReadingListTimer();
    resetReadingListStatusTimer();
    setReadingListBusy(false);
  }
}

async function copyReadingListMarkdown() {
  const markdown = elements.readingListOutput.value.trim();

  if (!markdown) {
    elements.readingListStatus.textContent = "还没有可复制的 Markdown。";
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(markdown);
    } else {
      elements.readingListOutput.focus();
      elements.readingListOutput.select();
      document.execCommand("copy");
    }

    elements.readingListStatus.textContent = "Markdown 已复制。";
  } catch (error) {
    elements.readingListOutput.focus();
    elements.readingListOutput.select();
    elements.readingListStatus.textContent = "复制失败，请手动全选复制。";
  }
}

function markdownDownloadName() {
  const title = (elements.readingListTitle.textContent || `${readingListTitlePrefix}精选论文阅读清单`)
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .trim();
  return `${title || "weekly-reading-list"}.md`;
}

function downloadReadingListMarkdown() {
  const markdown = elements.readingListOutput.value.trim();

  if (!markdown) {
    elements.readingListStatus.textContent = "还没有可下载的 Markdown。";
    return;
  }

  const blob = new Blob([`${markdown}\n`], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = markdownDownloadName();
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  elements.readingListStatus.textContent = `Markdown 已下载：${link.download}`;
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
  const annotatedPapers = papers.map(annotateHistoricalAnalysis);
  const reusedCount = annotatedPapers.filter((paper) => paper.reusedAnalysis).length;
  state.candidatePapers = annotatedPapers;
  state.selectedCandidateIds = new Set(annotatedPapers.map((paper) => paper.id));
  state.currentReport = null;
  state.currentPaper = null;
  state.currentThreshold = Number(elements.thresholdInput.value || 70);
  elements.candidateList.textContent = "";
  setTaskLocked(false);
  setTaskStep("confirm");
  showTaskPanel("candidate");
  elements.candidateForceArxiv.hidden = false;
  const target = minRecommendedValue();
  const targetText = target ? `；最低达标 ${target} 篇推荐论文` : "";
  setTaskStatus(`已获取 ${annotatedPapers.length} 篇候选论文${targetText}${reusedCount ? `，其中 ${reusedCount} 篇已有历史分析` : ""}。请确认要进入列表的论文。`, "warning", "force-arxiv");

  annotatedPapers.forEach((paper, index) => {
    const label = document.createElement("label");
    label.className = "candidate-item";

    if (paper.reusedAnalysis) {
      label.classList.add("candidate-reused");
    }

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
    const sourceBadge = document.createElement("span");
    sourceBadge.className = `candidate-source-badge source-${paper.candidateSource || "unknown"}`;
    sourceBadge.title = paper.candidateSourceDetail || "";
    sourceBadge.textContent = paper.candidateSourceLabel || "来源未知";

    const metaText = `${formatDate(paper.published)} · ${paperCategoryLabel(paper)} · ${paper.authors.slice(0, 4).join(", ") || "Unknown authors"} · `;
    const reused = paper.reusedAnalysis
      ? ` · 已有分析：${paper.reusedAnalysis.reportTitle}${paper.reusedAnalysis.createdAt ? `（${formatDateTime(paper.reusedAnalysis.createdAt)}）` : ""}`
      : "";
    meta.append(document.createTextNode(metaText), sourceBadge, document.createTextNode(reused));

    const summary = document.createElement("div");
    summary.className = "candidate-summary";
    summary.textContent = paper.summary.length > 280 ? `${paper.summary.slice(0, 280)}...` : paper.summary;

    body.append(title, meta, summary);
    label.append(checkbox, body);
    elements.candidateList.append(label);
  });

  updateCandidateActionState();
}

async function loadCandidateBatch(search, { start = 0, requestId = "" } = {}) {
  const params = new URLSearchParams({
    query: search.query,
    limit: String(search.limit),
    days: search.days,
    requestId,
    start: String(start)
  });

  if ((search.forceRefresh || search.forceArxiv) && start === 0) {
    params.set("refresh", "1");
  }

  if (search.forceArxiv) {
    params.set("forceArxiv", "1");
    params.set("ignoreCooldown", "1");
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), search.forceArxiv ? 90000 : 60000);

  try {
    const response = await fetch(`/api/papers?${params.toString()}`, { signal: controller.signal });
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
    const method = response.headers.get("x-paper-insight-arxiv-method") || "";
    const cacheAge = Number(response.headers.get("x-paper-insight-cache-age-seconds") || 0);
    const warning = response.headers.get("x-paper-insight-arxiv-warning");
    const sourceReturn = decodeHeaderValue(response.headers.get("x-paper-insight-source-return"));
    const returnHint = sourceReturn ? ` 返回值：${sourceReturn}` : "";
    const sourceInfo = candidateSourceInfo({ source, method, cacheStatus, forceArxiv: search.forceArxiv });
    const papers = annotateCandidateSource(parsePapers(await response.text()).slice(0, search.limit), sourceInfo);

    return {
      papers,
      cacheStatus,
      source,
      method,
      cacheAge,
      warning,
      returnHint
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchCandidates({ forceRefresh = false, forceArxiv = false } = {}) {
  if (state.taskLocked) {
    return;
  }

  if (!ensureApiKey()) {
    return;
  }

  state.candidatePapers = [];
  state.selectedCandidateIds = new Set();
  state.candidateSearch = null;
  state.lastAnalyzePapers = [];
  state.analysisSession = null;
  state.currentThreshold = Number(elements.thresholdInput.value || 70);
  state.currentMinRecommended = minRecommendedValue();
  resetTaskModal();
  showTaskDialog();
  setTaskLocked(true);
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const dateWindowLabel = selectedDateWindowLabel();
  elements.taskForceArxiv.textContent = `强制使用 arXiv API 查询${dateWindowLabel}`;
  elements.candidateForceArxiv.textContent = `强制 arXiv API 重新获取${dateWindowLabel}`;
  setTaskStatus(forceArxiv ? `arXiv API：正在查询${dateWindowLabel}。` : "本地 arXiv 库：正在同步最新 RSS 并筛选候选论文。");
  const query = currentSearchQuery();
  const candidateLimit = candidateLimitValue();
  const search = {
    query,
    limit: candidateLimit,
    days: elements.dateWindow.value,
    forceRefresh,
    forceArxiv,
    nextStart: 0
  };

  startSourceStatusPolling(requestId);

  try {
    const result = await loadCandidateBatch(search, { start: 0, requestId });
    resetSourceStatusTimer();
    search.nextStart = result.papers.length;
    state.candidateSearch = search;
    const { papers, cacheStatus, source, cacheAge, warning, returnHint } = result;

    if (!papers.length) {
      setTaskLocked(false);
      const text = warning ? decodeURIComponent(warning) : "arXiv 没有返回匹配论文。可以放宽查询条件或扩大时间范围。";
      setTaskStatus(text, "warning", "force-arxiv");
      return;
    }

    showCandidateConfirmation(papers);
    if (cacheStatus === "stale") {
      const minutes = Math.max(1, Math.round(cacheAge / 60));
      const text = warning ? decodeURIComponent(warning) : "arXiv 暂时不可用，已使用本地缓存。";
      setTaskStatus(`${sourceLabel(source)}：${text}${returnHint} 缓存约 ${minutes} 分钟前更新，请确认候选论文。`, "warning", "refresh");
    } else if (cacheStatus === "hit") {
      const text = warning ? decodeURIComponent(warning) : `已从本地缓存读取 ${papers.length} 篇候选论文。需要新候选时可以重新获取。`;
      setTaskStatus(`${sourceLabel(source)}：${text}`, "warning", "refresh");
    } else {
      const text = warning ? decodeURIComponent(warning) : `已获取 ${papers.length} 篇候选论文，请确认要进入 AI 分析的论文。`;
      const action = "force-arxiv";
      setTaskStatus(`${sourceLabel(source)}：${text}`, "warning", action);
    }
  } catch (error) {
    resetSourceStatusTimer();
    setTaskLocked(false);
    const message = error.name === "AbortError"
      ? "请求超过等待时间。可能是 arXiv API 或远端网络暂时无响应，请稍后再试。"
      : error.message;
    setTaskStatus(`暂时无法获取候选论文：${message}`, "error", "force-arxiv");
  }
}

function updateProgress(progress) {
  const { done, total, paper, phase, startedAt, paperStartedAt } = progress;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const displayIndex = phase === "done" ? done : done + 1;
  elements.progressTitle.textContent = phase === "done" ? "本篇分析完成" : `${providerLabel()} 正在分析`;
  elements.progressFill.style.width = `${percent}%`;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressCurrent.textContent = paper
    ? `${phase === "done" ? "已完成" : "正在分析"}第 ${Math.min(displayIndex, total)}/${total} 篇：${paper.title}`
    : "正在准备分析任务。";
  elements.progressElapsed.textContent = `总耗时 ${secondsSince(startedAt)} 秒，本篇耗时 ${secondsSince(paperStartedAt || startedAt)} 秒。`;
}

function showProgressView(total, reusedCount = 0, analyzeCount = total) {
  const target = Math.min(state.analysisSession?.minRecommended || state.currentMinRecommended || 0, recommendationTargetMax);
  const targetText = target ? `，最低达标 ${target} 篇` : "";
  showTaskDialog();
  setTaskLocked(true);
  setTaskStep("analyze");
  showTaskPanel("progress");
  elements.progressFill.style.width = "0%";
  elements.progressPercent.textContent = "0%";
  elements.progressTitle.textContent = "准备分析";
  elements.progressCurrent.textContent = reusedCount
    ? `已复用 ${reusedCount} 篇历史分析，准备分析 ${analyzeCount} 篇新论文${targetText}。`
    : `已确认 ${total} 篇候选论文${targetText}，准备调用 ${providerLabel()}。`;
  elements.progressElapsed.textContent = "总耗时 0 秒，本篇耗时 0 秒。";
  setTaskStatus(reusedCount
    ? `已确认 ${total} 篇候选论文${targetText}，${reusedCount} 篇复用历史分析，${analyzeCount} 篇需要调用 ${providerLabel()}。`
    : `已确认 ${total} 篇候选论文${targetText}，正在逐篇分析...`);
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

function createAnalysisSession(papers) {
  const reused = [];
  const pending = [];
  const seedPapers = state.candidatePapers.length ? state.candidatePapers : papers;
  const seenKeys = new Set();

  papers.forEach((paper) => {
    const withHistory = paper.analysis ? paper : annotateHistoricalAnalysis(paper);

    if (withHistory.analysis && withHistory.reusedAnalysis) {
      reused.push(withHistory);
    } else {
      pending.push(paper);
    }
  });

  seedPapers.forEach((paper) => rememberPaperKeys(seenKeys, paper));

  return {
    papers: [...papers],
    reused,
    pending,
    analyzed: [...reused],
    seenKeys,
    search: state.candidateSearch ? { ...state.candidateSearch } : null,
    minRecommended: state.currentMinRecommended,
    mode: pending.length ? providerLabel() : "历史复用",
    nextIndex: 0,
    extraBatchCount: 0,
    stoppedAfterTarget: false,
    skippedAfterTarget: 0,
    failedPaper: null
  };
}

async function analyzeConfirmedPapers(papers, existingSession = null) {
  if (!ensureApiKey(`请先输入 ${providerLabel()} API Key，然后再开始 AI 分析。`)) {
    return;
  }

  const session = existingSession || createAnalysisSession(papers);
  const { reused, pending, analyzed } = session;
  const startIndex = Math.min(Math.max(Number(session.nextIndex || 0), 0), pending.length);

  state.analysisSession = session;
  state.lastAnalyzePapers = pending[startIndex] ? [pending[startIndex]] : [];
  state.currentThreshold = Number(elements.thresholdInput.value || 70);
  state.currentPaperView = "recommended";
  state.currentSort = "score";
  let mode = session.mode || (pending.length ? providerLabel() : "历史复用");
  const startedAt = performance.now();

  showProgressView(session.papers.length, reused.length, pending.length);

  try {
    session.nextIndex = startIndex;

    while (true) {
      while (session.nextIndex < pending.length) {
        const index = session.nextIndex;
        const paper = pending[index];
        const paperStartedAt = performance.now();
        state.progressState = { done: index, total: pending.length, paper, phase: "running", startedAt, paperStartedAt };
        updateProgress(state.progressState);
        resetProgressTimer();
        state.progressTimer = window.setInterval(() => updateProgress(state.progressState), 500);

        session.nextIndex = index;
        session.failedPaper = paper;
        state.lastAnalyzePapers = [paper];

        let result;
        try {
          result = await analyzeOnePaper(paper);
        } catch (error) {
          state.analysisSession = session;
          state.lastAnalyzePapers = [paper];
          throw error;
        }

        mode = reused.length ? `${result.mode} + 历史复用` : result.mode;
        session.mode = mode;
        analyzed.push(result.paper);
        session.failedPaper = null;
        session.nextIndex = index + 1;
        state.lastAnalyzePapers = pending[index + 1] ? [pending[index + 1]] : [];

        const tempReport = {
          threshold: state.currentThreshold,
          candidateCount: session.papers.length,
          mode,
          items: analyzed
        };
        const counts = splitReport(tempReport);
        setMetrics({
          candidates: session.papers.length,
          recommended: counts.recommended.length,
          hidden: counts.hidden.length,
          mode
        });

        state.progressState = { done: index + 1, total: pending.length, paper, phase: "done", startedAt, paperStartedAt };
        updateProgress(state.progressState);

        const target = Math.min(session.minRecommended || 0, recommendationTargetMax);
        if (session.extraBatchCount > 0 && target && counts.recommended.length >= target) {
          session.stoppedAfterTarget = true;
          session.skippedAfterTarget = Math.max(0, pending.length - session.nextIndex);
          setTaskStatus(`阈值以上论文已达到 ${counts.recommended.length}/${target} 篇，停止分析剩余追加候选。`, "success");
          break;
        }
      }

      const currentCounts = splitReport({
        threshold: state.currentThreshold,
        candidateCount: session.papers.length,
        mode,
        items: analyzed
      });
      const target = Math.min(session.minRecommended || 0, recommendationTargetMax);

      if (!target || currentCounts.recommended.length >= target || !session.search || session.extraBatchCount >= extraBatchMax) {
        break;
      }

      const nextStart = Math.max(Number(session.search.nextStart || 0), session.papers.length);
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      session.extraBatchCount += 1;
      setTaskStatus(`阈值以上论文 ${currentCounts.recommended.length}/${target} 篇，正在查询第 ${session.extraBatchCount + 1} 批候选论文...`);
      startSourceStatusPolling(requestId);

      let extraResult;
      try {
        extraResult = await loadCandidateBatch(session.search, { start: nextStart, requestId });
      } finally {
        resetSourceStatusTimer();
      }

      session.search.nextStart = nextStart + extraResult.papers.length;
      const extraPapers = uniqueCandidatePapers(extraResult.papers, session.seenKeys);

      if (!extraPapers.length) {
        setTaskStatus(`阈值以上论文只有 ${currentCounts.recommended.length}/${target} 篇，后续候选已经耗尽或重复。`, "warning");
        break;
      }

      session.papers.push(...extraPapers);
      pending.push(...extraPapers);
      state.lastAnalyzePapers = [pending[session.nextIndex]];
      showProgressView(session.papers.length, reused.length, pending.length);
    }
  } finally {
    resetProgressTimer();
  }

  if (!pending.length) {
    const counts = splitReport({
      threshold: state.currentThreshold,
      candidateCount: session.papers.length,
      mode,
      items: analyzed
    });
    setMetrics({
      candidates: session.papers.length,
      recommended: counts.recommended.length,
      hidden: counts.hidden.length,
      mode
    });
  }

  const report = {
    key: `${weekStart().toISOString().slice(0, 10)}-${Date.now()}`,
    title: reportTitle(),
    createdAt: new Date().toISOString(),
    mode,
    threshold: state.currentThreshold,
    minRecommended: session.minRecommended,
    extraBatchCount: session.extraBatchCount,
    stoppedAfterTarget: session.stoppedAfterTarget,
    skippedAfterTarget: session.skippedAfterTarget,
    candidateCount: analyzed.length,
    items: analyzed
  };
  state.reports = [report, ...state.reports].slice(0, 20);
  persistReports();
  openReport(report);
  state.analysisSession = null;
  state.lastAnalyzePapers = [];
  setTaskLocked(false);
  setTaskStep("done");
  showTaskPanel("done");
  const counts = splitReport(report);
  const target = Math.min(session.minRecommended || 0, recommendationTargetMax);
  const targetReached = !target || counts.recommended.length >= target;
  const targetText = target
    ? targetReached
      ? `最低达标数 ${target} 篇已达到。`
      : `最低达标数 ${target} 篇未达到，只找到 ${counts.recommended.length} 篇达标论文，低于阈值的论文未纳入推荐。`
    : "";
  const expansionText = session.extraBatchCount ? `已额外查询 ${session.extraBatchCount} 轮候选。` : "";
  const stoppedText = session.stoppedAfterTarget
    ? `达到最低达标数后已停止 ${session.skippedAfterTarget} 篇追加候选分析。`
    : "";
  const reusedText = reused.length ? `复用 ${reused.length} 篇历史分析。` : "";
  elements.taskDoneSummary.textContent = [
    `推荐 ${counts.recommended.length} 篇，隐藏 ${counts.hidden.length} 篇。`,
    targetText,
    expansionText,
    stoppedText,
    reusedText
  ].filter(Boolean).join("");

  if (targetReached) {
    setTaskStatus(reused.length ? `最新列表已生成，${reused.length} 篇论文未重复调用 ${providerLabel()}。` : "最新列表已生成。", "success");
  } else {
    setTaskStatus(`最新列表已生成，但只找到 ${counts.recommended.length}/${target} 篇阈值以上论文；低分论文不会补进推荐。`, "warning");
  }
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

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知时间" : dateTimeFormatter.format(date);
}

function paperDateRange(papers) {
  const dates = (Array.isArray(papers) ? papers : [])
    .map((paper) => new Date(paper?.published || paper?.updated))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b);

  if (!dates.length) {
    return "未知";
  }

  const start = formatDate(dates[0]);
  const end = formatDate(dates[dates.length - 1]);
  return start === end ? start : `${start} 至 ${end}`;
}

function analysisText(paper, field, fallback = "大模型未返回该部分内容。") {
  const value = paper?.analysis?.[field];

  if (value) {
    return value;
  }

  if (field === "notRecommendReason") {
    return notRecommendReasonForPaper(paper);
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

function notRecommendReasonForPaper(paper) {
  const score = paperScore(paper);

  if (score >= 60) {
    return "";
  }

  const explicit = String(paper?.analysis?.notRecommendReason || "").trim();
  if (explicit && !isGenericNotRecommendReason(explicit)) {
    return explicit;
  }

  const weakDimensionKeys = Object.entries(dimensionLabels)
    .map(([key, label]) => ({ label, score: Math.round(dimensionScore(paper, key)) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 2)
    .map((item) => item.key);
  const reasons = weakDimensionKeys.map((key) => weakDimensionShortfall(paper, key)).filter(Boolean);

  return reasons.length
    ? reasons.join(" ")
    : "这篇论文目前看不出足够明确的研究增量：问题定义、方法机制、系统可复用性和证据支撑都缺少可核验细节，因此不适合作为本轮重点阅读对象。";
}

function isGenericNotRecommendReason(value) {
  return /总分\s*\d+|低于\s*60|主要短板是.*\d+\s*分|建议只在.*再扫读|关键评分维度不足/.test(String(value || ""));
}

function concreteAnalysisSentence(paper, fields, max = 130) {
  const text = fields
    .map((field) => String(paper?.analysis?.[field] || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");

  if (!text) {
    return "";
  }

  const sentence = text
    .split(/(?<=[。！？.!?])\s*/)
    .find((item) => item.length >= 18 && !isGenericNotRecommendReason(item))
    || text;

  return sentence.length > max ? `${sentence.slice(0, max)}...` : sentence;
}

function weakDimensionShortfall(paper, key) {
  if (key === "methodNovelty") {
    const detail = concreteAnalysisSentence(paper, ["method", "technicalDetails", "contribution"]);
    return detail
      ? `方法贡献不够清楚，当前描述主要停留在“怎么组织流程/框架”，还看不出可复用的新机制、建模方式或验证算法：${detail}`
      : "方法贡献不够清楚，当前信息更像既有 LLM/RAG/Agent 流程拼装或概念框架，缺少可复用的新机制、建模方式或验证算法。";
  }

  if (key === "evidence") {
    const detail = concreteAnalysisSentence(paper, ["experiment", "limitations"]);
    return detail
      ? `证据支撑偏弱，实验或案例还不足以证明结论能泛化到真实场景：${detail}`
      : "证据支撑偏弱，没有看到足够的数据集、基线、消融、鲁棒性、真实场景案例或可复现线索来支撑结论。";
  }

  if (key === "practicalValue") {
    const detail = concreteAnalysisSentence(paper, ["technicalDetails", "method", "networkUseCase"]);
    return detail
      ? `系统价值不够落地，模块接口、数据流、闭环执行或失败处理还不够具体：${detail}`
      : "系统价值不够落地，模块接口、数据流、闭环执行、部署约束和失败处理没有讲清楚，难以判断能否复用到其他场景。";
  }

  const detail = concreteAnalysisSentence(paper, ["problem", "background"]);
  return detail
    ? `研究问题还不够聚焦，问题边界、可验证目标或关键假设没有充分展开：${detail}`
    : "研究问题还不够聚焦，更像场景方向或业务愿景，缺少清楚的问题边界、可验证目标和关键研究假设。";
}

function compactSentence(value, max = 110) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }

  const match = text.match(/^(.{18,}?[。！？.!?])/);
  const sentence = match ? match[1] : text;
  return sentence.length > max ? `${sentence.slice(0, max)}...` : sentence;
}

function highValueSignalForPaper(paper) {
  const score = paperScore(paper);

  if (score < 70) {
    return "";
  }

  const explicit = String(paper?.analysis?.valueHighlight || "").trim();
  if (explicit) {
    return explicit;
  }

  const topDimensions = Object.entries(dimensionLabels)
    .map(([key, label]) => ({ label, score: Math.round(dimensionScore(paper, key)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((item) => `${item.label} ${item.score} 分`)
    .join("、");
  const reason = compactSentence(paper?.analysis?.whyRecommend, 96);

  return reason
    ? `高分信号：${topDimensions || "关键维度较强"}；${reason}`
    : `高分信号：${topDimensions || "关键维度较强"}，建议优先核验其方法贡献、系统机制和证据支撑。`;
}

async function translatePaper(paper, button, target) {
  if (!ensureApiKey(`请先输入 ${providerLabel()} API Key，摘要翻译必须使用大模型 API。`)) {
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

function appendPaperCard(paper, container, options = {}) {
  const report = options.report || state.currentReport;
  const fragment = elements.paperTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".paper-card");
  const analysis = paper.analysis || {};
  const recommended = isRecommendedPaper(paper, report);

  card.classList.toggle("hidden-paper", !recommended);
  setScorePill(fragment.querySelector(".score-pill"), paper);
  fragment.querySelector(".date-pill").textContent = formatDate(paper.published);
  fragment.querySelector(".category-pill").textContent = paperCategoryLabel(paper);
  appendIndustryTagPills(fragment.querySelector(".paper-meta"), paper);
  fragment.querySelector("h3").textContent = paper.title || "未命名论文";

  const authors = fragment.querySelector(".authors");
  authors.textContent = paper.authors?.slice(0, 8).join(", ") || "Unknown authors";

  const sourceOrigin = paper.candidateSourceLabel ? `候选来源：${paper.candidateSourceLabel}` : "";
  const originText = [options.origin, sourceOrigin].filter(Boolean).join(" · ");

  if (originText) {
    const origin = document.createElement("p");
    origin.className = "paper-origin";
    origin.textContent = originText;
    authors.insertAdjacentElement("afterend", origin);
  }

  const tldr = fragment.querySelector(".tldr");
  tldr.textContent = analysis.tldr || "大模型未返回一句话概要。";
  const highValueSignal = highValueSignalForPaper(paper);

  if (highValueSignal) {
    const signal = document.createElement("p");
    signal.className = "high-value-signal";
    signal.textContent = highValueSignal;
    tldr.insertAdjacentElement("afterend", signal);
  }

  const notRecommendReason = notRecommendReasonForPaper(paper);

  if (notRecommendReason) {
    const reason = document.createElement("p");
    reason.className = "not-recommend-reason";
    reason.textContent = `不推荐原因：${notRecommendReason}`;
    tldr.insertAdjacentElement("afterend", reason);
  }
  fragment.querySelector(".abstract").textContent = paper.summary || "";
  fragment.querySelector(".abs-link").href = paper.absLink || paper.id || "#";

  const scoreGrid = fragment.querySelector(".score-grid");
  Object.entries(dimensionLabels).forEach(([key, label]) => {
    scoreGrid.append(createScoreRow(label, dimensionScore(paper, key)));
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

  fragment.querySelector(".detail-button").addEventListener("click", () => openPaper(paper, {
    from: options.from || "report",
    report
  }));
  container.append(fragment);
}

function appendExplorePaperRow(paper, container) {
  const row = document.createElement("article");
  row.className = "explore-paper-row";
  row.classList.toggle("hidden-paper", !isRecommendedPaper(paper, paper._exploreLatestReport));

  const score = paperScore(paper);
  const tier = scoreTier(score);

  const scoreBox = document.createElement("div");
  scoreBox.className = "explore-score";

  const scoreValue = document.createElement("strong");
  scoreValue.textContent = String(score);

  const tierLabel = document.createElement("span");
  tierLabel.textContent = tier.label;

  scoreBox.append(scoreValue, tierLabel);

  const body = document.createElement("div");
  body.className = "explore-paper-body";

  const meta = document.createElement("div");
  meta.className = "explore-paper-meta";
  const industryTags = industryTagsForPaper(paper);
  const industryText = industryTags.length ? ` · ${industryTags.join(" / ")}` : "";
  meta.textContent = `${formatDate(paper.published)} · ${paperCategoryLabel(paper)}${industryText} · ${paper.candidateSourceLabel || "来源未知"} · ${explorePaperOrigin(paper)}`;

  const title = document.createElement("h3");
  title.textContent = paper.title || "未命名论文";

  const authors = document.createElement("p");
  authors.className = "explore-authors";
  authors.textContent = paper.authors?.slice(0, 5).join(", ") || "Unknown authors";

  const tldr = document.createElement("p");
  tldr.className = "explore-tldr";
  const notRecommendReason = notRecommendReasonForPaper(paper);
  const highValueSignal = highValueSignalForPaper(paper);
  tldr.textContent = notRecommendReason
    ? `不推荐原因：${notRecommendReason}`
    : highValueSignal || paper.analysis?.tldr || paper.summary || "暂无概要。";

  const dimensions = document.createElement("div");
  dimensions.className = "explore-dimensions";
  Object.entries(dimensionLabels).forEach(([key, label]) => {
    const item = document.createElement("span");
    item.textContent = `${label} ${Math.round(dimensionScore(paper, key))}`;
    dimensions.append(item);
  });

  body.append(meta, title, authors, tldr, dimensions);

  const actions = document.createElement("div");
  actions.className = "explore-actions";

  const detail = document.createElement("button");
  detail.className = "detail-button";
  detail.type = "button";
  detail.textContent = "查看分析";
  detail.addEventListener("click", () => openPaper(paper, {
    from: "explore",
    report: paper._exploreLatestReport
  }));

  const link = document.createElement("a");
  link.className = "paper-link";
  link.target = "_blank";
  link.rel = "noreferrer";
  link.href = paper.absLink || paper.id || "#";
  link.textContent = "论文页面";

  actions.append(detail, link);
  row.append(scoreBox, body, actions);
  container.append(row);
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
    appendPaperCard(paper, elements.paperList, {
      report: state.currentReport,
      from: "report"
    });
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
  const candidateTotal = report.candidateCount ?? counts.all.length;
  const rangePapers = counts.recommended.length ? counts.recommended : counts.all;
  const rangeLabel = counts.recommended.length ? "推荐论文时间范围" : "候选论文时间范围";
  elements.generateReadingList.disabled = !counts.all.length || state.taskLocked;
  elements.generateReadingList.textContent = report.readingList?.markdown ? "查看发布版周报" : "准备生成周报";
  setReadingListUseOriginalText(report.readingList?.useOriginalText ?? true);

  setHeader({
    eyebrow: "推荐报告",
    title: reportDisplayTitle(report),
    description: `${rangeLabel}：${paperDateRange(rangePapers)}。候选 ${candidateTotal} 篇，推荐 ${counts.recommended.length} 篇，隐藏 ${counts.hidden.length} 篇。`,
    showBack: true
  });
  renderBreadcrumb([
    { label: "推荐列表", onClick: () => showHome() },
    { label: reportDisplayTitle(report) }
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

function returnToPaperList() {
  if (state.paperReturnView === "explore") {
    showExplore();
    return;
  }

  if (state.paperReturnReport) {
    openReport(state.paperReturnReport, { keepPaperView: true });
    return;
  }

  showHome();
}

function openPaper(paper, options = {}) {
  state.currentPaper = paper;
  state.paperReturnView = options.from || (state.view === "explore" ? "explore" : "report");
  state.paperReturnReport = options.report || state.currentReport || null;
  setActiveView("paper");
  setHeader({
    eyebrow: state.paperReturnView === "explore" ? "论文探索 / 单篇分析" : "推荐报告 / 单篇分析",
    title: paper.title || "论文分析",
    description: `${formatDate(paper.published)} · ${paperCategoryLabel(paper)} · 推荐分 ${paperScore(paper)}。`,
    showBack: true,
    backLabel: state.paperReturnView === "explore" ? "返回探索" : "返回报告"
  });

  if (state.paperReturnView === "explore") {
    renderBreadcrumb([
      { label: "论文探索", onClick: () => showExplore() },
      { label: paper.title || "论文详情" }
    ]);
  } else {
    renderBreadcrumb([
      { label: "推荐列表", onClick: () => showHome() },
      {
        label: state.paperReturnReport ? reportDisplayTitle(state.paperReturnReport) : "推荐报告",
        onClick: () => state.paperReturnReport ? openReport(state.paperReturnReport, { keepPaperView: true }) : showHome()
      },
      { label: paper.title || "论文详情" }
    ]);
  }

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
  category.textContent = paperCategoryLabel(paper);

  meta.append(score, date, category);
  appendIndustryTagPills(meta, paper);

  const title = document.createElement("h3");
  title.textContent = paper.title || "未命名论文";

  const authors = document.createElement("p");
  authors.className = "authors";
  authors.textContent = paper.authors?.slice(0, 12).join(", ") || "Unknown authors";

  const tldr = document.createElement("p");
  tldr.className = "tldr";
  tldr.textContent = analysisText(paper, "tldr", "大模型未返回一句话概要。");

  const actions = document.createElement("div");
  actions.className = "paper-actions";

  const back = document.createElement("button");
  back.className = "secondary-action";
  back.type = "button";
  back.textContent = state.paperReturnView === "explore" ? "返回探索" : "返回报告";
  back.addEventListener("click", returnToPaperList);

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
  const detailSections = [
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
    ])
  ];

  const notRecommendReason = notRecommendReasonForPaper(paper);
  if (notRecommendReason) {
    detailSections.push(createDetailSection("不推荐原因", notRecommendReason));
  }

  const highValueSignal = highValueSignalForPaper(paper);
  if (highValueSignal) {
    detailSections.push(createDetailSection("高分信号", highValueSignal));
  }

  detailSections.push(
    createDetailSection("阅读建议与推荐理由", [
      { label: "阅读建议", body: analysisText(paper, "recommendedReadingPath") },
      { label: "推荐理由", body: analysisText(paper, "whyRecommend") }
    ])
  );
  sections.append(...detailSections);

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
  if (state.taskLocked) {
    return;
  }
  fetchCandidates();
});

elements.thresholdInput.addEventListener("input", () => {
  elements.thresholdValue.textContent = elements.thresholdInput.value;
  state.currentThreshold = Number(elements.thresholdInput.value);
});

elements.minRecommendedInput.addEventListener("input", () => {
  state.currentMinRecommended = minRecommendedValue();
});

elements.openQueryDialog.addEventListener("click", () => {
  updateQuerySummary();

  if (typeof elements.queryDialog.showModal === "function") {
    elements.queryDialog.showModal();
  } else {
    elements.queryDialog.setAttribute("open", "");
  }
});

elements.queryClose.addEventListener("click", () => {
  if (typeof elements.queryDialog.close === "function") {
    elements.queryDialog.close();
  } else {
    elements.queryDialog.removeAttribute("open");
  }
});

elements.queryApply.addEventListener("click", () => {
  currentSearchQuery();

  if (typeof elements.queryDialog.close === "function") {
    elements.queryDialog.close();
  } else {
    elements.queryDialog.removeAttribute("open");
  }
});

queryModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setQueryMode(button.dataset.queryMode, { sync: button.dataset.queryMode === "builder" });
  });
});

elements.queryText.addEventListener("input", () => {
  setQueryMode("manual", { sync: false });
  localStorage.setItem(storageKeys.query, elements.queryText.value.trim());
  updateQuerySummary();
});

elements.restoreQuery.addEventListener("click", () => {
  setKeywordSelection(defaultQuerySelection());
  setQueryMode("builder", { sync: true });
});

elements.backToReports.addEventListener("click", () => {
  if (state.view === "paper") {
    returnToPaperList();
    return;
  }

  showHome();
});

elements.openRecommendations.addEventListener("click", () => {
  showHome();
});

elements.openExplore.addEventListener("click", () => {
  showExplore();
});

elements.exploreSearch.addEventListener("input", () => {
  state.exploreSearch = elements.exploreSearch.value;
  renderExplorePapers();
});

exploreSortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.exploreSort = button.dataset.exploreSort;
    renderExplorePapers();
  });
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

elements.generateReadingList.addEventListener("click", () => {
  openReadingListDialog(state.currentReport);
});

elements.readingListRegenerate.addEventListener("click", () => {
  generateReadingListForReport(state.currentReadingListReport || state.currentReport, { force: true });
});

elements.readingListDownload.addEventListener("click", downloadReadingListMarkdown);

elements.readingListCopy.addEventListener("click", copyReadingListMarkdown);

elements.readingListSourceToggle?.addEventListener("click", () => {
  setReadingListSourceExpanded(!state.readingListSourceExpanded);
  renderReadingListSourceStatus(state.readingListLiveStatus);
});

elements.readingListUseOriginalText?.addEventListener("change", () => {
  setReadingListUseOriginalText(elements.readingListUseOriginalText.checked);
});

elements.readingListInlineUseOriginalText?.addEventListener("change", () => {
  setReadingListUseOriginalText(elements.readingListInlineUseOriginalText.checked);
});

elements.readingListCandidateFloor?.addEventListener("input", () => {
  updateReadingListReviewPreview();
});

elements.readingListReviewThreshold?.addEventListener("input", () => {
  updateReadingListReviewPreview();
});

elements.readingListMinSelected?.addEventListener("input", () => {
  updateReadingListReviewPreview();
});

elements.readingListClose.addEventListener("click", () => {
  resetReadingListTimer();
  resetReadingListStatusTimer();
  if (elements.readingListDialog.open) {
    elements.readingListDialog.close();
  }
});

elements.readingListDialog.addEventListener("cancel", () => {
  resetReadingListTimer();
  resetReadingListStatusTimer();
});

window.addEventListener("resize", () => {
  if (elements.readingListDialog.open) {
    adjustReadingListOutputHeight();
  }
});

elements.taskRefreshCandidates.addEventListener("click", () => {
  fetchCandidates({ forceRefresh: true });
});

elements.syncArxiv.addEventListener("click", () => {
  syncArxivLibrary({ force: true });
});

elements.openSyncHistory.addEventListener("click", () => {
  if (typeof elements.syncHistoryDialog.showModal === "function" && !elements.syncHistoryDialog.open) {
    elements.syncHistoryDialog.showModal();
  }

  loadSyncHistory();
});

elements.syncHistoryClose.addEventListener("click", () => {
  if (elements.syncHistoryDialog.open) {
    elements.syncHistoryDialog.close();
  }
});

elements.syncProgressClose.addEventListener("click", () => {
  if (elements.syncProgressDialog.open) {
    elements.syncProgressDialog.close();
  }
});

elements.refreshSyncHistory.addEventListener("click", loadSyncHistory);

function confirmForceArxivFetch() {
  const confirmed = window.confirm(`这会直接连接 export.arxiv.org API 查询${selectedDateWindowLabel()}，可能再次返回 429。确认要继续吗？`);

  if (confirmed) {
    fetchCandidates({ forceRefresh: true, forceArxiv: true });
  }
}

elements.taskForceArxiv.addEventListener("click", confirmForceArxivFetch);
elements.candidateForceArxiv.addEventListener("click", confirmForceArxivFetch);

elements.taskClose.addEventListener("click", () => {
  closeTaskDialog();
});

elements.taskDialog.addEventListener("cancel", (event) => {
  if (state.taskLocked) {
    event.preventDefault();
  }
});

elements.taskRetry.addEventListener("click", async () => {
  const retrySession = state.analysisSession;

  if (!retrySession && !state.lastAnalyzePapers.length) {
    setTaskStatus("没有可重试的候选论文，请重新生成推荐列表。", "warning");
    return;
  }

  elements.taskRetry.hidden = true;

  try {
    await analyzeConfirmedPapers(retrySession ? retrySession.papers : state.lastAnalyzePapers, retrySession);
  } catch (error) {
    resetProgressTimer();
    setTaskLocked(false);
    setTaskStatus(`重试失败：${error.message}`, "error", error.retryable ? "retry" : "");
  }
});

elements.retryButton.addEventListener("click", async () => {
  const retrySession = state.analysisSession;

  if (!retrySession && !state.lastAnalyzePapers.length) {
    showStatus("没有可重试的候选论文，请重新生成推荐任务。", "warning");
    return;
  }

  elements.retryButton.hidden = true;

  try {
    await analyzeConfirmedPapers(retrySession ? retrySession.papers : state.lastAnalyzePapers, retrySession);
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
  renderApiModelOptions(state.runtimeProvider, state.runtimeModel);

  if (typeof elements.apiDialog.showModal === "function") {
    elements.apiDialog.showModal();
  }
});

elements.apiProvider.addEventListener("change", () => {
  renderApiModelOptions(elements.apiProvider.value, modelForProvider(elements.apiProvider.value));
});

elements.apiClose.addEventListener("click", () => {
  elements.apiDialog.close();
});

elements.clearApiKey.addEventListener("click", () => {
  state.runtimeApiKey = "";
  sessionStorage.removeItem(storageKeys.apiKey);
  sessionStorage.removeItem(storageKeys.legacyApiKey);
  updateApiStatus();
  showStatus(`${providerLabel()} API Key 已清除。生成推荐和翻译前需要重新设置。`, "warning");
});

elements.apiForm.addEventListener("submit", (event) => {
  const key = elements.apiKeyInput.value.trim();

  if (!key) {
    event.preventDefault();
    elements.apiKeyInput.focus();
    return;
  }

  state.runtimeProvider = normalizeProviderKey(elements.apiProvider.value);
  state.runtimeApiKey = key;
  state.runtimeModel = elements.apiModel.value;
  sessionStorage.setItem(storageKeys.provider, state.runtimeProvider);
  sessionStorage.setItem(storageKeys.apiKey, state.runtimeApiKey);
  sessionStorage.setItem(storageKeys.model, state.runtimeModel);
  sessionStorage.setItem(providerModelStorageKey(state.runtimeProvider), state.runtimeModel);
  updateApiStatus();
  showStatus(`${providerLabel()} API Key 已加载，可以生成推荐列表。`, "warning");
});

// Defensive cleanup for reports generated by earlier local iterations.
state.reports = state.reports.filter((report) => report && (report.key || report.title));
state.reports = state.reports.slice(0, 20);
persistReports();
updateApiStatus();
showHome();
refreshArxivSyncStatus({ autoSync: true });

if (!state.runtimeApiKey && typeof elements.apiDialog.showModal === "function") {
  elements.apiDialog.showModal();
}
