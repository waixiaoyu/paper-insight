import { validateWeeklyReportMarkdown } from "./publish-guard.js";

const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();

const normalizedPaperId = (value) => {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/(?:arxiv:|arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5})(?:v\d+)?/i);
  return match?.[1] || text.replace(/v\d+$/i, "");
};

const issueDefinition = (message) => {
  if (/发布评分/.test(message)) {
    return { code: "published_score_mismatch", path: "paper.score" };
  }
  if (/发布维度|符合维度/.test(message)) {
    return { code: "published_dimension_mismatch", path: "paper.dimensions" };
  }
  if (/发表单位|单位线索|单位疑似/.test(message)) {
    return { code: "affiliation_mismatch", path: "paper.affiliations" };
  }
  if (/逐篇正文串入其他入选论文链接/.test(message)) {
    return { code: "cross_paper_reference", path: "paper.markdown" };
  }
  if (/精确数字/.test(message)) {
    return { code: "unsupported_exact_number", path: "paper.markdown" };
  }
  if (/局限与适用约束/.test(message)) {
    return { code: "limitations_insufficient", path: "paper.limitationsAndConstraints" };
  }
  if (/保底论文不能进入/.test(message)) {
    return { code: "reading_tier_mismatch", path: "paper.readingTier" };
  }
  if (/内部流程词/.test(message)) {
    return { code: "internal_process_leak", path: "report.markdown" };
  }
  if (/未入选的 arXiv|正文缺少入选论文|逐篇正文条目|出现于多个逐篇正文/.test(message)) {
    return { code: "paper_set_mismatch", path: "report.papers" };
  }
  if (/YAML|一级标题|标题观点|description|日期|周次|paper_count/.test(message)) {
    return { code: "publication_metadata_invalid", path: "report.metadata" };
  }
  if (/完整论文清单|固定发布尾注|核心章节|小节只有|字段只有|缺少「/.test(message)) {
    return { code: "publication_structure_invalid", path: "report.structure" };
  }
  if (/没有可发布的入选论文/.test(message)) {
    return { code: "paper_set_empty", path: "report.papers" };
  }
  return { code: "deterministic_validation_failed", path: "report.markdown" };
};

const paperForMessage = (message, papers) => (Array.isArray(papers) ? papers : []).find((paper) => {
  const title = normalizeText(paper?.title);
  const paperId = normalizedPaperId(paper?.id || paper?.absLink || paper?.link);
  return (title && message.includes(title)) || (paperId && message.includes(paperId));
});

const normalizeIssue = (message, papers) => {
  const definition = issueDefinition(message);
  const paper = paperForMessage(message, papers);
  const paperId = paper ? normalizedPaperId(paper?.id || paper?.absLink || paper?.link) : "";
  const scope = paperId ? "paper" : "report";
  let repairTarget = scope === "paper" ? "paper_section" : "assemble";
  if ([
    "published_score_mismatch",
    "published_dimension_mismatch",
    "affiliation_mismatch",
    "reading_tier_mismatch"
  ].includes(definition.code)) {
    repairTarget = "assemble";
  } else if (definition.code === "internal_process_leak") {
    repairTarget = "head_tail";
  } else if (definition.code === "publication_metadata_invalid"
    && /标题观点|description/.test(message)) {
    repairTarget = "head_tail";
  }
  return {
    code: definition.code,
    path: paperId ? `${definition.path}.${paperId}` : definition.path,
    message: normalizeText(message),
    severity: "high",
    scope,
    paperId,
    repairTarget,
    repairable: true
  };
};

export class QaCheckerError extends Error {
  constructor(message, {
    code = "READING_LIST_DETERMINISTIC_QA_FAILED",
    issues = []
  } = {}) {
    super(message);
    this.name = "QaCheckerError";
    this.code = code;
    this.stage = "deterministic_qa";
    this.paperId = "";
    this.retryable = false;
    this.excludePaper = false;
    this.rejectJob = true;
    this.issues = issues;
  }
}

export const runDeterministicQa = ({
  markdown,
  publishedPapers = [],
  report = {},
  footerNote = "",
  repairAttempted = false
} = {}) => {
  const text = String(markdown || "").trim();
  const papers = Array.isArray(publishedPapers) ? publishedPapers : [];
  if (!text || !papers.length || !report || typeof report !== "object") {
    throw new QaCheckerError("Deterministic QA requires assembled Markdown and publication context.", {
      code: "READING_LIST_DETERMINISTIC_QA_INPUT_INVALID"
    });
  }

  const validation = validateWeeklyReportMarkdown({
    markdown: text,
    papers,
    report,
    useOriginalText: true,
    footerNote
  });
  const deterministicIssues = (Array.isArray(validation.errors) ? validation.errors : [])
    .map((message) => normalizeIssue(String(message), papers));
  const status = deterministicIssues.length
    ? (repairAttempted ? "rejected" : "repair_required")
    : "passed";
  return {
    status,
    deterministicIssues,
    paperIssues: deterministicIssues.filter((entry) => entry.scope === "paper"),
    reportIssues: deterministicIssues.filter((entry) => entry.scope === "report"),
    repairAttempted: Boolean(repairAttempted),
    repairResults: [],
    warnings: Array.isArray(validation.warnings) ? validation.warnings.map(String) : [],
    validation
  };
};
