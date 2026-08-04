const DEFAULT_STORED_MAX_CHARS = 120000;
const DEFAULT_INPUT_MAX_CHARS = 80000;
const DEFAULT_MIN_CLEAN_CHARS = 4000;
const DEFAULT_MIN_BODY_CHARS = 2500;
const DEFAULT_MIN_PARAGRAPHS = 8;

export const CONTEXT_QUALITY_DEFAULTS = Object.freeze({
  storedMaxChars: DEFAULT_STORED_MAX_CHARS,
  inputMaxChars: DEFAULT_INPUT_MAX_CHARS,
  minCleanChars: DEFAULT_MIN_CLEAN_CHARS,
  minBodyChars: DEFAULT_MIN_BODY_CHARS,
  minParagraphs: DEFAULT_MIN_PARAGRAPHS
});

const BODY_KINDS = new Set([
  "introduction",
  "methodOrTheory",
  "experimentOrEvaluation",
  "resultsOrDiscussion",
  "limitations",
  "conclusion",
  "other"
]);
const SUBSTANTIVE_KINDS = new Set([
  "introduction",
  "methodOrTheory",
  "experimentOrEvaluation",
  "resultsOrDiscussion",
  "limitations",
  "conclusion"
]);
const SECTION_PRIORITY = new Map([
  ["metadata", 0],
  ["methodOrTheory", 1],
  ["experimentOrEvaluation", 2],
  ["resultsOrDiscussion", 3],
  ["limitations", 4],
  ["conclusion", 5],
  ["introduction", 6],
  ["abstract", 7],
  ["other", 8]
]);
const MANDATORY_SECTION_ORDER = [
  "methodOrTheory",
  "experimentOrEvaluation",
  "resultsOrDiscussion",
  "limitations",
  "conclusion",
  "introduction",
  "abstract"
];

const boundedInteger = (value, fallback, minimum, maximum) => {
  const number = Number(value);
  return Math.min(
    Math.max(Number.isFinite(number) ? Math.trunc(number) : fallback, minimum),
    maximum
  );
};

const normalizeWhitespace = (value) => String(value || "")
  .replace(/\u00a0/g, " ")
  .replace(/[ \t]+/g, " ")
  .replace(/\n[ \t]+/g, "\n")
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const decodeHtml = (value) => String(value || "")
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
  .replace(/&nbsp;/gi, " ")
  .replace(/&quot;/gi, "\"")
  .replace(/&apos;|&#39;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&ndash;|&mdash;/gi, "-")
  .replace(/&lsquo;|&rsquo;/gi, "'")
  .replace(/&ldquo;|&rdquo;/gi, "\"")
  .replace(/&amp;/gi, "&")
  .replace(/&[a-z][a-z0-9]+;/gi, " ");

const stripTags = (value) => normalizeWhitespace(decodeHtml(String(value || "")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]+>/g, " ")));

const removeHtmlNoise = (html) => String(html || "")
  .replace(/<!--([\s\S]*?)-->/g, " ")
  .replace(/<(script|style|nav|header|footer|aside|form|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
  .replace(/<(section|div)\b[^>]*(?:ltx_bibliography|ltx_biblist|bibliography)[^>]*>[\s\S]*?<\/\1>/gi, " ");

const classifyHeading = (heading) => {
  const text = normalizeWhitespace(heading).toLowerCase()
    .replace(/^(?:\d+(?:\.\d+)*|[ivxlcdm]+)[.)\s:-]+/i, "")
    .trim();

  if (/\b(references|bibliography|works cited)\b/.test(text)) {
    return "references";
  }
  if (/\b(acknowledg(e)?ments?|funding)\b/.test(text)) {
    return "acknowledgements";
  }
  if (/\b(abstract|summary)\b/.test(text)) {
    return "abstract";
  }
  if (/\b(limitations?|threats? to validity|scope and constraints?)\b/.test(text)) {
    return "limitations";
  }
  if (/\b(conclusions?|concluding remarks?|future work)\b/.test(text)) {
    return "conclusion";
  }
  if (/\b(experiments?|experimental|evaluation|benchmark|implementation|case stud(y|ies)|empirical)\b/.test(text)) {
    return "experimentOrEvaluation";
  }
  if (/\b(results?|discussion|findings?|analysis)\b/.test(text)) {
    return "resultsOrDiscussion";
  }
  if (/\b(methods?|methodology|approach|framework|architecture|system design|model|algorithm|theor(y|etical)|formulation|proposed system)\b/.test(text)) {
    return "methodOrTheory";
  }
  if (/\b(introduction|background|motivation|overview)\b/.test(text)) {
    return "introduction";
  }

  return "other";
};

const looksLikeHeading = (value, index) => {
  const text = normalizeWhitespace(value);

  if (!text || text.length > 180 || text.split(/\s+/).length > 22) {
    return false;
  }

  if (index === 0) {
    return true;
  }

  return classifyHeading(text) !== "other"
    || /^[\divxlcdm]+[.)\s:-]+[a-z]/i.test(text);
};

