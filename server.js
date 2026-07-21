import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const publicRoot = publicDir.endsWith(sep) ? publicDir : `${publicDir}${sep}`;
const port = Number(process.env.PORT || 3000);
const host = String(process.env.HOST || process.env.BIND_HOST || "").trim();
const arxivCacheDir = join(__dirname, ".cache", "arxiv");
const arxivCooldownPath = join(__dirname, ".cache", "arxiv-cooldown.json");
const arxivPaperLibraryPath = join(__dirname, ".cache", "arxiv-papers.json");
const arxivSyncHistoryPath = join(__dirname, ".cache", "arxiv-sync-history.json");
const paperOriginalTextCacheDir = join(__dirname, ".cache", "paper-original-text");
const arxivMinIntervalMs = Number(process.env.ARXIV_MIN_INTERVAL_MS || 3500);
const arxivFreshCacheMs = Number(process.env.ARXIV_CACHE_TTL_MS || 30 * 60 * 1000);
const arxivStaleCacheMs = Number(process.env.ARXIV_STALE_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const arxivDailySyncMs = Number(process.env.ARXIV_DAILY_SYNC_MS || 20 * 60 * 60 * 1000);
const arxivSyncHistoryLimit = Math.min(Math.max(Number(process.env.ARXIV_SYNC_HISTORY_LIMIT || 100), 20), 500);
const arxivCooldownMs = Number(process.env.ARXIV_429_COOLDOWN_MS || 30 * 60 * 1000);
const arxivMaxCooldownMs = Number(process.env.ARXIV_429_MAX_COOLDOWN_MS || 2 * 60 * 60 * 1000);
const paperOriginalTextCacheTtlMs = Number(process.env.PAPER_ORIGINAL_TEXT_CACHE_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const paperOriginalTextFetchTimeoutMs = Number(process.env.PAPER_ORIGINAL_TEXT_FETCH_TIMEOUT_MS || 30000);
const paperOriginalTextStoredMaxChars = Math.min(Math.max(Number(process.env.PAPER_ORIGINAL_TEXT_STORED_MAX_CHARS || 50000), 8000), 150000);
const paperOriginalTextMaxChars = Math.min(Math.max(Number(process.env.PAPER_ORIGINAL_TEXT_MAX_CHARS || 9000), 2500), 20000);
const paperOriginalTextTotalMaxChars = Math.min(Math.max(Number(process.env.PAPER_ORIGINAL_TEXT_TOTAL_MAX_CHARS || 120000), 20000), 500000);
const paperOriginalTextConcurrency = Math.min(Math.max(Number(process.env.PAPER_ORIGINAL_TEXT_CONCURRENCY || 2), 1), 5);
const llmResponseMaxChars = Number(process.env.LLM_RESPONSE_MAX_CHARS || 500000);
const llmMaxOutputTokens = Number(process.env.LLM_MAX_OUTPUT_TOKENS || 12000);
const llmRequestTimeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS || 10 * 60 * 1000);
const candidateBatchMax = 100;
const recommendationListMax = 100;
const readingListCandidateMax = 100;
const readingListReviewBatchSize = Math.min(Math.max(Number(process.env.READING_LIST_REVIEW_BATCH_SIZE || 1), 1), 20);
const arxivAutoSyncEnabled = !/^(0|false|no)$/i.test(String(process.env.ARXIV_AUTO_SYNC || "1"));
const arxivAutoSyncInitialDelayMs = Number(process.env.ARXIV_AUTO_SYNC_INITIAL_DELAY_MS || 30 * 1000);
const arxivAutoSyncRetryMs = Number(process.env.ARXIV_AUTO_SYNC_RETRY_MS || 60 * 60 * 1000);
const arxivRssCategories = String(process.env.ARXIV_RSS_CATEGORIES || "cs.NI,cs.AI,cs.LG,cs.MA,cs.DC,cs.IT,eess.SP,eess.SY")
  .split(/[,\s]+/)
  .map((item) => item.trim())
  .filter(Boolean);
const arxivMemoryCache = new Map();
const arxivInflight = new Map();
const paperOriginalTextMemoryCache = new Map();
const paperOriginalTextInflight = new Map();
const paperRequestStatuses = new Map();
let arxivPaperLibraryMemory = null;
let arxivSyncHistoryMemory = null;
let arxivSyncInflight = null;
let arxivQueue = Promise.resolve();
let arxivLastRequestAt = 0;
let arxivBlockedUntil = 0;
let arxivCooldownLoaded = false;
let arxivCooldownFailures = 0;
let arxivAutoSyncTimer = null;

const defaultQuery = `("large language model" OR "LLM" OR "foundation model" OR "AI agent" OR "LLM agent" OR
"multi-agent" OR "agentic AI" OR "autonomous agent") AND
("autonomous network" OR "autonomous networking" OR "self-driving network" OR "zero-touch network" OR
"network digital twin" OR "digital twin network" OR "intent-based networking" OR "agent framework" OR
"agentic framework" OR "end-to-end framework" OR "closed-loop autonomy" OR "network automation")`;

const dimensions = [
  {
    key: "scenarioProblemValue",
    label: "研究问题价值",
    weight: 0.2,
    description: "研究问题是否被清晰定义，是否具有真实重要性、科学研究价值和可验证假设；方向兴趣会在总分校准中单独处理，不混入该维度。"
  },
  {
    key: "methodNovelty",
    label: "方法新意",
    weight: 0.3,
    description: "方法、架构、建模方式或评估设计是否有实质新意，而不是套用概念、整理流程或包装已有工程实践。"
  },
  {
    key: "practicalValue",
    label: "系统价值",
    weight: 0.2,
    description: "论文提出的解决框架、系统机制或工程结构是否清楚、可实现、可复用、可迁移；单纯产业愿景或方案宣介不能给高分。"
  },
  {
    key: "evidence",
    label: "证据强度",
    weight: 0.3,
    description: "实验、数据、基线、指标、消融、案例验证、可复现线索和结论支撑是否扎实。"
  }
];

const scoringRubric = [
  "总分档位：0-49 表示基本不达标，概念模糊、贡献弱、证据不足或只是产业/实践/流程性内容；50-59 表示弱相关、弱贡献或专用非目标领域论文；60-69 表示一般候选，方向或问题有价值，但创新、系统完整性、证据至少有一项明显短板，或方向相关性还不明确；70-79 表示值得扫读，问题清楚，有一定研究贡献或系统价值，但还不是强论文；80-89 表示重点关注，问题、方法、系统或证据中至少两项比较强，值得深入读；90-100 表示少数高价值论文，问题重要，方法有实质贡献，证据扎实，结论边界清楚，且和目标方向高度相关。",
  "维度打分必须使用同样的档位含义，不能把一般相关论文集中打到 70 分以上；方向匹配、产业价值或 ICT/ADN 相关性不能提高四维分，只能通过独立的 interestFit 影响最终推荐分。",
  "研究问题价值：0-49 表示问题不清楚或只是愿景/场景口号；50-59 表示有问题意识，但定义宽泛，缺少可验证目标；60-69 表示问题有意义，但边界、假设或研究难点不够清楚；70-79 表示问题清晰，研究价值明确，值得扫读；80-89 表示问题重要且定义好，对领域有推进意义；90-100 只给非常关键、可泛化、能牵引后续研究的问题。",
  "方法新意：0-49 表示无实质方法，只是宣传、流程总结、概念框架、标准解读或新名词包装；50-59 表示主要套用已有方法，只有轻微场景包装；60-69 表示有组合或适配，但新机制有限；70-79 表示有明确的技术适配、约束建模、状态表示、工具调用、安全验证、流程或评测设计；80-89 表示提出可复用的新机制、新算法、新任务定义、新评测协议或新的 agent 协同/验证机制；90-100 只给方法贡献显著，别人可以实现、比较、迁移的论文。",
  "系统价值：0-49 表示只有概念图、愿景或不可执行流程；50-59 表示有系统想法，但模块、接口、运行条件不清楚；60-69 表示系统结构基本清楚，但可复用性、闭环机制或失败处理有限；70-79 表示模块、数据流、流程较清晰，有实现路径；80-89 表示架构完整，关键机制、部署约束、风险处理比较清楚；90-100 只给系统设计成熟，可迁移、可验证、可复用的论文。",
  "证据强度：0-49 表示几乎没有实验或可核验结果；50-59 表示只有 demo、案例或弱实验；60-69 表示有实验但基线、消融、泛化或复现线索不足；70-79 表示实验设置基本合理，有数据、指标、基线和结果；80-89 表示证据扎实，有多基线、消融、鲁棒性或泛化分析；90-100 只给多场景、多数据、强基线、充分消融且结论边界清楚的论文。",
  "兴趣适配：interestFit 必须在 target_network_autonomy、general_ai_system、out_of_scope_domain、unclear 中选择。网络自治、电信网络、ADN、O-RAN、5G/6G、网络数字孪生、意图驱动、闭环自治、网络运维、路由/QoS/频谱/切片/故障诊断等目标方向用 target_network_autonomy；通用 LLM/Agent/多智能体/工具调用/RAG/评测/安全/系统架构方法用 general_ai_system，即使用医学、金融等垂直数据验证，只要主要贡献是可迁移通用方法也不要归为非目标；只有主问题、评价对象或应用场景明确落在医学、生命科学、脑科学、基因组、地理数据、游戏、教育、金融、法律、社科、推荐系统等专用垂直领域，且摘要看不出可迁移的一般 AI/Agent/系统方法时，才用 out_of_scope_domain；看不清适用方向时用 unclear。",
  "降分规则：如果只能基于摘要和元数据判断，要保守评分并在 limitations 中说明；如果方法新意或证据强度明显不足，总分必须被拉低；如果只是 LLM/RAG/tool calling/workflow 常规拼装，方法新意通常不应超过 69；如果只有业务场景价值但缺少可验证机制或证据，总分通常不应超过 69；专用非目标领域论文只做轻度降权，不设置 70 分封顶，研究质量特别强时仍可进入推荐区。"
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, headers);
  response.end(body);
};

