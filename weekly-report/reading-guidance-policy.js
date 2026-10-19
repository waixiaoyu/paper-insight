const BROAD_SUPERIORITY_PATTERN = /(?:一致|全面|全部|所有|始终|各项|均).{0,20}(?:优于|领先|最好|最高)|(?:优于|领先).{0,12}(?:全部|所有|各项)/u;
const CONTRARY_RESULT_PATTERN = /(?:部分|个别|某些|某项|在[^，。；]{0,25}上).{0,35}(?:低于|不及|不占优|未领先|落后|差异区间[^，。；]{0,10}含零)|(?:低于|不及|不占优|未领先).{0,15}(?:基线|对照|比较方法)/u;

export const readingGuidanceOverstatesResult = (reason, paperDraft = {}) => {
  if (!BROAD_SUPERIORITY_PATTERN.test(String(reason || ""))) return false;
  const boundary = [
    paperDraft?.experimentsAndResults?.text,
    ...(Array.isArray(paperDraft?.limitationsAndConstraints)
      ? paperDraft.limitationsAndConstraints.map((entry) => entry?.text)
      : []),
    paperDraft?.readingValue?.evidenceBoundary?.text
  ].map((entry) => String(entry || "")).join(" ");
  return CONTRARY_RESULT_PATTERN.test(boundary);
};
