import { compactEvidenceReviews } from "./evidence-review.js";

export const MANUAL_REVIEW_KINDS = Object.freeze([
  "processing_failure",
  "evidence_dispute",
  "quality_below_threshold"
]);

export const MANUAL_REVIEW_ACTIONS = Object.freeze([
  "continue_repair",
  "retry_paper",
  "retry_stage",
  "retry_job",
  "confirm_evidence",
  "include_below_threshold",
  "keep_excluded",
  "skip_paper",
  "ignore_warning",
  "exit_task"
]);

const REVIEW_KINDS = new Set(MANUAL_REVIEW_KINDS);
const REVIEW_ACTIONS = new Set(MANUAL_REVIEW_ACTIONS);
const GATE_STATES = new Set(["passed", "failed", "unknown"]);
const REQUIRED_SELECTION_GATES = ["fullText", "identity", "evidence", "crossPaper"];

const text = (value, maximum = 2000) => String(value || "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, maximum);

const uniqueText = (values, maximum = 200) => [...new Set((Array.isArray(values) ? values : [])
  .map((value) => text(value, maximum))
  .filter(Boolean))];

const object = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
};

const normalizedDetails = (values) => (Array.isArray(values) ? values : [])
  .slice(0, 30)
  .filter((value) => value && typeof value === "object" && !Array.isArray(value))
  .map((value) => ({
    title: text(value.title, 200),
    requirement: text(value.requirement, 1200),
    actual: text(value.actual, 1200),
    text: text(value.text || value.detail || value.message, 1600),
    path: text(value.path, 300),
    code: text(value.code, 160)
  }));

const normalizedIssues = (values) => (Array.isArray(values) ? values : [])
  .slice(0, 30)
  .filter((value) => value && typeof value === "object" && !Array.isArray(value))
  .map((value) => ({
    code: text(value.code, 160),
    path: text(value.path, 300),
    detail: text(value.detail, 1600),
    reason: text(value.reason || value.message, 1600)
  }));

const normalizedScoreSnapshot = (value) => {
  if (value === null || value === undefined) return null;
  const score = object(value, "Manual review scoreSnapshot");
  const finalScore = Number(score.finalScore);
  const threshold = Number(score.threshold);
  if (!Number.isFinite(finalScore) || !Number.isFinite(threshold)) {
    throw new TypeError("Manual review scoreSnapshot requires finite finalScore and threshold.");
  }
  const dimensions = score.dimensions && typeof score.dimensions === "object" && !Array.isArray(score.dimensions)
    ? Object.fromEntries(Object.entries(score.dimensions)
      .slice(0, 8)
      .filter(([, item]) => Number.isFinite(Number(item)))
      .map(([key, item]) => [text(key, 80), Number(item)]))
    : {};
  return {
    finalScore,
    threshold,
    dimensions,
    calibrationStatus: text(score.calibrationStatus, 80),
    comparisonReason: text(score.comparisonReason, 1600),
    defaultSelection: text(score.defaultSelection, 80)
  };
};

const normalizedGateStatus = (value) => {
  const gates = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(gates)
    .slice(0, 12)
    .map(([key, state]) => [text(key, 80), text(state, 20).toLowerCase()])
    .filter(([key, state]) => key && GATE_STATES.has(state)));
};

const legacyReviewKind = (value) => {
  const kind = text(value, 80);
  if (REVIEW_KINDS.has(kind)) return kind;
  if (["execution_failure", "agent_interrupted", "processing_failed"].includes(kind)) {
    return "processing_failure";
  }
  if (["selection_below_threshold", "quality_below_line"].includes(kind)) {
    return "quality_below_threshold";
  }
  return "evidence_dispute";
};

const legacyItem = (review) => ({
  itemId: text(review.itemId, 160) || `${text(review.stage, 120) || "manual_review"}:${text(review.paperId, 160) || "job"}:0`,
  paperId: review.paperId,
  relatedPaperIds: review.relatedPaperIds,
  kind: legacyReviewKind(review.kind),
  scope: review.paperId ? "paper" : "job",
  sourceStage: review.stage,
  summary: review.summary,
  details: review.details,
  issues: review.issues,
  evidenceReviews: review.evidenceReviews,
  approvableIssueKeys: review.approvableIssueKeys,
  scoreSnapshot: review.scoreSnapshot,
  gateStatus: review.gateStatus,
  repairAttempts: review.repairAttempts,
  allowedActions: review.allowedActions
});

