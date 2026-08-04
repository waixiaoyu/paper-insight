import { runEvidenceAgent, validateEvidenceArtifacts } from "./evidence-agent.js";
import {
  buildReviewPrompt,
  buildReviewRepairPrompt
} from "./prompts.js";
import { EVIDENCE_FIELDS } from "./schema.js";

export const REVIEW_SCORE_DIMENSIONS = Object.freeze([
  "scenarioProblemValue",
  "methodNovelty",
  "practicalValue",
  "evidence"
]);

const REVIEW_WEIGHTS = Object.freeze({
  scenarioProblemValue: 0.2,
  methodNovelty: 0.3,
  practicalValue: 0.2,
  evidence: 0.3
});
const INTEREST_FITS = new Set([
  "target_network_autonomy",
  "general_ai_system",
  "out_of_scope_domain",
  "unclear"
]);
const TARGET_NETWORK_EVIDENCE_PATTERN = /\b(?:autonomous\s+network(?:ing)?|self-driving\s+network|zero-touch\s+network|network\s+digital\s+twin|intent[-\s]?based\s+network(?:ing)?|network\s+(?:automation|orchestration|management|operations?)|service\s+assurance|O-RAN|RAN|radio\s+access\s+network|telecom(?:munications?)?|ICT|5G|6G|wireless\s+communications?|cellular\s+network|mobile\s+network|core\s+network|edge\s+network|optical\s+network|satellite\s+network|network\s+slicing|routing|QoS|spectrum|handover|fault\s+diagnosis|alarm\s+correlation)\b|网络自治|自智网络|零接触网络|网络数字孪生|意图驱动网络|网络自动化|网络编排|网络运维|电信|通信网络|无线通信|蜂窝网络|移动网络|无线接入|网络切片|路由|频谱|切换|故障诊断|告警关联|业务保障/iu;
const GENERAL_AI_EVIDENCE_PATTERN = /\b(?:large\s+language\s+model|LLM|foundation\s+model|AI[-\s]?agents?|autonomous\s+agents?|multi[-\s]?agents?|RAG|tool[-\s]?calling|benchmark|evaluation|guardrail|planning|reasoning|simulator)\b|大模型|智能体|多智能体|工具调用|评测|基准|规划|推理|模拟器/iu;
const OUT_OF_SCOPE_EVIDENCE_PATTERN = /\b(?:medical|clinical|healthcare|genom(?:e|ic)|protein|drug|neuroscience|biology|geospatial|remote\s+sensing|game|gaming|recommend(?:er|ation)|social\s+media|education|finance|legal|chemistry|molecular)\b|医学|医疗|临床|基因|蛋白|药物|神经科学|生命科学|遥感|游戏|推荐系统|教育|金融|法律|化学|分子/iu;

