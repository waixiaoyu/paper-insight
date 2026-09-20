import {
  EVIDENCE_FIELDS,
  normalizeEvidenceArtifacts
} from "./schema.js";
import {
  buildEvidencePrompt,
  buildEvidenceRepairPrompt,
  buildEvidenceResponseRepairPrompt
} from "./prompts.js";
import { parseModelJsonObject } from "./model-json.js";
import {
  buildEvidenceSourceRegistry,
  materializeEvidenceSources
} from "./evidence-source-registry.js";
import { redactTraceValue } from "./trace-store.js";
import { acceptCredibilityAdvisories } from "./credibility-gate-policy.js";

const RESPONSE_CONTRACT_ISSUE_CODES = new Set(["invalid_json", "schema_invalid"]);
const MAX_EVIDENCE_RESPONSE_REPAIRS = 2;
const MAX_EVIDENCE_CONTENT_REPAIRS = 3;
const MAX_RESPONSE_DIAGNOSTIC_CHARS = 1_200;
const MAX_REPAIR_VALUE_CHARS = 1_200;

const hasOnlyResponseContractIssues = (validation) => (
  validation?.valid === false
  && Array.isArray(validation?.issues)
  && validation.issues.length > 0
  && validation.issues.every((entry) => RESPONSE_CONTRACT_ISSUE_CODES.has(String(entry?.code || "")))
);

const normalizeText = (value) => String(value || "")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, "\"")
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/\s+/g, " ")
  .trim();

const evidenceTokensWithOffsets = (value) => {
  const text = String(value || "");
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+(?:[._/-][\p{L}\p{N}]+)*%?/gu)]
    .map((match) => ({
      value: String(match[0] || "").toLowerCase(),
      start: match.index,
      end: Number(match.index) + String(match[0] || "").length
    }));
  return tokens.filter((token, index) => {
    const previous = tokens[index - 1];
    return !previous
      || token.value !== previous.value
      || !/^\d+(?:[.,]\d+)?%?$/u.test(token.value);
  });
};

const uniquelyReboundEvidenceExcerpt = (sectionText, excerpt) => {
  const sourceTokens = evidenceTokensWithOffsets(sectionText);
  const excerptTokens = evidenceTokensWithOffsets(excerpt);
  if (excerptTokens.length < 6 || excerptTokens.length > sourceTokens.length) return "";

  const matches = [];
  for (let start = 0; start <= sourceTokens.length - excerptTokens.length; start += 1) {
    if (excerptTokens.every((token, offset) => token.value === sourceTokens[start + offset].value)) {
      matches.push(start);
      if (matches.length > 1) return "";
    }
  }
  if (matches.length !== 1) return "";
  const startToken = sourceTokens[matches[0]];
  const endToken = sourceTokens[matches[0] + excerptTokens.length - 1];
  let end = endToken.end;
  const sourceText = String(sectionText || "");
  while (end < sourceText.length && /[.!?。！？;；:：\x22\x27”’)]/u.test(sourceText[end])) end += 1;
  return sourceText.slice(startToken.start, end).trim();
};

const repairValuePreview = (value) => {
  let preview;
  if (typeof value === "string") {
    preview = value.length > MAX_REPAIR_VALUE_CHARS
      ? value.slice(0, MAX_REPAIR_VALUE_CHARS) + "…（已截断）"
      : value;
  } else if (Array.isArray(value)) {
    preview = value.slice(0, 4).map((entry) => repairValuePreview(entry));
  } else if (value && typeof value === "object") {
    preview = Object.fromEntries(Object.entries(value)
      .slice(0, 12)
      .map(([key, entry]) => [key, repairValuePreview(entry)]));
  } else {
    preview = value;
  }
  if (preview && typeof preview === "object") {
    const serialized = JSON.stringify(preview);
    return serialized.length > MAX_REPAIR_VALUE_CHARS
      ? serialized.slice(0, MAX_REPAIR_VALUE_CHARS) + "…（已截断）"
      : preview;
  }
  return preview;
};

