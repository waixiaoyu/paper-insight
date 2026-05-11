import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const publicRoot = publicDir.endsWith(sep) ? publicDir : `${publicDir}${sep}`;
const port = Number(process.env.PORT || 3000);
const arxivCacheDir = join(__dirname, ".cache", "arxiv");
const arxivMinIntervalMs = Number(process.env.ARXIV_MIN_INTERVAL_MS || 3500);
const arxivFreshCacheMs = Number(process.env.ARXIV_CACHE_TTL_MS || 30 * 60 * 1000);
const arxivStaleCacheMs = Number(process.env.ARXIV_STALE_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const arxivCooldownMs = Number(process.env.ARXIV_429_COOLDOWN_MS || 10 * 60 * 1000);
const arxivMemoryCache = new Map();
const arxivInflight = new Map();
const paperRequestStatuses = new Map();
let arxivQueue = Promise.resolve();
let arxivLastRequestAt = 0;
let arxivBlockedUntil = 0;

const defaultQuery = `("network" OR "telecom" OR "5G" OR "6G") AND
("AI" OR "machine learning" OR "deep learning" OR "LLM" OR "large language model" OR "foundation model") AND
("anomaly detection" OR "traffic prediction" OR "network optimization" OR "root cause analysis" OR
"digital twin network" OR "intent-based networking" OR "network automation" OR "orchestration" OR
"multi-agent" OR "AI agent" OR "autonomous agent" OR "agent-based system")`;

const dimensions = [
  { key: "domainFit", label: "网络相关", weight: 0.22 },
  { key: "aiFit", label: "AI相关", weight: 0.2 },
  { key: "taskFit", label: "场景相关", weight: 0.23 },
  { key: "novelty", label: "新颖性信号", weight: 0.12 },
  { key: "practicalValue", label: "工程价值", weight: 0.15 },
  { key: "evidence", label: "证据强度", weight: 0.08 }
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, headers);
  response.end(body);
};

