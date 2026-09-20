import { createHash } from "node:crypto";

const REVIEWABLE_EVIDENCE_CODES = new Set([
  "unsupported_exact_number",
  "unsupported_number",
  "numeric_claim_not_in_evidence",
  "unsupported_fact",
  "method_mismatch",
  "experiment_mismatch",
  "evidence_boundary",
  "metric_label_not_in_evidence",
  "specific_setup_claim_not_in_evidence"
]);

const NUMERIC_REVIEW_CODES = new Set([
  "unsupported_exact_number",
  "unsupported_number",
  "numeric_claim_not_in_evidence",
  "metric_label_not_in_evidence",
  "specific_setup_claim_not_in_evidence"
]);

const REVIEW_LIMITS = Object.freeze({
  items: 20,
  totalChars: 60_000,
  draftExcerpt: 800,
  sources: 3,
  sourceExcerpt: 1200,
  section: 240,
  anchor: 120
});

const DRAFT_FIELD_LABELS = Object.freeze({
  oneSentenceTakeaway: "一句话结论",
  researchProblem: "研究问题",
  coreContribution: "核心贡献",
  methodFramework: "方法框架",
  experimentsAndResults: "实验与结果",
  limitationsAndConstraints: "限制与边界",
  adnInsight: "ADN 解读",
  "readingValue.whyWorthReading": "阅读价值",
  "readingValue.recommendedFocus": "建议重点",
  "readingValue.evidenceBoundary": "证据边界"
});

