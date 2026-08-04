import {
  buildPaperSectionPrompt,
  buildPaperSectionRepairPrompt
} from "./prompts.js";

const EVIDENCE_FIELDS = [
  "problem",
  "method",
  "systemDesign",
  "experiments",
  "results",
  "limitations",
  "affiliations"
];
const REQUIRED_GROUNDED_FIELDS = [
  "oneSentenceTakeaway",
  "researchProblem",
  "coreContribution",
  "methodFramework",
  "experimentsAndResults",
  "adnInsight"
];
const REQUIRED_READING_VALUE_FIELDS = [
  "whyWorthReading",
  "recommendedFocus",
  "evidenceBoundary"
];
const ALLOWED_TOP_LEVEL_FIELDS = new Set([
  "paperId",
  ...REQUIRED_GROUNDED_FIELDS,
  "limitationsAndConstraints",
  "readingValue"
]);
const INTERNAL_TERM_PATTERN = /\bfallback\b|\bthresholds?\b|阈值|复评分|复评阈值|保底补入|内部筛选|候选下限|\bselection\s*reason\b|\bselectionreason\b|\bagent\s+(?:loop|stage)\b|\bprompts?\b|\bartifacts?\b|\binternal\s+json\b|内部\s*json|定向重评|横向校准/iu;
const RHETORICAL_STYLE_PATTERN = /不等于|并非.{0,12}而是|揭示|迈向|赋能|解锁|重塑|颠覆|革命性?|坚实(?:的)?(?:量化)?证据|有效(?:解决|方法|暴露|测试)|不排除未来.{0,30}(?:可能|改进|消除)|鸿沟|浪潮|拐点|破局|\breveal(?:s|ed|ing)?\b|\bunlock(?:s|ed|ing)?\b|\breshape(?:s|d|ing)?\b|\brevolutionary\b/iu;
const LIMITED_TOP_MODEL_EVIDENCE_PATTERN = /\b(?:the\s+)?(?:strongest|best(?:-performing)?|best\s+performer)\s+models?\b/iu;
const BROAD_MODEL_SUBJECT_PATTERN = /(?:前沿|当前|现有)?(?:大语言模型|大模型|语言模型|模型)|(?:frontier\s+)?(?:LLMs?|large\s+language\s+models?|models?)/iu;
const POSITIVE_MODEL_PERFORMANCE_PATTERN = /(?:表现|能力|胜率).{0,14}(?:优异|突出|较高|较强|领先)|(?:优异|突出|较高|较强|领先).{0,8}(?:表现|能力|胜率)|(?:achiev(?:e|es|ed|ing)\s+)?(?:high|strong|excellent|outstanding|superior)\s+(?:performance|win\s+rates?|capabilit(?:y|ies))|(?:performance|win\s+rates?|capabilit(?:y|ies)).{0,14}(?:high|strong|excellent|outstanding|superior)/iu;
const QUALIFIED_MODEL_SUBSET_PATTERN = /部分|其中|表现最(?:好|佳|强)|最(?:好|佳|强)的?|最佳|最强|领先的|Gemini|GPT|Claude|DeepSeek|Grok|strongest|best[-\s]?perform/iu;
const LIMITED_NEGATIVE_RESULT_SOURCE_PATTERN = /\b(?:Gemini|GPT|Claude|DeepSeek|Grok)\b|\bbest\s+(?:overall|method|model|system)\b/iu;
const NEGATIVE_MODEL_PERFORMANCE_PATTERN = /显著不足|明显不足|性能.{0,8}下降|表现.{0,8}下降|失败模式|较差|不稳定|\b(?:shortcoming|failure|degrad(?:e|es|ed|ation)|underperform(?:s|ed|ing)?)\b/iu;
const QUALIFIED_EVALUATED_COHORT_PATTERN = /所评估|评估的|参与测试|接受测试|部分|某些|具体|上述|Gemini|GPT|Claude|DeepSeek|Grok|\b(?:evaluated|tested|participating|specific|some|named)\b/iu;
const TRACK_SCOPED_MODEL_COUNT_SOURCE_PATTERN = /\b(?:encounter|day)[-\s]?track\b.{0,120}\b(?:evaluates?|compares?|tests?)\b.{0,40}\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+models?\b/iu;
const MODEL_COUNT_CLAIM_PATTERN = /(?:[一二三四五六七八九十百]+|\d+)个(?:前沿|语言|大语言|受测|所评估|特定)?模型(?:版本)?|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:frontier\s+|evaluated\s+|specific\s+)?model(?:s|\s+versions?)\b/iu;
const TRACK_SCOPE_QUALIFIER_PATTERN = /遭遇(?:赛道|轨道|场景)|连续(?:遭遇|任务)|(?:该|本|这个)赛道|\b(?:encounter|day)[-\s]?(?:track|scenario)?\b|\b(?:this|the)\s+track\b/iu;
const LONG_HORIZON_CLAIM_PATTERN = /中长期|长期|长周期|长时程|\blong[-\s]?(?:term|horizon)\b/iu;
const LONG_HORIZON_SOURCE_PATTERN = /长期|长周期|长时程|\blong[-\s]?(?:term|horizon)\b/iu;
const AWKWARD_TRANSLATION_PATTERN = /中时间跨度|自主决策网络/u;
const SINGLE_STEP_CLAIM_PATTERN = /单步(?:骤)?(?:内)?|\bsingle[-\s]?step\b/iu;
const SINGLE_ENCOUNTER_SOURCE_PATTERN = /\bsingle[-\s]?(?:encounter|fight)\b/iu;
const SINGLE_STEP_SOURCE_PATTERN = /\b(?:single[-\s]?step|one\s+step|at\s+each\s+step)\b/iu;
const PERSISTENT_HIT_POINTS_SOURCE_PATTERN = /\bpersistent\s+hit\s+points?\b/iu;
const AWKWARD_PERSISTENT_HP_PATTERN = /持续生命值/u;
const ENCOUNTER_DAY_SOURCE_PATTERN = /\b(?:linked\s+)?encounter\s+days?\b|\bclear(?:s|ed)?\s+(?:none|one|two|three|four|five|\d+)\s+(?:of\s+(?:one|two|three|four|five|\d+)\s+)?days?\b/iu;
const AWKWARD_ENCOUNTER_DAY_PATTERN = /(?:通过|未通过|五个|多个)日程|日程中/u;
const DAY_WIN_RATE_CLAIM_PATTERN = /(?:\bday\b|战斗日|跨(?:场景|战斗日)).{0,36}(?:胜率|\bwin\s+rates?\b)|(?:胜率|\bwin\s+rates?\b).{0,36}(?:\bday\b|战斗日|跨(?:场景|战斗日))/iu;
const DAY_WIN_RATE_SOURCE_PATTERN = /\bday(?:-track)?\b.{0,160}\bwin\s+rates?\b|\bwin\s+rates?\b.{0,160}\bday(?:-track)?\b/iu;
const EXACT_EVIDENCE_LINKING_LIMITATION_PATTERN = /(?:词级.{0,20}grounding|grounding\s*F1|确切(?:的)?(?:支撑|支持)证据|精确证据关联|来源页面)/iu;
const PERFORMANCE_RESTATED_AS_LIMITATION_PATTERN = /(?:模型|系统).{0,36}(?:表现|能力|性能|差距|失败).{0,36}(?:局限|不足)|表明.{0,20}(?:模型|系统).{0,30}(?:局限|不足)/u;
const MATERIAL_STUDY_BOUNDARY_PATTERN = /评估范围|适用范围|仅限|限定于|样本|场景|种子|对手|模型版本|数据集|数据|未(?:覆盖|评估|验证)|不(?:涵盖|包括|覆盖)|依赖|成本对比|价格|标注者|脚本教师|比较对象/u;
const INLINE_EVIDENCE_REF_PATTERN = /\[[^\]]*(?:problem|method|systemDesign|experiments|results|limitations|affiliations):\d+[^\]]*\]/u;
const INLINE_EVIDENCE_REF_REPLACE_PATTERN = /\[[^\]]*(?:problem|method|systemDesign|experiments|results|limitations|affiliations):\d+[^\]]*\]/gu;
const SPECIFIC_SETUP_REQUIREMENTS = Object.freeze([
  {
    claim: /完整(?:的)?战术观察|\bcomplete\s+tactical\s+observations?\b/iu,
    source: /完整(?:的)?战术观察|\bcomplete\s+tactical\s+observations?\b/iu
  },
  {
    claim: /未来压力.{0,10}完全可观察|完全可观察.{0,10}未来压力|\bfully\s+observable\b/iu,
    source: /未来压力.{0,10}完全可观察|完全可观察.{0,10}未来压力|\bfully\s+observable\b/iu
  },
  {
    claim: /隐藏信息(?:的)?复杂性|\bhidden[-\s]?information\s+complexity\b/iu,
    source: /隐藏信息(?:的)?复杂性|\bhidden[-\s]?information\s+complexity\b/iu
  },
  {
    claim: /启发式(?:对手|敌手)(?:控制器)?|\bheuristic\s+(?:adversary|opponent)\s+controllers?\b/iu,
    source: /启发式(?:对手|敌手)(?:控制器)?|(?:对方|敌方).{0,40}(?:同一个|相同的?)?启发式(?:规划器|控制器)|\bheuristic\s+(?:adversary|opponent)\s+controllers?\b|\bopposing\s+sides\b.{0,80}\bheuristic\s+planner\b/iu
  },
  {
    claim: /固定(?:的)?启发式(?:规划器|控制器)|\bfixed\s+heuristic\s+(?:planner|controller)\b/iu,
    source: /固定(?:的)?启发式(?:规划器|控制器)|\bfixed\s+heuristic\s+(?:planner|controller)\b/iu
  },
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
    claim: /显著(?:下降|差距|不足|退化)|\bsignificant(?:ly)?\s+(?:decline|drop|gap|degradation)\b/iu,
    source: /显著|\bsignificant(?:ly)?\b/iu
  },
  {
    claim: /(?:未|没有)(?:通过|完成)任何(?:赛道|轨道)|一个(?:赛道|轨道)都(?:未|没)(?:通过|完成)|\bclear(?:s|ed)?\s+no\s+tracks?\b/iu,
    source: /(?:未|没有)(?:通过|完成)任何(?:赛道|轨道)|一个(?:赛道|轨道)都(?:未|没)(?:通过|完成)|\bclear(?:s|ed)?\s+no\s+tracks?\b/iu
  }
]);

