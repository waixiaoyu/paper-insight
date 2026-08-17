const JOB_STATES = new Set(["running", "publish", "reject"]);
const FINAL_JOB_STATES = new Set(["publish", "reject"]);
const MANUAL_REVIEW_ACTIONS = new Set([
  "continue_repair",
  "retry_job",
  "exit_task",
  "skip_paper",
  "ignore_warning"
]);
const COUNT_KEYS = [
  "primary",
  "reserve",
  "fullTextEligible",
  "reviewed",
  "calibrated",
  "selected",
  "excluded"
];
export const EVIDENCE_FIELDS = Object.freeze([
  "problem",
  "method",
  "systemDesign",
  "experiments",
  "results",
  "limitations",
  "affiliations"
]);
const EVIDENCE_STATUSES = new Set(["supported", "not_present", "insufficient"]);
const VALUE_DIMENSIONS = new Set([
  "scenarioProblemValue",
  "methodNovelty",
  "practicalValue",
  "evidence"
]);
const ADN_RELEVANCE = new Set(["direct", "transferable", "weak", "none"]);
const ADN_ANGLES = new Set([
  "intent",
  "closed_loop",
  "digital_twin",
  "network_agent",
  "cross_domain",
  "ops",
  "evaluation",
  "safety",
  "engineering",
  "general",
  "none"
]);

const boundedInteger = (value, fallback, minimum, maximum) => {
  const numeric = Number(value);
  const normalized = Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
  return Math.min(Math.max(normalized, minimum), maximum);
};

const isoTime = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("Weekly report Job time must be a valid date.");
  }

  return date.toISOString();
};

const normalizedText = (value, maximum = 2000) => String(value || "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, maximum);

const requireObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
};

const normalizeEvidenceSource = (value, label) => {
  const source = requireObject(value, label);
  const normalized = {
    section: normalizedText(source.section, 240),
    anchor: normalizedText(source.anchor, 80),
    excerpt: normalizedText(source.excerpt, 1200)
  };

  if (!normalized.section || !normalized.anchor || !normalized.excerpt) {
    throw new TypeError(`${label} must include section, anchor and excerpt.`);
  }
  return normalized;
};

const normalizeEvidenceField = (value, label) => {
  const field = requireObject(value, label);
  const status = normalizedText(field.status, 40).toLowerCase();

  if (!EVIDENCE_STATUSES.has(status)) {
    throw new TypeError(`${label}.status is invalid.`);
  }

  const summary = normalizedText(field.summary, 2400);
  if (!summary) {
    throw new TypeError(`${label}.summary is required.`);
  }

  const sources = (Array.isArray(field.sources) ? field.sources : [])
    .slice(0, 12)
    .map((source, index) => normalizeEvidenceSource(source, `${label}.sources[${index}]`));

  if (status === "supported" && !sources.length) {
    throw new TypeError(`${label} marked supported without a source.`);
  }
  if (status === "not_present" && sources.length) {
    throw new TypeError(`${label} marked not_present cannot include sources.`);
  }

  return { summary, status, sources };
};

export const normalizeEvidenceArtifacts = (value) => {
  const response = requireObject(value, "Evidence response");
  const rawCard = requireObject(response.evidenceCard, "evidenceCard");
  const rawSignals = requireObject(response.valueSignals, "valueSignals");
  const evidenceCard = {
    paperId: normalizedText(rawCard.paperId, 200)
  };

  if (!evidenceCard.paperId) {
    throw new TypeError("evidenceCard.paperId is required.");
  }

  EVIDENCE_FIELDS.forEach((field) => {
    evidenceCard[field] = normalizeEvidenceField(rawCard[field], `evidenceCard.${field}`);
  });
  evidenceCard.evidenceInsufficient = Boolean(rawCard.evidenceInsufficient);
  evidenceCard.warnings = (Array.isArray(rawCard.warnings) ? rawCard.warnings : [])
    .slice(0, 20)
    .map((warning) => normalizedText(warning, 500))
    .filter(Boolean);

  const valueSignals = {
    paperId: normalizedText(rawSignals.paperId, 200),
    signals: []
  };

  if (!valueSignals.paperId) {
    throw new TypeError("valueSignals.paperId is required.");
  }

  valueSignals.signals = (Array.isArray(rawSignals.signals) ? rawSignals.signals : [])
    .slice(0, 20)
    .map((signalValue, index) => {
      const signal = requireObject(signalValue, `valueSignals.signals[${index}]`);
      const dimension = normalizedText(signal.dimension, 80);

      if (!VALUE_DIMENSIONS.has(dimension)) {
        throw new TypeError(`valueSignals.signals[${index}].dimension is invalid.`);
      }

      const claim = normalizedText(signal.claim, 1600);
      const evidenceRefs = [...new Set((Array.isArray(signal.evidenceRefs) ? signal.evidenceRefs : [])
        .slice(0, 20)
        .map((reference) => normalizedText(reference, 120))
        .filter(Boolean))];
      const adnValue = signal.adnImplication && typeof signal.adnImplication === "object"
        ? signal.adnImplication
        : {};
      const relevance = normalizedText(adnValue.relevance, 40).toLowerCase() || "none";
      const angle = normalizedText(adnValue.angle, 80).toLowerCase() || "none";

      if (!claim || !evidenceRefs.length) {
        throw new TypeError(`valueSignals.signals[${index}] requires claim and evidenceRefs.`);
      }
      if (!ADN_RELEVANCE.has(relevance) || !ADN_ANGLES.has(angle)) {
        throw new TypeError(`valueSignals.signals[${index}].adnImplication is invalid.`);
      }

      return {
        dimension,
        claim,
        evidenceRefs,
        readerImplication: normalizedText(signal.readerImplication, 1600),
        adnImplication: {
          relevance,
          angle,
          insight: normalizedText(adnValue.insight, 1600),
          limit: normalizedText(adnValue.limit, 1600)
        },
        caveat: normalizedText(signal.caveat, 1600)
      };
    });

  return { evidenceCard, valueSignals };
};

