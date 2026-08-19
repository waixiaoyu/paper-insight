import {
  buildEditorialPlanPrompt,
  buildEditorialPlanRepairPrompt,
  buildEditorialPlanResponseRepairPrompt,
  buildHeadTailPrompt,
  buildHeadTailRepairPrompt,
  buildHeadTailResponseRepairPrompt
} from "./prompts.js";

const MATURITY_LEVELS = new Set(["emerging", "developing", "mature", "uncertain"]);
const EVIDENCE_FIELDS = [
  "problem",
  "method",
  "systemDesign",
  "experiments",
  "results",
  "limitations",
  "affiliations"
];
const INTERNAL_TERM_PATTERN = /\bfallback\b|\b(?:score|selection|review)\s+thresholds?\b|(?:评分|选稿|推荐|复评)\s*阈值|\bselection\s*reason\b|\bselectionreason\b|\bagent\s+(?:loop|stage)\b|\bprompts?\b|\bartifacts?\b|\binternal\s+json\b|内部\s*json|定向重评|横向校准|复评阈值|保底补入/iu;
const GENERIC_TITLE_PATTERN = /新范式|值得关注|加速落地|new\s+paradigm|worth\s+watching|accelerat(?:e|ed|ing)\s+(?:adoption|deployment)/iu;
const RHETORICAL_STYLE_PATTERN = /不等于|不等同于|并非.{0,12}而是|而非|揭示|迈向|赋能|解锁|重塑|颠覆|革命性?|坚实(?:的)?(?:量化)?证据|有效(?:解决|方法|暴露|测试)|具有(?:较高|很高|重要)的?(?:直接)?参考价值|不排除未来.{0,30}(?:可能|改进|消除)|鸿沟|浪潮|拐点|破局|\breveal(?:s|ed|ing)?\b|\bunlock(?:s|ed|ing)?\b|\breshape(?:s|d|ing)?\b|\brevolutionary\b/iu;
const LIMITED_TOP_MODEL_EVIDENCE_PATTERN = /\b(?:the\s+)?(?:strongest|best(?:-performing)?|best\s+performer)\s+models?\b/iu;
const BROAD_MODEL_SUBJECT_PATTERN = /(?:前沿|当前|现有|多数|大多数)?(?:大语言模型|大模型|语言模型|模型|抽取系统|系统|方法)|(?:frontier\s+)?(?:LLMs?|large\s+language\s+models?|models?)|\bmost\s+(?:systems?|methods?)\b/iu;
const POSITIVE_MODEL_PERFORMANCE_PATTERN = /(?:表现|能力|胜率).{0,14}(?:优异|突出|较高|较强|领先)|(?:优异|突出|较高|较强|领先).{0,8}(?:表现|能力|胜率)|(?:achiev(?:e|es|ed|ing)\s+)?(?:high|strong|excellent|outstanding|superior)\s+(?:performance|win\s+rates?|capabilit(?:y|ies))|(?:performance|win\s+rates?|capabilit(?:y|ies)).{0,14}(?:high|strong|excellent|outstanding|superior)/iu;
const QUALIFIED_MODEL_SUBSET_PATTERN = /部分|其中|表现最(?:好|佳|强)|最(?:好|佳|强)的?|最佳|最强|领先的|Gemini|GPT|Claude|DeepSeek|Grok|strongest|best[-\s]?perform/iu;
const LIMITED_NEGATIVE_RESULT_SOURCE_PATTERN = /\b(?:Gemini|GPT|Claude|DeepSeek|Grok)\b|\bbest\s+(?:overall|method|model|system)\b/iu;
const NEGATIVE_MODEL_PERFORMANCE_PATTERN = /显著不足|明显不足|性能.{0,8}下降|表现.{0,8}下降|表现不佳|性能不佳|(?:得分|分数|F1).{0,10}(?:低于|降至).{0,10}(?:以下)?|失败模式|较差|不稳定|\b(?:shortcoming|failure|degrad(?:e|es|ed|ation)|underperform(?:s|ed|ing)?|(?:score|f1).{0,20}below)\b/iu;
const QUALIFIED_EVALUATED_COHORT_PATTERN = /所评估|评估的|参与测试|接受测试|部分|某些|具体|上述|点名|商业\s*VLM|Gemini|GPT|Claude|DeepSeek|Grok|Reducto|LlamaExtract|\b(?:evaluated|tested|participating|specific|some|named|commercial\s+VLMs?)\b/iu;
const TRACK_SCOPED_MODEL_COUNT_SOURCE_PATTERN = /\b(?:encounter|day)[-\s]?track\b.{0,120}\b(?:evaluates?|compares?|tests?)\b.{0,40}\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+models?\b/iu;
const MODEL_COUNT_CLAIM_PATTERN = /(?:[一二三四五六七八九十百]+|\d+)个(?:前沿|语言|大语言|受测|所评估|特定)?模型(?:版本)?|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:frontier\s+|evaluated\s+|specific\s+)?model(?:s|\s+versions?)\b/iu;
const TRACK_SCOPE_QUALIFIER_PATTERN = /遭遇(?:赛道|轨道|场景)|连续(?:遭遇|任务)|(?:该|本|这个)赛道|\b(?:encounter|day)[-\s]?(?:track|scenario)?\b|\b(?:this|the)\s+track\b/iu;
const LONG_HORIZON_CLAIM_PATTERN = /中长期|长期|长周期|长时程|长程|\blong[-\s]?(?:term|horizon|range)\b/iu;
const LONG_HORIZON_SOURCE_PATTERN = /长期|长周期|长时程|长程|\blong[-\s]?(?:term|horizon|range)\b/iu;
const AWKWARD_TRANSLATION_PATTERN = /中时间跨度|自主决策网络/u;
const AWKWARD_CHINESE_GRAMMAR_PATTERN = /旨在奖励函数未知(?:的)?情况下/u;
const RESPONSE_CONTRACT_ISSUE_CODES = new Set(["invalid_json", "schema_invalid"]);
const hasOnlyResponseContractIssues = (validation) => (
  validation?.valid === false
  && Array.isArray(validation?.issues)
  && validation.issues.length > 0
  && validation.issues.every((entry) => RESPONSE_CONTRACT_ISSUE_CODES.has(String(entry?.code || "")))
);
const LOW_INFORMATION_BENCHMARK_TREND_PATTERN = /(?:两项|两篇|多篇|这些)(?:工作|研究|论文)?.{0,24}(?:均|都).{0,20}(?:构建|提出|建立).{0,12}(?:基准|评测).{0,36}(?:现有|当前).{0,16}(?:评测|测试|基准).{0,12}(?:不足|局限)/u;
const FRONTIER_MODEL_SUBJECT_PATTERN = /(?:当前|现有)?前沿(?:大)?模型|\bfrontier\s+models?\b/iu;
const FRONTIER_MODEL_CONSTRUCTION_METHOD_PATTERN = /(?:结合|使用|采用|基于)(?:了)?前沿(?:大)?模型集成|\b(?:using|uses?|combines?|with)\s+frontier[-\s]+model\s+ensembles?\b/giu;
const MIXED_METHOD_COHORT_SOURCE_PATTERN = /\bfrontier\s+methods?\b.{0,180}\bcommercial\s+VLMs?\b.{0,180}\b(?:open-source\s+extraction|coding\s+agents?|specialized\s+APIs?)\b/iu;
const DAY_WIN_RATE_CLAIM_PATTERN = /(?:\bday\b|战斗日|跨(?:场景|战斗日)).{0,18}(?:胜率|\bwin\s+rates?\b)|(?:胜率|\bwin\s+rates?\b).{0,8}(?:适用于|用于|覆盖|作为|\bin\b|\bon\b|\bfor\b).{0,8}(?:\bday\b|战斗日|跨(?:场景|战斗日))/iu;
const DAY_WIN_RATE_SOURCE_PATTERN = /\bday(?:-track)?\b.{0,160}\bwin\s+rates?\b|\bwin\s+rates?\b.{0,160}\bday(?:-track)?\b/iu;
const SPECIFIC_SETUP_REQUIREMENTS = Object.freeze([
  {
    kind: "resource_management",
    claim: /资源管理|\bresource\s+management\b/iu,
    source: /资源管理|\bresource\s+management\b/iu
  },
  {
    kind: "resource_budgeting",
    claim: /资源预算|\bresource\s+budgeting\b/iu,
    source: /资源预算|\bresource\s+budgeting\b|(?:生命值|法术位|消耗品).{0,160}(?:权衡|未来生存)|\b(?:hit\s+points?|spell\s+slots?|consumables?)\b.{0,240}\btrade\s+off\b.{0,160}\bfuture\s+survivability\b/iu
  },
  {
    kind: "state_tracking",
    claim: /状态(?:追踪|跟踪)|\bstate\s+tracking\b/iu,
    source: /状态(?:追踪|跟踪)|\bstate\s+tracking\b/iu
  },
  {
    kind: "multidimensional_evaluation_design",
    claim: /多维度(?:的)?(?:评测|评估)(?:指标|体系)|\bmulti[-\s]?dimensional\s+(?:evaluation|metrics?)\b/iu,
    source: /多维度|多个.{0,20}指标|\bmulti[-\s]?dimensional\b|\bmultiple\s+(?:metrics?|dimensions?)\b|\bindependent\s+axes\b/iu
  },
  {
    kind: "generic_table_scope",
    claim: /通用表格处理|\bgeneral[-\s]?purpose\s+table\s+processing\b/iu,
    source: /通用表格处理|\bgeneral[-\s]?purpose\s+table\s+processing\b/iu
  },
  {
    claim: /确定性引擎|\bdeterministic\s+engine\b/iu,
    source: /确定性引擎|\bdeterministic\s+engine\b/iu
  },
  {
    claim: /持久(?:状态|生命值)|短休(?:息|时机)?|\bpersistent\s+(?:state|hit\s+points?)\b|\bshort[-\s]?rests?\b/iu,
    source: /持久(?:状态|生命值)|短休(?:息|时机)?|\bpersistent\s+(?:state|hit\s+points?)\b|\bshort[-\s]?rests?\b/iu
  },
  {
    claim: /基础规则解析|\bbasic\s+rules?\s+parsing\b/iu,
    source: /基础规则解析|\bbasic\s+rules?\s+parsing\b/iu
  },
  {
    claim: /支持用户自定义(?:的)?(?:提取)?模式|\b(?:supports?|handles?)\s+user[-\s]?specified\s+schemas?\b/iu,
    source: /ExtractBench.{0,100}(?:supports?|handles?)\s+user[-\s]?specified\s+schemas?|支持用户自定义(?:的)?(?:提取)?模式/iu
  },
  {
    claim: /扫描表格|\bscanned\s+tables?\b/iu,
    source: /扫描表格|\bscanned\s+tables?\b/iu
  },
  {
    claim: /grounding\s*准确率|证据定位准确率|\bgrounding\s+accuracy\b/iu,
    source: /grounding\s*准确率|证据定位准确率|\bgrounding\s+accuracy\b/iu
  },
  {
    claim: /零级(?:溯源|定位|grounding|指标|层级)?|\bzero[-\s]?level\s+grounding\b/iu,
    source: /零级(?:溯源|定位|grounding|指标|层级)?|\bzero[-\s]?level\s+grounding\b/iu
  },
  {
    claim: /明确上限|性能上限|能力上限|\b(?:hard\s+)?(?:performance\s+)?ceiling\b/iu,
    source: /明确上限|性能上限|能力上限|\b(?:hard\s+)?(?:performance\s+)?ceiling\b|\bupper\s+bound\b/iu
  },
  {
    claim: /(?:未|没有)(?:通过|完成)任何(?:赛道|轨道)|一个(?:赛道|轨道)都(?:未|没)(?:通过|完成)|\bclear(?:s|ed)?\s+no\s+tracks?\b/iu,
    source: /(?:未|没有)(?:通过|完成)任何(?:赛道|轨道)|一个(?:赛道|轨道)都(?:未|没)(?:通过|完成)|\bclear(?:s|ed)?\s+no\s+tracks?\b/iu
  }
]);
const MARKDOWN_STRUCTURE_PATTERN = /(?:^|\n)\s*(?:#{1,6}\s|---\s*$|```)/m;

const normalizeText = (value, maximum = 2400) => String(value || "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, maximum);

const normalizeTitleAngle = (value) => {
  const title = normalizeText(value, 1200);
  if (Array.from(title).length <= 32) {
    return title;
  }
  const separatorIndex = title.search(/[：:]/u);
  if (separatorIndex < 1) {
    return title;
  }
  const prefix = title.slice(0, separatorIndex).trim();
  const remainder = title.slice(separatorIndex + 1).trim();
  const remainderLength = Array.from(remainder).length;
  if (/^[\p{L}\p{N} ._+&/-]{2,80}$/u.test(prefix)
    && remainderLength >= 18
    && remainderLength <= 32) {
    return remainder;
  }
  return title;
};

const selectedPaperTitleLabels = (items = []) => [...new Set(
  (Array.isArray(items) ? items : [])
    .map((item) => normalizeText(item?.paper?.title || item?.title, 500))
    .map((title) => title.match(/^([^:：]{2,80})[:：]/u)?.[1]?.trim() || "")
    .filter(Boolean)
)];

const selectedPaperTitlePrefix = (titleAngle, items = []) => {
  const normalized = normalizeText(titleAngle, 500).toLocaleLowerCase("en-US");
  return selectedPaperTitleLabels(items).find((label) => {
    const candidate = label.toLocaleLowerCase("en-US");
    return normalized.startsWith(`${candidate}:`) || normalized.startsWith(`${candidate}：`);
  }) || "";
};

const evidenceExcerptTextForItem = (item) => EVIDENCE_FIELDS.flatMap((field) => (
  Array.isArray(item?.evidenceCard?.[field]?.sources)
    ? item.evidenceCard[field].sources.map((source) => normalizeText(source?.excerpt, 5000))
    : []
)).join(" ");

const mixedMethodCohortPaperIds = (items = []) => new Set(
  (Array.isArray(items) ? items : [])
    .filter((item) => MIXED_METHOD_COHORT_SOURCE_PATTERN.test(evidenceExcerptTextForItem(item)))
    .map(selectedPaperId)
    .filter(Boolean)
);

const validateMixedMethodCohortSubject = ({ text, path, applies, issues }) => {
  const cohortSubjectText = String(text || "").replace(FRONTIER_MODEL_CONSTRUCTION_METHOD_PATTERN, "");
  if (!applies || !FRONTIER_MODEL_SUBJECT_PATTERN.test(cohortSubjectText)) {
    return;
  }
  const validationIssue = issue(
    "mixed_method_cohort_recast_as_models",
    path,
    "A cohort spanning VLMs, extraction tools, coding agents, and APIs must be called methods or systems, not frontier models."
  );
  validationIssue.repairKinds = ["mixed_method_cohort_subject"];
  issues.push(validationIssue);
};

const validateTrackMetricScope = ({ text, sourceText, path, issues }) => {
  const hasDayWinRateClaim = normalizeText(text, 12000)
    .split(/[，,。！？!?；;\n]+/u)
    .filter(Boolean)
    .some((clause) => DAY_WIN_RATE_CLAIM_PATTERN.test(clause));
  if (!hasDayWinRateClaim || DAY_WIN_RATE_SOURCE_PATTERN.test(sourceText)) {
    return;
  }
  const validationIssue = issue(
    "track_metric_scope_mismatch",
    path,
    "Encounter win rate and Day clear-count results must remain separate; do not attach win rate to Day or cross-day outcomes."
  );
  validationIssue.repairKinds = ["encounter_day_metric_scope"];
  issues.push(validationIssue);
};

const normalizedPaperId = (value) => {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/(?:^|\/)(\d{4}\.\d{4,5})(?:v\d+)?(?:$|[?#/])/i);
  return match?.[1] || text.replace(/v\d+$/i, "");
};

const issue = (code, path, detail) => ({ code, path, detail });

const uniqueIssues = (issues) => {
  const seen = new Set();
  return issues.filter((entry) => {
    const key = `${entry.code}|${entry.path}|${entry.detail}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const validateModelCohortScope = ({ text, sourceText, path, issues }) => {
  const sentences = normalizeText(text, 12000).split(/[。！？!?；;\n]+/u).filter(Boolean);
  if (LIMITED_TOP_MODEL_EVIDENCE_PATTERN.test(sourceText) && sentences.some((sentence) => (
    BROAD_MODEL_SUBJECT_PATTERN.test(sentence)
    && POSITIVE_MODEL_PERFORMANCE_PATTERN.test(sentence)
    && !QUALIFIED_MODEL_SUBSET_PATTERN.test(sentence)
  ))) {
    issues.push(issue(
      "model_cohort_scope_overgeneralized",
      path,
      "A result limited to the strongest, best-performing, or named models cannot be generalized to models as a whole."
    ));
  }
  if (LIMITED_NEGATIVE_RESULT_SOURCE_PATTERN.test(sourceText) && sentences.some((sentence) => (
    BROAD_MODEL_SUBJECT_PATTERN.test(sentence)
    && NEGATIVE_MODEL_PERFORMANCE_PATTERN.test(sentence)
    && !QUALIFIED_EVALUATED_COHORT_PATTERN.test(sentence)
  ))) {
    issues.push(issue(
      "model_cohort_scope_overgeneralized",
      path,
      "A negative result about named, best-performing, or specifically evaluated systems must remain qualified to that cohort."
    ));
  }
  if (TRACK_SCOPED_MODEL_COUNT_SOURCE_PATTERN.test(sourceText)) {
    const clauses = normalizeText(text, 12000).split(/[，,。！？!?；;\n]+/u).filter(Boolean);
    const encounterScoped = /\bencounter[-\s]?track\b.{0,120}\b(?:evaluates?|compares?|tests?)\b.{0,40}\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+models?\b/iu.test(sourceText);
    const dayScoped = /\bday[-\s]?track\b.{0,120}\b(?:evaluates?|compares?|tests?)\b.{0,40}\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+models?\b/iu.test(sourceText);
    if (clauses.some((clause) => (
      MODEL_COUNT_CLAIM_PATTERN.test(clause)
      && ((encounterScoped && /\bencounter\b/iu.test(clause) && /\bday\b/iu.test(clause))
        || (dayScoped && /\bday\b/iu.test(clause) && /\bencounter\b/iu.test(clause)))
    ))) {
      const validationIssue = issue(
        "model_count_track_scope_mismatch",
        path,
        "A model count from one track cannot be attached to both Encounter and Day tracks."
      );
      validationIssue.repairKinds = ["track_scoped_model_count"];
      issues.push(validationIssue);
    }
    if (clauses.some((clause) => (
      MODEL_COUNT_CLAIM_PATTERN.test(clause)
      && !TRACK_SCOPE_QUALIFIER_PATTERN.test(clause)
    ))) {
      const validationIssue = issue(
        "model_count_track_scope_missing",
        path,
        "A model count scoped to one experimental track must retain that track qualifier in the same clause."
      );
      validationIssue.repairKinds = ["track_scoped_model_count"];
      issues.push(validationIssue);
    }
  }
};

const validateTemporalScope = ({ text, sourceText, path, issues }) => {
  const affirmativeSource = String(sourceText || "")
    .replace(/\bnot\s+only\s+(?:a\s+)?long[-\s]?(?:term|horizon)\b/giu, "")
    .replace(/不(?:仅|只)是?\s*(?:长期|长周期|长时程)/gu, "");
  if (LONG_HORIZON_CLAIM_PATTERN.test(text) && !LONG_HORIZON_SOURCE_PATTERN.test(affirmativeSource)) {
    issues.push(issue(
      "temporal_scope_overgeneralized",
      path,
      "A medium-horizon or multi-encounter result cannot be expanded to long-term or long-horizon performance without explicit Evidence."
    ));
  }
};

const validateSpecificSetupClaims = ({ text, sourceText, path, issues }) => {
  const unsupported = SPECIFIC_SETUP_REQUIREMENTS
    .map((entry) => {
      const match = String(text || "").match(entry.claim);
      return match && !entry.source.test(sourceText)
        ? { term: normalizeText(match[0], 80), kind: entry.kind || "" }
        : null;
    })
    .filter(Boolean);
  if (unsupported.length) {
    const validationIssue = issue(
      "specific_setup_claim_not_in_evidence",
      path,
      `Unsupported setup or resource premise(s): ${unsupported.map((entry) => entry.term).join(", ")}. Remove or replace these exact terms unless the cited excerpts directly state them or satisfy their configured entailment rule.`
    );
    validationIssue.repairKinds = [...new Set(unsupported.map((entry) => entry.kind).filter(Boolean))];
    issues.push(validationIssue);
  }
};

const parseModelJson = (raw) => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (raw.coreTheme || raw.titleAngle || Array.isArray(raw.trends)) {
      return raw;
    }
    if (typeof raw.text === "string") {
      return parseModelJson(raw.text);
    }
    if (Array.isArray(raw.content)) {
      return parseModelJson(raw.content
        .filter((block) => block?.type === "text")
        .map((block) => block.text || "")
        .join("\n"));
    }
    return raw;
  }

  const text = String(raw || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new TypeError("Editorial Agent did not return a JSON object.");
  }
  return JSON.parse(text.slice(start, end + 1));
};

const editableEditorialPlanPath = /^(?:coreTheme|titleAngle|trends\[\d+\](?:\.(?:claim|supportingPaperIds|evidenceRefs|maturity|caveat))?|singlePaperObservations\[\d+\](?:\.(?:paperId|claim|evidenceRefs|caveat))?|readingOrder(?:\[\d+\](?:\.(?:paperId|reason))?)?)$/u;

const editorialRepairPaths = (issues = []) => {
  const paths = new Set((Array.isArray(issues) ? issues : [])
    .map((entry) => String(entry?.path || ""))
    .filter((path) => editableEditorialPlanPath.test(path)));
  [...paths].forEach((path) => {
    const trendMatch = path.match(/^(trends\[\d+\])\.(supportingPaperIds|evidenceRefs)$/u);
    if (trendMatch) {
      paths.add(`${trendMatch[1]}.${trendMatch[2] === "supportingPaperIds" ? "evidenceRefs" : "supportingPaperIds"}`);
    }
  });
  return paths;
};

const patchPathParts = (path) => [...String(path || "").matchAll(/([A-Za-z]+)|\[(\d+)\]/g)]
  .map((match) => match[1] || Number(match[2]));

const valueAtEditorialPlanPath = (editorialPlan, path) => patchPathParts(path)
  .reduce((current, part) => (current && typeof current === "object" ? current[part] : undefined), editorialPlan);

const repairIssue = (code, path, detail) => ({
  valid: false,
  editorialPlan: null,
  issues: [issue(code, path, detail)]
});

export const applyEditorialPlanPatch = ({ editorialPlan, issues = [], patchResponse } = {}) => {
  const allowedPaths = editorialRepairPaths(issues);
  const patches = patchResponse?.patches;
  if (!Array.isArray(patches) || !patches.length || patches.length > 20) {
    return repairIssue("editorial_repair_schema_invalid", "response", "Repair response must contain 1-20 patches.");
  }
  const next = structuredClone(editorialPlan || {});
  const seenPaths = new Set();
  for (const patch of patches) {
    const path = String(patch?.path || "");
    if (!allowedPaths.has(path)) {
      return repairIssue("editorial_repair_path_not_allowed", path || "response", "Repair may only change a current validation issue path.");
    }
    if (seenPaths.has(path)) {
      return repairIssue("editorial_repair_duplicate_path", path, "A repair path may occur only once.");
    }
    seenPaths.add(path);
    const parts = patchPathParts(path);
    let target = next;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (target === null || typeof target !== "object" || !(part in target)) {
        return repairIssue("editorial_repair_path_not_allowed", path, "Repair path does not exist in the current Editorial Plan.");
      }
      target = target[part];
    }
    const finalPart = parts.at(-1);
    if (target === null || typeof target !== "object" || !(finalPart in target)) {
      return repairIssue("editorial_repair_path_not_allowed", path, "Repair path does not exist in the current Editorial Plan.");
    }
    target[finalPart] = patch?.value;
  }
  return { valid: true, editorialPlan: next, issues: [] };
};

export const deriveEditorialPlanReviewScope = ({ editorialPlan = {}, issues = [] } = {}) => {
  const relatedPaperIds = new Set();
  (Array.isArray(issues) ? issues : []).forEach((entry) => {
    const path = String(entry?.path || "");
    const observationMatch = path.match(/^singlePaperObservations\[(\d+)\]/u);
    if (observationMatch) {
      const observation = editorialPlan?.singlePaperObservations?.[Number(observationMatch[1])];
      const paperId = normalizedPaperId(observation?.paperId);
      if (paperId) relatedPaperIds.add(paperId);
      return;
    }
    const trendMatch = path.match(/^trends\[(\d+)\]/u);
    if (trendMatch) {
      const trend = editorialPlan?.trends?.[Number(trendMatch[1])];
      (Array.isArray(trend?.supportingPaperIds) ? trend.supportingPaperIds : [])
        .map(normalizedPaperId)
        .filter(Boolean)
        .forEach((paperId) => relatedPaperIds.add(paperId));
      return;
    }
    const readingOrderMatch = path.match(/^readingOrder\[(\d+)\]/u);
    if (readingOrderMatch) {
      const entryAtPath = editorialPlan?.readingOrder?.[Number(readingOrderMatch[1])];
      const paperId = normalizedPaperId(entryAtPath?.paperId);
      if (paperId) relatedPaperIds.add(paperId);
    }
  });
  const ids = [...relatedPaperIds];
  return {
    paperId: ids.length === 1 ? ids[0] : "",
    relatedPaperIds: ids
  };
};

const selectedPaperId = (item) => normalizedPaperId(
  item?.reviewResult?.paperId || item?.contextPacket?.paperId || item?.paper?.id
);

const selectedInRankOrder = (selectedItems) => (Array.isArray(selectedItems) ? selectedItems : [])
  .map((item, index) => ({ item, index }))
  .sort((left, right) => {
    const leftRank = Number(left.item?.selection?.rank);
    const rightRank = Number(right.item?.selection?.rank);
    const safeLeftRank = Number.isFinite(leftRank) ? leftRank : left.index + 1;
    const safeRightRank = Number.isFinite(rightRank) ? rightRank : right.index + 1;
    return safeLeftRank - safeRightRank || left.index - right.index;
  })
  .map(({ item }) => item);

const evidenceReferenceMap = (selectedItems) => {
  const refs = new Map();
  (Array.isArray(selectedItems) ? selectedItems : []).forEach((item) => {
    const paperId = selectedPaperId(item);
    EVIDENCE_FIELDS.forEach((field) => {
      const evidence = item?.evidenceCard?.[field];
      (Array.isArray(evidence?.sources) ? evidence.sources : []).forEach((source, index) => {
        refs.set(`${paperId}:${field}:${index}`, {
          paperId,
          field,
          index,
          text: `${normalizeText(evidence?.summary, 4000)} ${normalizeText(source?.excerpt, 8000)}`.trim(),
          excerpt: normalizeText(source?.excerpt, 8000)
        });
      });
    });
  });
  return refs;
};

const ENGLISH_NUMBER_WORDS = Object.freeze({
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12"
});

const numericTokens = (value) => {
  const text = normalizeText(value, 12000);
  const explicit = text.match(/(?<![A-Za-z0-9_])\d+(?:[.,]\d+)*(?:\s*%)?/g)
    ?.map((token) => token.replace(/\s+/g, "").replace(/,/g, ""))
    .filter((token) => !/^\d{4}\.\d{4,5}$/u.test(token)) || [];
  const numberWords = [...text.matchAll(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/giu)]
    .map((match) => ENGLISH_NUMBER_WORDS[match[1].toLowerCase()]);
  return [...explicit, ...numberWords];
};

const validateClaimNumbers = ({ claim, refs, evidenceRefs, path, issues }) => {
  const claimedNumbers = [...new Set(numericTokens(claim))];
  if (!claimedNumbers.length) {
    return;
  }
  const citedText = evidenceRefs
    .map((reference) => refs.get(reference)?.text || "")
    .join(" ");
  const citedNumbers = new Set(numericTokens(citedText));
  claimedNumbers.forEach((number) => {
    if (!citedNumbers.has(number)) {
      const validationIssue = issue(
        "numeric_claim_not_in_evidence",
        path,
        `Exact number ${number} does not occur in the cited Evidence.`
      );
      validationIssue.triggerText = normalizeText(claim, 800);
      issues.push(validationIssue);
    }
  });
};

const validatePercentageMetricLabels = ({ claim, refs, evidenceRefs, path, issues }) => {
  const clauses = normalizeText(claim, 12000).split(/[，,。！？!?；;\n]+/u).filter(Boolean);
  const citedExcerpts = evidenceRefs.map((reference) => refs.get(reference)?.excerpt || "");
  if (clauses.some((clause) => /(?:准确率|\baccuracy\b)/iu.test(clause))
    && !citedExcerpts.some((excerpt) => /(?:准确率|\baccuracy\b)/iu.test(excerpt))) {
    const validationIssue = issue(
      "metric_label_not_in_evidence",
      path,
      "Do not relabel score, value F1, or grounding F1 as accuracy unless a cited Evidence excerpt uses that metric name."
    );
    validationIssue.repairKinds = ["preserve_metric_name"];
    issues.push(validationIssue);
    return;
  }
  clauses.forEach((clause) => {
    if (!/(?:准确率|\baccuracy\b)/iu.test(clause)) {
      return;
    }
    [...new Set(numericTokens(clause).filter((token) => token.endsWith("%")))].forEach((token) => {
      const supportingExcerpts = evidenceRefs
        .map((reference) => refs.get(reference)?.excerpt || "")
        .filter((excerpt) => numericTokens(excerpt).includes(token));
      if (supportingExcerpts.length && !supportingExcerpts.some((excerpt) => /准确率|\baccuracy\b/iu.test(excerpt))) {
        issues.push(issue(
          "metric_label_not_in_evidence",
          path,
          `The excerpt containing ${token} does not identify that value as accuracy.`
        ));
      }
    });
  });
};

const validateMetricLabelSupport = ({ text, sourceText, path, issues }) => {
  if (!/(?:准确率|\baccuracy\b)/iu.test(text)
    || /(?:准确率|\baccuracy\b)/iu.test(sourceText)) {
    return;
  }
  const validationIssue = issue(
    "metric_label_not_in_evidence",
    path,
    "Head/Tail must preserve the supplied metric name; score, value F1, and grounding F1 are not accuracy."
  );
  validationIssue.repairKinds = ["preserve_metric_name"];
  issues.push(validationIssue);
};

const validateInternalText = (value, path, issues) => {
  if (INTERNAL_TERM_PATTERN.test(value)) {
    issues.push(issue(
      "internal_term_leak",
      path,
      "Editorial Plan text must not expose internal workflow or selection terms."
    ));
  }
  if (RHETORICAL_STYLE_PATTERN.test(value)) {
    const validationIssue = issue(
      "rhetorical_prose_style",
      path,
      "Editorial Plan text must use direct, neutral technical description without rhetorical or promotional wording."
    );
    validationIssue.repairKinds = ["neutral_direct_statement"];
    validationIssue.triggerText = normalizeText(value, 800);
    issues.push(validationIssue);
  }
  if (AWKWARD_TRANSLATION_PATTERN.test(value)) {
    issues.push(issue(
      "awkward_literal_translation",
      path,
      "Use natural technical Chinese; translate medium-horizon as 中期 or describe the concrete multi-step span."
    ));
  }
  if (AWKWARD_CHINESE_GRAMMAR_PATTERN.test(value)) {
    const validationIssue = issue(
      "awkward_chinese_grammar",
      path,
      "Use 在奖励函数未知的情况下; do not omit the preposition 在 after 旨在."
    );
    validationIssue.repairKinds = ["missing_zai_before_condition"];
    issues.push(validationIssue);
  }
};

const normalizeEvidenceReference = (value) => {
  const reference = normalizeText(value, 200);
  const match = reference.match(/^(.*):(problem|method|systemDesign|experiments|results|limitations|affiliations):(\d+)$/iu);
  if (!match) {
    return reference;
  }
  const paperId = normalizedPaperId(match[1]);
  return paperId ? `${paperId}:${match[2]}:${match[3]}` : reference;
};

const normalizeEvidenceRefs = (value) => [...new Set((Array.isArray(value) ? value : [])
  .map(normalizeEvidenceReference)
  .filter(Boolean))];

export const validateEditorialPlan = (value, { selectedItems = [] } = {}) => {
  const rankedItems = selectedInRankOrder(selectedItems);
  const expectedOrder = rankedItems.map(selectedPaperId);
  const expectedIds = new Set(expectedOrder);
  const refs = evidenceReferenceMap(rankedItems);
  const allEvidenceExcerptText = [...refs.values()].map((entry) => entry.excerpt).join(" ");
  const issues = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      valid: false,
      issues: [issue("schema_invalid", "response", "Editorial Plan must be an object.")],
      editorialPlan: null
    };
  }

  const coreTheme = normalizeText(value.coreTheme, 2000);
  const titleAngle = normalizeTitleAngle(value.titleAngle);
  if (!coreTheme) {
    issues.push(issue("core_theme_missing", "coreTheme", "coreTheme is required."));
  }
  if (!titleAngle) {
    issues.push(issue("title_angle_missing", "titleAngle", "titleAngle is required."));
  }
  const titleAngleLength = Array.from(titleAngle).length;
  if (titleAngleLength < 18 || titleAngleLength > 32) {
    issues.push(issue(
      "title_angle_length_invalid",
      "titleAngle",
      "Editorial titleAngle must contain 18-32 Unicode characters; target 20-28 before returning."
    ));
  }
  const forbiddenTitlePrefix = selectedPaperTitlePrefix(titleAngle, rankedItems);
  if (forbiddenTitlePrefix) {
    const validationIssue = issue(
      "title_paper_prefix_forbidden",
      "titleAngle",
      `titleAngle must be a standalone technical claim, not a selected paper-name prefix: ${forbiddenTitlePrefix}.`
    );
    validationIssue.repairKinds = ["paper_title_prefix"];
    issues.push(validationIssue);
  }
  validateInternalText(coreTheme, "coreTheme", issues);
  validateInternalText(titleAngle, "titleAngle", issues);
  validateModelCohortScope({ text: coreTheme, sourceText: allEvidenceExcerptText, path: "coreTheme", issues });
  validateModelCohortScope({ text: titleAngle, sourceText: allEvidenceExcerptText, path: "titleAngle", issues });
  validateTemporalScope({ text: coreTheme, sourceText: allEvidenceExcerptText, path: "coreTheme", issues });
  validateTemporalScope({ text: titleAngle, sourceText: allEvidenceExcerptText, path: "titleAngle", issues });
  validateTrackMetricScope({ text: coreTheme, sourceText: allEvidenceExcerptText, path: "coreTheme", issues });
  validateTrackMetricScope({ text: titleAngle, sourceText: allEvidenceExcerptText, path: "titleAngle", issues });
  validateSpecificSetupClaims({ text: coreTheme, sourceText: allEvidenceExcerptText, path: "coreTheme", issues });
  validateSpecificSetupClaims({ text: titleAngle, sourceText: allEvidenceExcerptText, path: "titleAngle", issues });

  if (!Array.isArray(value.trends)) {
    issues.push(issue("trends_invalid", "trends", "trends must be an array."));
  }
  const trends = (Array.isArray(value.trends) ? value.trends : []).slice(0, 20).map((entry, index) => {
    const path = `trends[${index}]`;
    const claim = normalizeText(entry?.claim, 3000);
    const caveat = normalizeText(entry?.caveat, 2400);
    const maturity = normalizeText(entry?.maturity, 80).toLowerCase();
    const supportingPaperIds = [...new Set((Array.isArray(entry?.supportingPaperIds)
      ? entry.supportingPaperIds
      : []).map(normalizedPaperId).filter(Boolean))];
    const evidenceRefs = normalizeEvidenceRefs(entry?.evidenceRefs);

    if (!claim) {
      issues.push(issue("trend_claim_missing", `${path}.claim`, "Trend claim is required."));
    }
    if (LOW_INFORMATION_BENCHMARK_TREND_PATTERN.test(claim)) {
      issues.push(issue(
        "trend_too_generic",
        `${path}.claim`,
        "A weekly trend must identify a shared concrete evaluation design, mechanism, metric, or engineering implication; saying only that papers build benchmarks to expose prior gaps is insufficient."
      ));
    }
    if (supportingPaperIds.length < 2) {
      issues.push(issue(
        "trend_requires_two_papers",
        `${path}.supportingPaperIds`,
        "A weekly trend requires at least two selected papers."
      ));
    }
    supportingPaperIds.forEach((paperId, paperIndex) => {
      if (!expectedIds.has(paperId)) {
        issues.push(issue(
          "editorial_paper_unknown",
          `${path}.supportingPaperIds[${paperIndex}]`,
          "Trend references an unselected paper."
        ));
      }
      const hasSupportingRef = evidenceRefs.some((reference) => refs.get(reference)?.paperId === paperId);
      if (!hasSupportingRef) {
        issues.push(issue(
          "trend_support_missing_evidence",
          `${path}.evidenceRefs`,
          `Supporting paper ${paperId} has no cited Evidence ref.`
        ));
      }
    });
    evidenceRefs.forEach((reference, refIndex) => {
      const known = refs.get(reference);
      if (!known) {
        issues.push(issue(
          "evidence_ref_unknown",
          `${path}.evidenceRefs[${refIndex}]`,
          "Trend cites a nonexistent Evidence ref."
        ));
      } else if (!supportingPaperIds.includes(known.paperId)) {
        issues.push(issue(
          "trend_evidence_paper_mismatch",
          `${path}.evidenceRefs[${refIndex}]`,
          "Trend Evidence ref belongs to a paper outside supportingPaperIds."
        ));
      }
    });
    if (!MATURITY_LEVELS.has(maturity)) {
      issues.push(issue("trend_maturity_invalid", `${path}.maturity`, "Trend maturity is invalid."));
    }
    if (!caveat) {
      issues.push(issue("trend_caveat_missing", `${path}.caveat`, "Trend caveat is required."));
    }
    validateClaimNumbers({ claim, refs, evidenceRefs, path: `${path}.claim`, issues });
    validatePercentageMetricLabels({ claim, refs, evidenceRefs, path: `${path}.claim`, issues });
    validateInternalText(claim, `${path}.claim`, issues);
    validateInternalText(caveat, `${path}.caveat`, issues);
    validateModelCohortScope({
      text: claim,
      sourceText: evidenceRefs.map((reference) => refs.get(reference)?.excerpt || "").join(" "),
      path: `${path}.claim`,
      issues
    });
    validateTemporalScope({
      text: claim,
      sourceText: evidenceRefs.map((reference) => refs.get(reference)?.excerpt || "").join(" "),
      path: `${path}.claim`,
      issues
    });
    validateTrackMetricScope({
      text: claim,
      sourceText: evidenceRefs.map((reference) => refs.get(reference)?.excerpt || "").join(" "),
      path: `${path}.claim`,
      issues
    });
    validateSpecificSetupClaims({
      text: `${claim} ${caveat}`,
      sourceText: evidenceRefs.map((reference) => refs.get(reference)?.excerpt || "").join(" "),
      path,
      issues
    });
    return { claim, supportingPaperIds, evidenceRefs, maturity, caveat };
  });

  if (!Array.isArray(value.singlePaperObservations)) {
    issues.push(issue(
      "single_paper_observations_invalid",
      "singlePaperObservations",
      "singlePaperObservations must be an array."
    ));
  }
  const singlePaperObservations = (Array.isArray(value.singlePaperObservations)
    ? value.singlePaperObservations
    : []).slice(0, 40).map((entry, index) => {
    const path = `singlePaperObservations[${index}]`;
    const paperId = normalizedPaperId(entry?.paperId);
    const claim = normalizeText(entry?.claim, 3000);
    const caveat = normalizeText(entry?.caveat, 2400);
    const evidenceRefs = normalizeEvidenceRefs(entry?.evidenceRefs);
    if (!expectedIds.has(paperId)) {
      issues.push(issue("editorial_paper_unknown", `${path}.paperId`, "Observation references an unselected paper."));
    }
    if (!claim) {
      issues.push(issue("observation_claim_missing", `${path}.claim`, "Observation claim is required."));
    }
    if (!evidenceRefs.length) {
      issues.push(issue("observation_evidence_missing", `${path}.evidenceRefs`, "Observation requires Evidence refs."));
    }
    evidenceRefs.forEach((reference, refIndex) => {
      const known = refs.get(reference);
      if (!known) {
        issues.push(issue(
          "evidence_ref_unknown",
          `${path}.evidenceRefs[${refIndex}]`,
          "Observation cites a nonexistent Evidence ref."
        ));
      } else if (known.paperId !== paperId) {
        issues.push(issue(
          "observation_evidence_paper_mismatch",
          `${path}.evidenceRefs[${refIndex}]`,
          "Observation Evidence ref must belong to its paper."
        ));
      }
    });
    if (!caveat) {
      issues.push(issue("observation_caveat_missing", `${path}.caveat`, "Observation caveat is required."));
    }
    validateClaimNumbers({ claim, refs, evidenceRefs, path: `${path}.claim`, issues });
    validatePercentageMetricLabels({ claim, refs, evidenceRefs, path: `${path}.claim`, issues });
    validateInternalText(claim, `${path}.claim`, issues);
    validateInternalText(caveat, `${path}.caveat`, issues);
    validateModelCohortScope({
      text: claim,
      sourceText: evidenceRefs.map((reference) => refs.get(reference)?.excerpt || "").join(" "),
      path: `${path}.claim`,
      issues
    });
    validateTemporalScope({
      text: claim,
      sourceText: evidenceRefs.map((reference) => refs.get(reference)?.excerpt || "").join(" "),
      path: `${path}.claim`,
      issues
    });
    validateTrackMetricScope({
      text: claim,
      sourceText: evidenceRefs.map((reference) => refs.get(reference)?.excerpt || "").join(" "),
      path: `${path}.claim`,
      issues
    });
    validateSpecificSetupClaims({
      text: `${claim} ${caveat}`,
      sourceText: evidenceRefs.map((reference) => refs.get(reference)?.excerpt || "").join(" "),
      path,
      issues
    });
    return { paperId, claim, evidenceRefs, caveat };
  });
  const observationCounts = new Map();
  singlePaperObservations.forEach((entry) => {
    observationCounts.set(entry.paperId, (observationCounts.get(entry.paperId) || 0) + 1);
  });
  observationCounts.forEach((count, paperId) => {
    if (paperId && count > 1) {
      issues.push(issue(
        "single_paper_observation_duplicate",
        "singlePaperObservations",
        `Editorial Plan must combine observations for paper ${paperId} into one entry.`
      ));
    }
  });

  if (!Array.isArray(value.readingOrder)) {
    issues.push(issue("reading_order_invalid", "readingOrder", "readingOrder must be an array."));
  }
  const readingOrder = (Array.isArray(value.readingOrder) ? value.readingOrder : []).slice(0, 40)
    .map((entry, index) => {
      const paperId = normalizedPaperId(entry?.paperId);
      const reason = normalizeText(entry?.reason, 2400);
      if (!reason) {
        issues.push(issue("reading_reason_missing", `readingOrder[${index}].reason`, "Reading-order reason is required."));
      }
      validateInternalText(reason, `readingOrder[${index}].reason`, issues);
      validateModelCohortScope({
        text: reason,
        sourceText: [...refs.values()]
          .filter((entry) => entry.paperId === paperId)
          .map((entry) => entry.excerpt)
          .join(" "),
        path: `readingOrder[${index}].reason`,
        issues
      });
      validateTemporalScope({
        text: reason,
        sourceText: [...refs.values()]
          .filter((entry) => entry.paperId === paperId)
          .map((entry) => entry.excerpt)
          .join(" "),
        path: `readingOrder[${index}].reason`,
        issues
      });
      validateTrackMetricScope({
        text: reason,
        sourceText: [...refs.values()]
          .filter((entry) => entry.paperId === paperId)
          .map((entry) => entry.excerpt)
          .join(" "),
        path: `readingOrder[${index}].reason`,
        issues
      });
      validateSpecificSetupClaims({
        text: reason,
        sourceText: [...refs.values()]
          .filter((entry) => entry.paperId === paperId)
          .map((entry) => entry.excerpt)
          .join(" "),
        path: `readingOrder[${index}].reason`,
        issues
      });
      return { paperId, reason };
    });
  const actualOrder = readingOrder.map((entry) => entry.paperId);
  if (actualOrder.length !== expectedOrder.length
    || actualOrder.some((paperId, index) => paperId !== expectedOrder[index])
    || new Set(actualOrder).size !== actualOrder.length) {
    issues.push(issue(
      "reading_order_mismatch",
      "readingOrder",
      "readingOrder must include selected papers exactly once in deterministic Selection order."
    ));
  }

  const mixedCohortIds = mixedMethodCohortPaperIds(rankedItems);
  validateMixedMethodCohortSubject({
    text: `${coreTheme} ${titleAngle}`,
    path: "titleAngle",
    applies: mixedCohortIds.size > 0,
    issues
  });
  trends.forEach((entry, index) => {
    const applies = entry.supportingPaperIds.some((paperId) => mixedCohortIds.has(paperId));
    validateMixedMethodCohortSubject({ text: entry.claim, path: `trends[${index}].claim`, applies, issues });
    validateMixedMethodCohortSubject({ text: entry.caveat, path: `trends[${index}].caveat`, applies, issues });
  });
  singlePaperObservations.forEach((entry, index) => validateMixedMethodCohortSubject({
    text: `${entry.claim} ${entry.caveat}`,
    path: `singlePaperObservations[${index}].claim`,
    applies: mixedCohortIds.has(entry.paperId),
    issues
  }));
  readingOrder.forEach((entry, index) => validateMixedMethodCohortSubject({
    text: entry.reason,
    path: `readingOrder[${index}].reason`,
    applies: mixedCohortIds.has(entry.paperId),
    issues
  }));

  const normalizedIssues = uniqueIssues(issues);
  return {
    valid: normalizedIssues.length === 0,
    issues: normalizedIssues,
    editorialPlan: {
      coreTheme,
      titleAngle,
      trends,
      singlePaperObservations,
      readingOrder
    }
  };
};

export class EditorialAgentError extends Error {
  constructor(message, {
    code = "READING_LIST_EDITORIAL_PLAN_FAILED",
    stage = "editorial_plan",
    retryable = false,
    issues = [],
    cause
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "EditorialAgentError";
    this.code = code;
    this.stage = stage;
    this.paperId = "";
    this.retryable = Boolean(retryable);
    this.excludePaper = false;
    this.rejectJob = true;
    this.issues = issues;
  }
}

const abortError = () => {
  const error = new Error("Weekly report Editorial Plan was cancelled.");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
};

const waitForRetry = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (!milliseconds) {
    resolve();
    return;
  }
  if (signal?.aborted) {
    reject(abortError());
    return;
  }
  const timer = setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(abortError());
  }, { once: true });
});

const serializedError = (error, defaultStage = "editorial_plan") => ({
  code: String(error?.code || (defaultStage === "write_head_tail"
    ? "READING_LIST_HEAD_TAIL_FAILED"
    : "READING_LIST_EDITORIAL_PLAN_FAILED")),
  message: String(error?.message || (defaultStage === "write_head_tail"
    ? "Head/Tail writing failed."
    : "Editorial Plan failed.")),
  stage: String(error?.stage || defaultStage),
  paperId: "",
  retryable: Boolean(error?.retryable),
  excludePaper: false,
  rejectJob: Boolean(error?.rejectJob),
  issues: Array.isArray(error?.issues) ? error.issues : []
});

export const runEditorialPlanAgent = async ({
  selectedItems = [],
  callModel,
  signal,
  onCall,
  onEvent,
  onRepairExhausted,
  networkRetryDelayMs = 50
} = {}) => {
  const candidates = selectedInRankOrder(selectedItems);
  if (!candidates.length) {
    throw new EditorialAgentError("Editorial Plan requires at least one selected paper.", {
      code: "READING_LIST_EDITORIAL_PLAN_FAILED"
    });
  }
  if (typeof callModel !== "function") {
    throw new TypeError("Editorial Agent callModel is required.");
  }
  if (signal?.aborted) {
    throw abortError();
  }

  const calls = [];
  const invoke = async (prompt, attemptType) => {
    if (signal?.aborted) {
      throw abortError();
    }
    const startedAt = Date.now();
    let rawOutput;
    try {
      rawOutput = await callModel(prompt, {
        role: "editorial_planning",
        paperId: "",
        attemptType,
        signal
      });
    } catch (error) {
      const record = {
        role: "editorial_planning",
        paperId: "",
        attemptType,
        prompt,
        rawOutput: null,
        normalizedOutput: null,
        validation: null,
        durationMs: Math.max(0, Date.now() - startedAt),
        error: serializedError(error)
      };
      calls.push(record);
      await onCall?.(record);
      error.modelCallFailed = true;
      throw error;
    }

    let validation;
    try {
      validation = validateEditorialPlan(parseModelJson(rawOutput), { selectedItems: candidates });
    } catch (error) {
      validation = {
        valid: false,
        issues: [issue("invalid_json", "response", error.message)],
        editorialPlan: null
      };
    }
    const record = {
      role: "editorial_planning",
      paperId: "",
      attemptType,
      prompt,
      rawOutput,
      normalizedOutput: validation.editorialPlan,
      validation: { valid: validation.valid, issues: validation.issues },
      durationMs: Math.max(0, Date.now() - startedAt),
      error: null
    };
    calls.push(record);
    await onCall?.(record);
    return validation;
  };

  const invokeWithNetworkRetry = async (prompt, attemptType, invokeCall = invoke) => {
    try {
      return await invokeCall(prompt, attemptType);
    } catch (error) {
      if (!error?.modelCallFailed || error?.name === "AbortError" || signal?.aborted) {
        throw error;
      }
      await onEvent?.({
        type: "network_retry",
        stage: "editorial_plan",
        paperId: "",
        waitMs: networkRetryDelayMs,
        error: serializedError(error)
      });
      await waitForRetry(networkRetryDelayMs, signal);
      try {
        return await invokeCall(prompt, `${attemptType}_network_retry`);
      } catch (retryError) {
        if (retryError?.name === "AbortError") {
          throw retryError;
        }
        throw new EditorialAgentError("Editorial Agent model call failed after one network retry.", {
          code: "READING_LIST_EDITORIAL_PLAN_FAILED",
          retryable: false,
          cause: retryError
        });
      }
    }
  };

  let responseRepairAttempted = false;
  let validation = await invokeWithNetworkRetry(
    buildEditorialPlanPrompt({ selectedItems: candidates }),
    "initial"
  );
  if (hasOnlyResponseContractIssues(validation)) {
    const responseIssues = validation.issues;
    responseRepairAttempted = true;
    await onEvent?.({
      type: "editorial_plan_response_repair_requested",
      stage: "editorial_plan",
      attemptType: "initial",
      issues: responseIssues
    });
    validation = await invokeWithNetworkRetry(
      buildEditorialPlanResponseRepairPrompt({
        selectedItems: candidates,
        responseIssues
      }),
      "initial_response_repair"
    );
  }

  const invokePatch = async (prompt, attemptType, currentEditorialPlan, contentIssues) => {
    if (signal?.aborted) {
      throw abortError();
    }
    const startedAt = Date.now();
    let rawOutput;
    try {
      rawOutput = await callModel(prompt, {
        role: "editorial_planning",
        paperId: "",
        attemptType,
        signal
      });
    } catch (error) {
      const record = {
        role: "editorial_planning",
        paperId: "",
        attemptType,
        prompt,
        rawOutput: null,
        normalizedOutput: null,
        validation: null,
        durationMs: Math.max(0, Date.now() - startedAt),
        error: serializedError(error)
      };
      calls.push(record);
      await onCall?.(record);
      error.modelCallFailed = true;
      throw error;
    }

    let patchResult;
    let repairedValidation;
    try {
      const patchResponse = parseModelJson(rawOutput);
      patchResult = applyEditorialPlanPatch({
        editorialPlan: currentEditorialPlan,
        issues: contentIssues,
        patchResponse
      });
      repairedValidation = patchResult.valid
        ? validateEditorialPlan(patchResult.editorialPlan, { selectedItems: candidates })
        : patchResult;
      if (patchResult.valid) {
        await onEvent?.({
          type: "editorial_plan_patch_applied",
          stage: "editorial_plan",
          attemptType,
          repairPaths: patchResponse.patches.map((patch) => String(patch.path || "")),
          diff: patchResponse.patches.map((patch) => ({
            path: String(patch.path || ""),
            before: valueAtEditorialPlanPath(currentEditorialPlan, patch.path),
            after: valueAtEditorialPlanPath(patchResult.editorialPlan, patch.path)
          })),
          remainingIssues: repairedValidation.issues
        });
      }
    } catch (error) {
      repairedValidation = repairIssue("invalid_json", "response", error.message);
    }
    const record = {
      role: "editorial_planning",
      paperId: "",
      attemptType,
      prompt,
      rawOutput,
      normalizedOutput: repairedValidation.editorialPlan,
      validation: { valid: repairedValidation.valid, issues: repairedValidation.issues },
      durationMs: Math.max(0, Date.now() - startedAt),
      error: null
    };
    calls.push(record);
    await onCall?.(record);
    return repairedValidation;
  };
  if (validation.valid) {
    return {
      editorialPlan: validation.editorialPlan,
      repairAttempted: false,
      responseRepairAttempted,
      calls
    };
  }
  if (hasOnlyResponseContractIssues(validation)) {
    throw new EditorialAgentError("Editorial Plan response remains invalid after one response-format repair.", {
      code: "READING_LIST_EDITORIAL_PLAN_UNSUPPORTED",
      issues: validation.issues
    });
  }

  for (let repairAttempt = 1; ; repairAttempt += 1) {
    if (repairAttempt > 3) {
      if (typeof onRepairExhausted !== "function") {
        throw new EditorialAgentError("Editorial Plan remains unsupported after three structured repairs.", {
          code: "READING_LIST_EDITORIAL_PLAN_UNSUPPORTED",
          issues: validation.issues
        });
      }
      await onEvent?.({
        type: "editorial_plan_manual_review_requested",
        stage: "editorial_plan",
        repairAttempts: repairAttempt - 1,
        issues: validation.issues
      });
      const decision = await onRepairExhausted({
        stage: "editorial_plan",
        issues: validation.issues,
        repairAttempts: repairAttempt - 1,
        editorialPlan: validation.editorialPlan,
        ...deriveEditorialPlanReviewScope({
          editorialPlan: validation.editorialPlan,
          issues: validation.issues
        })
      });
      if (decision?.action !== "continue_repair") {
        throw new EditorialAgentError("Editorial Plan generation was stopped by the administrator.", {
          code: "READING_LIST_ADMIN_REJECTED",
          issues: validation.issues
        });
      }
    }
    const contentIssues = validation.issues;
    await onEvent?.({
      type: "editorial_plan_repair_requested",
      stage: "editorial_plan",
      repairAttempt,
      issues: contentIssues
    });
    const currentEditorialPlan = validation.editorialPlan;
    validation = await invokeWithNetworkRetry(
      buildEditorialPlanRepairPrompt({
        selectedItems: candidates,
        currentEditorialPlan,
        issues: contentIssues
      }),
      `repair_${repairAttempt}`,
      (prompt, attemptType) => invokePatch(prompt, attemptType, currentEditorialPlan, contentIssues)
    );
    if (hasOnlyResponseContractIssues(validation) && !responseRepairAttempted) {
      const responseIssues = validation.issues;
      responseRepairAttempted = true;
      await onEvent?.({
        type: "editorial_plan_response_repair_requested",
        stage: "editorial_plan",
        attemptType: `repair_${repairAttempt}`,
        issues: responseIssues
      });
      validation = await invokeWithNetworkRetry(
        buildEditorialPlanResponseRepairPrompt({
          selectedItems: candidates,
          currentEditorialPlan,
          issues: contentIssues,
          responseIssues
        }),
        `repair_${repairAttempt}_response_repair`,
        (prompt, attemptType) => invokePatch(prompt, attemptType, currentEditorialPlan, contentIssues)
      );
    }
    if (validation.valid) {
      return {
        editorialPlan: validation.editorialPlan,
        repairAttempted: true,
        repairAttempts: repairAttempt,
        responseRepairAttempted,
        calls
      };
    }
    if (hasOnlyResponseContractIssues(validation)) {
      throw new EditorialAgentError("Editorial Plan response remains invalid after one response-format repair.", {
        code: "READING_LIST_EDITORIAL_PLAN_UNSUPPORTED",
        issues: validation.issues
      });
    }
  }
};

const allowedHeadTailFields = new Set([
  "titleAngle",
  "description",
  "tags",
  "reportIntroduction",
  "trendJudgments",
  "singlePaperObservations",
  "readingOrder",
  "closingSummary"
]);

const headTailSourceText = (editorialPlan, paperDrafts) => JSON.stringify({
  editorialPlan,
  paperDrafts: (Array.isArray(paperDrafts) ? paperDrafts : []).map((draft) => ({
    paperId: draft?.paperId,
    oneSentenceTakeaway: draft?.oneSentenceTakeaway?.text,
    limitationsAndConstraints: (Array.isArray(draft?.limitationsAndConstraints)
      ? draft.limitationsAndConstraints
      : []).map((entry) => entry?.text),
    readingValue: {
      whyWorthReading: draft?.readingValue?.whyWorthReading?.text,
      recommendedFocus: draft?.readingValue?.recommendedFocus?.text,
      evidenceBoundary: draft?.readingValue?.evidenceBoundary?.text
    },
    publicationMeta: {
      title: draft?.publicationMeta?.title,
      finalScore: draft?.publicationMeta?.finalScore,
      readingTier: draft?.publicationMeta?.readingTier,
      rank: draft?.publicationMeta?.rank
    }
  }))
});

const unknownPaperIdsInText = (value, selectedIds) => {
  const ids = String(value || "").match(/\d{4}\.\d{4,5}(?:v\d+)?/gi) || [];
  return [...new Set(ids.map(normalizedPaperId).filter((paperId) => !selectedIds.has(paperId)))];
};

const validateHeadTailText = (value, {
  path,
  issues,
  selectedIds,
  numericSource = "",
  maximum = 5000,
  required = true
}) => {
  const text = normalizeText(value, maximum);
  if (required && !text) {
    issues.push(issue("head_tail_text_missing", path, "Head/Tail text is required."));
  }
  if (INTERNAL_TERM_PATTERN.test(text)) {
    issues.push(issue("internal_term_leak", path, "Head/Tail text exposes internal workflow or selection terms."));
  }
  if (MARKDOWN_STRUCTURE_PATTERN.test(text)) {
    issues.push(issue("head_tail_markdown_forbidden", path, "Head/Tail fields must not contain Markdown structure."));
  }
  if (unknownPaperIdsInText(text, selectedIds).length) {
    issues.push(issue("cross_paper_reference", path, "Head/Tail text references an unselected arXiv paper."));
  }
  if (path !== "titleAngle" && RHETORICAL_STYLE_PATTERN.test(text)) {
    const validationIssue = issue(
      "rhetorical_prose_style",
      path,
      "Head/Tail prose must use direct, neutral technical description without rhetorical or promotional wording."
    );
    validationIssue.repairKinds = ["neutral_direct_statement"];
    issues.push(validationIssue);
  }
  if (AWKWARD_CHINESE_GRAMMAR_PATTERN.test(text)) {
    const validationIssue = issue(
      "awkward_chinese_grammar",
      path,
      "Use 在奖励函数未知的情况下; do not omit the preposition 在 after 旨在."
    );
    validationIssue.repairKinds = ["missing_zai_before_condition"];
    issues.push(validationIssue);
  }
  const supportedNumbers = new Set(numericTokens(numericSource));
  [...new Set(numericTokens(text))].forEach((number) => {
    if (!supportedNumbers.has(number)) {
      issues.push(issue(
        "numeric_claim_not_in_source",
        path,
        `Exact number ${number} does not occur in the bound Editorial source.`
      ));
    }
  });
  return text;
};

const validateIndexedEditorialEntries = ({
  value,
  sourceEntries,
  collectionPath,
  indexField,
  mismatchCode,
  selectedIds,
  issues
}) => {
  const source = Array.isArray(sourceEntries) ? sourceEntries : [];
  const normalizedValue = value === undefined && source.length === 0 ? [] : value;
  if (!Array.isArray(normalizedValue)) {
    issues.push(issue("head_tail_collection_invalid", collectionPath, `${collectionPath} must be an array.`));
  }
  const returned = (Array.isArray(normalizedValue) ? normalizedValue : []).slice(0, 40);
  const indexes = returned.map((entry) => Number(entry?.[indexField]));
  if (returned.length !== source.length
    || indexes.some((index, position) => !Number.isInteger(index) || index !== position)) {
    issues.push(issue(
      mismatchCode,
      collectionPath,
      `${collectionPath} must cover every Editorial Plan entry exactly once in source order.`
    ));
  }

  return source.map((sourceEntry, index) => {
    const entry = returned.find((candidate) => Number(candidate?.[indexField]) === index) || {};
    Object.keys(entry).forEach((key) => {
      if (![indexField, "claim", "caveat"].includes(key)) {
        issues.push(issue(
          "head_tail_field_forbidden",
          `${collectionPath}[${index}].${key}`,
          "Head/Tail model returned an unknown or server-owned field."
        ));
      }
    });
    const numericSource = `${sourceEntry?.claim || ""} ${sourceEntry?.caveat || ""}`;
    const claim = validateHeadTailText(entry?.claim, {
      path: `${collectionPath}[${index}].claim`,
      issues,
      selectedIds,
      numericSource,
      maximum: 3000
    });
    const caveat = validateHeadTailText(entry?.caveat, {
      path: `${collectionPath}[${index}].caveat`,
      issues,
      selectedIds,
      numericSource,
      maximum: 2400
    });
    return {
      [indexField]: index,
      claim,
      caveat,
      ...(indexField === "trendIndex" ? {
        supportingPaperIds: [...(sourceEntry?.supportingPaperIds || [])],
        evidenceRefs: [...(sourceEntry?.evidenceRefs || [])],
        maturity: String(sourceEntry?.maturity || "")
      } : {
        paperId: String(sourceEntry?.paperId || ""),
        evidenceRefs: [...(sourceEntry?.evidenceRefs || [])]
      })
    };
  });
};

const normalizedRepetitionCharacters = (value) => Array.from(
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, "")
);

const sharesNormalizedWindow = (left, right, minimumCharacters = 24) => {
  const leftCharacters = normalizedRepetitionCharacters(left);
  const rightText = normalizedRepetitionCharacters(right).join("");
  if (leftCharacters.length < minimumCharacters || Array.from(rightText).length < minimumCharacters) {
    return false;
  }
  for (let index = 0; index <= leftCharacters.length - minimumCharacters; index += 1) {
    const window = leftCharacters.slice(index, index + minimumCharacters).join("");
    const hanCharacters = window.match(/\p{Script=Han}/gu) || [];
    if (hanCharacters.length >= 8 && rightText.includes(window)) {
      return true;
    }
  }
  return false;
};

const sharesNormalizedBigramFocus = (left, right) => {
  const normalizeFocus = (value) => String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[a-z0-9_.+-]+/gu, "")
    .replace(/[\p{P}\p{S}\s]/gu, "");
  const leftText = normalizeFocus(left);
  const rightText = normalizeFocus(right);
  if ((leftText.match(/\p{Script=Han}/gu) || []).length < 20
    || (rightText.match(/\p{Script=Han}/gu) || []).length < 20) {
    return false;
  }
  const bigrams = (text) => new Set(Array.from(text)
    .slice(0, -1)
    .map((character, index, characters) => `${character}${characters[index + 1]}`));
  const leftBigrams = bigrams(leftText);
  const rightBigrams = bigrams(rightText);
  const minimumSize = Math.min(leftBigrams.size, rightBigrams.size);
  if (!minimumSize) {
    return false;
  }
  const overlap = [...leftBigrams].filter((entry) => rightBigrams.has(entry)).length;
  return overlap / minimumSize >= 0.55;
};

const validateSinglePaperHeadTailRepetition = ({
  rankedItems,
  reportIntroduction,
  singlePaperObservations,
  closingSummary,
  paperDrafts,
  issues
}) => {
  if (rankedItems.length !== 1) {
    return;
  }
  const readerFields = [
    reportIntroduction,
    (Array.isArray(singlePaperObservations) ? singlePaperObservations : [])
      .map((entry) => `${entry?.claim || ""} ${entry?.caveat || ""}`)
      .join(" "),
    closingSummary
  ].filter(Boolean);
  const repeated = readerFields.some((text, index) => (
    readerFields.slice(index + 1).some((otherText) => sharesNormalizedWindow(text, otherText))
  )) || sharesNormalizedWindow(
    closingSummary,
    paperDrafts?.[0]?.readingValue?.recommendedFocus?.text
  ) || sharesNormalizedBigramFocus(
    closingSummary,
    paperDrafts?.[0]?.readingValue?.recommendedFocus?.text
  );
  if (!repeated) {
    return;
  }
  const validationIssue = issue(
    "head_tail_repeated_content",
    "headTailDraft",
    "A one-paper report repeats a long method, result, or reading-focus phrase across its introduction, observation, closing, or compact paper recommendation."
  );
  validationIssue.repairKinds = ["single_paper_head_tail_repetition"];
  issues.push(validationIssue);
};

export const validateHeadTailDraft = (value, {
  editorialPlan = {},
  selectedItems = [],
  paperDrafts = []
} = {}) => {
  const rankedItems = selectedInRankOrder(selectedItems);
  const expectedOrder = rankedItems.map(selectedPaperId);
  const selectedIds = new Set(expectedOrder);
  const issues = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      valid: false,
      issues: [issue("schema_invalid", "response", "headTailDraft must be an object.")],
      headTailDraft: null
    };
  }
  Object.keys(value).forEach((key) => {
    if (!allowedHeadTailFields.has(key)) {
      issues.push(issue("head_tail_field_forbidden", key, "Head/Tail model returned an unknown or server-owned field."));
    }
  });

  const allSourceText = headTailSourceText(editorialPlan, paperDrafts);
  const titleAngle = validateHeadTailText(value.titleAngle, {
    path: "titleAngle",
    issues,
    selectedIds,
    numericSource: allSourceText,
    maximum: 200
  });
  const titleLength = Array.from(titleAngle).length;
  if (titleLength < 18 || titleLength > 32) {
    issues.push(issue("title_angle_length_invalid", "titleAngle", "Title angle must contain 18-32 characters."));
  }
  if (GENERIC_TITLE_PATTERN.test(titleAngle)) {
    issues.push(issue("generic_title_angle", "titleAngle", "Title angle uses a forbidden generic slogan."));
  }
  if (RHETORICAL_STYLE_PATTERN.test(titleAngle)) {
    issues.push(issue(
      "rhetorical_title_style",
      "titleAngle",
      "Title angle must use direct, neutral technical description without rhetorical or promotional wording."
    ));
  }
  const forbiddenTitlePrefix = selectedPaperTitlePrefix(titleAngle, rankedItems);
  if (forbiddenTitlePrefix) {
    const validationIssue = issue(
      "title_paper_prefix_forbidden",
      "titleAngle",
      `titleAngle must be a standalone technical claim, not a selected paper-name prefix: ${forbiddenTitlePrefix}.`
    );
    validationIssue.repairKinds = ["paper_title_prefix"];
    issues.push(validationIssue);
  }
  const description = validateHeadTailText(value.description, {
    path: "description",
    issues,
    selectedIds,
    numericSource: allSourceText,
    maximum: 500
  });
  if (Array.from(description).length > 55) {
    issues.push(issue("description_too_long", "description", "Description must not exceed 55 characters."));
  }

  if (!Array.isArray(value.tags) || !value.tags.length || value.tags.length > 5) {
    issues.push(issue("tags_invalid", "tags", "Head/Tail requires one to five tags."));
  }
  const tags = (Array.isArray(value.tags) ? value.tags : []).slice(0, 5).map((tag, index) => {
    const normalized = validateHeadTailText(tag, {
      path: `tags[${index}]`,
      issues,
      selectedIds,
      numericSource: allSourceText,
      maximum: 80
    });
    if (Array.from(normalized).length > 30) {
      issues.push(issue("tag_too_long", `tags[${index}]`, "A tag must not exceed 30 characters."));
    }
    return normalized;
  });
  if (new Set(tags.map((tag) => tag.toLowerCase())).size !== tags.length) {
    issues.push(issue("tag_duplicate", "tags", "Tags must be unique."));
  }

  const reportIntroduction = validateHeadTailText(value.reportIntroduction, {
    path: "reportIntroduction",
    issues,
    selectedIds,
    numericSource: allSourceText
  });
  const trendJudgments = validateIndexedEditorialEntries({
    value: value.trendJudgments,
    sourceEntries: editorialPlan?.trends,
    collectionPath: "trendJudgments",
    indexField: "trendIndex",
    mismatchCode: "head_tail_trend_mapping_mismatch",
    selectedIds,
    issues
  });
  const singlePaperObservations = validateIndexedEditorialEntries({
    value: value.singlePaperObservations,
    sourceEntries: editorialPlan?.singlePaperObservations,
    collectionPath: "singlePaperObservations",
    indexField: "observationIndex",
    mismatchCode: "head_tail_observation_mapping_mismatch",
    selectedIds,
    issues
  });

  if (!Array.isArray(value.readingOrder)) {
    issues.push(issue("reading_order_invalid", "readingOrder", "readingOrder must be an array."));
  }
  const readingOrder = (Array.isArray(value.readingOrder) ? value.readingOrder : []).slice(0, 40)
    .map((entry, index) => ({
      paperId: normalizedPaperId(entry?.paperId),
      reason: validateHeadTailText(entry?.reason, {
        path: `readingOrder[${index}].reason`,
        issues,
        selectedIds,
        numericSource: allSourceText,
        maximum: 2400
      })
    }));
  const actualOrder = readingOrder.map((entry) => entry.paperId);
  if (actualOrder.length !== expectedOrder.length
    || actualOrder.some((paperId, index) => paperId !== expectedOrder[index])
    || new Set(actualOrder).size !== actualOrder.length) {
    issues.push(issue(
      "reading_order_mismatch",
      "readingOrder",
      "Head/Tail readingOrder must preserve deterministic Selection order."
    ));
  }
  const closingSummary = validateHeadTailText(value.closingSummary, {
    path: "closingSummary",
    issues,
    selectedIds,
    numericSource: allSourceText
  });

  validateSinglePaperHeadTailRepetition({
    rankedItems,
    reportIntroduction,
    singlePaperObservations,
    closingSummary,
    paperDrafts,
    issues
  });

  const scopeEvidence = [...evidenceReferenceMap(rankedItems).values()]
    .map((entry) => entry.excerpt)
    .join(" ");
  [
    ["titleAngle", titleAngle],
    ["description", description],
    ["reportIntroduction", reportIntroduction],
    ...trendJudgments.flatMap((entry, index) => [
      [`trendJudgments[${index}].claim`, entry.claim],
      [`trendJudgments[${index}].caveat`, entry.caveat]
    ]),
    ...singlePaperObservations.flatMap((entry, index) => [
      [`singlePaperObservations[${index}].claim`, entry.claim],
      [`singlePaperObservations[${index}].caveat`, entry.caveat]
    ]),
    ...readingOrder.map((entry, index) => [`readingOrder[${index}].reason`, entry.reason]),
    ["closingSummary", closingSummary]
  ].forEach(([path, text]) => validateMetricLabelSupport({
    text,
    sourceText: scopeEvidence,
    path,
    issues
  }));
  [
    ["titleAngle", titleAngle],
    ["description", description],
    ["reportIntroduction", reportIntroduction],
    ...trendJudgments.flatMap((entry, index) => [
      [`trendJudgments[${index}].claim`, entry.claim],
      [`trendJudgments[${index}].caveat`, entry.caveat]
    ]),
    ...singlePaperObservations.flatMap((entry, index) => [
      [`singlePaperObservations[${index}].claim`, entry.claim],
      [`singlePaperObservations[${index}].caveat`, entry.caveat]
    ]),
    ...readingOrder.map((entry, index) => [`readingOrder[${index}].reason`, entry.reason]),
    ["closingSummary", closingSummary]
  ].forEach(([path, text]) => validateModelCohortScope({
    text,
    sourceText: scopeEvidence,
    path,
    issues
  }));
  [
    ["titleAngle", titleAngle],
    ["description", description],
    ["reportIntroduction", reportIntroduction],
    ...trendJudgments.flatMap((entry, index) => [
      [`trendJudgments[${index}].claim`, entry.claim],
      [`trendJudgments[${index}].caveat`, entry.caveat]
    ]),
    ...singlePaperObservations.flatMap((entry, index) => [
      [`singlePaperObservations[${index}].claim`, entry.claim],
      [`singlePaperObservations[${index}].caveat`, entry.caveat]
    ]),
    ...readingOrder.map((entry, index) => [`readingOrder[${index}].reason`, entry.reason]),
    ["closingSummary", closingSummary]
  ].forEach(([path, text]) => validateTemporalScope({
    text,
    sourceText: scopeEvidence,
    path,
    issues
  }));
  [
    ["titleAngle", titleAngle],
    ["description", description],
    ["reportIntroduction", reportIntroduction],
    ...trendJudgments.flatMap((entry, index) => [
      [`trendJudgments[${index}].claim`, entry.claim],
      [`trendJudgments[${index}].caveat`, entry.caveat]
    ]),
    ...singlePaperObservations.flatMap((entry, index) => [
      [`singlePaperObservations[${index}].claim`, entry.claim],
      [`singlePaperObservations[${index}].caveat`, entry.caveat]
    ]),
    ...readingOrder.map((entry, index) => [`readingOrder[${index}].reason`, entry.reason]),
    ["closingSummary", closingSummary]
  ].forEach(([path, text]) => validateTrackMetricScope({
    text,
    sourceText: scopeEvidence,
    path,
    issues
  }));
  [
    ["titleAngle", titleAngle],
    ["description", description],
    ["reportIntroduction", reportIntroduction],
    ...trendJudgments.flatMap((entry, index) => [
      [`trendJudgments[${index}].claim`, entry.claim],
      [`trendJudgments[${index}].caveat`, entry.caveat]
    ]),
    ...singlePaperObservations.flatMap((entry, index) => [
      [`singlePaperObservations[${index}].claim`, entry.claim],
      [`singlePaperObservations[${index}].caveat`, entry.caveat]
    ]),
    ...readingOrder.map((entry, index) => [`readingOrder[${index}].reason`, entry.reason]),
    ["closingSummary", closingSummary]
  ].forEach(([path, text]) => validateSpecificSetupClaims({
    text,
    sourceText: scopeEvidence,
    path,
    issues
  }));

  const mixedCohortIds = mixedMethodCohortPaperIds(rankedItems);
  [
    ["titleAngle", titleAngle],
    ["description", description],
    ["reportIntroduction", reportIntroduction],
    ...trendJudgments.flatMap((entry, index) => [
      [`trendJudgments[${index}].claim`, entry.claim],
      [`trendJudgments[${index}].caveat`, entry.caveat]
    ]),
    ["closingSummary", closingSummary]
  ].forEach(([path, text]) => validateMixedMethodCohortSubject({
    text,
    path,
    applies: mixedCohortIds.size > 0,
    issues
  }));
  singlePaperObservations.forEach((entry, index) => validateMixedMethodCohortSubject({
    text: `${entry.claim} ${entry.caveat}`,
    path: `singlePaperObservations[${index}].claim`,
    applies: mixedCohortIds.has(entry.paperId),
    issues
  }));
  readingOrder.forEach((entry, index) => validateMixedMethodCohortSubject({
    text: entry.reason,
    path: `readingOrder[${index}].reason`,
    applies: mixedCohortIds.has(entry.paperId),
    issues
  }));

  const normalizedIssues = uniqueIssues(issues);
  return {
    valid: normalizedIssues.length === 0,
    issues: normalizedIssues,
    headTailDraft: {
      titleAngle,
      description,
      tags,
      reportIntroduction,
      trendJudgments,
      singlePaperObservations,
      readingOrder,
      closingSummary
    }
  };
};

export const runHeadTailWriter = async ({
  editorialPlan = {},
  selectedItems = [],
  paperDrafts = [],
  callModel,
  signal,
  onCall,
  onEvent,
  networkRetryDelayMs = 50
} = {}) => {
  const candidates = selectedInRankOrder(selectedItems);
  if (!candidates.length) {
    throw new EditorialAgentError("Head/Tail writing requires selected papers.", {
      code: "READING_LIST_HEAD_TAIL_FAILED",
      stage: "write_head_tail"
    });
  }
  if (typeof callModel !== "function") {
    throw new TypeError("Head/Tail Writer callModel is required.");
  }
  if (signal?.aborted) {
    throw abortError();
  }

  const calls = [];
  const invoke = async (prompt, attemptType) => {
    if (signal?.aborted) {
      throw abortError();
    }
    const startedAt = Date.now();
    let rawOutput;
    try {
      rawOutput = await callModel(prompt, {
        role: "editorial_head_tail_writer",
        paperId: "",
        attemptType,
        signal
      });
    } catch (error) {
      const record = {
        role: "editorial_head_tail_writer",
        paperId: "",
        attemptType,
        prompt,
        rawOutput: null,
        normalizedOutput: null,
        validation: null,
        durationMs: Math.max(0, Date.now() - startedAt),
        error: serializedError(error, "write_head_tail")
      };
      calls.push(record);
      await onCall?.(record);
      error.modelCallFailed = true;
      throw error;
    }

    let validation;
    try {
      validation = validateHeadTailDraft(parseModelJson(rawOutput), {
        editorialPlan,
        selectedItems: candidates,
        paperDrafts
      });
    } catch (error) {
      validation = {
        valid: false,
        issues: [issue("invalid_json", "response", error.message)],
        headTailDraft: null
      };
    }
    const record = {
      role: "editorial_head_tail_writer",
      paperId: "",
      attemptType,
      prompt,
      rawOutput,
      normalizedOutput: validation.headTailDraft,
      validation: { valid: validation.valid, issues: validation.issues },
      durationMs: Math.max(0, Date.now() - startedAt),
      error: null
    };
    calls.push(record);
    await onCall?.(record);
    return validation;
  };

  const invokeWithNetworkRetry = async (prompt, attemptType) => {
    try {
      return await invoke(prompt, attemptType);
    } catch (error) {
      if (!error?.modelCallFailed || error?.name === "AbortError" || signal?.aborted) {
        throw error;
      }
      await onEvent?.({
        type: "network_retry",
        stage: "write_head_tail",
        paperId: "",
        waitMs: networkRetryDelayMs,
        error: serializedError(error, "write_head_tail")
      });
      await waitForRetry(networkRetryDelayMs, signal);
      try {
        return await invoke(prompt, `${attemptType}_network_retry`);
      } catch (retryError) {
        if (retryError?.name === "AbortError") {
          throw retryError;
        }
        throw new EditorialAgentError("Head/Tail model call failed after one network retry.", {
          code: "READING_LIST_HEAD_TAIL_FAILED",
          stage: "write_head_tail",
          retryable: false,
          cause: retryError
        });
      }
    }
  };

  const promptOptions = { editorialPlan, selectedItems: candidates, paperDrafts };
  let responseRepairAttempted = false;
  let validation = await invokeWithNetworkRetry(
    buildHeadTailPrompt(promptOptions),
    "initial"
  );
  if (hasOnlyResponseContractIssues(validation)) {
    const responseIssues = validation.issues;
    responseRepairAttempted = true;
    await onEvent?.({
      type: "head_tail_response_repair_requested",
      stage: "write_head_tail",
      attemptType: "initial",
      issues: responseIssues
    });
    validation = await invokeWithNetworkRetry(
      buildHeadTailResponseRepairPrompt({ ...promptOptions, responseIssues }),
      "initial_response_repair"
    );
  }
  if (validation.valid) {
    return {
      headTailDraft: validation.headTailDraft,
      repairAttempted: false,
      responseRepairAttempted,
      calls
    };
  }
  if (hasOnlyResponseContractIssues(validation)) {
    throw new EditorialAgentError("Head/Tail response remains invalid after one response-format repair.", {
      code: "READING_LIST_HEAD_TAIL_UNSUPPORTED",
      stage: "write_head_tail",
      issues: validation.issues
    });
  }

  const contentIssues = validation.issues;
  await onEvent?.({
    type: "head_tail_repair_requested",
    stage: "write_head_tail",
    issues: contentIssues
  });
  validation = await invokeWithNetworkRetry(
    buildHeadTailRepairPrompt({ ...promptOptions, issues: contentIssues }),
    "repair"
  );
  if (hasOnlyResponseContractIssues(validation) && !responseRepairAttempted) {
    const responseIssues = validation.issues;
    responseRepairAttempted = true;
    await onEvent?.({
      type: "head_tail_response_repair_requested",
      stage: "write_head_tail",
      attemptType: "repair",
      issues: responseIssues
    });
    validation = await invokeWithNetworkRetry(
      buildHeadTailResponseRepairPrompt({
        ...promptOptions,
        issues: contentIssues,
        responseIssues
      }),
      "repair_response_repair"
    );
  }
  if (!validation.valid) {
    throw new EditorialAgentError("Head/Tail remains unsupported after one structured repair.", {
      code: "READING_LIST_HEAD_TAIL_UNSUPPORTED",
      stage: "write_head_tail",
      issues: validation.issues
    });
  }

  return {
    headTailDraft: validation.headTailDraft,
    repairAttempted: true,
    responseRepairAttempted,
    calls
  };
};
