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
const paperId = (value) => String(value || "").trim().replace(/v\d+$/i, "");
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

const reviewKey = ({ issue, targetPaperId, field }) => {
  const code = String(issue?.code || "");
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
  return [code, targetPaperId, field?.path, fingerprint]
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