const sendJson = (response, status, payload, headers = {}) => {
  send(response, status, JSON.stringify(payload), {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));

const interestFitRules = {
  target_network_autonomy: {
    label: "网络自治/电信方向",
    adjustment: 4,
    reason: "方向适配：命中网络自治、电信网络、ADN 或网络基础设施问题，小幅提升本轮排序优先级。"
  },
  general_ai_system: {
    label: "通用 AI/Agent 方法",
    adjustment: 2,
    reason: "方向适配：属于通用 AI/Agent/系统方法，保留阅读价值，但需要进一步判断能否迁移到网络自治场景。"
  },
  out_of_scope_domain: {
    label: "专用非目标领域",
    adjustment: -6,
    reason: "方向适配：主问题属于医学、生命科学、地理、游戏、社科、推荐等专用非目标领域，小幅降低本轮推荐优先级。"
  },
  unclear: {
    label: "方向相关性不明",
    adjustment: -2,
    reason: "方向适配：暂时没有看到明确的网络自治/电信网络信号，也缺少足够清楚的通用可迁移方法，仅轻微后移。"
  }
};

const interestFitAliases = {
  target: "target_network_autonomy",
  network: "target_network_autonomy",
  telecom: "target_network_autonomy",
  ict: "target_network_autonomy",
  adn: "target_network_autonomy",
  "target-network-autonomy": "target_network_autonomy",
  "target_network": "target_network_autonomy",
  general: "general_ai_system",
  generic: "general_ai_system",
  "general-ai-system": "general_ai_system",
  out: "out_of_scope_domain",
  domain: "out_of_scope_domain",
  irrelevant: "out_of_scope_domain",
  "out-of-scope-domain": "out_of_scope_domain",
  uncertain: "unclear",
  unknown: "unclear"
};

const normalizeInterestFit = (value, fallback = "unclear") => {
  const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  const normalized = interestFitAliases[raw] || raw;
  return interestFitRules[normalized] ? normalized : fallback;
};

const textForInterestFit = (paper = {}, analysis = {}) => [
  paper.title,
  paper.summary,
  paper.primaryCategory,
  ...(Array.isArray(paper.categories) ? paper.categories : []),
  analysis.tldr,
  analysis.problem,
  analysis.method,
  analysis.technicalDetails,
  ...(Array.isArray(analysis.matchedKeywords) ? analysis.matchedKeywords : [])
].filter(Boolean).join(" ");

const targetInterestPattern = /\b(autonomous network(?:ing)?|self-driving network|zero-touch network|network digital twin|digital twin network|intent[-\s]?based network(?:ing)?|intent[-\s]?driven network|closed-loop autonomy|network automation|network orchestration|network management|network operations?|service assurance|O-RAN|RAN|radio access network|telecom(?:munications?)?|ICT|5G|6G|wireless communications?|cellular network|mobile network|core network|edge network|optical network|satellite network|network slicing|routing|QoS|spectrum|handover|fault diagnosis|alarm correlation|traffic prediction|anomaly detection)\b|网络自治|自智网络|零接触网络|网络数字孪生|意图驱动|闭环自治|网络自动化|网络编排|网络运维|电信|通信网络|无线通信|蜂窝|移动网络|无线接入|网络切片|路由|频谱|切换|故障诊断|告警关联|业务保障/i;
const generalAiInterestPattern = /\b(large language model|LLM|foundation model|AI[-\s]?agents?|LLM[-\s]?agents?|agentic AI|autonomous agents?|multi[-\s]?agents?|RAG|retrieval[-\s]?augmented|tool[-\s]?calling|agent[-\s]?framework|agentic[-\s]?framework|workflow|benchmark|evaluation|guardrail|safety|alignment|planning|reasoning|orchestration|system architecture)\b|大模型|智能体|多智能体|工具调用|检索增强|评测|基准|安全|规划|推理|系统架构|工程化/i;
const outOfScopeDomainPattern = /\b(medical|medicine|clinical|healthcare|diagnosis|patient|disease|cancer|genom(?:e|ic)|gene|protein|drug|brain|neuroscience|biology|biomedical|bioinformatics|geospatial|geography|earth observation|remote sensing|game|gaming|recommender systems?|social network|social media|education|finance|financial|legal|law|economics|chemistry|molecular)\b|医学|医疗|临床|诊断|患者|疾病|癌症|基因|蛋白|药物|脑科学|神经科学|生命科学|生物|地理|遥感|游戏|推荐系统|社交网络|教育|金融|法律|经济|化学|分子/i;
const falseNetworkDomainPattern = /\b(social network|regulatory network|protein network|gene network|brain network)\b|社交网络|调控网络|蛋白网络|基因网络|脑网络/i;

const inferInterestFit = (paper = {}, analysis = {}) => {
  const text = textForInterestFit(paper, analysis);
  const hasTarget = targetInterestPattern.test(text) || hasStrictIctSignal(paper, analysis.matchedKeywords);
  const hasGeneralAi = generalAiInterestPattern.test(text);
  const hasSpecificNonTarget = outOfScopeDomainPattern.test(text) || (falseNetworkDomainPattern.test(text) && !hasTarget);

  if (hasTarget) {
    return "target_network_autonomy";
  }

  if (hasGeneralAi) {
    return "general_ai_system";
  }

  if (hasSpecificNonTarget) {
    return "out_of_scope_domain";
  }

  return "unclear";
};

const interestCalibrationForPaper = (paper = {}, analysis = {}) => {
  const inferred = inferInterestFit(paper, analysis);
  const modelFit = normalizeInterestFit(analysis.interestFit || analysis.domainFit || analysis.topicFit || analysis.relevanceFit, inferred);
  const modelClaimsTargetWithoutEvidence = modelFit === "target_network_autonomy"
    && inferred !== "target_network_autonomy";
  const fit = modelClaimsTargetWithoutEvidence ? inferred : modelFit;
  const rule = interestFitRules[fit] || interestFitRules.unclear;

  return {
    fit,
    label: rule.label,
    adjustment: rule.adjustment,
    reason: rule.reason
  };
};

const researchQualityScore = (scores = {}) => {
  const totalWeight = dimensions.reduce((total, dimension) => total + dimension.weight, 0) || 1;
  const base = dimensions.reduce((sum, dimension) => (
    sum + clamp(scores[dimension.key]) * dimension.weight
  ), 0) / totalWeight;
  const method = clamp(scores.methodNovelty);
  const evidence = clamp(scores.evidence);
  const weakestResearchSignal = Math.min(method, evidence);
  const balancePenalty = Math.max(0, base - weakestResearchSignal) * 0.12;
  const weakEvidencePenalty = Math.max(0, 70 - evidence) * 0.2;
  return clamp(base * 1.2 - 22 - balancePenalty - weakEvidencePenalty);
};

const weightedScore = (scores = {}, interestFit = "general_ai_system") => {
  const quality = researchQualityScore(scores);
  const rule = interestFitRules[normalizeInterestFit(interestFit, "general_ai_system")] || interestFitRules.general_ai_system;
  return clamp(quality + rule.adjustment);
};

const normalizeTags = (items, max = 8) => (
  Array.isArray(items)
    ? items.map((item) => truncate(item, 40)).filter(Boolean).slice(0, max)
    : []
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const truncate = (value, length = 2200) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}...` : text;
};

const strictIctPattern = /\b(ICT|telecom|telecommunications?|5G|6G|O-RAN|RAN|radio access network|cellular network|mobile network|wireless network|wireless communications?|core network|edge network|network slicing|SDN|NFV|QoS|routing|spectrum|handover|service assurance|fault diagnosis|alarm correlation|optical network|satellite network)\b|通信网络|电信|无线通信|蜂窝|移动网络|无线接入|网络切片/i;

const hasStrictIctSignal = (paper, extra = []) => strictIctPattern.test([
  paper?.title,
  paper?.summary,
  ...(Array.isArray(extra) ? extra : [])
].filter(Boolean).join(" "));

const normalizeIndustryTags = (paper, items, max = 8, extra = []) => {
  const tags = normalizeTags(items, max);
  const hasIctSignal = hasStrictIctSignal(paper, [...tags, ...(Array.isArray(extra) ? extra : [])]);
  return tags
    .map((tag) => (/^ICT$/i.test(tag) ? "ICT" : tag))
    .filter((tag) => !/\bICT\b/i.test(tag) || hasIctSignal);
};

const genericNotRecommendPattern = /总分\s*\d+|低于\s*60|主要短板是.*\d+\s*分|建议只在.*再扫读|关键评分维度不足/;

const concreteSentence = (items, max = 150) => {
  const text = (Array.isArray(items) ? items : [items])
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .join(" ");
  const sentence = text
    .split(/(?<=[。！？.!?])\s*/)
    .find((item) => item.length >= 18 && !genericNotRecommendPattern.test(item))
    || text;

  return truncate(sentence, max);
};

const weakDimensionShortfall = (key, analysis = {}) => {
  if (key === "methodNovelty") {
    const detail = concreteSentence([analysis.method, analysis.technicalDetails, analysis.contribution], 130);
    return detail
      ? `方法贡献不够清楚，当前描述主要停留在“怎么组织流程/框架”，还看不出可复用的新机制、建模方式或验证算法：${detail}`
      : "方法贡献不够清楚，当前信息更像既有 LLM/RAG/Agent 流程拼装或概念框架，缺少可复用的新机制、建模方式或验证算法。";
  }

  if (key === "evidence") {
    const detail = concreteSentence([analysis.experiment, analysis.limitations], 130);
    return detail
      ? `证据支撑偏弱，实验或案例还不足以证明结论能泛化到真实场景：${detail}`
      : "证据支撑偏弱，没有看到足够的数据集、基线、消融、鲁棒性、真实场景案例或可复现线索来支撑结论。";
  }

  if (key === "practicalValue") {
    const detail = concreteSentence([analysis.technicalDetails, analysis.method, analysis.networkUseCase], 130);
    return detail
      ? `系统价值不够落地，模块接口、数据流、闭环执行或失败处理还不够具体：${detail}`
      : "系统价值不够落地，模块接口、数据流、闭环执行、部署约束和失败处理没有讲清楚，难以判断能否复用到其他场景。";
  }

  const detail = concreteSentence([analysis.problem, analysis.background], 130);
  return detail
    ? `研究问题还不够聚焦，问题边界、可验证目标或关键假设没有充分展开：${detail}`
    : "研究问题还不够聚焦，更像场景方向或业务愿景，缺少清楚的问题边界、可验证目标和关键研究假设。";
};

const notRecommendReasonForScore = (score, scores = {}, analysis = {}) => {
  if (score >= 60) {
    return "";
  }

  const interestFit = normalizeInterestFit(analysis.interestFit || analysis.domainFit || analysis.topicFit || analysis.relevanceFit, "");
  const lowInterestReason = (interestFit === "out_of_scope_domain" || interestFit === "unclear")
    ? normalizeText(analysis.interestReason) || interestFitRules[interestFit].reason
    : "";
  const existing = normalizeText(analysis.notRecommendReason);
  if (existing && !genericNotRecommendPattern.test(existing)) {
    return lowInterestReason ? `${lowInterestReason} ${existing}` : existing;
  }

  const weakDimensionKeys = dimensions
    .map((dimension) => ({
      key: dimension.key,
      score: Math.round(clamp(scores[dimension.key]))
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 2)
    .map((item) => item.key);
  const reasons = weakDimensionKeys
    .map((key) => weakDimensionShortfall(key, analysis))
    .filter(Boolean);

  const qualityReason = reasons.length
    ? reasons.join(" ")
    : "这篇论文目前看不出足够明确的研究增量：问题定义、方法机制、系统可复用性和证据支撑都缺少可核验细节，因此不适合作为本轮重点阅读对象。";
  return lowInterestReason ? `${lowInterestReason} ${qualityReason}` : qualityReason;
};

const highValueSignalForScore = (score, scores = {}, analysis = {}) => {
  if (score < 70) {
    return "";
  }

  const existing = normalizeText(analysis.valueHighlight);
  if (existing) {
    const interestFit = normalizeInterestFit(analysis.interestFit || analysis.domainFit || analysis.topicFit || analysis.relevanceFit, "");
    const interestReason = interestFit === "target_network_autonomy"
      ? normalizeText(analysis.interestReason) || interestFitRules.target_network_autonomy.reason
      : "";
    return interestReason && !existing.includes("方向适配")
      ? `${existing} ${interestReason}`
      : existing;
  }

  const topDimensions = dimensions
    .map((dimension) => ({
      label: dimension.label,
      score: Math.round(clamp(scores[dimension.key]))
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((item) => `${item.label} ${item.score} 分`)
    .join("、");
  const reason = normalizeText(analysis.whyRecommend).split(/[。！？.!?]/)[0];
  const reasonText = reason ? `；${truncate(reason, 140)}` : "，建议优先核验其方法贡献、系统机制和证据支撑";

  return `高分信号：总分 ${Math.round(score)}，强项是${topDimensions || "关键研究维度"}${reasonText}。`;
};

const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
const readingListTitlePrefix = "【精选论文】";
const readingListFooterNote = "本文由论文推荐Agent生成+人工校对，欢迎提出宝贵建议。代码可开源，欢迎联系作者。编码工具Codex，编码模型chatgpt 5.5，论文分析模型GLM 5.2";
const readingListTitleSuffixMaxChars = 32;
const readingListSpecificTitleTopics = [
  { label: "护栏验证", patterns: [/guard\s*rail/i, /guardrail/i, /criticality/i, /护栏/i] },
  { label: "可信安全", patterns: [/safety/i, /security/i, /trust/i, /reliab/i, /安全/i, /可信/i, /可靠/i] },
  { label: "网络数字孪生", patterns: [/digital\s*twin/i, /twin\s*network/i, /数字孪生/i] },
  { label: "意图驱动", patterns: [/intent[-\s]?based/i, /intent[-\s]?driven/i, /意图/i] },
  { label: "闭环自治", patterns: [/closed[-\s]?loop/i, /feedback\s*loop/i, /闭环/i, /自治闭环/i] },
  { label: "多智能体协同", patterns: [/multi[-\s]?agent/i, /multiagent/i, /多智能体/i, /协同智能体/i] },
  { label: "检索增强", patterns: [/\bRAG\b/i, /retriev/i, /检索增强/i, /知识检索/i] },
  { label: "网络基础模型", patterns: [/foundation\s*model/i, /network\s*foundation/i, /基础模型/i, /表征学习/i] },
  { label: "评测基准", patterns: [/benchmark/i, /evaluation/i, /评测/i, /基准/i] },
  { label: "仿真评估", patterns: [/simulation/i, /simulator/i, /仿真/i, /模拟/i] },
  { label: "故障诊断", patterns: [/fault/i, /anomal/i, /root\s*cause/i, /故障/i, /异常/i, /根因/i] },
  { label: "流量调度", patterns: [/traffic/i, /routing/i, /scheduling/i, /路由/i, /流量/i, /调度/i] },
  { label: "无线网络", patterns: [/\bRAN\b/i, /\b6G\b/i, /wireless/i, /radio\s*access/i, /无线/i] },
  { label: "工具调用", patterns: [/tool\s*use/i, /tool\s*calling/i, /function\s*calling/i, /工具调用/i] },
  { label: "知识图谱", patterns: [/knowledge\s*graph/i, /知识图谱/i] }
];
const readingListGenericTitlePattern = /(值得关注|重要趋势|核心趋势|前沿进展|发展趋势|新范式|新方向|新机遇|持续演进|加速落地|深度融合|全面赋能|多点开花|多维推进|本周论文|关键方向|技术路线|研究进展)/;
const readingListBroadTitleTerms = ["智能体", "网络自治", "大模型", "ICT", "ADN", "系统架构", "工程化", "论文", "研究"];

const formatReadingListTitleBase = (report = {}) => {
  const date = new Date(report.date || new Date());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const monthMatch = String(report.month || "").match(/^(\d{4})-(\d{1,2})$/);
  const year = monthMatch ? Number(monthMatch[1]) : safeDate.getFullYear();
  const month = monthMatch ? Number(monthMatch[2]) : safeDate.getMonth() + 1;
  const issue = Math.min(Math.max(Number(report.weekOfMonth || 1), 1), 6);
  const shortYear = String(year).slice(-2);

  return `${readingListTitlePrefix}${shortYear}年${month}月第${issue}周阅读清单：`;
};

const readingListTitleFromMarkdown = (markdown) => {
  const text = String(markdown || "");
  const frontmatterTitle = text.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const headingTitle = text.match(/^#\s+(.+?)\s*$/m)?.[1];
  return normalizeText(headingTitle || frontmatterTitle);
};

const readingListPaperTopicText = (paper = {}) => normalizeText([
  paper.title,
  paper.summary,
  paper.analysis?.tldr,
  paper.analysis?.problem,
  paper.analysis?.method,
  paper.analysis?.technicalDetails,
  paper.analysis?.networkUseCase,
  paper.readingListReview?.tldr,
  paper.readingListReview?.valueHighlight,
  paper.readingListReview?.reviewReason
].filter(Boolean).join(" "));

const readingListTitleTopicHints = (papers = [], limit = 4) => {
  const scores = new Map();

  papers.forEach((paper, index) => {
    const text = readingListPaperTopicText(paper);
    const weight = index < 3 ? 2 : 1;

    readingListSpecificTitleTopics.forEach((topic) => {
      if (topic.patterns.some((pattern) => pattern.test(text))) {
        scores.set(topic.label, (scores.get(topic.label) || 0) + weight);
      }
    });
  });

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
    .slice(0, limit)
    .map(([label]) => label);
};

const readingListTitleHasSpecificTopic = (suffix, topicHints = []) => {
  const text = normalizeText(suffix);
  return topicHints.some((topic) => text.includes(topic));
};

const isGenericReadingListTitleSuffix = (suffix, topicHints = []) => {
  const text = normalizeText(suffix);

  if (Array.from(text).length < 10) {
    return true;
  }

  if (readingListTitleHasSpecificTopic(text, topicHints)) {
    return false;
  }

  const broadTermCount = readingListBroadTitleTerms.filter((term) => text.includes(term)).length;
  return readingListGenericTitlePattern.test(text) || broadTermCount >= 2;
};

const fallbackReadingListTitleSuffix = (papers = [], description = "") => {
  const topicHints = readingListTitleTopicHints(papers, 3);

  if (topicHints.length >= 2) {
    return `${topicHints[0]}与${topicHints[1]}构成本周主线`;
  }

  if (topicHints.length === 1) {
    return `${topicHints[0]}成为本周最具体信号`;
  }

  const descriptionText = normalizeText(description)
    .replace(/^本周观点[:：]\s*/, "")
    .replace(/[。！？.!?]+$/g, "");

  if (descriptionText && !isGenericReadingListTitleSuffix(descriptionText, [])) {
    return descriptionText;
  }

  return "可验证系统证据成为本周筛选主线";
};

const normalizeReadingListTitle = (value, titleBase, { description = "", papers = [] } = {}) => {
  const topicHints = readingListTitleTopicHints(papers);
  const raw = normalizeText(value).replace(/^#\s*/, "");
  const withoutOldPrefix = raw.replace(/^【精选论文】\d{2,4}年\d{1,2}月第\d{1,2}[周月](?:精选论文)?阅读清单[:：]\s*/, "")
    .replace(/^【精选论文】\d{2,4}年\d{1,2}月第\d{1,2}[周月][:：]\s*/, "");
  const candidate = raw.startsWith(titleBase)
    ? raw.slice(titleBase.length)
    : withoutOldPrefix;
  const fallback = normalizeText(description).replace(/^本周观点[:：]\s*/, "");
  const suffix = normalizeText(candidate || fallback)
    .replace(/精选论文阅读清单/g, "")
    .replace(/[。！？.!?]+$/g, "")
    .trim();
  const concreteSuffix = isGenericReadingListTitleSuffix(suffix, topicHints)
    ? fallbackReadingListTitleSuffix(papers, fallback)
    : suffix;
  const compactSuffix = Array.from(concreteSuffix || fallbackReadingListTitleSuffix(papers, fallback)).slice(0, readingListTitleSuffixMaxChars).join("");

  return `${titleBase}${compactSuffix}`;
};

const ensureReadingListFooter = (markdown) => {
  const footerLikePattern = new RegExp(`\\n*(?:>\\s*)?${escapeRegExp(readingListFooterNote)}\\s*$`);
  const partialFooterPattern = /\n*(?:>\s*)?本文由论文推荐\s*Agent\s*生成[\s\S]{0,240}$/;
  const withoutExactFooter = String(markdown || "").replace(footerLikePattern, "").replace(partialFooterPattern, "").replace(/\s+$/g, "");

  return `${withoutExactFooter}\n\n${readingListFooterNote}`;
};

const ensureReadingListMarkdownFormat = (markdown, titleBase, { papers = [] } = {}) => {
  let next = String(markdown || "").replace(/^```(?:markdown)?\s*|\s*```$/g, "").trim();
  const description = normalizeText(next.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1] || "");
  const title = normalizeReadingListTitle(readingListTitleFromMarkdown(next), titleBase, { description, papers });
  const escapedTitle = title.replace(/"/g, '\\"');

  if (/^---\s*[\s\S]*?\n---/.test(next)) {
    if (/^title:\s*.+$/m.test(next)) {
      next = next.replace(/(^title:\s*).+$/m, `$1"${escapedTitle}"`);
    } else {
      next = next.replace(/^---\s*/, `---\ntitle: "${escapedTitle}"\n`);
    }
  }

  if (/^#\s+.+$/m.test(next)) {
    next = next.replace(/^#\s+.+$/m, `# ${title}`);
  } else if (/^---\s*[\s\S]*?\n---/.test(next)) {
    next = next.replace(/^(---\s*[\s\S]*?\n---)/, `$1\n\n# ${title}`);
  } else {
    next = `# ${title}\n\n${next}`;
  }

  next = next.replace(/^>\s*本周观点：.*\n+/m, "");
  next = ensureReadingListFooter(next);

  return { markdown: next, title };
};

const ensureLlmResponseWithinLimit = (value) => {
  const text = String(value || "").trim();

  if (text.length > llmResponseMaxChars) {
    const error = new Error(`LLM response is too large: ${text.length} chars, limit ${llmResponseMaxChars}.`);
    error.code = "LLM_RESPONSE_TOO_LARGE";
    throw error;
  }

  return text;
};

const escapeXml = (value) => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

const redactSensitive = (value) => String(value || "")
  .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-api-key]")
  .replace(/Your api key:\s*[^",}]+/gi, "Your api key: [redacted]");

const readResponseReturnValue = async (source, fetchResponse, bodyLength = 900) => {
  let body = "";

  try {
    body = await fetchResponse.text();
  } catch (error) {
    body = `无法读取返回体：${error.message}`;
  }

  return {
    source,
    url: fetchResponse.url,
    status: fetchResponse.status,
    statusText: fetchResponse.statusText || "",
    retryAfter: fetchResponse.headers.get("retry-after") || "",
    contentType: fetchResponse.headers.get("content-type") || "",
    body: truncate(redactSensitive(body), bodyLength)
  };
};

const describeResponseReturnValue = (value) => {
  if (!value) {
    return "";
  }

  const status = [value.status, value.statusText].filter(Boolean).join(" ");
  const parts = [
    `${value.source || "数据源"} 返回 ${status || "未知状态"}`,
    value.retryAfter ? `Retry-After=${value.retryAfter}` : "",
    value.contentType ? `Content-Type=${value.contentType}` : "",
    value.body ? `Body=${value.body}` : ""
  ].filter(Boolean);

  return parts.join("，");
};

const responseReturnHeader = (value) => {
  const text = truncate(describeResponseReturnValue(value), 900);
  return text ? encodeURIComponent(text) : "";
};

const responseSourceError = (source, returnValue) => {
  const error = new Error(describeResponseReturnValue(returnValue) || `${source} 暂时不可用`);
  error.status = returnValue?.status && returnValue.status < 500 ? returnValue.status : 502;
  error.returnValue = returnValue;
  error.sourceReturns = [returnValue];
  error.detail = error.message;
  return error;
};

const formatArxivDate = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes())
  ].join("");
};

const arxivSubmittedDateWindow = (days) => {
  const end = new Date();
  end.setUTCHours(23, 59, 0, 0);

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  start.setUTCHours(0, 0, 0, 0);

  return {
    start,
    end
  };
};

const arxivCacheKey = (value) => createHash("sha256").update(String(value)).digest("hex");

const arxivCachePath = (key) => join(arxivCacheDir, `${key}.json`);

const paperOriginalTextCachePath = (key) => join(paperOriginalTextCacheDir, `${key}.json`);

const emptyArxivSyncHistory = () => ({
  version: 1,
  updatedAt: "",
  records: []
});

const normalizeArxivSyncHistoryEntry = (entry = {}) => {
  const startedAt = String(entry.startedAt || entry.finishedAt || new Date().toISOString());
  const finishedAt = String(entry.finishedAt || startedAt);
  const durationMs = Math.max(0, Math.round(Number(entry.durationMs) || 0));
  const status = ["success", "skipped", "failed"].includes(entry.status) ? entry.status : "success";
  const error = entry.error
    ? {
        code: truncate(entry.error.code, 80),
        message: truncate(entry.error.message, 500),
        detail: truncate(entry.error.detail, 800)
      }
    : null;

  return {
    id: truncate(entry.id || arxivCacheKey(`${startedAt}:${finishedAt}:${entry.trigger || ""}:${status}`).slice(0, 16), 40),
    startedAt,
    finishedAt,
    durationMs,
    status,
    trigger: truncate(entry.trigger || "unknown", 80),
    force: Boolean(entry.force),
    requestId: truncate(entry.requestId, 80),
    categories: Array.isArray(entry.categories) ? entry.categories.filter(Boolean).map(String).slice(0, 50) : [],
    fetched: Math.max(0, Number(entry.fetched) || 0),
    added: Math.max(0, Number(entry.added) || 0),
    updated: Math.max(0, Number(entry.updated) || 0),
    total: Math.max(0, Number(entry.total) || 0),
    message: truncate(entry.message, 500),
    error
  };
};