const htmlBlocks = (html) => {
  const sanitized = removeHtmlNoise(html);
  const blocks = [];
  const pattern = /<(title|h[1-6]|p|li|figcaption|td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = pattern.exec(sanitized))) {
    const text = stripTags(match[2]);

    if (!text) {
      continue;
    }

    blocks.push({
      type: /^(title|h[1-6])$/i.test(match[1]) ? "heading" : "paragraph",
      text
    });
  }

  if (blocks.length) {
    return blocks;
  }

  const fallback = normalizeWhitespace(decodeHtml(sanitized
    .replace(/<\/(?:p|li|section|article|div|tr|h[1-6]|title)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")));
  return plainTextBlocks(fallback);
};

const plainTextBlocks = (text) => normalizeWhitespace(text)
  .split(/\n{2,}/)
  .map((item) => normalizeWhitespace(item))
  .filter(Boolean)
  .map((item, index) => ({
    type: looksLikeHeading(item, index) ? "heading" : "paragraph",
    text: item
  }));

const blocksToSections = (blocks) => {
  const sections = [{
    heading: "",
    kind: "metadata",
    paragraphs: [],
    order: 0
  }];
  let current = sections[0];
  let encounteredPaperSection = false;

  for (const block of blocks) {
    if (block.type === "heading") {
      const classifiedKind = classifyHeading(block.text);
      const kind = classifiedKind === "other" && !encounteredPaperSection
        ? "metadata"
        : classifiedKind;

      if (kind === "references") {
        break;
      }

      if (kind === "abstract" || SUBSTANTIVE_KINDS.has(kind)) {
        encounteredPaperSection = true;
      }

      current = {
        heading: block.text,
        kind,
        paragraphs: [],
        order: sections.length
      };
      sections.push(current);
      continue;
    }

    current.paragraphs.push(block.text);
  }

  return sections.filter((section) => section.heading || section.paragraphs.length);
};

const renderSections = (sections, selectedBySection = null) => {
  const parts = [];

  sections.forEach((section, sectionIndex) => {
    const selected = selectedBySection?.get(sectionIndex);
    const paragraphs = selectedBySection
      ? selected
        ? section.paragraphs.filter((_, paragraphIndex) => selected.has(paragraphIndex))
        : []
      : section.paragraphs;

    if (!paragraphs.length && !(!selectedBySection && section.heading)) {
      return;
    }

    if (section.heading) {
      parts.push(section.heading);
    }
    parts.push(...paragraphs);
  });

  return normalizeWhitespace(parts.join("\n\n"));
};

const selectSectionsWithinBudget = (sections, budget) => {
  const fullText = renderSections(sections);
  const paragraphTotal = sections.reduce((total, section) => total + section.paragraphs.length, 0);

  if (fullText.length <= budget) {
    const selectedBySection = new Map(sections.map((section, sectionIndex) => [
      sectionIndex,
      new Set(section.paragraphs.map((_, paragraphIndex) => paragraphIndex))
    ]));
    return {
      text: fullText,
      truncated: false,
      omittedParagraphCount: 0,
      omittedSections: [],
      selectedBySection
    };
  }

  const selected = new Map();
  let estimatedChars = 0;
  const add = (sectionIndex, paragraphIndex) => {
    const section = sections[sectionIndex];
    const paragraph = section?.paragraphs?.[paragraphIndex];

    if (!paragraph) {
      return false;
    }

    const existing = selected.get(sectionIndex) || new Set();

    if (existing.has(paragraphIndex)) {
      return false;
    }

    const headingCost = existing.size || !section.heading ? 0 : section.heading.length + 2;
    const paragraphCost = paragraph.length + 2;

    if (estimatedChars + headingCost + paragraphCost > budget) {
      return false;
    }

    existing.add(paragraphIndex);
    selected.set(sectionIndex, existing);
    estimatedChars += headingCost + paragraphCost;
    return true;
  };

  sections.forEach((section, sectionIndex) => {
    if (section.kind === "metadata") {
      section.paragraphs.forEach((_, paragraphIndex) => add(sectionIndex, paragraphIndex));
    }
  });

  MANDATORY_SECTION_ORDER.forEach((kind) => {
    sections.forEach((section, sectionIndex) => {
      if (section.kind === kind) {
        add(sectionIndex, 0);
      }
    });
  });

  const rankedSections = sections
    .map((section, sectionIndex) => ({ section, sectionIndex }))
    .filter(({ section }) => !["references", "acknowledgements"].includes(section.kind))
    .sort((a, b) => (
      (SECTION_PRIORITY.get(a.section.kind) ?? 99) - (SECTION_PRIORITY.get(b.section.kind) ?? 99)
      || a.section.order - b.section.order
    ));

  rankedSections.forEach(({ section, sectionIndex }) => {
    section.paragraphs.forEach((_, paragraphIndex) => add(sectionIndex, paragraphIndex));
  });

  const text = renderSections(sections, selected);
  const selectedCount = [...selected.values()].reduce((total, indexes) => total + indexes.size, 0);
  const omittedSections = sections
    .filter((section, sectionIndex) => section.paragraphs.length && !selected.has(sectionIndex))
    .map((section) => section.heading || section.kind);

  return {
    text: text.length > budget ? text.slice(0, budget).trimEnd() : text,
    truncated: true,
    omittedParagraphCount: Math.max(0, paragraphTotal - selectedCount),
    omittedSections,
    selectedBySection: selected
  };
};

const validArxivHtmlUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return /(^|\.)arxiv\.org$/i.test(url.hostname) && /^\/html\//i.test(url.pathname);
  } catch {
    return false;
  }
};

const isAbstractUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return /(^|\.)arxiv\.org$/i.test(url.hostname) && /^\/abs\//i.test(url.pathname);
  } catch {
    return false;
  }
};

const errorPageDetected = (raw, cleanText) => {
  const text = `${String(raw || "").slice(0, 3000)}\n${String(cleanText || "").slice(0, 1500)}`.toLowerCase();
  return /\b(404 not found|page not found|internal server error|service unavailable|access denied|captcha)\b/.test(text);
};

const sectionFlags = (sections) => ({
  introduction: sections.some((section) => section.kind === "introduction"),
  methodOrTheory: sections.some((section) => section.kind === "methodOrTheory"),
  experimentOrEvaluation: sections.some((section) => section.kind === "experimentOrEvaluation"),
  resultsOrDiscussion: sections.some((section) => section.kind === "resultsOrDiscussion"),
  limitations: sections.some((section) => section.kind === "limitations"),
  conclusion: sections.some((section) => section.kind === "conclusion")
});

const basePacket = ({ paperId, source, url, rawChars }) => ({
  paperId: String(paperId || "").trim(),
  source: String(source || "").trim(),
  status: "unavailable",
  url: String(url || "").trim(),
  rawChars,
  cleanChars: 0,
  storedChars: 0,
  inputChars: 0,
  bodyChars: 0,
  paragraphCount: 0,
  sections: {
    introduction: false,
    methodOrTheory: false,
    experimentOrEvaluation: false,
    resultsOrDiscussion: false,
    limitations: false,
    conclusion: false
  },
  sectionDetails: [],
  inputSections: [],
  cleanText: "",
  inputText: "",
  truncated: false,
  truncation: {
    storedMaxChars: DEFAULT_STORED_MAX_CHARS,
    inputMaxChars: DEFAULT_INPUT_MAX_CHARS,
    omittedParagraphCount: 0,
    omittedSections: []
  },
  qualityGate: {
    passed: false,
    reasons: [],
    checks: {},
    thresholds: {}
  },
  warnings: [],
  compatibility: {
    legacyOriginalText: false
  }
});

