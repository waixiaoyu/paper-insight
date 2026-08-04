import {
  buildPaperSemanticQaPrompt,
  buildPaperSemanticQaRepairPrompt
} from "./prompts.js";

const REQUIRED_CHECKS = Object.freeze([
  "factsGrounded",
  "methodGrounded",
  "experimentsGrounded",
  "numbersGrounded",
  "affiliationsGrounded",
  "limitationsGrounded",
  "recommendationToneAligned",
  "readerLanguageChinese"
]);

const CHECK_ISSUE_CODES = Object.freeze({
  factsGrounded: "unsupported_fact",
  methodGrounded: "method_mismatch",
  experimentsGrounded: "experiment_mismatch",
  numbersGrounded: "unsupported_number",
  affiliationsGrounded: "affiliation_mismatch",
  limitationsGrounded: "limitation_gap",
  recommendationToneAligned: "recommendation_tone_mismatch",
  readerLanguageChinese: "reader_language_mismatch"
});

const ALLOWED_ISSUE_CODES = new Set([
  ...Object.values(CHECK_ISSUE_CODES),
  "cross_paper_contamination",
  "evidence_boundary",
  "other"
]);
const ALLOWED_SEVERITIES = new Set(["high", "medium", "low"]);
const ALLOWED_RESPONSE_KEYS = new Set(["paperId", "verdict", "summary", "checks", "issues"]);

const cleanText = (value, maximum = 1200) => String(value || "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, maximum);

const normalizedPaperId = (value) => cleanText(value, 200).replace(/v\d+$/i, "");

const requiresChinese = (value) => cleanText(value, 40).toLowerCase() === "zh-cn";

const paperReaderText = (paperDraft = {}) => [
  paperDraft?.oneSentenceTakeaway?.text,
  paperDraft?.researchProblem?.text,
  paperDraft?.coreContribution?.text,
  paperDraft?.methodFramework?.text,
  paperDraft?.experimentsAndResults?.text,
  ...(Array.isArray(paperDraft?.limitationsAndConstraints)
    ? paperDraft.limitationsAndConstraints.map((entry) => entry?.text)
    : []),
  paperDraft?.adnInsight?.text,
  paperDraft?.readingValue?.whyWorthReading?.text,
  paperDraft?.readingValue?.recommendedFocus?.text,
  paperDraft?.readingValue?.evidenceBoundary?.text
].map(String).join(" ");

const hasChineseReaderLanguage = (value) => {
  const visible = String(value || "").replace(/\s+/g, "");
  const cjkCount = (visible.match(/[\u3400-\u9fff]/gu) || []).length;
  return cjkCount >= 20 && cjkCount / Math.max(visible.length, 1) >= 0.15;
};

const paperIdForItem = (item = {}) => normalizedPaperId(
  item?.evidenceCard?.paperId
  || item?.contextPacket?.paperId
  || item?.reviewResult?.paperId
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
    throw new Error("Paper Semantic QA returned an empty response.");
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
    throw new Error("Paper Semantic QA did not return a JSON object.");
  }
};

const normalizedSemanticIssue = (value, paperId) => {
  const requestedCode = cleanText(value?.code, 100).toLowerCase();
  const severity = cleanText(value?.severity, 20).toLowerCase();
  return {
    code: ALLOWED_ISSUE_CODES.has(requestedCode) ? requestedCode : "other",
    severity: ALLOWED_SEVERITIES.has(severity) ? severity : "medium",
    field: cleanText(value?.field, 240),
    path: cleanText(value?.field, 240),
    claim: cleanText(value?.claim, 1000),
    reason: cleanText(value?.reason, 1200),
    evidenceRefs: [...new Set((Array.isArray(value?.evidenceRefs) ? value.evidenceRefs : [])
      .slice(0, 20)
      .map((entry) => cleanText(entry, 120))
      .filter(Boolean))],
    scope: "paper",
    paperId,
    repairTarget: "paper_section",
    repairable: true
  };
};