const normalizePaperKey = (value) => String(value || "")
  .toLowerCase()
  .replace(/^https?:\/\/(dx\.)?doi\.org\//, "doi:")
  .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//, "arxiv:")
  .replace(/\.pdf$/, "")
  .replace(/[?#].*$/, "")
  .trim();

const paperDuplicateKeys = (paper) => [
  normalizePaperKey(paper.id),
  normalizePaperKey(paper.absLink),
  normalizePaperKey(paper.link),
  normalizePaperKey(paper.title)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
].filter(Boolean);

const appendUniquePapers = (target, seen, papers, maxResults) => {
  for (const paper of papers) {
    const keys = paperDuplicateKeys(paper);

    if (!keys.length || keys.some((key) => seen.has(key))) {
      continue;
    }

    keys.forEach((key) => seen.add(key));
    target.push(paper);

    if (target.length >= maxResults) {
      break;
    }
  }
};

const arxivPaperRawId = (paper) => {
  const value = [
    paper?.absLink,
    paper?.id,
    paper?.link
  ].map((item) => String(item || "")).filter(Boolean).join(" ");
  const match = value.match(/(?:arxiv\.org\/abs\/|arxiv:|oai:arXiv\.org:)?([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i);
  return match ? match[1] : "";
};

const arxivPaperId = (paper) => {
  const value = [
    paper?.absLink,
    paper?.id,
    paper?.link
  ].map((item) => String(item || "")).find(Boolean) || "";
  const rawId = arxivPaperRawId(paper);
  return rawId ? rawId.replace(/v\d+$/i, "") : normalizePaperKey(value);
};

const normalizeStoredArxivPaper = (paper) => {
  const id = arxivPaperId(paper);
  const absLink = String(paper.absLink || paper.id || (id ? `https://arxiv.org/abs/${id}` : "")).replace(/^oai:arXiv\.org:/i, "https://arxiv.org/abs/");
  const categories = Array.isArray(paper.categories) ? paper.categories.filter(Boolean).map(String) : [];

  return {
    id: absLink || String(paper.id || ""),
    arxivId: id,
    title: truncate(paper.title, 500),
    authors: Array.isArray(paper.authors) ? paper.authors.slice(0, 30).map((author) => String(author)) : [],
    summary: truncate(paper.summary, 5000),
    published: String(paper.published || paper.updated || ""),
    updated: String(paper.updated || paper.published || ""),
    link: absLink,
    absLink,
    primaryCategory: String(paper.primaryCategory || categories[0] || "arXiv"),
    categories: [...new Set(categories.length ? categories : ["arXiv"])].slice(0, 20),
    storedAt: String(paper.storedAt || new Date().toISOString())
  };
};

const emptyArxivPaperLibrary = () => ({
  version: 1,
  lastSyncedAt: "",
  lastSyncCount: 0,
  lastSyncAdded: 0,
  categories: arxivRssCategories,
  papers: []
});

const readArxivPaperLibrary = async () => {
  if (arxivPaperLibraryMemory) {
    return arxivPaperLibraryMemory;
  }

  try {
    const parsed = JSON.parse(await readFile(arxivPaperLibraryPath, "utf8"));
    arxivPaperLibraryMemory = {
      ...emptyArxivPaperLibrary(),
      ...parsed,
      papers: Array.isArray(parsed.papers)
        ? parsed.papers.map(normalizeStoredArxivPaper).filter((paper) => paper.id && paper.title)
        : []
    };
  } catch {
    arxivPaperLibraryMemory = emptyArxivPaperLibrary();
  }

  return arxivPaperLibraryMemory;
};

const writeArxivPaperLibrary = async (library) => {
  const nextLibrary = {
    ...emptyArxivPaperLibrary(),
    ...library,
    categories: arxivRssCategories,
    papers: Array.isArray(library.papers)
      ? library.papers.map(normalizeStoredArxivPaper).filter((paper) => paper.id && paper.title)
      : []
  };

  arxivPaperLibraryMemory = nextLibrary;
  await mkdir(join(__dirname, ".cache"), { recursive: true });
  await writeFile(arxivPaperLibraryPath, JSON.stringify(nextLibrary, null, 2), "utf8");
  return nextLibrary;
};

const readArxivSyncHistory = async () => {
  if (arxivSyncHistoryMemory) {
    return arxivSyncHistoryMemory;
  }

  try {
    const parsed = JSON.parse(await readFile(arxivSyncHistoryPath, "utf8"));
    arxivSyncHistoryMemory = {
      ...emptyArxivSyncHistory(),
      ...parsed,
      records: Array.isArray(parsed.records)
        ? parsed.records.map(normalizeArxivSyncHistoryEntry).filter((entry) => entry.startedAt)
        : []
    };
  } catch {
    arxivSyncHistoryMemory = emptyArxivSyncHistory();
  }

  return arxivSyncHistoryMemory;
};

const writeArxivSyncHistory = async (history) => {
  const nextHistory = {
    ...emptyArxivSyncHistory(),
    ...history,
    updatedAt: new Date().toISOString(),
    records: Array.isArray(history.records)
      ? history.records.map(normalizeArxivSyncHistoryEntry).filter((entry) => entry.startedAt).slice(0, arxivSyncHistoryLimit)
      : []
  };

  arxivSyncHistoryMemory = nextHistory;
  await mkdir(join(__dirname, ".cache"), { recursive: true });
  await writeFile(arxivSyncHistoryPath, JSON.stringify(nextHistory, null, 2), "utf8");
  return nextHistory;
};

const appendArxivSyncHistory = async (entry) => {
  const history = await readArxivSyncHistory();
  const normalized = normalizeArxivSyncHistoryEntry(entry);
  await writeArxivSyncHistory({
    ...history,
    records: [normalized, ...history.records]
  });
  return normalized;
};

const safeAppendArxivSyncHistory = async (entry) => {
  try {
    return await appendArxivSyncHistory(entry);
  } catch (error) {
    console.warn(`Could not write arXiv sync history: ${error.message}`);
    return null;
  }
};

const mergeArxivPapersIntoLibrary = async (papers, meta = {}) => {
  const library = await readArxivPaperLibrary();
  const byKey = new Map();

  for (const paper of library.papers) {
    const normalized = normalizeStoredArxivPaper(paper);
    byKey.set(arxivPaperId(normalized) || normalizePaperKey(normalized.title), normalized);
  }

  let added = 0;
  let updated = 0;

  for (const paper of papers) {
    const normalized = normalizeStoredArxivPaper(paper);
    const key = arxivPaperId(normalized) || normalizePaperKey(normalized.title);

    if (!key) {
      continue;
    }

    if (byKey.has(key)) {
      const existing = byKey.get(key);

      const hasChanges = (
        existing.title !== normalized.title ||
        existing.summary !== normalized.summary ||
        existing.published !== normalized.published ||
        existing.updated !== normalized.updated ||
        JSON.stringify(existing.authors) !== JSON.stringify(normalized.authors)
      );

      const merged = {
        ...existing,
        ...normalized,
        storedAt: existing.storedAt || normalized.storedAt
      };

      byKey.set(key, merged);

      if (hasChanges) {
        updated += 1;
      }
    } else {
      byKey.set(key, normalized);
      added += 1;
    }
  }

  const merged = [...byKey.values()]
    .sort((a, b) => new Date(b.published || b.updated).getTime() - new Date(a.published || a.updated).getTime());

  const nextLibrary = await writeArxivPaperLibrary({
    ...library,
    lastSyncedAt: meta.updateLastSynced === false ? library.lastSyncedAt : meta.syncedAt || new Date().toISOString(),
    lastSyncCount: papers.length,
    lastSyncAdded: added,
    papers: merged
  });

  return {
    library: nextLibrary,
    added,
    updated,
    total: nextLibrary.papers.length,
    fetched: papers.length
  };
};

const readArxivCache = async (key) => {
  const memoryEntry = arxivMemoryCache.get(key);

  if (memoryEntry) {
    return memoryEntry;
  }

  try {
    const entry = JSON.parse(await readFile(arxivCachePath(key), "utf8"));

    if (entry?.xml && Number.isFinite(Number(entry.fetchedAt))) {
      arxivMemoryCache.set(key, entry);
      return entry;
    }
  } catch {
    return null;
  }

  return null;
};

const writeArxivCache = async (key, entry) => {
  arxivMemoryCache.set(key, entry);

  try {
    await mkdir(arxivCacheDir, { recursive: true });
    await writeFile(arxivCachePath(key), JSON.stringify(entry), "utf8");
  } catch (error) {
    console.warn(`Could not write arXiv cache: ${error.message}`);
  }
};

const arxivCacheAgeSeconds = (entry) => Math.max(0, Math.round((Date.now() - Number(entry.fetchedAt)) / 1000));

const paperOriginalTextCacheAgeMs = (entry) => Math.max(0, Date.now() - Number(entry?.fetchedAt || 0));

const paperOriginalTextResult = (entry, maxChars) => ({
  status: "available",
  source: entry.source || "arxiv-html",
  url: entry.url || "",
  fetchedAt: entry.fetchedAt ? new Date(entry.fetchedAt).toISOString() : "",
  chars: Math.max(0, Number(entry.textChars) || String(entry.text || "").length),
  excerpt: paperOriginalTextExcerpt(entry.text, maxChars)
});

const readPaperOriginalTextCache = async (key, maxChars) => {
  const memoryEntry = paperOriginalTextMemoryCache.get(key);

  if (memoryEntry && paperOriginalTextCacheAgeMs(memoryEntry) < paperOriginalTextCacheTtlMs) {
    return paperOriginalTextResult(memoryEntry, maxChars);
  }

  try {
    const entry = JSON.parse(await readFile(paperOriginalTextCachePath(key), "utf8"));

    if (entry?.text && Number.isFinite(Number(entry.fetchedAt)) && paperOriginalTextCacheAgeMs(entry) < paperOriginalTextCacheTtlMs) {
      paperOriginalTextMemoryCache.set(key, entry);
      return paperOriginalTextResult(entry, maxChars);
    }
  } catch {
    return null;
  }

  return null;
};

const writePaperOriginalTextCache = async (key, entry) => {
  paperOriginalTextMemoryCache.set(key, entry);

  try {
    await mkdir(paperOriginalTextCacheDir, { recursive: true });
    await writeFile(paperOriginalTextCachePath(key), JSON.stringify(entry), "utf8");
  } catch (error) {
    console.warn(`Could not write paper original text cache: ${error.message}`);
  }
};

const unavailablePaperOriginalText = (message) => ({
  status: "unavailable",
  source: "",
  url: "",
  fetchedAt: "",
  chars: 0,
  excerpt: "",
  message: truncate(message, 240)
});

const fetchPaperOriginalText = async (paper, maxChars) => {
  const rawId = arxivPaperRawId(paper);
  const arxivId = rawId.replace(/v\d+$/i, "");

  if (!arxivId || !/^\d{4}\.\d{4,5}$/i.test(arxivId)) {
    return unavailablePaperOriginalText("未找到可用于抓取原文的 arXiv ID。");
  }

  const cacheKey = arxivCacheKey(`paper-original-text:${arxivId}`);
  const cached = await readPaperOriginalTextCache(cacheKey, maxChars);

  if (cached) {
    return { ...cached, cached: true };
  }

  if (paperOriginalTextInflight.has(cacheKey)) {
    try {
      const entry = await paperOriginalTextInflight.get(cacheKey);
      return paperOriginalTextResult(entry, maxChars);
    } catch (error) {
      return unavailablePaperOriginalText(error.name === "AbortError"
        ? "抓取 arXiv HTML 原文超时。"
        : error.message);
    }
  }

  const run = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), paperOriginalTextFetchTimeoutMs);
    const htmlId = rawId || arxivId;
    const url = `https://arxiv.org/html/${encodeURIComponent(htmlId)}`;

    try {
      const response = await fetchArxivQueued(url, controller.signal, "text/html, application/xhtml+xml;q=0.9, */*;q=0.8");

      if (!response.ok) {
        throw new Error(`arXiv HTML 返回 ${response.status} ${response.statusText || ""}`.trim());
      }

      const html = await response.text();
      const text = stripHtmlToText(html);

      if (text.length < 800) {
        throw new Error("arXiv HTML 原文内容过短，可能尚未生成 HTML 版本。");
      }

      const storedText = text.length > paperOriginalTextStoredMaxChars
        ? `${text.slice(0, paperOriginalTextStoredMaxChars)}...`
        : text;
      const entry = {
        version: 1,
        source: "arxiv-html",
        url,
        fetchedAt: Date.now(),
        textChars: text.length,
        text: storedText
      };
      await writePaperOriginalTextCache(cacheKey, entry);
      return entry;
    } finally {
      clearTimeout(timeout);
    }
  };

  const request = run().finally(() => {
    paperOriginalTextInflight.delete(cacheKey);
  });
  paperOriginalTextInflight.set(cacheKey, request);

  try {
    const entry = await request;
    return paperOriginalTextResult(entry, maxChars);
  } catch (error) {
    return unavailablePaperOriginalText(error.name === "AbortError"
      ? "抓取 arXiv HTML 原文超时。"
      : error.message);
  }
};

const readingListStatusTitle = (paper, index) => truncate(paper?.title || `论文 ${index + 1}`, 120);

const originalTextProgressSummary = (items) => ({
  total: items.length,
  pending: items.filter((item) => item.state === "pending").length,
  running: items.filter((item) => item.state === "running").length,
  available: items.filter((item) => item.state === "available").length,
  unavailable: items.filter((item) => item.state === "unavailable").length
});

const publishOriginalTextProgress = (requestId, items, message, stage = "original-text") => {
  if (!requestId) {
    return;
  }

  const summary = originalTextProgressSummary(items);
  const running = items.find((item) => item.state === "running");

  setPaperRequestStatus(requestId, "reading-list", message, "running", {
    stage,
    currentIndex: running ? running.index : -1,
    currentTitle: running ? running.title : "",
    originalTextSummary: summary,
    originalTextItems: items.map((item) => ({
      index: item.index,
      title: item.title,
      state: item.state,
      source: item.source || "",
      chars: Math.max(0, Number(item.chars) || 0),
      cached: Boolean(item.cached),
      message: truncate(item.message, 220)
    }))
  });
};

const enrichPapersWithOriginalText = async (
  papers,
  {
    requestId = "",
    nextStage = "generate",
    nextActionMessage = "正在提交给模型生成周报"
  } = {}
) => {
  const perPaperBudget = Math.max(
    2500,
    Math.min(paperOriginalTextMaxChars, Math.floor(paperOriginalTextTotalMaxChars / Math.max(1, papers.length)))
  );
  const results = new Array(papers.length);
  const progressItems = papers.map((paper, index) => ({
    index,
    title: readingListStatusTitle(paper, index),
    state: "pending",
    source: "",
    chars: 0,
    cached: false,
    message: "等待抓取"
  }));
  let cursor = 0;

  publishOriginalTextProgress(requestId, progressItems, `准备抓取 ${papers.length} 篇论文的 arXiv HTML 原文。`);

  const worker = async () => {
    while (cursor < papers.length) {
      const index = cursor;
      cursor += 1;
      const paper = papers[index];
      const item = progressItems[index];
      item.state = "running";
      item.message = "正在连接 arXiv HTML 原文";
      publishOriginalTextProgress(requestId, progressItems, `正在抓取第 ${index + 1}/${papers.length} 篇：${item.title}`);

      const originalText = await fetchPaperOriginalText(paper, perPaperBudget);

      item.state = originalText.status === "available" ? "available" : "unavailable";
      item.source = originalText.source || "";
      item.chars = originalText.chars || 0;
      item.cached = Boolean(originalText.cached);
      item.message = originalText.status === "available"
        ? `${originalText.cached ? "命中缓存" : "已获取"} ${originalText.source || "原文"}，约 ${originalText.chars || 0} 字符`
        : `已跳过：${originalText.message || "未获取到可用原文"}`;
      results[index] = {
        ...paper,
        originalText
      };
      publishOriginalTextProgress(requestId, progressItems, `${item.state === "available" ? "已获取原文" : "已跳过原文不可用论文"}：${item.title}`);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(paperOriginalTextConcurrency, papers.length) }, worker)
  );

  const availablePapers = results.filter((paper) => paper.originalText?.status === "available");
  const skippedPapers = results.filter((paper) => paper.originalText?.status !== "available");
  const fullTextCount = availablePapers.length;
  publishOriginalTextProgress(
    requestId,
    progressItems,
    `原文抓取完成：成功 ${fullTextCount} 篇，已跳过 ${skippedPapers.length} 篇原文不可用论文，${nextActionMessage}。`,
    nextStage
  );

  return {
    papers: availablePapers,
    allPapers: results,
    skippedPapers: skippedPapers.map((paper) => ({
      id: paper.id,
      title: paper.title,
      message: paper.originalText?.message || "未获取到可用原文"
    })),
    fullTextCount,
    unavailableCount: skippedPapers.length,
    perPaperBudget
  };
};

const atomEntryCount = (xml) => (String(xml || "").match(/<entry\b/gi) || []).length;

const readArxivCooldown = async () => {
  if (arxivCooldownLoaded) {
    return arxivBlockedUntil;
  }

  arxivCooldownLoaded = true;

  try {
    const entry = JSON.parse(await readFile(arxivCooldownPath, "utf8"));
    const blockedUntil = Number(entry.blockedUntil);
    const updatedAt = Number(entry.updatedAt);
    const recentlyLimited = Number.isFinite(updatedAt) && Date.now() - updatedAt < arxivMaxCooldownMs;
    arxivCooldownFailures = recentlyLimited ? Math.max(0, Number(entry.failures) || 0) : 0;
    const inferredBlockedUntil = recentlyLimited
      ? updatedAt + Math.min(arxivCooldownMs * (2 ** Math.min(arxivCooldownFailures, 3)), arxivMaxCooldownMs)
      : 0;
    const effectiveBlockedUntil = Math.max(Number.isFinite(blockedUntil) ? blockedUntil : 0, inferredBlockedUntil);

    if (effectiveBlockedUntil > Date.now()) {
      arxivBlockedUntil = Math.max(arxivBlockedUntil, effectiveBlockedUntil);
    }
  } catch {
    // Missing cooldown file just means arXiv has not rate-limited this app recently.
  }

  return arxivBlockedUntil;
};

const nextArxiv429Cooldown = (retryAfterMs) => {
  if (retryAfterMs > 0) {
    return Math.min(retryAfterMs, arxivMaxCooldownMs);
  }

  const multiplier = 2 ** Math.min(arxivCooldownFailures, 3);
  return Math.min(arxivCooldownMs * multiplier, arxivMaxCooldownMs);
};

const writeArxivCooldown = async (blockedUntil, returnValue) => {
  arxivBlockedUntil = Math.max(arxivBlockedUntil, blockedUntil);
  arxivCooldownFailures = Math.min(arxivCooldownFailures + 1, 8);

  try {
    await mkdir(join(__dirname, ".cache"), { recursive: true });
    await writeFile(arxivCooldownPath, JSON.stringify({
      blockedUntil: arxivBlockedUntil,
      updatedAt: Date.now(),
      failures: arxivCooldownFailures,
      returnValue
    }), "utf8");
  } catch (error) {
    console.warn(`Could not write arXiv cooldown: ${error.message}`);
  }
};

const clearArxivCooldown = async () => {
  arxivBlockedUntil = 0;
  arxivCooldownFailures = 0;

  try {
    await rm(arxivCooldownPath, { force: true });
  } catch (error) {
    console.warn(`Could not clear arXiv cooldown: ${error.message}`);
  }
};

const setPaperRequestStatus = (requestId, source, message, state = "running", extra = {}) => {
  if (!requestId) {
    return;
  }

  paperRequestStatuses.set(requestId, {
    source,
    message,
    state,
    updatedAt: Date.now(),
    ...extra
  });
};

const cleanupPaperRequestStatuses = () => {
  const cutoff = Date.now() - 10 * 60 * 1000;

  for (const [key, value] of paperRequestStatuses) {
    if (Number(value.updatedAt) < cutoff) {
      paperRequestStatuses.delete(key);
    }
  }
};

const normalizeIsoDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const atomFeedFromPapers = ({ papers, query, source }) => {
  const updated = new Date().toISOString();
  const entries = papers.map((paper) => {
    const categories = Array.isArray(paper.categories) && paper.categories.length ? paper.categories : [source];
    const primaryCategory = paper.primaryCategory || categories[0] || source;
    const authors = Array.isArray(paper.authors) && paper.authors.length ? paper.authors : ["Unknown authors"];
    const links = [
      `<link href="${escapeXml(paper.absLink || paper.id)}" rel="alternate" type="text/html"/>`
    ];

    if (paper.link) {
      links.push(`<link title="pdf" href="${escapeXml(paper.link)}" rel="related" type="application/pdf"/>`);
    }

    return [
      "<entry>",
      `<id>${escapeXml(paper.id)}</id>`,
      `<updated>${escapeXml(normalizeIsoDate(paper.updated || paper.published))}</updated>`,
      `<published>${escapeXml(normalizeIsoDate(paper.published || paper.updated))}</published>`,
      `<title>${escapeXml(paper.title)}</title>`,
      `<summary>${escapeXml(paper.summary)}</summary>`,
      ...authors.slice(0, 12).map((author) => `<author><name>${escapeXml(author)}</name></author>`),
      ...links,
      `<arxiv:primary_category term="${escapeXml(primaryCategory)}" scheme="http://arxiv.org/schemas/atom"/>`,
      ...categories.slice(0, 12).map((category) => `<category term="${escapeXml(category)}" scheme="${escapeXml(source)}"/>`),
      "</entry>"
    ].join("");
  }).join("");

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<feed xmlns=\"http://www.w3.org/2005/Atom\" xmlns:arxiv=\"http://arxiv.org/schemas/atom\">",
    `<id>paper-insight:${escapeXml(source)}:${escapeXml(query)}</id>`,
    `<title>Paper Insight ${escapeXml(source)} results</title>`,
    `<updated>${updated}</updated>`,
    entries,
    "</feed>"
  ].join("");
};

