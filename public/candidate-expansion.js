const candidateWindowLabel = (days) => Number(days) > 0 ? `最近 ${Number(days)} 天` : "不限时间";

export const candidateExpansionDays = (days) => {
  const initialDays = Math.max(0, Number(days) || 0);

  if (initialDays === 0) {
    return [0];
  }

  return [initialDays, 14, 30]
    .filter((value, index, values) => value >= initialDays && values.indexOf(value) === index);
};

export const candidateExpansionNotice = ({
  target,
  initialDays,
  initialCount,
  finalDays,
  finalCount
} = {}) => {
  const targetCount = Math.max(0, Number(target) || 0);
  const firstCount = Math.max(0, Number(initialCount) || 0);
  const lastCount = Math.max(0, Number(finalCount) || 0);
  const base = `目标 ${targetCount} 篇；${candidateWindowLabel(initialDays)}匹配 ${firstCount} 篇`;

  if (Number(finalDays) === Number(initialDays)) {
    return `${base}，当前获得 ${lastCount} 篇。`;
  }

  const result = lastCount >= targetCount ? `当前获得 ${lastCount} 篇` : `当前仅找到 ${lastCount} 篇`;
  return `${base}，已按相同关键词扩展至${candidateWindowLabel(finalDays)}，${result}。`;
};

export const expandCandidateBatches = async ({
  target,
  initialDays,
  initialPapers = [],
  appendUnique,
  loadBatch
} = {}) => {
  if (typeof appendUnique !== "function" || typeof loadBatch !== "function") {
    throw new TypeError("Candidate expansion requires appendUnique and loadBatch functions.");
  }

  const targetCount = Math.max(0, Number(target) || 0);
  const windows = candidateExpansionDays(initialDays);
  const initialAdded = appendUnique(Array.isArray(initialPapers) ? initialPapers : []);
  const initialCount = initialAdded.length;
  let finalCount = initialCount;
  let finalDays = windows[0];

  for (const days of windows.slice(1)) {
    if (finalCount >= targetCount) {
      break;
    }

    const batch = await loadBatch(days);
    const papers = Array.isArray(batch) ? batch : batch?.papers;
    const added = appendUnique(Array.isArray(papers) ? papers : []);
    finalCount += added.length;
    finalDays = days;
  }

  return {
    initialCount,
    finalCount,
    initialDays: windows[0],
    finalDays
  };
};