const text = (value, limit = 4000) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
const paperId = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  const match = normalized.match(/(?:^|\/)(\d{4}\.\d{4,5})(?:v\d+)?(?:$|[?#/])/i);
  return match?.[1] || normalized.replace(/v\d+$/i, "");
};
const excerptAround = (value, needle, limit) => {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const normalizedNeedle = String(needle || "").replace(/\s+/g, " ").trim();
  const matchedAt = normalizedNeedle
    ? normalized.toLowerCase().indexOf(normalizedNeedle.toLowerCase())
    : -1;
  const contentLimit = Math.max(1, limit - 2);
  const start = matchedAt >= 0
    ? Math.max(0, Math.min(matchedAt - Math.trunc(contentLimit / 3), normalized.length - contentLimit))
    : 0;
  const body = normalized.slice(start, start + contentLimit);
  return ((start > 0 ? "…" : "") + body
    + (start + contentLimit < normalized.length ? "…" : "")).slice(0, limit);
};

const draftFields = (draft = {}) => {
  const fields = [
    ["oneSentenceTakeaway", draft.oneSentenceTakeaway],
    ["researchProblem", draft.researchProblem],
    ["coreContribution", draft.coreContribution],
    ["methodFramework", draft.methodFramework],
    ["experimentsAndResults", draft.experimentsAndResults],
    ["adnInsight", draft.adnInsight],
    ["readingValue.whyWorthReading", draft.readingValue?.whyWorthReading],
    ["readingValue.recommendedFocus", draft.readingValue?.recommendedFocus],
    ["readingValue.evidenceBoundary", draft.readingValue?.evidenceBoundary]
  ];
  (Array.isArray(draft.limitationsAndConstraints) ? draft.limitationsAndConstraints : [])
    .forEach((entry, index) => fields.push([`limitationsAndConstraints[${index}]`, entry]));
  return fields
    .filter(([, value]) => value && typeof value === "object")
    .map(([path, value]) => ({
      path,
      label: DRAFT_FIELD_LABELS[path] || DRAFT_FIELD_LABELS[path.replace(/\[\d+\]$/u, "")] || "逐篇稿件",
      text: text(value.text, 6000),
      evidenceRefs: Array.isArray(value.evidenceRefs) ? value.evidenceRefs.map(String).filter(Boolean) : []
    }))
    .filter((entry) => entry.text);
};

const issueNeedle = (issue = {}) => {
  const message = String(issue.message || issue.reason || issue.detail || "");
  return text(
    message.match(/精确数字[：:]\s*([^。；]+)/u)?.[1]
      || message.match(/Exact number\s+([^\s]+)/i)?.[1]
      || issue.claim
      || issue.triggerText,
    500
  );
};

const fieldForIssue = (issue, draft) => {
  const fields = draftFields(draft);
  const needle = issueNeedle(issue);
  const currentPath = String(issue?.path || issue?.field || "");
  const direct = fields.find((entry) => currentPath === entry.path || currentPath.startsWith(`${entry.path}.`));
  if (direct) return direct;
  if (needle) {
    const compactNeedle = needle.replace(/\s+/g, "").toLowerCase();
    const matched = fields.find((entry) => entry.text.replace(/\s+/g, "").toLowerCase().includes(compactNeedle));
    if (matched) return matched;
  }
  return null;
};

const sourceForRef = (item, reference, needle = "") => {
  const parts = String(reference || "").split(":");
  const index = Number(parts.pop());
  const field = String(parts.pop() || "");
  const source = Number.isInteger(index) && index >= 0
    ? item?.evidenceCard?.[field]?.sources?.[index]
    : null;
  if (!source || typeof source !== "object") return null;
  const excerpt = excerptAround(source.excerpt, needle, REVIEW_LIMITS.sourceExcerpt);
  if (!excerpt) return null;
  return {
    ref: `${field}:${index}`,
    section: text(source.section, REVIEW_LIMITS.section) || "原文章节未标注",
    anchor: text(source.anchor, REVIEW_LIMITS.anchor),
    excerpt
  };
};

const extractionSource = (source = {}, sections = new Map()) => {
  const anchor = text(source.anchor, REVIEW_LIMITS.anchor);
  const boundSection = sections.get(anchor);
  const candidate = text(source.excerpt, REVIEW_LIMITS.sourceExcerpt);
  const originalText = text(boundSection?.text, REVIEW_LIMITS.sourceExcerpt);
  return {
    ref: text(source.ref, 300) || anchor,
    section: text(boundSection?.heading || source.section, REVIEW_LIMITS.section) || "原文章节未标注",
    anchor,
    excerpt: originalText ? excerptAround(originalText, candidate, REVIEW_LIMITS.sourceExcerpt) : candidate
  };
};

export const evidenceExtractionReviewsForIssues = ({
  issues = [],
  artifacts = null,
  contextPacket = null,
  paperId: targetPaperId = ""
} = {}) => {
  const sections = new Map((Array.isArray(contextPacket?.inputSections) ? contextPacket.inputSections : [])
    .map((section) => [String(section?.anchor || ""), section]));
  const card = artifacts?.evidenceCard && typeof artifacts.evidenceCard === "object"
    ? artifacts.evidenceCard
    : {};
  const signals = Array.isArray(artifacts?.valueSignals?.signals)
    ? artifacts.valueSignals.signals
    : [];
  const sourceFromReference = (reference) => {
    const match = String(reference || "").match(/^([A-Za-z]+):(\d+)$/u);
    if (!match) return null;
    const source = card?.[match[1]]?.sources?.[Number(match[2])];
    return source && typeof source === "object"
      ? extractionSource({ ...source, ref: `${match[1]}:${Number(match[2])}` }, sections)
      : null;
  };
  const reviews = [];
  (Array.isArray(issues) ? issues : []).forEach((entry, issueIndex) => {
    const path = String(entry?.path || "");
    const field = path.match(/^evidenceCard\.([A-Za-z]+)\.(?:summary|sources)/u)?.[1];
    const signalIndex = Number(path.match(/^valueSignals\.signals\[(\d+)\]/u)?.[1]);
    const signal = Number.isInteger(signalIndex) ? signals[signalIndex] : null;
    const references = signal
      ? (Array.isArray(signal.evidenceRefs) ? signal.evidenceRefs : [])
      : (Array.isArray(card?.[field]?.sources)
        ? card[field].sources.map((_, index) => `${field}:${index}`)
        : []);
    const evidenceSources = references
      .map(sourceFromReference)
      .filter((source) => source?.excerpt)
      .slice(0, REVIEW_LIMITS.sources);
    if (!evidenceSources.length) return;
    const draftExcerpt = signal?.claim
      || (path.includes(".summary") ? card?.[field]?.summary : "")
      || evidenceSources.map((source) => source.excerpt).join(" ");
    reviews.push({
      issueKey: [String(entry?.code || "evidence_issue"), paperId(targetPaperId), path || field || signalIndex, issueIndex + 1].join("|"),
      paperId: paperId(targetPaperId),
      fieldPath: path || (field ? `evidenceCard.${field}.sources` : `valueSignals.signals[${signalIndex}]`),
      fieldLabel: signal
        ? "阅读价值判断的原文依据"
        : (field === "problem" ? "研究问题的原文依据" : "证据卡片中的原文依据"),
      reviewContext: "evidence_extraction",
      draftExcerpt: text(draftExcerpt, REVIEW_LIMITS.draftExcerpt),
      evidenceSources
    });
  });
  return compactEvidenceReviews(reviews);
};

export const editorialEvidenceReviewsForIssues = ({
  issues = [],
  editorialPlan = null,
  selectedItems = []
} = {}) => {
  const itemsByPaperId = new Map((Array.isArray(selectedItems) ? selectedItems : [])
    .map((item) => [paperId(item?.paper?.id || item?.reviewResult?.paperId || item?.paperId), item])
    .filter(([id]) => id));
  const comparable = (value) => String(value || "")
    .toLowerCase()
    .replace(/\\%/gu, "%")
    .replace(/\s+/gu, "")
    .replace(/,/gu, "");
  const matchingSources = (item, targetPaperId, needle) => {
    const compactNeedle = comparable(needle);
    if (!compactNeedle) return [];
    return Object.entries(item?.evidenceCard || {}).flatMap(([field, value]) => (
      Array.isArray(value?.sources) ? value.sources.map((source, index) => ({ source, field, index })) : []
    )).filter(({ source }) => comparable(source?.excerpt).includes(compactNeedle))
      .map(({ field, index }) => {
        const source = sourceForRef(item, `${field}:${index}`, needle);
        return source ? { ...source, ref: `${targetPaperId}:${source.ref}` } : null;
      })
      .filter(Boolean);
  };
  const reviews = [];
  (Array.isArray(issues) ? issues : []).forEach((entry, issueIndex) => {
    if (String(entry?.code || "") !== "numeric_claim_not_in_evidence") return;
    const path = String(entry?.path || "");
    const observationMatch = path.match(/^singlePaperObservations\[(\d+)\]\.claim$/u);
    const trendMatch = path.match(/^trends\[(\d+)\]\.claim$/u);
    const planEntry = observationMatch
      ? editorialPlan?.singlePaperObservations?.[Number(observationMatch[1])]
      : trendMatch ? editorialPlan?.trends?.[Number(trendMatch[1])] : null;
    if (!planEntry) return;
    const relatedPaperIds = observationMatch
      ? [paperId(planEntry?.paperId)].filter(Boolean)
      : (Array.isArray(planEntry?.supportingPaperIds) ? planEntry.supportingPaperIds : [])
        .map(paperId)
        .filter(Boolean);
    const needle = issueNeedle(entry);
    const matched = relatedPaperIds.flatMap((targetPaperId) => {
      const item = itemsByPaperId.get(targetPaperId);
      return item ? matchingSources(item, targetPaperId, needle) : [];
    });
    const targetPaperId = paperId(matched[0]?.ref?.split(":")?.[0] || relatedPaperIds[0]);
    const item = itemsByPaperId.get(targetPaperId);
    const references = Array.isArray(planEntry?.evidenceRefs) ? planEntry.evidenceRefs : [];
    const evidenceSources = (matched.length ? matched : references
      .map((reference) => sourceForRef(item, reference, needle))
      .filter(Boolean))
      .slice(0, REVIEW_LIMITS.sources);
    if (!evidenceSources.length) return;
    const fingerprint = createHash("sha256")
      .update([entry.code, entry.path, entry.detail, planEntry.claim, references.join(",")].join("|"))
      .digest("hex")
      .slice(0, 20);
    reviews.push({
      issueKey: [entry.code, targetPaperId, entry.path, fingerprint, issueIndex + 1].join("|"),
      paperId: targetPaperId,
      fieldPath: String(entry.path || ""),
      fieldLabel: trendMatch ? "跨论文趋势" : "逐篇观察",
      reviewContext: "editorial_plan",
      draftExcerpt: text(planEntry?.claim || entry?.triggerText, REVIEW_LIMITS.draftExcerpt),
      evidenceSources
    });
  });
  return compactEvidenceReviews(reviews);
};
const reviewKey = ({ issue, targetPaperId, field }) => {
  const code = String(issue?.code || "");
  const stableCode = NUMERIC_REVIEW_CODES.has(code) ? "numeric_evidence" : code;
  const detail = NUMERIC_REVIEW_CODES.has(code)
    ? issueNeedle(issue)
    : [
        text(field?.text, 6000),
        [...(field?.evidenceRefs || [])].map(String).sort().join(","),
        [...(Array.isArray(issue?.evidenceRefs) ? issue.evidenceRefs : [])]
          .map(String)
          .sort()
          .join(",")
      ].join("|");
  const fingerprint = createHash("sha256")
    .update(detail || text(issue?.message || issue?.reason || issue?.detail, 1000))
    .digest("hex")
    .slice(0, 20);
  return [stableCode, targetPaperId, field?.path, fingerprint]
    .map((part) => String(part || "").trim())
    .join("|");
};

export const enrichEvidenceReviewIssues = ({
  issues = [],
  selectedItems = [],
  paperDrafts = []
} = {}) => {
  const keyOccurrences = new Map();
  return (Array.isArray(issues) ? issues : []).map((issue) => {
  if (!REVIEWABLE_EVIDENCE_CODES.has(String(issue?.code || ""))) return issue;
  const targetPaperId = paperId(issue?.paperId);
  const item = (Array.isArray(selectedItems) ? selectedItems : [])
    .find((entry) => paperId(entry?.paper?.id || entry?.paperId) === targetPaperId);
  const draft = (Array.isArray(paperDrafts) ? paperDrafts : [])
    .find((entry) => paperId(entry?.paperId) === targetPaperId);
  if (!item || !draft) return issue;
  const field = fieldForIssue(issue, draft);
  if (!field) return issue;
  const needle = issueNeedle(issue);
  const evidenceSources = field.evidenceRefs
    .map((reference) => sourceForRef(item, reference, needle))
    .filter(Boolean)
    .filter((entry, index, entries) => entries.findIndex((candidate) => (
      candidate.ref === entry.ref && candidate.excerpt === entry.excerpt
    )) === index)
    .slice(0, REVIEW_LIMITS.sources);
  if (!evidenceSources.length) return issue;
  const baseIssueKey = reviewKey({ issue, targetPaperId, field });
  const occurrence = (keyOccurrences.get(baseIssueKey) || 0) + 1;
  keyOccurrences.set(baseIssueKey, occurrence);
  const issueKey = `${baseIssueKey}|${occurrence}`;
  return {
    ...issue,
    sourcePath: String(issue.path || ""),
    path: field.path,
    evidenceReview: {
      issueKey,
      paperId: targetPaperId,
      fieldPath: field.path,
      fieldLabel: field.label,
      draftExcerpt: excerptAround(field.text, needle, REVIEW_LIMITS.draftExcerpt),
      evidenceSources
    }
  };
  });
};

export const compactEvidenceReviews = (reviews = []) => {
  const compacted = [];
  let totalChars = 2;
  for (const review of (Array.isArray(reviews) ? reviews : [])) {
    if (!review || typeof review !== "object" || Array.isArray(review)) continue;
    const issueKey = text(review.issueKey, 1000);
    if (!issueKey) continue;
    const compactReview = {
      issueKey,
      paperId: text(review.paperId, 100),
      fieldPath: text(review.fieldPath, 300),
      fieldLabel: text(review.fieldLabel, 100),
      reviewContext: text(review.reviewContext, 80),
      draftExcerpt: excerptAround(review.draftExcerpt, "", REVIEW_LIMITS.draftExcerpt),
      evidenceSources: (Array.isArray(review.evidenceSources) ? review.evidenceSources : [])
        .filter((source) => source && typeof source === "object" && !Array.isArray(source))
        .slice(0, REVIEW_LIMITS.sources)
        .map((source) => ({
          ref: text(source.ref, 300),
          section: text(source.section, REVIEW_LIMITS.section) || "原文章节未标注",
          anchor: text(source.anchor, REVIEW_LIMITS.anchor),
          excerpt: excerptAround(source.excerpt, "", REVIEW_LIMITS.sourceExcerpt)
        }))
        .filter((source) => source.excerpt)
    };
    if (!compactReview.evidenceSources.length) continue;
    const encodedLength = JSON.stringify(compactReview).length + (compacted.length ? 1 : 0);
    if (compacted.length >= REVIEW_LIMITS.items || totalChars + encodedLength > REVIEW_LIMITS.totalChars) break;
    compacted.push(compactReview);
    totalChars += encodedLength;
  }
  return compacted;
};

export const evidenceReviewsForIssues = (issues = []) => compactEvidenceReviews(
  (Array.isArray(issues) ? issues : [])
    .map((issue) => issue?.evidenceReview)
    .filter((review) => review && typeof review === "object" && review.issueKey)
);

export const removeApprovedEvidenceIssues = (issues = [], approvals = []) => {
  const approvedKeys = new Set((Array.isArray(approvals) ? approvals : [])
    .map((approval) => String(approval?.issueKey || ""))
    .filter(Boolean));
  return (Array.isArray(issues) ? issues : [])
    .filter((issue) => !approvedKeys.has(String(issue?.evidenceReview?.issueKey || "")));
};