const parseRetryAfter = (value) => {
  if (!value) {
    return 0;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : 0;
};

const fetchArxivQueued = async (arxivUrl, signal, accept = "application/atom+xml, application/xml;q=0.9, */*;q=0.8") => {
  const run = async () => {
    const waitMs = Math.max(0, arxivMinIntervalMs - (Date.now() - arxivLastRequestAt));

    if (waitMs) {
      await sleep(waitMs);
    }

    arxivLastRequestAt = Date.now();
    return fetch(arxivUrl, {
      signal,
      headers: {
        accept,
        "user-agent": "paper-insight/0.1 (local research discovery app; contact: local-user)"
      }
    });
  };

  const request = arxivQueue.then(run, run);
  arxivQueue = request.catch(() => {});
  return request;
};

const decodeXml = (value) => String(value || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
  .replace(/&quot;/g, "\"")
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&");

const decodeHtml = (value) => decodeXml(value)
  .replace(/&nbsp;/gi, " ")
  .replace(/&ndash;/gi, "-")
  .replace(/&mdash;/gi, "-")
  .replace(/&lsquo;|&rsquo;/gi, "'")
  .replace(/&ldquo;|&rdquo;/gi, "\"")
  .replace(/&[a-z][a-z0-9]+;/gi, " ");

const stripHtmlToText = (html) => decodeHtml(String(html || "")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
  .replace(/<header[\s\S]*?<\/header>/gi, " ")
  .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
  .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, " ")
  .replace(/<(?:h[1-6]|title)[^>]*>/gi, "\n\n")
  .replace(/<\/(?:h[1-6]|title)>/gi, "\n\n")
  .replace(/<\/(?:p|li|section|article|div|tr)>/gi, "\n\n")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]+>/g, " "))
  .replace(/\u00a0/g, " ")
  .replace(/[ \t]+/g, " ")
  .replace(/\n[ \t]+/g, "\n")
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const paperOriginalTextExcerpt = (text, maxChars = paperOriginalTextMaxChars) => {
  const budget = Math.max(1200, Number(maxChars) || paperOriginalTextMaxChars);
  const clean = String(text || "")
    .replace(/\n\s*(references|bibliography)\s*\n[\s\S]*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (clean.length <= budget) {
    return clean;
  }

  const paragraphs = clean
    .split(/\n{2,}/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 40);
  const selected = new Map();
  let used = 0;
  const addParagraph = (index) => {
    if (index < 0 || index >= paragraphs.length || selected.has(index)) {
      return;
    }

    const paragraph = paragraphs[index];
    if (used + paragraph.length > budget && selected.size > 0) {
      return;
    }

    selected.set(index, paragraph);
    used += paragraph.length + 2;
  };

  for (let index = 0; index < paragraphs.length && used < budget * 0.35; index += 1) {
    addParagraph(index);
  }

  const sectionKeywords = [
    "abstract",
    "introduction",
    "affiliation",
    "affiliations",
    "institution",
    "university",
    "institute",
    "department",
    "author",
    "email",
    "method",
    "approach",
    "framework",
    "architecture",
    "system",
    "design",
    "model",
    "agent",
    "experiment",
    "evaluation",
    "benchmark",
    "dataset",
    "result",
    "ablation",
    "discussion",
    "limitation",
    "acknowledg",
    "conclusion"
  ];
  const scored = paragraphs
    .map((paragraph, index) => {
      const lower = paragraph.toLowerCase();
      const keywordScore = sectionKeywords.reduce((score, keyword) => score + (lower.includes(keyword) ? 1 : 0), 0);
      const headingScore = paragraph.length < 160 && /^[0-9ivx. ]*[a-z][a-z0-9 ,:()/&-]+$/i.test(paragraph) ? 1 : 0;
      return { index, score: keywordScore * 2 + headingScore };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  for (const item of scored) {
    if (used >= budget) {
      break;
    }

    addParagraph(item.index);
    addParagraph(item.index + 1);
  }

  const excerpt = [...selected.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, paragraph]) => paragraph)
    .join("\n\n");
  return excerpt.length > budget ? `${excerpt.slice(0, budget)}...` : excerpt;
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const xmlTagText = (xml, tagName) => {
  const tag = escapeRegExp(tagName);
  const match = String(xml || "").match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(match?.[1] || "").replace(/\s+/g, " ").trim();
};

const xmlAttribute = (tagXml, name) => {
  const match = String(tagXml || "").match(new RegExp(`${escapeRegExp(name)}\\s*=\\s*["']([^"']+)["']`, "i"));
  return decodeXml(match?.[1] || "").trim();
};

const queryTermGroups = (query) => {
  const extractTerms = (segment) => tokenizeQuery(segment)
    .map((token) => token.trim())
    .filter((token) => token && !["(", ")"].includes(token) && !/^(AND|OR|ANDNOT)$/i.test(token))
    .map((token) => token.replace(/^"|"$/g, "").replace(/^[a-zA-Z]+:/, "").trim())
    .filter((token) => token && !/^submittedDate$/i.test(token) && !/^\[|\]$/.test(token));

  const parenthesized = [...String(query || defaultQuery).matchAll(/\(([^()]+)\)/g)]
    .map((match) => extractTerms(match[1]))
    .filter((terms) => terms.length);

  if (parenthesized.length) {
    return parenthesized;
  }

  const terms = extractTerms(query || defaultQuery);
  return terms.length ? [terms] : [];
};

const textIncludesTerm = (text, term) => {
  const normalizedTerm = String(term || "").trim().toLowerCase();

  if (!normalizedTerm) {
    return false;
  }

  if (normalizedTerm.length <= 3 || /^[a-z0-9.+-]+$/i.test(normalizedTerm)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}([^a-z0-9]|$)`, "i").test(text);
  }

  return text.includes(normalizedTerm);
};

const paperSearchText = (paper) => [
  paper.title,
  paper.summary,
  paper.primaryCategory,
  ...(Array.isArray(paper.categories) ? paper.categories : [])
].join(" ").toLowerCase();

const paperQueryGroupHits = (paper, groups) => {
  const searchable = paperSearchText(paper);
  return groups.map((group) => group.filter((term) => textIncludesTerm(searchable, term)).length);
};

const paperMatchesQueryGroups = (paper, groups) => {
  if (!groups.length) {
    return true;
  }

  return paperQueryGroupHits(paper, groups).every((hitCount) => hitCount > 0);
};

const paperQueryRelevance = (paper, groups) => {
  if (!groups.length) {
    return { matchedGroups: 0, matchedTerms: 0, score: 0 };
  }

  const hits = paperQueryGroupHits(paper, groups);
  const matchedGroups = hits.filter((hitCount) => hitCount > 0).length;
  const matchedTerms = hits.reduce((total, hitCount) => total + hitCount, 0);

  return {
    matchedGroups,
    matchedTerms,
    score: matchedGroups * 100 + matchedTerms
  };
};

const aiQueryGroupIndex = (groups) => groups.findIndex((group) => group.some((term) => {
  const value = String(term || "").toLowerCase();
  return value === "ai"
    || value === "llm"
    || value.includes("machine learning")
    || value.includes("deep learning")
    || value.includes("large language model")
    || value.includes("foundation model");
}));

const parseArxivRssPapers = (xml) => [...String(xml || "").matchAll(/<entry\b[\s\S]*?<\/entry>/gi)]
  .map((match) => {
    const entry = match[0];
    const rawId = xmlTagText(entry, "id");
    const arxivId = rawId.replace(/^oai:arXiv\.org:/i, "");
    const linkTags = [...entry.matchAll(/<link\b[^>]*\/?>/gi)].map((item) => item[0]);
    const alternate = linkTags.find((item) => /rel=["']alternate["']/i.test(item)) || linkTags[0] || "";
    const absLink = xmlAttribute(alternate, "href") || (arxivId ? `https://arxiv.org/abs/${arxivId}` : rawId);
    const categories = [...entry.matchAll(/<category\b[^>]*\bterm=["']([^"']+)["'][^>]*\/?>/gi)]
      .map((item) => decodeXml(item[1]).trim())
      .filter(Boolean);
    const creatorAuthors = xmlTagText(entry, "dc:creator")
      .split(/\s*,\s*/)
      .map((author) => author.trim())
      .filter(Boolean);
    const atomAuthors = [...entry.matchAll(/<author\b[\s\S]*?<\/author>/gi)]
      .map((item) => xmlTagText(item[0], "name"))
      .filter(Boolean);
    const authors = creatorAuthors.length ? creatorAuthors : atomAuthors;
    const summary = xmlTagText(entry, "summary")
      .replace(/^arXiv:\s*\S+\s+Announce Type:\s*\S+\s+Abstract:\s*/i, "")
      .trim();

    return {
      id: absLink || rawId,
      title: xmlTagText(entry, "title"),
      authors,
      summary,
      published: xmlTagText(entry, "published"),
      updated: xmlTagText(entry, "updated"),
      link: absLink,
      absLink,
      primaryCategory: categories[0] || "arXiv",
      categories
    };
  })
  .filter((paper) => paper.id && paper.title && paper.summary);

const fetchLatestArxivRssPapers = async ({ signal, requestId }) => {
  const categories = arxivRssCategories.length ? arxivRssCategories : ["cs.NI", "cs.AI", "cs.LG"];
  const rssUrl = new URL(`https://rss.arxiv.org/atom/${categories.map(encodeURIComponent).join("+")}`);

  setPaperRequestStatus(requestId, "arxiv-rss", `正在同步 arXiv RSS：${categories.join(", ")}。`);
  setPaperRequestStatus(requestId, "arxiv-rss", "正在连接 arXiv...", "running");
  const response = await fetchArxivQueued(rssUrl, signal);

  if (!response.ok) {
    throw responseSourceError("arXiv RSS", await readResponseReturnValue("arXiv RSS", response));
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  let downloadedBytes = 0;
  const chunks = [];
  let lastProgressUpdate = 0;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      downloadedBytes += value.length;
      chunks.push(value);

      const now = Date.now();
      if (now - lastProgressUpdate > 500) {
        if (contentLength > 0) {
          const percent = Math.round((downloadedBytes / contentLength) * 100);
          const sizeMB = (downloadedBytes / 1024 / 1024).toFixed(1);
          setPaperRequestStatus(requestId, "arxiv-rss", `正在下载论文列表 ${percent}% (${sizeMB} MB)...`, "running");
        } else {
          const sizeMB = (downloadedBytes / 1024 / 1024).toFixed(1);
          setPaperRequestStatus(requestId, "arxiv-rss", `正在下载论文列表 (${sizeMB} MB)...`, "running");
        }
        lastProgressUpdate = now;
      }
    }

    setPaperRequestStatus(requestId, "arxiv-rss", "正在解析数据...", "running");
    const xml = decoder.decode(Buffer.concat(chunks));

    if (/Feed error for query/i.test(xml)) {
      const error = new Error(`arXiv RSS 不接受当前分类组合：${categories.join(", ")}`);
      error.detail = error.message;
      throw error;
    }

    setPaperRequestStatus(requestId, "arxiv-rss", "正在提取论文信息...", "running");

    const papers = parseArxivRssPapers(xml)
      .sort((a, b) => new Date(b.published || b.updated).getTime() - new Date(a.published || a.updated).getTime());

    setPaperRequestStatus(requestId, "arxiv-rss", "同步完成", "done");

    return papers;
  } finally {
    reader.releaseLock();
  }
};

