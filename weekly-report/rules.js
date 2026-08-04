const DAY_MS = 24 * 60 * 60 * 1000;

const normalizePaperKey = (paper = {}) => {
  const raw = String(
    paper.id
    || paper.absLink
    || paper.link
    || paper.title
    || ""
  ).trim().toLowerCase();

  return raw
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//, "")
    .replace(/\.pdf(?:[?#].*)?$/, "")
    .replace(/[?#].*$/, "")
    .replace(/v\d+$/, "")
    .replace(/\s+/g, " ");
};

const paperPublicationTime = (paper = {}) => {
  const published = Date.parse(String(paper.published || ""));

  if (Number.isFinite(published)) {
    return published;
  }

  const updated = Date.parse(String(paper.updated || ""));
  return Number.isFinite(updated) ? updated : null;
};

const paperIsHidden = (paper = {}) => (
  paper.hidden === true
  || paper.isHidden === true
  || paper.recommended === false
  || String(paper.status || "").trim().toLowerCase() === "hidden"
);

export const readingListWeekRange = ({ weekStart, weekEnd, date } = {}) => {
  let startTime = Date.parse(String(weekStart || ""));
  let endTime = Date.parse(String(weekEnd || ""));
  const duration = endTime - startTime;

  if (
    !Number.isFinite(startTime)
    || !Number.isFinite(endTime)
    || duration < 6 * DAY_MS
    || duration > 8 * DAY_MS
  ) {
    const anchorText = /^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))
      ? `${date}T12:00:00.000Z`
      : new Date().toISOString();
    const anchor = new Date(anchorText);
    const day = (anchor.getUTCDay() + 6) % 7;
    anchor.setUTCDate(anchor.getUTCDate() - day);
    anchor.setUTCHours(0, 0, 0, 0);
    const end = new Date(anchor);
    end.setUTCDate(end.getUTCDate() + 7);
    startTime = anchor.getTime();
    endTime = end.getTime();
  }

  return {
    startTime,
    endTime,
    start: new Date(startTime).toISOString(),
    end: new Date(endTime).toISOString()
  };
};

export const paperIsInReadingListWeek = (paper, range) => {
  const timestamp = paperPublicationTime(paper);
  return timestamp !== null && timestamp >= range.startTime && timestamp < range.endTime;
};

export const filterReadingListPapersByWeek = (papers, range) => (
  (Array.isArray(papers) ? papers : []).filter((paper) => paperIsInReadingListWeek(paper, range))
);

export const prepareReadingListCandidatePool = ({
  primaryPapers = [],
  reservePapers = [],
  range
} = {}) => {
  if (!range || !Number.isFinite(range.startTime) || !Number.isFinite(range.endTime)) {
    throw new TypeError("A valid natural-week range is required for the weekly report candidate pool.");
  }

  const seen = new Set();
  const excluded = {
    hidden: 0,
    crossWeek: 0,
    duplicate: 0,
    invalid: 0
  };

  const prepare = (papers) => {
    const candidates = [];

    for (const paper of Array.isArray(papers) ? papers : []) {
      if (!paper || typeof paper !== "object" || Array.isArray(paper)) {
        excluded.invalid += 1;
        continue;
      }

      if (paperIsHidden(paper)) {
        excluded.hidden += 1;
        continue;
      }

      if (!paperIsInReadingListWeek(paper, range)) {
        excluded.crossWeek += 1;
        continue;
      }

      const key = normalizePaperKey(paper);

      if (!key) {
        excluded.invalid += 1;
        continue;
      }

      if (seen.has(key)) {
        excluded.duplicate += 1;
        continue;
      }

      seen.add(key);
      candidates.push(paper);
    }

    return candidates;
  };

  const primaryCandidates = prepare(primaryPapers);
  const reserveCandidates = prepare(reservePapers);

  return {
    primaryCandidates,
    reserveCandidates,
    excluded
  };
};

export const selectReadingListPapers = (papers, {
  threshold = 70,
  minSelectedCount = 3,
  maxSelectedCount = 10
} = {}) => {
  const sorted = [...(Array.isArray(papers) ? papers : [])].sort((a, b) => (
    Number(b?.readingListReview?.score || 0) - Number(a?.readingListReview?.score || 0)
    || (paperPublicationTime(b) || 0) - (paperPublicationTime(a) || 0)
    || normalizePaperKey(a).localeCompare(normalizePaperKey(b), "en")
  ));
  const unique = [];
  const uniqueKeys = new Set();

  sorted.forEach((paper, index) => {
    const key = normalizePaperKey(paper) || `paper-${index}`;

    if (uniqueKeys.has(key)) {
      return;
    }

    uniqueKeys.add(key);
    unique.push(paper);
  });

  const requestedMaximum = Number(maxSelectedCount);
  const normalizedMaximum = Number.isFinite(requestedMaximum)
    ? Math.min(Math.max(Math.trunc(requestedMaximum), 3), 20)
    : 10;
  const requestedMinimum = Number(minSelectedCount);
  const normalizedMinimum = Number.isFinite(requestedMinimum)
    ? Math.min(Math.max(Math.trunc(requestedMinimum), 1), 20)
    : 3;
  const maximum = unique.length
    ? Math.min(unique.length, normalizedMaximum)
    : 0;
  const minimum = unique.length
    ? Math.min(maximum, normalizedMinimum)
    : 0;
  const selectedIds = new Set();
  const selected = [];
  const thresholdSelected = unique.filter((paper) => Number(paper?.readingListReview?.score || 0) >= threshold);

  thresholdSelected.slice(0, maximum).forEach((paper, index) => {
    const key = normalizePaperKey(paper) || `threshold-${index}`;
    selectedIds.add(key);
    selected.push({
      ...paper,
      readingListReview: {
        ...paper.readingListReview,
        selectionReason: "threshold"
      }
    });
  });

  for (let index = 0; index < unique.length && selected.length < minimum && selected.length < maximum; index += 1) {
    const paper = unique[index];
    const key = normalizePaperKey(paper) || `fallback-${index}`;

    if (selectedIds.has(key)) {
      continue;
    }

    selectedIds.add(key);
    selected.push({
      ...paper,
      readingListReview: {
        ...paper.readingListReview,
        selectionReason: "fallback",
        readingTier: paper.readingListReview?.readingTier === "must_read"
          ? "worth_reading"
          : paper.readingListReview?.readingTier
      }
    });
  }

  return {
    selected,
    thresholdCount: thresholdSelected.length,
    fallbackCount: selected.filter((paper) => paper.readingListReview.selectionReason === "fallback").length,
    minSelectedCount: minimum,
    maxSelectedCount: maximum
  };
};

const calibratedPaperKey = (item = {}, index = 0) => normalizePaperKey({
  id: item?.reviewResult?.paperId
    || item?.calibrationResult?.paperId
    || item?.contextPacket?.paperId
    || item?.paper?.id
    || `calibrated-paper-${index}`
});

const readingTierPriority = (value) => ({
  must_read: 0,
  worth_reading: 1,
  skim: 2,
  background_only: 3
}[String(value || "").trim().toLowerCase()] ?? 4);

const finalSelectionTier = (item, selectionReason) => {
  const tier = String(item?.calibrationResult?.readingTier || "skim").trim().toLowerCase();

  if (selectionReason === "fallback" && tier === "must_read") {
    return "worth_reading";
  }
  return tier === "background_only" ? "background_only" : tier;
};

export const selectCalibratedPapers = (items, {
  threshold = 70,
  minSelectedCount = 3,
  maxSelectedCount = 10
} = {}) => {
  const candidates = Array.isArray(items) ? items : [];
  const requestedThreshold = Number(threshold);
  const normalizedThreshold = Number.isFinite(requestedThreshold)
    ? Math.min(Math.max(Math.round(requestedThreshold), 0), 100)
    : 70;
  const requestedMaximum = Number(maxSelectedCount);
  const normalizedMaximum = Number.isFinite(requestedMaximum)
    ? Math.min(Math.max(Math.trunc(requestedMaximum), 3), 20)
    : 10;
  const requestedMinimum = Number(minSelectedCount);
  const normalizedMinimum = Number.isFinite(requestedMinimum)
    ? Math.min(Math.max(Math.trunc(requestedMinimum), 1), normalizedMaximum)
    : Math.min(3, normalizedMaximum);
  const eligible = [];
  const ineligible = [];
  const seen = new Set();

  candidates.forEach((item, index) => {
    const key = calibratedPaperKey(item, index);
    const calibrationStatus = String(item?.calibrationResult?.status || "").trim().toLowerCase();
    const rawScore = Number(item?.reviewResult?.rawScore);
    const paperIdsMatch = normalizePaperKey({ id: item?.reviewResult?.paperId })
      === normalizePaperKey({ id: item?.calibrationResult?.paperId });
    const converged = ["consistent", "repaired"].includes(calibrationStatus)
      && item?.reviewResult?.evidenceValidation?.status === "pass"
      && Number.isFinite(rawScore)
      && rawScore >= 0
      && rawScore <= 100
      && paperIdsMatch
      && key
      && !seen.has(key);

    if (!converged) {
      ineligible.push({
        ...item,
        selection: {
          selected: false,
          selectionReason: "calibration_required",
          finalScore: Number.isFinite(rawScore) ? rawScore : 0,
          readingTier: String(item?.calibrationResult?.readingTier || ""),
          thresholdMet: false,
          rank: 0
        }
      });
      return;
    }

    seen.add(key);
    eligible.push(item);
  });

  eligible.sort((left, right) => (
    Number(right.reviewResult.rawScore) - Number(left.reviewResult.rawScore)
    || readingTierPriority(left.calibrationResult.readingTier)
      - readingTierPriority(right.calibrationResult.readingTier)
    || (paperPublicationTime(right.paper) || 0) - (paperPublicationTime(left.paper) || 0)
    || calibratedPaperKey(left).localeCompare(calibratedPaperKey(right), "en")
  ));

  const maximum = Math.min(normalizedMaximum, eligible.length);
  const minimum = Math.min(normalizedMinimum, maximum);
  const thresholdCandidates = eligible.filter((item) => (
    Number(item.reviewResult.rawScore) >= normalizedThreshold
  ));
  const selectedKeys = new Set();
  const selected = [];

  const addSelected = (item, selectionReason) => {
    const key = calibratedPaperKey(item);
    selectedKeys.add(key);
    selected.push({
      ...item,
      selection: {
        selected: true,
        selectionReason,
        finalScore: Number(item.reviewResult.rawScore),
        readingTier: finalSelectionTier(item, selectionReason),
        originalCalibrationReadingTier: String(item.calibrationResult.readingTier || ""),
        thresholdMet: Number(item.reviewResult.rawScore) >= normalizedThreshold,
        rank: selected.length + 1
      }
    });
  };

  thresholdCandidates.slice(0, maximum).forEach((item) => addSelected(item, "threshold"));
  for (const item of eligible) {
    if (selected.length >= minimum || selected.length >= maximum) {
      break;
    }
    if (selectedKeys.has(calibratedPaperKey(item))) {
      continue;
    }
    addSelected(item, "fallback");
  }

  const notSelected = eligible
    .filter((item) => !selectedKeys.has(calibratedPaperKey(item)))
    .map((item) => ({
      ...item,
      selection: {
        selected: false,
        selectionReason: Number(item.reviewResult.rawScore) >= normalizedThreshold
          ? "max_selected_count"
          : "below_threshold",
        finalScore: Number(item.reviewResult.rawScore),
        readingTier: String(item.calibrationResult.readingTier || ""),
        originalCalibrationReadingTier: String(item.calibrationResult.readingTier || ""),
        thresholdMet: Number(item.reviewResult.rawScore) >= normalizedThreshold,
        rank: 0
      }
    }));

  return {
    selected,
    notSelected,
    ineligible,
    threshold: normalizedThreshold,
    thresholdCount: thresholdCandidates.length,
    thresholdSelectedCount: selected.filter((item) => (
      item.selection.selectionReason === "threshold"
    )).length,
    fallbackCount: selected.filter((item) => (
      item.selection.selectionReason === "fallback"
    )).length,
    requestedMinSelectedCount: normalizedMinimum,
    minSelectedCount: minimum,
    maxSelectedCount: maximum,
    availableCount: eligible.length
  };
};
