const GROUNDED_ROOTS = new Set([
  "oneSentenceTakeaway",
  "researchProblem",
  "coreContribution",
  "methodFramework",
  "experimentsAndResults",
  "adnInsight"
]);

const READING_VALUE_ROOTS = new Set([
  "whyWorthReading",
  "recommendedFocus",
  "evidenceBoundary"
]);

const issue = (code, path, detail) => ({ code, path, detail });

const normalizedRepairPath = (value) => {
  const path = String(value || "");
  const topLevelMatch = path.match(/^([A-Za-z]+)(?:\.|$)/u);
  if (GROUNDED_ROOTS.has(topLevelMatch?.[1])) {
    return topLevelMatch[1];
  }
  const readingValueMatch = path.match(/^readingValue(?:\.([A-Za-z]+))?/u);
  if (readingValueMatch) {
    return READING_VALUE_ROOTS.has(readingValueMatch[1])
      ? `readingValue.${readingValueMatch[1]}`
      : "readingValue";
  }
  const limitationMatch = path.match(/^limitationsAndConstraints(?:\[(\d+)\])?/u);
  if (limitationMatch) {
    return limitationMatch[1] === undefined
      ? "limitationsAndConstraints"
      : `limitationsAndConstraints[${limitationMatch[1]}]`;
  }
  return path === "paperId" ? "paperId" : "";
};

export const paperDraftRepairPaths = (issues = []) => [...new Set(
  (Array.isArray(issues) ? issues : [])
    .map((entry) => normalizedRepairPath(entry?.path))
    .filter(Boolean)
)];

const patchPathParts = (path) => [...String(path || "").matchAll(/([A-Za-z]+)|\[(\d+)\]/g)]
  .map((match) => match[1] || Number(match[2]));

export const valueAtPaperDraftPath = (paperDraft, path) => patchPathParts(path)
  .reduce((current, part) => (current && typeof current === "object" ? current[part] : undefined), paperDraft);

const invalidPatch = (code, path, detail, paperDraft) => ({
  valid: false,
  paperDraft,
  issues: [issue(code, path, detail)]
});

export const applyPaperDraftPatch = ({ paperDraft, issues = [], patchResponse } = {}) => {
  const allowedPaths = new Set(paperDraftRepairPaths(issues));
  const patches = patchResponse?.patches;
  if (!Array.isArray(patches) || !patches.length || patches.length > 20) {
    return invalidPatch(
      "schema_invalid",
      "response",
      "Paper Section repair response must contain 1-20 patches.",
      paperDraft
    );
  }
  const next = structuredClone(paperDraft || {});
  const seenPaths = new Set();
  for (const patch of patches) {
    const path = String(patch?.path || "");
    if (!patch || typeof patch !== "object" || Array.isArray(patch)
      || !Object.hasOwn(patch, "value") || patch.value === undefined) {
      return invalidPatch(
        "schema_invalid",
        path || "response",
        "Each Paper Section patch must contain a path and a complete replacement value.",
        paperDraft
      );
    }
    if (!allowedPaths.has(path)) {
      return invalidPatch(
        "schema_invalid",
        path || "response",
        "Paper Section repair may only change a listed repair path.",
        paperDraft
      );
    }
    if (seenPaths.has(path)) {
      return invalidPatch(
        "schema_invalid",
        path,
        "A Paper Section repair path may occur only once.",
        paperDraft
      );
    }
    seenPaths.add(path);
    const parts = patchPathParts(path);
    let target = next;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (target === null || typeof target !== "object" || !(part in target)) {
        return invalidPatch(
          "schema_invalid",
          path,
          "Paper Section repair path does not exist in the current draft.",
          paperDraft
        );
      }
      target = target[part];
    }
    const finalPart = parts.at(-1);
    if (target === null || typeof target !== "object" || !(finalPart in target)) {
      return invalidPatch(
        "schema_invalid",
        path,
        "Paper Section repair path does not exist in the current draft.",
        paperDraft
      );
    }
    target[finalPart] = patch?.value;
  }
  return { valid: true, paperDraft: next, issues: [] };
};