const valueAtEvidencePath = (artifacts, path) => {
  const parts = String(path || "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let current = artifacts;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
};

const repairIssuesWithContext = (issues, artifacts) => (Array.isArray(issues) ? issues : [])
  .map((entry) => {
    const isPaperIdMismatch = String(entry?.code || "") === "paper_id_mismatch";
    const previousValue = isPaperIdMismatch ? undefined : valueAtEvidencePath(artifacts, entry?.path);
    return {
      ...entry,
      detail: isPaperIdMismatch
        ? "Paper identifier must match the requested paper."
        : String(entry?.detail || "").slice(0, MAX_REPAIR_VALUE_CHARS),
      ...(previousValue === undefined ? {} : { previousValue: repairValuePreview(previousValue) })
    };
  });

const redactedResponseExcerpt = (value) => {
  let text;
  if (typeof value === "string") {
    text = value;
  } else if (value && typeof value === "object") {
    if (typeof value.text === "string") {
      text = value.text;
    } else if (Array.isArray(value.content)) {
      text = value.content
        .filter((block) => block?.type === "text")
        .map((block) => String(block.text || ""))
        .join("\n");
    } else {
      try {
        text = JSON.stringify(value);
      } catch {
        text = "";
      }
    }
  } else {
    text = String(value || "");
  }

  const redacted = String(text || "")
    .replace(/\u0000/g, "")
    .replace(/([\x22\x27]?(?:api[_-]?key|authorization|token|password|secret)[\x22\x27]?\s*[:=]\s*[\x22\x27]?)([^\x22\x27\s,}\]]+)([\x22\x27]?)/giu, "$1（已隐藏）$3")
    .trim();
  if (!redacted) {
    return "（模型没有返回可显示的文本内容。）";
  }
  return redacted.length > MAX_RESPONSE_DIAGNOSTIC_CHARS
    ? redacted.slice(0, MAX_RESPONSE_DIAGNOSTIC_CHARS) + "…（已截断）"
    : redacted;
};

const responseDiagnosticForValidation = (validation, rawOutput) => {
  const issues = Array.isArray(validation?.issues) ? validation.issues : [];
  const invalidJson = issues.find((entry) => String(entry?.code || "") === "invalid_json");
  const schemaInvalid = issues.find((entry) => String(entry?.code || "") === "schema_invalid");
  let reason = "最后一次模型返回未能满足证据数据的结构要求。";

  if (invalidJson) {
    reason = "最后一次模型返回不是完整的 JSON 对象，无法解析为证据卡和阅读价值信号。";
  } else if (schemaInvalid) {
    const detail = String(schemaInvalid.detail || "");
    if (/evidenceCard\.paperId is required/iu.test(detail)) {
      reason = "最后一次模型返回缺少证据卡中的论文编号。";
    } else if (/valueSignals\.paperId is required/iu.test(detail)) {
      reason = "最后一次模型返回缺少阅读价值信号中的论文编号。";
    } else if (/evidenceCard must be an object/iu.test(detail)) {
      reason = "最后一次模型返回缺少完整的证据卡对象。";
    } else if (/valueSignals must be an object/iu.test(detail)) {
      reason = "最后一次模型返回缺少完整的阅读价值信号对象。";
    } else {
      reason = "最后一次模型返回可以解析为 JSON，但缺少必填字段或字段类型不符合证据数据要求。";
    }
  }

  return {
    reason,
    responseExcerpt: redactedResponseExcerpt(rawOutput)
  };
};

const normalizeResponseDiagnostic = (value) => {
  const reason = normalizeText(value?.reason);
  const responseExcerpt = redactedResponseExcerpt(value?.responseExcerpt);
  return reason ? { reason, responseExcerpt } : null;
};