const normalizeText = (value, maximum = 4000) => String(value || "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, maximum);

const normalizedPaperId = (value) => {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/(?:^|\/)(\d{4}\.\d{4,5})(?:v\d+)?(?:$|[?#/])/i);
  return match?.[1] || text.replace(/v\d+$/i, "");
};

const paperIdForItem = (item) => normalizedPaperId(
  item?.reviewResult?.paperId || item?.contextPacket?.paperId || item?.paper?.id
);

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
};

const validateTrackScopedModelCounts = ({ text, sourceText, path, issues }) => {
  if (!TRACK_SCOPED_MODEL_COUNT_SOURCE_PATTERN.test(sourceText)) {
    return;
  }
  const clauses = normalizeText(text, 12000).split(/[，,。！？!?；;\n]+/u).filter(Boolean);
  const encounterScoped = /\bencounter[-\s]?track\b.{0,120}\b(?:evaluates?|compares?|tests?)\b.{0,40}\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+models?\b/iu.test(sourceText);
  const dayScoped = /\bday[-\s]?track\b.{0,120}\b(?:evaluates?|compares?|tests?)\b.{0,40}\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+models?\b/iu.test(sourceText);
  if (clauses.some((clause) => (
    MODEL_COUNT_CLAIM_PATTERN.test(clause)
    && ((encounterScoped && /\bencounter\b/iu.test(clause) && /\bday\b/iu.test(clause))
      || (dayScoped && /\bday\b/iu.test(clause) && /\bencounter\b/iu.test(clause)))
  ))) {
    issues.push(issue(
      "model_count_track_scope_mismatch",
      path,
      "A model count from one track cannot be attached to both Encounter and Day tracks."
    ));
  }
  if (clauses.some((clause) => (
    MODEL_COUNT_CLAIM_PATTERN.test(clause)
    && !TRACK_SCOPE_QUALIFIER_PATTERN.test(clause)
  ))) {
    issues.push(issue(
      "model_count_track_scope_missing",
      path,
      "A model count scoped to one experimental track must retain that track qualifier in the same clause."
    ));
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
      "A medium-horizon or multi-encounter result cannot be expanded to long-term or long-horizon performance without explicit cited Evidence."
    ));
  }
};

