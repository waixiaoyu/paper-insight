const DIRECT_INTERNAL_PROCESS_PATTERNS = [
  /复评分|复评阈值|保底补入|内部筛选|候选下限|定向重评|横向校准/iu,
  /\bselection\s*reason\b|\bselectionreason\b|\binternal\s+json\b|内部\s*json/iu,
  /(?:评分|选稿|推荐|复评|候选|内部)\s*阈值/iu,
  /\b(?:score|selection|review|recommendation|candidate|internal)\s+thresholds?\b/iu
];

const FALLBACK_TERM_PATTERN = /\bfallback\b/iu;
const FALLBACK_CONTEXT_PATTERN = /论文|候选|入选|选稿|周报|发布|保底|内部|流程|paper|candidate|selection|report|publish|internal|workflow/iu;
const OPERATION_TERM_PATTERN = /\bagent\s+(?:loop|stage)\b|\bprompts?\b|\bartifacts?\b|\btrace\b|智能体(?:循环|阶段)|提示词|运维轨迹/iu;
const OPERATION_CONTEXT_PATTERN = /paper\s*insight|本轮|周报|任务|候选|入选|选稿|发布|管理员|修正|重试|内部|生成流程|工作流/iu;

const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();

export const containsInternalProcessLanguage = (value) => {
  const text = normalizeText(value);
  if (!text) {
    return false;
  }
  if (DIRECT_INTERNAL_PROCESS_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (FALLBACK_TERM_PATTERN.test(text) && FALLBACK_CONTEXT_PATTERN.test(text)) {
    return true;
  }
  return OPERATION_TERM_PATTERN.test(text) && OPERATION_CONTEXT_PATTERN.test(text);
};

export const internalProcessWarnings = (value, { path = "report.markdown" } = {}) => (
  containsInternalProcessLanguage(value)
    ? [{
      code: "internal_process_leak",
      path,
      message: "面向读者的内容包含 Paper Insight 内部流程说明（生成、选稿或运维），请管理员确认是否需要人工校对。",
      severity: "warning"
    }]
    : []
);