const normalizeText = (value, maximum = 2400) => String(value || "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, maximum);

const interestEvidenceText = (item = {}) => EVIDENCE_FIELDS.flatMap((field) => {
  const evidence = item?.evidenceCard?.[field];
  return [
    evidence?.summary,
    ...(Array.isArray(evidence?.sources) ? evidence.sources.map((source) => source?.excerpt) : [])
  ];
}).map((entry) => normalizeText(entry, 12000)).filter(Boolean).join(" ");

const inferInterestFitFromEvidence = (item = {}) => {
  const text = interestEvidenceText(item);
  if (TARGET_NETWORK_EVIDENCE_PATTERN.test(text)) {
    return "target_network_autonomy";
  }
  if (GENERAL_AI_EVIDENCE_PATTERN.test(text)) {
    return "general_ai_system";
  }
  if (OUT_OF_SCOPE_EVIDENCE_PATTERN.test(text)) {
    return "out_of_scope_domain";
  }
  return "unclear";
};

const NORMALIZED_INTEREST_REASONS = Object.freeze({
  general_ai_system: "The Evidence describes a general AI, agent, benchmark, or system contribution; transferability does not make network autonomy the paper's primary problem domain.",
  out_of_scope_domain: "The Evidence describes a specialized non-network domain and does not establish network autonomy as the primary problem domain.",
  unclear: "The Evidence does not establish network autonomy as the paper's primary problem domain."
});

const normalizedPaperId = (value) => {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/(?:^|\/)(\d{4}\.\d{4,5})(?:v\d+)?(?:$|[?#/])/i);
  return match?.[1] || text.replace(/v\d+$/i, "");
};

const clampScore = (value) => Math.min(Math.max(Number(value) || 0, 0), 100);

export const calculateReviewRawScore = (scores = {}) => {
  const normalized = Object.fromEntries(REVIEW_SCORE_DIMENSIONS.map((dimension) => [
    dimension,
    clampScore(scores[dimension])
  ]));
  const base = REVIEW_SCORE_DIMENSIONS.reduce((total, dimension) => (
    total + normalized[dimension] * REVIEW_WEIGHTS[dimension]
  ), 0);
  const weakestResearchSignal = Math.min(normalized.methodNovelty, normalized.evidence);
  const balancePenalty = Math.max(0, base - weakestResearchSignal) * 0.12;
  const weakEvidencePenalty = Math.max(0, 70 - normalized.evidence) * 0.2;
  const quality = base * 1.2 - 22 - balancePenalty - weakEvidencePenalty;
  return Math.round(clampScore(quality));
};

const parseModelJson = (raw) => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (raw.paperId && raw.evidenceValidation) {
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
    throw new TypeError("Review Agent did not return a JSON object.");
  }
  return JSON.parse(text.slice(start, end + 1));
};

const validationIssue = (code, path, detail) => ({ code, path, detail });

const evidenceRefsFor = (item = {}) => new Set(EVIDENCE_FIELDS.flatMap((field) => (
  (Array.isArray(item.evidenceCard?.[field]?.sources) ? item.evidenceCard[field].sources : [])
    .map((_, index) => `${field}:${index}`)
)));

export const validateReviewResult = (value, { item } = {}) => {
  const issues = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      valid: false,
      issues: [validationIssue("schema_invalid", "response", "Review response must be an object.")],
      reviewResult: null
    };
  }

  const expectedPaperId = normalizedPaperId(
    item?.contextPacket?.paperId || item?.evidenceCard?.paperId || item?.paper?.id
  );
  const actualPaperId = normalizedPaperId(value.paperId);
  if (!expectedPaperId || actualPaperId !== expectedPaperId) {
    issues.push(validationIssue(
      "paper_id_mismatch",
      "paperId",
      "Review paperId does not match the requested paper."
    ));
  }

  const evidenceValidation = value.evidenceValidation && typeof value.evidenceValidation === "object"
    && !Array.isArray(value.evidenceValidation)
    ? value.evidenceValidation
    : {};
  const validationStatus = normalizeText(evidenceValidation.status, 40).toLowerCase();
  if (!["pass", "repair_required"].includes(validationStatus)) {
    issues.push(validationIssue(
      "evidence_validation_status_invalid",
      "evidenceValidation.status",
      "Evidence validation status must be pass or repair_required."
    ));
  }

  const semanticIssues = (Array.isArray(evidenceValidation.issues)
    ? evidenceValidation.issues
    : []).slice(0, 20).map((entry, index) => {
    const field = normalizeText(entry?.field, 80);
    const code = normalizeText(entry?.code, 120);
    const message = normalizeText(entry?.message, 1200);
    if (![...EVIDENCE_FIELDS, "valueSignals"].includes(field)) {
      issues.push(validationIssue(
        "evidence_issue_field_invalid",
        `evidenceValidation.issues[${index}].field`,
        "Evidence issue field is invalid."
      ));
    }
    if (!code || !message) {
      issues.push(validationIssue(
        "evidence_issue_incomplete",
        `evidenceValidation.issues[${index}]`,
        "Evidence issue requires code and message."
      ));
    }
    return { field, code, message };
  });
  if (validationStatus === "pass" && semanticIssues.length) {
    issues.push(validationIssue(
      "pass_with_evidence_issues",
      "evidenceValidation.issues",
      "A passing Evidence validation cannot include issues."
    ));
  }
  if (validationStatus === "repair_required" && !semanticIssues.length) {
    issues.push(validationIssue(
      "repair_without_evidence_issues",
      "evidenceValidation.issues",
      "Evidence repair requires at least one specific issue."
    ));
  }

  const rawScores = value.scores && typeof value.scores === "object" && !Array.isArray(value.scores)
    ? value.scores
    : {};
  const scores = {};
  REVIEW_SCORE_DIMENSIONS.forEach((dimension) => {
    const score = Number(rawScores[dimension]);
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      issues.push(validationIssue(
        "score_out_of_range",
        `scores.${dimension}`,
        "Review score must be an integer from 0 to 100."
      ));
    }
    scores[dimension] = score;
  });

  const requiredText = {};
  ["scoreReason", "weakness", "uncertainty", "interestReason"].forEach((field) => {
    requiredText[field] = normalizeText(value[field]);
    if (!requiredText[field]) {
      issues.push(validationIssue("required_text_missing", field, `${field} is required.`));
    }
  });

  const modelInterestFit = normalizeText(value.interestFit, 80).toLowerCase();
  if (!INTEREST_FITS.has(modelInterestFit)) {
    issues.push(validationIssue(
      "interest_fit_invalid",
      "interestFit",
      "Review interestFit is invalid."
    ));
  }
  const inferredInterestFit = inferInterestFitFromEvidence(item);
  const normalizations = [];
  const interestFit = modelInterestFit === "target_network_autonomy"
    && inferredInterestFit !== "target_network_autonomy"
    ? inferredInterestFit
    : modelInterestFit;
  if (interestFit !== modelInterestFit) {
    normalizations.push({
      code: "interest_fit_target_not_grounded",
      from: modelInterestFit,
      to: interestFit,
      reason: NORMALIZED_INTEREST_REASONS[interestFit]
    });
    requiredText.interestReason = NORMALIZED_INTEREST_REASONS[interestFit];
  }

  const affiliations = (Array.isArray(value.affiliations) ? value.affiliations : [])
    .slice(0, 20)
    .map((entry) => normalizeText(entry, 300))
    .filter(Boolean);
  affiliations.forEach((affiliation, index) => {
    if (!/\p{Script=Han}/u.test(affiliation)) {
      issues.push(validationIssue(
        "affiliation_not_chinese",
        `affiliations[${index}]`,
        "Affiliation must include a Chinese institution name."
      ));
    }
  });

  const knownEvidenceRefs = evidenceRefsFor(item);
  const affiliationEvidenceRefs = [...new Set((Array.isArray(value.affiliationEvidenceRefs)
    ? value.affiliationEvidenceRefs
    : []).slice(0, 20).map((entry) => normalizeText(entry, 120)).filter(Boolean))];
  affiliationEvidenceRefs.forEach((reference, index) => {
    if (!knownEvidenceRefs.has(reference) || !reference.startsWith("affiliations:")) {
      issues.push(validationIssue(
        "affiliation_evidence_ref_invalid",
        `affiliationEvidenceRefs[${index}]`,
        "Affiliation evidence ref must point to affiliations Evidence."
      ));
    }
  });
  if (affiliations.length && !affiliationEvidenceRefs.length) {
    issues.push(validationIssue(
      "affiliation_evidence_missing",
      "affiliationEvidenceRefs",
      "Affiliations require at least one Evidence reference."
    ));
  }
  if (affiliations.length && item?.evidenceCard?.affiliations?.status !== "supported") {
    issues.push(validationIssue(
      "affiliation_not_supported",
      "affiliations",
      "Affiliations cannot be returned without supported affiliation Evidence."
    ));
  }

  const reviewResult = {
    paperId: String(item?.contextPacket?.paperId || value.paperId || ""),
    evidenceValidation: {
      status: validationStatus,
      issues: semanticIssues
    },
    scores,
    ...requiredText,
    interestFit,
    affiliations,
    affiliationEvidenceRefs,
    rawScore: REVIEW_SCORE_DIMENSIONS.every((dimension) => Number.isInteger(scores[dimension]))
      ? calculateReviewRawScore(scores)
      : 0
  };

  return {
    valid: issues.length === 0,
    issues,
    reviewResult,
    normalizations
  };
};