export const WEEKLY_REPORT_JOB_STATES = Object.freeze([...JOB_STATES]);

export const normalizeWeeklyReportJobOptions = (value = {}) => {
  const maxSelectedCount = boundedInteger(value.maxSelectedCount, 10, 3, 20);
  const requestedMinimum = boundedInteger(value.minSelectedCount, 3, 1, 20);

  return {
    paperConcurrency: boundedInteger(value.paperConcurrency, 2, 1, 5),
    calibrationMaxPapers: boundedInteger(value.calibrationMaxPapers, 30, 1, 30),
    minSelectedCount: Math.min(requestedMinimum, maxSelectedCount),
    maxSelectedCount
  };
};

export const createWeeklyReportJob = ({
  jobId,
  traceId,
  reportKey,
  options,
  now = new Date()
} = {}) => {
  const createdAt = isoTime(now);
  const job = {
    jobId: String(jobId || "").trim(),
    traceId: String(traceId || "").trim(),
    reportKey: String(reportKey || "").trim(),
    state: "running",
    agentStage: "create_job",
    createdAt,
    updatedAt: createdAt,
    completedAt: "",
    cancelRequested: false,
    options: normalizeWeeklyReportJobOptions(options),
    counts: Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])),
    warnings: [],
    manualReview: null,
    result: null,
    error: null
  };

  return assertWeeklyReportJob(job);
};

export const assertWeeklyReportJob = (job) => {
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new TypeError("Weekly report Job must be an object.");
  }

  for (const key of ["jobId", "traceId", "reportKey"]) {
    if (!String(job[key] || "").trim()) {
      throw new TypeError(`Weekly report Job ${key} is required.`);
    }
  }

  if (!JOB_STATES.has(job.state)) {
    throw new TypeError("Weekly report Job state must be running, publish or reject.");
  }

  if (!String(job.agentStage || "").trim()) {
    throw new TypeError("Weekly report Job agentStage is required.");
  }

  isoTime(job.createdAt);
  isoTime(job.updatedAt);

  if (job.state === "running") {
    if (job.completedAt || job.result !== null) {
      throw new TypeError("A running weekly report Job cannot have a completed result.");
    }
  } else {
    if (!job.result || typeof job.result !== "object" || Array.isArray(job.result)) {
      throw new TypeError("A completed weekly report Job must include result.");
    }

    isoTime(job.completedAt);
  }

  if (job.manualReview !== null && job.manualReview !== undefined) {
    const review = requireObject(job.manualReview, "Weekly report Job manualReview");
    if (job.state !== "running") {
      throw new TypeError("Only a running weekly report Job can wait for manual review.");
    }
    if (!normalizedText(review.stage, 120) || !normalizedText(review.requestedAt, 80)) {
      throw new TypeError("Weekly report Job manualReview requires stage and requestedAt.");
    }
    isoTime(review.requestedAt);
    if (!Number.isInteger(review.repairAttempts) || review.repairAttempts < 0) {
      throw new TypeError("Weekly report Job manualReview.repairAttempts must be a non-negative integer.");
    }
    if (!Array.isArray(review.allowedActions) || !review.allowedActions.length
      || review.allowedActions.some((action) => !MANUAL_REVIEW_ACTIONS.has(action))) {
      throw new TypeError("Weekly report Job manualReview.allowedActions is invalid.");
    }
    if (!Array.isArray(review.issues)) {
      throw new TypeError("Weekly report Job manualReview.issues must be an array.");
    }
  }

  const normalizedOptions = normalizeWeeklyReportJobOptions(job.options);

  for (const [key, value] of Object.entries(normalizedOptions)) {
    if (job.options?.[key] !== value) {
      throw new TypeError("Weekly report Job options are outside the supported range.");
    }
  }

  for (const key of COUNT_KEYS) {
    if (!Number.isInteger(job.counts?.[key]) || job.counts[key] < 0) {
      throw new TypeError(`Weekly report Job counts.${key} must be a non-negative integer.`);
    }
  }

  return job;
};

export const finalizeWeeklyReportJob = (job, {
  state,
  reason,
  result,
  error = null,
  now = new Date()
} = {}) => {
  if (!FINAL_JOB_STATES.has(state)) {
    throw new TypeError("Weekly report Job final state must be publish or reject.");
  }

  assertWeeklyReportJob(job);

  if (job.state !== "running") {
    throw new TypeError("Only a running weekly report Job can be finalized.");
  }

  const completedAt = isoTime(now);
  const finalJob = {
    ...job,
    state,
    agentStage: state,
    manualReview: null,
    updatedAt: completedAt,
    completedAt,
    result: {
      ...(result && typeof result === "object" && !Array.isArray(result) ? result : {}),
      reason: String(reason || (state === "publish" ? "completed" : "rejected"))
    },
    error: error && typeof error === "object" && !Array.isArray(error) ? error : null
  };

  return assertWeeklyReportJob(finalJob);
};
