import {
  EVIDENCE_FIELDS,
  normalizeEvidenceArtifacts
} from "./schema.js";
import {
  buildEvidencePrompt,
  buildEvidenceRepairPrompt
} from "./prompts.js";

const normalizeText = (value) => String(value || "")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, "\"")
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/\s+/g, " ")
  .trim();

const normalizedPaperId = (value) => {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/(?:^|\/)(\d{4}\.\d{4,5})(?:v\d+)?(?:$|[?#/])/i);
  return match?.[1] || text.replace(/v\d+$/i, "");
};

const numericTokens = (value) => {
  const matches = normalizeText(value).match(/(?<![A-Za-z0-9_])\d+(?:,\d{3})*(?:\.\d+)?\s*%?/g) || [];
  return [...new Set(matches.map((token) => token.replace(/[\s,]/g, "").toLowerCase()))];
};

const UNRESOLVED_LEADING_ANAPHORA_PATTERN = /^(?:it|they)\s+also\b/iu;
const PROBLEM_EVIDENCE_SIGNAL_PATTERN = /\b(?:problem|challenge|gap|issue|risk|unsafe|under[-\s]?test|fail(?:s|ed|ing)?|lack(?:s|ed|ing)?|limitation|limited|cannot|can't|need(?:s|ed)?|require(?:s|d)?|ability\s+to|we\s+(?:study|consider|investigate|ask))\b|问题|挑战|不足|缺乏|风险|不安全|无法|需要|要求|研究.{0,16}(?:问题|能力)/iu;
const LIMITED_NEGATIVE_RESULT_SOURCE_PATTERN = /\b(?:Gemini|GPT|Claude|DeepSeek|Grok|Reducto|LlamaExtract)\b|\bbest\s+(?:overall|method|model|system)\b/iu;
const BROAD_METHOD_SYSTEM_SUBJECT_PATTERN = /(?:当前|现有|多数|大多数)(?:抽取)?(?:系统|方法|模型)|\bmost\s+(?:systems?|methods?|models?)\b/iu;
const NEGATIVE_PERFORMANCE_PATTERN = /显著不足|明显不足|性能.{0,8}下降|表现.{0,8}下降|退化|较差|不佳|\b(?:shortcoming|failure|degrad(?:e|es|ed|ation)|underperform(?:s|ed|ing)?)\b/iu;
const QUALIFIED_EVALUATED_COHORT_PATTERN = /所评估|评估的|参与测试|接受测试|部分|某些|具体|上述|点名|商业\s*VLM|Gemini|GPT|Claude|DeepSeek|Grok|Reducto|LlamaExtract|\b(?:evaluated|tested|participating|specific|some|named|commercial\s+VLMs?)\b/iu;
const COMMERCIAL_VLM_PATTERN = /商业\s*VLM|\bcommercial\s+VLMs?\b/iu;
const LONG_DOCUMENT_PATTERN = /长文档|\blong\s+documents?\b/iu;

const parseModelJson = (raw) => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (raw.evidenceCard && raw.valueSignals) {
      return raw;
    }
    if (typeof raw.text === "string") {
      return parseModelJson(raw.text);
    }
    if (Array.isArray(raw.content)) {
      const text = raw.content
        .filter((block) => block?.type === "text")
        .map((block) => block.text || "")
        .join("\n");
      return parseModelJson(text);
    }
  }

  const text = String(raw || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new TypeError("Evidence Agent did not return a JSON object.");
  }

  return JSON.parse(text.slice(start, end + 1));
};

const issue = (code, path, detail) => ({ code, path, detail });

const uniqueIssues = (issues) => {
  const seen = new Set();
  return issues.filter((item) => {
    const key = `${item.code}|${item.path}|${item.detail}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const evidenceRepairScope = ({ issues = [], baseArtifacts = null } = {}) => {
  const evidenceFields = new Set();
  let rebuildValueSignals = false;
  let recognizedTarget = false;
  let requiresFullResponse = !baseArtifacts;

  (Array.isArray(issues) ? issues : []).forEach((entry) => {
    const code = String(entry?.code || "");
    const path = String(entry?.path || "");
    const fieldMatch = path.match(/^evidenceCard\.([^.\[]+)/);
    if (fieldMatch && EVIDENCE_FIELDS.includes(fieldMatch[1])) {
      evidenceFields.add(fieldMatch[1]);
      rebuildValueSignals = true;
      recognizedTarget = true;
      return;
    }
    if (path === "valueSignals" || path.startsWith("valueSignals.")) {
      rebuildValueSignals = true;
      recognizedTarget = true;
      return;
    }
    if (["invalid_json", "schema_invalid", "paper_id_mismatch"].includes(code)
      || path === "response"
      || path === "evidenceCard.paperId"
      || path === "valueSignals.paperId") {
      requiresFullResponse = true;
    }
  });

  if (!recognizedTarget) {
    requiresFullResponse = true;
  }

  return {
    mode: requiresFullResponse ? "full_response" : "field_scoped_merge",
    evidenceFields: requiresFullResponse ? [] : [...evidenceFields],
    rebuildValueSignals: requiresFullResponse ? true : rebuildValueSignals
  };
};

const mergeEvidenceRepairArtifacts = ({
  baseArtifacts,
  repairedValue,
  repairScope
}) => {
  const repairedArtifacts = normalizeEvidenceArtifacts(repairedValue);
  if (repairScope?.mode !== "field_scoped_merge") {
    return repairedArtifacts;
  }

  const retainedArtifacts = normalizeEvidenceArtifacts(baseArtifacts);
  const merged = structuredClone(retainedArtifacts);
  (Array.isArray(repairScope.evidenceFields) ? repairScope.evidenceFields : [])
    .forEach((field) => {
      if (EVIDENCE_FIELDS.includes(field)) {
        merged.evidenceCard[field] = structuredClone(repairedArtifacts.evidenceCard[field]);
      }
    });
  if (repairScope.rebuildValueSignals) {
    merged.valueSignals = structuredClone(repairedArtifacts.valueSignals);
  }
  return merged;
};

const validateResultCohortScope = ({ summary, sourceText, issues }) => {
  const sentences = normalizeText(summary).split(/[。！？!?；;\n]+/u).filter(Boolean);
  if (!LIMITED_NEGATIVE_RESULT_SOURCE_PATTERN.test(sourceText)
    || !sentences.some((sentence) => (
      BROAD_METHOD_SYSTEM_SUBJECT_PATTERN.test(sentence)
      && NEGATIVE_PERFORMANCE_PATTERN.test(sentence)
      && !QUALIFIED_EVALUATED_COHORT_PATTERN.test(sentence)
    ))) {
    return;
  }
  issues.push(issue(
    "model_cohort_scope_overgeneralized",
    "evidenceCard.results.summary",
    "A negative result limited to commercial VLMs or named systems cannot be generalized to most or current systems."
  ));
};

const validateCommercialVlmLongDocumentSource = ({ summary, sourceTexts, issues }) => {
  if (!COMMERCIAL_VLM_PATTERN.test(summary)
    || !LONG_DOCUMENT_PATTERN.test(summary)
    || sourceTexts.some((sourceText) => (
      COMMERCIAL_VLM_PATTERN.test(sourceText) && LONG_DOCUMENT_PATTERN.test(sourceText)
    ))) {
    return;
  }
  issues.push(issue(
    "commercial_vlm_long_document_source_missing",
    "evidenceCard.results.summary",
    "A commercial-VLM long-document result requires a bound result excerpt that names both the cohort and the long-document scope."
  ));
};

const numericSummarySentences = (value) => {
  const text = normalizeText(value);
  return text.split(/(?<=[。！？!?；;])\s*|(?<=\.)\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
};

const removeUnsupportedNumericSentences = (fieldValue) => {
  const availableNumbers = new Set(numericTokens(
    fieldValue.sources.map((sourceValue) => sourceValue.excerpt).join(" ")
  ));
  const unsupportedNumbers = new Set(
    numericTokens(fieldValue.summary).filter((token) => !availableNumbers.has(token))
  );
  if (!unsupportedNumbers.size) {
    return fieldValue.summary;
  }

  return numericSummarySentences(fieldValue.summary)
    .filter((sentence) => !numericTokens(sentence).some((token) => unsupportedNumbers.has(token)))
    .join(" ")
    .trim();
};

const sanitizedNumericEvidence = (validation, { contextPacket, expectedPaperId } = {}) => {
  const issues = Array.isArray(validation?.issues) ? validation.issues : [];
  if (!validation?.artifacts || issues.length === 0
    || issues.some((entry) => entry.code !== "numeric_claim_not_in_excerpt")) {
    return null;
  }

  const artifacts = structuredClone(validation.artifacts);
  const fieldsMarkedInsufficient = new Set();
  const signalIndexesToDrop = new Set();
  for (const entry of issues) {
    const fieldMatch = String(entry.path || "").match(/^evidenceCard\.([^.]+)\.summary$/);
    if (fieldMatch && EVIDENCE_FIELDS.includes(fieldMatch[1])) {
      const field = fieldMatch[1];
      const fieldValue = artifacts.evidenceCard[field];
      const retainedSummary = removeUnsupportedNumericSentences(fieldValue);
      if (retainedSummary) {
        fieldValue.summary = retainedSummary;
      } else {
        fieldValue.summary = "当前绑定摘录不足以支持该字段的定量陈述。";
        fieldValue.status = "insufficient";
        fieldValue.sources = [];
        artifacts.evidenceCard.evidenceInsufficient = true;
        fieldsMarkedInsufficient.add(field);
      }
      continue;
    }
    const signalMatch = String(entry.path || "").match(/^valueSignals\.signals\[(\d+)]\.claim$/);
    if (signalMatch) {
      signalIndexesToDrop.add(Number(signalMatch[1]));
      continue;
    }
    return null;
  }

  artifacts.valueSignals.signals = artifacts.valueSignals.signals.filter((_, index) => (
    !signalIndexesToDrop.has(index)
    && !artifacts.valueSignals.signals[index].evidenceRefs.some((reference) => (
      fieldsMarkedInsufficient.has(String(reference).split(":", 1)[0])
    ))
  ));
  const sanitized = validateEvidenceArtifacts(artifacts, { contextPacket, expectedPaperId });
  return sanitized.valid ? sanitized : null;
};

export const validateEvidenceArtifacts = (value, {
  contextPacket,
  expectedPaperId
} = {}) => {
  let artifacts;

  try {
    artifacts = normalizeEvidenceArtifacts(value);
  } catch (error) {
    return {
      valid: false,
      issues: [issue("schema_invalid", "response", error.message)],
      evidenceRefCount: 0,
      artifacts: null
    };
  }

  const issues = [];
  const expectedId = normalizedPaperId(expectedPaperId || contextPacket?.paperId);
  const cardId = normalizedPaperId(artifacts.evidenceCard.paperId);
  const signalId = normalizedPaperId(artifacts.valueSignals.paperId);

  if (!expectedId || cardId !== expectedId) {
    issues.push(issue("paper_id_mismatch", "evidenceCard.paperId", "Evidence Card paperId does not match the requested paper."));
  }
  if (!expectedId || signalId !== expectedId) {
    issues.push(issue("paper_id_mismatch", "valueSignals.paperId", "Value Signals paperId does not match the requested paper."));
  }

  const sections = new Map((Array.isArray(contextPacket?.inputSections) ? contextPacket.inputSections : [])
    .map((section) => [String(section?.anchor || ""), section]));
  const evidenceRefs = new Map();

  EVIDENCE_FIELDS.forEach((field) => {
    const fieldValue = artifacts.evidenceCard[field];
    const excerpts = [];

    fieldValue.sources.forEach((sourceValue, sourceIndex) => {
      const path = `evidenceCard.${field}.sources[${sourceIndex}]`;
      const section = sections.get(sourceValue.anchor);

      if (!section) {
        issues.push(issue("unknown_section_anchor", `${path}.anchor`, `Anchor ${sourceValue.anchor} is not present in contextPacket.`));
      } else {
        // The server owns the anchor-to-heading binding. Models often shorten a displayed
        // heading even when the anchor and excerpt are correct, so canonicalize this metadata
        // instead of discarding otherwise verifiable Evidence.
        sourceValue.section = normalizeText(section.heading);
        if (!normalizeText(section.text).includes(normalizeText(sourceValue.excerpt))) {
          issues.push(issue("excerpt_not_in_source", `${path}.excerpt`, "Excerpt is not a verbatim substring of the bound source section."));
        }
        if (field === "affiliations" && String(section.kind || "") !== "metadata") {
          issues.push(issue(
            "affiliation_source_not_metadata",
            path,
            "Affiliation Evidence must come from the paper author or institution metadata, not a body, citation, product, provider, or evaluation mention."
          ));
        }
      }

      if (UNRESOLVED_LEADING_ANAPHORA_PATTERN.test(normalizeText(sourceValue.excerpt))) {
        issues.push(issue(
          "excerpt_not_self_contained",
          `${path}.excerpt`,
          "Excerpt starts with unresolved anaphora; include the contiguous antecedent so the subject and metric are explicit."
        ));
      }

      excerpts.push(sourceValue.excerpt);
      evidenceRefs.set(`${field}:${sourceIndex}`, sourceValue.excerpt);
    });

    if (fieldValue.status === "supported" && !fieldValue.sources.length) {
      issues.push(issue("missing_evidence_source", `evidenceCard.${field}.sources`, "Supported evidence requires at least one source."));
    }
    if (field === "problem"
      && fieldValue.status === "supported"
      && fieldValue.sources.length
      && !PROBLEM_EVIDENCE_SIGNAL_PATTERN.test(excerpts.join(" "))) {
      issues.push(issue(
        "problem_excerpt_not_problem_statement",
        "evidenceCard.problem.sources",
        "Problem Evidence must state the research problem, gap, challenge, need, or capability being tested; a contribution-only excerpt is insufficient."
      ));
    }

    const availableNumbers = new Set(numericTokens(excerpts.join(" ")));
    numericTokens(fieldValue.summary).forEach((token) => {
      if (!availableNumbers.has(token)) {
        issues.push(issue(
          "numeric_claim_not_in_excerpt",
          `evidenceCard.${field}.summary`,
          `Numeric token ${token} is not present in the bound excerpt.`
        ));
      }
    });
    if (field === "results") {
      validateResultCohortScope({
        summary: fieldValue.summary,
        sourceText: excerpts.join(" "),
        issues
      });
      validateCommercialVlmLongDocumentSource({
        summary: fieldValue.summary,
        sourceTexts: excerpts,
        issues
      });
    }
  });

  artifacts.valueSignals.signals.forEach((signal, signalIndex) => {
    const path = `valueSignals.signals[${signalIndex}]`;
    const boundExcerpts = [];

    signal.evidenceRefs.forEach((reference, referenceIndex) => {
      if (!evidenceRefs.has(reference)) {
        issues.push(issue("evidence_ref_not_found", `${path}.evidenceRefs[${referenceIndex}]`, `Evidence reference ${reference} does not exist.`));
        return;
      }
      boundExcerpts.push(evidenceRefs.get(reference));
    });

    const availableNumbers = new Set(numericTokens(boundExcerpts.join(" ")));
    numericTokens(signal.claim).forEach((token) => {
      if (!availableNumbers.has(token)) {
        issues.push(issue(
          "numeric_claim_not_in_excerpt",
          `${path}.claim`,
          `Numeric token ${token} is not present in the referenced evidence.`
        ));
      }
    });
  });

  const normalizedIssues = uniqueIssues(issues);
  return {
    valid: normalizedIssues.length === 0,
    issues: normalizedIssues,
    evidenceRefCount: evidenceRefs.size,
    artifacts
  };
};

export class EvidenceAgentError extends Error {
  constructor(message, {
    code = "READING_LIST_EVIDENCE_FAILED",
    paperId = "",
    retryable = false,
    excludePaper = true,
    issues = [],
    cause
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "EvidenceAgentError";
    this.code = code;
    this.stage = "extract_evidence";
    this.paperId = paperId;
    this.retryable = Boolean(retryable);
    this.excludePaper = Boolean(excludePaper);
    this.issues = issues;
  }
}

const abortError = () => {
  const error = new Error("Evidence extraction was cancelled.");
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
  code: String(error?.code || "READING_LIST_EVIDENCE_FAILED"),
  message: String(error?.message || "Evidence extraction failed."),
  stage: String(error?.stage || "extract_evidence"),
  paperId: String(error?.paperId || ""),
  retryable: Boolean(error?.retryable),
  stopReason: String(error?.stopReason || ""),
  excludePaper: Boolean(error?.excludePaper),
  issues: Array.isArray(error?.issues) ? error.issues : []
});

export const runEvidenceAgent = async ({
  paper,
  contextPacket,
  currentArtifacts = null,
  callModel,
  signal,
  onCall,
  onEvent,
  networkRetryDelayMs = 50,
  repairIssues = []
} = {}) => {
  const expectedPaperId = String(contextPacket?.paperId || paper?.id || paper?.absLink || paper?.link || "").trim();

  if (typeof callModel !== "function") {
    throw new TypeError("Evidence Agent callModel is required.");
  }
  if (signal?.aborted) {
    throw abortError();
  }
  if (contextPacket?.status !== "available" || contextPacket?.qualityGate?.passed !== true) {
    throw new EvidenceAgentError("Paper did not pass the original-text quality gate.", {
      code: "READING_LIST_CONTEXT_INSUFFICIENT",
      paperId: expectedPaperId,
      excludePaper: true
    });
  }

  const callRecords = [];
  const invoke = async (prompt, attemptType, repairContext = null) => {
    if (signal?.aborted) {
      throw abortError();
    }

    const startedAt = Date.now();
    let rawOutput;

    try {
      rawOutput = await callModel(prompt, {
        role: "evidence_extraction",
        paperId: expectedPaperId,
        attemptType,
        signal
      });
    } catch (error) {
      const record = {
        role: "evidence_extraction",
        paperId: expectedPaperId,
        attemptType,
        prompt,
        rawOutput: null,
        normalizedOutput: null,
        validation: null,
        durationMs: Math.max(0, Date.now() - startedAt),
        error: serializedError(error)
      };
      callRecords.push(record);
      if (typeof onCall === "function") {
        await onCall(record);
      }
      error.modelCallFailed = true;
      error.stage = error.stage || "extract_evidence";
      error.paperId = error.paperId || expectedPaperId;
      throw error;
    }

    let parsed;
    let validation;

    try {
      parsed = parseModelJson(rawOutput);
      const validationValue = repairContext
        ? mergeEvidenceRepairArtifacts({
          baseArtifacts: repairContext.baseArtifacts,
          repairedValue: parsed,
          repairScope: repairContext.repairScope
        })
        : parsed;
      validation = validateEvidenceArtifacts(validationValue, { contextPacket, expectedPaperId });
    } catch (error) {
      validation = {
        valid: false,
        issues: [issue("invalid_json", "response", error.message)],
        evidenceRefCount: 0,
        artifacts: null
      };
    }

    const record = {
      role: "evidence_extraction",
      paperId: expectedPaperId,
      attemptType,
      prompt,
      rawOutput,
      normalizedOutput: validation.artifacts,
      validation: {
        valid: validation.valid,
        issues: validation.issues,
        evidenceRefCount: validation.evidenceRefCount,
        ...(repairContext ? { repairScope: repairContext.repairScope } : {})
      },
      durationMs: Math.max(0, Date.now() - startedAt),
      error: null
    };
    callRecords.push(record);
    if (typeof onCall === "function") {
      await onCall(record);
    }
    return validation;
  };

  const invokeWithNetworkRetry = async (
    prompt,
    firstAttemptType,
    retryAttemptType,
    repairContext = null
  ) => {
    try {
      return await invoke(prompt, firstAttemptType, repairContext);
    } catch (error) {
      if (!error?.modelCallFailed || error?.name === "AbortError" || signal?.aborted) {
        throw error;
      }

      if (typeof onEvent === "function") {
        await onEvent({
          type: "network_retry",
          stage: "extract_evidence",
          paperId: expectedPaperId,
          waitMs: networkRetryDelayMs,
          error: serializedError(error)
        });
      }
      await waitForRetry(networkRetryDelayMs, signal);

      try {
        return await invoke(prompt, retryAttemptType, repairContext);
      } catch (retryError) {
        if (retryError?.name === "AbortError") {
          throw retryError;
        }
        if (retryError?.modelCallFailed) {
          throw retryError;
        }
        throw new EvidenceAgentError("Evidence Agent model call failed after one network retry.", {
          code: "READING_LIST_EVIDENCE_FAILED",
          paperId: expectedPaperId,
          retryable: false,
          excludePaper: true,
          cause: retryError
        });
      }
    }
  };

  const initialPrompt = buildEvidencePrompt({ paper, contextPacket });

  if (Array.isArray(repairIssues) && repairIssues.length) {
    let reviewBaseArtifacts = null;
    try {
      reviewBaseArtifacts = currentArtifacts
        ? normalizeEvidenceArtifacts(currentArtifacts)
        : null;
    } catch {
      reviewBaseArtifacts = null;
    }
    const reviewRepairScope = evidenceRepairScope({
      issues: repairIssues,
      baseArtifacts: reviewBaseArtifacts
    });
    if (typeof onEvent === "function") {
      await onEvent({
        type: "review_evidence_repair_started",
        stage: "review",
        paperId: expectedPaperId,
        issues: repairIssues,
        repairScope: reviewRepairScope
      });
    }
    const reviewRepairPrompt = buildEvidenceRepairPrompt({
      paper,
      contextPacket,
      repairTargets: reviewRepairScope,
      issues: repairIssues
    });
    const reviewRepaired = await invokeWithNetworkRetry(
      reviewRepairPrompt,
      "review_evidence_repair",
      "review_evidence_repair_network_retry",
      reviewBaseArtifacts ? {
        baseArtifacts: reviewBaseArtifacts,
        repairScope: reviewRepairScope
      } : null
    );

    if (!reviewRepaired.valid) {
      throw new EvidenceAgentError("Evidence remains unsupported after the Review-requested repair.", {
        code: "READING_LIST_EVIDENCE_REVIEW_REPAIR_FAILED",
        paperId: expectedPaperId,
        retryable: false,
        excludePaper: true,
        issues: reviewRepaired.issues
      });
    }

    return {
      ...reviewRepaired.artifacts,
      validation: reviewRepaired,
      repairAttempted: true,
      repairSource: "review",
      repairScope: reviewRepairScope,
      calls: callRecords
    };
  }

  const initial = await invokeWithNetworkRetry(initialPrompt, "initial", "network_retry");

  if (initial.valid) {
    return {
      ...initial.artifacts,
      validation: initial,
      repairAttempted: false,
      calls: callRecords
    };
  }

  if (typeof onEvent === "function") {
    const plannedRepairScope = evidenceRepairScope({
      issues: initial.issues,
      baseArtifacts: initial.artifacts
    });
    await onEvent({
      type: "repair_requested",
      stage: "extract_evidence",
      paperId: expectedPaperId,
      issues: initial.issues,
      repairScope: plannedRepairScope
    });
  }
  const plannedRepairScope = evidenceRepairScope({
    issues: initial.issues,
    baseArtifacts: initial.artifacts
  });
  const repairPrompt = buildEvidenceRepairPrompt({
    paper,
    contextPacket,
    repairTargets: plannedRepairScope,
    issues: initial.issues
  });
  const repaired = await invokeWithNetworkRetry(
    repairPrompt,
    "repair",
    "repair_network_retry",
    initial.artifacts ? {
      baseArtifacts: initial.artifacts,
      repairScope: plannedRepairScope
    } : null
  );

  if (!repaired.valid) {
    const sanitized = sanitizedNumericEvidence(repaired, { contextPacket, expectedPaperId });
    if (sanitized) {
      await onEvent?.({
        type: "evidence_numeric_claims_sanitized",
        stage: "extract_evidence",
        paperId: expectedPaperId,
        issues: repaired.issues
      });
      return {
        ...sanitized.artifacts,
        validation: sanitized,
        repairAttempted: true,
        repairScope: plannedRepairScope,
        deterministicSanitizationApplied: true,
        calls: callRecords
      };
    }
    throw new EvidenceAgentError("Evidence artifacts remain unsupported after one targeted repair.", {
      code: "READING_LIST_EVIDENCE_UNSUPPORTED",
      paperId: expectedPaperId,
      retryable: false,
      excludePaper: true,
      issues: repaired.issues
    });
  }

  return {
    ...repaired.artifacts,
    validation: repaired,
    repairAttempted: true,
    repairScope: plannedRepairScope,
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

export const extractEvidenceBatch = async (items, {
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
      const result = await runEvidenceAgent({
        paper: item.paper,
        contextPacket: item.contextPacket,
        callModel,
        signal,
        networkRetryDelayMs,
        onCall: (record) => onCall?.(record),
        onEvent: (event) => onEvent?.(event)
      });
      await onEvent?.({
        type: "evidence_accepted",
        stage: "extract_evidence",
        paperId: result.evidenceCard.paperId,
        repairAttempted: result.repairAttempted
      });
      return { ok: true, item, result };
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) {
        throw abortError();
      }
      if (error?.modelCallFailed) {
        await onEvent?.({
          type: "evidence_processing_failed",
          stage: "extract_evidence",
          paperId: String(item?.contextPacket?.paperId || item?.paper?.id || ""),
          error: serializedError(error)
        });
        return { ok: false, processingFailed: true, item, error };
      }
      if (error?.excludePaper !== true) {
        throw error;
      }
      await onEvent?.({
        type: "evidence_excluded",
        stage: "extract_evidence",
        paperId: String(item?.contextPacket?.paperId || item?.paper?.id || ""),
        error: serializedError(error)
      });
      return { ok: false, item, error };
    }
  });
  const succeeded = [];
  const excluded = [];
  const processingFailed = [];

  results.forEach((entry) => {
    if (entry.ok) {
      succeeded.push({
        ...entry.item,
        evidenceCard: entry.result.evidenceCard,
        valueSignals: entry.result.valueSignals,
        validation: entry.result.validation,
        repairAttempted: entry.result.repairAttempted
      });
    } else if (entry.processingFailed) {
      processingFailed.push({
        ...entry.item,
        error: serializedError(entry.error)
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
    processingFailed,
    attempted: candidates.length,
    concurrency
  };
};