export class ReviewAgentError extends Error {
  constructor(message, {
    code = "READING_LIST_REVIEW_FAILED",
    paperId = "",
    retryable = false,
    excludePaper = true,
    issues = [],
    cause
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ReviewAgentError";
    this.code = code;
    this.stage = "review";
    this.paperId = paperId;
    this.retryable = Boolean(retryable);
    this.excludePaper = Boolean(excludePaper);
    this.issues = issues;
  }
}

const abortError = () => {
  const error = new Error("Weekly report Review was cancelled.");
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
  code: String(error?.code || "READING_LIST_REVIEW_FAILED"),
  message: String(error?.message || "Review failed."),
  stage: String(error?.stage || "review"),
  paperId: String(error?.paperId || ""),
  retryable: Boolean(error?.retryable),
  excludePaper: Boolean(error?.excludePaper),
  issues: Array.isArray(error?.issues) ? error.issues : []
});

export const runReviewAgent = async ({
  item,
  callModel,
  signal,
  onCall,
  onEvent,
  networkRetryDelayMs = 50
} = {}) => {
  if (typeof callModel !== "function") {
    throw new TypeError("Review Agent callModel is required.");
  }
  if (signal?.aborted) {
    throw abortError();
  }

  const paperId = String(item?.contextPacket?.paperId || item?.evidenceCard?.paperId || item?.paper?.id || "");
  const inputEvidenceValidation = validateEvidenceArtifacts({
    evidenceCard: item?.evidenceCard,
    valueSignals: item?.valueSignals
  }, {
    contextPacket: item?.contextPacket,
    expectedPaperId: paperId
  });
  if (!inputEvidenceValidation.valid) {
    throw new ReviewAgentError("Review input contains invalid Evidence artifacts.", {
      code: "READING_LIST_REVIEW_INPUT_INVALID",
      paperId,
      issues: inputEvidenceValidation.issues
    });
  }

  const callRecords = [];
  let reviewRepairAttempted = false;
  const emitCall = async (record) => {
    callRecords.push(record);
    if (typeof onCall === "function") {
      await onCall(record);
    }
  };

  const invoke = async (prompt, attemptType, currentItem) => {
    if (signal?.aborted) {
      throw abortError();
    }
    const startedAt = Date.now();
    let rawOutput;

    try {
      rawOutput = await callModel(prompt, {
        role: "paper_review",
        paperId,
        attemptType,
        signal
      });
    } catch (error) {
      const record = {
        role: "paper_review",
        paperId,
        attemptType,
        prompt,
        rawOutput: null,
        normalizedOutput: null,
        validation: null,
        durationMs: Math.max(0, Date.now() - startedAt),
        error: serializedError(error)
      };
      await emitCall(record);
      error.modelCallFailed = true;
      throw error;
    }

    let validation;
    try {
      validation = validateReviewResult(parseModelJson(rawOutput), { item: currentItem });
    } catch (error) {
      validation = {
        valid: false,
        issues: [validationIssue("invalid_json", "response", error.message)],
        reviewResult: null
      };
    }
    await emitCall({
      role: "paper_review",
      paperId,
      attemptType,
      prompt,
      rawOutput,
      normalizedOutput: validation.reviewResult,
      validation: {
        valid: validation.valid,
        issues: validation.issues,
        normalizations: validation.normalizations || []
      },
      durationMs: Math.max(0, Date.now() - startedAt),
      error: null
    });
    for (const normalization of validation.normalizations || []) {
      await onEvent?.({
        type: "review_interest_fit_normalized",
        stage: "review",
        paperId,
        ...normalization
      });
    }
    return validation;
  };

  const invokeWithNetworkRetry = async (prompt, attemptType, retryType, currentItem) => {
    try {
      return await invoke(prompt, attemptType, currentItem);
    } catch (error) {
      if (!error?.modelCallFailed || error?.name === "AbortError" || signal?.aborted) {
        throw error;
      }
      await onEvent?.({
        type: "network_retry",
        stage: "review",
        paperId,
        waitMs: networkRetryDelayMs,
        error: serializedError(error)
      });
      await waitForRetry(networkRetryDelayMs, signal);
      try {
        return await invoke(prompt, retryType, currentItem);
      } catch (retryError) {
        if (retryError?.name === "AbortError") {
          throw retryError;
        }
        throw new ReviewAgentError("Review model call failed after one network retry.", {
          code: "READING_LIST_REVIEW_FAILED",
          paperId,
          cause: retryError
        });
      }
    }
  };

  const reviewOnce = async (currentItem, phase) => {
    const prompt = buildReviewPrompt(currentItem);
    let validation = await invokeWithNetworkRetry(
      prompt,
      phase === "initial" ? "initial" : "after_evidence_repair",
      phase === "initial" ? "network_retry" : "after_evidence_repair_network_retry",
      currentItem
    );

    if (!validation.valid) {
      reviewRepairAttempted = true;
      await onEvent?.({
        type: "review_repair_requested",
        stage: "review",
        paperId,
        phase,
        issues: validation.issues
      });
      const repairPrompt = buildReviewRepairPrompt({
        item: currentItem,
        issues: validation.issues
      });
      validation = await invokeWithNetworkRetry(
        repairPrompt,
        phase === "initial" ? "repair" : "after_evidence_repair_schema_repair",
        phase === "initial" ? "repair_network_retry" : "after_evidence_repair_schema_repair_network_retry",
        currentItem
      );
      if (!validation.valid) {
        throw new ReviewAgentError("Review result remains invalid after one structured repair.", {
          code: "READING_LIST_REVIEW_UNSUPPORTED",
          paperId,
          issues: validation.issues
        });
      }
    }
    return validation.reviewResult;
  };

  const firstReview = await reviewOnce(item, "initial");
  if (firstReview.evidenceValidation.status === "pass") {
    return {
      evidenceCard: item.evidenceCard,
      valueSignals: item.valueSignals,
      reviewResult: firstReview,
      evidenceRepairAttempted: false,
      reviewRepairAttempted,
      calls: callRecords
    };
  }

  await onEvent?.({
    type: "evidence_challenged",
    stage: "review",
    paperId,
    severity: "warning",
    issues: firstReview.evidenceValidation.issues
  });
  const repairIssues = firstReview.evidenceValidation.issues.map((itemIssue) => ({
    code: itemIssue.code,
    path: itemIssue.field === "valueSignals"
      ? "valueSignals"
      : `evidenceCard.${itemIssue.field}.summary`
  }));
  let repairedEvidence;
  try {
    repairedEvidence = await runEvidenceAgent({
      paper: item.paper,
      contextPacket: item.contextPacket,
      callModel,
      signal,
      networkRetryDelayMs,
      repairIssues,
      onCall: emitCall,
      onEvent
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }
    throw new ReviewAgentError("Review-requested Evidence repair failed.", {
      code: "READING_LIST_REVIEW_EVIDENCE_REPAIR_FAILED",
      paperId,
      issues: error?.issues || repairIssues,
      cause: error
    });
  }

  const repairedItem = {
    ...item,
    evidenceCard: repairedEvidence.evidenceCard,
    valueSignals: repairedEvidence.valueSignals
  };
  const finalReview = await reviewOnce(repairedItem, "after_evidence_repair");
  if (finalReview.evidenceValidation.status !== "pass") {
    throw new ReviewAgentError("Review still rejects Evidence after the single repair opportunity.", {
      code: "READING_LIST_REVIEW_EVIDENCE_UNRESOLVED",
      paperId,
      issues: finalReview.evidenceValidation.issues
    });
  }

  return {
    evidenceCard: repairedItem.evidenceCard,
    valueSignals: repairedItem.valueSignals,
    reviewResult: finalReview,
    evidenceRepairAttempted: true,
    reviewRepairAttempted,
    calls: callRecords
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

export const reviewEvidenceBatch = async (items, {
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
    try {
      const result = await runReviewAgent({
        item,
        callModel,
        signal,
        onCall,
        onEvent,
        networkRetryDelayMs
      });
      await onEvent?.({
        type: "review_accepted",
        stage: "review",
        paperId: result.reviewResult.paperId,
        rawScore: result.reviewResult.rawScore,
        evidenceRepairAttempted: result.evidenceRepairAttempted,
        reviewRepairAttempted: result.reviewRepairAttempted
      });
      return { ok: true, item, result };
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) {
        throw abortError();
      }
      await onEvent?.({
        type: "review_excluded",
        stage: "review",
        paperId: String(item?.contextPacket?.paperId || item?.paper?.id || ""),
        error: serializedError(error)
      });
      return { ok: false, item, error };
    }
  });
  const succeeded = [];
  const excluded = [];
  results.forEach((entry) => {
    if (entry.ok) {
      succeeded.push({
        ...entry.item,
        evidenceCard: entry.result.evidenceCard,
        valueSignals: entry.result.valueSignals,
        reviewResult: entry.result.reviewResult,
        evidenceRepairAttempted: entry.result.evidenceRepairAttempted,
        reviewRepairAttempted: entry.result.reviewRepairAttempted
      });
    } else {
      excluded.push({
        ...entry.item,
        error: serializedError(entry.error)
      });
    }
  });
  return {
    succeeded,
    excluded,
    attempted: candidates.length,
    concurrency
  };
};
