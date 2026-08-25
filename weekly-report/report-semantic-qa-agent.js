import {
  buildReportSemanticQaPrompt,
  buildReportSemanticQaRepairPrompt
} from "./prompts.js";

const REQUIRED_CHECKS = Object.freeze([
  "titleGrounded",
  "introductionGrounded",
  "trendsMultiPaperGrounded",
  "observationsNotPromoted",
  "readingOrderAligned",
  "headTailIsolated",
  "readerLanguageChinese"
]);

const CHECK_ISSUE_CODES = Object.freeze({
  titleGrounded: "title_not_grounded",
  introductionGrounded: "introduction_not_grounded",
  trendsMultiPaperGrounded: "trend_not_multi_paper",
  observationsNotPromoted: "observation_promoted_to_trend",
  readingOrderAligned: "reading_order_mismatch",
  headTailIsolated: "head_tail_contamination",
  readerLanguageChinese: "reader_language_mismatch"
});

const ALLOWED_ISSUE_CODES = new Set([
  ...Object.values(CHECK_ISSUE_CODES),
  "evidence_boundary",
  "other"
]);
const ALLOWED_SEVERITIES = new Set(["high", "medium", "low"]);
const ALLOWED_RESPONSE_KEYS = new Set(["verdict", "summary", "checks", "issues"]);

const cleanText = (value, maximum = 1200) => String(value || "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, maximum);

const normalizedPaperId = (value) => cleanText(value, 200).replace(/v\d+$/i, "");

const requiresChinese = (value) => cleanText(value, 40).toLowerCase() === "zh-cn";

const reportReaderText = ({ report = {}, headTailDraft = {} } = {}) => [
  report?.title,
  report?.description,
  headTailDraft?.titleAngle,
  headTailDraft?.description,
  ...(Array.isArray(headTailDraft?.tags) ? headTailDraft.tags : []),
  headTailDraft?.reportIntroduction,
  ...(Array.isArray(headTailDraft?.trendJudgments)
    ? headTailDraft.trendJudgments.flatMap((entry) => [entry?.claim, entry?.caveat])
    : []),
  ...(Array.isArray(headTailDraft?.singlePaperObservations)
    ? headTailDraft.singlePaperObservations.flatMap((entry) => [entry?.claim, entry?.caveat])
    : []),
  ...(Array.isArray(headTailDraft?.readingOrder)
    ? headTailDraft.readingOrder.map((entry) => entry?.reason)
    : []),
  headTailDraft?.closingSummary
].map(String).join(" ");

const hasChineseReaderLanguage = (value) => {
  const visible = String(value || "").replace(/\s+/g, "");
  const cjkCount = (visible.match(/[\u3400-\u9fff]/gu) || []).length;
  return cjkCount >= 20 && cjkCount / Math.max(visible.length, 1) >= 0.15;
};

const paperIdForItem = (item = {}) => normalizedPaperId(
  item?.reviewResult?.paperId
  || item?.contextPacket?.paperId
  || item?.paper?.id
  || ""
);

const validationIssue = (code, path, message) => ({
  code,
  path,
  message: cleanText(message, 800)
});

const parseModelJson = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  const text = String(value || "").trim();
  if (!text) {
    throw new Error("Report Semantic QA returned an empty response.");
  }
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(unfenced.slice(start, end + 1));
    }
    throw new Error("Report Semantic QA did not return a JSON object.");
  }
};

const normalizedReportIssue = (value) => {
  const requestedCode = cleanText(value?.code, 100).toLowerCase();
  const severity = cleanText(value?.severity, 20).toLowerCase();
  return {
    code: ALLOWED_ISSUE_CODES.has(requestedCode) ? requestedCode : "other",
    severity: ALLOWED_SEVERITIES.has(severity) ? severity : "medium",
    field: cleanText(value?.field, 240),
    path: cleanText(value?.field, 240),
    claim: cleanText(value?.claim, 1200),
    reason: cleanText(value?.reason, 1400),
    supportingPaperIds: [...new Set((Array.isArray(value?.supportingPaperIds)
      ? value.supportingPaperIds
      : []).slice(0, 30).map(normalizedPaperId).filter(Boolean))],
    scope: "report",
    paperId: "",
    repairTarget: "head_tail",
    repairable: true
  };
};