const normalizedPaperId = (value) => {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/(?:^|\/)(\d{4}\.\d{4,5})(?:v\d+)?(?:$|[?#/])/i);
  return match?.[1] || text.replace(/v\d+$/i, "");
};

export const extractEvidenceNumericTokens = (value) => {
  const textWithoutIdentifierCodes = normalizeText(value).replace(
    /\b[A-Za-z][A-Za-z0-9_]*(?:-\d+(?:\/\d+)*(?:\/[A-Za-z][A-Za-z0-9_]*)?)+\b/g,
    ""
  );
  const matches = textWithoutIdentifierCodes.match(
    /(?<![A-Za-z0-9_])\d+(?:,\d{3})*(?:\.\d+)?(?![\d,.])\s*%?(?:\s*(?:[xX×](?![A-Za-z0-9_])|times\b))?(?![A-Za-z0-9_])/g
  ) || [];
  return [...new Set(matches.map((token) => token
    .replace(/\s*(?:[xX×]|times)$/i, "")
    .replace(/[\s,]/g, "")
    .toLowerCase()))];
};

export const normalizeEvidenceResponseShape = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value, normalized: false, reason: "" };
  }
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "answer" && typeof value.answer === "string") {
    try {
      const answer = JSON.parse(value.answer);
      if (answer && typeof answer === "object" && !Array.isArray(answer)) {
        const normalizedAnswer = normalizeEvidenceResponseShape(answer);
        return {
          value: normalizedAnswer.value,
          normalized: true,
          reason: normalizedAnswer.reason
            ? `stringified_answer_envelope:${normalizedAnswer.reason}`
            : "stringified_answer_envelope"
        };
      }
    } catch {
      // Keep the original value so the normal Schema error and repair path remain in control.
    }
  }
  if (value.evidenceCard && value.valueSignals) {
    return { value, normalized: false, reason: "" };
  }
  const hasCardFields = EVIDENCE_FIELDS.every((field) => Object.hasOwn(value, field));
  const hasPaperId = typeof value.paperId === "string" && value.paperId.trim();
  const hasValueSignals = value.valueSignals
    && typeof value.valueSignals === "object"
    && !Array.isArray(value.valueSignals);
  if (!hasCardFields || !hasPaperId || !hasValueSignals) {
    return { value, normalized: false, reason: "" };
  }
  const { valueSignals, ...evidenceCard } = value;
  return {
    value: { evidenceCard, valueSignals },
    normalized: true,
    reason: "flat_evidence_envelope"
  };
};

