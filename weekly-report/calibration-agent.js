import {
  buildCalibrationConfirmationPrompt,
  buildCalibrationPrompt,
  buildCalibrationRepairPrompt,
  buildTargetedReviewPrompt,
  buildTargetedReviewRepairPrompt
} from "./prompts.js";
import {
  calculateReviewRawScore,
  REVIEW_SCORE_DIMENSIONS
} from "./review-agent.js";

const CALIBRATION_STATUSES = new Set([
  "consistent",
  "rereview_required",
  "repaired",
  "unresolved"
]);
const READING_TIERS = new Set([
  "must_read",
  "worth_reading",
  "skim",
  "background_only"
]);
const MISJUDGMENT_DIRECTIONS = new Set(["overrated", "underrated"]);
const FORBIDDEN_SCORE_KEYS = new Set([
  "score",
  "scores",
  "rawscore",
  "calibratedscore",
  "scoreadjustment",
  "scoredelta",
  "newscore"
]);

const normalizeText = (value, maximum = 2400) => String(value || "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, maximum);

const normalizedPaperId = (value) => {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/(?:^|\/)(\d{4}\.\d{4,5})(?:v\d+)?(?:$|[?#/])/i);
  return match?.[1] || text.replace(/v\d+$/i, "");
};

const parseModelJson = (raw) => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (Array.isArray(raw.results) || raw.paperId) {
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
    throw new TypeError("Calibration Agent did not return a JSON object.");
  }
  return JSON.parse(text.slice(start, end + 1));
};

const issue = (code, path, detail) => ({ code, path, detail });

const findForbiddenScoreKeys = (value, path = "response", seen = new WeakSet()) => {
  if (!value || typeof value !== "object") {
    return [];
  }
  if (seen.has(value)) {
    return [];
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findForbiddenScoreKeys(entry, `${path}[${index}]`, seen));
  }

  return Object.entries(value).flatMap(([key, entry]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const currentPath = `${path}.${key}`;
    return [
      ...(FORBIDDEN_SCORE_KEYS.has(normalizedKey)
        ? [issue(
          "calibration_score_forbidden",
          currentPath,
          "Calibration must not return or modify scores."
        )]
        : []),
      ...findForbiddenScoreKeys(entry, currentPath, seen)
    ];
  });
};

const uniqueIssues = (issues) => {
  const seen = new Set();
  return issues.filter((entry) => {
    const key = `${entry.code}|${entry.path}|${entry.detail}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const validateCalibrationResponse = (value, {
  items = [],
  phase = "initial"
} = {}) => {
  const candidates = Array.isArray(items) ? items : [];
  const expectedOrder = candidates.map((item) => normalizedPaperId(
    item?.reviewResult?.paperId || item?.contextPacket?.paperId || item?.paper?.id
  ));
  const expectedIds = new Set(expectedOrder);
  const issues = findForbiddenScoreKeys(value);
  const normalizations = [];

  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.results)) {
    return {
      valid: false,
      issues: uniqueIssues([
        ...issues,
        issue("schema_invalid", "response.results", "Calibration response requires a results array.")
      ]),
      normalizations,
      results: []
    };
  }
  if (value.results.length !== expectedOrder.length) {
    issues.push(issue(
      "calibration_result_count_mismatch",
      "response.results",
      "Calibration must return exactly one result for every supplied paper."
    ));
  }

  const normalizedById = new Map();
  value.results.slice(0, 40).forEach((entry, index) => {
    const path = `results[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push(issue("calibration_result_invalid", path, "Calibration result must be an object."));
      return;
    }
    const id = normalizedPaperId(entry.paperId);
    if (!expectedIds.has(id)) {
      issues.push(issue("calibration_paper_unknown", `${path}.paperId`, "Calibration returned an unknown paperId."));
      return;
    }
    if (normalizedById.has(id)) {
      issues.push(issue("calibration_paper_duplicate", `${path}.paperId`, "Calibration returned a duplicate paperId."));
      return;
    }

    const reportedStatus = normalizeText(entry.status, 60).toLowerCase();
    if (!CALIBRATION_STATUSES.has(reportedStatus)) {
      issues.push(issue("calibration_status_invalid", `${path}.status`, "Calibration status is invalid."));
    }
    if (phase === "initial" && !["consistent", "rereview_required"].includes(reportedStatus)) {
      issues.push(issue("calibration_initial_status_invalid", `${path}.status`, "Initial Calibration can only return consistent or rereview_required."));
    }
    if (phase === "confirm" && !["consistent", "repaired", "unresolved"].includes(reportedStatus)) {
      issues.push(issue("calibration_confirm_status_invalid", `${path}.status`, "Confirmation can only return consistent, repaired or unresolved."));
    }

    const suspectedMisjudgments = (Array.isArray(entry.suspectedMisjudgments)
      ? entry.suspectedMisjudgments
      : []).slice(0, 12).map((suspected, suspectedIndex) => {
      const suspectedPath = `${path}.suspectedMisjudgments[${suspectedIndex}]`;
      const dimension = normalizeText(suspected?.dimension, 80);
      const direction = normalizeText(suspected?.direction, 40).toLowerCase();
      const reason = normalizeText(suspected?.reason, 1600);
      const comparisonPaperIds = [...new Set((Array.isArray(suspected?.comparisonPaperIds)
        ? suspected.comparisonPaperIds
        : []).slice(0, 12).map(normalizedPaperId).filter(Boolean))];

      if (!REVIEW_SCORE_DIMENSIONS.includes(dimension)) {
        issues.push(issue("calibration_dimension_invalid", `${suspectedPath}.dimension`, "Suspected dimension is invalid."));
      }
      if (!MISJUDGMENT_DIRECTIONS.has(direction)) {
        issues.push(issue("calibration_direction_invalid", `${suspectedPath}.direction`, "Misjudgment direction is invalid."));
      }
      if (!reason) {
        issues.push(issue("calibration_reason_missing", `${suspectedPath}.reason`, "Misjudgment reason is required."));
      }
      if (!comparisonPaperIds.length) {
        issues.push(issue("comparison_paper_missing", `${suspectedPath}.comparisonPaperIds`, "A suspected misjudgment requires a comparison paper."));
      }
      comparisonPaperIds.forEach((comparisonId, comparisonIndex) => {
        if (!expectedIds.has(comparisonId) || comparisonId === id) {
          issues.push(issue(
            "comparison_paper_unknown",
            `${suspectedPath}.comparisonPaperIds[${comparisonIndex}]`,
            "Comparison paper must be another paper in the Calibration cohort."
          ));
        }
      });
      return { dimension, direction, reason, comparisonPaperIds };
    });

    let status = reportedStatus;
    const inferredStatus = suspectedMisjudgments.length
      ? (phase === "initial" && reportedStatus === "consistent"
        ? "rereview_required"
        : (phase === "confirm" && ["consistent", "repaired"].includes(reportedStatus)
          ? "unresolved"
          : ""))
      : "";
    if (inferredStatus) {
      status = inferredStatus;
      normalizations.push({
        code: "calibration_status_inferred_from_suspicions",
        path: `${path}.status`,
        paperId: String(candidates[expectedOrder.indexOf(id)]?.reviewResult?.paperId || entry.paperId || ""),
        from: reportedStatus,
        to: inferredStatus
      });
    }

    if (["consistent", "repaired"].includes(status) && suspectedMisjudgments.length) {
      issues.push(issue("calibration_consistent_with_suspicions", `${path}.suspectedMisjudgments`, "A resolved Calibration result cannot retain suspected misjudgments."));
    }
    if (["rereview_required", "unresolved"].includes(status) && !suspectedMisjudgments.length) {
      issues.push(issue("calibration_suspicion_missing", `${path}.suspectedMisjudgments`, "This Calibration status requires at least one suspected misjudgment."));
    }

    const relativePosition = normalizeText(entry.relativePosition, 1600);
    const readingTier = normalizeText(entry.readingTier, 80).toLowerCase();
    const calibrationReason = normalizeText(entry.calibrationReason, 2000);
    if (!relativePosition) {
      issues.push(issue("relative_position_missing", `${path}.relativePosition`, "Relative position is required."));
    }
    if (!READING_TIERS.has(readingTier)) {
      issues.push(issue("reading_tier_invalid", `${path}.readingTier`, "Reading tier is invalid."));
    }
    if (!calibrationReason) {
      issues.push(issue("calibration_reason_missing", `${path}.calibrationReason`, "Calibration reason is required."));
    }

    normalizedById.set(id, {
      paperId: String(candidates[expectedOrder.indexOf(id)]?.reviewResult?.paperId || entry.paperId || ""),
      status,
      relativePosition,
      suspectedMisjudgments,
      readingTier,
      calibrationReason
    });
  });

  expectedOrder.forEach((id) => {
    if (!normalizedById.has(id)) {
      issues.push(issue("calibration_paper_missing", "results", `Calibration result is missing paper ${id}.`));
    }
  });
  const normalizedIssues = uniqueIssues(issues);
  return {
    valid: normalizedIssues.length === 0,
    issues: normalizedIssues,
    normalizations,
    results: expectedOrder.map((id) => normalizedById.get(id)).filter(Boolean)
  };
};

const validateTargetedReviewResponse = (value, { item, dimensions }) => {
  const issues = [];
  const expectedPaperId = normalizedPaperId(item?.reviewResult?.paperId);
  const actualPaperId = normalizedPaperId(value?.paperId);
  const expectedDimensions = [...new Set(dimensions || [])];
  const returnedDimensions = value?.dimensions && typeof value.dimensions === "object"
    && !Array.isArray(value.dimensions)
    ? Object.keys(value.dimensions)
    : [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(issue("targeted_review_schema_invalid", "response", "Targeted Review response must be an object."));
  } else {
    Object.keys(value).forEach((key) => {
      if (!["paperId", "dimensions"].includes(key)) {
        issues.push(issue(
          "targeted_review_field_forbidden",
          `response.${key}`,
          "Targeted Review may only return paperId and requested dimensions."
        ));
      }
    });
  }
  if (!expectedPaperId || actualPaperId !== expectedPaperId) {
    issues.push(issue("paper_id_mismatch", "paperId", "Targeted Review paperId does not match."));
  }
  returnedDimensions.forEach((dimension) => {
    if (!expectedDimensions.includes(dimension)) {
      issues.push(issue("unrequested_dimension", `dimensions.${dimension}`, "Targeted Review returned an unrequested dimension."));
    }
  });
  const normalizedDimensions = {};
  expectedDimensions.forEach((dimension) => {
    const entry = value?.dimensions?.[dimension];
    const score = Number(entry?.score);
    const reason = normalizeText(entry?.reason, 1600);
    if (!entry || typeof entry !== "object" || !Number.isInteger(score) || score < 0 || score > 100) {
      issues.push(issue("targeted_score_invalid", `dimensions.${dimension}.score`, "Targeted score must be an integer from 0 to 100."));
    }
    if (!reason) {
      issues.push(issue("targeted_reason_missing", `dimensions.${dimension}.reason`, "Targeted score reason is required."));
    }
    normalizedDimensions[dimension] = { score, reason };
  });
  return {
    valid: issues.length === 0,
    issues,
    result: {
      paperId: String(item?.reviewResult?.paperId || value?.paperId || ""),
      dimensions: normalizedDimensions
    }
  };
};

export class CalibrationAgentError extends Error {
  constructor(message, {
    code = "READING_LIST_CALIBRATION_FAILED",
    paperId = "",
    retryable = false,
    excludePaper = false,
    issues = [],
    cause
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "CalibrationAgentError";
    this.code = code;
    this.stage = "calibrate";
    this.paperId = paperId;
    this.retryable = Boolean(retryable);
    this.excludePaper = Boolean(excludePaper);
    this.issues = issues;
  }
}

const abortError = () => {
  const error = new Error("Weekly report Calibration was cancelled.");
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
  code: String(error?.code || "READING_LIST_CALIBRATION_FAILED"),
  message: String(error?.message || "Calibration failed."),
  stage: String(error?.stage || "calibrate"),
  paperId: String(error?.paperId || ""),
  retryable: Boolean(error?.retryable),
  excludePaper: Boolean(error?.excludePaper),
  issues: Array.isArray(error?.issues) ? error.issues : []
});

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

const createModelInvoker = ({ callModel, signal, onCall, onEvent, networkRetryDelayMs }) => {
  const invoke = async ({ prompt, role, paperId = "", attemptType, validate }) => {
    if (signal?.aborted) {
      throw abortError();
    }
    const startedAt = Date.now();
    let rawOutput;
    try {
      rawOutput = await callModel(prompt, { role, paperId, attemptType, signal });
    } catch (error) {
      const record = {
        role,
        paperId,
        attemptType,
        prompt,
        rawOutput: null,
        normalizedOutput: null,
        validation: null,
        durationMs: Math.max(0, Date.now() - startedAt),
        error: serializedError(error)
      };
      await onCall?.(record);
      error.modelCallFailed = true;
      throw error;
    }

    let validation;
    try {
      validation = validate(parseModelJson(rawOutput));
    } catch (error) {
      validation = {
        valid: false,
        issues: [issue("invalid_json", "response", error.message)],
        results: [],
        result: null
      };
    }
    await onCall?.({
      role,
      paperId,
      attemptType,
      prompt,
      rawOutput,
      normalizedOutput: validation.results || validation.result,
      validation: {
        valid: validation.valid,
        issues: validation.issues,
        normalizations: validation.normalizations || []
      },
      durationMs: Math.max(0, Date.now() - startedAt),
      error: null
    });
    return validation;
  };

  return async (options) => {
    try {
      return await invoke(options);
    } catch (error) {
      if (!error?.modelCallFailed || error?.name === "AbortError" || signal?.aborted) {
        throw error;
      }
      await onEvent?.({
        type: "network_retry",
        stage: options.role === "targeted_paper_review" ? "targeted_rereview" : "calibrate",
        paperId: options.paperId,
        waitMs: networkRetryDelayMs,
        error: serializedError(error)
      });
      await waitForRetry(networkRetryDelayMs, signal);
      return invoke({ ...options, attemptType: `${options.attemptType}_network_retry` });
    }
  };
};

const runCalibrationCall = async ({
  items,
  phase,
  invokeModel,
  onEvent
}) => {
  const prompt = phase === "confirm"
    ? buildCalibrationConfirmationPrompt({
      items,
      rereviewedDimensions: Object.fromEntries(items
        .filter((item) => item.targetedRereview)
        .map((item) => [item.reviewResult.paperId, Object.keys(item.targetedRereview.dimensions)]))
    })
    : buildCalibrationPrompt({ items });
  let validation = await invokeModel({
    prompt,
    role: "cross_paper_calibration",
    attemptType: phase,
    validate: (value) => validateCalibrationResponse(value, { items, phase })
  });

  if (!validation.valid) {
    await onEvent?.({
      type: "calibration_repair_requested",
      stage: "calibrate",
      phase,
      issues: validation.issues
    });
    validation = await invokeModel({
      prompt: buildCalibrationRepairPrompt({ items, issues: validation.issues, phase }),
      role: "cross_paper_calibration",
      attemptType: `${phase}_repair`,
      validate: (value) => validateCalibrationResponse(value, { items, phase })
    });
    if (!validation.valid) {
      throw new CalibrationAgentError("Calibration response remains invalid after one structured repair.", {
        code: "READING_LIST_CALIBRATION_UNSUPPORTED",
        issues: validation.issues
      });
    }
  }
  for (const normalization of validation.normalizations || []) {
    await onEvent?.({
      type: "calibration_status_normalized",
      stage: "calibrate",
      phase,
      ...normalization
    });
  }
  return validation.results;
};

const runTargetedReview = async ({
  item,
  suspectedMisjudgments,
  invokeModel,
  onEvent
}) => {
  const paperId = String(item.reviewResult.paperId || "");
  const dimensions = [...new Set(suspectedMisjudgments.map((entry) => entry.dimension))];
  let validation = await invokeModel({
    prompt: buildTargetedReviewPrompt({ item, suspectedMisjudgments }),
    role: "targeted_paper_review",
    paperId,
    attemptType: "targeted_rereview",
    validate: (value) => validateTargetedReviewResponse(value, { item, dimensions })
  });

  if (!validation.valid) {
    await onEvent?.({
      type: "targeted_review_repair_requested",
      stage: "targeted_rereview",
      paperId,
      issues: validation.issues
    });
    validation = await invokeModel({
      prompt: buildTargetedReviewRepairPrompt({
        item,
        suspectedMisjudgments,
        issues: validation.issues
      }),
      role: "targeted_paper_review",
      paperId,
      attemptType: "targeted_rereview_repair",
      validate: (value) => validateTargetedReviewResponse(value, { item, dimensions })
    });
    if (!validation.valid) {
      throw new CalibrationAgentError("Targeted Review remains invalid after one repair.", {
        code: "READING_LIST_TARGETED_REVIEW_UNSUPPORTED",
        paperId,
        excludePaper: true,
        issues: validation.issues
      });
    }
  }

  const scores = { ...item.reviewResult.scores };
  Object.entries(validation.result.dimensions).forEach(([dimension, entry]) => {
    scores[dimension] = entry.score;
  });
  const updated = {
    ...item,
    reviewResult: {
      ...item.reviewResult,
      scores,
      rawScore: calculateReviewRawScore(scores),
      targetedRereview: {
        dimensions: validation.result.dimensions,
        reason: "calibration_suspected_misjudgment"
      }
    },
    targetedRereview: {
      dimensions: validation.result.dimensions,
      suspectedMisjudgments
    }
  };
  await onEvent?.({
    type: "targeted_rereview_completed",
    stage: "targeted_rereview",
    paperId,
    dimensions,
    rawScore: updated.reviewResult.rawScore
  });
  return updated;
};

export const calibrateReviewBatch = async (items, {
  calibrationMaxPapers = 30,
  paperConcurrency = 2,
  callModel,
  signal,
  onCall,
  onEvent,
  networkRetryDelayMs = 50,
  rereviewedPaperIds = []
} = {}) => {
  const candidates = Array.isArray(items) ? items : [];
  const maximum = Math.min(Math.max(Math.trunc(Number(calibrationMaxPapers) || 30), 1), 30);
  if (candidates.length > maximum) {
    throw new CalibrationAgentError(`Calibration batch exceeds the ${maximum}-paper ceiling.`, {
      code: "READING_LIST_CALIBRATION_BATCH_TOO_LARGE"
    });
  }
  if (!candidates.length) {
    return {
      succeeded: [],
      excluded: [],
      initialResults: [],
      confirmationResults: [],
      rereviewedPaperIds: [...new Set(rereviewedPaperIds)]
    };
  }
  if (typeof callModel !== "function") {
    throw new TypeError("Calibration Agent callModel is required.");
  }
  if (signal?.aborted) {
    throw abortError();
  }

  const concurrency = Math.min(Math.max(Math.trunc(Number(paperConcurrency) || 2), 1), 5);
  const invokeModel = createModelInvoker({
    callModel,
    signal,
    onCall,
    onEvent,
    networkRetryDelayMs
  });
  const initialResults = await runCalibrationCall({
    items: candidates,
    phase: "initial",
    invokeModel,
    onEvent
  });
  const initialById = new Map(initialResults.map((result) => [normalizedPaperId(result.paperId), result]));
  const alreadyRereviewed = new Set([...rereviewedPaperIds].map(normalizedPaperId));
  const excluded = [];
  const targets = [];
  const survivors = [];

  candidates.forEach((item) => {
    const id = normalizedPaperId(item.reviewResult.paperId);
    const calibrationResult = initialById.get(id);
    if (calibrationResult.status !== "rereview_required") {
      survivors.push({ ...item, calibrationResult });
      return;
    }
    if (alreadyRereviewed.has(id)) {
      excluded.push({
        ...item,
        calibrationResult: { ...calibrationResult, status: "unresolved" },
        error: serializedError(new CalibrationAgentError(
          "Calibration questioned a paper after its single targeted Review opportunity.",
          {
            code: "READING_LIST_CALIBRATION_UNRESOLVED",
            paperId: item.reviewResult.paperId,
            excludePaper: true,
            issues: calibrationResult.suspectedMisjudgments
          }
        ))
      });
      return;
    }
    targets.push({ item, calibrationResult });
  });

  if (!targets.length) {
    for (const item of excluded) {
      await onEvent?.({
        type: "calibration_unresolved",
        stage: "calibrate",
        paperId: item.reviewResult.paperId,
        severity: "warning",
        issues: item.calibrationResult.suspectedMisjudgments
      });
    }
    return {
      succeeded: survivors,
      excluded,
      initialResults,
      confirmationResults: [],
      rereviewedPaperIds: [...alreadyRereviewed],
      concurrency
    };
  }

  for (const target of targets) {
    await onEvent?.({
      type: "targeted_rereview_requested",
      stage: "calibrate",
      paperId: target.item.reviewResult.paperId,
      severity: "warning",
      suspectedMisjudgments: target.calibrationResult.suspectedMisjudgments
    });
  }
  const targetedResults = await mapWithConcurrency(targets, concurrency, async (target) => {
    try {
      const item = await runTargetedReview({
        item: target.item,
        suspectedMisjudgments: target.calibrationResult.suspectedMisjudgments,
        invokeModel,
        onEvent
      });
      return { ok: true, item };
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) {
        throw abortError();
      }
      return { ok: false, item: target.item, error };
    }
  });
  const successfullyRereviewed = [];
  targetedResults.forEach((entry) => {
    const id = normalizedPaperId(entry.item.reviewResult.paperId);
    alreadyRereviewed.add(id);
    if (entry.ok) {
      successfullyRereviewed.push(entry.item);
    } else {
      excluded.push({
        ...entry.item,
        error: serializedError(entry.error)
      });
    }
  });

  const confirmationCandidates = candidates.flatMap((candidate) => {
    const id = normalizedPaperId(candidate.reviewResult.paperId);
    if (excluded.some((entry) => normalizedPaperId(entry.reviewResult.paperId) === id)) {
      return [];
    }
    const successful = successfullyRereviewed.find((item) => (
      normalizedPaperId(item.reviewResult.paperId) === id
    ));
    if (successful) {
      return [successful];
    }
    if (targets.some((target) => normalizedPaperId(target.item.reviewResult.paperId) === id)) {
      return [];
    }
    return [candidate];
  });

  if (!successfullyRereviewed.length) {
    return {
      succeeded: survivors,
      excluded,
      initialResults,
      confirmationResults: [],
      rereviewedPaperIds: [...alreadyRereviewed],
      concurrency
    };
  }

  const confirmationResults = await runCalibrationCall({
    items: confirmationCandidates,
    phase: "confirm",
    invokeModel,
    onEvent
  });
  const confirmationById = new Map(confirmationResults.map((result) => [
    normalizedPaperId(result.paperId),
    result
  ]));
  const succeeded = [];
  confirmationCandidates.forEach((item) => {
    const id = normalizedPaperId(item.reviewResult.paperId);
    const calibrationResult = confirmationById.get(id);
    if (calibrationResult.status === "unresolved") {
      excluded.push({
        ...item,
        calibrationResult,
        error: serializedError(new CalibrationAgentError(
          "Calibration remains unresolved after targeted Review.",
          {
            code: "READING_LIST_CALIBRATION_UNRESOLVED",
            paperId: item.reviewResult.paperId,
            excludePaper: true,
            issues: calibrationResult.suspectedMisjudgments
          }
        ))
      });
      return;
    }
    const wasRereviewed = alreadyRereviewed.has(id);
    succeeded.push({
      ...item,
      calibrationResult: {
        ...calibrationResult,
        status: wasRereviewed ? "repaired" : "consistent"
      }
    });
  });
  for (const item of excluded.filter((entry) => entry.error?.code === "READING_LIST_CALIBRATION_UNRESOLVED")) {
    await onEvent?.({
      type: "calibration_unresolved",
      stage: "calibrate",
      paperId: item.reviewResult.paperId,
      severity: "warning",
      issues: item.calibrationResult?.suspectedMisjudgments || item.error.issues
    });
  }

  return {
    succeeded,
    excluded,
    initialResults,
    confirmationResults,
    rereviewedPaperIds: [...alreadyRereviewed],
    concurrency
  };
};