const sendJson = (response, status, payload, headers = {}) => {
  send(response, status, JSON.stringify(payload), {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const truncate = (value, length = 2200) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}...` : text;
};

const escapeXml = (value) => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

const redactSensitive = (value) => String(value || "")
  .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-api-key]")
  .replace(/Your api key:\s*[^",}]+/gi, "Your api key: [redacted]");

const readResponseReturnValue = async (source, fetchResponse, bodyLength = 900) => {
  let body = "";

  try {
    body = await fetchResponse.text();
  } catch (error) {
    body = `无法读取返回体：${error.message}`;
  }

  return {
    source,
    url: fetchResponse.url,
    status: fetchResponse.status,
    statusText: fetchResponse.statusText || "",
    retryAfter: fetchResponse.headers.get("retry-after") || "",
    contentType: fetchResponse.headers.get("content-type") || "",
    body: truncate(redactSensitive(body), bodyLength)
  };
};

const describeResponseReturnValue = (value) => {
  if (!value) {
    return "";
  }

  const status = [value.status, value.statusText].filter(Boolean).join(" ");
  const parts = [
    `${value.source || "数据源"} 返回 ${status || "未知状态"}`,
    value.retryAfter ? `Retry-After=${value.retryAfter}` : "",
    value.contentType ? `Content-Type=${value.contentType}` : "",
    value.body ? `Body=${value.body}` : ""
  ].filter(Boolean);

  return parts.join("，");
};

const responseReturnHeader = (value) => {
  const text = truncate(describeResponseReturnValue(value), 900);
  return text ? encodeURIComponent(text) : "";
};

const responseSourceError = (source, returnValue) => {
  const error = new Error(describeResponseReturnValue(returnValue) || `${source} 暂时不可用`);
  error.status = returnValue?.status && returnValue.status < 500 ? returnValue.status : 502;
  error.returnValue = returnValue;
  error.sourceReturns = [returnValue];
  error.detail = error.message;
  return error;
};

const formatArxivDate = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes())
  ].join("");
};

const arxivCacheKey = (url) => createHash("sha256").update(url.toString()).digest("hex");

const arxivCachePath = (key) => join(arxivCacheDir, `${key}.json`);

const normalizePaperKey = (value) => String(value || "")
  .toLowerCase()
  .replace(/^https?:\/\/(dx\.)?doi\.org\//, "doi:")
  .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//, "arxiv:")
  .replace(/\.pdf$/, "")
  .replace(/[?#].*$/, "")
  .trim();

const paperDuplicateKeys = (paper) => [
  normalizePaperKey(paper.id),
  normalizePaperKey(paper.absLink),
  normalizePaperKey(paper.link),
  normalizePaperKey(paper.title)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
].filter(Boolean);

const appendUniquePapers = (target, seen, papers, maxResults) => {
  for (const paper of papers) {
    const keys = paperDuplicateKeys(paper);

    if (!keys.length || keys.some((key) => seen.has(key))) {
      continue;
    }

    keys.forEach((key) => seen.add(key));
    target.push(paper);

    if (target.length >= maxResults) {
      break;
    }
  }
};

const readArxivCache = async (key) => {
  const memoryEntry = arxivMemoryCache.get(key);

  if (memoryEntry) {
    return memoryEntry;
  }

  try {
    const entry = JSON.parse(await readFile(arxivCachePath(key), "utf8"));

    if (entry?.xml && Number.isFinite(Number(entry.fetchedAt))) {
      arxivMemoryCache.set(key, entry);
      return entry;
    }
  } catch {
    return null;
  }

  return null;
};

const writeArxivCache = async (key, entry) => {
  arxivMemoryCache.set(key, entry);

  try {
    await mkdir(arxivCacheDir, { recursive: true });
    await writeFile(arxivCachePath(key), JSON.stringify(entry), "utf8");
  } catch (error) {
    console.warn(`Could not write arXiv cache: ${error.message}`);
  }
};

const arxivCacheAgeSeconds = (entry) => Math.max(0, Math.round((Date.now() - Number(entry.fetchedAt)) / 1000));

const setPaperRequestStatus = (requestId, source, message, state = "running", extra = {}) => {
  if (!requestId) {
    return;
  }

  paperRequestStatuses.set(requestId, {
    source,
    message,
    state,
    updatedAt: Date.now(),
    ...extra
  });
};

const cleanupPaperRequestStatuses = () => {
  const cutoff = Date.now() - 10 * 60 * 1000;

  for (const [key, value] of paperRequestStatuses) {
    if (Number(value.updatedAt) < cutoff) {
      paperRequestStatuses.delete(key);
    }
  }
};

const stripBooleanQuery = (query) => {
  const cleaned = String(query || defaultQuery)
    .replace(/\b(ANDNOT|AND|OR)\b/gi, " ")
    .replace(/[()"[\]{}:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length > 280 ? cleaned.slice(0, 280) : cleaned;
};

const fallbackSearchQueries = (query) => {
  const cleaned = stripBooleanQuery(query);
  const lower = cleaned.toLowerCase();
  const defaults = [
    "network AI machine learning 5G 6G anomaly detection traffic prediction network optimization",
    "telecom machine learning network automation orchestration",
    "large language model network optimization autonomous agent"
  ];

  if (lower.includes("5g") || lower.includes("telecom") || lower.includes("network")) {
    return defaults;
  }

  return [cleaned, ...defaults].filter(Boolean).slice(0, 3);
};

const dateDaysAgo = (days) => {
  const date = new Date(Date.now() - days * 86400000);
  return date.toISOString().slice(0, 10);
};

const abstractFromInvertedIndex = (index) => {
  if (!index || typeof index !== "object") {
    return "";
  }

  const words = [];

  Object.entries(index).forEach(([word, positions]) => {
    if (!Array.isArray(positions)) {
      return;
    }

    positions.forEach((position) => {
      words[Number(position)] = word;
    });
  });

  return words.filter(Boolean).join(" ");
};

const normalizeIsoDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const atomFeedFromPapers = ({ papers, query, source }) => {
  const updated = new Date().toISOString();
  const entries = papers.map((paper) => {
    const categories = Array.isArray(paper.categories) && paper.categories.length ? paper.categories : [source];
    const primaryCategory = paper.primaryCategory || categories[0] || source;
    const authors = Array.isArray(paper.authors) && paper.authors.length ? paper.authors : ["Unknown authors"];
    const links = [
      `<link href="${escapeXml(paper.absLink || paper.id)}" rel="alternate" type="text/html"/>`
    ];

    if (paper.link) {
      links.push(`<link title="pdf" href="${escapeXml(paper.link)}" rel="related" type="application/pdf"/>`);
    }

    return [
      "<entry>",
      `<id>${escapeXml(paper.id)}</id>`,
      `<updated>${escapeXml(normalizeIsoDate(paper.updated || paper.published))}</updated>`,
      `<published>${escapeXml(normalizeIsoDate(paper.published || paper.updated))}</published>`,
      `<title>${escapeXml(paper.title)}</title>`,
      `<summary>${escapeXml(paper.summary)}</summary>`,
      ...authors.slice(0, 12).map((author) => `<author><name>${escapeXml(author)}</name></author>`),
      ...links,
      `<arxiv:primary_category term="${escapeXml(primaryCategory)}" scheme="http://arxiv.org/schemas/atom"/>`,
      ...categories.slice(0, 12).map((category) => `<category term="${escapeXml(category)}" scheme="${escapeXml(source)}"/>`),
      "</entry>"
    ].join("");
  }).join("");

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<feed xmlns=\"http://www.w3.org/2005/Atom\" xmlns:arxiv=\"http://arxiv.org/schemas/atom\">",
    `<id>paper-insight:${escapeXml(source)}:${escapeXml(query)}</id>`,
    `<title>Paper Insight ${escapeXml(source)} results</title>`,
    `<updated>${updated}</updated>`,
    entries,
    "</feed>"
  ].join("");
};

const parseRetryAfter = (value) => {
  if (!value) {
    return 0;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : 0;
};

const fetchArxivQueued = async (arxivUrl, signal) => {
  const run = async () => {
    const waitMs = Math.max(0, arxivMinIntervalMs - (Date.now() - arxivLastRequestAt));

    if (waitMs) {
      await sleep(waitMs);
    }

    arxivLastRequestAt = Date.now();
    return fetch(arxivUrl, {
      signal,
      headers: {
        "accept": "application/atom+xml, application/xml;q=0.9, */*;q=0.8",
        "user-agent": "paper-insight/0.1 (local research discovery app; contact: local-user)"
      }
    });
  };

  const request = arxivQueue.then(run, run);
  arxivQueue = request.catch(() => {});
  return request;
};

const fetchOpenAlexPapers = async ({ rawQuery, days, maxResults, signal }) => {
  const queries = fallbackSearchQueries(rawQuery);
  const dateWindows = days > 0 ? [...new Set([days, Math.max(days, 30), 0])] : [0];
  let lastError = null;
  const collected = [];
  const seen = new Set();

  for (const query of queries) {
    for (const windowDays of dateWindows) {
      const endpoint = new URL("https://api.openalex.org/works");
      const filters = ["has_abstract:true"];

      if (windowDays > 0) {
        filters.push(`from_publication_date:${dateDaysAgo(windowDays)}`);
      }

      endpoint.searchParams.set("search", query);
      endpoint.searchParams.set("filter", filters.join(","));
      endpoint.searchParams.set("sort", "publication_date:desc");
      endpoint.searchParams.set("per-page", String(Math.min(Math.max(maxResults, 5), 25)));
      endpoint.searchParams.set("select", [
        "id",
        "doi",
        "display_name",
        "abstract_inverted_index",
        "publication_date",
        "updated_date",
        "authorships",
        "open_access",
        "primary_location",
        "best_oa_location",
        "primary_topic",
        "topics"
      ].join(","));

      if (process.env.OPENALEX_MAILTO) {
        endpoint.searchParams.set("mailto", process.env.OPENALEX_MAILTO);
      }

      const response = await fetch(endpoint, {
        signal,
        headers: {
          "accept": "application/json",
          "user-agent": "paper-insight/0.1 (local research discovery app)"
        }
      });

      if (!response.ok) {
        const returnValue = await readResponseReturnValue("OpenAlex", response);
        lastError = responseSourceError("OpenAlex", returnValue);
        continue;
      }

      const data = await response.json();
      const results = Array.isArray(data.results) ? data.results : [];
      const papers = results.map((work) => {
      const summary = abstractFromInvertedIndex(work.abstract_inverted_index);
      const pdfUrl = work.best_oa_location?.pdf_url
        || work.primary_location?.pdf_url
        || work.open_access?.oa_url
        || work.best_oa_location?.landing_page_url
        || work.primary_location?.landing_page_url
        || "";
      const absLink = work.doi ? `https://doi.org/${String(work.doi).replace(/^https?:\/\/doi\.org\//i, "")}` : work.id;
      const topics = [
        work.primary_topic?.display_name,
        ...(Array.isArray(work.topics) ? work.topics.map((topic) => topic.display_name) : [])
      ].filter(Boolean);

      return {
        id: work.id || absLink,
        title: work.display_name || "Untitled paper",
        authors: Array.isArray(work.authorships)
          ? work.authorships.map((item) => item.author?.display_name).filter(Boolean)
          : [],
        summary,
        published: work.publication_date || new Date().toISOString(),
        updated: work.updated_date || work.publication_date || new Date().toISOString(),
        link: pdfUrl,
        absLink,
        primaryCategory: "OpenAlex",
        categories: [...new Set(["OpenAlex", ...topics])].slice(0, 12)
      };
    })
    .filter((paper) => paper.id && paper.title && paper.summary)
    .slice(0, maxResults);

      appendUniquePapers(collected, seen, papers, maxResults);

      if (collected.length >= maxResults) {
        return collected;
      }
    }
  }

  if (collected.length) {
    return collected;
  }

  if (lastError) {
    throw lastError;
  }

  return [];
};

