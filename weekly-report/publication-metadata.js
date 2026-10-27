import { load } from "cheerio";

const normalizeText = (value) => String(value || "")
  .replace(/\u00a0/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const EMAIL_PATTERN = /(?:\{[^{}]+\}|[\w.+-]+)@[\w.-]+\.[A-Za-z]{2,}/u;
const EMAILS_PATTERN = /(?:\{[^{}]+\}|[\w.+-]+)@[\w.-]+\.[A-Za-z]{2,}/gu;
const INSTITUTION_PATTERN = /\b(?:University|Institute|School|College|Laboratory|Research Centre|Research Center)\b/iu;
const ORGANIZATION_HINT_PATTERN = /\b(?:University|Institute|School|College|Laboratory|Labs?|Centre|Center|Department|Faculty|Foundation|Researcher|Technologies|Technology|Securities|Corporation|Company|Group|AI|Inc\.?|Ltd\.?)\b/iu;
const PERSON_NAME_PATTERN = /^(?:[A-Z][\p{L}'’.-]*\.?\s+){1,5}[A-Z][\p{L}'’.-]*\.?$/u;

const STANDALONE_AUTHOR_NOTE_PATTERN = /^(?:Co-last\s+and\s+co-corresponding authors?|Co-corresponding authors?|Corresponding authors?)\b/iu;

const closeTrailingAcronym = (value) => (
  /\([A-Z][A-Z0-9-]{1,15}$/u.test(value) ? `${value})` : value
);
const looksLikeAuthorList = (value) => {
  const normalized = normalizeText(value);
  if (!normalized || ORGANIZATION_HINT_PATTERN.test(normalized)) return false;
  const names = normalized
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/iu)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return names.length >= 2 && names.every((entry) => PERSON_NAME_PATTERN.test(entry));
};


const cleanAffiliationName = (value) => {
  const normalized = normalizeText(value);
  if (STANDALONE_AUTHOR_NOTE_PATTERN.test(normalized)) return "";

  const cleaned = normalized
    .replace(/^Affiliation\s*:\s*/iu, "")
    .replace(/^.*?thanks:\s*/iu, "")
    .replace(/^The authors are with\s+(?:the\s+)?/iu, "")
    .replace(/^.+?\s+is with\s+(?:the\s+)?(?=(?:Department|Faculty|School|College|Institute|University|Laboratory)\b)/iu, "")
    .replace(/^.+?\s+are with\s+(?:the\s+)?(?=(?:Department|Faculty|School|College|Institute|University|Laboratory|National)\b)/iu, "")
    .replace(/\s*[*†]?\s*Corresponding authors?\b[\s\S]*$/iu, "")
    .replace(/\.\s*A shorter version\b[\s\S]*$/iu, "")
    .replace(/\(\s*(?:e-?mails?|emails?)\s*:[^)]*\)/giu, "")
    .replace(/\(\s*(?:e-?mails?|emails?)\s*(?::[\s\S]*)?$/iu, "")
    .replace(EMAILS_PATTERN, "")
    .replace(/\s+E-?mail\s*:?\s*$/iu, "")
    .replace(/^\s*(?:\d+|[†*#])\s*/u, "")
    .replace(/[\s,;:.()-]+$/gu, "")
    .trim();

  if (looksLikeAuthorList(cleaned)) return "";
  return closeTrailingAcronym(cleaned);
};

const splitNarrativeAffiliationNames = (value) => normalizeText(value)
  .split(/\s*,?\s+and also with\s+(?:the\s+)?/iu)
  .map(cleanAffiliationName)
  .filter(Boolean);

export const splitNumberedAffiliationNames = (value) => {
  const text = normalizeText(value);
  const parts = text.split(/\s+(?=\d{1,2}\p{Lu})/u);
  const numbered = parts.length > 1 && parts.every((part, index) => {
    const marker = part.match(/^(\d{1,2})(?=\p{Lu})/u)?.[1];
    return index === 0 ? !marker || Number(marker) === 1 : Number(marker) === index + 1;
  });
  return numbered
    ? parts.map((part) => part.replace(/^\d{1,2}(?=\p{Lu})/u, ""))
    : [text];
};

const splitStructuredAffiliationNames = (value) => normalizeText(value)
  .replace(/\bDesign(?=Technical University\b)/u, "Design;")
  .split(/\s*;\s*/u)
  .flatMap(splitNumberedAffiliationNames)
  .map(cleanAffiliationName)
  .filter(Boolean);

const emptyMetadata = (status = "not_provided", warnings = []) => ({
  status,
  affiliations: [],
  warnings
});

const affiliationRecord = ({
  originalName,
  sourceText,
  sourceType,
  confidence
}) => ({
  originalName: normalizeText(originalName),
  sourceText: normalizeText(sourceText),
  sourceType,
  confidence
});

const deduplicateAffiliations = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.originalName.toLocaleLowerCase("en-US");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const isAbstractSection = ($, element) => {
  const section = $(element);
  if (section.hasClass("ltx_abstract")) return true;
  const heading = normalizeText(section.find("h1, h2, h3, h4, h5, h6").first().text());
  return /^abstract\b/iu.test(heading);
};

const titleFrontmatterCandidatePredicate = ($) => {
  const elements = $("*").toArray();
  const order = new Map(elements.map((element, index) => [element, index]));
  const firstBodySection = $("section").toArray()
    .find((element) => !isAbstractSection($, element));
  const bodyStart = firstBodySection ? order.get(firstBodySection) : Number.POSITIVE_INFINITY;

  return (element) => (
    $(element).parents("section").length === 0
    && order.has(element)
    && order.get(element) < bodyStart
  );
};

export const extractArxivPublicationMetadata = (html) => {
  const source = String(html || "");
  if (!source.trim()) return emptyMetadata();

  try {
    const $ = load(source);
    const affiliations = [];
    const isTitleFrontmatterCandidate = titleFrontmatterCandidatePredicate($);
    const knownAuthorNames = new Set($(".ltx_authors .ltx_personname").toArray()
      .filter((element) => isTitleFrontmatterCandidate(element))
      .map((element) => normalizeText($(element).text()).toLocaleLowerCase("en-US"))
      .filter(Boolean));


    $(".ltx_contact.ltx_role_affiliation").each((_, element) => {
      if (!isTitleFrontmatterCandidate(element)) return;
      const sourceText = normalizeText($(element).text());
      const copy = $(element).clone();
      copy.find(".ltx_contact_name").remove();
      splitStructuredAffiliationNames(copy.text()).forEach((originalName) => {
        if (knownAuthorNames.has(originalName.toLocaleLowerCase("en-US"))) {
          return;
        }
        affiliations.push(affiliationRecord({
          originalName,
          sourceText,
          sourceType: "arxiv_structured",
          confidence: "high"
        }));
      });
    });

    if (!affiliations.length) {
      $(".ltx_authors .ltx_note_frontmatter, .ltx_authors .ltx_role_thanks").each((_, element) => {
        if (!isTitleFrontmatterCandidate(element)) return;
        const sourceText = normalizeText($(element).text());
        if (!INSTITUTION_PATTERN.test(sourceText)) {
          return;
        }
        splitNarrativeAffiliationNames(sourceText).forEach((originalName) => {
          affiliations.push(affiliationRecord({
            originalName,
            sourceText,
            sourceType: "arxiv_frontmatter_note",
            confidence: "medium"
          }));
        });
      });
    }

    if (!affiliations.length) {
      $(".ltx_logical-block, .ltx_para.ltx_align_bottom").each((_, element) => {
        if (!isTitleFrontmatterCandidate(element)) return;
        const sourceText = normalizeText($(element).text());
        const hasContact = EMAIL_PATTERN.test(sourceText);
        const hasInstitution = INSTITUTION_PATTERN.test(sourceText);
        if (!hasContact && !hasInstitution) return;

        $(element).find("p").each((__, paragraph) => {
          const copy = $(paragraph).clone();
          copy.find("sup").replaceWith(" · ");
          const text = normalizeText(copy.text());
          if (!text || text.includes("@")) return;
          text.split(/\s*[·•;]\s*/u).forEach((candidate) => {
            const originalName = cleanAffiliationName(candidate);
            if (!originalName || originalName.length > 240) return;
            affiliations.push(affiliationRecord({
              originalName,
              sourceText,
              sourceType: "arxiv_frontmatter_block",
              confidence: "medium"
            }));
          });
        });
      });
    }

    if (!affiliations.length) {
      $(".ltx_ERROR").each((_, element) => {
        if (!isTitleFrontmatterCandidate(element)) return;
        const container = $(element).closest("p, .ltx_para, .ltx_logical-block");
        const sourceText = normalizeText((container.length ? container : $(element)).text());
        const matches = sourceText.match(/(?:[A-Z][A-Za-z&'’.()-]*\s+){1,8}(?:University|Institute|College|School|Laboratory)(?=\b|[a-z0-9._%+-]*@)/gu) || [];
        matches.forEach((originalName) => {
          affiliations.push(affiliationRecord({
            originalName: cleanAffiliationName(originalName),
            sourceText,
            sourceType: "arxiv_frontmatter_recovery",
            confidence: "medium"
          }));
        });
      });
    }

    const unique = deduplicateAffiliations(affiliations);
    return {
      status: unique.length ? "extracted" : "not_provided",
      affiliations: unique,
      warnings: []
    };
  } catch {
    return emptyMetadata("parse_failed", ["publication_metadata_parse_failed"]);
  }
};

export const normalizePublicationMetadata = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyMetadata();
  const status = ["extracted", "not_provided", "parse_failed"].includes(value.status)
    ? value.status
    : "parse_failed";
  const affiliations = deduplicateAffiliations((Array.isArray(value.affiliations)
    ? value.affiliations
    : []).flatMap((item) => splitNarrativeAffiliationNames(item?.originalName)
      .map((originalName) => affiliationRecord({
        originalName,
        sourceText: item?.sourceText,
        sourceType: String(item?.sourceType || "cached"),
        confidence: String(item?.confidence || "medium")
      }))).filter((item) => item.originalName));
  return {
    status: affiliations.length
      ? "extracted"
      : status === "extracted" ? "not_provided" : status,
    affiliations,
    warnings: Array.isArray(value.warnings) ? value.warnings.map(String).slice(0, 20) : []
  };
};
const normalizedAffiliationKey = (value) => normalizeText(value)
  .replace(/[.,;:，。；：]+$/u, "");

const NARRATIVE_AFFILIATION_EVIDENCE_PATTERN = /\b(?:thanks|authors?|e-?mails?|emails?|corresponding\s+authors?|supported\s+by)\b|@/iu;
const AFFILIATION_SENTENCE_SUBJECT_PATTERN = /^(?:the\s+)?(?:authors?|we|this\s+work|the\s+work|our\s+work)\b/iu;
const AFFILIATION_RELATION_PATTERN = /\b(?:is|are|was|were)\s+(?:with|from|affiliated|based|located|conducted|performed)\b|\b(?:conducted|performed|carried\s+out)\s+(?:at|by|in)\b/iu;
const ORGANIZATION_NAME_CONNECTORS = new Set(["of", "and", "for", "the", "at", "in", "on"]);

const hasOrganizationNameTokens = (value, connectors) => value
  .replace(/[(),.;:]/gu, " ")
  .split(/\s+/u)
  .filter(Boolean)
  .every((token) => (
    connectors.has(token.toLocaleLowerCase("en-US"))
    || /[\p{Lu}\d]/u.test(token)
  ));

const hasOrganizationBrandPrefix = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  if (/[,;:()[\]{}—–]/u.test(normalized)) return false;
  const tokens = normalized.split(/\s+/u).filter(Boolean);
  if (tokens[0]?.toLocaleLowerCase("en-US") === "the") tokens.shift();
  return tokens.length <= 2 && tokens.every((token) => /[\p{Lu}\d]/u.test(token));
};

const hasStandaloneOrganizationSyntax = (candidate, organizationMatch) => {
  const prefixBeforeOrganization = candidate.slice(0, organizationMatch.index);
  return hasOrganizationBrandPrefix(prefixBeforeOrganization)
    && hasOrganizationNameTokens(candidate, ORGANIZATION_NAME_CONNECTORS);
};

const standaloneAffiliationOriginal = (value) => {
  const candidate = normalizeText(value);
  const organizationMatch = candidate.match(ORGANIZATION_HINT_PATTERN);

  if (!candidate
    || candidate.length > 300
    || !/[A-Za-z]/u.test(candidate)
    || !organizationMatch
    || NARRATIVE_AFFILIATION_EVIDENCE_PATTERN.test(candidate)
    || AFFILIATION_SENTENCE_SUBJECT_PATTERN.test(candidate)
    || AFFILIATION_RELATION_PATTERN.test(candidate)
    || !hasStandaloneOrganizationSyntax(candidate, organizationMatch)) {
    return "";
  }
  return candidate;
};

export const resolveAuthoritativeAffiliations = ({
  publicationMetadata,
  evidenceSources = []
} = {}) => {
  const sources = Array.isArray(evidenceSources) ? evidenceSources : [];
  const seen = new Set();
  const records = [];
  const add = (originalName, evidenceRef) => {
    const normalized = normalizeText(originalName);
    const key = normalizedAffiliationKey(normalized);
    if (!key || !/[A-Za-z]/u.test(normalized) || seen.has(key)) return;
    seen.add(key);
    records.push({ originalName: normalized, evidenceRef });
  };
  const metadataAffiliations = normalizePublicationMetadata(publicationMetadata).affiliations;
  if (metadataAffiliations.length) {
    metadataAffiliations.forEach((entry) => {
      const originalName = normalizeText(entry?.originalName);
      const key = normalizedAffiliationKey(originalName).toLocaleLowerCase("en-US");
      const sourceIndex = sources.findIndex((source) => (
        normalizeText(source?.originalName || source?.excerpt)
          .toLocaleLowerCase("en-US")
          .includes(key)
      ));
      add(originalName, `affiliations:${sourceIndex >= 0 ? sourceIndex : 0}`);
    });
    return records;
  }

  sources.forEach((source, index) => {
    const explicitOriginal = standaloneAffiliationOriginal(source?.originalName);
    if (explicitOriginal) {
      add(explicitOriginal, `affiliations:${index}`);
      return;
    }
    const excerpt = normalizeText(source?.excerpt);
    const labeled = [...excerpt.matchAll(/(?:^|\s)Original institution:\s*(.+?)(?=\s+Source:|$)/giu)]
      .map((match) => standaloneAffiliationOriginal(match[1]))
      .filter(Boolean);
    if (labeled.length) {
      labeled.forEach((originalName) => add(originalName, `affiliations:${index}`));
      return;
    }
    add(standaloneAffiliationOriginal(excerpt), `affiliations:${index}`);
  });
  return records;
};