export const buildContextPacket = ({
  paperId,
  source,
  url,
  httpStatus = 200,
  contentType = "",
  html = "",
  text = "",
  compatibility
} = {}, options = {}) => {
  const storedMaxChars = boundedInteger(options.storedMaxChars, DEFAULT_STORED_MAX_CHARS, 4000, 200000);
  const inputMaxChars = Math.min(
    storedMaxChars,
    boundedInteger(options.inputMaxChars, DEFAULT_INPUT_MAX_CHARS, 2500, 120000)
  );
  const minCleanChars = boundedInteger(options.minCleanChars, DEFAULT_MIN_CLEAN_CHARS, 500, 30000);
  const minBodyChars = boundedInteger(options.minBodyChars, DEFAULT_MIN_BODY_CHARS, 500, 25000);
  const minParagraphs = boundedInteger(options.minParagraphs, DEFAULT_MIN_PARAGRAPHS, 3, 100);
  const raw = String(html || text || "");
  const packet = basePacket({ paperId, source, url, rawChars: raw.length });
  packet.compatibility = {
    ...packet.compatibility,
    ...(compatibility && typeof compatibility === "object" ? compatibility : {})
  };
  packet.truncation.storedMaxChars = storedMaxChars;
  packet.truncation.inputMaxChars = inputMaxChars;
  const blockingUnavailable = new Set();
  const reasons = new Set();
  const sourceValid = source === "arxiv-html";

  if (!sourceValid) {
    blockingUnavailable.add("source_not_arxiv_html");
  }

  const numericHttpStatus = Number(httpStatus);
  const httpValid = Number.isFinite(numericHttpStatus) && numericHttpStatus >= 200 && numericHttpStatus < 300;
  if (!httpValid) {
    blockingUnavailable.add("http_unavailable");
  }

  const normalizedContentType = String(contentType || "").trim().toLowerCase();
  const contentTypeValid = !normalizedContentType || /(?:text\/html|application\/xhtml\+xml)/.test(normalizedContentType);
  if (!contentTypeValid) {
    blockingUnavailable.add("invalid_content_type");
  }

  const abstractPage = isAbstractUrl(url);
  const arxivHtmlUrlValid = validArxivHtmlUrl(url);
  if (abstractPage) {
    reasons.add("abstract_page_detected");
  } else if (!arxivHtmlUrlValid) {
    blockingUnavailable.add("invalid_arxiv_html_url");
  }

  const blocks = html ? htmlBlocks(html) : plainTextBlocks(text);
  const sections = blocksToSections(blocks);
  const fullCleanText = renderSections(sections);
  const firstBodySection = sections.findIndex((section) => SUBSTANTIVE_KINDS.has(section.kind));
  const bodySections = (firstBodySection >= 0 ? sections.slice(firstBodySection) : [])
    .filter((section) => BODY_KINDS.has(section.kind));
  const bodyText = renderSections(bodySections);
  const bodyParagraphs = bodySections.reduce((total, section) => total + section.paragraphs.length, 0);
  const flags = sectionFlags(sections);

  const hasErrorPage = errorPageDetected(raw, fullCleanText);
  if (hasErrorPage) {
    blockingUnavailable.add("error_page_detected");
  }
  if (fullCleanText.length < minCleanChars) {
    reasons.add("clean_text_too_short");
  }
  if (bodyText.length < minBodyChars) {
    reasons.add("body_text_too_short");
  }
  if (bodyParagraphs < minParagraphs) {
    reasons.add("insufficient_body_paragraphs");
  }
  if (!flags.methodOrTheory) {
    reasons.add("missing_method_or_theory_section");
  }

  const stored = selectSectionsWithinBudget(sections, storedMaxChars);
  const input = selectSectionsWithinBudget(sections, inputMaxChars);
  packet.cleanChars = fullCleanText.length;
  packet.storedChars = stored.text.length;
  packet.inputChars = input.text.length;
  packet.bodyChars = bodyText.length;
  packet.paragraphCount = bodyParagraphs;
  packet.sections = flags;
  packet.sectionDetails = sections.map((section) => ({
    anchor: `S${section.order}`,
    heading: section.heading,
    kind: section.kind,
    paragraphCount: section.paragraphs.length,
    chars: renderSections([section]).length
  }));
  packet.inputSections = sections.flatMap((section, sectionIndex) => {
    const selected = input.selectedBySection.get(sectionIndex);

    if (!selected?.size) {
      return [];
    }

    const text = renderSections([section], new Map([[0, selected]]));
    return text ? [{
      anchor: `S${section.order}`,
      heading: section.heading,
      kind: section.kind,
      paragraphCount: selected.size,
      text
    }] : [];
  });
  packet.cleanText = stored.text;
  packet.inputText = input.text;
  packet.truncated = stored.truncated || input.truncated;
  packet.truncation = {
    storedMaxChars,
    inputMaxChars,
    rawChars: packet.rawChars,
    cleanChars: packet.cleanChars,
    storedChars: packet.storedChars,
    inputChars: packet.inputChars,
    omittedParagraphCount: input.omittedParagraphCount,
    omittedSections: input.omittedSections
  };

  if (!flags.experimentOrEvaluation) {
    packet.warnings.push("experiment_or_evaluation_not_detected");
  }

  const allReasons = [...blockingUnavailable, ...reasons];
  packet.qualityGate = {
    passed: allReasons.length === 0,
    reasons: allReasons,
    checks: {
      sourceValid,
      httpValid,
      contentTypeValid,
      arxivHtmlUrlValid,
      notAbstractPage: !abstractPage,
      notErrorPage: !hasErrorPage,
      cleanTextLongEnough: fullCleanText.length >= minCleanChars,
      bodyTextLongEnough: bodyText.length >= minBodyChars,
      enoughBodyParagraphs: bodyParagraphs >= minParagraphs,
      methodOrTheoryPresent: flags.methodOrTheory
    },
    thresholds: {
      minCleanChars,
      minBodyChars,
      minParagraphs
    }
  };
  packet.status = blockingUnavailable.size
    ? "unavailable"
    : reasons.size
      ? "insufficient_full_text"
      : "available";
  return packet;
};