const fetchSemanticScholarPapers = async ({ rawQuery, days, maxResults, signal }) => {
  const queries = fallbackSearchQueries(rawQuery);
  const dateWindows = days > 0 ? [...new Set([days, Math.max(days, 30), 0])] : [0];
  let lastError = null;
  const collected = [];
  const seen = new Set();

  for (const query of queries) {
    for (const windowDays of dateWindows) {
      const endpoint = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
      endpoint.searchParams.set("query", query);
      endpoint.searchParams.set("limit", String(Math.min(Math.max(maxResults, 5), 25)));
      endpoint.searchParams.set("fields", [
        "paperId",
        "title",
        "abstract",
        "authors",
        "year",
        "publicationDate",
        "url",
        "openAccessPdf",
        "externalIds",
        "fieldsOfStudy",
        "s2FieldsOfStudy"
      ].join(","));

      if (windowDays > 0) {
        endpoint.searchParams.set("publicationDateOrYear", `${dateDaysAgo(windowDays)}:`);
      }

      const headers = {
        "accept": "application/json",
        "user-agent": "paper-insight/0.1 (local research discovery app)"
      };

      if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
        headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
      }

      const response = await fetch(endpoint, { signal, headers });

      if (!response.ok) {
        const returnValue = await readResponseReturnValue("Semantic Scholar", response);
        lastError = responseSourceError("Semantic Scholar", returnValue);
        continue;
      }

      const data = await response.json();
      const results = Array.isArray(data.data) ? data.data : [];
      const papers = results.map((paper) => {
      const categories = [
        "Semantic Scholar",
        ...(Array.isArray(paper.fieldsOfStudy) ? paper.fieldsOfStudy : []),
        ...(Array.isArray(paper.s2FieldsOfStudy) ? paper.s2FieldsOfStudy.map((field) => field.category).filter(Boolean) : [])
      ];
      const doi = paper.externalIds?.DOI;
      const arxivId = paper.externalIds?.ArXiv;
      const absLink = arxivId ? `https://arxiv.org/abs/${arxivId}` : doi ? `https://doi.org/${doi}` : paper.url;

      return {
        id: arxivId ? `https://arxiv.org/abs/${arxivId}` : paper.paperId || paper.url || doi,
        title: paper.title || "Untitled paper",
        authors: Array.isArray(paper.authors) ? paper.authors.map((author) => author.name).filter(Boolean) : [],
        summary: paper.abstract || "",
        published: paper.publicationDate || (paper.year ? `${paper.year}-01-01` : new Date().toISOString()),
        updated: paper.publicationDate || (paper.year ? `${paper.year}-01-01` : new Date().toISOString()),
        link: paper.openAccessPdf?.url || absLink,
        absLink,
        primaryCategory: "Semantic Scholar",
        categories: [...new Set(categories)].slice(0, 12)
      };
    })
    .filter((paper) => paper.id && paper.title && paper.summary)
    .slice(0, maxResults);

      appendUniquePapers(collected, seen, papers, maxResults);

      if (collected.length >= maxResults) {
        return collected;
      }
    }
  }

  if (collected.length) {
    return collected;
  }

  if (lastError) {
    throw lastError;
  }

  return [];
};

