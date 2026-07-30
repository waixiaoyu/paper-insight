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

export const selectReadingListPapers = (papers, { threshold = 70, minSelectedCount = 3 } = {}) => {
  const sorted = [...(Array.isArray(papers) ? papers : [])].sort((a, b) => (
    Number(b?.readingListReview?.score || 0) - Number(a?.readingListReview?.score || 0)
    || (paperPublicationTime(b) || 0) - (paperPublicationTime(a) || 0)
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

  const minimum = unique.length
    ? Math.max(1, Math.min(unique.length, Number(minSelectedCount) || 3))
    : 0;
  const selectedIds = new Set();
  const selected = [];
  const thresholdSelected = unique.filter((paper) => Number(paper?.readingListReview?.score || 0) >= threshold);

  thresholdSelected.forEach((paper, index) => {
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

  for (let index = 0; index < unique.length && selected.length < minimum; index += 1) {
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
        selectionReason: "fallback"
      }
    });
  }

  return {
    selected,
    thresholdCount: thresholdSelected.length,
    fallbackCount: selected.filter((paper) => paper.readingListReview.selectionReason === "fallback").length,
    minSelectedCount: minimum
  };
};