const validateEncounterScopeAndTerminology = ({ text, sourceText, path, issues }) => {
  if (SINGLE_STEP_CLAIM_PATTERN.test(text)
    && SINGLE_ENCOUNTER_SOURCE_PATTERN.test(sourceText)
    && !SINGLE_STEP_SOURCE_PATTERN.test(sourceText)) {
    const validationIssue = issue(
      "single_encounter_recast_as_single_step",
      path,
      "A single-encounter result cannot be rewritten as single-step decision performance."
    );
    validationIssue.repairKinds = ["single_encounter_scope"];
    issues.push(validationIssue);
  }
  if (AWKWARD_PERSISTENT_HP_PATTERN.test(text) && PERSISTENT_HIT_POINTS_SOURCE_PATTERN.test(sourceText)) {
    const validationIssue = issue(
      "awkward_domain_translation",
      path,
      "Translate persistent hit points as cross-encounter retained hit points, not 持续生命值."
    );
    validationIssue.repairKinds = ["persistent_hit_points_translation"];
    issues.push(validationIssue);
  }
  if (AWKWARD_ENCOUNTER_DAY_PATTERN.test(text) && ENCOUNTER_DAY_SOURCE_PATTERN.test(sourceText)) {
    const validationIssue = issue(
      "awkward_domain_translation",
      path,
      "Translate encounter days or cleared days as 战斗日/Day 场景, not 日程."
    );
    validationIssue.repairKinds = ["encounter_day_translation"];
    issues.push(validationIssue);
  }
  if (DAY_WIN_RATE_CLAIM_PATTERN.test(text) && !DAY_WIN_RATE_SOURCE_PATTERN.test(sourceText)) {
    const validationIssue = issue(
      "track_metric_scope_mismatch",
      path,
      "Encounter win rate and Day clear-count results must remain separate; do not attach win rate to Day or cross-day outcomes."
    );
    validationIssue.repairKinds = ["encounter_day_metric_scope"];
    issues.push(validationIssue);
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
      `Unsupported setup or resource premise(s): ${unsupported.map((entry) => entry.term).join(", ")}. Remove or replace these exact terms unless this field cites an excerpt that directly states them or satisfies their configured entailment rule.`
    );
    validationIssue.repairKinds = [...new Set(unsupported.map((entry) => entry.kind).filter(Boolean))];
    issues.push(validationIssue);
  }
};

const parseModelJson = (raw) => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (raw.paperId || raw.oneSentenceTakeaway || raw.researchProblem) {
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
  }

  const text = String(raw || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new TypeError("Paper Section Writer did not return a JSON object.");
  }
  return JSON.parse(text.slice(start, end + 1));
};

const evidenceReferenceMap = (item) => {
  const refs = new Map();
  EVIDENCE_FIELDS.forEach((field) => {
    (Array.isArray(item?.evidenceCard?.[field]?.sources)
      ? item.evidenceCard[field].sources
      : []).forEach((source, index) => {
      refs.set(`${field}:${index}`, {
        field,
        index,
        excerpt: normalizeText(source?.excerpt, 12000)
      });
    });
  });
  return refs;
};

const MONTH_NUMBERS = Object.freeze({
  january: "1", jan: "1",
  february: "2", feb: "2",
  march: "3", mar: "3",
  april: "4", apr: "4",
  may: "5",
  june: "6", jun: "6",
  july: "7", jul: "7",
  august: "8", aug: "8",
  september: "9", sept: "9", sep: "9",
  october: "10", oct: "10",
  november: "11", nov: "11",
  december: "12", dec: "12"
});
const ENGLISH_NUMBER_WORDS = Object.freeze({
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12"
});

const numericTokens = (value) => {
  const text = normalizeText(value, 12000).replace(INLINE_EVIDENCE_REF_REPLACE_PATTERN, " ");
  const explicit = text.match(/(?<![A-Za-z0-9_])\d+(?:[.,]\d+)*(?:\s*%)?/g)
    ?.map((token) => token.replace(/\s+/g, "").replace(/,/g, "")) || [];
  // English month names in dates are capitalized. Keep matching case-sensitive so
  // ordinary words such as "may" do not become a fabricated numeric token 5.
  const months = [...text.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\b/gu)]
    .map((match) => MONTH_NUMBERS[match[1].toLowerCase()]);
  const numberWords = [...text.matchAll(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/giu)]
    .map((match) => ENGLISH_NUMBER_WORDS[match[1].toLowerCase()]);
  return [...explicit, ...months, ...numberWords];
};