const UNRESOLVED_LEADING_ANAPHORA_PATTERN = /^(?:it|they)\s+also\b/iu;
const PROBLEM_EVIDENCE_SIGNAL_PATTERN = /\b(?:problem|challenge|gap|issue|risk|unsafe|bias(?:es|ed)?|sensitivity|homogeni[sz]ation|error\s+cascade(?:s)?|amplif(?:y|ies|ied)\s+unreliable|under[-\s]?test|under[-\s]?characteri[sz]ed|fail(?:s|ed|ing)?|lack(?:s|ed|ing)?|limitation|limited|cannot|can't|do(?:es)?\s+not\s+(?:assess|evaluate|examine|measure|test)|remain(?:s|ed)?\s+under[-\s]?characteri[sz]ed|largely\s+stop(?:s|ped)?\s+at|need(?:s|ed)?|require(?:s|d)?|ability\s+to|we\s+(?:study|consider|investigate|ask)|(?:we|this\s+(?:paper|work|study))\s+(?:assess(?:es|ed|ing)?|evaluate(?:s|d|ing)?|examine(?:s|d|ing)?))\b|问题|挑战|不足|缺乏|风险|不安全|偏置|敏感|错误级联|放大不可靠|无法|需要|要求|研究.{0,16}(?:问题|能力)/iu;
const LIMITED_NEGATIVE_RESULT_SOURCE_PATTERN = /\b(?:Gemini|GPT|Claude|DeepSeek|Grok|Reducto|LlamaExtract)\b|\bbest\s+(?:overall|method|model|system)\b/iu;
const BROAD_METHOD_SYSTEM_SUBJECT_PATTERN = /(?:当前|现有|多数|大多数)(?:抽取)?(?:系统|方法|模型)|\bmost\s+(?:systems?|methods?|models?)\b/iu;
const NEGATIVE_PERFORMANCE_PATTERN = /显著不足|明显不足|性能.{0,8}下降|表现.{0,8}下降|退化|较差|不佳|\b(?:shortcoming|failure|degrad(?:e|es|ed|ation)|underperform(?:s|ed|ing)?)\b/iu;
const QUALIFIED_EVALUATED_COHORT_PATTERN = /所评估|评估的|参与测试|接受测试|部分|某些|具体|上述|点名|商业\s*VLM|Gemini|GPT|Claude|DeepSeek|Grok|Reducto|LlamaExtract|\b(?:evaluated|tested|participating|specific|some|named|commercial\s+VLMs?)\b/iu;
const COMMERCIAL_VLM_PATTERN = /商业\s*VLM|\bcommercial\s+VLMs?\b/iu;
const LONG_DOCUMENT_PATTERN = /长文档|\blong\s+documents?\b/iu;

const parseModelJson = (raw) => {
  // Do not extract a preferred object from surrounding text or duplicate objects.
  // Only harmless trailing closing delimiters are handled by the shared parser.
  return parseModelJsonObject(raw, {
    label: "Evidence Agent",
    maxTrailingClosures: 3,
    allowTrailingProse: true
  }).value;
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
  let valueSignalsTargeted = false;
  let recognizedTarget = false;
  let requiresFullResponse = !baseArtifacts;

  (Array.isArray(issues) ? issues : []).forEach((entry) => {
    const code = String(entry?.code || "");
    const path = String(entry?.path || "");
    const fieldMatch = path.match(/^evidenceCard\.([^.\[]+)/);
    if (fieldMatch && EVIDENCE_FIELDS.includes(fieldMatch[1])) {
      evidenceFields.add(fieldMatch[1]);
      recognizedTarget = true;
      return;
    }
    if (path === "valueSignals" || path.startsWith("valueSignals.")) {
      valueSignalsTargeted = true;
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
    rebuildValueSignals: requiresFullResponse
      ? true
      : evidenceFields.size === 0 && valueSignalsTargeted
  };
};

const repairFieldsFor = (repairScope = {}) => [...new Set((Array.isArray(repairScope.evidenceFields)
  ? repairScope.evidenceFields
  : []).map(String).filter((field) => EVIDENCE_FIELDS.includes(field)))];

const requireObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
};

const mergeEvidenceRepairArtifacts = ({
  baseArtifacts,
  repairedValue,
  repairScope
}) => {
  if (repairScope?.mode !== "field_scoped_merge") {
    return normalizeEvidenceArtifacts(normalizeEvidenceResponseShape(repairedValue).value);
  }

  const retainedArtifacts = normalizeEvidenceArtifacts(
    normalizeEvidenceResponseShape(baseArtifacts).value
  );
  if (repairedValue?.evidenceCard && repairedValue?.valueSignals) {
    // Compatibility for a complete, independently valid response from an older
    // prompt. Partial flat responses are intentionally not accepted here.
    const repairedArtifacts = normalizeEvidenceArtifacts(
      normalizeEvidenceResponseShape(repairedValue).value
    );
    const merged = structuredClone(retainedArtifacts);
    repairFieldsFor(repairScope).forEach((field) => {
      merged.evidenceCard[field] = structuredClone(repairedArtifacts.evidenceCard[field]);
    });
    if (repairScope.rebuildValueSignals) {
      merged.valueSignals = structuredClone(repairedArtifacts.valueSignals);
    }
    return merged;
  }
  const patchResponse = requireObject(repairedValue, "Evidence patch");
  const fields = repairFieldsFor(repairScope);
  if (normalizedPaperId(patchResponse.paperId) !== normalizedPaperId(retainedArtifacts.evidenceCard.paperId)) {
    throw new TypeError("Evidence patch paperId does not match the retained Evidence.");
  }
  const patch = requireObject(patchResponse.patch, "Evidence patch.patch");
  if (fields.some((field) => !Object.hasOwn(patch, field))) {
    throw new TypeError("Evidence patch must include every requested Evidence field.");
  }
  if (repairScope.rebuildValueSignals && !Object.hasOwn(patchResponse, "valueSignals")) {
    throw new TypeError("Evidence patch must include valueSignals for this repair scope.");
  }

  const merged = structuredClone(retainedArtifacts);
  fields.forEach((field) => {
    merged.evidenceCard[field] = structuredClone(patch[field]);
  });
  if (repairScope.rebuildValueSignals) {
    merged.valueSignals = structuredClone(patchResponse.valueSignals);
  }
  return normalizeEvidenceArtifacts(merged);
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
  const availableNumbers = new Set(extractEvidenceNumericTokens(
    fieldValue.sources.map((sourceValue) => sourceValue.excerpt).join(" ")
  ));
  const unsupportedNumbers = new Set(
    extractEvidenceNumericTokens(fieldValue.summary).filter((token) => !availableNumbers.has(token))
  );
  if (!unsupportedNumbers.size) {
    return fieldValue.summary;
  }

  return numericSummarySentences(fieldValue.summary)
    .filter((sentence) => !extractEvidenceNumericTokens(sentence).some((token) => unsupportedNumbers.has(token)))
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
    artifacts = normalizeEvidenceArtifacts(normalizeEvidenceResponseShape(value).value);
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
  let sourceRegistry = null;
  try {
    sourceRegistry = buildEvidenceSourceRegistry(contextPacket);
  } catch {
    sourceRegistry = null;
  }
  const evidenceRefs = new Map();

  EVIDENCE_FIELDS.forEach((field) => {
    const fieldValue = artifacts.evidenceCard[field];
    const excerpts = [];

    fieldValue.sources.forEach((sourceValue, sourceIndex) => {
      const path = `evidenceCard.${field}.sources[${sourceIndex}]`;
      const registryUnit = sourceValue.sourceId ? sourceRegistry?.byId.get(sourceValue.sourceId) : null;
      if (sourceValue.sourceId && !registryUnit) {
        issues.push(issue(
          "unknown_source_id",
          `${path}.sourceId`,
          `Source ID ${sourceValue.sourceId} is not present in the current paper registry.`
        ));
      }
      if (registryUnit) {
        sourceValue.anchor = registryUnit.anchor;
        sourceValue.section = registryUnit.section;
        sourceValue.excerpt = registryUnit.text;
        sourceValue.rawExcerpt = registryUnit.rawText;
      }
      const section = sections.get(sourceValue.anchor);

      if (!section) {
        issues.push(issue("unknown_section_anchor", `${path}.anchor`, `Anchor ${sourceValue.anchor} is not present in contextPacket.`));
      } else {
        // The server owns the anchor-to-heading binding. Models often shorten a displayed
        // heading even when the anchor and excerpt are correct, so canonicalize this metadata
        // instead of discarding otherwise verifiable Evidence.
        sourceValue.section = normalizeText(section.heading);
        if (!registryUnit && !normalizeText(section.text).includes(normalizeText(sourceValue.excerpt))) {
          const reboundExcerpt = uniquelyReboundEvidenceExcerpt(section.text, sourceValue.excerpt);
          if (reboundExcerpt) {
            sourceValue.excerpt = reboundExcerpt;
          } else {
          issues.push(issue("excerpt_not_in_source", `${path}.excerpt`, "Excerpt is not a verbatim substring of the bound source section."));
          }
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

    const availableNumbers = new Set(extractEvidenceNumericTokens(excerpts.join(" ")));
    extractEvidenceNumericTokens(fieldValue.summary).forEach((token) => {
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

    const availableNumbers = new Set(extractEvidenceNumericTokens(boundExcerpts.join(" ")));
    extractEvidenceNumericTokens(signal.claim).forEach((token) => {
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

const evidenceReferenceExists = (artifacts, reference) => {
  const match = String(reference || "").match(/^([A-Za-z]+):(\d+)$/u);
  if (!match || !EVIDENCE_FIELDS.includes(match[1])) return false;
  const sources = artifacts?.evidenceCard?.[match[1]]?.sources;
  return Array.isArray(sources) && Number(match[2]) < sources.length;
};

const sanitizedValueSignalEvidence = (validation, { contextPacket, expectedPaperId } = {}) => {
  const issues = Array.isArray(validation?.issues) ? validation.issues : [];
  if (!validation?.artifacts || !issues.length || issues.some((entry) => (
    !["evidence_ref_not_found", "numeric_claim_not_in_excerpt"].includes(entry.code)
    || !/^valueSignals\.signals\[\d+\]/u.test(String(entry.path || ""))
  ))) {
    return null;
  }

  const artifacts = structuredClone(validation.artifacts);
  let changed = false;
  artifacts.valueSignals.signals = artifacts.valueSignals.signals.flatMap((signal) => {
    const retainedRefs = signal.evidenceRefs.filter((reference) => (
      evidenceReferenceExists(artifacts, reference)
    ));
    if (retainedRefs.length !== signal.evidenceRefs.length) changed = true;
    if (!retainedRefs.length) {
      changed = true;
      return [];
    }
    return [{ ...signal, evidenceRefs: retainedRefs }];
  });
  if (!changed) return null;

  let sanitized = validateEvidenceArtifacts(artifacts, { contextPacket, expectedPaperId });
  if (sanitized.valid) return sanitized;
  if (sanitized.issues.some((entry) => (
    entry.code !== "numeric_claim_not_in_excerpt"
    || !/^valueSignals\.signals\[\d+\]\.claim$/u.test(String(entry.path || ""))
  ))) {
    return null;
  }

  const unsupportedSignalIndexes = new Set(sanitized.issues.map((entry) => Number(
    String(entry.path).match(/^valueSignals\.signals\[(\d+)\]/u)?.[1]
  )));
  const withoutUnsupportedClaims = structuredClone(sanitized.artifacts);
  withoutUnsupportedClaims.valueSignals.signals = withoutUnsupportedClaims.valueSignals.signals
    .filter((_, index) => !unsupportedSignalIndexes.has(index));
  sanitized = validateEvidenceArtifacts(withoutUnsupportedClaims, { contextPacket, expectedPaperId });
  return sanitized.valid ? sanitized : null;
};

export class EvidenceAgentError extends Error {
  constructor(message, {
    code = "READING_LIST_EVIDENCE_FAILED",
    paperId = "",
    retryable = false,
    excludePaper = true,
    processingFailed = false,
    issues = [],
    artifacts = null,
    responseDiagnostic = null,
    cause
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "EvidenceAgentError";
    this.code = code;
    this.stage = "extract_evidence";
    this.paperId = paperId;
    this.retryable = Boolean(retryable);
    this.excludePaper = Boolean(excludePaper);
    this.processingFailed = Boolean(processingFailed);
    this.issues = issues;
    this.artifacts = artifacts && typeof artifacts === "object" ? artifacts : null;
    this.responseDiagnostic = normalizeResponseDiagnostic(responseDiagnostic);
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

const retryWaitForPaper = (paperId, requestedBaseDelayMs) => {
  const baseDelayMs = Math.max(0, Math.trunc(Number(requestedBaseDelayMs) || 0));
  const hash = [...String(paperId || "")]
    .reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 0);
  const offsetRange = Math.min(1_000, baseDelayMs + 1);
  return baseDelayMs + (hash % offsetRange);
};

const serializedError = (error) => redactTraceValue({
  code: String(error?.code || "READING_LIST_EVIDENCE_FAILED"),
  message: String(error?.message || "Evidence extraction failed."),
  stage: String(error?.stage || "extract_evidence"),
  paperId: String(error?.paperId || ""),
  retryable: Boolean(error?.retryable),
  stopReason: String(error?.stopReason || ""),
  excludePaper: Boolean(error?.excludePaper),
  issues: Array.isArray(error?.issues) ? error.issues : [],
  artifacts: error?.artifacts && typeof error.artifacts === "object" ? error.artifacts : null,
  responseDiagnostic: normalizeResponseDiagnostic(error?.responseDiagnostic)
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
  repairIssues = [],
  allowLegacyModelSources = false
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
  const sourceRegistry = buildEvidenceSourceRegistry(contextPacket);

  const callRecords = [];
  const invoke = async (prompt, attemptType, repairContext = null) => {
    if (signal?.aborted) {
      throw abortError();
    }

    await onEvent?.({
      type: "model_call_started",
      stage: "extract_evidence",
      scope: "paper",
      role: "evidence_extraction",
      paperId: expectedPaperId,
      attemptType
    });
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
    } catch (error) {
      validation = {
        valid: false,
        issues: [issue("invalid_json", "response", error.message)],
        evidenceRefCount: 0,
        artifacts: null
      };
    }

    if (!validation) {
      try {
      parsed = materializeEvidenceSources(parsed, sourceRegistry, {
        allowLegacySources: allowLegacyModelSources
      });
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
          issues: [issue("schema_invalid", "response", error.message)],
          evidenceRefCount: 0,
          artifacts: null
        };
      }
    }

    validation = acceptCredibilityAdvisories(validation);

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
        warnings: validation.warnings || [],
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
      const retryWaitMs = retryWaitForPaper(expectedPaperId, networkRetryDelayMs);

      if (typeof onEvent === "function") {
        await onEvent({
          type: "network_retry",
          stage: "extract_evidence",
          paperId: expectedPaperId,
          waitMs: retryWaitMs,
          error: serializedError(error)
        });
      }
      await waitForRetry(retryWaitMs, signal);

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
  let responseRepairCount = 0;
  const repairResponseContract = async (validation, repairContext = null) => {
    let currentValidation = validation;
    let responseRepairsForCurrentAttempt = 0;
    while (hasOnlyResponseContractIssues(currentValidation)
      && responseRepairsForCurrentAttempt < MAX_EVIDENCE_RESPONSE_REPAIRS) {
      responseRepairsForCurrentAttempt += 1;
      responseRepairCount += 1;
      await onEvent?.({
        type: "evidence_response_repair_requested",
        stage: "extract_evidence",
        paperId: expectedPaperId,
        attempt: responseRepairCount,
        issues: currentValidation.issues,
        repairScope: repairContext?.repairScope || null
      });
      currentValidation = await invokeWithNetworkRetry(
        buildEvidenceResponseRepairPrompt({
          paper,
          contextPacket,
          currentArtifacts: currentValidation.artifacts || repairContext?.baseArtifacts,
          repairTargets: repairContext?.repairScope || null,
          issues: repairIssuesWithContext(
            currentValidation.issues,
            currentValidation.artifacts || repairContext?.baseArtifacts
          )
        }),
        `response_repair_${responseRepairCount}`,
        `response_repair_${responseRepairCount}_network_retry`,
        repairContext
      );
    }
    return currentValidation;
  };
  const responseRepairFields = () => ({
    responseRepairAttempted: responseRepairCount > 0,
    responseRepairCount
  });
  const throwResponseProcessingFailure = (validation) => {
    throw new EvidenceAgentError("模型连续三次返回的证据数据均未达到结构化格式要求。", {
      code: "READING_LIST_EVIDENCE_RESPONSE_INVALID",
      paperId: expectedPaperId,
      retryable: false,
      excludePaper: false,
      processingFailed: true,
      issues: validation.issues,
      responseDiagnostic: responseDiagnosticForValidation(validation, callRecords.at(-1)?.rawOutput)
    });
  };

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
    const reviewRepairContext = reviewBaseArtifacts ? {
      baseArtifacts: reviewBaseArtifacts,
      repairScope: reviewRepairScope
    } : null;
    let reviewRepaired = await invokeWithNetworkRetry(
      buildEvidenceRepairPrompt({
        paper,
        contextPacket,
        currentArtifacts: reviewBaseArtifacts,
        repairTargets: reviewRepairScope,
        issues: repairIssuesWithContext(repairIssues, reviewBaseArtifacts)
      }),
      "review_evidence_repair",
      "review_evidence_repair_network_retry",
      reviewRepairContext
    );
    reviewRepaired = await repairResponseContract(reviewRepaired, reviewRepairContext);
    if (hasOnlyResponseContractIssues(reviewRepaired)) {
      throwResponseProcessingFailure(reviewRepaired);
    }

    let reviewRepairCount = 1;
    while (!reviewRepaired.valid && reviewRepairCount < MAX_EVIDENCE_CONTENT_REPAIRS) {
      reviewRepairCount += 1;
      await onEvent?.({
        type: "review_evidence_repair_started",
        stage: "review",
        paperId: expectedPaperId,
        attempt: reviewRepairCount,
        issues: reviewRepaired.issues,
        repairScope: reviewRepairScope
      });
      reviewRepaired = await invokeWithNetworkRetry(
        buildEvidenceRepairPrompt({
        paper,
        contextPacket,
        currentArtifacts: reviewRepaired.artifacts || reviewBaseArtifacts,
        repairTargets: reviewRepairScope,
        issues: repairIssuesWithContext(reviewRepaired.issues, reviewRepaired.artifacts || reviewBaseArtifacts)
        }),
        `review_evidence_repair_${reviewRepairCount}`,
        `review_evidence_repair_${reviewRepairCount}_network_retry`,
        reviewRepairContext
      );
      reviewRepaired = await repairResponseContract(reviewRepaired, reviewRepairContext);
      if (hasOnlyResponseContractIssues(reviewRepaired)) {
        throwResponseProcessingFailure(reviewRepaired);
      }
    }

    if (!reviewRepaired.valid) {
      throw new EvidenceAgentError("Evidence remains unsupported after three Review-requested repairs.", {
        code: "READING_LIST_EVIDENCE_REVIEW_REPAIR_FAILED",
        paperId: expectedPaperId,
        retryable: false,
        excludePaper: true,
        issues: reviewRepaired.issues,
        artifacts: reviewRepaired.artifacts
      });
    }

    return {
      ...reviewRepaired.artifacts,
      validation: reviewRepaired,
      repairAttempted: true,
      repairCount: reviewRepairCount,
      repairSource: "review",
      repairScope: reviewRepairScope,
      ...responseRepairFields(),
      calls: callRecords
    };
  }

  let initial = await invokeWithNetworkRetry(initialPrompt, "initial", "network_retry");
  initial = await repairResponseContract(initial);

  if (hasOnlyResponseContractIssues(initial)) {
    throwResponseProcessingFailure(initial);
  }

  if (initial.valid) {
    return {
      ...initial.artifacts,
      validation: initial,
      repairAttempted: false,
      repairCount: 0,
      ...responseRepairFields(),
      calls: callRecords
    };
  }

  let repaired = initial;
  let plannedRepairScope = null;
  let repairCount = 0;
  while (!repaired.valid && repairCount < MAX_EVIDENCE_CONTENT_REPAIRS) {
    plannedRepairScope = evidenceRepairScope({
      issues: repaired.issues,
      baseArtifacts: repaired.artifacts
    });
    repairCount += 1;
    await onEvent?.({
      type: "repair_requested",
      stage: "extract_evidence",
      paperId: expectedPaperId,
      attempt: repairCount,
      issues: repaired.issues,
      repairScope: plannedRepairScope
    });
    const repairContext = repaired.artifacts ? {
      baseArtifacts: repaired.artifacts,
      repairScope: plannedRepairScope
    } : null;
    repaired = await invokeWithNetworkRetry(
      buildEvidenceRepairPrompt({
        paper,
        contextPacket,
        currentArtifacts: repaired.artifacts,
        repairTargets: plannedRepairScope,
        issues: repairIssuesWithContext(repaired.issues, repaired.artifacts)
      }),
      `repair_${repairCount}`,
      `repair_${repairCount}_network_retry`,
      repairContext
    );
    repaired = await repairResponseContract(repaired, repairContext);
    if (hasOnlyResponseContractIssues(repaired)) {
      throwResponseProcessingFailure(repaired);
    }

    const signalSanitized = sanitizedValueSignalEvidence(repaired, { contextPacket, expectedPaperId });
    if (signalSanitized) {
      await onEvent?.({
        type: "evidence_value_signals_sanitized",
        stage: "extract_evidence",
        paperId: expectedPaperId,
        issues: repaired.issues
      });
      return {
        ...signalSanitized.artifacts,
        validation: signalSanitized,
        repairAttempted: true,
        repairCount,
        repairScope: plannedRepairScope,
        deterministicValueSignalSanitizationApplied: true,
        ...responseRepairFields(),
        calls: callRecords
      };
    }

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
        repairCount,
        repairScope: plannedRepairScope,
        deterministicSanitizationApplied: true,
        ...responseRepairFields(),
        calls: callRecords
      };
    }
  }

  if (!repaired.valid) {
    throw new EvidenceAgentError("Evidence artifacts remain unsupported after three targeted repairs.", {
      code: "READING_LIST_EVIDENCE_UNSUPPORTED",
      paperId: expectedPaperId,
      retryable: false,
      excludePaper: true,
      issues: repaired.issues,
      artifacts: repaired.artifacts
    });
  }

  return {
    ...repaired.artifacts,
    validation: repaired,
    repairAttempted: true,
    repairCount,
    repairScope: plannedRepairScope,
    ...responseRepairFields(),
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
  networkRetryDelayMs = 50,
  allowLegacyModelSources = false
} = {}) => {
  const candidates = Array.isArray(items) ? items : [];
  const concurrency = Math.min(Math.max(Math.trunc(Number(paperConcurrency) || 2), 1), 5);
  const results = await mapWithConcurrency(candidates, concurrency, async (item) => {
    if (signal?.aborted) {
      throw abortError();
    }

    await onEvent?.({
      type: "evidence_processing_started",
      stage: "extract_evidence",
      paperId: String(item?.contextPacket?.paperId || item?.paper?.id || "")
    });

    try {
      const result = await runEvidenceAgent({
        paper: item.paper,
        contextPacket: item.contextPacket,
        callModel,
        signal,
        networkRetryDelayMs,
        allowLegacyModelSources,
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
      if (error?.modelCallFailed || error?.processingFailed === true) {
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
        repairAttempted: entry.result.repairAttempted,
        repairCount: entry.result.repairCount || 0,
        responseRepairAttempted: entry.result.responseRepairAttempted,
        responseRepairCount: entry.result.responseRepairCount || 0
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