const fetchFallbackPapers = async ({ rawQuery, days, maxResults, signal, requestId }) => {
  const errors = [];
  const sourceReturns = [];

  setPaperRequestStatus(requestId, "openalex", "arXiv 暂时不可用，正在切换 OpenAlex 获取候选论文。");

  try {
    const papers = await fetchOpenAlexPapers({ rawQuery, days, maxResults, signal });

    if (papers.length) {
      return {
        source: "openalex",
        xml: atomFeedFromPapers({ papers, query: rawQuery, source: "OpenAlex" }),
        count: papers.length
      };
    }

    errors.push("OpenAlex 没有返回可用候选论文");
  } catch (error) {
    errors.push(error.detail || error.message);
    sourceReturns.push(...(Array.isArray(error.sourceReturns) ? error.sourceReturns : []));
    setPaperRequestStatus(requestId, "openalex", error.detail || error.message, "running", { sourceReturns });
  }

  setPaperRequestStatus(requestId, "semantic-scholar", "OpenAlex 没有可用结果，正在切换 Semantic Scholar。");

  try {
    const papers = await fetchSemanticScholarPapers({ rawQuery, days, maxResults, signal });

    if (papers.length) {
      return {
        source: "semantic-scholar",
        xml: atomFeedFromPapers({ papers, query: rawQuery, source: "Semantic Scholar" }),
        count: papers.length
      };
    }

    errors.push("Semantic Scholar 没有返回可用候选论文");
  } catch (error) {
    errors.push(error.detail || error.message);
    sourceReturns.push(...(Array.isArray(error.sourceReturns) ? error.sourceReturns : []));
  }

  const error = new Error("arXiv、OpenAlex 和 Semantic Scholar 都没有返回可用候选论文。");
  error.detail = errors.join("；");
  error.sourceReturns = sourceReturns;
  throw error;
};

const tokenizeQuery = (query) => query.match(/"[^"]+"|\(|\)|\bANDNOT\b|\bAND\b|\bOR\b|[^\s()]+/gi) || [];

const normalizeQueryForArxiv = (query) => {
  const tokens = tokenizeQuery(query || defaultQuery)
    .map((token) => {
      const value = token.trim();

      if (!value) {
        return "";
      }

      if (value === "(" || value === ")") {
        return value;
      }

      if (/^(AND|OR|ANDNOT)$/i.test(value)) {
        return value.toUpperCase();
      }

      if (/^[a-zA-Z]+:/.test(value) || /^[a-zA-Z]+Date:\[/i.test(value)) {
        return value;
      }

      return `all:${value}`;
    })
    .filter(Boolean);

  return tokens.join(" ");
};

const readJsonBody = async (request) => {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_500_000) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
};

const sanitizePaper = (paper) => ({
  id: String(paper.id || ""),
  title: truncate(paper.title, 320),
  authors: Array.isArray(paper.authors) ? paper.authors.slice(0, 12).map((author) => String(author)) : [],
  summary: truncate(paper.summary, 2400),
  published: String(paper.published || ""),
  updated: String(paper.updated || ""),
  link: String(paper.link || ""),
  absLink: String(paper.absLink || paper.id || ""),
  primaryCategory: String(paper.primaryCategory || "arXiv"),
  categories: Array.isArray(paper.categories) ? paper.categories.slice(0, 12).map((category) => String(category)) : []
});

const extractJson = (content) => {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("LLM did not return a JSON object.");
  }

  return JSON.parse(candidate.slice(start, end + 1));
};

const textFields = [
  "tldr",
  "problem",
  "background",
  "method",
  "technicalDetails",
  "contribution",
  "experiment",
  "networkUseCase",
  "limitations",
  "recommendedReadingPath",
  "whyRecommend"
];

const validateAnalysis = (paper, analysis) => {
  const missing = [];

  if (!analysis) {
    return { id: paper.id, title: paper.title, missing: ["analysis"] };
  }

  if (!Number.isFinite(Number(analysis.score))) {
    missing.push("score");
  }

  dimensions.forEach((dimension) => {
    if (!Number.isFinite(Number(analysis.scores?.[dimension.key]))) {
      missing.push(`scores.${dimension.key}`);
    }
  });

  textFields.forEach((field) => {
    if (!String(analysis[field] || "").trim()) {
      missing.push(field);
    }
  });

  if (!Array.isArray(analysis.readingGuide) || !analysis.readingGuide.length) {
    missing.push("readingGuide");
  }

  return missing.length ? { id: paper.id, title: paper.title, missing } : null;
};