const syncArxivPaperLibrary = async ({ force = false, requestId = "", signal, trigger = "unknown" } = {}) => {
  const run = async () => {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const library = await readArxivPaperLibrary();
    const lastSyncedAt = Date.parse(library.lastSyncedAt || "");
    const fresh = Number.isFinite(lastSyncedAt) && Date.now() - lastSyncedAt < arxivDailySyncMs;

    if (!force && fresh) {
      setPaperRequestStatus(requestId, "arxiv-library", `本地库今日已同步，共 ${library.papers.length} 篇论文。`, "running");
      const finishedAt = new Date().toISOString();
      const syncHistory = await safeAppendArxivSyncHistory({
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
        status: "skipped",
        trigger,
        force,
        requestId,
        categories: arxivRssCategories,
        total: library.papers.length,
        message: "Local arXiv library is still fresh."
      });
      return {
        library,
        skipped: true,
        syncHistory,
        added: 0,
        updated: 0,
        fetched: 0,
        total: library.papers.length
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240000);
    const syncSignal = signal || controller.signal;

    try {
      let papers;
      let retryCount = 0;
      const maxRetries = 1;

      while (retryCount <= maxRetries) {
        try {
          papers = await fetchLatestArxivRssPapers({ signal: syncSignal, requestId });
          break;
        } catch (error) {
          retryCount += 1;
          if (retryCount > maxRetries) {
            throw error;
          }
          setPaperRequestStatus(requestId, "arxiv-library", `连接失败，正在重试 (${retryCount}/${maxRetries})...`, "running");
          await sleep(2000);
        }
      }

      setPaperRequestStatus(requestId, "arxiv-library", "正在保存到本地库...", "running");
      const result = await mergeArxivPapersIntoLibrary(papers, { syncedAt: new Date().toISOString() });
      const finishedAt = new Date().toISOString();
      const syncHistory = await safeAppendArxivSyncHistory({
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
        status: "success",
        trigger,
        force,
        requestId,
        categories: arxivRssCategories,
        fetched: result.fetched,
        added: result.added,
        updated: result.updated,
        total: result.total,
        message: `Fetched ${result.fetched}, added ${result.added}, updated ${result.updated}.`
      });
      setPaperRequestStatus(requestId, "arxiv-library", `同步完成：获取 ${result.fetched} 篇，新增 ${result.added} 篇`, "done");
      return {
        ...result,
        syncHistory,
        skipped: false
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      await safeAppendArxivSyncHistory({
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
        status: "failed",
        trigger,
        force,
        requestId,
        categories: arxivRssCategories,
        total: library.papers.length,
        message: error.message || "arXiv sync failed.",
        error: {
          code: error.code || "ARXIV_SYNC_FAILED",
          message: error.message || "arXiv sync failed.",
          detail: error.detail || error.message || ""
        }
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  if (arxivSyncInflight) {
    return arxivSyncInflight;
  }

  arxivSyncInflight = run().finally(() => {
    arxivSyncInflight = null;
  });

  return arxivSyncInflight;
};

const runArxivAutoSync = async (reason = "scheduled") => {
  try {
    const result = await syncArxivPaperLibrary({ force: false, trigger: `auto-${reason}` });
    const action = result.skipped ? "skipped" : "synced";
    console.log(`[arXiv auto sync] ${action} (${reason}): fetched=${result.fetched}, added=${result.added}, updated=${result.updated}, total=${result.total}`);
    return true;
  } catch (error) {
    console.error(`[arXiv auto sync] failed (${reason}): ${error.stack || error.message}`);
    return false;
  }
};

const nextArxivAutoSyncDelay = async () => {
  const library = await readArxivPaperLibrary();
  const lastSyncedAt = Date.parse(library.lastSyncedAt || "");

  if (!Number.isFinite(lastSyncedAt)) {
    return 0;
  }

  return Math.max(0, lastSyncedAt + arxivDailySyncMs - Date.now());
};

const scheduleArxivAutoSync = async (reason = "scheduled", delayOverrideMs = null) => {
  if (!arxivAutoSyncEnabled) {
    return;
  }

  if (arxivAutoSyncTimer) {
    clearTimeout(arxivAutoSyncTimer);
    arxivAutoSyncTimer = null;
  }

  let delayMs = 0;

  if (delayOverrideMs !== null) {
    delayMs = Number.isFinite(delayOverrideMs) && delayOverrideMs >= 0
      ? delayOverrideMs
      : 60 * 60 * 1000;
  } else {
    try {
      delayMs = await nextArxivAutoSyncDelay();
    } catch (error) {
      console.error(`[arXiv auto sync] could not read last sync time: ${error.stack || error.message}`);
      delayMs = Number.isFinite(arxivAutoSyncRetryMs) && arxivAutoSyncRetryMs > 0
        ? arxivAutoSyncRetryMs
        : 60 * 60 * 1000;
    }
  }

  arxivAutoSyncTimer = setTimeout(async () => {
    arxivAutoSyncTimer = null;
    const success = await runArxivAutoSync(reason);
    await scheduleArxivAutoSync(success ? "next-due" : "retry", success ? null : arxivAutoSyncRetryMs);
  }, delayMs);

  const nextAt = new Date(Date.now() + delayMs).toISOString();
  console.log(`[arXiv auto sync] next run (${reason}) at ${nextAt}.`);
};

const startArxivAutoSync = () => {
  if (!arxivAutoSyncEnabled) {
    console.log("[arXiv auto sync] disabled.");
    return;
  }

  const initialDelayMs = Number.isFinite(arxivAutoSyncInitialDelayMs) && arxivAutoSyncInitialDelayMs >= 0
    ? arxivAutoSyncInitialDelayMs
    : 30 * 1000;

  arxivAutoSyncTimer = setTimeout(async () => {
    arxivAutoSyncTimer = null;
    await scheduleArxivAutoSync("startup");
  }, initialDelayMs);
  console.log(`[arXiv auto sync] enabled: startup check in ${initialDelayMs}ms.`);
};

const selectArxivLibraryPapers = ({ library, rawQuery, days, maxResults, start = 0 }) => {
  const earliest = days > 0 ? Date.now() - days * 86400000 : 0;
  const groups = queryTermGroups(rawQuery);
  const datedPapers = (Array.isArray(library.papers) ? library.papers : [])
    .filter((paper) => {
      if (!earliest) {
        return true;
      }

      const time = new Date(paper.published || paper.updated).getTime();
      return Number.isFinite(time) && time >= earliest;
    });
  const strict = datedPapers
    .filter((paper) => paperMatchesQueryGroups(paper, groups))
    .sort((a, b) => new Date(b.published || b.updated).getTime() - new Date(a.published || a.updated).getTime());
  const unique = [];
  const seen = new Set();

  appendUniquePapers(unique, seen, strict, Number.MAX_SAFE_INTEGER);
  const strictTotal = unique.length;
  const strictKeys = new Set(unique.map((paper) => arxivPaperId(paper) || normalizePaperKey(paper.title)));
  const needed = start + maxResults;
  const aiGroupIndex = aiQueryGroupIndex(groups);

  if (unique.length < needed && groups.length > 1) {
    const relaxed = datedPapers
      .map((paper) => ({ paper, relevance: paperQueryRelevance(paper, groups) }))
      .filter((entry) => {
        const hits = paperQueryGroupHits(entry.paper, groups);

        if (aiGroupIndex >= 0) {
          return hits[aiGroupIndex] > 0 && entry.relevance.matchedGroups >= 2;
        }

        return entry.relevance.matchedGroups >= Math.max(2, groups.length - 1);
      })
      .sort((a, b) => (
        b.relevance.score - a.relevance.score
        || new Date(b.paper.published || b.paper.updated).getTime() - new Date(a.paper.published || a.paper.updated).getTime()
      ))
      .map((entry) => entry.paper);

    appendUniquePapers(unique, seen, relaxed, Number.MAX_SAFE_INTEGER);
  }

  const papers = unique.slice(start, start + maxResults);

  return {
    papers,
    strictTotal,
    relaxedTotal: Math.max(0, unique.length - strictTotal),
    totalMatched: unique.length,
    relaxedUsed: papers.some((paper) => !strictKeys.has(arxivPaperId(paper) || normalizePaperKey(paper.title)))
  };
};

const isArxivSource = (source) => source === "arxiv" || source === "arxiv-rss" || source === "arxiv-library";

const tokenizeQuery = (query) => query.match(/"[^"]+"|\(|\)|\bANDNOT\b|\bAND\b|\bOR\b|[^\s()]+/gi) || [];

const normalizeQueryForArxiv = (query) => {
  const tokens = tokenizeQuery(query || defaultQuery)
    .map((token) => {
      const value = token.trim();

      if (!value) {
        return "";
      }

      if (value === "(" || value === ")") {
        return value;
      }

      if (/^(AND|OR|ANDNOT)$/i.test(value)) {
        return value.toUpperCase();
      }

      if (/^[a-zA-Z]+:/.test(value) || /^[a-zA-Z]+Date:\[/i.test(value)) {
        return value;
      }

      return `all:${value}`;
    })
    .filter(Boolean);

  return tokens.join(" ");
};

const readJsonBody = async (request) => {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 3_000_000) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
};

const booleanOption = (value, defaultValue = true) => {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  return !/^(0|false|no|off)$/i.test(String(value).trim());
};

const sanitizePaper = (paper) => ({
  id: String(paper.id || ""),
  title: truncate(paper.title, 320),
  authors: Array.isArray(paper.authors) ? paper.authors.slice(0, 12).map((author) => String(author)) : [],
  summary: truncate(paper.summary, 2400),
  published: String(paper.published || ""),
  updated: String(paper.updated || ""),
  link: String(paper.link || ""),
  absLink: String(paper.absLink || paper.id || ""),
  primaryCategory: String(paper.primaryCategory || "arXiv"),
  categories: Array.isArray(paper.categories) ? paper.categories.slice(0, 12).map((category) => String(category)) : [],
  candidateSource: truncate(paper.candidateSource, 80),
  candidateSourceLabel: truncate(paper.candidateSourceLabel, 120),
  candidateSourceDetail: truncate(paper.candidateSourceDetail, 240),
  candidateFetchedAt: String(paper.candidateFetchedAt || "")
});

const sanitizeReadingListPaper = (paper) => {
  const sanitized = sanitizePaper(paper);
  const analysis = paper?.analysis || {};
  const scores = Object.fromEntries(
    dimensions.map((dimension) => [dimension.key, clamp(analysis.scores?.[dimension.key] ?? 0)])
  );
  const interest = interestCalibrationForPaper(sanitized, analysis);
  const score = weightedScore(scores, interest.fit);
  const interestReason = normalizeText(analysis.interestReason) || interest.reason;

  return {
    ...sanitized,
    analysis: {
      score: Math.round(score),
      scores,
      interestFit: interest.fit,
      interestLabel: interest.label,
      interestAdjustment: interest.adjustment,
      interestReason,
      dimensionDetails: dimensions.map((dimension) => ({
        key: dimension.key,
        label: dimension.label,
        score: Math.round(scores[dimension.key] ?? 0)
      })),
      matchedDimensions: Array.isArray(analysis.matchedDimensions)
        ? analysis.matchedDimensions.slice(0, 6).map((item) => truncate(item, 80)).filter(Boolean)
        : dimensions
          .map((dimension) => ({ label: dimension.label, score: Math.round(scores[dimension.key] ?? 0) }))
          .filter((item) => item.score >= 70)
          .sort((a, b) => b.score - a.score)
          .map((item) => `${item.label} ${item.score}`),
      tldr: truncate(analysis.tldr, 420),
      valueHighlight: truncate(highValueSignalForScore(score, scores, { ...analysis, interestFit: interest.fit, interestReason }), 600),
      problem: truncate(analysis.problem, 900),
      background: truncate(analysis.background, 900),
      method: truncate(analysis.method, 1200),
      technicalDetails: truncate(analysis.technicalDetails, 1600),
      contribution: truncate(analysis.contribution, 900),
      experiment: truncate(analysis.experiment, 900),
      networkUseCase: truncate(analysis.networkUseCase, 900),
      limitations: truncate(analysis.limitations, 800),
      recommendedReadingPath: truncate(analysis.recommendedReadingPath, 800),
      whyRecommend: truncate(analysis.whyRecommend, 900),
      notRecommendReason: truncate(notRecommendReasonForScore(score, scores, { ...analysis, interestFit: interest.fit, interestReason }), 900),
      industryTags: normalizeIndustryTags(
        sanitized,
        analysis.industryTags || analysis.ictTags,
        8,
        analysis.matchedKeywords
      ),
      readingGuide: Array.isArray(analysis.readingGuide)
        ? analysis.readingGuide.slice(0, 8).map((item) => truncate(item, 180)).filter(Boolean)
        : [],
      matchedKeywords: Array.isArray(analysis.matchedKeywords)
        ? analysis.matchedKeywords.slice(0, 16).map((item) => truncate(item, 80)).filter(Boolean)
        : []
    }
  };
};

const extractJson = (content) => {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();

  if (!candidate) {
    throw new Error("LLM did not return a JSON object.");
  }

  try {
    return JSON.parse(candidate);
  } catch (error) {
    const start = candidate.indexOf("{");

    if (start === -1) {
      throw error;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < candidate.length; index += 1) {
      const char = candidate[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = inString;
        continue;
      }

      if (char === "\"") {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;

        if (depth === 0) {
          return JSON.parse(candidate.slice(start, index + 1));
        }
      }
    }

    throw error;
  }
};

const textFields = [
  "tldr",
  "problem",
  "background",
  "method",
  "technicalDetails",
  "contribution",
  "experiment",
  "networkUseCase",
  "limitations",
  "recommendedReadingPath",
  "whyRecommend"
];

const validateAnalysis = (paper, analysis) => {
  const missing = [];

  if (!analysis) {
    return { id: paper.id, title: paper.title, missing: ["analysis"] };
  }

  if (!Number.isFinite(Number(analysis.score))) {
    missing.push("score");
  }

  dimensions.forEach((dimension) => {
    if (!Number.isFinite(Number(analysis.scores?.[dimension.key]))) {
      missing.push(`scores.${dimension.key}`);
    }
  });

  textFields.forEach((field) => {
    if (!String(analysis[field] || "").trim()) {
      missing.push(field);
    }
  });

  if (!Array.isArray(analysis.readingGuide) || !analysis.readingGuide.length) {
    missing.push("readingGuide");
  }

  return missing.length ? { id: paper.id, title: paper.title, missing } : null;
};

const llmProviderDefaults = {
  "glm-coding-anthropic": {
    mode: "glm-coding-anthropic",
    protocol: "anthropic",
    model: "glm-5.2",
    endpoint: "https://open.bigmodel.cn/api/anthropic/v1/messages",
    apiKey: () => process.env.GLM_CODING_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN,
    modelEnv: () => process.env.GLM_CODING_MODEL || process.env.ANTHROPIC_MODEL,
    endpointEnv: () => process.env.GLM_CODING_ANTHROPIC_API_URL || process.env.ANTHROPIC_BASE_URL || process.env.GLM_CODING_API_URL,
    disableThinking: false
  }
};

const normalizeLlmProvider = () => "glm-coding-anthropic";

const inferLlmProvider = () => normalizeLlmProvider();

const getLlmConfig = (overrides = {}) => {
  const provider = inferLlmProvider(overrides);
  const defaults = llmProviderDefaults[provider] || llmProviderDefaults.openai;
  const apiKey = String(overrides.apiKey || "").trim()
    || process.env.LLM_API_KEY
    || defaults.apiKey()
    || process.env.GLM_API_KEY
    || process.env.ANTHROPIC_AUTH_TOKEN;
  const model = String(overrides.model || "").trim()
    || process.env.LLM_MODEL
    || defaults.modelEnv()
    || defaults.model;
  const rawEndpoint = String(overrides.endpoint || "").trim()
    || defaults.endpointEnv()
    || process.env.LLM_API_URL
    || defaults.endpoint;
  let endpoint = rawEndpoint;
  if (defaults.protocol === "anthropic" && !/\/v1\/messages\/?$/i.test(rawEndpoint)) {
    endpoint = `${rawEndpoint.replace(/\/+$/, "")}/v1/messages`;
  }

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    endpoint,
    model,
    provider,
    protocol: defaults.protocol,
    mode: defaults.mode,
    disableThinking: defaults.disableThinking && !process.env.LLM_API_URL
  };
};

const llmTextFromResponse = (data, protocol = "openai") => {
  if (protocol === "anthropic") {
    if (typeof data.content === "string") {
      return data.content;
    }

    if (Array.isArray(data.content)) {
      return data.content
        .map((item) => typeof item === "string" ? item : item?.text || "")
        .filter(Boolean)
        .join("\n");
    }
  }

  return data.choices?.[0]?.message?.content || data.output_text || "";
};

const llmHeaders = (config) => config.protocol === "anthropic"
  ? {
      "authorization": `Bearer ${config.apiKey}`,
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    }
  : {
      "authorization": `Bearer ${config.apiKey}`,
      "content-type": "application/json"
    };

const callLlmAnalyzer = async ({ query, papers, llm }) => {
  const config = getLlmConfig(llm);

  if (!config) {
    const error = new Error("未配置 BigModel GLM-5.2 API key。");
    error.code = "LLM_NOT_CONFIGURED";
    throw error;
  }

  const { endpoint, model, disableThinking, protocol } = config;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), llmRequestTimeoutMs);

  try {
    const payload = {
      model,
      temperature: 0.2,
      max_tokens: llmMaxOutputTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你是网络通信和 AI 论文推荐助手。",
            "请优先使用给定的论文标题、作者、arXiv/DOI/论文链接在网上搜索论文原文页面、PDF、HTML、出版页、代码页或项目页，并基于可核对到的论文原文和公开页面做详细分析。",
            "如果当前 API 环境无法联网检索、无法打开链接或无法读取论文原文，必须在 limitations 和 whyRecommend 中明确说明检索限制，只能基于输入的摘要和元数据分析，不要假装读过全文。",
            "请用中文输出，给每篇论文计算 0 到 100 的推荐分，并按指定维度给出分项分。",
            "请严格按照下面的评分档位和维度细则打分：",
            ...scoringRubric,
            "tldr 不是普通摘要，必须是论文价值判断的一句话。推荐分 70 及以上时，tldr 必须写出它相对普通候选更值得读的具体原因，包含核心贡献、最强维度和可核验信号，不能只写“提出了一个框架/方法”。推荐分低于 70 时，tldr 要说明主要价值和主要短板。",
            "推荐分 70 及以上必须填写 valueHighlight，用 60-120 个中文字符写出显性高分信号：强项来自研究问题、方法新意、系统价值还是证据强度，具体强在哪里。不要重复标题，不要使用“具有重要意义”“值得关注”这类空泛表达。",
            "如果根据分项分计算后的推荐分低于 60，必须填写 notRecommendReason。它必须是具体评审意见，不是分数解释：不要写“总分低于 60”“某维度多少分”“建议只在后续补充背景时再读”这类模板话；要直接说明这篇论文具体差在哪里，例如方法只是流程拼装、没有可复用机制，系统接口/闭环/失败处理没说清，实验缺少数据集/基线/消融/真实场景，或摘要只能看到愿景而看不到可验证假设。必须引用论文内容中的具体短板。",
            "ICT、电信、ADN、O-RAN 等产业和业务方向匹配只能写入 industryTags、matchedKeywords、interestFit 和 interestReason，不能作为四维 scores 的加分依据；服务端会先按四维分计算研究质量，再按 interestFit 做最终推荐分校准。",
            "只有当论文的主问题域是通信/电信/网络基础设施时，才能在 industryTags 中写 ICT，例如 5G/6G、RAN/O-RAN、无线/蜂窝/移动/核心/边缘/光/卫星网络、网络切片、路由、QoS、频谱、切换、业务保障、告警关联或故障诊断。泛 AI agent、泛多智能体系统、泛 graph/neural network、社交网络、一般 computer network 或只出现 network 一词，都不要标 ICT。",
            "对于产业宣介、实践总结、框架愿景或标准化流程型论文，要按实际研究贡献、可验证机制和证据强度打分，不要因为业务方向高度匹配而抬高研究问题价值、方法新意或系统价值。",
            "非目标领域的定义是：论文主问题、评价对象或主要应用场景明确落在医学、生命科学、脑科学、基因组、地理、游戏、教育、金融、法律、社科、推荐系统等专用垂直领域，且摘要没有展示可迁移的通用 AI/Agent/系统方法。若论文只是使用这些垂直数据做验证，但主要贡献是通用机制、架构、评测或 agent 方法，应设为 general_ai_system，而不是 out_of_scope_domain。",
            "分析正文要尽量具体、完整、可读：把问题背景、方法机制、技术路线、实验可信度、网络应用价值、局限和阅读路径写成可以直接帮助研究人员快速判断论文价值的内容。",
            "如果只能基于摘要分析，也要明确区分事实、合理推断和需要打开原文核验的部分。",
            "只返回 JSON，不要输出 Markdown。"
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            query,
            onlineSearchInstruction: "对每篇论文先用 title、authors、absLink、link 检索并核对公开论文信息。优先阅读论文原始页面、arXiv PDF/HTML、DOI 出版页、作者项目页或代码仓库；公开元数据页只能作为辅助线索，不能替代论文原文；无法访问时必须如实说明。",
            dimensions,
            scoringRubric,
            outputSchema: {
              recommendations: [
                {
                  id: "paper id",
                  score: "0-100 integer",
                  scores: {
                    scenarioProblemValue: "0-100",
                    methodNovelty: "0-100",
                    practicalValue: "0-100",
                    evidence: "0-100"
                  },
                  interestFit: "target_network_autonomy | general_ai_system | out_of_scope_domain | unclear",
                  interestReason: "40-120 个中文字符，说明它为什么属于网络自治/电信方向、通用可迁移方法、专用非目标领域或方向不明",
                  tldr: "一句话价值判断。70 分及以上必须写出核心贡献、最强维度和可核验证据/系统/方法信号；低于 70 要写出主要价值和短板",
                  valueHighlight: "仅当推荐分 70 及以上时必填：60-120 个中文字符，说明显性高分信号和强项来源；70 分以下返回空字符串",
                  problem: "论文解决的问题，至少 180 字",
                  background: "研究背景、业务/技术动机、为什么这个问题重要，至少 300 字",
                  method: "核心方法或系统思路，至少 350 字",
                  technicalDetails: "技术细节、模型/算法/系统设计、关键模块、输入输出、训练/推理流程、数据流和与网络场景的结合方式，至少 600 字",
                  contribution: "主要贡献，至少 220 字",
                  experiment: "实验设置、数据集、指标、基线、结果可信度、消融/鲁棒性/泛化线索和需要核验的点，至少 320 字",
                  networkUseCase: "对网络/电信/5G/6G的潜在价值、适用场景、落地前提和可能收益，至少 280 字",
                  limitations: "从摘要和元数据可见的不足、风险、假设、泛化边界和需要进一步确认点，至少 220 字",
                  recommendedReadingPath: "建议快速阅读这篇论文时按什么顺序读，每部分需要核验什么，如何判断是否值得深入复现，至少 240 字",
                  readingGuide: ["快速阅读建议1", "快速阅读建议2", "快速阅读建议3", "快速阅读建议4", "快速阅读建议5", "快速阅读建议6"],
                  industryTags: ["仅在主问题域确为通信/电信/网络基础设施时写 ICT 或电信网络；方向标签不参与总分"],
                  matchedKeywords: ["命中的关键词"],
                  whyRecommend: "为什么进入或接近推荐列表，必须解释总分档位、强弱维度、降分原因和适合/不适合推荐的理由，至少 220 字",
                  notRecommendReason: "仅当推荐分低于 60 时必填：具体评审意见，说明这篇论文内容上差在哪里；禁止写总分、阈值、维度分或模板化建议；60 分及以上返回空字符串"
                }
              ]
            },
            papers: papers.map((paper) => ({
              id: paper.id,
              title: paper.title,
              authors: paper.authors,
              categories: paper.categories,
              primaryCategory: paper.primaryCategory,
              published: paper.published,
              updated: paper.updated,
              absLink: paper.absLink,
              link: paper.link,
              summary: paper.summary
            }))
          })
        }
      ]
    };

    if (protocol === "anthropic") {
      const [systemMessage, userMessage] = payload.messages;
      payload.system = systemMessage.content;
      payload.messages = [userMessage];
      delete payload.response_format;
    }

    if (disableThinking && protocol === "openai") {
      payload.thinking = { type: "disabled" };
    }

    const llmResponse = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: llmHeaders(config),
      body: JSON.stringify(payload)
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      throw new Error(`LLM request failed with ${llmResponse.status}: ${truncate(redactSensitive(errorText), 300)}`);
    }

    const data = await llmResponse.json();
    const content = llmTextFromResponse(data, protocol);
    const parsed = extractJson(content);
    return Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutSeconds = Math.round(llmRequestTimeoutMs / 1000);
      const timeoutError = new Error(`LLM 请求超过 ${timeoutSeconds} 秒未完成，已自动中止。请稍后重试，或通过 LLM_REQUEST_TIMEOUT_MS 调大超时时间。`);
      timeoutError.code = "LLM_ANALYSIS_TIMEOUT";
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const callLlmReadingListReview = async ({ papers, llm, useOriginalText, scoreThreshold }) => {
  const config = getLlmConfig(llm);

  if (!config) {
    const error = new Error("未配置 BigModel GLM-5.2 API key。");
    error.code = "LLM_NOT_CONFIGURED";
    throw error;
  }

  const { endpoint, model, disableThinking, protocol } = config;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), llmRequestTimeoutMs);

  try {
    const payload = {
      model,
      temperature: 0.15,
      max_tokens: llmMaxOutputTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你是一名严谨的论文周报复评审稿人。",
            "当前任务不是修改原始推荐列表，也不是沿用摘要初筛分数；原始列表只提供一组待复评论文。",
            "请基于输入中的论文原文摘录、摘要和元数据，重新给出周报专用四维分数和总分。",
            "如果 originalText.status=available，必须优先使用 originalText.excerpt；原始 analysis 只能作为背景线索，不能直接继承旧分数、旧排序或旧推荐结论。",
            useOriginalText
              ? "本次启用全文复评，输入论文已经过滤为可获取原文的候选；不要把摘要初筛结论当作全文复评结论。"
              : "本次未启用全文复评，只能基于摘要和已有分析复评，并在 reviewReason 里明确证据边界。",
            "评分维度、权重和分数档位沿用下面的研究质量标准，但这次分数只服务于周报筛选和排序，不回写原始列表。",
            ...scoringRubric,
            "ICT、电信、ADN 等产业方向匹配只能作为标签或兴趣适配信号，不能给四维分数加分；服务端会先按四维分计算研究质量，再按 interestFit 做最终周报分校准。",
            "总分必须主要由四维分数反映：研究问题价值、方法新意、系统价值、证据强度。产业契合但研究贡献一般的论文，要在方法新意和证据强度上拉开差距；专用非目标领域论文要通过 interestFit 降低入选优先级。",
            "每篇论文必须提取发表单位/作者机构线索，并把机构名称翻译成中文。优先从 originalText.excerpt 的作者区、机构脚注、标题页、邮箱域名、致谢、项目页说明和摘要上下文判断；可以返回多个机构。affiliations 必须使用中文机构名，例如 Stanford University 写「斯坦福大学」、MIT 写「麻省理工学院」、University of Cambridge 写「剑桥大学」；不确定标准译名时用「英文原名（中文意译）」格式。无法确认时 affiliations 返回「单位线索不足」，并在 affiliationEvidence 里说明缺少哪些依据。不要凭作者姓名或国家刻板印象硬猜机构。",
            "reviewReason 必须写成具体复评判断：说明为什么它适合或不适合进入本次周报，点出方法、证据、系统落地或问题价值中的关键依据。",
            "只返回 JSON，不要输出 Markdown。"
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            reviewContext: {
              useOriginalText,
              scoreThreshold,
              paperCount: papers.length,
              note: "原始 analysis 字段来自摘要初筛，仅供理解上下文；周报分数、排序和入选判断必须重新评价。"
            },
            dimensions,
            scoringRubric,
            outputSchema: {
              reviews: [
                {
                  id: "paper id",
                  scores: {
                    scenarioProblemValue: "0-100",
                    methodNovelty: "0-100",
                    practicalValue: "0-100",
                    evidence: "0-100"
                  },
                  interestFit: "target_network_autonomy | general_ai_system | out_of_scope_domain | unclear",
                  interestReason: "40-120 个中文字符，说明方向兴趣和是否需要降权",
                  affiliations: ["中文发表单位或中文作者机构名称；无法确认时返回：单位线索不足"],
                  affiliationEvidence: "40-160 个中文字符，说明判断发表单位所依据的作者区、脚注、邮箱域名、致谢或原文/摘要线索；无法确认时说明线索不足。机构名称必须中文化。",
                  tldr: "一句话周报价值判断，说明这次复评后最值得关注或最明显的短板",
                  valueHighlight: "60-120 个中文字符，概括高分信号；如果不适合入选，说明核心短板",
                  reviewReason: "120-240 个中文字符，基于原文或摘要说明周报复评判断，禁止引用旧分数或只解释分数",
                  evidenceBasis: "full-text | abstract-fallback"
                }
              ]
            },
            papers: papers.map((paper) => ({
              id: paper.id,
              title: paper.title,
              authors: paper.authors,
              categories: paper.categories,
              primaryCategory: paper.primaryCategory,
              published: paper.published,
              absLink: paper.absLink,
              link: paper.link,
              summary: paper.summary,
              originalText: paper.originalText?.status === "available"
                ? {
                    status: "available",
                    source: paper.originalText.source,
                    chars: paper.originalText.chars,
                    excerpt: paper.originalText.excerpt
                  }
                : {
                    status: paper.originalText?.status || "unavailable",
                    message: paper.originalText?.message || "未提供论文原文"
                  },
              originalAnalysis: {
                tldr: paper.analysis?.tldr || "",
                problem: paper.analysis?.problem || "",
                method: paper.analysis?.method || "",
                technicalDetails: paper.analysis?.technicalDetails || "",
                contribution: paper.analysis?.contribution || "",
                experiment: paper.analysis?.experiment || "",
                limitations: paper.analysis?.limitations || "",
                networkUseCase: paper.analysis?.networkUseCase || "",
                industryTags: paper.analysis?.industryTags || [],
                matchedKeywords: paper.analysis?.matchedKeywords || []
              }
            }))
          })
        }
      ]
    };

    if (protocol === "anthropic") {
      const [systemMessage, userMessage] = payload.messages;
      payload.system = systemMessage.content;
      payload.messages = [userMessage];
      delete payload.response_format;
    }

    if (disableThinking && protocol === "openai") {
      payload.thinking = { type: "disabled" };
    }

    const llmResponse = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: llmHeaders(config),
      body: JSON.stringify(payload)
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      throw new Error(`LLM request failed with ${llmResponse.status}: ${truncate(redactSensitive(errorText), 300)}`);
    }

    const data = await llmResponse.json();
    const content = llmTextFromResponse(data, protocol);
    const parsed = extractJson(content);
    return Array.isArray(parsed.reviews) ? parsed.reviews : [];
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutSeconds = Math.round(llmRequestTimeoutMs / 1000);
      const timeoutError = new Error(`LLM 周报复评超过 ${timeoutSeconds} 秒未完成，已自动中止。请稍后重试，或调低周报候选数量。`);
      timeoutError.code = "LLM_READING_LIST_REVIEW_TIMEOUT";
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const callLlmTranslation = async ({ title, summary, llm }) => {
  const config = getLlmConfig(llm);

  if (!config) {
    const error = new Error("未配置 BigModel GLM-5.2 API key。");
    error.code = "LLM_NOT_CONFIGURED";
    throw error;
  }

  const { endpoint, model, disableThinking, protocol } = config;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const payload = {
      model,
      temperature: 0.1,
      max_tokens: 1400,
      messages: [
        {
          role: "system",
          content: "你是严谨的论文摘要翻译助手。请把英文论文摘要翻译为中文，保留必要英文术语，不添加摘要之外的信息。"
        },
        {
          role: "user",
          content: JSON.stringify({
            title,
            abstract: summary,
            instruction: "返回中文译文即可，不要输出 Markdown 标题。"
          })
        }
      ]
    };

    if (protocol === "anthropic") {
      const [systemMessage, userMessage] = payload.messages;
      payload.system = systemMessage.content;
      payload.messages = [userMessage];
    }

    if (disableThinking && protocol === "openai") {
      payload.thinking = { type: "disabled" };
    }

    const llmResponse = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: llmHeaders(config),
      body: JSON.stringify(payload)
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      throw new Error(`LLM request failed with ${llmResponse.status}: ${truncate(redactSensitive(errorText), 300)}`);
    }

    const data = await llmResponse.json();
    return ensureLlmResponseWithinLimit(llmTextFromResponse(data, protocol));
  } finally {
    clearTimeout(timeout);
  }
};