const normalizedItem = (value, index) => {
  const item = object(value, `Manual review item ${index}`);
  const itemId = text(item.itemId, 160);
  const kind = text(item.kind, 80);
  const scope = text(item.scope || "paper", 40);
  const sourceStage = text(item.sourceStage, 120);
  const allowedActions = uniqueText(item.allowedActions, 80);
  if (!itemId || !REVIEW_KINDS.has(kind)) {
    throw new TypeError("Manual review item requires a known itemId and kind.");
  }
  if (!["paper", "job"].includes(scope) || !sourceStage) {
    throw new TypeError("Manual review item scope and sourceStage are invalid.");
  }
  if (!allowedActions.length || allowedActions.some((action) => !REVIEW_ACTIONS.has(action))) {
    throw new TypeError("Manual review item allowedActions is invalid.");
  }
  const paperId = text(item.paperId, 160);
  if (scope === "paper" && !paperId) {
    throw new TypeError("Paper-scoped manual review item requires paperId.");
  }
  const gateStatus = normalizedGateStatus(item.gateStatus);
  const scoreSnapshot = normalizedScoreSnapshot(item.scoreSnapshot);
  if (kind === "quality_below_threshold" && !scoreSnapshot) {
    throw new TypeError("Quality manual review item requires scoreSnapshot.");
  }
  if (allowedActions.includes("include_below_threshold")
    && REQUIRED_SELECTION_GATES.some((gate) => gateStatus[gate] !== "passed")) {
    throw new TypeError("Manual inclusion requires every selection credibility gate to pass.");
  }
  const evidenceReviews = compactEvidenceReviews(item.evidenceReviews);
  const availableIssueKeys = new Set(evidenceReviews.map((entry) => entry.issueKey));
  const approvableIssueKeys = uniqueText(item.approvableIssueKeys, 1000)
    .filter((issueKey) => availableIssueKeys.has(issueKey));
  return {
    itemId,
    paperId,
    relatedPaperIds: uniqueText([paperId, ...(Array.isArray(item.relatedPaperIds) ? item.relatedPaperIds : [])], 160),
    kind,
    scope,
    sourceStage,
    summary: text(item.summary, 1600),
    details: normalizedDetails(item.details),
    issues: normalizedIssues(item.issues),
    evidenceReviews,
    approvableIssueKeys,
    scoreSnapshot,
    gateStatus,
    repairAttempts: Math.max(0, Math.trunc(Number(item.repairAttempts) || 0)),
    allowedActions
  };
};

export const normalizeManualReviewRequest = (value, { requestedAt = new Date().toISOString() } = {}) => {
  const review = object(value, "Manual review request");
  const stage = text(review.stage, 120);
  const isQueue = Array.isArray(review.items);
  const resumeStage = text(isQueue ? review.resumeStage : (review.resumeStage || review.stage), 120);
  const rawItems = isQueue ? review.items : [legacyItem(review)];
  if (!stage || !resumeStage || !rawItems.length) {
    throw new TypeError("Manual review requires stage, resumeStage and items.");
  }
  const items = rawItems.map(normalizedItem);
  if (new Set(items.map((item) => item.itemId)).size !== items.length) {
    throw new TypeError("Manual review item IDs must be unique.");
  }
  const requestedTime = new Date(requestedAt);
  if (!Number.isFinite(requestedTime.getTime())) {
    throw new TypeError("Manual review requestedAt must be a valid date.");
  }
  const activeItemId = text(review.activeItemId, 160) || items[0].itemId;
  if (!items.some((item) => item.itemId === activeItemId)) {
    throw new TypeError("Manual review activeItemId must reference an item.");
  }
  return {
    status: "waiting_admin",
    stage,
    resumeStage,
    activeItemId,
    items,
    requestedAt: requestedTime.toISOString()
  };
};

export const manualReviewItem = (review, itemId) => {
  const normalizedId = text(itemId, 160);
  return (Array.isArray(review?.items) ? review.items : [])
    .find((item) => item?.itemId === normalizedId) || null;
};

export const withoutManualReviewItem = (review, itemId) => {
  const selected = manualReviewItem(review, itemId);
  if (!selected) return review || null;
  const items = review.items.filter((item) => item.itemId !== selected.itemId);
  if (!items.length) return null;
  return {
    ...review,
    activeItemId: review.activeItemId === selected.itemId ? items[0].itemId : review.activeItemId,
    items
  };
};