const getLlmConfig = (overrides = {}) => {
  const requestedProvider = String(overrides.provider || "").toLowerCase();
  const hasDeepSeekKey = requestedProvider === "deepseek" || Boolean(process.env.DEEPSEEK_API_KEY);
  const apiKey = String(overrides.apiKey || "").trim() || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
  const model = String(overrides.model || "").trim() || process.env.LLM_MODEL || process.env.OPENAI_MODEL || process.env.DEEPSEEK_MODEL || (hasDeepSeekKey ? "deepseek-v4-flash" : "gpt-4o-mini");
  const endpoint = String(overrides.endpoint || "").trim() || process.env.LLM_API_URL || (hasDeepSeekKey ? "https://api.deepseek.com/chat/completions" : "https://api.openai.com/v1/chat/completions");

  if (!apiKey) {
    return null;
  }

  return { apiKey, endpoint, hasDeepSeekKey, model };
};

const callLlmAnalyzer = async ({ query, papers, llm }) => {
  const config = getLlmConfig(llm);

  if (!config) {
    const error = new Error("未配置 DeepSeek 或 OpenAI 兼容 API key。");
    error.code = "LLM_NOT_CONFIGURED";
    throw error;
  }

  const { apiKey, endpoint, hasDeepSeekKey, model } = config;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65000);

  try {
    const payload = {
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你是网络通信和 AI 论文推荐助手。",
            "只根据给定的 arXiv 题目、摘要、作者、类别和日期分析，不要编造全文中不存在的信息。",
            "请用中文输出，给每篇论文计算 0 到 100 的推荐分，并按指定维度给出分项分。",
            "只返回 JSON，不要输出 Markdown。"
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            query,
            dimensions,
            outputSchema: {
              recommendations: [
                {
                  id: "paper id",
                  score: "0-100 integer",
                  scores: {
                    domainFit: "0-100",
                    aiFit: "0-100",
                    taskFit: "0-100",
                    novelty: "0-100",
                    practicalValue: "0-100",
                    evidence: "0-100"
                  },
                  tldr: "一句话概要",
                  problem: "论文解决的问题",
                  background: "研究背景和为什么这个问题重要，至少 120 字",
                  method: "核心方法或系统思路，至少 160 字",
                  technicalDetails: "技术细节、模型/算法/系统设计、关键模块和数据流，至少 220 字",
                  contribution: "主要贡献",
                  experiment: "实验设置、数据集、指标、基线和结果可信度分析，至少 160 字",
                  networkUseCase: "对网络/电信/5G/6G的潜在价值",
                  limitations: "从摘要可见的不足或需要进一步确认点",
                  recommendedReadingPath: "建议快速阅读这篇论文时按什么顺序读，以及每部分重点看什么，至少 120 字",
                  readingGuide: ["快速阅读建议1", "快速阅读建议2", "快速阅读建议3", "快速阅读建议4"],
                  matchedKeywords: ["命中的关键词"],
                  whyRecommend: "为什么进入或接近推荐列表"
                }
              ]
            },
            papers: papers.map((paper) => ({
              id: paper.id,
              title: paper.title,
              authors: paper.authors,
              categories: paper.categories,
              published: paper.published,
              summary: paper.summary
            }))
          })
        }
      ]
    };

    if (hasDeepSeekKey && !process.env.LLM_API_URL) {
      payload.thinking = { type: "disabled" };
    }

    const llmResponse = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      throw new Error(`LLM request failed with ${llmResponse.status}: ${truncate(redactSensitive(errorText), 300)}`);
    }

    const data = await llmResponse.json();
    const content = data.choices?.[0]?.message?.content || data.output_text || "";
    const parsed = extractJson(content);
    return Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  } finally {
    clearTimeout(timeout);
  }
};

const callLlmTranslation = async ({ title, summary, llm }) => {
  const config = getLlmConfig(llm);

  if (!config) {
    const error = new Error("未配置 DeepSeek 或 OpenAI 兼容 API key。");
    error.code = "LLM_NOT_CONFIGURED";
    throw error;
  }

  const { apiKey, endpoint, hasDeepSeekKey, model } = config;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const payload = {
      model,
      temperature: 0.1,
      max_tokens: 1400,
      messages: [
        {
          role: "system",
          content: "你是严谨的论文摘要翻译助手。请把英文论文摘要翻译为中文，保留必要英文术语，不添加摘要之外的信息。"
        },
        {
          role: "user",
          content: JSON.stringify({
            title,
            abstract: summary,
            instruction: "返回中文译文即可，不要输出 Markdown 标题。"
          })
        }
      ]
    };

    if (hasDeepSeekKey && !process.env.LLM_API_URL) {
      payload.thinking = { type: "disabled" };
    }

    const llmResponse = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      throw new Error(`LLM request failed with ${llmResponse.status}: ${truncate(redactSensitive(errorText), 300)}`);
    }

    const data = await llmResponse.json();
    return truncate(data.choices?.[0]?.message?.content || data.output_text || "", 3000);
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeAnalysis = (paper, analysis) => {
  const scores = Object.fromEntries(
    dimensions.map((dimension) => [dimension.key, clamp(analysis.scores[dimension.key])])
  );
  const score = clamp(analysis.score);

  return {
    score: Math.round(score),
    scores,
    tldr: truncate(analysis.tldr, 360),
    problem: truncate(analysis.problem, 500),
    background: truncate(analysis.background, 900),
    method: truncate(analysis.method, 500),
    technicalDetails: truncate(analysis.technicalDetails, 1200),
    contribution: truncate(analysis.contribution, 500),
    experiment: truncate(analysis.experiment, 900),
    networkUseCase: truncate(analysis.networkUseCase, 500),
    limitations: truncate(analysis.limitations, 500),
    recommendedReadingPath: truncate(analysis.recommendedReadingPath, 700),
    readingGuide: analysis.readingGuide.slice(0, 4).map((item) => truncate(item, 180)),
    matchedKeywords: Array.isArray(analysis.matchedKeywords)
      ? analysis.matchedKeywords.slice(0, 12).map((item) => truncate(item, 80))
      : [],
    whyRecommend: truncate(analysis.whyRecommend, 400)
  };
};