const callLlmReadingList = async ({ report, papers, llm }) => {
  const config = getLlmConfig(llm);

  if (!config) {
    const error = new Error("未配置 BigModel GLM-5.2 API key。");
    error.code = "LLM_NOT_CONFIGURED";
    throw error;
  }

  const { endpoint, model, disableThinking, protocol } = config;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), llmRequestTimeoutMs);

  try {
    const titleBase = formatReadingListTitleBase(report);
    const useOriginalText = report.useOriginalText !== false;
    const titleTopicHints = readingListTitleTopicHints(papers);
    const payload = {
      model,
      temperature: 0.25,
      max_tokens: llmMaxOutputTokens,
      messages: [
        {
          role: "system",
          content: [
            "你是一名面向科研读者和技术负责人的论文周报编辑。",
            "请基于输入中的精选论文列表，生成一篇适合发布到洞察网站的中文 Markdown 阅读清单。",
            "读者重点关注大模型、智能体、网络自治、网络数字孪生、系统架构与工程化集成，以及华为 ADN（Autonomous Driving Network，自智网络/自动驾驶网络）相关研究。",
            "这份清单要帮助读者快速理解：本周哪些论文值得读、每篇文章解决什么问题、核心贡献是什么、方法框架怎么做、实验结果是否支撑结论、局限约束在哪里、它对 ADN 网络研究有什么启发。",
            "输出必须是 Markdown 正文，不要使用代码围栏，不要输出额外解释。"
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            report: {
              titleBase,
              date: report.date,
              month: report.month,
              weekOfMonth: report.weekOfMonth,
              sourceReport: report.sourceReport,
              paperCount: papers.length,
              candidateCount: report.candidateCount || papers.length,
              reviewedCount: report.reviewedCount || papers.length,
              reviewScoreThreshold: report.reviewScoreThreshold,
              minSelectedCount: report.minSelectedCount,
              fallbackSelectedCount: report.fallbackSelectedCount || 0,
              reviewBeforeGenerate: report.reviewBeforeGenerate !== false,
              useOriginalText,
              originalTextCount: papers.filter((paper) => paper.originalText?.status === "available").length,
              titleTopicHints,
              tags: ["ICT", "大模型", "智能体", "网络自治", "网络数字孪生", "系统架构", "华为 ADN"],
              scoringDimensions: dimensions.map((dimension) => ({
                key: dimension.key,
                label: dimension.label,
                description: dimension.description
              }))
            },
            instruction: [
              `请生成以「${titleBase}」开头的标题。`,
              "标题格式固定为：【精选论文】{yy}年{month}月第{weekOfMonth}周阅读清单：{一句话观点}。",
              `标题冒号后必须直接写一句本周核心趋势或观点，控制在 18-32 个中文字符以内；必须绑定本周入选论文的具体主题，优先使用这些主题提示：${titleTopicHints.join("、") || "从入选论文标题和证据中提取具体主题"}。`,
              "标题不要只写“智能体赋能网络自治”“新范式”“值得关注”“重要趋势”“加速落地”“多点开花”这类每天都能套用的泛化表述。标题必须让读者看出本周具体在讨论什么问题或技术信号。",
              "输出必须包含 YAML front matter 和正文标题；YAML title 和正文一级标题必须完全一致，且都使用完整标题。",
              "YAML front matter 必须包含 description 字段，内容可以与标题冒号后的观点一致或略微展开，控制在 55 个中文字符以内。",
              "报告导读要说明本周收录概况、最值得关注的 2-4 篇论文、以及对 ADN 网络研究最有价值的研究信号。不要在导读里再写一组独立的阅读建议，避免和后面的阅读顺序重复。",
              "增加「本周趋势判断」章节，提炼 3-5 条趋势。每条趋势都要说明：技术信号是什么、为什么值得关注、成熟度或风险如何、它和华为 ADN 的意图驱动、闭环自治、网络数字孪生、网络智能体、跨域协同、自治运维或评估体系有什么关系。",
              "方向标签要尽量正交，不要把系统架构/工程化集成和网络数字孪生、网络智能体、自治闭环混作同一层级。每篇论文的方向用「主问题域 / 关键支撑技术」表达：主问题域优先从自治闭环与意图驱动、网络数字孪生与仿真评估、网络智能体与多智能体协同、网络基础模型与表征学习、系统架构与工程化集成、可信评估与安全可靠中选择；关键支撑技术再补充 LLM、Agent、RAG、工具调用、仿真平台、评测基准等。",
              "每篇入选论文都必须展示本次周报复评分，并说明分别符合哪些评分维度。评分维度来自输入 readingListReview 或 analysis.dimensionDetails / analysis.scores，包括研究问题价值、方法新意、系统价值、证据强度；写出高匹配维度及其分项分，必要时指出较弱维度。analysis.industryTags 里的 ICT、电信、网络自治等产业/方向标签可以作为标签或方向信号展示，但不要写成评分维度，也不要把方向匹配解释为高分依据。",
              "每篇入选论文都必须写「发表单位」，且发表单位必须用中文展示。优先使用 readingListReview.affiliations 和 readingListReview.affiliationEvidence；如果输入里的机构名仍是英文，必须翻译成中文后再写入正文和完整论文清单。常见大学、公司、研究机构使用通行中文译名；不确定标准译名时用「英文原名（中文意译）」格式。如果 affiliations 是「单位线索不足」，仍必须写成「发表单位：单位线索不足（依据：...）」并解释缺少原文作者区、机构脚注、邮箱域名、致谢或项目页线索。不要把作者姓名误写成单位，不要无依据猜测机构。",
              "不要引用原始推荐列表的旧分数、旧排序或旧推荐/隐藏结论。当前输入论文已经经过周报复评筛选，Markdown 中的周报复评分、阅读层级和排序只依据本次周报复评结果。",
              "如果某篇论文的 readingListReview.selectionReason 是 fallback，说明它是为了满足周报最低入选数量而补入；不要把它写成强推荐或本周必读，应放在快速扫读或补充观察层级，并明确写出它的具体短板和为什么只适合低优先级阅读。",
              ...(useOriginalText
                ? [
                  "本次启用论文原文抓取，入选论文已经过滤为 originalText.status=available 的候选。每篇论文必须优先基于 originalText.excerpt 进行解读；analysis 字段只作为评分、维度和补充参考。不要只改写上一步的 tldr、whyRecommend 或 summary。"
                ]
                : [
                  "本次未启用论文原文抓取，只能基于论文摘要、评分维度和已有分析生成。每篇论文涉及内容、方法、结果和局限时，都要用「基于摘要和已有分析看」标明依据，不要声称读过原文或全文。"
                ]),
              "每篇论文不要再使用「内容、方法与结果」或「研究问题与核心贡献」这样的合并小节，必须拆成「研究问题」「核心贡献」「方法框架」「实验与结果」四个连续小节。",
              "「研究问题」写清楚论文具体解决什么问题、为什么这个问题重要、它和 ADN/网络自治/网络数字孪生/智能体框架的关系是什么。",
              "「核心贡献」写清楚相对已有工作新增了什么：新框架、新机制、新任务定义、新评测、新系统实现，还是新的实验发现。",
              "「方法框架」写清楚核心方法、模型、系统架构、智能体流程、数据/工具链或关键机制怎么做；不要和实验结果混写。",
              "「实验与结果」写清楚实验/验证如何支撑结论、主要结果或结论是什么、可信度线索在哪里。结果不需要堆复杂数据，但要说明证据强弱。",
              "每篇论文必须包含「局限与适用约束」小节，至少 2 条要点。不要只写一句泛泛的局限，要结合数据集/场景假设、评估方式、部署成本、泛化边界、安全可靠、网络真实闭环适配等维度说明。",
              "每篇论文必须在「局限与适用约束」之后包含「ADN 启发与阅读价值」小节，把阅读价值、关注重点和适合读者合并表达，最多 3 条要点。不要写成三段读者画像，不要重复前文摘要；重点指出对华为 ADN 网络研究可借鉴的机制、可验证的假设、可迁移的系统设计或需要规避的风险。",
              "如果输入没有论文全文，只能基于摘要和已有分析判断时，要用「基于摘要和已有分析看」这样的表述标明依据，不要假装读过全文。",
              "论文条目按照「本周必读」「值得跟进」「快速扫读」分层组织。输入论文数量少时可以减少层级，但完整论文清单必须覆盖全部论文。",
              "「本周趋势判断」必须综合多篇论文，不能只是单篇论文摘要。可以包含研究机会、工程落地约束和下一步值得跟踪的问题。",
              "「推荐阅读顺序」要给出实际阅读路线和原因，只保留这一处阅读优先级建议，不要再新增独立的精简阅读、优先三篇或快速取舍章节。",
              "不要在发布内容中体现内部筛选阈值或推荐阈值；但每篇入选论文必须展示自己的周报复评分和符合的评分维度。",
              "完整论文清单放在最后，表格列为：论文、发表单位、一句话介绍、周报复评分、符合维度、阅读级别、链接。不要在完整论文清单里放方向列；发表单位列必须覆盖每篇论文，必须使用中文机构名，线索不足时写「单位线索不足」；一句话介绍要概括文章做了什么或为什么值得关注。",
              `全文最后一行必须固定为：${readingListFooterNote}`
            ].join("\n"),
            outputTemplate: [
              "---",
              `title: \"${titleBase}一句话观点\"`,
              "description: \"一句话提炼本周核心趋势或观点，不超过 55 个中文字符\"",
              `date: \"${report.date}\"`,
              `month: \"${report.month}\"`,
              `week_of_month: ${report.weekOfMonth}`,
              "category: \"论文周报\"",
              "tags:",
              "  - ICT",
              "  - 大模型",
              "  - 智能体",
              "  - 网络自治",
              "  - 网络数字孪生",
              "  - 系统架构",
              "  - 华为 ADN",
              `paper_count: ${papers.length}`,
              "---",
              "",
              `# ${titleBase}一句话观点`,
              "",
              "## 报告导读",
              "",
              "## 本周趋势判断",
              "",
              "## 本周必读",
              "",
              "### 1. 论文标题",
              "",
              "- 发表单位：",
              "- 周报复评分：",
              "- 符合维度：",
              "- 主问题域：",
              "- 关键支撑技术：",
              "- 链接：",
              "",
              "**研究问题**",
              "",
              "**核心贡献**",
              "",
              "**方法框架**",
              "",
              "**实验与结果**",
              "",
              "**局限与适用约束**",
              "",
              "**ADN 启发与阅读价值**",
              "",
              "## 值得跟进",
              "",
              "## 快速扫读",
              "",
              "## 推荐阅读顺序",
              "",
              "## 完整论文清单",
              "",
              "| 论文 | 发表单位 | 一句话介绍 | 周报复评分 | 符合维度 | 阅读级别 | 链接 |",
              "| --- | --- | --- | --- | --- | --- | --- |",
              "",
              readingListFooterNote
            ].join("\n"),
            papers
          })
        }
      ]
    };

    if (protocol === "anthropic") {
      const [systemMessage, userMessage] = payload.messages;
      payload.system = systemMessage.content;
      payload.messages = [userMessage];
    }

    if (disableThinking && protocol === "openai") {
      payload.thinking = { type: "disabled" };
    }

    const llmResponse = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: llmHeaders(config),
      body: JSON.stringify(payload)
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      throw new Error(`LLM request failed with ${llmResponse.status}: ${truncate(redactSensitive(errorText), 300)}`);
    }

    const data = await llmResponse.json();
    return ensureReadingListMarkdownFormat(ensureLlmResponseWithinLimit(llmTextFromResponse(data, protocol)), titleBase, { papers });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutSeconds = Math.round(llmRequestTimeoutMs / 1000);
      const timeoutError = new Error(`LLM 请求超过 ${timeoutSeconds} 秒未完成，已自动中止。请稍后重试，或通过 LLM_REQUEST_TIMEOUT_MS 调大超时时间。`);
      timeoutError.code = "LLM_READING_LIST_TIMEOUT";
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeAnalysis = (paper, analysis) => {
  const scores = Object.fromEntries(
    dimensions.map((dimension) => [dimension.key, clamp(analysis.scores[dimension.key])])
  );
  const interest = interestCalibrationForPaper(paper, analysis);
  const interestReason = normalizeText(analysis.interestReason) || interest.reason;
  const score = weightedScore(scores, interest.fit);

  return {
    score: Math.round(score),
    scores,
    interestFit: interest.fit,
    interestLabel: interest.label,
    interestAdjustment: interest.adjustment,
    interestReason,
    tldr: normalizeText(analysis.tldr),
    valueHighlight: normalizeText(highValueSignalForScore(score, scores, { ...analysis, interestFit: interest.fit, interestReason })),
    problem: normalizeText(analysis.problem),
    background: normalizeText(analysis.background),
    method: normalizeText(analysis.method),
    technicalDetails: normalizeText(analysis.technicalDetails),
    contribution: normalizeText(analysis.contribution),
    experiment: normalizeText(analysis.experiment),
    networkUseCase: normalizeText(analysis.networkUseCase),
    limitations: normalizeText(analysis.limitations),
    recommendedReadingPath: normalizeText(analysis.recommendedReadingPath),
    readingGuide: analysis.readingGuide.map((item) => normalizeText(item)).filter(Boolean),
    matchedKeywords: Array.isArray(analysis.matchedKeywords)
      ? analysis.matchedKeywords.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    industryTags: normalizeIndustryTags(
      paper,
      analysis.industryTags || analysis.ictTags,
      8,
      analysis.matchedKeywords
    ),
    notRecommendReason: normalizeText(notRecommendReasonForScore(score, scores, { ...analysis, interestFit: interest.fit, interestReason })),
    whyRecommend: normalizeText(analysis.whyRecommend)
  };
};

const weakAffiliationPattern = /^(?:unknown|unclear|n\/a|none|null|not\s+available|not\s+specified|单位线索不足|单位不明|未知|不详|无法确认|无)$/i;

const normalizeAffiliations = (value) => {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "").split(/[;；、\n]+/);
  const items = rawItems
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .filter((item) => !weakAffiliationPattern.test(item))
    .map((item) => truncate(item, 100));
  const unique = [...new Set(items)];
  return unique.length ? unique.slice(0, 8) : ["单位线索不足"];
};

const fallbackAffiliationEvidence = (paper = {}) => (
  paper.originalText?.status === "available"
    ? "原文摘录、作者列表和摘要中没有看到足够明确的机构线索，需要打开论文 PDF 或项目页进一步核验。"
    : "未获取到可用原文，只能基于作者列表、摘要和元数据判断，目前单位线索不足。"
);