const validatePercentageMetricLabels = ({ text, evidenceRefs, refs, path, issues }) => {
  const clauses = normalizeText(text, 12000).split(/[，,。！？!?；;\n]+/u).filter(Boolean);
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

const crossPaperIds = (value, expectedPaperId) => {
  const ids = String(value || "").match(/\d{4}\.\d{4,5}(?:v\d+)?/gi) || [];
  return [...new Set(ids.map(normalizedPaperId).filter((paperId) => paperId !== expectedPaperId))];
};

const validateGroundedText = (value, {
  path,
  expectedPaperId,
  refs,
  issues
}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(issue("grounded_text_invalid", path, "Writer field must contain text and evidenceRefs."));
    return { text: "", evidenceRefs: [] };
  }
  Object.keys(value).forEach((key) => {
    if (!["text", "evidenceRefs"].includes(key)) {
      issues.push(issue(
        "writer_field_forbidden",
        `${path}.${key}`,
        "Writer may return only text and evidenceRefs in a grounded field."
      ));
    }
  });

  const text = normalizeText(value.text, 5000);
  const evidenceRefs = [...new Set((Array.isArray(value.evidenceRefs) ? value.evidenceRefs : [])
    .map((entry) => normalizeText(entry, 120))
    .filter(Boolean))];
  if (!text) {
    issues.push(issue("writer_text_missing", `${path}.text`, "Writer text is required."));
  }
  if (!evidenceRefs.length) {
    issues.push(issue("writer_evidence_missing", `${path}.evidenceRefs`, "Writer text requires cited Evidence."));
  }
  evidenceRefs.forEach((reference, index) => {
    if (!refs.has(reference)) {
      issues.push(issue(
        "evidence_ref_unknown",
        `${path}.evidenceRefs[${index}]`,
        "Writer cites a nonexistent Evidence ref."
      ));
    }
  });

  const citedExcerptText = evidenceRefs
    .map((reference) => refs.get(reference)?.excerpt || "")
    .join(" ");
  const citedNumbers = new Set(numericTokens(citedExcerptText));
  [...new Set(numericTokens(text))].forEach((number) => {
    if (!citedNumbers.has(number)) {
      issues.push(issue(
        "numeric_claim_not_in_evidence",
        `${path}.text`,
        `Exact number ${number} does not occur in the cited Evidence excerpts.`
      ));
    }
  });
  validatePercentageMetricLabels({
    text,
    evidenceRefs,
    refs,
    path: `${path}.text`,
    issues
  });
  if (INTERNAL_TERM_PATTERN.test(text)) {
    issues.push(issue(
      "internal_term_leak",
      `${path}.text`,
      "Paper prose must not expose internal workflow or selection terms."
    ));
  }
  if (RHETORICAL_STYLE_PATTERN.test(text)) {
    issues.push(issue(
      "rhetorical_prose_style",
      `${path}.text`,
      "Paper prose must use direct, neutral technical description without rhetorical or promotional wording."
    ));
  }
  if (AWKWARD_TRANSLATION_PATTERN.test(text)) {
    issues.push(issue(
      "awkward_literal_translation",
      `${path}.text`,
      "Use natural technical Chinese; translate medium-horizon as 中期 or describe the concrete multi-step span."
    ));
  }
  if (INLINE_EVIDENCE_REF_PATTERN.test(text)) {
    issues.push(issue(
      "inline_evidence_ref_leak",
      `${path}.text`,
      "Evidence refs belong only in the evidenceRefs array and must not appear in reader-facing text."
    ));
  }
  if (crossPaperIds(text, expectedPaperId).length) {
    issues.push(issue(
      "cross_paper_reference",
      `${path}.text`,
      "Paper prose references another arXiv paper."
    ));
  }
  validateModelCohortScope({
    text,
    sourceText: citedExcerptText,
    path: `${path}.text`,
    issues
  });
  validateTrackScopedModelCounts({
    text,
    sourceText: citedExcerptText,
    path: `${path}.text`,
    issues
  });
  validateTemporalScope({ text, sourceText: citedExcerptText, path: `${path}.text`, issues });
  validateEncounterScopeAndTerminology({ text, sourceText: citedExcerptText, path: `${path}.text`, issues });
  validateSpecificSetupClaims({ text, sourceText: citedExcerptText, path: `${path}.text`, issues });
  return { text, evidenceRefs };
};

const publicationMetaFor = (item, paperId) => {
  const title = normalizeText(item?.paper?.title, 800);
  const affiliations = (Array.isArray(item?.reviewResult?.affiliations)
    ? item.reviewResult.affiliations
    : []).map((entry) => normalizeText(entry, 500)).filter(Boolean).join("、");
  return {
    title,
    url: `https://arxiv.org/abs/${paperId}`,
    affiliations: affiliations || "单位线索不足",
    finalScore: Number(item?.selection?.finalScore),
    readingTier: normalizeText(item?.selection?.readingTier, 80).toLowerCase(),
    rank: Number(item?.selection?.rank),
    reviewScores: {
      scenarioProblemValue: Number(item?.reviewResult?.scores?.scenarioProblemValue),
      methodNovelty: Number(item?.reviewResult?.scores?.methodNovelty),
      practicalValue: Number(item?.reviewResult?.scores?.practicalValue),
      evidence: Number(item?.reviewResult?.scores?.evidence)
    }
  };
};

export const validatePaperDraft = (value, { item } = {}) => {
  const expectedPaperId = paperIdForItem(item);
  const refs = evidenceReferenceMap(item);
  const issues = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      valid: false,
      issues: [issue("schema_invalid", "response", "paperDraft must be an object.")],
      paperDraft: null
    };
  }

  Object.keys(value).forEach((key) => {
    if (!ALLOWED_TOP_LEVEL_FIELDS.has(key)) {
      issues.push(issue(
        "writer_field_forbidden",
        key,
        "Writer returned a server-owned or unknown paperDraft field."
      ));
    }
  });
  const actualPaperId = normalizedPaperId(value.paperId);
  if (!expectedPaperId || actualPaperId !== expectedPaperId) {
    issues.push(issue("paper_id_mismatch", "paperId", "paperDraft paperId does not match its input paper."));
  }

  const normalized = { paperId: expectedPaperId };
  REQUIRED_GROUNDED_FIELDS.forEach((field) => {
    normalized[field] = validateGroundedText(value[field], {
      path: field,
      expectedPaperId,
      refs,
      issues
    });
  });

  if (!Array.isArray(value.limitationsAndConstraints)
    || value.limitationsAndConstraints.length < 2) {
    issues.push(issue(
      "limitations_insufficient",
      "limitationsAndConstraints",
      "paperDraft requires at least two separately grounded limitations or constraints."
    ));
  }
  normalized.limitationsAndConstraints = (Array.isArray(value.limitationsAndConstraints)
    ? value.limitationsAndConstraints
    : []).slice(0, 12).map((entry, index) => validateGroundedText(entry, {
    path: `limitationsAndConstraints[${index}]`,
    expectedPaperId,
    refs,
    issues
  }));
  normalized.limitationsAndConstraints.forEach((entry, index) => {
    if (PERFORMANCE_RESTATED_AS_LIMITATION_PATTERN.test(entry.text)
      && !MATERIAL_STUDY_BOUNDARY_PATTERN.test(entry.text)) {
      issues.push(issue(
        "limitation_not_study_boundary",
        `limitationsAndConstraints[${index}].text`,
        "A performance gap is a result, not a separate study limitation; state an experiment, data, comparison, or applicability boundary."
      ));
    }
  });
  const duplicateGroundingLimitations = normalized.limitationsAndConstraints
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => EXACT_EVIDENCE_LINKING_LIMITATION_PATTERN.test(entry.text));
  const duplicateGroundingRefGroups = new Map();
  duplicateGroundingLimitations.forEach(({ entry, index }) => {
    const key = [...entry.evidenceRefs].sort().join("|");
    const indexes = duplicateGroundingRefGroups.get(key) || [];
    indexes.push(index);
    duplicateGroundingRefGroups.set(key, indexes);
  });
  const duplicatedGroundingIndexes = [...duplicateGroundingRefGroups.values()]
    .find((indexes) => indexes.length > 1);
  if (duplicatedGroundingIndexes) {
    const validationIssue = issue(
      "limitations_not_independent",
      "limitationsAndConstraints",
      `Limitations ${duplicatedGroundingIndexes.map((index) => index + 1).join(", ")} split the same exact-evidence-linking gap into repeated bullets.`
    );
    validationIssue.repairKinds = ["duplicate_grounding_limitations"];
    issues.push(validationIssue);
  }

  if (!value.readingValue || typeof value.readingValue !== "object" || Array.isArray(value.readingValue)) {
    issues.push(issue("reading_value_invalid", "readingValue", "readingValue must be an object."));
  } else {
    Object.keys(value.readingValue).forEach((key) => {
      if (!REQUIRED_READING_VALUE_FIELDS.includes(key)) {
        issues.push(issue(
          "writer_field_forbidden",
          `readingValue.${key}`,
          "Writer returned an unknown readingValue field."
        ));
      }
    });
  }
  normalized.readingValue = Object.fromEntries(REQUIRED_READING_VALUE_FIELDS.map((field) => [
    field,
    validateGroundedText(value?.readingValue?.[field], {
      path: `readingValue.${field}`,
      expectedPaperId,
      refs,
      issues
    })
  ]));
  normalized.publicationMeta = publicationMetaFor(item, expectedPaperId);

  const normalizedIssues = uniqueIssues(issues);
  return {
    valid: normalizedIssues.length === 0,
    issues: normalizedIssues,
    paperDraft: normalized
  };
};