const handlePapersRequest = async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const maxResults = Math.min(Math.max(Number(url.searchParams.get("limit") || 10), 5), 30);
  const start = Math.max(Number(url.searchParams.get("start") || 0), 0);
  const rawQuery = (url.searchParams.get("query") || defaultQuery).trim();
  const days = Math.min(Math.max(Number(url.searchParams.get("days") || 0), 0), 365);
  const requestId = String(url.searchParams.get("requestId") || "");
  let searchQuery = normalizeQueryForArxiv(rawQuery);

  if (days > 0 && !/submittedDate:/i.test(searchQuery)) {
    const end = new Date();
    const startDate = new Date(end.getTime() - days * 86400000);
    searchQuery = `(${searchQuery}) AND submittedDate:[${formatArxivDate(startDate)} TO ${formatArxivDate(end)}]`;
  }

  const arxivUrl = new URL("https://export.arxiv.org/api/query");
  arxivUrl.searchParams.set("search_query", searchQuery);
  arxivUrl.searchParams.set("start", String(start));
  arxivUrl.searchParams.set("max_results", String(maxResults));
  arxivUrl.searchParams.set("sortBy", "submittedDate");
  arxivUrl.searchParams.set("sortOrder", "descending");
  const cacheKey = arxivCacheKey(arxivUrl);
  const cached = await readArxivCache(cacheKey);
  const cachedAge = cached ? Date.now() - Number(cached.fetchedAt) : Infinity;

  const sendPapersXml = (xml, cacheStatus, source = "arxiv", extraHeaders = {}) => {
    send(response, 200, xml, {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": cacheStatus === "miss" ? "public, max-age=300" : "public, max-age=60",
      "x-arxiv-search-query": encodeURIComponent(searchQuery),
      "x-paper-insight-arxiv-cache": cacheStatus,
      "x-paper-insight-source": source,
      "x-paper-insight-cache-age-seconds": cached ? String(arxivCacheAgeSeconds(cached)) : "0",
      ...extraHeaders
    });
  };

  if (cached && cachedAge < arxivFreshCacheMs) {
    setPaperRequestStatus(requestId, cached.source || "cache", "已命中本地缓存。", "done");
    sendPapersXml(cached.xml, "hit", cached.source || "arxiv");
    return;
  }

  if (arxivInflight.has(cacheKey)) {
    try {
      const result = await arxivInflight.get(cacheKey);
      sendPapersXml(result.xml, result.cacheStatus, result.source, result.headers);
    } catch (error) {
      sendJson(response, error.status || 502, {
        error: error.code || "ARXIV_UNAVAILABLE",
        message: error.message || "Could not fetch the latest papers from arXiv.",
        detail: error.detail || error.message,
        sourceReturns: error.sourceReturns || [],
        retryAfterSeconds: error.retryAfterSeconds || 0
      }, error.retryAfterSeconds ? { "retry-after": String(error.retryAfterSeconds) } : {});
    }
    return;
  }

  const fetchAndCache = (async () => {
    const now = Date.now();

    if (arxivBlockedUntil > now) {
      if (cached && cachedAge < arxivStaleCacheMs) {
        setPaperRequestStatus(requestId, cached.source || "cache", "arXiv 正在限流，已使用本地缓存。", "done");
        return {
          xml: cached.xml,
          cacheStatus: "stale",
          source: cached.source || "arxiv",
          headers: {
            "x-paper-insight-arxiv-warning": encodeURIComponent("arXiv 正在限流，已使用本地缓存。"),
            "retry-after": String(Math.ceil((arxivBlockedUntil - now) / 1000))
          }
        };
      }

      const fallback = await fetchFallbackPapers({ rawQuery, days, maxResults, signal: AbortSignal.timeout(30000), requestId });
      await writeArxivCache(cacheKey, {
        fetchedAt: Date.now(),
        searchQuery,
        source: fallback.source,
        xml: fallback.xml
      });
      setPaperRequestStatus(requestId, fallback.source, `已通过 ${fallback.source === "openalex" ? "OpenAlex" : "Semantic Scholar"} 获取 ${fallback.count} 篇候选论文。`, "done");
      return {
        xml: fallback.xml,
        cacheStatus: "fallback",
        source: fallback.source,
        headers: {
          "x-paper-insight-arxiv-warning": encodeURIComponent("arXiv 正在限流，已使用备用数据源。")
        }
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      setPaperRequestStatus(requestId, "arxiv", "正在获取 arXiv 候选论文。");
      const arxivResponse = await fetchArxivQueued(arxivUrl, controller.signal);

      if (arxivResponse.status === 429) {
        const arxivReturn = await readResponseReturnValue("arXiv", arxivResponse);
        const retryMs = parseRetryAfter(arxivReturn.retryAfter) || arxivCooldownMs;
        arxivBlockedUntil = Date.now() + retryMs;

        if (cached && cachedAge < arxivStaleCacheMs) {
          setPaperRequestStatus(requestId, cached.source || "cache", "arXiv 返回 429，已使用本地缓存。", "done", { sourceReturns: [arxivReturn] });
          return {
            xml: cached.xml,
            cacheStatus: "stale",
            source: cached.source || "arxiv",
            headers: {
              "x-paper-insight-arxiv-warning": encodeURIComponent("arXiv 返回 429，已使用本地缓存。"),
              "x-paper-insight-source-return": responseReturnHeader(arxivReturn),
              "retry-after": String(Math.ceil(retryMs / 1000))
            }
          };
        }

        let fallback;

        try {
          fallback = await fetchFallbackPapers({ rawQuery, days, maxResults, signal: controller.signal, requestId });
        } catch (error) {
          error.detail = [describeResponseReturnValue(arxivReturn), error.detail || error.message].filter(Boolean).join("；");
          error.sourceReturns = [arxivReturn, ...(Array.isArray(error.sourceReturns) ? error.sourceReturns : [])];
          throw error;
        }

        await writeArxivCache(cacheKey, {
          fetchedAt: Date.now(),
          searchQuery,
          source: fallback.source,
          xml: fallback.xml
        });
        setPaperRequestStatus(requestId, fallback.source, `已通过 ${fallback.source === "openalex" ? "OpenAlex" : "Semantic Scholar"} 获取 ${fallback.count} 篇候选论文。`, "done");
        return {
          xml: fallback.xml,
          cacheStatus: "fallback",
          source: fallback.source,
          headers: {
            "x-paper-insight-arxiv-warning": encodeURIComponent("arXiv 返回 429，已使用备用数据源。"),
            "x-paper-insight-source-return": responseReturnHeader(arxivReturn),
            "retry-after": String(Math.ceil(retryMs / 1000))
          }
        };
      }

      if (!arxivResponse.ok) {
        const returnValue = await readResponseReturnValue("arXiv", arxivResponse);
        throw responseSourceError("arXiv", returnValue);
      }

      const xml = await arxivResponse.text();
      await writeArxivCache(cacheKey, {
        fetchedAt: Date.now(),
        searchQuery,
        source: "arxiv",
        xml
      });
      setPaperRequestStatus(requestId, "arxiv", "已通过 arXiv 获取候选论文。", "done");
      return { xml, cacheStatus: "miss", source: "arxiv", headers: {} };
    } catch (error) {
      const sourceReturns = Array.isArray(error.sourceReturns) ? [...error.sourceReturns] : [];
      const sourceReturn = sourceReturns[0];

      if (cached && cachedAge < arxivStaleCacheMs) {
        setPaperRequestStatus(requestId, cached.source || "cache", "arXiv 暂时不可用，已使用本地缓存。", "done", { sourceReturns });
        return {
          xml: cached.xml,
          cacheStatus: "stale",
          source: cached.source || "arxiv",
          headers: {
            "x-paper-insight-arxiv-warning": encodeURIComponent("arXiv 暂时不可用，已使用本地缓存。"),
            ...(sourceReturn ? { "x-paper-insight-source-return": responseReturnHeader(sourceReturn) } : {})
          }
        };
      }

      try {
        const fallback = await fetchFallbackPapers({ rawQuery, days, maxResults, signal: AbortSignal.timeout(30000), requestId });
        await writeArxivCache(cacheKey, {
          fetchedAt: Date.now(),
          searchQuery,
          source: fallback.source,
          xml: fallback.xml
        });
        setPaperRequestStatus(requestId, fallback.source, `已通过 ${fallback.source === "openalex" ? "OpenAlex" : "Semantic Scholar"} 获取 ${fallback.count} 篇候选论文。`, "done");
        return {
          xml: fallback.xml,
          cacheStatus: "fallback",
          source: fallback.source,
          headers: {
            "x-paper-insight-arxiv-warning": encodeURIComponent("arXiv 暂时不可用，已使用备用数据源。"),
            ...(sourceReturn ? { "x-paper-insight-source-return": responseReturnHeader(sourceReturn) } : {})
          }
        };
      } catch (fallbackError) {
        error.fallbackDetail = fallbackError.detail || fallbackError.message;
        sourceReturns.push(...(Array.isArray(fallbackError.sourceReturns) ? fallbackError.sourceReturns : []));
      }

      const wrapped = new Error(error.name === "AbortError" ? "arXiv request timed out." : error.message);
      wrapped.status = error.status || 502;
      wrapped.code = typeof error.code === "string" ? error.code : "ARXIV_UNAVAILABLE";
      wrapped.detail = [error.detail || wrapped.message, error.fallbackDetail].filter(Boolean).join("；");
      wrapped.retryAfterSeconds = error.retryAfterSeconds || 0;
      wrapped.sourceReturns = sourceReturns;
      setPaperRequestStatus(requestId, "none", wrapped.detail, "error", { sourceReturns });
      throw wrapped;
    } finally {
      clearTimeout(timeout);
    }
  })();

  arxivInflight.set(cacheKey, fetchAndCache);

  try {
    const result = await fetchAndCache;
    sendPapersXml(result.xml, result.cacheStatus, result.source, result.headers);
  } catch (error) {
    sendJson(response, error.status || 502, {
      error: error.code || "ARXIV_UNAVAILABLE",
      message: error.message || "Could not fetch the latest papers from arXiv.",
      detail: error.detail || error.message,
      sourceReturns: error.sourceReturns || [],
      retryAfterSeconds: error.retryAfterSeconds || 0
    }, error.retryAfterSeconds ? { "retry-after": String(error.retryAfterSeconds) } : {});
  } finally {
    arxivInflight.delete(cacheKey);
  }
};