const normalizeReadingListReview = (paper, review = {}) => {
  const scores = Object.fromEntries(
    dimensions.map((dimension) => [dimension.key, clamp(review.scores?.[dimension.key] ?? 0)])
  );
  const interest = interestCalibrationForPaper(paper, {
    ...paper?.analysis,
    ...review,
    interestFit: review.interestFit || paper?.analysis?.interestFit,
    interestReason: review.interestReason || paper?.analysis?.interestReason
  });
  const interestReason = normalizeText(review.interestReason) || normalizeText(paper?.analysis?.interestReason) || interest.reason;
  const score = weightedScore(scores, interest.fit);
  const dimensionDetails = dimensions.map((dimension) => ({
    key: dimension.key,
    label: dimension.label,
    score: Math.round(scores[dimension.key] ?? 0)
  }));
  const matchedDimensions = dimensionDetails
    .filter((dimension) => dimension.score >= 70)
    .sort((a, b) => b.score - a.score)
    .map((dimension) => `${dimension.label} ${dimension.score}`);
  const originalTextAvailable = paper?.originalText?.status === "available";
  const evidenceBasis = /full[-_\s]?text/i.test(String(review.evidenceBasis || ""))
    ? "full-text"
    : originalTextAvailable
      ? "full-text"
      : "abstract-fallback";
  const reviewReason = normalizeText(review.reviewReason)
    || normalizeText(review.valueHighlight)
    || highValueSignalForScore(score, scores, { ...review, interestFit: interest.fit, interestReason })
    || interestReason;
  const affiliations = normalizeAffiliations(
    review.affiliations
      || review.affiliation
      || review.institutions
      || review.institution
      || review.authorAffiliations
  );
  const affiliationEvidence = normalizeText(
    review.affiliationEvidence
      || review.institutionEvidence
      || review.affiliationReason
      || review.affiliationClues
  ) || fallbackAffiliationEvidence(paper);

  return {
    score: Math.round(score),
    scores,
    interestFit: interest.fit,
    interestLabel: interest.label,
    interestAdjustment: interest.adjustment,
    interestReason,
    dimensionDetails,
    matchedDimensions,
    tldr: normalizeText(review.tldr) || normalizeText(paper?.analysis?.tldr),
    valueHighlight: normalizeText(review.valueHighlight) || highValueSignalForScore(score, scores, { ...review, interestFit: interest.fit, interestReason }),
    affiliations,
    affiliationEvidence: truncate(affiliationEvidence, 600),
    reviewReason: truncate(reviewReason, 900),
    evidenceBasis
  };
};

const applyReadingListReviews = (papers, reviews, { allowMissing = false } = {}) => {
  const reviewById = new Map((reviews || []).map((review) => [String(review.id), review]));
  const missing = papers
    .filter((paper) => !reviewById.has(paper.id))
    .map((paper) => ({ id: paper.id, title: paper.title }));

  if (missing.length) {
    const error = new Error(`LLM did not return reading-list reviews for ${missing.length} papers.`);
    error.code = "LLM_INCOMPLETE_READING_LIST_REVIEW";
    error.missingPapers = missing;
    if (!allowMissing || missing.length >= papers.length) {
      throw error;
    }
  }

  const reviewedPapers = papers.filter((paper) => reviewById.has(paper.id)).map((paper) => {
    const readingListReview = normalizeReadingListReview(paper, reviewById.get(paper.id));
    const analysis = {
      ...paper.analysis,
      score: readingListReview.score,
      scores: readingListReview.scores,
      interestFit: readingListReview.interestFit,
      interestLabel: readingListReview.interestLabel,
      interestAdjustment: readingListReview.interestAdjustment,
      interestReason: readingListReview.interestReason,
      dimensionDetails: readingListReview.dimensionDetails,
      matchedDimensions: readingListReview.matchedDimensions,
      tldr: readingListReview.tldr || paper.analysis?.tldr || "",
      valueHighlight: readingListReview.valueHighlight,
      affiliations: readingListReview.affiliations,
      affiliationEvidence: readingListReview.affiliationEvidence,
      whyRecommend: readingListReview.reviewReason || paper.analysis?.whyRecommend || ""
    };

    return {
      ...paper,
      analysis,
      readingListReview
    };
  });

  return {
    papers: reviewedPapers,
    missing
  };
};

const selectReadingListPapers = (papers, { threshold = 70, minSelectedCount = 3 } = {}) => {
  const sorted = [...papers].sort((a, b) => (
    b.readingListReview.score - a.readingListReview.score
    || new Date(b.published || b.updated) - new Date(a.published || a.updated)
  ));
  const minimum = Math.max(1, Math.min(sorted.length, Number(minSelectedCount) || 3));
  const selectedIds = new Set();
  const selected = [];
  const thresholdSelected = sorted.filter((paper) => paper.readingListReview.score >= threshold);

  thresholdSelected.forEach((paper) => {
    selectedIds.add(paper.id);
    selected.push({
      ...paper,
      readingListReview: {
        ...paper.readingListReview,
        selectionReason: "threshold"
      }
    });
  });

  for (const paper of sorted) {
    if (selected.length >= minimum) {
      break;
    }

    if (selectedIds.has(paper.id)) {
      continue;
    }

    selectedIds.add(paper.id);
    selected.push({
      ...paper,
      readingListReview: {
        ...paper.readingListReview,
        selectionReason: "fallback"
      }
    });
  }

  return {
    selected,
    thresholdCount: thresholdSelected.length,
    fallbackCount: selected.filter((paper) => paper.readingListReview.selectionReason === "fallback").length,
    minSelectedCount: minimum
  };
};

const handleArxivSyncRequest = async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET") {
    const library = await readArxivPaperLibrary();
    const history = await readArxivSyncHistory();
    sendJson(response, 200, {
      count: library.papers.length,
      lastSyncedAt: library.lastSyncedAt || "",
      lastSyncCount: library.lastSyncCount || 0,
      lastSyncAdded: library.lastSyncAdded || 0,
      lastSyncRecord: history.records[0] || null,
      categories: library.categories || arxivRssCategories,
      stale: !library.lastSyncedAt || Date.now() - Date.parse(library.lastSyncedAt) >= arxivDailySyncMs
    });
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const force = /^(1|true|yes)$/i.test(String(url.searchParams.get("force") || ""));
  const requestId = String(url.searchParams.get("requestId") || "");
  const trigger = String(url.searchParams.get("trigger") || "manual");

  try {
    const result = await syncArxivPaperLibrary({ force, requestId, trigger });
    sendJson(response, 200, {
      count: result.total,
      fetched: result.fetched,
      added: result.added,
      updated: result.updated,
      skipped: result.skipped,
      syncHistory: result.syncHistory || null,
      lastSyncedAt: result.library.lastSyncedAt || "",
      lastSyncCount: result.library.lastSyncCount || 0,
      lastSyncAdded: result.library.lastSyncAdded || 0,
      categories: result.library.categories || arxivRssCategories
    });
  } catch (error) {
    sendJson(response, error.status || 502, {
      error: error.code || "ARXIV_SYNC_FAILED",
      message: error.message || "arXiv sync failed.",
      detail: error.detail || error.message,
      sourceReturns: error.sourceReturns || []
    });
  }
};

const handleArxivSyncHistoryRequest = async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), arxivSyncHistoryLimit);
  const history = await readArxivSyncHistory();

  sendJson(response, 200, {
    count: Math.min(history.records.length, limit),
    total: history.records.length,
    records: history.records.slice(0, limit)
  });
};

const handlePapersRequest = async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const maxResults = Math.min(Math.max(Number(url.searchParams.get("limit") || 10), 5), candidateBatchMax);
  const start = Math.max(Number(url.searchParams.get("start") || 0), 0);
  const rawQuery = (url.searchParams.get("query") || defaultQuery).trim();
  const days = Math.min(Math.max(Number(url.searchParams.get("days") || 0), 0), 365);
  const requestId = String(url.searchParams.get("requestId") || "");
  const forceRefresh = /^(1|true|yes)$/i.test(String(url.searchParams.get("refresh") || ""));
  const forceArxivApi = /^(1|true|yes|api)$/i.test(String(url.searchParams.get("forceArxiv") || url.searchParams.get("arxivApi") || ""))
    || /^api$/i.test(String(url.searchParams.get("arxivMode") || ""));
  const ignoreCooldown = forceArxivApi || /^(1|true|yes)$/i.test(String(url.searchParams.get("ignoreCooldown") || ""));
  let searchQuery = normalizeQueryForArxiv(rawQuery);

  if (days > 0 && !/submittedDate:/i.test(searchQuery)) {
    const { start: startDate, end } = arxivSubmittedDateWindow(days);
    searchQuery = `(${searchQuery}) AND submittedDate:[${formatArxivDate(startDate)} TO ${formatArxivDate(end)}]`;
  }

  const arxivUrl = new URL("https://export.arxiv.org/api/query");
  arxivUrl.searchParams.set("search_query", searchQuery);
  arxivUrl.searchParams.set("start", String(start));
  arxivUrl.searchParams.set("max_results", String(maxResults));
  arxivUrl.searchParams.set("sortBy", "submittedDate");
  arxivUrl.searchParams.set("sortOrder", "descending");
  const primaryMode = forceArxivApi ? "api" : "library";
  const cacheKey = arxivCacheKey(primaryMode === "api"
    ? arxivUrl
    : `arxiv-library:${arxivRssCategories.join("+")}:${rawQuery}:${days}:${maxResults}:${start}`);
  const cached = primaryMode === "api" ? await readArxivCache(cacheKey) : null;
  const cachedAge = cached ? Date.now() - Number(cached.fetchedAt) : Infinity;
  const cachedCount = cached ? atomEntryCount(cached.xml) : 0;
  const cachedSource = cached?.source || "arxiv";
  const canUseFreshCache = Boolean(cached) && isArxivSource(cachedSource) && !forceRefresh;
  const canUseStaleCache = cached && isArxivSource(cachedSource) && !forceRefresh;

  const sendPapersXml = (xml, cacheStatus, source = "arxiv", extraHeaders = {}) => {
    send(response, 200, xml, {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": cacheStatus === "miss" ? "public, max-age=300" : "public, max-age=60",
      "x-arxiv-search-query": encodeURIComponent(searchQuery),
      "x-paper-insight-arxiv-cache": cacheStatus,
      "x-paper-insight-source": source,
      "x-paper-insight-cache-age-seconds": cached ? String(arxivCacheAgeSeconds(cached)) : "0",
      "x-paper-insight-arxiv-method": primaryMode,
      ...(forceRefresh ? { "x-paper-insight-cache-bypass": "1" } : {}),
      ...(ignoreCooldown ? { "x-paper-insight-ignore-cooldown": "1" } : {}),
      ...extraHeaders
    });
  };

  if (primaryMode === "api" && canUseFreshCache && cachedAge < arxivFreshCacheMs) {
    setPaperRequestStatus(requestId, cachedSource || "cache", "已命中本地缓存。", "done");
    sendPapersXml(cached.xml, "hit", cachedSource, cachedCount < maxResults
      ? { "x-paper-insight-arxiv-warning": encodeURIComponent(`arXiv 缓存中只有 ${cachedCount} 篇匹配候选，未使用备用数据源。`) }
      : {});
    return;
  }

  if (primaryMode === "api" && arxivInflight.has(cacheKey)) {
    try {
      const result = await arxivInflight.get(cacheKey);
      sendPapersXml(result.xml, result.cacheStatus, result.source, result.headers);
    } catch (error) {
      sendJson(response, error.status || 502, {
        error: error.code || "ARXIV_UNAVAILABLE",
        message: error.message || "Could not fetch the latest papers from arXiv.",
        detail: error.detail || error.message,
        sourceReturns: error.sourceReturns || [],
        retryAfterSeconds: error.retryAfterSeconds || 0
      }, error.retryAfterSeconds ? { "retry-after": String(error.retryAfterSeconds) } : {});
    }
    return;
  }

  const fetchAndCache = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240000);

    try {
      if (primaryMode === "library") {
        try {
          const sync = await syncArxivPaperLibrary({
            force: forceRefresh,
            requestId,
            signal: controller.signal,
            trigger: forceRefresh ? "candidate-refresh" : "candidate-fetch"
          });
          const library = sync.library || await readArxivPaperLibrary();
          const selection = selectArxivLibraryPapers({ library, rawQuery, days, maxResults, start });
          const { papers } = selection;
          const xml = atomFeedFromPapers({ papers, query: rawQuery, source: "arXiv Library" });
          const rangeText = days > 0 ? `最近 ${days} 天` : "不限时间";
          const countMessage = selection.relaxedUsed
            ? `严格匹配 ${selection.strictTotal} 篇，已用“AI + 另一组关键词”补充到 ${papers.length} 篇候选论文。`
            : papers.length >= maxResults
              ? `已从本地 arXiv 库筛选 ${papers.length} 篇候选论文。`
              : `本地 arXiv 库${rangeText}只找到 ${papers.length} 篇匹配候选。可用 arXiv API 扩展到${rangeText}。`;
          setPaperRequestStatus(
            requestId,
            "arxiv-library",
            countMessage,
            "done"
          );
          return {
            xml,
            cacheStatus: "library",
            source: "arxiv-library",
            headers: {
              ...((papers.length < maxResults || selection.relaxedUsed) ? { "x-paper-insight-arxiv-warning": encodeURIComponent(countMessage) } : {}),
              "x-paper-insight-library-total": String(library.papers.length),
              "x-paper-insight-library-strict-matches": String(selection.strictTotal),
              "x-paper-insight-library-relaxed-matches": String(selection.relaxedTotal),
              "x-paper-insight-last-sync": encodeURIComponent(library.lastSyncedAt || ""),
              "x-paper-insight-sync-skipped": sync.skipped ? "1" : "0",
              "x-paper-insight-cache-age-seconds": "0"
            }
          };
        } catch (error) {
          const sourceReturns = Array.isArray(error.sourceReturns) ? [...error.sourceReturns] : [];
          const sourceReturn = sourceReturns[0];

          if (canUseStaleCache && cachedAge < arxivStaleCacheMs) {
            setPaperRequestStatus(requestId, cachedSource || "cache", "本地 arXiv 库暂时不可用，已使用本地缓存。", "done", { sourceReturns });
            return {
              xml: cached.xml,
              cacheStatus: "stale",
              source: cachedSource,
              headers: {
                "x-paper-insight-arxiv-warning": encodeURIComponent("本地 arXiv 库暂时不可用，已使用本地缓存。"),
                ...(sourceReturn ? { "x-paper-insight-source-return": responseReturnHeader(sourceReturn) } : {})
              }
            };
          }

          const wrapped = new Error(error.name === "AbortError" ? "arXiv sync request timed out." : error.message);
          wrapped.status = error.status || 502;
          wrapped.code = typeof error.code === "string" ? error.code : "ARXIV_LIBRARY_UNAVAILABLE";
          wrapped.detail = error.detail || wrapped.message;
          wrapped.sourceReturns = sourceReturns;
          setPaperRequestStatus(requestId, "none", wrapped.detail, "error", { sourceReturns });
          throw wrapped;
        }
      }

      const blockedUntil = ignoreCooldown ? 0 : await readArxivCooldown();
      const now = Date.now();

      if (blockedUntil > now) {
        if (canUseStaleCache && cachedAge < arxivStaleCacheMs) {
          setPaperRequestStatus(requestId, cachedSource || "cache", "arXiv API 正在限流，已使用本地缓存。", "done");
          return {
            xml: cached.xml,
            cacheStatus: "stale",
            source: cachedSource,
            headers: {
              "x-paper-insight-arxiv-warning": encodeURIComponent("arXiv API 正在限流，已使用本地缓存。"),
              "retry-after": String(Math.ceil((blockedUntil - now) / 1000))
            }
          };
        }

        const error = new Error("arXiv API 正在限流，本次不会切换备用数据源。");
        error.status = 429;
        error.code = "ARXIV_RATE_LIMITED";
        error.detail = error.message;
        error.retryAfterSeconds = Math.ceil((blockedUntil - now) / 1000);
        setPaperRequestStatus(requestId, "arxiv", error.detail, "error");
        throw error;
      }

      setPaperRequestStatus(requestId, "arxiv", ignoreCooldown ? "正在强制连接 arXiv API，已绕过本地冷却。" : "正在获取 arXiv API 候选论文。");
      const arxivResponse = await fetchArxivQueued(arxivUrl, controller.signal);

      if (arxivResponse.status === 429) {
        const arxivReturn = await readResponseReturnValue("arXiv", arxivResponse);
        const retryMs = nextArxiv429Cooldown(parseRetryAfter(arxivReturn.retryAfter));
        await writeArxivCooldown(Date.now() + retryMs, arxivReturn);

        if (canUseStaleCache && cachedAge < arxivStaleCacheMs) {
          setPaperRequestStatus(requestId, cachedSource || "cache", "arXiv 返回 429，已使用本地缓存。", "done", { sourceReturns: [arxivReturn] });
          return {
            xml: cached.xml,
            cacheStatus: "stale",
            source: cachedSource,
            headers: {
              "x-paper-insight-arxiv-warning": encodeURIComponent("arXiv 返回 429，已使用本地缓存。"),
              "x-paper-insight-source-return": responseReturnHeader(arxivReturn),
              "retry-after": String(Math.ceil(retryMs / 1000))
            }
          };
        }

        const error = responseSourceError("arXiv", arxivReturn);
        error.status = 429;
        error.code = "ARXIV_RATE_LIMITED";
        error.retryAfterSeconds = Math.ceil(retryMs / 1000);
        error.detail = `${describeResponseReturnValue(arxivReturn)}；本次不会切换备用数据源。`;
        setPaperRequestStatus(requestId, "arxiv", error.detail, "error", { sourceReturns: [arxivReturn] });
        throw error;
      }

      if (!arxivResponse.ok) {
        const returnValue = await readResponseReturnValue("arXiv", arxivResponse);
        throw responseSourceError("arXiv", returnValue);
      }

      const xml = await arxivResponse.text();
      await clearArxivCooldown();
      const apiPapers = parseArxivRssPapers(xml);
      if (apiPapers.length) {
        await mergeArxivPapersIntoLibrary(apiPapers, { updateLastSynced: false });
      }
      await writeArxivCache(cacheKey, {
        fetchedAt: Date.now(),
        searchQuery,
        source: "arxiv",
        xml
      });
      setPaperRequestStatus(requestId, "arxiv", "已通过 arXiv 获取候选论文。", "done");
      return { xml, cacheStatus: "miss", source: "arxiv", headers: {} };
    } catch (error) {
      const sourceReturns = Array.isArray(error.sourceReturns) ? [...error.sourceReturns] : [];
      const sourceReturn = sourceReturns[0];

      if (canUseStaleCache && cachedAge < arxivStaleCacheMs) {
        setPaperRequestStatus(requestId, cachedSource || "cache", "arXiv 暂时不可用，已使用本地缓存。", "done", { sourceReturns });
        return {
          xml: cached.xml,
          cacheStatus: "stale",
          source: cachedSource,
          headers: {
            "x-paper-insight-arxiv-warning": encodeURIComponent("arXiv 暂时不可用，已使用本地缓存。"),
            ...(sourceReturn ? { "x-paper-insight-source-return": responseReturnHeader(sourceReturn) } : {})
          }
        };
      }

      const wrapped = new Error(error.name === "AbortError" ? "arXiv request timed out." : error.message);
      wrapped.status = error.status || 502;
      wrapped.code = typeof error.code === "string" ? error.code : "ARXIV_UNAVAILABLE";
      wrapped.detail = error.detail || wrapped.message;
      wrapped.retryAfterSeconds = error.retryAfterSeconds || 0;
      wrapped.sourceReturns = sourceReturns;
      setPaperRequestStatus(requestId, "none", wrapped.detail, "error", { sourceReturns });
      throw wrapped;
    } finally {
      clearTimeout(timeout);
    }
  })();

  arxivInflight.set(cacheKey, fetchAndCache);

  try {
    const result = await fetchAndCache;
    sendPapersXml(result.xml, result.cacheStatus, result.source, result.headers);
  } catch (error) {
    sendJson(response, error.status || 502, {
      error: error.code || "ARXIV_UNAVAILABLE",
      message: error.message || "Could not fetch the latest papers from arXiv.",
      detail: error.detail || error.message,
      sourceReturns: error.sourceReturns || [],
      retryAfterSeconds: error.retryAfterSeconds || 0
    }, error.retryAfterSeconds ? { "retry-after": String(error.retryAfterSeconds) } : {});
  } finally {
    arxivInflight.delete(cacheKey);
  }
};