export const validateReportSemanticQaResponse = (value, {
  report = {},
  headTailDraft = {},
  requiredLanguage = ""
} = {}) => {
  const schemaIssues = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      valid: false,
      issues: [validationIssue("schema_invalid", "response", "Report QA response must be an object.")],
      qaResult: null
    };
  }

  const unknownKeys = Object.keys(value).filter((key) => !ALLOWED_RESPONSE_KEYS.has(key));
  if (unknownKeys.length) {
    schemaIssues.push(validationIssue(
      "unknown_field",
      unknownKeys[0],
      "Report QA response contains an unsupported field."
    ));
  }

  const verdict = cleanText(value.verdict, 40).toLowerCase();
  if (!new Set(["pass", "repair_required"]).has(verdict)) {
    schemaIssues.push(validationIssue(
      "verdict_invalid",
      "verdict",
      "Report QA verdict must be pass or repair_required."
    ));
  }
  const summary = cleanText(value.summary, 1600);
  if (!summary) {
    schemaIssues.push(validationIssue("summary_required", "summary", "Report QA summary is required."));
  }

  const checksValue = value.checks && typeof value.checks === "object" && !Array.isArray(value.checks)
    ? value.checks
    : null;
  if (!checksValue) {
    schemaIssues.push(validationIssue("checks_required", "checks", "Report QA checks object is required."));
  }
  const checks = Object.fromEntries(REQUIRED_CHECKS.map((key) => [key, checksValue?.[key] === true]));
  for (const key of REQUIRED_CHECKS) {
    if (typeof checksValue?.[key] !== "boolean") {
      schemaIssues.push(validationIssue(
        "check_required",
        `checks.${key}`,
        `Report QA check ${key} must be boolean.`
      ));
    }
  }

  if (!Array.isArray(value.issues)) {
    schemaIssues.push(validationIssue("issues_required", "issues", "Report QA issues must be an array."));
  }
  const reportIssues = (Array.isArray(value.issues) ? value.issues : [])
    .slice(0, 30)
    .map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        schemaIssues.push(validationIssue(
          "issue_invalid",
          `issues[${index}]`,
          "Each report issue must be an object."
        ));
        return null;
      }
      const normalized = normalizedReportIssue(entry);
      if (!normalized.field || !normalized.reason) {
        schemaIssues.push(validationIssue(
          "issue_incomplete",
          `issues[${index}]`,
          "Each report issue requires field and reason."
        ));
      }
      return normalized;
    })
    .filter(Boolean);

  if (schemaIssues.length) {
    return { valid: false, issues: schemaIssues, qaResult: null };
  }

  if (requiresChinese(requiredLanguage)
    && !hasChineseReaderLanguage(reportReaderText({ report, headTailDraft }))) {
    checks.readerLanguageChinese = false;
    reportIssues.push(normalizedReportIssue({
      code: "reader_language_mismatch",
      severity: "high",
      field: "headTailDraft",
      claim: "The reader-facing report narrative is not written primarily in Simplified Chinese.",
      reason: "The publication contract requires Simplified Chinese reader-facing prose; titles and indispensable technical terms are the only exceptions."
    }));
  }

  for (const key of REQUIRED_CHECKS) {
    if (!checks[key] && !reportIssues.some((entry) => entry.code === CHECK_ISSUE_CODES[key])) {
      reportIssues.push(normalizedReportIssue({
        code: CHECK_ISSUE_CODES[key],
        severity: "medium",
        field: key,
        reason: `The ${key} check failed without a detailed model issue.`
      }));
    }
  }
  if (verdict === "repair_required" && reportIssues.length === 0) {
    reportIssues.push(normalizedReportIssue({
      code: "other",
      severity: "medium",
      field: "headTailDraft",
      reason: "The QA model requested repair without a detailed issue."
    }));
  }

  const status = REQUIRED_CHECKS.every((key) => checks[key]) && reportIssues.length === 0
    ? "passed"
    : "repair_required";
  return {
    valid: true,
    issues: [],
    qaResult: {
      status,
      verdict: status === "passed" ? "pass" : "repair_required",
      summary,
      checks,
      issues: reportIssues,
      repairTarget: status === "passed" ? null : "head_tail"
    }
  };
};