export const validatePaperSemanticQaResponse = (value, {
  item,
  paperDraft,
  requiredLanguage = ""
} = {}) => {
  const expectedPaperId = paperIdForItem(item);
  const draftPaperId = normalizedPaperId(paperDraft?.paperId);
  const schemaIssues = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      valid: false,
      issues: [validationIssue("schema_invalid", "response", "QA response must be an object.")],
      qaResult: null
    };
  }

  const unknownKeys = Object.keys(value).filter((key) => !ALLOWED_RESPONSE_KEYS.has(key));
  if (unknownKeys.length) {
    schemaIssues.push(validationIssue(
      "unknown_field",
      unknownKeys[0],
      "QA response contains an unsupported field."
    ));
  }

  const responsePaperId = normalizedPaperId(value.paperId);
  if (!expectedPaperId || !draftPaperId || draftPaperId !== expectedPaperId) {
    schemaIssues.push(validationIssue(
      "input_identity_mismatch",
      "paperId",
      "Paper Semantic QA input artifacts do not identify the same paper."
    ));
  }
  if (!responsePaperId || responsePaperId !== expectedPaperId) {
    schemaIssues.push(validationIssue(
      "paper_id_mismatch",
      "paperId",
      "QA response paperId does not match its input paper."
    ));
  }

  const verdict = cleanText(value.verdict, 40).toLowerCase();
  if (!new Set(["pass", "repair_required"]).has(verdict)) {
    schemaIssues.push(validationIssue(
      "verdict_invalid",
      "verdict",
      "QA verdict must be pass or repair_required."
    ));
  }

  const summary = cleanText(value.summary, 1600);
  if (!summary) {
    schemaIssues.push(validationIssue("summary_required", "summary", "QA summary is required."));
  }

  const checksValue = value.checks && typeof value.checks === "object" && !Array.isArray(value.checks)
    ? value.checks
    : null;
  if (!checksValue) {
    schemaIssues.push(validationIssue("checks_required", "checks", "QA checks object is required."));
  }
  const checks = Object.fromEntries(REQUIRED_CHECKS.map((key) => [key, checksValue?.[key] === true]));
  for (const key of REQUIRED_CHECKS) {
    if (typeof checksValue?.[key] !== "boolean") {
      schemaIssues.push(validationIssue(
        "check_required",
        `checks.${key}`,
        `QA check ${key} must be boolean.`
      ));
    }
  }

  if (!Array.isArray(value.issues)) {
    schemaIssues.push(validationIssue("issues_required", "issues", "QA issues must be an array."));
  }
  const semanticIssues = (Array.isArray(value.issues) ? value.issues : [])
    .slice(0, 30)
    .map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        schemaIssues.push(validationIssue(
          "issue_invalid",
          `issues[${index}]`,
          "Each semantic issue must be an object."
        ));
        return null;
      }
      const normalized = normalizedSemanticIssue(entry, expectedPaperId);
      if (!normalized.field || !normalized.reason) {
        schemaIssues.push(validationIssue(
          "issue_incomplete",
          `issues[${index}]`,
          "Each semantic issue requires field and reason."
        ));
      }
      return normalized;
    })
    .filter(Boolean);

  for (const key of REQUIRED_CHECKS) {
    if (!checks[key] && !semanticIssues.some((entry) => entry.code === CHECK_ISSUE_CODES[key])) {
      schemaIssues.push(validationIssue(
        "false_check_without_issue",
        `checks.${key}`,
        `A false ${key} check requires a detailed ${CHECK_ISSUE_CODES[key]} issue.`
      ));
    }
  }
  if (verdict === "repair_required" && semanticIssues.length === 0) {
    schemaIssues.push(validationIssue(
      "repair_without_issue",
      "issues",
      "A repair_required verdict requires at least one detailed semantic issue."
    ));
  }

  if (schemaIssues.length) {
    return { valid: false, issues: schemaIssues, qaResult: null };
  }

  if (requiresChinese(requiredLanguage) && !hasChineseReaderLanguage(paperReaderText(paperDraft))) {
    checks.readerLanguageChinese = false;
    semanticIssues.push(normalizedSemanticIssue({
      code: "reader_language_mismatch",
      severity: "high",
      field: "paperDraft",
      claim: "The reader-facing paper section is not written primarily in Simplified Chinese.",
      reason: "The publication contract requires Simplified Chinese reader-facing prose; titles and indispensable technical terms are the only exceptions."
    }, expectedPaperId));
  }

  const status = REQUIRED_CHECKS.every((key) => checks[key]) && semanticIssues.length === 0
    ? "passed"
    : "repair_required";
  return {
    valid: true,
    issues: [],
    qaResult: {
      paperId: expectedPaperId,
      status,
      verdict: status === "passed" ? "pass" : "repair_required",
      summary,
      checks,
      issues: semanticIssues,
      repairTarget: status === "passed" ? null : "paper_section"
    }
  };
};

export class PaperSemanticQaError extends Error {
  constructor(message, {
    code = "READING_LIST_PAPER_QA_FAILED",
    paperId = "",
    retryable = false,
    issues = [],
    cause
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PaperSemanticQaError";
    this.code = code;
    this.stage = "paper_semantic_qa";
    this.paperId = paperId;
    this.retryable = retryable;
    this.excludePaper = false;
    this.rejectJob = true;
    this.issues = issues;
  }
}

const abortError = () => {
  const error = new Error("Paper Semantic QA was cancelled.");
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
  code: String(error?.code || "READING_LIST_PAPER_QA_FAILED"),
  message: String(error?.message || "Paper Semantic QA failed."),
  stage: String(error?.stage || "paper_semantic_qa"),
  paperId: String(error?.paperId || paperId),
  retryable: Boolean(error?.retryable),
  excludePaper: false,
  rejectJob: Boolean(error?.rejectJob),
  issues: Array.isArray(error?.issues) ? error.issues : []
});

