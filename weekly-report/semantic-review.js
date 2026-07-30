const ALLOWED_VERDICTS = new Set(["pass", "review", "reject"]);
const ALLOWED_SEVERITIES = new Set(["high", "medium", "low"]);
const ALLOWED_CATEGORIES = new Set([
  "unsupported_claim",
  "cross_paper_contamination",
  "trend_grounding",
  "score_tone_mismatch",
  "affiliation",
  "adn_relevance",
  "evidence_boundary",
  "internal_process_leak",
  "other"
]);
const REQUIRED_CHECKS = [
  "paperGrounding",
  "crossPaperIsolation",
  "trendGrounding",
  "scoreToneConsistency",
  "affiliationGrounding",
  "evidenceBoundary",
  "adnSpecificity"
];
const CRITICAL_CHECKS = new Set([
  "paperGrounding",
  "crossPaperIsolation",
  "affiliationGrounding",
  "evidenceBoundary"
]);

const normalizeText = (value, max = 800) => (
  String(value || "").replace(/\s+/g, " ").trim().slice(0, max)
);

export const normalizeSemanticReviewMode = (value, fallback = "warn") => {
  const mode = String(value || "").trim().toLowerCase();
  return ["off", "warn", "enforce"].includes(mode) ? mode : fallback;
};

export const normalizeWeeklyReportSemanticReview = (value, { mode = "warn" } = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("LLM semantic review did not return a JSON object.");
    error.code = "WEEKLY_REPORT_SEMANTIC_REVIEW_INVALID";
    throw error;
  }

  const requestedVerdict = String(value.verdict || "").trim().toLowerCase();

  if (!ALLOWED_VERDICTS.has(requestedVerdict)) {
    const error = new Error("LLM semantic review returned an invalid verdict.");
    error.code = "WEEKLY_REPORT_SEMANTIC_REVIEW_INVALID";
    throw error;
  }

  const rawScore = Number(value.score);
  const summary = normalizeText(value.summary, 1000);

  if (!Number.isFinite(rawScore) || !summary) {
    const error = new Error("LLM semantic review omitted score or summary.");
    error.code = "WEEKLY_REPORT_SEMANTIC_REVIEW_INVALID";
    throw error;
  }

  const rawChecks = value.checks && typeof value.checks === "object" && !Array.isArray(value.checks)
    ? value.checks
    : {};
  const missingChecks = REQUIRED_CHECKS.filter((key) => typeof rawChecks[key] !== "boolean");

  if (missingChecks.length) {
    const error = new Error(`LLM semantic review omitted checks: ${missingChecks.join(", ")}.`);
    error.code = "WEEKLY_REPORT_SEMANTIC_REVIEW_INVALID";
    throw error;
  }

  const checks = Object.fromEntries(REQUIRED_CHECKS.map((key) => [key, rawChecks[key] === true]));
  const issues = (Array.isArray(value.issues) ? value.issues : [])
    .slice(0, 20)
    .map((issue) => {
      const severity = ALLOWED_SEVERITIES.has(String(issue?.severity || "").toLowerCase())
        ? String(issue.severity).toLowerCase()
        : "medium";
      const category = ALLOWED_CATEGORIES.has(String(issue?.category || "").toLowerCase())
        ? String(issue.category).toLowerCase()
        : "other";

      return {
        severity,
        category,
        paperId: normalizeText(issue?.paperId, 160),
        claim: normalizeText(issue?.claim, 500),
        reason: normalizeText(issue?.reason, 800),
        evidence: normalizeText(issue?.evidence, 800)
      };
    })
    .filter((issue) => issue.claim || issue.reason);
  const hasHigh = issues.some((issue) => issue.severity === "high");
  const hasMedium = issues.some((issue) => issue.severity === "medium");
  const hasCriticalCheckFailure = REQUIRED_CHECKS.some((key) => CRITICAL_CHECKS.has(key) && !checks[key]);
  const hasAdvisoryCheckFailure = REQUIRED_CHECKS.some((key) => !CRITICAL_CHECKS.has(key) && !checks[key]);
  const verdict = hasHigh || hasCriticalCheckFailure
    ? "reject"
    : requestedVerdict === "pass" && (hasMedium || hasAdvisoryCheckFailure)
      ? "review"
      : requestedVerdict;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    mode: normalizeSemanticReviewMode(mode),
    status: "completed",
    verdict,
    score,
    summary,
    issues,
    checks,
    publishable: verdict !== "reject",
    requiresManualReview: verdict !== "pass"
  };
};

export const semanticReviewUnavailable = (error, { mode = "warn" } = {}) => ({
  mode: normalizeSemanticReviewMode(mode),
  status: "unavailable",
  verdict: "review",
  score: 0,
  summary: "LLM 语义评审暂不可用，需要人工复核后再发布。",
  issues: [
    {
      severity: "medium",
      category: "other",
      paperId: "",
      claim: "",
      reason: normalizeText(error?.message || "LLM semantic review unavailable.", 800),
      evidence: ""
    }
  ],
  checks: {},
  publishable: true,
  requiresManualReview: true
});

export const assertSemanticReviewAllowsPublication = (review, { mode = "warn" } = {}) => {
  const normalizedMode = normalizeSemanticReviewMode(mode);

  if (normalizedMode !== "enforce") {
    return review;
  }

  if (review?.status !== "completed" || review?.verdict !== "pass") {
    const error = new Error(
      review?.status === "unavailable"
        ? "周报 LLM 语义评审不可用，强制模式下已阻止发布。"
        : `周报 LLM 语义评审结论为 ${review?.verdict || "unknown"}，强制模式下已阻止发布。`
    );
    error.code = review?.status === "unavailable"
      ? "WEEKLY_REPORT_SEMANTIC_REVIEW_FAILED"
      : "WEEKLY_REPORT_SEMANTIC_REVIEW_REJECTED";
    error.status = 502;
    error.semanticReview = review;
    throw error;
  }

  return review;
};