export class PaperSectionWriterError extends Error {
  constructor(message, {
    code = "READING_LIST_PAPER_SECTION_FAILED",
    paperId = "",
    retryable = false,
    issues = [],
    cause
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PaperSectionWriterError";
    this.code = code;
    this.stage = "write_paper_sections";
    this.paperId = paperId;
    this.retryable = Boolean(retryable);
    this.excludePaper = false;
    this.rejectJob = true;
    this.issues = issues;
  }
}

const abortError = () => {
  const error = new Error("Weekly report Paper Section writing was cancelled.");
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

const serializedError = (error, paperId = "") => ({
  code: String(error?.code || "READING_LIST_PAPER_SECTION_FAILED"),
  message: String(error?.message || "Paper Section writing failed."),
  stage: String(error?.stage || "write_paper_sections"),
  paperId: String(error?.paperId || paperId),
  retryable: Boolean(error?.retryable),
  excludePaper: false,
  rejectJob: Boolean(error?.rejectJob),
  issues: Array.isArray(error?.issues) ? error.issues : []
});

export const runPaperSectionWriter = async ({
  item,
  callModel,
  signal,
  onCall,
  onEvent,
  networkRetryDelayMs = 50
} = {}) => {
  const paperId = paperIdForItem(item);
  if (!paperId) {
    throw new PaperSectionWriterError("Paper Section Writer requires a paperId.");
  }
  if (typeof callModel !== "function") {
    throw new TypeError("Paper Section Writer callModel is required.");
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
        role: "paper_section_writer",
        paperId,
        attemptType,
        signal
      });
    } catch (error) {
      const record = {
        role: "paper_section_writer",
        paperId,
        attemptType,
        prompt,
        rawOutput: null,
        normalizedOutput: null,
        validation: null,
        durationMs: Math.max(0, Date.now() - startedAt),
        error: serializedError(error, paperId)
      };
      calls.push(record);
      await onCall?.(record);
      error.modelCallFailed = true;
      throw error;
    }

    let validation;
    try {
      validation = validatePaperDraft(parseModelJson(rawOutput), { item });
    } catch (error) {
      validation = {
        valid: false,
        issues: [issue("invalid_json", "response", error.message)],
        paperDraft: null
      };
    }
    const record = {
      role: "paper_section_writer",
      paperId,
      attemptType,
      prompt,
      rawOutput,
      normalizedOutput: validation.paperDraft,
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
        stage: "write_paper_sections",
        paperId,
        waitMs: networkRetryDelayMs,
        error: serializedError(error, paperId)
      });
      await waitForRetry(networkRetryDelayMs, signal);
      try {
        return await invoke(prompt, `${attemptType}_network_retry`);
      } catch (retryError) {
        if (retryError?.name === "AbortError") {
          throw retryError;
        }
        throw new PaperSectionWriterError("Paper Section model call failed after one network retry.", {
          code: "READING_LIST_PAPER_SECTION_FAILED",
          paperId,
          retryable: false,
          cause: retryError
        });
      }
    }
  };

  let validation = await invokeWithNetworkRetry(
    buildPaperSectionPrompt({ item }),
    "initial"
  );
  if (validation.valid) {
    return { paperDraft: validation.paperDraft, repairAttempted: false, calls };
  }

  await onEvent?.({
    type: "paper_section_repair_requested",
    stage: "write_paper_sections",
    paperId,
    issues: validation.issues
  });
  validation = await invokeWithNetworkRetry(
    buildPaperSectionRepairPrompt({ item, issues: validation.issues }),
    "repair"
  );
  if (!validation.valid) {
    throw new PaperSectionWriterError("paperDraft remains unsupported after one structured repair.", {
      code: "READING_LIST_PAPER_SECTION_UNSUPPORTED",
      paperId,
      issues: validation.issues
    });
  }

  return { paperDraft: validation.paperDraft, repairAttempted: true, calls };
};

const mapWithConcurrency = async (items, concurrency, mapper) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
};