const handlePaperStatusRequest = (request, response) => {
  cleanupPaperRequestStatuses();
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestId = String(url.searchParams.get("requestId") || "");
  const status = paperRequestStatuses.get(requestId);

  sendJson(response, 200, status || {
    source: "",
    message: "等待开始获取候选论文。",
    state: "idle",
    updatedAt: Date.now()
  });
};

const handleAnalyzeRequest = async (request, response) => {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const threshold = clamp(payload.threshold ?? 70);
    const maxAnalyze = Math.min(Math.max(Number(payload.maxAnalyze || 30), 5), 60);
    const maxRecommendations = Math.min(Math.max(Number(payload.maxRecommendations || 12), 1), 30);
    const papers = Array.isArray(payload.papers) ? payload.papers.slice(0, maxAnalyze).map(sanitizePaper) : [];

    if (!papers.length) {
      sendJson(response, 400, { error: "NO_PAPERS", message: "No papers were provided for analysis." });
      return;
    }

    const requestLlm = {
      apiKey: payload.llmApiKey,
      provider: payload.llmProvider,
      model: payload.llmModel
    };
    let llmAnalyses = null;
    const mode = requestLlm.provider === "deepseek" || process.env.DEEPSEEK_API_KEY ? "deepseek" : "llm";

    try {
      llmAnalyses = await callLlmAnalyzer({ query: payload.query || defaultQuery, papers, llm: requestLlm });
    } catch (error) {
      sendJson(response, error.code === "LLM_NOT_CONFIGURED" ? 503 : 500, {
        error: error.code || "LLM_ANALYSIS_FAILED",
        message: "LLM analysis is required for recommendations.",
        detail: error.message,
        retryable: error.code !== "LLM_NOT_CONFIGURED"
      });
      return;
    }

    const analysisById = new Map((llmAnalyses || []).map((analysis) => [String(analysis.id), analysis]));
    const missingPapers = papers
      .filter((paper) => !analysisById.has(paper.id))
      .map((paper) => ({
        id: paper.id,
        title: paper.title
      }));

    if (missingPapers.length) {
      sendJson(response, 502, {
        error: "LLM_INCOMPLETE_ANALYSIS",
        message: "LLM did not return analysis for every paper.",
        detail: `Missing ${missingPapers.length} paper analyses from the LLM response.`,
        retryable: true,
        missingPapers
      });
      return;
    }

    const invalidAnalyses = papers
      .map((paper) => validateAnalysis(paper, analysisById.get(paper.id)))
      .filter(Boolean);

    if (invalidAnalyses.length) {
      sendJson(response, 502, {
        error: "LLM_INVALID_ANALYSIS",
        message: "LLM returned incomplete paper analysis fields.",
        detail: `Invalid analyses for ${invalidAnalyses.length} papers.`,
        retryable: true,
        invalidAnalyses
      });
      return;
    }

    const analyzed = papers
      .map((paper) => ({
        ...paper,
        analysis: normalizeAnalysis(paper, analysisById.get(paper.id))
      }));

    const recommendations = analyzed
      .filter((paper) => paper.analysis.score >= threshold)
      .sort((a, b) => b.analysis.score - a.analysis.score || new Date(b.published) - new Date(a.published))
      .slice(0, maxRecommendations);
    const hiddenPapers = analyzed
      .filter((paper) => paper.analysis.score < threshold)
      .sort((a, b) => b.analysis.score - a.analysis.score || new Date(b.published) - new Date(a.published));

    sendJson(response, 200, {
      mode,
      warning: "",
      threshold,
      dimensions,
      candidateCount: payload.totalCandidates ?? papers.length,
      analyzedCount: analyzed.length,
      recommendedCount: recommendations.length,
      hiddenCount: hiddenPapers.length,
      recommendations,
      hiddenPapers,
      analyzedPapers: analyzed
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "ANALYSIS_FAILED",
      message: "Could not analyze papers.",
      detail: error.message
    });
  }
};