export const buildContextPacketFromLegacyPaper = (paper = {}, options = {}) => {
  const originalText = paper.originalText && typeof paper.originalText === "object"
    ? paper.originalText
    : {};

  if (originalText.status !== "available") {
    const packet = buildContextPacket({
      paperId: paper.id || paper.absLink || paper.link,
      source: originalText.source,
      url: originalText.url,
      httpStatus: 503,
      text: "",
      compatibility: { legacyOriginalText: true }
    }, options);
    packet.qualityGate.reasons = [
      "legacy_original_text_unavailable",
      ...packet.qualityGate.reasons.filter((reason) => reason !== "clean_text_too_short")
    ];
    return packet;
  }

  return buildContextPacket({
    paperId: paper.id || paper.absLink || paper.link,
    source: originalText.source,
    url: originalText.url,
    httpStatus: 200,
    text: originalText.text || originalText.excerpt || "",
    compatibility: { legacyOriginalText: true }
  }, options);
};

const paperId = (paper = {}, fallback = "") => String(
  paper.id || paper.absLink || paper.link || fallback
).trim();

const normalizedPaperId = (value) => {
  const text = String(value || "").trim().toLowerCase();
  const arxivMatch = text.match(/(?:^|\/)(\d{4}\.\d{4,5})(?:v\d+)?(?:$|[?#/])/i);
  return arxivMatch?.[1] || text.replace(/v\d+$/i, "");
};

const abortError = () => {
  const error = new Error("Weekly report prepare_context was cancelled.");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
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

  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  ));
  return results;
};

export const prepareContextCandidates = async ({
  primaryCandidates = [],
  reserveCandidates = [],
  minEligibleCount = 3,
  paperConcurrency = 2,
  buildContext = (paper) => buildContextPacketFromLegacyPaper(paper),
  signal,
  onEvent
} = {}) => {
  const primary = Array.isArray(primaryCandidates) ? primaryCandidates : [];
  const reserve = Array.isArray(reserveCandidates) ? reserveCandidates : [];
  const target = Math.max(1, Math.trunc(Number(minEligibleCount) || 3));
  const concurrency = boundedInteger(paperConcurrency, 2, 1, 5);
  const eligible = [];
  const excluded = [];
  const events = [];
  let reserveAttempted = 0;

  const record = async (event) => {
    events.push(event);
    if (typeof onEvent === "function") {
      await onEvent(event);
    }
  };

  const runBatch = async (papers, origin, offset = 0) => {
    if (signal?.aborted) {
      throw abortError();
    }

    const results = await mapWithConcurrency(papers, concurrency, async (paper, index) => {
      if (signal?.aborted) {
        throw abortError();
      }

      try {
        const contextPacket = await buildContext(paper, {
          signal,
          origin,
          index: offset + index
        });
        const expectedPaperId = normalizedPaperId(paperId(paper));
        const actualPaperId = normalizedPaperId(contextPacket?.paperId);

        if (expectedPaperId && actualPaperId && expectedPaperId !== actualPaperId) {
          return {
            paper,
            origin,
            contextPacket: {
              ...contextPacket,
              status: "unavailable",
              qualityGate: {
                ...(contextPacket?.qualityGate || {}),
                passed: false,
                reasons: [
                  ...new Set([
                    ...(Array.isArray(contextPacket?.qualityGate?.reasons) ? contextPacket.qualityGate.reasons : []),
                    "context_paper_id_mismatch"
                  ])
                ]
              }
            }
          };
        }

        return { paper, contextPacket, origin };
      } catch (error) {
        if (error?.name === "AbortError" || signal?.aborted) {
          throw abortError();
        }

        return {
          paper,
          origin,
          contextPacket: {
            paperId: paperId(paper, `${origin}-${offset + index}`),
            status: "unavailable",
            qualityGate: {
              passed: false,
              reasons: ["context_builder_failed"]
            }
          },
          error: {
            code: String(error?.code || "READING_LIST_CONTEXT_FAILED"),
            message: String(error?.message || "Could not build contextPacket.")
          }
        };
      }
    });

    for (const item of results) {
      const passed = item.contextPacket?.status === "available"
        && item.contextPacket?.qualityGate?.passed === true;
      const event = {
        type: passed ? "context_accepted" : "context_excluded",
        stage: "prepare_context",
        paperId: paperId(item.paper, item.contextPacket?.paperId),
        origin,
        status: item.contextPacket?.status || "unavailable",
        reasons: Array.isArray(item.contextPacket?.qualityGate?.reasons)
          ? item.contextPacket.qualityGate.reasons
          : ["invalid_context_packet"]
      };

      if (passed) {
        eligible.push(item);
      } else {
        excluded.push(item);
      }
      await record(event);
    }
  };

  await runBatch(primary, "primary");

  while (eligible.length < target && reserveAttempted < reserve.length) {
    const needed = target - eligible.length;
    const batchSize = Math.min(concurrency, needed, reserve.length - reserveAttempted);
    const batch = reserve.slice(reserveAttempted, reserveAttempted + batchSize);
    await runBatch(batch, "reserve", reserveAttempted);
    reserveAttempted += batch.length;
  }

  return {
    eligible,
    excluded,
    events,
    primaryAttempted: primary.length,
    reserveAttempted,
    reserveRemaining: Math.max(0, reserve.length - reserveAttempted),
    targetEligibleCount: target,
    underTarget: eligible.length < target,
    outcome: eligible.length ? "continue" : "reject",
    reason: eligible.length ? "" : "READING_LIST_NO_ELIGIBLE_PAPERS"
  };
};