export const writePaperSectionsBatch = async (items, {
  paperConcurrency = 2,
  callModel,
  signal,
  onCall,
  onEvent,
  networkRetryDelayMs = 50
} = {}) => {
  const candidates = Array.isArray(items) ? items : [];
  const concurrency = Math.min(Math.max(Math.trunc(Number(paperConcurrency) || 2), 1), 5);
  const results = await mapWithConcurrency(candidates, concurrency, async (item) => {
    if (signal?.aborted) {
      throw abortError();
    }
    const paperId = paperIdForItem(item);
    try {
      const result = await runPaperSectionWriter({
        item,
        callModel,
        signal,
        onCall,
        onEvent,
        networkRetryDelayMs
      });
      await onEvent?.({
        type: "paper_section_accepted",
        stage: "write_paper_sections",
        paperId,
        repairAttempted: result.repairAttempted
      });
      return { ok: true, item, ...result };
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) {
        throw abortError();
      }
      await onEvent?.({
        type: "paper_section_failed",
        stage: "write_paper_sections",
        paperId,
        error: serializedError(error, paperId)
      });
      return { ok: false, item, error };
    }
  });
  return {
    succeeded: results.filter((entry) => entry.ok).map((entry) => ({
      item: entry.item,
      paperDraft: entry.paperDraft,
      repairAttempted: entry.repairAttempted
    })),
    failed: results.filter((entry) => !entry.ok).map((entry) => ({
      item: entry.item,
      error: serializedError(entry.error, paperIdForItem(entry.item))
    })),
    attempted: candidates.length,
    concurrency
  };
};

export const READING_LIST_FOOTER_NOTE = "本文由论文推荐Agent生成+人工校对，欢迎提出宝贵建议。代码可开源，欢迎联系作者。编码工具Codex，编码模型chatgpt 5.5，论文分析模型GLM 5.2";

const READING_TIER_PRESENTATION = {
  must_read: { section: "本周必读", label: "本周必读" },
  worth_reading: { section: "值得跟进", label: "值得跟进" },
  skim: { section: "快速扫读", label: "快速扫读" },
  background_only: { section: "背景参考", label: "背景参考" }
};

const REVIEW_DIMENSION_PRESENTATION = [
  ["scenarioProblemValue", "研究问题价值"],
  ["methodNovelty", "方法新意"],
  ["practicalValue", "系统价值"],
  ["evidence", "证据强度"]
];

const ADN_ANGLE_PRESENTATION = {
  intent: "意图驱动",
  closed_loop: "闭环评估",
  digital_twin: "网络数字孪生",
  network_agent: "网络智能体",
  cross_domain: "跨域协同",
  ops: "自治运维",
  evaluation: "评估体系",
  safety: "安全可靠",
  engineering: "工程化",
  general: "通用方法"
};

const VALUE_DIMENSION_PRESENTATION = {
  scenarioProblemValue: "研究问题",
  methodNovelty: "方法机制",
  practicalValue: "实践应用",
  evidence: "证据评估"
};

const MATURITY_PRESENTATION = {
  emerging: "新兴",
  developing: "发展中",
  mature: "较成熟",
  uncertain: "尚不确定"
};

const INTEREST_FIT_PRESENTATION = {
  target_network_autonomy: "网络自治与可信评估",
  general_ai_system: "通用智能系统",
  out_of_scope_domain: "跨领域研究",
  unclear: "方向待确认"
};

const assemblyText = (value, maximum = 6000) => normalizeText(value, maximum);
const assemblyClaimBoundary = (claim, caveat) => {
  const normalizedClaim = assemblyText(claim, 3000).replace(/[\s。！？；;!?]+$/gu, "");
  const normalizedCaveat = assemblyText(caveat, 2400).replace(/^[\s；;:：]+/gu, "");
  return `${normalizedClaim}；边界：${normalizedCaveat}`;
};
const trimJoinPunctuation = (value, maximum = 2400) => assemblyText(value, maximum)
  .replace(/[。；;]+$/u, "");
const yamlQuoted = (value) => `"${assemblyText(value, 2000)
  .replace(/\\/g, "\\\\")
  .replace(/"/g, "\\\"")}"`;
const tableCell = (value) => assemblyText(value, 3000).replace(/\|/g, "\\|");

const reportMetadata = (value = {}) => {
  const date = String(value.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00.000Z`))) {
    throw new WeeklyReportAssemblyError("Assembly requires a valid report date.", {
      code: "READING_LIST_ASSEMBLY_METADATA_INVALID"
    });
  }
  const month = /^\d{4}-\d{2}$/.test(String(value.month || ""))
    ? String(value.month)
    : date.slice(0, 7);
  const suppliedWeek = Number(value.weekOfMonth);
  const weekOfMonth = Number.isInteger(suppliedWeek) && suppliedWeek >= 1 && suppliedWeek <= 6
    ? suppliedWeek
    : Math.min(Math.max(Math.ceil(Number(date.slice(-2)) / 7), 1), 6);
  return { date, month, weekOfMonth };
};

const rankedSelectedItems = (selectedItems) => (Array.isArray(selectedItems) ? selectedItems : [])
  .map((item, index) => ({ item, index }))
  .sort((left, right) => (
    Number(left.item?.selection?.rank || left.index + 1)
    - Number(right.item?.selection?.rank || right.index + 1)
    || left.index - right.index
  ))
  .map(({ item }) => item);

const affiliationsForItem = (item) => {
  const affiliations = (Array.isArray(item?.reviewResult?.affiliations)
    ? item.reviewResult.affiliations
    : []).map((entry) => assemblyText(entry, 500)).filter(Boolean);
  return affiliations.length ? affiliations : ["单位线索不足"];
};

const reviewDimensionsForItem = (item) => REVIEW_DIMENSION_PRESENTATION.map(([key, label]) => {
  const score = Number(item?.reviewResult?.scores?.[key]);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new WeeklyReportAssemblyError(`Selected paper ${paperIdForItem(item)} has invalid Review scores.`, {
      code: "READING_LIST_ASSEMBLY_ARTIFACT_MISMATCH",
      paperId: paperIdForItem(item)
    });
  }
  return { key, label, score: Math.round(score) };
});

const supportingTechnologiesForItem = (item) => {
  const signals = Array.isArray(item?.valueSignals?.signals) ? item.valueSignals.signals : [];
  const labels = signals.flatMap((signal) => [
    ADN_ANGLE_PRESENTATION[String(signal?.adnImplication?.angle || "")],
    VALUE_DIMENSION_PRESENTATION[String(signal?.dimension || "")]
  ]).filter(Boolean);
  return [...new Set(labels)].slice(0, 4).join("、") || "证据约束的方法与评估";
};

const evidenceTextForItem = (item) => EVIDENCE_FIELDS.flatMap((field) => {
  const evidence = item?.evidenceCard?.[field];
  return [
    evidence?.summary,
    ...(Array.isArray(evidence?.sources) ? evidence.sources.map((source) => source?.excerpt) : [])
  ];
}).map((entry) => assemblyText(entry, 12000)).filter(Boolean).join(" ");

const publishedPaperForItem = (item) => {
  const paperId = paperIdForItem(item);
  const dimensions = reviewDimensionsForItem(item);
  const affiliations = affiliationsForItem(item);
  return {
    id: paperId,
    absLink: `https://arxiv.org/abs/${paperId}`,
    title: assemblyText(item?.paper?.title, 800),
    summary: evidenceTextForItem(item),
    originalText: {
      status: "available",
      excerpt: evidenceTextForItem(item)
    },
    readingListReview: {
      score: Math.round(Number(item?.selection?.finalScore)),
      selectionReason: String(item?.selection?.selectionReason || ""),
      dimensionDetails: dimensions.map(({ label, score }) => ({ label, score })),
      affiliations,
      affiliationEvidence: assemblyText(item?.evidenceCard?.affiliations?.summary, 1600)
    }
  };
};