export class ReportSemanticQaError extends Error {
  constructor(message, {
    code = "READING_LIST_REPORT_QA_FAILED",
    retryable = false,
    issues = [],
    cause
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ReportSemanticQaError";
    this.code = code;
    this.stage = "report_semantic_qa";
    this.paperId = "";
    this.retryable = retryable;
    this.excludePaper = false;
    this.rejectJob = true;
    this.issues = issues;
  }
}

const abortError = () => {
  const error = new Error("Report Semantic QA was cancelled.");
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

const serializedError = (error) => ({
  code: String(error?.code || "READING_LIST_REPORT_QA_FAILED"),
  message: String(error?.message || "Report Semantic QA failed."),
  stage: String(error?.stage || "report_semantic_qa"),
  paperId: "",
  retryable: Boolean(error?.retryable),
  excludePaper: false,
  rejectJob: Boolean(error?.rejectJob),
  issues: Array.isArray(error?.issues) ? error.issues : []
});

const assertReportQaInputs = ({ report, editorialPlan, headTailDraft, selectedItems, paperDrafts }) => {
  const selectedIds = (Array.isArray(selectedItems) ? selectedItems : []).map(paperIdForItem);
  const draftIds = (Array.isArray(paperDrafts) ? paperDrafts : []).map((draft) => (
    normalizedPaperId(draft?.paperId)
  ));
  if (!cleanText(report?.title) || !cleanText(report?.description)) {
    throw new ReportSemanticQaError("Report Semantic QA requires final report metadata.");
  }
  if (!editorialPlan || typeof editorialPlan !== "object"
    || !headTailDraft || typeof headTailDraft !== "object"
    || selectedIds.length === 0
    || selectedIds.some((paperId) => !paperId)
    || draftIds.length !== selectedIds.length
    || draftIds.some((paperId, index) => paperId !== selectedIds[index])) {
    throw new ReportSemanticQaError("Report Semantic QA requires aligned report artifacts.");
  }
};

export const reviewReportSemantics = async ({
  report,
  editorialPlan,
  headTailDraft,
  selectedItems,
  paperDrafts,
  callModel,
  signal,
  onCall,
  onEvent,
  requiredLanguage = "",
  networkRetryDelayMs = 50
} = {}) => {
  assertReportQaInputs({ report, editorialPlan, headTailDraft, selectedItems, paperDrafts });
  if (typeof callModel !== "function") {
    throw new TypeError("Report Semantic QA callModel is required.");
  }
  if (signal?.aborted) {
    throw abortError();
  }

  const promptOptions = { report, editorialPlan, headTailDraft, selectedItems, paperDrafts };
  const calls = [];
  const invoke = async (prompt, attemptType) => {
    if (signal?.aborted) {
      throw abortError();
    }
    await onEvent?.({ type: "model_call_started", stage: "report_semantic_qa", scope: "job", role: "report_semantic_qa", paperId: "", attemptType });
    const startedAt = Date.now();
    let rawOutput;
    try {
      rawOutput = await callModel(prompt, {
        role: "report_semantic_qa",
        paperId: "",
        attemptType,
        signal
      });
    } catch (error) {
      const record = {
        role: "report_semantic_qa",
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
      validation = validateReportSemanticQaResponse(parseModelJson(rawOutput), {
        report,
        headTailDraft,
        requiredLanguage
      });
    } catch (error) {
      validation = {
        valid: false,
        issues: [validationIssue("invalid_json", "response", error.message)],
        qaResult: null
      };
    }
    const record = {
      role: "report_semantic_qa",
      paperId: "",
      attemptType,
      prompt,
      rawOutput,
      normalizedOutput: validation.qaResult,
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
        stage: "report_semantic_qa",
        paperId: "",
        waitMs: networkRetryDelayMs,
        error: serializedError(error)
      });
      await waitForRetry(networkRetryDelayMs, signal);
      try {
        return await invoke(prompt, `${attemptType}_network_retry`);
      } catch (retryError) {
        if (retryError?.name === "AbortError") {
          throw retryError;
        }
        throw new ReportSemanticQaError("Report Semantic QA model call failed after one network retry.", {
          retryable: false,
          cause: retryError
        });
      }
    }
  };

  let validation = await invokeWithNetworkRetry(
    buildReportSemanticQaPrompt(promptOptions),
    "initial"
  );
  if (validation.valid) {
    return {
      qaResult: validation.qaResult,
      responseRepairAttempted: false,
      calls
    };
  }

  await onEvent?.({
    type: "report_semantic_qa_response_repair_requested",
    stage: "report_semantic_qa",
    scope: "report",
    issues: validation.issues
  });
  validation = await invokeWithNetworkRetry(
    buildReportSemanticQaRepairPrompt({ ...promptOptions, issues: validation.issues }),
    "response_repair"
  );
  if (!validation.valid) {
    throw new ReportSemanticQaError("Report Semantic QA response remains invalid after one structured repair.", {
      issues: validation.issues
    });
  }

  return {
    qaResult: validation.qaResult,
    responseRepairAttempted: true,
    calls
  };
};
