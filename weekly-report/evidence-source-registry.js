const DEFAULT_MAX_UNIT_CHARS = 1_200;
const MIN_UNIT_CHARS = 200;
const MAX_UNIT_CHARS = 4_000;

const normalizedPaperId = (value) => {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/(?:^|\/)(\d{4}\.\d{4,5})(?:v\d+)?(?:$|[?#/])/i);
  return match?.[1] || text.replace(/v\d+$/i, "");
};

const boundedUnitChars = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_UNIT_CHARS;
  return Math.min(MAX_UNIT_CHARS, Math.max(MIN_UNIT_CHARS, Math.trunc(parsed)));
};

export const readableEvidenceSourceText = (value) => {
  let text = String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\\%/g, "%")
    .replace(/\\[()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let previous;
  do {
    previous = text;
    text = text
      .replace(/\b(\d+(?:[.,]\d+)?)\s+\1\b/gu, "$1")
      .replace(/\b(\d+(?:[.,]\d+)?)\s*%\s+\1\s*%/gu, "$1%");
  } while (text !== previous);

  return text;
};

const splitExactSourceText = (value, requestedMaxChars) => {
  const source = String(value || "");
  const maxChars = boundedUnitChars(requestedMaxChars);
  const chunks = [];
  let start = 0;

  while (start < source.length) {
    while (start < source.length && /\s/u.test(source[start])) start += 1;
    if (start >= source.length) break;

    let end = Math.min(source.length, start + maxChars);
    if (end < source.length) {
      const minimumBoundary = start + Math.floor(maxChars * 0.55);
      let selected = -1;
      for (let cursor = end; cursor >= minimumBoundary; cursor -= 1) {
        const before = source[cursor - 1] || "";
        const after = source[cursor] || "";
        if ((/[.!?。！？;；]/u.test(before) && /\s/u.test(after))
          || (before === "\n" && after === "\n")) {
          selected = cursor;
          break;
        }
      }
      if (selected < 0) {
        for (let cursor = end; cursor >= minimumBoundary; cursor -= 1) {
          if (/\s/u.test(source[cursor] || "")) {
            selected = cursor;
            break;
          }
        }
      }
      if (selected > start) end = selected;
    }

    const rawText = source.slice(start, end).trim();
    if (rawText) chunks.push(rawText);
    start = end;
  }

  return chunks;
};

const normalizedAnchor = (value, index) => {
  const raw = String(value || `S${index}`).trim();
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, "_");
  return safe || `S${index}`;
};

export const buildEvidenceSourceRegistry = (
  contextPacket = {},
  { maxUnitChars = DEFAULT_MAX_UNIT_CHARS } = {}
) => {
  const paperId = normalizedPaperId(contextPacket?.paperId);
  if (!paperId) {
    throw new TypeError("Evidence source registry requires paperId.");
  }
  const sections = [];
  const byId = new Map();

  for (const [sectionIndex, input] of (Array.isArray(contextPacket?.inputSections)
    ? contextPacket.inputSections
    : []).entries()) {
    const anchor = normalizedAnchor(input?.anchor, sectionIndex);
    const section = String(input?.heading || anchor).trim() || anchor;
    const kind = String(input?.kind || "").trim();
    const units = splitExactSourceText(input?.text, maxUnitChars).map((rawText, unitIndex) => {
      const sourceId = `${paperId}:${anchor}:U${String(unitIndex).padStart(3, "0")}`;
      const unit = {
        sourceId,
        anchor,
        section,
        kind,
        rawText,
        text: readableEvidenceSourceText(rawText)
      };
      byId.set(sourceId, unit);
      return unit;
    });
    sections.push({ anchor, heading: section, kind, units });
  }

  return { paperId, sections, byId };
};

const materializedSource = (source, registry, { allowLegacySources = false } = {}) => {
  if (!source || typeof source !== "object" || Array.isArray(source)) return source;
  const sourceId = String(source.sourceId || "").trim();
  if (!sourceId) {
    if (allowLegacySources) return source;
    throw new TypeError("Evidence model response source must use sourceId.");
  }

  const forbiddenKeys = ["section", "anchor", "excerpt", "rawExcerpt", "text", "rawText"]
    .filter((key) => Object.hasOwn(source, key));
  if (forbiddenKeys.length) {
    throw new TypeError(`Evidence sourceId cannot include model-supplied ${forbiddenKeys.join(", ")}.`);
  }
  if (!sourceId.startsWith(`${registry.paperId}:`)) {
    throw new TypeError(`Evidence sourceId does not belong to the current paper: ${sourceId}`);
  }
  const unit = registry.byId.get(sourceId);
  if (!unit) {
    throw new TypeError(`Evidence response contains unknown sourceId: ${sourceId}`);
  }
  return {
    sourceId,
    anchor: unit.anchor,
    section: unit.section,
    excerpt: unit.text,
    rawExcerpt: unit.rawText
  };
};

const materializeCardFields = (card, registry, options) => {
  if (!card || typeof card !== "object" || Array.isArray(card)) return;
  for (const field of Object.values(card)) {
    if (!field || typeof field !== "object" || Array.isArray(field) || !Array.isArray(field.sources)) continue;
    field.sources = field.sources.map((source) => materializedSource(source, registry, options));
  }
};

export const materializeEvidenceSources = (value, registry, {
  allowLegacySources = false
} = {}) => {
  if (!registry?.paperId || !(registry?.byId instanceof Map)) {
    throw new TypeError("A valid Evidence source registry is required.");
  }
  const result = structuredClone(value);
  const options = { allowLegacySources };
  materializeCardFields(result, registry, options);
  materializeCardFields(result?.evidenceCard, registry, options);
  materializeCardFields(result?.patch, registry, options);
  return result;
};