export class WeeklyReportAssemblyError extends Error {
  constructor(message, {
    code = "READING_LIST_ASSEMBLY_FAILED",
    paperId = "",
    issues = []
  } = {}) {
    super(message);
    this.name = "WeeklyReportAssemblyError";
    this.code = code;
    this.stage = "assemble";
    this.paperId = paperId;
    this.retryable = false;
    this.excludePaper = false;
    this.rejectJob = true;
    this.issues = issues;
  }
}

const validateAssemblyArtifacts = ({ selectedItems, paperDrafts, headTailDraft }) => {
  const rankedItems = rankedSelectedItems(selectedItems);
  if (!rankedItems.length) {
    throw new WeeklyReportAssemblyError("Assembly requires at least one selected paper.", {
      code: "READING_LIST_ASSEMBLY_ARTIFACT_MISMATCH"
    });
  }
  const expectedIds = rankedItems.map(paperIdForItem);
  const expectedIdSet = new Set(expectedIds);
  if (expectedIdSet.size !== expectedIds.length || expectedIds.some((paperId) => !paperId)) {
    throw new WeeklyReportAssemblyError("Selected paper identities are missing or duplicated.", {
      code: "READING_LIST_ASSEMBLY_ARTIFACT_MISMATCH"
    });
  }
  const drafts = Array.isArray(paperDrafts) ? paperDrafts : [];
  const draftIds = drafts.map((draft) => normalizedPaperId(draft?.paperId));
  if (draftIds.length !== expectedIds.length
    || new Set(draftIds).size !== draftIds.length
    || draftIds.some((paperId) => !expectedIdSet.has(paperId))) {
    throw new WeeklyReportAssemblyError("paperDraft identities do not exactly match Selection.", {
      code: "READING_LIST_ASSEMBLY_ARTIFACT_MISMATCH"
    });
  }
  const draftById = new Map(drafts.map((draft) => [normalizedPaperId(draft?.paperId), draft]));
  const readingOrder = Array.isArray(headTailDraft?.readingOrder) ? headTailDraft.readingOrder : [];
  const readingIds = readingOrder.map((entry) => normalizedPaperId(entry?.paperId));
  if (readingIds.length !== expectedIds.length
    || readingIds.some((paperId, index) => paperId !== expectedIds[index])) {
    throw new WeeklyReportAssemblyError("Head/Tail reading order does not match Selection.", {
      code: "READING_LIST_ASSEMBLY_ARTIFACT_MISMATCH"
    });
  }
  rankedItems.forEach((item) => {
    const paperId = paperIdForItem(item);
    const tier = String(item?.selection?.readingTier || "");
    const score = Number(item?.selection?.finalScore);
    if (!READING_TIER_PRESENTATION[tier] || !Number.isFinite(score)) {
      throw new WeeklyReportAssemblyError(`Selected paper ${paperId} has invalid publication metadata.`, {
        code: "READING_LIST_ASSEMBLY_ARTIFACT_MISMATCH",
        paperId
      });
    }
    if (!assemblyText(item?.paper?.title, 800)) {
      throw new WeeklyReportAssemblyError(`Selected paper ${paperId} has no title.`, {
        code: "READING_LIST_ASSEMBLY_ARTIFACT_MISMATCH",
        paperId
      });
    }
  });
  return { rankedItems, draftById };
};

const paperMarkdownBlock = (item, draft, displayRank) => {
  const paperId = paperIdForItem(item);
  const title = assemblyText(item?.paper?.title, 800);
  const score = Math.round(Number(item?.selection?.finalScore));
  const dimensions = reviewDimensionsForItem(item);
  const affiliations = affiliationsForItem(item).join("、");
  const mainDomain = INTEREST_FIT_PRESENTATION[String(item?.reviewResult?.interestFit || "")]
    || "方向待确认";
  const adnBullets = [
    draft?.adnInsight?.text,
    [draft?.readingValue?.whyWorthReading?.text, draft?.readingValue?.recommendedFocus?.text]
      .map((entry) => trimJoinPunctuation(entry, 2400)).filter(Boolean).join("；"),
    draft?.readingValue?.evidenceBoundary?.text
  ].map((entry) => assemblyText(entry, 3000)).filter(Boolean)
    .map((entry) => /[。！？.!?]$/u.test(entry) ? entry : `${entry}。`);
  return [
    `### ${displayRank}. ${title}`,
    "",
    `- 发表单位：${affiliations}`,
    `- 阅读价值评分：${score}`,
    `- 符合维度：${dimensions.map(({ label, score: dimensionScore }) => `${label} ${dimensionScore}`).join("、")}`,
    `- 主问题域：${mainDomain}`,
    `- 关键支撑技术：${supportingTechnologiesForItem(item)}`,
    `- 链接：https://arxiv.org/abs/${paperId}`,
    "",
    "**研究问题**",
    "",
    assemblyText(draft?.researchProblem?.text, 5000),
    "",
    "**核心贡献**",
    "",
    assemblyText(draft?.coreContribution?.text, 5000),
    "",
    "**方法框架**",
    "",
    assemblyText(draft?.methodFramework?.text, 5000),
    "",
    "**实验与结果**",
    "",
    assemblyText(draft?.experimentsAndResults?.text, 5000),
    "",
    "**局限与适用约束**",
    "",
    ...(Array.isArray(draft?.limitationsAndConstraints)
      ? draft.limitationsAndConstraints.map((entry) => `- ${assemblyText(entry?.text, 3000)}`)
      : []),
    "",
    "**ADN 启发与阅读价值**",
    "",
    ...adnBullets.map((entry) => `- ${entry}`)
  ].join("\n");
};