export const reviewPaperSemantics = async ({
  item,
  paperDraft,
  callModel,
  signal,
  onCall,
  onEvent,
  requiredLanguage = "",
  networkRetryDelayMs = 50
} = {}) => {
  const paperId = paperIdForItem(item);
  if (!paperId || normalizedPaperId(paperDraft?.paperId) !== paperId) {
    throw new PaperSemanticQaError("Paper Semantic QA requires matching paper artifacts.", {
      paperId,
      issues: [validationIssue("input_identity_mismatch", "paperId", "Input paper identities differ.")]
    });
  }
  if (typeof callModel !== "function") {
    throw new TypeError("Paper Semantic QA callModel is required.");
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
        role: "paper_semantic_qa",
        paperId,
        attemptType,
        signal
      });
    } catch (error) {
      const record = {
        role: "paper_semantic_qa",
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
      validation = validatePaperSemanticQaResponse(parseModelJson(rawOutput), {
        item,
        paperDraft,
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
      role: "paper_semantic_qa",
      paperId,
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
        stage: "paper_semantic_qa",
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
        throw new PaperSemanticQaError("Paper Semantic QA model call failed after one network retry.", {
          paperId,
          retryable: false,
          cause: retryError
        });
      }
    }
  };

  let validation = await invokeWithNetworkRetry(
    buildPaperSemanticQaPrompt({ item, paperDraft }),
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
    type: "paper_semantic_qa_response_repair_requested",
    stage: "paper_semantic_qa",
    paperId,
    issues: validation.issues
  });
  validation = await invokeWithNetworkRetry(
    buildPaperSemanticQaRepairPrompt({ item, paperDraft, issues: validation.issues }),
    "response_repair"
  );
  if (!validation.valid) {
    throw new PaperSemanticQaError("Paper Semantic QA response remains invalid after one structured repair.", {
      paperId,
      issues: validation.issues
    });
  }

  return {
    qaResult: validation.qaResult,
    responseRepairAttempted: true,
    calls
  };
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

export const reviewPaperSemanticsBatch = async (items, paperDrafts, {
  paperConcurrency = 2,
  callModel,
  signal,
  onCall,
  onEvent,
  requiredLanguage = "",
  networkRetryDelayMs = 50
} = {}) => {
  const candidates = Array.isArray(items) ? items : [];
  const drafts = Array.isArray(paperDrafts) ? paperDrafts : [];
  const draftByPaperId = new Map(drafts.map((draft) => [normalizedPaperId(draft?.paperId), draft]));
  const concurrency = Math.min(Math.max(Math.trunc(Number(paperConcurrency) || 2), 1), 5);
  const results = await mapWithConcurrency(candidates, concurrency, async (item) => {
    if (signal?.aborted) {
      throw abortError();
    }
    const paperId = paperIdForItem(item);
    const paperDraft = draftByPaperId.get(paperId);
    try {
      const result = await reviewPaperSemantics({
        item,
        paperDraft,
        callModel,
        signal,
        onCall,
        onEvent,
        requiredLanguage,
        networkRetryDelayMs
      });
      await onEvent?.({
        type: "paper_semantic_qa_completed",
        stage: "paper_semantic_qa",
        scope: "paper",
        paperId,
        status: result.qaResult.status,
        issueCount: result.qaResult.issues.length,
        responseRepairAttempted: result.responseRepairAttempted
      });
      return { ok: true, item, paperDraft, ...result };
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) {
        throw abortError();
      }
      await onEvent?.({
        type: "paper_semantic_qa_failed",
        stage: "paper_semantic_qa",
        scope: "paper",
        paperId,
        error: serializedError(error, paperId)
      });
      return { ok: false, item, paperDraft, error };
    }
  });

  return {
    succeeded: results.filter((entry) => entry.ok).map((entry) => ({
      item: entry.item,
      paperDraft: entry.paperDraft,
      qaResult: entry.qaResult,
      responseRepairAttempted: entry.responseRepairAttempted
    })),
    failed: results.filter((entry) => !entry.ok).map((entry) => ({
      item: entry.item,
      error: serializedError(entry.error, paperIdForItem(entry.item))
    })),
    attempted: candidates.length,
    concurrency
  };
};