const handlePaperStatusRequest = (request, response) => {
  cleanupPaperRequestStatuses();
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestId = String(url.searchParams.get("requestId") || "");
  const status = paperRequestStatuses.get(requestId);

  sendJson(response, 200, status || {
    source: "",
    message: "等待开始获取候选论文。",
    state: "idle",
    updatedAt: Date.now()
  });
};

const handleAnalyzeRequest = async (request, response) => {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const threshold = clamp(payload.threshold ?? 70);
    const maxAnalyze = Math.min(Math.max(Number(payload.maxAnalyze || 30), 5), recommendationListMax);
    const maxRecommendations = Math.min(Math.max(Number(payload.maxRecommendations || 12), 1), recommendationListMax);
    const papers = Array.isArray(payload.papers) ? payload.papers.slice(0, maxAnalyze).map(sanitizePaper) : [];

    if (!papers.length) {
      sendJson(response, 400, { error: "NO_PAPERS", message: "No papers were provided for analysis." });
      return;
    }

    const requestLlm = {
      apiKey: payload.llmApiKey,
      provider: payload.llmProvider,
      model: payload.llmModel
    };
    let llmAnalyses = null;
    const mode = llmProviderDefaults[inferLlmProvider(requestLlm)]?.mode || "llm";

    try {
      llmAnalyses = await callLlmAnalyzer({ query: payload.query || defaultQuery, papers, llm: requestLlm });
    } catch (error) {
      const status = error.code === "LLM_NOT_CONFIGURED"
        ? 503
        : error.code === "LLM_ANALYSIS_TIMEOUT"
          ? 504
          : 500;
      sendJson(response, status, {
        error: error.code || "LLM_ANALYSIS_FAILED",
        message: "LLM analysis is required for recommendations.",
        detail: error.message,
        retryable: error.code !== "LLM_NOT_CONFIGURED"
      });
      return;
    }

    const analysisById = new Map((llmAnalyses || []).map((analysis) => [String(analysis.id), analysis]));
    const missingPapers = papers
      .filter((paper) => !analysisById.has(paper.id))
      .map((paper) => ({
        id: paper.id,
        title: paper.title
      }));

    if (missingPapers.length) {
      sendJson(response, 502, {
        error: "LLM_INCOMPLETE_ANALYSIS",
        message: "LLM did not return analysis for every paper.",
        detail: `Missing ${missingPapers.length} paper analyses from the LLM response.`,
        retryable: true,
        missingPapers
      });
      return;
    }

    const invalidAnalyses = papers
      .map((paper) => validateAnalysis(paper, analysisById.get(paper.id)))
      .filter(Boolean);

    if (invalidAnalyses.length) {
      sendJson(response, 502, {
        error: "LLM_INVALID_ANALYSIS",
        message: "LLM returned incomplete paper analysis fields.",
        detail: `Invalid analyses for ${invalidAnalyses.length} papers.`,
        retryable: true,
        invalidAnalyses
      });
      return;
    }

    const analyzed = papers
      .map((paper) => ({
        ...paper,
        analysis: normalizeAnalysis(paper, analysisById.get(paper.id))
      }));

    const recommendations = analyzed
      .filter((paper) => paper.analysis.score >= threshold)
      .sort((a, b) => b.analysis.score - a.analysis.score || new Date(b.published) - new Date(a.published))
      .slice(0, maxRecommendations);
    const hiddenPapers = analyzed
      .filter((paper) => paper.analysis.score < threshold)
      .sort((a, b) => b.analysis.score - a.analysis.score || new Date(b.published) - new Date(a.published));

    sendJson(response, 200, {
      mode,
      warning: "",
      threshold,
      dimensions,
      candidateCount: payload.totalCandidates ?? papers.length,
      analyzedCount: analyzed.length,
      recommendedCount: recommendations.length,
      hiddenCount: hiddenPapers.length,
      recommendations,
      hiddenPapers,
      analyzedPapers: analyzed
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "ANALYSIS_FAILED",
      message: "Could not analyze papers.",
      detail: error.message
    });
  }
};

const handleTranslateRequest = async (request, response) => {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const title = truncate(payload.title, 320);
    const summary = truncate(payload.summary, 2400);

    if (!summary) {
      sendJson(response, 400, { error: "NO_ABSTRACT", message: "No abstract was provided for translation." });
      return;
    }

    const translation = await callLlmTranslation({
      title,
      summary,
      llm: {
        apiKey: payload.llmApiKey,
        provider: payload.llmProvider,
        model: payload.llmModel
      }
    });
    sendJson(response, 200, {
      translation,
      mode: llmProviderDefaults[inferLlmProvider({
        apiKey: payload.llmApiKey,
        provider: payload.llmProvider,
        model: payload.llmModel
      })]?.mode || "llm"
    });
  } catch (error) {
    sendJson(response, error.code === "LLM_NOT_CONFIGURED" ? 503 : 500, {
      error: error.code || "TRANSLATION_FAILED",
      message: "Could not translate the abstract.",
      detail: error.message
    });
  }
};

const handleReadingListRequest = async (request, response) => {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  let requestId = "";

  try {
    const payload = await readJsonBody(request);
    requestId = truncate(payload.requestId, 100);
    const papers = Array.isArray(payload.papers)
      ? payload.papers.slice(0, readingListCandidateMax).map(sanitizeReadingListPaper)
      : [];

    if (!papers.length) {
      sendJson(response, 400, { error: "NO_READING_LIST_CANDIDATES", message: "No reading-list candidate papers were provided." });
      return;
    }

    const report = {
      title: "",
      date: String(payload.date || new Date().toISOString().slice(0, 10)),
      month: truncate(payload.month, 16),
      weekOfMonth: Math.min(Math.max(Number(payload.weekOfMonth || 1), 1), 6),
      sourceReport: truncate(payload.sourceReport, 240),
      useOriginalText: booleanOption(payload.useOriginalText, true),
      reviewBeforeGenerate: booleanOption(payload.reviewBeforeGenerate, true),
      reviewScoreThreshold: clamp(payload.reviewScoreThreshold ?? 70),
      minSelectedCount: Math.min(Math.max(Number(payload.minSelectedCount || 3), 1), 20),
      candidateCount: papers.length
    };
    report.title = formatReadingListTitleBase(report);

    const requestLlm = {
      apiKey: payload.llmApiKey,
      provider: payload.llmProvider,
      model: payload.llmModel
    };

    if (!getLlmConfig(requestLlm)) {
      const error = new Error("未配置 BigModel GLM-5.2 API key。");
      error.code = "LLM_NOT_CONFIGURED";
      throw error;
    }

    setPaperRequestStatus(
      requestId,
      "reading-list",
      report.useOriginalText ? "准备抓取论文原文，随后进行周报复评。" : "已关闭原文抓取，正在准备基于摘要进行周报复评。",
      "running",
      {
        stage: report.useOriginalText ? "original-text" : "review",
        originalTextSummary: {
          total: papers.length,
          pending: report.useOriginalText ? papers.length : 0,
          running: 0,
          available: 0,
          unavailable: 0
        },
        originalTextItems: report.useOriginalText
          ? papers.map((paper, index) => ({
            index,
            title: readingListStatusTitle(paper, index),
            state: "pending",
            source: "",
            chars: 0,
            cached: false,
            message: "等待抓取"
          }))
          : []
      }
    );

    const originalTextContext = report.useOriginalText
      ? await enrichPapersWithOriginalText(papers, {
        requestId,
        nextStage: "review",
        nextActionMessage: "正在进入周报复评"
      })
      : {
        papers,
        fullTextCount: 0,
        unavailableCount: 0,
        perPaperBudget: 0
      };
    if (report.useOriginalText && !originalTextContext.papers.length) {
      const error = new Error("本次候选论文都没有获取到可用 arXiv HTML 原文，无法继续全文复评。请扩大候选范围，或关闭全文复评后基于摘要生成。");
      error.code = "NO_READING_LIST_ORIGINAL_TEXT";
      error.status = 400;
      throw error;
    }
    if (!report.useOriginalText) {
      setPaperRequestStatus(requestId, "reading-list", "已跳过论文原文抓取，正在提交给模型做周报复评。", "running", {
        stage: "review",
        originalTextSummary: {
          total: papers.length,
          pending: 0,
          running: 0,
          available: 0,
          unavailable: 0
        },
        originalTextItems: []
      });
    }

    let reviewedPapers = originalTextContext.papers;
    let selectedPapers = reviewedPapers;

    if (report.reviewBeforeGenerate) {
      const reviewTotal = reviewedPapers.length;
      setPaperRequestStatus(requestId, "reading-list", `正在对 ${reviewTotal} 篇候选论文进行周报复评。`, "running", {
        stage: "review",
        reviewSummary: {
          total: reviewTotal,
          reviewed: 0,
          running: 0,
          pending: reviewTotal,
          batchIndex: 0,
          totalBatches: Math.ceil(reviewTotal / readingListReviewBatchSize),
          skipped: 0
        },
        originalTextSummary: paperRequestStatuses.get(requestId)?.originalTextSummary || {
          total: papers.length,
          pending: 0,
          running: 0,
          available: originalTextContext.fullTextCount,
          unavailable: originalTextContext.unavailableCount
        },
        originalTextItems: paperRequestStatuses.get(requestId)?.originalTextItems || []
      });
      const reviewBatches = [];

      for (let start = 0; start < reviewedPapers.length; start += readingListReviewBatchSize) {
        reviewBatches.push(reviewedPapers.slice(start, start + readingListReviewBatchSize));
      }

      const llmReviews = [];
      let processedReviewCount = 0;

      for (let batchIndex = 0; batchIndex < reviewBatches.length; batchIndex += 1) {
        const batch = reviewBatches[batchIndex];
        const reviewedCount = llmReviews.length;
        const skippedCount = Math.max(0, processedReviewCount - reviewedCount);
        const pendingCount = Math.max(0, reviewTotal - processedReviewCount - batch.length);
        const currentOrdinal = processedReviewCount + 1;
        const batchTitle = batch.length === 1
          ? readingListStatusTitle(batch[0], processedReviewCount)
          : `${readingListStatusTitle(batch[0], processedReviewCount)} 等 ${batch.length} 篇`;
        const reviewMessage = batch.length === 1
          ? `周报复评第 ${currentOrdinal}/${reviewTotal} 篇：正在处理 ${batchTitle}。`
          : `周报复评第 ${batchIndex + 1}/${reviewBatches.length} 批：正在处理 ${batchTitle}。`;

        setPaperRequestStatus(requestId, "reading-list", reviewMessage, "running", {
          stage: "review",
          currentIndex: reviewedCount,
          currentTitle: batchTitle,
          reviewSummary: {
            total: reviewTotal,
            reviewed: reviewedCount,
            running: batch.length,
            pending: pendingCount,
            batchIndex: batchIndex + 1,
            totalBatches: reviewBatches.length,
            skipped: skippedCount
          },
          originalTextSummary: paperRequestStatuses.get(requestId)?.originalTextSummary,
          originalTextItems: paperRequestStatuses.get(requestId)?.originalTextItems || []
        });

        const batchReviews = await callLlmReadingListReview({
          papers: batch,
          llm: requestLlm,
          useOriginalText: report.useOriginalText,
          scoreThreshold: report.reviewScoreThreshold
        });

        llmReviews.push(...batchReviews);
        processedReviewCount += batch.length;
        const completedReviewCount = Math.min(reviewTotal, llmReviews.length);
        const skippedReviewCount = Math.max(0, processedReviewCount - completedReviewCount);
        const skippedReviewText = skippedReviewCount
          ? `，已跳过 ${skippedReviewCount} 篇未返回复评结果的论文`
          : "";
        setPaperRequestStatus(requestId, "reading-list", `周报复评进度：已完成 ${completedReviewCount}/${reviewTotal} 篇${skippedReviewText}。`, "running", {
          stage: "review",
          reviewSummary: {
            total: reviewTotal,
            reviewed: completedReviewCount,
            running: 0,
            pending: Math.max(0, reviewTotal - processedReviewCount),
            batchIndex: batchIndex + 1,
            totalBatches: reviewBatches.length,
            skipped: skippedReviewCount
          },
          originalTextSummary: paperRequestStatuses.get(requestId)?.originalTextSummary,
          originalTextItems: paperRequestStatuses.get(requestId)?.originalTextItems || []
        });
      }

      const appliedReviews = applyReadingListReviews(reviewedPapers, llmReviews, { allowMissing: true });
      reviewedPapers = appliedReviews.papers;
      report.reviewSkippedCount = appliedReviews.missing.length;

      const selection = selectReadingListPapers(reviewedPapers, {
        threshold: report.reviewScoreThreshold,
        minSelectedCount: report.minSelectedCount
      });
      selectedPapers = selection.selected;
      report.thresholdSelectedCount = selection.thresholdCount;
      report.fallbackSelectedCount = selection.fallbackCount;
      report.effectiveMinSelectedCount = selection.minSelectedCount;

      if (!selectedPapers.length) {
        const error = new Error("周报复评后没有可入选论文，请扩大候选范围后重试。");
        error.code = "NO_READING_LIST_SELECTION";
        error.status = 400;
        throw error;
      }

      const fallbackText = report.fallbackSelectedCount
        ? `，另按复评分补入 ${report.fallbackSelectedCount} 篇保底论文`
        : "";
      const skippedReviewText = report.reviewSkippedCount
        ? `，跳过 ${report.reviewSkippedCount} 篇未返回复评结果的论文`
        : "";
      setPaperRequestStatus(
        requestId,
        "reading-list",
        `周报复评完成：${reviewedPapers.length} 篇候选中 ${report.thresholdSelectedCount} 篇达到 ${report.reviewScoreThreshold} 分${fallbackText}${skippedReviewText}，正在生成周报正文。`,
        "running",
        {
          stage: "generate",
          reviewSummary: {
            total: reviewTotal,
            reviewed: reviewedPapers.length,
            running: 0,
            pending: 0,
            skipped: report.reviewSkippedCount,
            batchIndex: reviewBatches.length,
            totalBatches: reviewBatches.length,
            candidateCount: reviewedPapers.length,
            selectedCount: selectedPapers.length,
            thresholdSelectedCount: report.thresholdSelectedCount,
            fallbackSelectedCount: report.fallbackSelectedCount,
            threshold: report.reviewScoreThreshold,
            minSelectedCount: report.effectiveMinSelectedCount
          },
          originalTextSummary: paperRequestStatuses.get(requestId)?.originalTextSummary,
          originalTextItems: paperRequestStatuses.get(requestId)?.originalTextItems || []
        }
      );
    }

    report.reviewedCount = reviewedPapers.length;
    report.paperCount = selectedPapers.length;
    const readingListResult = await callLlmReadingList({
      report,
      papers: selectedPapers,
      llm: requestLlm
    });
    const markdown = readingListResult.markdown;
    const generatedTitle = readingListResult.title || report.title;
    const latestReadingListStatus = paperRequestStatuses.get(requestId);
    setPaperRequestStatus(requestId, "reading-list", "周报生成完成。", "done", {
      stage: "done",
      originalTextSummary: latestReadingListStatus?.originalTextSummary || {
        total: papers.length,
        pending: 0,
        running: 0,
        available: originalTextContext.fullTextCount,
        unavailable: originalTextContext.unavailableCount
      },
      originalTextItems: latestReadingListStatus?.originalTextItems || []
    });

    sendJson(response, 200, {
      markdown,
      mode: llmProviderDefaults[inferLlmProvider(requestLlm)]?.mode || "llm",
      paperCount: selectedPapers.length,
      candidateCount: papers.length,
      reviewedPaperCount: reviewedPapers.length,
      reviewSkippedCount: report.reviewSkippedCount || 0,
      reviewScoreThreshold: report.reviewScoreThreshold,
      minSelectedCount: report.effectiveMinSelectedCount || report.minSelectedCount,
      thresholdSelectedCount: report.thresholdSelectedCount ?? selectedPapers.length,
      fallbackSelectedCount: report.fallbackSelectedCount || 0,
      reviewBeforeGenerate: report.reviewBeforeGenerate,
      useOriginalText: report.useOriginalText,
      originalTextCount: selectedPapers.filter((paper) => paper.originalText?.status === "available").length,
      originalTextUnavailableCount: report.useOriginalText
        ? originalTextContext.unavailableCount
        : selectedPapers.filter((paper) => paper.originalText?.status !== "available").length,
      skippedOriginalTextPapers: originalTextContext.skippedPapers || [],
      title: generatedTitle
    });
  } catch (error) {
    const status = error.code === "LLM_NOT_CONFIGURED"
      ? 503
      : error.status
        ? error.status
      : error.code === "LLM_READING_LIST_TIMEOUT"
        ? 504
        : error.code === "LLM_READING_LIST_REVIEW_TIMEOUT"
          ? 504
        : 500;
    const latestReadingListStatus = paperRequestStatuses.get(requestId);
    setPaperRequestStatus(requestId, "reading-list", `周报生成失败：${error.message}`, "error", {
      stage: "error",
      originalTextSummary: latestReadingListStatus?.originalTextSummary,
      originalTextItems: latestReadingListStatus?.originalTextItems || []
    });
    sendJson(response, status, {
      error: error.code || "READING_LIST_FAILED",
      message: "Could not generate the weekly reading list.",
      detail: error.message,
      retryable: error.code !== "LLM_NOT_CONFIGURED"
    });
  }
};

const serveStatic = async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const normalizedPath = normalize(requestedPath).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, normalizedPath);

  if (filePath !== publicDir && !filePath.startsWith(publicRoot)) {
    send(response, 403, "Forbidden", { "content-type": "text/plain; charset=utf-8" });
    return;
  }

  try {
    const file = await readFile(filePath);
    send(response, 200, file, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "public, max-age=60"
    });
  } catch {
    send(response, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
  }
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/api/papers") {
    await handlePapersRequest(request, response);
    return;
  }

  if (url.pathname === "/api/papers/status") {
    handlePaperStatusRequest(request, response);
    return;
  }

  if (url.pathname === "/api/arxiv-sync/history") {
    await handleArxivSyncHistoryRequest(request, response);
    return;
  }

  if (url.pathname === "/api/arxiv-sync") {
    await handleArxivSyncRequest(request, response);
    return;
  }

  if (url.pathname === "/api/analyze") {
    await handleAnalyzeRequest(request, response);
    return;
  }

  if (url.pathname === "/api/translate") {
    await handleTranslateRequest(request, response);
    return;
  }

  if (url.pathname === "/api/reading-list") {
    await handleReadingListRequest(request, response);
    return;
  }

  await serveStatic(request, response);
});

server.listen(port, host || undefined, () => {
  const visibleHost = host || "localhost";
  console.log(`Paper Insight is running at http://${visibleHost}:${port}`);
  startArxivAutoSync();
});