const titleForReport = (meta, titleAngle) => {
  const [year, month] = meta.month.split("-").map(Number);
  return `【精选论文】${String(year).slice(-2)}年${month}月第${meta.weekOfMonth}周阅读清单：${assemblyText(titleAngle, 200)}`;
};

export const assembleWeeklyReportMarkdown = ({
  reportMeta: suppliedReportMeta = {},
  selectedItems = [],
  paperDrafts = [],
  headTailDraft = {}
} = {}) => {
  const meta = reportMetadata(suppliedReportMeta);
  const { rankedItems, draftById } = validateAssemblyArtifacts({
    selectedItems,
    paperDrafts,
    headTailDraft
  });
  const titleAngle = assemblyText(headTailDraft?.titleAngle, 200);
  const description = assemblyText(headTailDraft?.description, 500);
  const tags = (Array.isArray(headTailDraft?.tags) ? headTailDraft.tags : [])
    .map((tag) => assemblyText(tag, 80)).filter(Boolean);
  if (!titleAngle || Array.from(titleAngle).length < 18 || Array.from(titleAngle).length > 32
    || !description || Array.from(description).length > 55 || !tags.length) {
    throw new WeeklyReportAssemblyError("Head/Tail publication metadata is invalid.", {
      code: "READING_LIST_ASSEMBLY_ARTIFACT_MISMATCH"
    });
  }
  const title = titleForReport(meta, titleAngle);
  const lines = [
    "---",
    `title: ${yamlQuoted(title)}`,
    `description: ${yamlQuoted(description)}`,
    `date: ${yamlQuoted(meta.date)}`,
    `month: ${yamlQuoted(meta.month)}`,
    `week_of_month: ${meta.weekOfMonth}`,
    `category: ${yamlQuoted("论文周报")}`,
    "tags:",
    ...tags.map((tag) => `  - ${yamlQuoted(tag)}`),
    `paper_count: ${rankedItems.length}`,
    "---",
    "",
    `# ${title}`,
    "",
    "## 报告导读",
    "",
    assemblyText(headTailDraft?.reportIntroduction, 6000),
    "",
    "## 本周趋势判断",
    ""
  ];
  const trends = Array.isArray(headTailDraft?.trendJudgments) ? headTailDraft.trendJudgments : [];
  if (trends.length) {
    trends.forEach((trend, index) => {
      const maturity = MATURITY_PRESENTATION[String(trend?.maturity || "")] || "尚不确定";
      lines.push(`- **趋势 ${index + 1}（${maturity}）**：${assemblyClaimBoundary(trend?.claim, trend?.caveat)}`);
    });
  } else {
    lines.push("- 本周入选论文数量有限，暂不形成跨论文趋势判断。");
  }
  const observations = Array.isArray(headTailDraft?.singlePaperObservations)
    ? headTailDraft.singlePaperObservations
    : [];
  if (observations.length) {
    lines.push("", "### 单篇补充观察", "");
    observations.forEach((observation) => {
      const item = rankedItems.find((candidate) => paperIdForItem(candidate) === normalizedPaperId(observation?.paperId));
      lines.push(`- **${assemblyText(item?.paper?.title || observation?.paperId, 800)}**：${assemblyClaimBoundary(observation?.claim, observation?.caveat)}`);
    });
  }

  Object.entries(READING_TIER_PRESENTATION).forEach(([tier, presentation]) => {
    const tierItems = rankedItems.filter((item) => item?.selection?.readingTier === tier);
    if (!tierItems.length) {
      return;
    }
    lines.push("", `## ${presentation.section}`, "");
    tierItems.forEach((item) => {
      const paperId = paperIdForItem(item);
      lines.push(paperMarkdownBlock(
        item,
        draftById.get(paperId),
        rankedItems.indexOf(item) + 1
      ), "");
    });
  });

  lines.push("## 推荐阅读顺序", "");
  headTailDraft.readingOrder.forEach((entry, index) => {
    const paperId = normalizedPaperId(entry?.paperId);
    const item = rankedItems.find((candidate) => paperIdForItem(candidate) === paperId);
    lines.push(`${index + 1}. **${assemblyText(item?.paper?.title, 800)}**：${assemblyText(entry?.reason, 2400)}`);
  });
  lines.push("", assemblyText(headTailDraft?.closingSummary, 5000), "", "## 完整论文清单", "", "| 论文 | 一句话介绍 | 阅读级别 | 链接 |", "| --- | --- | --- | --- |");
  rankedItems.forEach((item) => {
    const paperId = paperIdForItem(item);
    const draft = draftById.get(paperId);
    const label = READING_TIER_PRESENTATION[item.selection.readingTier].label;
    lines.push(`| ${tableCell(item.paper.title)} | ${tableCell(draft?.oneSentenceTakeaway?.text)} | ${label} | https://arxiv.org/abs/${paperId} |`);
  });
  lines.push("", READING_LIST_FOOTER_NOTE);
  const markdown = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (INTERNAL_TERM_PATTERN.test(markdown)) {
    throw new WeeklyReportAssemblyError("Assembled Markdown contains internal workflow language.", {
      code: "READING_LIST_ASSEMBLY_CONTENT_INVALID"
    });
  }
  const publishedPapers = rankedItems.map(publishedPaperForItem);
  return {
    markdown,
    title,
    report: {
      ...meta,
      paperCount: rankedItems.length
    },
    publishedPapers,
    footerNote: READING_LIST_FOOTER_NOTE
  };
};