const handleTranslateRequest = async (request, response) => {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const title = truncate(payload.title, 320);
    const summary = truncate(payload.summary, 2400);

    if (!summary) {
      sendJson(response, 400, { error: "NO_ABSTRACT", message: "No abstract was provided for translation." });
      return;
    }

    const translation = await callLlmTranslation({
      title,
      summary,
      llm: {
        apiKey: payload.llmApiKey,
        provider: payload.llmProvider,
        model: payload.llmModel
      }
    });
    sendJson(response, 200, {
      translation,
      mode: process.env.DEEPSEEK_API_KEY ? "deepseek" : "llm"
    });
  } catch (error) {
    sendJson(response, error.code === "LLM_NOT_CONFIGURED" ? 503 : 500, {
      error: error.code || "TRANSLATION_FAILED",
      message: "Could not translate the abstract.",
      detail: error.message
    });
  }
};

const serveStatic = async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const normalizedPath = normalize(requestedPath).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, normalizedPath);

  if (filePath !== publicDir && !filePath.startsWith(publicRoot)) {
    send(response, 403, "Forbidden", { "content-type": "text/plain; charset=utf-8" });
    return;
  }

  try {
    const file = await readFile(filePath);
    send(response, 200, file, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "public, max-age=60"
    });
  } catch {
    send(response, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
  }
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/api/papers") {
    await handlePapersRequest(request, response);
    return;
  }

  if (url.pathname === "/api/papers/status") {
    handlePaperStatusRequest(request, response);
    return;
  }

  if (url.pathname === "/api/analyze") {
    await handleAnalyzeRequest(request, response);
    return;
  }

  if (url.pathname === "/api/translate") {
    await handleTranslateRequest(request, response);
    return;
  }

  await serveStatic(request, response);
});

server.listen(port, () => {
  console.log(`Paper Insight is running at http://localhost:${port}`);
});
