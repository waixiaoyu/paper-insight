const REQUIRED_SECTIONS = [
  "报告导读",
  "本周趋势判断",
  "推荐阅读顺序",
  "完整论文清单"
];

const REQUIRED_PAPER_BLOCKS = [
  "研究问题",
  "核心贡献",
  "方法框架",
  "实验与结果",
  "局限与适用约束",
  "ADN 启发与阅读价值"
];

const INTERNAL_PROCESS_PATTERNS = [
  { label: "复评分", pattern: /复评分/ },
  { label: "复评阈值", pattern: /复评阈值/ },
  { label: "保底补入", pattern: /保底补入/ },
  { label: "内部筛选", pattern: /内部筛选/ },
  { label: "候选下限", pattern: /候选下限/ },
  { label: "selectionReason", pattern: /\bselectionReason\b/i },
  { label: "fallback", pattern: /\bfallback\b/i }
];

const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();

const normalizeSearchText = (value) => String(value || "")
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, "");

const arxivIdFromValue = (value) => {
  const raw = String(value || "");
  let text = raw;

  try {
    text = decodeURIComponent(raw);
  } catch {
    text = raw;
  }

  const match = text.match(/(?:arxiv:|arxiv\.org\/(?:abs|pdf)\/)?((?:[a-z-]+(?:\.[A-Z]{2})?\/)?\d{4}\.\d{4,5})(?:v\d+)?/i)
    || text.match(/(?:arxiv:|arxiv\.org\/(?:abs|pdf)\/)?([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/i);
  return match?.[1]?.toLowerCase() || "";
};

const arxivIdsFromMarkdown = (markdown) => {
  const ids = new Set();
  const pattern = /arxiv\.org\/(?:abs|pdf)\/((?:[a-z-]+(?:\.[A-Z]{2})?\/)?\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?(?:\.pdf)?/gi;
  let match;

  while ((match = pattern.exec(String(markdown || "")))) {
    ids.add(String(match[1]).toLowerCase());
  }

  return ids;
};

const frontmatterValue = (frontmatter, key) => {
  const pattern = new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "m");
  return normalizeText(frontmatter.match(pattern)?.[1] || "");
};

const countLabel = (markdown, label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (String(markdown || "").match(new RegExp(escaped, "g")) || []).length;
};

const paperMentioned = (markdown, paper) => {
  const markdownSearch = normalizeSearchText(markdown);
  const title = normalizeSearchText(paper?.title);

  if (title.length >= 10 && markdownSearch.includes(title)) {
    return true;
  }

  const paperIds = [
    paper?.id,
    paper?.absLink,
    paper?.link
  ].map(arxivIdFromValue).filter(Boolean);
  const markdownIds = arxivIdsFromMarkdown(markdown);
  return paperIds.some((id) => markdownIds.has(id));
};

const sectionBody = (markdown, heading) => {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(markdown || "").match(
    new RegExp(`^##\\s+${escaped}\\s*\\r?$\\n?([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "m")
  );
  return match?.[1] || "";
};

const paperArticleBlocks = (markdown) => {
  const blocks = [];
  const pattern = /^###\s+(.+?)\s*\r?\n([\s\S]*?)(?=^###\s+|^##\s+|(?![\s\S]))/gm;
  let match;

  while ((match = pattern.exec(String(markdown || "")))) {
    const block = `### ${match[1]}\n${match[2]}`;

    if (/阅读价值评分[：:]/.test(block) && /链接[：:]/.test(block)) {
      blocks.push({
        heading: normalizeText(match[1]),
        text: block
      });
    }
  }

  return blocks;
};

const paperBlockMatches = (block, paper) => {
  const paperIds = [paper?.id, paper?.absLink, paper?.link].map(arxivIdFromValue).filter(Boolean);
  const blockIds = arxivIdsFromMarkdown(block.text);

  if (paperIds.some((id) => blockIds.has(id))) {
    return true;
  }

  const heading = normalizeSearchText(block.heading);
  const title = normalizeSearchText(paper?.title);
  return title.length >= 10 && heading.includes(title);
};

const lineValue = (block, label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return normalizeText(block.match(new RegExp(`^\\s*[-*]\\s*${escaped}[：:]\\s*(.+?)\\s*$`, "m"))?.[1] || "");
};

const expectedDimensionDetails = (paper) => {
  const details = Array.isArray(paper?.readingListReview?.dimensionDetails)
    ? paper.readingListReview.dimensionDetails
    : [];

  if (details.length) {
    return details
      .filter((item) => Number(item?.score) >= 70)
      .map((item) => ({
        label: normalizeText(item.label),
        score: Math.round(Number(item.score))
      }))
      .filter((item) => item.label);
  }

  return (Array.isArray(paper?.readingListReview?.matchedDimensions)
    ? paper.readingListReview.matchedDimensions
    : []
  ).map((item) => {
    const text = normalizeText(item);
    const match = text.match(/^(.*?)[\s：:]+(\d{1,3})$/);
    return match
      ? { label: normalizeText(match[1]), score: Number(match[2]) }
      : { label: text, score: null };
  }).filter((item) => item.label);
};

const paperEvidenceText = (paper) => normalizeText([
  paper?.title,
  paper?.summary,
  paper?.originalText?.excerpt,
  paper?.analysis?.tldr,
  paper?.analysis?.problem,
  paper?.analysis?.background,
  paper?.analysis?.method,
  paper?.analysis?.technicalDetails,
  paper?.analysis?.contribution,
  paper?.analysis?.experiment,
  paper?.analysis?.limitations,
  paper?.readingListReview?.tldr,
  paper?.readingListReview?.valueHighlight,
  paper?.readingListReview?.reviewReason,
  paper?.readingListReview?.affiliationEvidence
].filter(Boolean).join(" "));

const measurementTokens = (value) => {
  const text = String(value || "")
    .replace(/^.*(?:阅读价值评分|符合维度)[：:].*$/gm, "")
    .replace(/https?:\/\/\S+/g, "");
  const tokens = new Set();
  const pattern = /\d+(?:\.\d+)?\s*(?:%|倍|个百分点|毫秒|秒|分钟|小时)|\d+(?:\.\d+)?\s*(?:ms|gb|mb|kbps|mbps|gbps|db|s)(?![a-z])/gi;
  let match;

  while ((match = pattern.exec(text))) {
    tokens.add(match[0].replace(/\s+/g, "").toLowerCase());
  }

  return [...tokens];
};

const boldSectionBody = (block, label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(block || "").match(
    new RegExp(`^\\*\\*${escaped}\\*\\*\\s*$([\\s\\S]*?)(?=^\\*\\*.+?\\*\\*\\s*$|(?![\\s\\S]))`, "m")
  );
  return match?.[1] || "";
};

export const validateWeeklyReportMarkdown = ({
  markdown,
  papers = [],
  report = {},
  useOriginalText = true,
  footerNote = ""
} = {}) => {
  const text = String(markdown || "").trim();
  const selectedPapers = Array.isArray(papers) ? papers : [];
  const errors = [];
  const warnings = [];
  const frontmatterMatch = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const frontmatter = frontmatterMatch?.[1] || "";
  const headingTitle = normalizeText(text.match(/^#\s+(.+?)\s*$/m)?.[1] || "");

  if (!frontmatterMatch) {
    errors.push("缺少 YAML front matter。");
  }

  const yamlTitle = frontmatterValue(frontmatter, "title");

  if (!yamlTitle) {
    errors.push("YAML 缺少 title。");
  } else if (!/^【精选论文】\d{2}年\d{1,2}月第\d{1,2}周阅读清单：/.test(yamlTitle)) {
    errors.push("YAML title 不符合精选论文周报标题格式。");
  }

  if (!headingTitle) {
    errors.push("缺少正文一级标题。");
  } else if (yamlTitle && yamlTitle !== headingTitle) {
    errors.push("YAML title 与正文一级标题不一致。");
  }

  const description = frontmatterValue(frontmatter, "description");

  if (!description) {
    errors.push("YAML 缺少 description。");
  } else if (Array.from(description).length > 55) {
    errors.push("YAML description 超过 55 个字符。");
  }

  const yamlDate = frontmatterValue(frontmatter, "date");

  if (!yamlDate) {
    errors.push("YAML 缺少 date。");
  } else if (report.date && yamlDate !== String(report.date)) {
    errors.push(`YAML date 应为 ${report.date}，实际为 ${yamlDate}。`);
  }

  const yamlMonth = frontmatterValue(frontmatter, "month");

  if (!yamlMonth) {
    errors.push("YAML 缺少 month。");
  } else if (report.month && yamlMonth !== String(report.month)) {
    errors.push(`YAML month 应为 ${report.month}，实际为 ${yamlMonth}。`);
  }

  const yamlWeekOfMonth = frontmatterValue(frontmatter, "week_of_month");

  if (!/^\d+$/.test(yamlWeekOfMonth)) {
    errors.push("YAML 缺少有效的 week_of_month。");
  } else if (report.weekOfMonth && Number(yamlWeekOfMonth) !== Number(report.weekOfMonth)) {
    errors.push(`YAML week_of_month 应为 ${report.weekOfMonth}，实际为 ${yamlWeekOfMonth}。`);
  }

  if (frontmatterValue(frontmatter, "category") !== "论文周报") {
    errors.push("YAML category 必须为「论文周报」。");
  }

  if (!/^tags:\s*$/m.test(frontmatter) || !/^\s+-\s+\S+/m.test(frontmatter)) {
    errors.push("YAML 缺少非空 tags 列表。");
  }

  const paperCountText = frontmatterValue(frontmatter, "paper_count");
  const paperCount = Number(paperCountText);

  if (!/^\d+$/.test(paperCountText)) {
    errors.push("YAML 缺少有效的 paper_count。");
  } else if (paperCount !== selectedPapers.length) {
    errors.push(`YAML paper_count 为 ${paperCount}，实际入选 ${selectedPapers.length} 篇。`);
  }

  const titleSuffix = yamlTitle.split(/[：:]/).slice(1).join("：");

  if (titleSuffix && Array.from(titleSuffix).length < 18) {
    warnings.push("标题观点少于 18 个字符，建议人工确认是否足够具体。");
  }

  if (titleSuffix && Array.from(titleSuffix).length > 32) {
    errors.push("标题观点超过 32 个字符。");
  }

  REQUIRED_SECTIONS.forEach((section) => {
    const pattern = new RegExp(`^##\\s+${section}\\s*$`, "m");

    if (!pattern.test(text)) {
      errors.push(`缺少「${section}」章节。`);
    }
  });

  if (!/\|\s*论文\s*\|\s*一句话介绍\s*\|\s*阅读级别\s*\|\s*链接\s*\|/.test(text)) {
    errors.push("完整论文清单缺少规定的四列表头。");
  }

  REQUIRED_PAPER_BLOCKS.forEach((label) => {
    const count = countLabel(text, `**${label}**`);

    if (count < selectedPapers.length) {
      errors.push(`「${label}」小节只有 ${count} 个，少于入选论文数 ${selectedPapers.length}。`);
    }
  });

  [
    { label: "发表单位", pattern: /发表单位[：:]/g },
    { label: "阅读价值评分", pattern: /阅读价值评分[：:]/g },
    { label: "符合维度", pattern: /符合维度[：:]/g },
    { label: "论文链接", pattern: /链接[：:]/g }
  ].forEach(({ label, pattern }) => {
    const count = (text.match(pattern) || []).length;

    if (count < selectedPapers.length) {
      errors.push(`「${label}」字段只有 ${count} 个，少于入选论文数 ${selectedPapers.length}。`);
    }
  });

  const missingPapers = selectedPapers.filter((paper) => !paperMentioned(text, paper));

  if (missingPapers.length) {
    errors.push(`正文缺少入选论文：${missingPapers.map((paper) => paper.title || paper.id).join("、")}。`);
  }

  const selectedArxivIds = new Set(
    selectedPapers.flatMap((paper) => [paper.id, paper.absLink, paper.link]).map(arxivIdFromValue).filter(Boolean)
  );
  const unknownArxivIds = [...arxivIdsFromMarkdown(text)].filter((id) => !selectedArxivIds.has(id));

  if (unknownArxivIds.length) {
    errors.push(`正文包含未入选的 arXiv 论文：${unknownArxivIds.join("、")}。`);
  }

  const articleBlocks = paperArticleBlocks(text);
  const semanticBlockMatches = [];

  selectedPapers.forEach((paper) => {
    const matchingBlocks = articleBlocks.filter((block) => paperBlockMatches(block, paper));
    semanticBlockMatches.push({ paper, count: matchingBlocks.length });

    if (!matchingBlocks.length) {
      errors.push(`论文缺少独立的逐篇正文条目：${paper.title || paper.id}。`);
      return;
    }

    if (matchingBlocks.length > 1) {
      errors.push(`论文出现于多个逐篇正文条目：${paper.title || paper.id}。`);
      return;
    }

    const block = matchingBlocks[0].text;
    const expectedScore = Number(paper?.readingListReview?.score);
    const publishedScore = Number(lineValue(block, "阅读价值评分").match(/\d{1,3}/)?.[0]);

    if (Number.isFinite(expectedScore) && publishedScore !== Math.round(expectedScore)) {
      errors.push(`论文「${paper.title || paper.id}」发布评分 ${Number.isFinite(publishedScore) ? publishedScore : "缺失"} 与复评分 ${Math.round(expectedScore)} 不一致。`);
    }

    const publishedDimensions = lineValue(block, "符合维度");

    expectedDimensionDetails(paper).forEach((dimension) => {
      const hasLabel = publishedDimensions.includes(dimension.label);
      const hasScore = dimension.score === null || new RegExp(`(?:^|\\D)${dimension.score}(?:\\D|$)`).test(publishedDimensions);

      if (!hasLabel || !hasScore) {
        errors.push(`论文「${paper.title || paper.id}」发布维度缺少 ${dimension.label}${dimension.score === null ? "" : ` ${dimension.score}`}。`);
      }
    });

    const publishedAffiliations = lineValue(block, "发表单位");
    const expectedAffiliations = Array.isArray(paper?.readingListReview?.affiliations)
      ? paper.readingListReview.affiliations.map(normalizeText).filter(Boolean)
      : [];

    if (expectedAffiliations.includes("单位线索不足") && !publishedAffiliations.includes("单位线索不足")) {
      errors.push(`论文「${paper.title || paper.id}」的单位线索不足，发布正文却未保留该证据边界。`);
    }

    const chineseAffiliations = expectedAffiliations.filter((item) => /\p{Script=Han}/u.test(item) && item !== "单位线索不足");

    if (chineseAffiliations.length && !chineseAffiliations.some((item) => publishedAffiliations.includes(item))) {
      errors.push(`论文「${paper.title || paper.id}」的发表单位与复评单位线索不一致。`);
    }

    const otherAffiliations = selectedPapers
      .filter((other) => other !== paper)
      .flatMap((other) => Array.isArray(other?.readingListReview?.affiliations) ? other.readingListReview.affiliations : [])
      .map(normalizeText)
      .filter((item) => item && item !== "单位线索不足" && /\p{Script=Han}/u.test(item));

    if (otherAffiliations.some((item) => publishedAffiliations.includes(item) && !expectedAffiliations.includes(item))) {
      errors.push(`论文「${paper.title || paper.id}」的发表单位疑似串入其他论文。`);
    }

    const currentPaperIds = new Set([paper?.id, paper?.absLink, paper?.link].map(arxivIdFromValue).filter(Boolean));
    const crossPaperIds = [...arxivIdsFromMarkdown(block)]
      .filter((id) => selectedArxivIds.has(id) && !currentPaperIds.has(id));

    if (crossPaperIds.length) {
      errors.push(`论文「${paper.title || paper.id}」的逐篇正文串入其他入选论文链接：${crossPaperIds.join("、")}。`);
    }

    const evidenceText = paperEvidenceText(paper).replace(/\s+/g, "").toLowerCase();
    const unsupportedMeasurements = measurementTokens(block)
      .filter((token) => !evidenceText.includes(token));

    if (unsupportedMeasurements.length) {
      errors.push(`论文「${paper.title || paper.id}」包含无法从输入证据核对的精确数字：${unsupportedMeasurements.join("、")}。`);
    }

    const limitations = boldSectionBody(block, "局限与适用约束");
    const limitationCount = (limitations.match(/^\s*[-*]\s+\S+/gm) || []).length;

    if (limitationCount < 2) {
      errors.push(`论文「${paper.title || paper.id}」的局限与适用约束少于 2 条。`);
    }
  });

  const mustReadBody = sectionBody(text, "本周必读");
  const fallbackInMustRead = selectedPapers
    .filter((paper) => paper?.readingListReview?.selectionReason === "fallback")
    .filter((paper) => paperMentioned(mustReadBody, paper));

  if (fallbackInMustRead.length) {
    errors.push(`保底论文不能进入「本周必读」：${fallbackInMustRead.map((paper) => paper.title || paper.id).join("、")}。`);
  }

  INTERNAL_PROCESS_PATTERNS.forEach(({ label, pattern }) => {
    if (pattern.test(text)) {
      errors.push(`发布正文包含内部流程词「${label}」。`);
    }
  });

  if (!useOriginalText) {
    const evidenceNoticeCount = countLabel(text, "基于摘要和已有分析");

    if (evidenceNoticeCount < selectedPapers.length) {
      errors.push(`摘要模式下依据声明只有 ${evidenceNoticeCount} 处，少于入选论文数 ${selectedPapers.length}。`);
    }
  }

  if (footerNote && !text.endsWith(footerNote)) {
    errors.push("缺少固定发布尾注，或尾注不在正文最后。");
  }

  if (!selectedPapers.length) {
    errors.push("没有可发布的入选论文。");
  }

  if (text.length < Math.max(600, selectedPapers.length * 500)) {
    warnings.push("周报正文偏短，建议人工确认内容深度。");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metrics: {
      paperCount: selectedPapers.length,
      matchedPaperCount: selectedPapers.length - missingPapers.length,
      semanticPaperBlockCount: articleBlocks.length,
      mappedSemanticPaperCount: semanticBlockMatches.filter((item) => item.count === 1).length,
      unknownArxivIds,
      markdownChars: text.length
    }
  };
};

export const assertWeeklyReportPublishable = (options) => {
  const result = validateWeeklyReportMarkdown(options);

  if (!result.valid) {
    const error = new Error(`周报发布质量检查未通过：${result.errors.slice(0, 4).join("；")}`);
    error.code = "WEEKLY_REPORT_QUALITY_GATE_FAILED";
    error.status = 502;
    error.qualityGate = result;
    throw error;
  }

  return result;
};
