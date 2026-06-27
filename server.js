import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import tls from "node:tls";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const publicRoot = publicDir.endsWith(sep) ? publicDir : `${publicDir}${sep}`;
const port = Number(process.env.PORT || 3000);
const host = String(process.env.HOST || process.env.BIND_HOST || "").trim();
const arxivCacheDir = join(__dirname, ".cache", "arxiv");
const arxivCooldownPath = join(__dirname, ".cache", "arxiv-cooldown.json");
const arxivPaperLibraryPath = join(__dirname, ".cache", "arxiv-papers.json");
const arxivSyncHistoryPath = join(__dirname, ".cache", "arxiv-sync-history.json");
const arxivMinIntervalMs = Number(process.env.ARXIV_MIN_INTERVAL_MS || 3500);
const arxivFreshCacheMs = Number(process.env.ARXIV_CACHE_TTL_MS || 30 * 60 * 1000);
const arxivStaleCacheMs = Number(process.env.ARXIV_STALE_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const arxivDailySyncMs = Number(process.env.ARXIV_DAILY_SYNC_MS || 20 * 60 * 60 * 1000);
const arxivSyncHistoryLimit = Math.min(Math.max(Number(process.env.ARXIV_SYNC_HISTORY_LIMIT || 100), 20), 500);
const arxivCooldownMs = Number(process.env.ARXIV_429_COOLDOWN_MS || 30 * 60 * 1000);
const arxivMaxCooldownMs = Number(process.env.ARXIV_429_MAX_COOLDOWN_MS || 2 * 60 * 60 * 1000);
const llmResponseMaxChars = Number(process.env.LLM_RESPONSE_MAX_CHARS || 500000);
const llmMaxOutputTokens = Number(process.env.LLM_MAX_OUTPUT_TOKENS || 12000);
const llmRequestTimeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS || 10 * 60 * 1000);
const readingListEmailTo = String(process.env.READING_LIST_EMAIL_TO || "yaoyayu@huawei.com").trim();
const smtpTimeoutMs = Number(process.env.SMTP_TIMEOUT_MS || 30 * 1000);
const arxivAutoSyncEnabled = !/^(0|false|no)$/i.test(String(process.env.ARXIV_AUTO_SYNC || "1"));
const arxivAutoSyncInitialDelayMs = Number(process.env.ARXIV_AUTO_SYNC_INITIAL_DELAY_MS || 30 * 1000);
const arxivAutoSyncRetryMs = Number(process.env.ARXIV_AUTO_SYNC_RETRY_MS || 60 * 60 * 1000);
const arxivRssCategories = String(process.env.ARXIV_RSS_CATEGORIES || "cs.NI,cs.AI,cs.LG,cs.MA,cs.DC,cs.IT,eess.SP,eess.SY")
  .split(/[,\s]+/)
  .map((item) => item.trim())
  .filter(Boolean);
const arxivMemoryCache = new Map();
const arxivInflight = new Map();
const paperRequestStatuses = new Map();
let arxivPaperLibraryMemory = null;
let arxivSyncHistoryMemory = null;
let arxivSyncInflight = null;
let arxivQueue = Promise.resolve();
let arxivLastRequestAt = 0;
let arxivBlockedUntil = 0;
let arxivCooldownLoaded = false;
let arxivCooldownFailures = 0;
let arxivAutoSyncTimer = null;

const defaultQuery = `("large language model" OR "LLM" OR "foundation model" OR "AI agent" OR "LLM agent" OR
"multi-agent" OR "agentic AI" OR "autonomous agent") AND
("autonomous network" OR "autonomous networking" OR "self-driving network" OR "zero-touch network" OR
"network digital twin" OR "digital twin network" OR "intent-based networking" OR "agent framework" OR
"agentic framework" OR "end-to-end framework" OR "closed-loop autonomy" OR "network automation")`;

const dimensions = [
  {
    key: "scenarioProblemValue",
    label: "研究问题价值",
    weight: 0.35,
    description: "是否命中网络自治、网络数字孪生或智能体框架等关键研究问题，问题是否真实、重要、有研究价值。"
  },
  {
    key: "methodNovelty",
    label: "方法新意",
    weight: 0.25,
    description: "方法、架构或建模方式是否有新东西，而不是简单套模型。"
  },
  {
    key: "practicalValue",
    label: "框架系统价值",
    weight: 0.25,
    description: "是否提出可复用的系统架构、工程化集成方案、智能体协同机制或闭环自治流程。"
  },
  {
    key: "evidence",
    label: "证据强度",
    weight: 0.15,
    description: "实验、数据、基线、指标、消融和可复现线索是否扎实。"
  }
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

const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();

const ensureLlmResponseWithinLimit = (value) => {
  const text = String(value || "").trim();

  if (text.length > llmResponseMaxChars) {
    const error = new Error(`LLM response is too large: ${text.length} chars, limit ${llmResponseMaxChars}.`);
    error.code = "LLM_RESPONSE_TOO_LARGE";
    throw error;
  }

  return text;
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

const arxivSubmittedDateWindow = (days) => {
  const end = new Date();
  end.setUTCHours(23, 59, 0, 0);

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  start.setUTCHours(0, 0, 0, 0);

  return {
    start,
    end
  };
};

const arxivCacheKey = (value) => createHash("sha256").update(String(value)).digest("hex");

const arxivCachePath = (key) => join(arxivCacheDir, `${key}.json`);

const emptyArxivSyncHistory = () => ({
  version: 1,
  updatedAt: "",
  records: []
});

const normalizeArxivSyncHistoryEntry = (entry = {}) => {
  const startedAt = String(entry.startedAt || entry.finishedAt || new Date().toISOString());
  const finishedAt = String(entry.finishedAt || startedAt);
  const durationMs = Math.max(0, Math.round(Number(entry.durationMs) || 0));
  const status = ["success", "skipped", "failed"].includes(entry.status) ? entry.status : "success";
  const error = entry.error
    ? {
        code: truncate(entry.error.code, 80),
        message: truncate(entry.error.message, 500),
        detail: truncate(entry.error.detail, 800)
      }
    : null;

  return {
    id: truncate(entry.id || arxivCacheKey(`${startedAt}:${finishedAt}:${entry.trigger || ""}:${status}`).slice(0, 16), 40),
    startedAt,
    finishedAt,
    durationMs,
    status,
    trigger: truncate(entry.trigger || "unknown", 80),
    force: Boolean(entry.force),
    requestId: truncate(entry.requestId, 80),
    categories: Array.isArray(entry.categories) ? entry.categories.filter(Boolean).map(String).slice(0, 50) : [],
    fetched: Math.max(0, Number(entry.fetched) || 0),
    added: Math.max(0, Number(entry.added) || 0),
    updated: Math.max(0, Number(entry.updated) || 0),
    total: Math.max(0, Number(entry.total) || 0),
    message: truncate(entry.message, 500),
    error
  };
};

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

const arxivPaperId = (paper) => {
  const value = [
    paper?.absLink,
    paper?.id,
    paper?.link
  ].map((item) => String(item || "")).find(Boolean) || "";
  const match = value.match(/(?:arxiv\.org\/abs\/|arxiv:|oai:arXiv\.org:)?([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i);
  return match ? match[1].replace(/v\d+$/i, "") : normalizePaperKey(value);
};

const normalizeStoredArxivPaper = (paper) => {
  const id = arxivPaperId(paper);
  const absLink = String(paper.absLink || paper.id || (id ? `https://arxiv.org/abs/${id}` : "")).replace(/^oai:arXiv\.org:/i, "https://arxiv.org/abs/");
  const categories = Array.isArray(paper.categories) ? paper.categories.filter(Boolean).map(String) : [];

  return {
    id: absLink || String(paper.id || ""),
    arxivId: id,
    title: truncate(paper.title, 500),
    authors: Array.isArray(paper.authors) ? paper.authors.slice(0, 30).map((author) => String(author)) : [],
    summary: truncate(paper.summary, 5000),
    published: String(paper.published || paper.updated || ""),
    updated: String(paper.updated || paper.published || ""),
    link: absLink,
    absLink,
    primaryCategory: String(paper.primaryCategory || categories[0] || "arXiv"),
    categories: [...new Set(categories.length ? categories : ["arXiv"])].slice(0, 20),
    storedAt: String(paper.storedAt || new Date().toISOString())
  };
};

const emptyArxivPaperLibrary = () => ({
  version: 1,
  lastSyncedAt: "",
  lastSyncCount: 0,
  lastSyncAdded: 0,
  categories: arxivRssCategories,
  papers: []
});

const readArxivPaperLibrary = async () => {
  if (arxivPaperLibraryMemory) {
    return arxivPaperLibraryMemory;
  }

  try {
    const parsed = JSON.parse(await readFile(arxivPaperLibraryPath, "utf8"));
    arxivPaperLibraryMemory = {
      ...emptyArxivPaperLibrary(),
      ...parsed,
      papers: Array.isArray(parsed.papers)
        ? parsed.papers.map(normalizeStoredArxivPaper).filter((paper) => paper.id && paper.title)
        : []
    };
  } catch {
    arxivPaperLibraryMemory = emptyArxivPaperLibrary();
  }

  return arxivPaperLibraryMemory;
};

const writeArxivPaperLibrary = async (library) => {
  const nextLibrary = {
    ...emptyArxivPaperLibrary(),
    ...library,
    categories: arxivRssCategories,
    papers: Array.isArray(library.papers)
      ? library.papers.map(normalizeStoredArxivPaper).filter((paper) => paper.id && paper.title)
      : []
  };

  arxivPaperLibraryMemory = nextLibrary;
  await mkdir(join(__dirname, ".cache"), { recursive: true });
  await writeFile(arxivPaperLibraryPath, JSON.stringify(nextLibrary, null, 2), "utf8");
  return nextLibrary;
};

const readArxivSyncHistory = async () => {
  if (arxivSyncHistoryMemory) {
    return arxivSyncHistoryMemory;
  }

  try {
    const parsed = JSON.parse(await readFile(arxivSyncHistoryPath, "utf8"));
    arxivSyncHistoryMemory = {
      ...emptyArxivSyncHistory(),
      ...parsed,
      records: Array.isArray(parsed.records)
        ? parsed.records.map(normalizeArxivSyncHistoryEntry).filter((entry) => entry.startedAt)
        : []
    };
  } catch {
    arxivSyncHistoryMemory = emptyArxivSyncHistory();
  }

  return arxivSyncHistoryMemory;
};

const writeArxivSyncHistory = async (history) => {
  const nextHistory = {
    ...emptyArxivSyncHistory(),
    ...history,
    updatedAt: new Date().toISOString(),
    records: Array.isArray(history.records)
      ? history.records.map(normalizeArxivSyncHistoryEntry).filter((entry) => entry.startedAt).slice(0, arxivSyncHistoryLimit)
      : []
  };

  arxivSyncHistoryMemory = nextHistory;
  await mkdir(join(__dirname, ".cache"), { recursive: true });
  await writeFile(arxivSyncHistoryPath, JSON.stringify(nextHistory, null, 2), "utf8");
  return nextHistory;
};

const appendArxivSyncHistory = async (entry) => {
  const history = await readArxivSyncHistory();
  const normalized = normalizeArxivSyncHistoryEntry(entry);
  await writeArxivSyncHistory({
    ...history,
    records: [normalized, ...history.records]
  });
  return normalized;
};

const safeAppendArxivSyncHistory = async (entry) => {
  try {
    return await appendArxivSyncHistory(entry);
  } catch (error) {
    console.warn(`Could not write arXiv sync history: ${error.message}`);
    return null;
  }
};

const mergeArxivPapersIntoLibrary = async (papers, meta = {}) => {
  const library = await readArxivPaperLibrary();
  const byKey = new Map();

  for (const paper of library.papers) {
    const normalized = normalizeStoredArxivPaper(paper);
    byKey.set(arxivPaperId(normalized) || normalizePaperKey(normalized.title), normalized);
  }

  let added = 0;
  let updated = 0;

  for (const paper of papers) {
    const normalized = normalizeStoredArxivPaper(paper);
    const key = arxivPaperId(normalized) || normalizePaperKey(normalized.title);

    if (!key) {
      continue;
    }

    if (byKey.has(key)) {
      const existing = byKey.get(key);

      const hasChanges = (
        existing.title !== normalized.title ||
        existing.summary !== normalized.summary ||
        existing.published !== normalized.published ||
        existing.updated !== normalized.updated ||
        JSON.stringify(existing.authors) !== JSON.stringify(normalized.authors)
      );

      const merged = {
        ...existing,
        ...normalized,
        storedAt: existing.storedAt || normalized.storedAt
      };

      byKey.set(key, merged);

      if (hasChanges) {
        updated += 1;
      }
    } else {
      byKey.set(key, normalized);
      added += 1;
    }
  }

  const merged = [...byKey.values()]
    .sort((a, b) => new Date(b.published || b.updated).getTime() - new Date(a.published || a.updated).getTime());

  const nextLibrary = await writeArxivPaperLibrary({
    ...library,
    lastSyncedAt: meta.updateLastSynced === false ? library.lastSyncedAt : meta.syncedAt || new Date().toISOString(),
    lastSyncCount: papers.length,
    lastSyncAdded: added,
    papers: merged
  });

  return {
    library: nextLibrary,
    added,
    updated,
    total: nextLibrary.papers.length,
    fetched: papers.length
  };
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

const atomEntryCount = (xml) => (String(xml || "").match(/<entry\b/gi) || []).length;

const readArxivCooldown = async () => {
  if (arxivCooldownLoaded) {
    return arxivBlockedUntil;
  }

  arxivCooldownLoaded = true;

  try {
    const entry = JSON.parse(await readFile(arxivCooldownPath, "utf8"));
    const blockedUntil = Number(entry.blockedUntil);
    const updatedAt = Number(entry.updatedAt);
    const recentlyLimited = Number.isFinite(updatedAt) && Date.now() - updatedAt < arxivMaxCooldownMs;
    arxivCooldownFailures = recentlyLimited ? Math.max(0, Number(entry.failures) || 0) : 0;
    const inferredBlockedUntil = recentlyLimited
      ? updatedAt + Math.min(arxivCooldownMs * (2 ** Math.min(arxivCooldownFailures, 3)), arxivMaxCooldownMs)
      : 0;
    const effectiveBlockedUntil = Math.max(Number.isFinite(blockedUntil) ? blockedUntil : 0, inferredBlockedUntil);

    if (effectiveBlockedUntil > Date.now()) {
      arxivBlockedUntil = Math.max(arxivBlockedUntil, effectiveBlockedUntil);
    }
  } catch {
    // Missing cooldown file just means arXiv has not rate-limited this app recently.
  }

  return arxivBlockedUntil;
};

const nextArxiv429Cooldown = (retryAfterMs) => {
  if (retryAfterMs > 0) {
    return Math.min(retryAfterMs, arxivMaxCooldownMs);
  }

  const multiplier = 2 ** Math.min(arxivCooldownFailures, 3);
  return Math.min(arxivCooldownMs * multiplier, arxivMaxCooldownMs);
};

const writeArxivCooldown = async (blockedUntil, returnValue) => {
  arxivBlockedUntil = Math.max(arxivBlockedUntil, blockedUntil);
  arxivCooldownFailures = Math.min(arxivCooldownFailures + 1, 8);

  try {
    await mkdir(join(__dirname, ".cache"), { recursive: true });
    await writeFile(arxivCooldownPath, JSON.stringify({
      blockedUntil: arxivBlockedUntil,
      updatedAt: Date.now(),
      failures: arxivCooldownFailures,
      returnValue
    }), "utf8");
  } catch (error) {
    console.warn(`Could not write arXiv cooldown: ${error.message}`);
  }
};

const clearArxivCooldown = async () => {
  arxivBlockedUntil = 0;
  arxivCooldownFailures = 0;

  try {
    await rm(arxivCooldownPath, { force: true });
  } catch (error) {
    console.warn(`Could not clear arXiv cooldown: ${error.message}`);
  }
};

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

const decodeXml = (value) => String(value || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
  .replace(/&quot;/g, "\"")
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&");

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const xmlTagText = (xml, tagName) => {
  const tag = escapeRegExp(tagName);
  const match = String(xml || "").match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(match?.[1] || "").replace(/\s+/g, " ").trim();
};

const xmlAttribute = (tagXml, name) => {
  const match = String(tagXml || "").match(new RegExp(`${escapeRegExp(name)}\\s*=\\s*["']([^"']+)["']`, "i"));
  return decodeXml(match?.[1] || "").trim();
};

const queryTermGroups = (query) => {
  const extractTerms = (segment) => tokenizeQuery(segment)
    .map((token) => token.trim())
    .filter((token) => token && !["(", ")"].includes(token) && !/^(AND|OR|ANDNOT)$/i.test(token))
    .map((token) => token.replace(/^"|"$/g, "").replace(/^[a-zA-Z]+:/, "").trim())
    .filter((token) => token && !/^submittedDate$/i.test(token) && !/^\[|\]$/.test(token));

  const parenthesized = [...String(query || defaultQuery).matchAll(/\(([^()]+)\)/g)]
    .map((match) => extractTerms(match[1]))
    .filter((terms) => terms.length);

  if (parenthesized.length) {
    return parenthesized;
  }

  const terms = extractTerms(query || defaultQuery);
  return terms.length ? [terms] : [];
};

const textIncludesTerm = (text, term) => {
  const normalizedTerm = String(term || "").trim().toLowerCase();

  if (!normalizedTerm) {
    return false;
  }

  if (normalizedTerm.length <= 3 || /^[a-z0-9.+-]+$/i.test(normalizedTerm)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}([^a-z0-9]|$)`, "i").test(text);
  }

  return text.includes(normalizedTerm);
};

const paperSearchText = (paper) => [
  paper.title,
  paper.summary,
  paper.primaryCategory,
  ...(Array.isArray(paper.categories) ? paper.categories : [])
].join(" ").toLowerCase();

const paperQueryGroupHits = (paper, groups) => {
  const searchable = paperSearchText(paper);
  return groups.map((group) => group.filter((term) => textIncludesTerm(searchable, term)).length);
};

const paperMatchesQueryGroups = (paper, groups) => {
  if (!groups.length) {
    return true;
  }

  return paperQueryGroupHits(paper, groups).every((hitCount) => hitCount > 0);
};

const paperQueryRelevance = (paper, groups) => {
  if (!groups.length) {
    return { matchedGroups: 0, matchedTerms: 0, score: 0 };
  }

  const hits = paperQueryGroupHits(paper, groups);
  const matchedGroups = hits.filter((hitCount) => hitCount > 0).length;
  const matchedTerms = hits.reduce((total, hitCount) => total + hitCount, 0);

  return {
    matchedGroups,
    matchedTerms,
    score: matchedGroups * 100 + matchedTerms
  };
};

const aiQueryGroupIndex = (groups) => groups.findIndex((group) => group.some((term) => {
  const value = String(term || "").toLowerCase();
  return value === "ai"
    || value === "llm"
    || value.includes("machine learning")
    || value.includes("deep learning")
    || value.includes("large language model")
    || value.includes("foundation model");
}));

const parseArxivRssPapers = (xml) => [...String(xml || "").matchAll(/<entry\b[\s\S]*?<\/entry>/gi)]
  .map((match) => {
    const entry = match[0];
    const rawId = xmlTagText(entry, "id");
    const arxivId = rawId.replace(/^oai:arXiv\.org:/i, "");
    const linkTags = [...entry.matchAll(/<link\b[^>]*\/?>/gi)].map((item) => item[0]);
    const alternate = linkTags.find((item) => /rel=["']alternate["']/i.test(item)) || linkTags[0] || "";
    const absLink = xmlAttribute(alternate, "href") || (arxivId ? `https://arxiv.org/abs/${arxivId}` : rawId);
    const categories = [...entry.matchAll(/<category\b[^>]*\bterm=["']([^"']+)["'][^>]*\/?>/gi)]
      .map((item) => decodeXml(item[1]).trim())
      .filter(Boolean);
    const creatorAuthors = xmlTagText(entry, "dc:creator")
      .split(/\s*,\s*/)
      .map((author) => author.trim())
      .filter(Boolean);
    const atomAuthors = [...entry.matchAll(/<author\b[\s\S]*?<\/author>/gi)]
      .map((item) => xmlTagText(item[0], "name"))
      .filter(Boolean);
    const authors = creatorAuthors.length ? creatorAuthors : atomAuthors;
    const summary = xmlTagText(entry, "summary")
      .replace(/^arXiv:\s*\S+\s+Announce Type:\s*\S+\s+Abstract:\s*/i, "")
      .trim();

    return {
      id: absLink || rawId,
      title: xmlTagText(entry, "title"),
      authors,
      summary,
      published: xmlTagText(entry, "published"),
      updated: xmlTagText(entry, "updated"),
      link: absLink,
      absLink,
      primaryCategory: categories[0] || "arXiv",
      categories
    };
  })
  .filter((paper) => paper.id && paper.title && paper.summary);

const fetchLatestArxivRssPapers = async ({ signal, requestId }) => {
  const categories = arxivRssCategories.length ? arxivRssCategories : ["cs.NI", "cs.AI", "cs.LG"];
  const rssUrl = new URL(`https://rss.arxiv.org/atom/${categories.map(encodeURIComponent).join("+")}`);

  setPaperRequestStatus(requestId, "arxiv-rss", `正在同步 arXiv RSS：${categories.join(", ")}。`);
  setPaperRequestStatus(requestId, "arxiv-rss", "正在连接 arXiv...", "running");
  const response = await fetchArxivQueued(rssUrl, signal);

  if (!response.ok) {
    throw responseSourceError("arXiv RSS", await readResponseReturnValue("arXiv RSS", response));
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  let downloadedBytes = 0;
  const chunks = [];
  let lastProgressUpdate = 0;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      downloadedBytes += value.length;
      chunks.push(value);

      const now = Date.now();
      if (now - lastProgressUpdate > 500) {
        if (contentLength > 0) {
          const percent = Math.round((downloadedBytes / contentLength) * 100);
          const sizeMB = (downloadedBytes / 1024 / 1024).toFixed(1);
          setPaperRequestStatus(requestId, "arxiv-rss", `正在下载论文列表 ${percent}% (${sizeMB} MB)...`, "running");
        } else {
          const sizeMB = (downloadedBytes / 1024 / 1024).toFixed(1);
          setPaperRequestStatus(requestId, "arxiv-rss", `正在下载论文列表 (${sizeMB} MB)...`, "running");
        }
        lastProgressUpdate = now;
      }
    }

    setPaperRequestStatus(requestId, "arxiv-rss", "正在解析数据...", "running");
    const xml = decoder.decode(Buffer.concat(chunks));

    if (/Feed error for query/i.test(xml)) {
      const error = new Error(`arXiv RSS 不接受当前分类组合：${categories.join(", ")}`);
      error.detail = error.message;
      throw error;
    }

    setPaperRequestStatus(requestId, "arxiv-rss", "正在提取论文信息...", "running");

    const papers = parseArxivRssPapers(xml)
      .sort((a, b) => new Date(b.published || b.updated).getTime() - new Date(a.published || a.updated).getTime());

    setPaperRequestStatus(requestId, "arxiv-rss", "同步完成", "done");

    return papers;
  } finally {
    reader.releaseLock();
  }
};

const syncArxivPaperLibrary = async ({ force = false, requestId = "", signal, trigger = "unknown" } = {}) => {
  const run = async () => {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const library = await readArxivPaperLibrary();
    const lastSyncedAt = Date.parse(library.lastSyncedAt || "");
    const fresh = Number.isFinite(lastSyncedAt) && Date.now() - lastSyncedAt < arxivDailySyncMs;

    if (!force && fresh) {
      setPaperRequestStatus(requestId, "arxiv-library", `本地库今日已同步，共 ${library.papers.length} 篇论文。`, "running");
      const finishedAt = new Date().toISOString();
      const syncHistory = await safeAppendArxivSyncHistory({
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
        status: "skipped",
        trigger,
        force,
        requestId,
        categories: arxivRssCategories,
        total: library.papers.length,
        message: "Local arXiv library is still fresh."
      });
      return {
        library,
        skipped: true,
        syncHistory,
        added: 0,
        updated: 0,
        fetched: 0,
        total: library.papers.length
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240000);
    const syncSignal = signal || controller.signal;

    try {
      let papers;
      let retryCount = 0;
      const maxRetries = 1;

      while (retryCount <= maxRetries) {
        try {
          papers = await fetchLatestArxivRssPapers({ signal: syncSignal, requestId });
          break;
        } catch (error) {
          retryCount += 1;
          if (retryCount > maxRetries) {
            throw error;
          }
          setPaperRequestStatus(requestId, "arxiv-library", `连接失败，正在重试 (${retryCount}/${maxRetries})...`, "running");
          await sleep(2000);
        }
      }

      setPaperRequestStatus(requestId, "arxiv-library", "正在保存到本地库...", "running");
      const result = await mergeArxivPapersIntoLibrary(papers, { syncedAt: new Date().toISOString() });
      const finishedAt = new Date().toISOString();
      const syncHistory = await safeAppendArxivSyncHistory({
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
        status: "success",
        trigger,
        force,
        requestId,
        categories: arxivRssCategories,
        fetched: result.fetched,
        added: result.added,
        updated: result.updated,
        total: result.total,
        message: `Fetched ${result.fetched}, added ${result.added}, updated ${result.updated}.`
      });
      setPaperRequestStatus(requestId, "arxiv-library", `同步完成：获取 ${result.fetched} 篇，新增 ${result.added} 篇`, "done");
      return {
        ...result,
        syncHistory,
        skipped: false
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      await safeAppendArxivSyncHistory({
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
        status: "failed",
        trigger,
        force,
        requestId,
        categories: arxivRssCategories,
        total: library.papers.length,
        message: error.message || "arXiv sync failed.",
        error: {
          code: error.code || "ARXIV_SYNC_FAILED",
          message: error.message || "arXiv sync failed.",
          detail: error.detail || error.message || ""
        }
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  if (arxivSyncInflight) {
    return arxivSyncInflight;
  }

  arxivSyncInflight = run().finally(() => {
    arxivSyncInflight = null;
  });

  return arxivSyncInflight;
};

const runArxivAutoSync = async (reason = "scheduled") => {
  try {
    const result = await syncArxivPaperLibrary({ force: false, trigger: `auto-${reason}` });
    const action = result.skipped ? "skipped" : "synced";
    console.log(`[arXiv auto sync] ${action} (${reason}): fetched=${result.fetched}, added=${result.added}, updated=${result.updated}, total=${result.total}`);
    return true;
  } catch (error) {
    console.error(`[arXiv auto sync] failed (${reason}): ${error.stack || error.message}`);
    return false;
  }
};

const nextArxivAutoSyncDelay = async () => {
  const library = await readArxivPaperLibrary();
  const lastSyncedAt = Date.parse(library.lastSyncedAt || "");

  if (!Number.isFinite(lastSyncedAt)) {
    return 0;
  }

  return Math.max(0, lastSyncedAt + arxivDailySyncMs - Date.now());
};

const scheduleArxivAutoSync = async (reason = "scheduled", delayOverrideMs = null) => {
  if (!arxivAutoSyncEnabled) {
    return;
  }

  if (arxivAutoSyncTimer) {
    clearTimeout(arxivAutoSyncTimer);
    arxivAutoSyncTimer = null;
  }

  let delayMs = 0;

  if (delayOverrideMs !== null) {
    delayMs = Number.isFinite(delayOverrideMs) && delayOverrideMs >= 0
      ? delayOverrideMs
      : 60 * 60 * 1000;
  } else {
    try {
      delayMs = await nextArxivAutoSyncDelay();
    } catch (error) {
      console.error(`[arXiv auto sync] could not read last sync time: ${error.stack || error.message}`);
      delayMs = Number.isFinite(arxivAutoSyncRetryMs) && arxivAutoSyncRetryMs > 0
        ? arxivAutoSyncRetryMs
        : 60 * 60 * 1000;
    }
  }

  arxivAutoSyncTimer = setTimeout(async () => {
    arxivAutoSyncTimer = null;
    const success = await runArxivAutoSync(reason);
    await scheduleArxivAutoSync(success ? "next-due" : "retry", success ? null : arxivAutoSyncRetryMs);
  }, delayMs);

  const nextAt = new Date(Date.now() + delayMs).toISOString();
  console.log(`[arXiv auto sync] next run (${reason}) at ${nextAt}.`);
};

const startArxivAutoSync = () => {
  if (!arxivAutoSyncEnabled) {
    console.log("[arXiv auto sync] disabled.");
    return;
  }

  const initialDelayMs = Number.isFinite(arxivAutoSyncInitialDelayMs) && arxivAutoSyncInitialDelayMs >= 0
    ? arxivAutoSyncInitialDelayMs
    : 30 * 1000;

  arxivAutoSyncTimer = setTimeout(async () => {
    arxivAutoSyncTimer = null;
    await scheduleArxivAutoSync("startup");
  }, initialDelayMs);
  console.log(`[arXiv auto sync] enabled: startup check in ${initialDelayMs}ms.`);
};

const selectArxivLibraryPapers = ({ library, rawQuery, days, maxResults, start = 0 }) => {
  const earliest = days > 0 ? Date.now() - days * 86400000 : 0;
  const groups = queryTermGroups(rawQuery);
  const datedPapers = (Array.isArray(library.papers) ? library.papers : [])
    .filter((paper) => {
      if (!earliest) {
        return true;
      }

      const time = new Date(paper.published || paper.updated).getTime();
      return Number.isFinite(time) && time >= earliest;
    });
  const strict = datedPapers
    .filter((paper) => paperMatchesQueryGroups(paper, groups))
    .sort((a, b) => new Date(b.published || b.updated).getTime() - new Date(a.published || a.updated).getTime());
  const unique = [];
  const seen = new Set();

  appendUniquePapers(unique, seen, strict, Number.MAX_SAFE_INTEGER);
  const strictTotal = unique.length;
  const strictKeys = new Set(unique.map((paper) => arxivPaperId(paper) || normalizePaperKey(paper.title)));
  const needed = start + maxResults;
  const aiGroupIndex = aiQueryGroupIndex(groups);

  if (unique.length < needed && groups.length > 1) {
    const relaxed = datedPapers
      .map((paper) => ({ paper, relevance: paperQueryRelevance(paper, groups) }))
      .filter((entry) => {
        const hits = paperQueryGroupHits(entry.paper, groups);

        if (aiGroupIndex >= 0) {
          return hits[aiGroupIndex] > 0 && entry.relevance.matchedGroups >= 2;
        }

        return entry.relevance.matchedGroups >= Math.max(2, groups.length - 1);
      })
      .sort((a, b) => (
        b.relevance.score - a.relevance.score
        || new Date(b.paper.published || b.paper.updated).getTime() - new Date(a.paper.published || a.paper.updated).getTime()
      ))
      .map((entry) => entry.paper);

    appendUniquePapers(unique, seen, relaxed, Number.MAX_SAFE_INTEGER);
  }

  const papers = unique.slice(start, start + maxResults);

  return {
    papers,
    strictTotal,
    relaxedTotal: Math.max(0, unique.length - strictTotal),
    totalMatched: unique.length,
    relaxedUsed: papers.some((paper) => !strictKeys.has(arxivPaperId(paper) || normalizePaperKey(paper.title)))
  };
};

const isArxivSource = (source) => source === "arxiv" || source === "arxiv-rss" || source === "arxiv-library";

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
    if (size > 3_000_000) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
};

const booleanEnv = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(String(value));
};

const stripHeaderValue = (value) => String(value || "").replace(/[\r\n]+/g, " ").trim();

const extractEmailAddress = (value) => {
  const text = stripHeaderValue(value);
  const match = text.match(/<([^>]+)>/);
  return (match ? match[1] : text).trim();
};

const normalizeEmailAddress = (value) => {
  const email = extractEmailAddress(value);

  if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(email)) {
    const error = new Error(`Invalid email address: ${email || "(empty)"}`);
    error.code = "INVALID_EMAIL";
    throw error;
  }

  return email;
};

const getSmtpConfig = () => {
  const host = String(process.env.SMTP_HOST || "").trim();
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "");
  const fromRaw = String(process.env.SMTP_FROM || user || "").trim();

  if (!host || !fromRaw) {
    return null;
  }

  const secureFallback = Number(process.env.SMTP_PORT || 0) === 465;
  const secure = booleanEnv(process.env.SMTP_SECURE, secureFallback);
  const port = Number(process.env.SMTP_PORT || (secure ? 465 : 587));

  return {
    host,
    port,
    secure,
    startTls: !secure && booleanEnv(process.env.SMTP_STARTTLS, port === 587),
    rejectUnauthorized: !/^(0|false|no)$/i.test(String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || "1")),
    user,
    pass,
    from: normalizeEmailAddress(fromRaw),
    to: normalizeEmailAddress(readingListEmailTo)
  };
};

const encodeMailHeader = (value) => {
  const text = stripHeaderValue(value);
  return /^[\x20-\x7e]*$/.test(text)
    ? text
    : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
};

const wrapBase64 = (value) => String(value || "").replace(/.{1,76}/g, "$&\r\n").trimEnd();

const dotStuffSmtpData = (value) => String(value || "")
  .replace(/\r?\n/g, "\r\n")
  .replace(/^\./gm, "..");

const createSmtpSession = (socket) => {
  socket.setEncoding("utf8");
  socket.setTimeout(smtpTimeoutMs);

  let buffer = "";
  let pending = null;

  const parseResponse = () => {
    const lines = [];
    let consumed = 0;

    while (true) {
      const lineEnd = buffer.indexOf("\n", consumed);

      if (lineEnd < 0) {
        return null;
      }

      const line = buffer.slice(consumed, lineEnd).replace(/\r$/, "");
      lines.push(line);
      consumed = lineEnd + 1;

      if (/^\d{3} /.test(line)) {
        const code = Number(line.slice(0, 3));
        const rest = buffer.slice(consumed);
        buffer = rest;
        return { code, lines, message: lines.join("\n") };
      }
    }
  };

  const flush = () => {
    if (!pending) {
      return;
    }

    const response = parseResponse();
    if (response) {
      const { resolve } = pending;
      pending = null;
      resolve(response);
    }
  };

  const fail = (error) => {
    if (pending) {
      const { reject } = pending;
      pending = null;
      reject(error);
    }
  };

  socket.on("data", (chunk) => {
    buffer += chunk;
    flush();
  });

  socket.on("timeout", () => {
    socket.destroy(new Error("SMTP connection timed out."));
  });

  socket.on("error", fail);
  socket.on("close", () => {
    fail(new Error("SMTP connection closed before response."));
  });

  return {
    socket,
    readResponse: () => new Promise((resolve, reject) => {
      pending = { resolve, reject };
      flush();
    }),
    writeLine: (line) => {
      socket.write(`${line}\r\n`);
    },
    detach: () => {
      socket.removeAllListeners("data");
      socket.removeAllListeners("timeout");
      socket.removeAllListeners("error");
      socket.removeAllListeners("close");
    }
  };
};

const openSmtpSocket = (config) => new Promise((resolve, reject) => {
  const socket = config.secure
    ? tls.connect({
      host: config.host,
      port: config.port,
      servername: config.host,
      rejectUnauthorized: config.rejectUnauthorized
    })
    : net.createConnection({ host: config.host, port: config.port });
  const eventName = config.secure ? "secureConnect" : "connect";

  const cleanup = () => {
    socket.removeListener(eventName, handleConnect);
    socket.removeListener("error", handleError);
  };
  const handleConnect = () => {
    cleanup();
    resolve(socket);
  };
  const handleError = (error) => {
    cleanup();
    reject(error);
  };

  socket.once(eventName, handleConnect);
  socket.once("error", handleError);
  socket.setTimeout(smtpTimeoutMs, () => {
    socket.destroy(new Error("SMTP connection timed out."));
  });
});

const smtpCommand = async (session, command, expectedCodes, context = command) => {
  if (command) {
    session.writeLine(command);
  }

  const response = await session.readResponse();

  if (!expectedCodes.includes(response.code)) {
    const error = new Error(`SMTP ${context} failed: ${response.message}`);
    error.code = "SMTP_COMMAND_FAILED";
    error.smtpCode = response.code;
    throw error;
  }

  return response;
};

const smtpEhlo = async (session) => {
  try {
    return await smtpCommand(session, "EHLO paper-insight.local", [250], "EHLO");
  } catch {
    return smtpCommand(session, "HELO paper-insight.local", [250], "HELO");
  }
};

const upgradeSmtpStartTls = (session, config) => new Promise((resolve, reject) => {
  session.detach();
  const tlsSocket = tls.connect({
    socket: session.socket,
    servername: config.host,
    rejectUnauthorized: config.rejectUnauthorized
  });

  tlsSocket.once("secureConnect", () => resolve(createSmtpSession(tlsSocket)));
  tlsSocket.once("error", reject);
});

const smtpAuthenticate = async (session, config) => {
  if (!config.user || !config.pass) {
    return;
  }

  const authPlain = Buffer.from(`\0${config.user}\0${config.pass}`, "utf8").toString("base64");

  try {
    await smtpCommand(session, `AUTH PLAIN ${authPlain}`, [235, 503], "AUTH PLAIN");
    return;
  } catch (error) {
    if (![500, 502, 504].includes(error.smtpCode)) {
      throw error;
    }
  }

  await smtpCommand(session, "AUTH LOGIN", [334], "AUTH LOGIN");
  await smtpCommand(session, Buffer.from(config.user, "utf8").toString("base64"), [334], "AUTH LOGIN username");
  await smtpCommand(session, Buffer.from(config.pass, "utf8").toString("base64"), [235, 503], "AUTH LOGIN password");
};

const buildReadingListEmailMessage = ({ from, to, title, markdown }) => {
  const subject = `[Paper Insight] ${title || "每周高价值论文阅读清单"}`;
  const messageIdSeed = createHash("sha1").update(`${Date.now()}:${to}:${subject}`).digest("hex").slice(0, 24);
  const body = [
    "以下内容由 Paper Insight 生成。",
    "",
    String(markdown || "").trim(),
    ""
  ].join("\n");

  return [
    `From: <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeMailHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageIdSeed}@paper-insight.local>`,
    "MIME-Version: 1.0",
    'Content-Type: text/markdown; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(body, "utf8").toString("base64"))
  ].join("\r\n");
};

const sendSmtpMail = async ({ title, markdown }) => {
  const config = getSmtpConfig();

  if (!config) {
    const error = new Error("邮件服务未配置。请在服务端设置 SMTP_HOST、SMTP_FROM，并按需设置 SMTP_USER/SMTP_PASS。");
    error.code = "SMTP_NOT_CONFIGURED";
    throw error;
  }

  let session = createSmtpSession(await openSmtpSocket(config));

  try {
    await smtpCommand(session, "", [220], "greeting");
    await smtpEhlo(session);

    if (config.startTls) {
      await smtpCommand(session, "STARTTLS", [220], "STARTTLS");
      session = await upgradeSmtpStartTls(session, config);
      await smtpEhlo(session);
    }

    await smtpAuthenticate(session, config);
    await smtpCommand(session, `MAIL FROM:<${config.from}>`, [250], "MAIL FROM");
    await smtpCommand(session, `RCPT TO:<${config.to}>`, [250, 251], "RCPT TO");
    await smtpCommand(session, "DATA", [354], "DATA");

    const message = buildReadingListEmailMessage({
      from: config.from,
      to: config.to,
      title,
      markdown
    });
    session.socket.write(`${dotStuffSmtpData(message)}\r\n.\r\n`);
    await smtpCommand(session, "", [250], "message body");

    try {
      await smtpCommand(session, "QUIT", [221], "QUIT");
    } catch {
      // The message has already been accepted by the SMTP server.
    }

    return { to: config.to };
  } finally {
    session.socket.end();
  }
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
  categories: Array.isArray(paper.categories) ? paper.categories.slice(0, 12).map((category) => String(category)) : [],
  candidateSource: truncate(paper.candidateSource, 80),
  candidateSourceLabel: truncate(paper.candidateSourceLabel, 120),
  candidateSourceDetail: truncate(paper.candidateSourceDetail, 240),
  candidateFetchedAt: String(paper.candidateFetchedAt || "")
});

const sanitizeReadingListPaper = (paper) => {
  const sanitized = sanitizePaper(paper);
  const analysis = paper?.analysis || {};

  return {
    ...sanitized,
    analysis: {
      score: Math.round(clamp(analysis.score ?? 0)),
      tldr: truncate(analysis.tldr, 420),
      problem: truncate(analysis.problem, 900),
      background: truncate(analysis.background, 900),
      method: truncate(analysis.method, 1200),
      technicalDetails: truncate(analysis.technicalDetails, 1600),
      contribution: truncate(analysis.contribution, 900),
      experiment: truncate(analysis.experiment, 900),
      networkUseCase: truncate(analysis.networkUseCase, 900),
      limitations: truncate(analysis.limitations, 800),
      recommendedReadingPath: truncate(analysis.recommendedReadingPath, 800),
      whyRecommend: truncate(analysis.whyRecommend, 900),
      readingGuide: Array.isArray(analysis.readingGuide)
        ? analysis.readingGuide.slice(0, 8).map((item) => truncate(item, 180)).filter(Boolean)
        : [],
      matchedKeywords: Array.isArray(analysis.matchedKeywords)
        ? analysis.matchedKeywords.slice(0, 16).map((item) => truncate(item, 80)).filter(Boolean)
        : []
    }
  };
};

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

const llmProviderDefaults = {
  deepseek: {
    mode: "deepseek",
    protocol: "openai",
    model: "deepseek-v4-flash",
    endpoint: "https://api.deepseek.com/chat/completions",
    apiKey: () => process.env.DEEPSEEK_API_KEY,
    modelEnv: () => process.env.DEEPSEEK_MODEL,
    endpointEnv: () => process.env.DEEPSEEK_API_URL,
    disableThinking: true
  },
  glm: {
    mode: "glm",
    protocol: "openai",
    model: "glm-5.1",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    apiKey: () => process.env.GLM_API_KEY,
    modelEnv: () => process.env.GLM_MODEL,
    endpointEnv: () => process.env.GLM_API_URL,
    disableThinking: true
  },
  "glm-coding": {
    mode: "glm-coding",
    protocol: "openai",
    model: "glm-5.1",
    endpoint: "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
    apiKey: () => process.env.GLM_CODING_API_KEY,
    modelEnv: () => process.env.GLM_CODING_MODEL,
    endpointEnv: () => process.env.GLM_CODING_OPENAI_API_URL || process.env.GLM_CODING_API_URL,
    disableThinking: true
  },
  "glm-coding-anthropic": {
    mode: "glm-coding-anthropic",
    protocol: "anthropic",
    model: "glm-5.1",
    endpoint: "https://open.bigmodel.cn/api/anthropic/v1/messages",
    apiKey: () => process.env.GLM_CODING_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN,
    modelEnv: () => process.env.GLM_CODING_MODEL || process.env.ANTHROPIC_MODEL,
    endpointEnv: () => process.env.GLM_CODING_ANTHROPIC_API_URL || process.env.ANTHROPIC_BASE_URL || process.env.GLM_CODING_API_URL,
    disableThinking: false
  },
  openai: {
    mode: "llm",
    protocol: "openai",
    model: "gpt-4o-mini",
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: () => process.env.OPENAI_API_KEY,
    modelEnv: () => process.env.OPENAI_MODEL,
    endpointEnv: () => process.env.OPENAI_API_URL,
    disableThinking: false
  }
};

const normalizeLlmProvider = (provider) => {
  const value = String(provider || "").toLowerCase().trim();
  if (["glm-coding", "glm_coding", "glm-coding-openai", "coding", "coding-plan", "coding_plan", "coding-openai", "coding-plan-openai"].includes(value)) {
    return "glm-coding";
  }
  if (["glm-coding-anthropic", "glm_coding_anthropic", "coding-anthropic", "coding-plan-anthropic", "anthropic-glm"].includes(value)) {
    return "glm-coding-anthropic";
  }
  if (["zhipu", "zhipuai", "bigmodel"].includes(value)) {
    return "glm";
  }
  if (["deepseek", "glm", "openai"].includes(value)) {
    return value;
  }
  return "";
};

const inferLlmProvider = (overrides = {}) => {
  const requested = normalizeLlmProvider(overrides.provider || process.env.LLM_PROVIDER);

  if (requested) {
    return requested;
  }

  if (process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_BASE_URL) {
    return "glm-coding-anthropic";
  }

  if (process.env.GLM_CODING_API_KEY) {
    return "glm-coding";
  }

  if (process.env.GLM_API_KEY) {
    return "glm";
  }

  if (process.env.DEEPSEEK_API_KEY) {
    return "deepseek";
  }

  return "openai";
};

const getLlmConfig = (overrides = {}) => {
  const provider = inferLlmProvider(overrides);
  const defaults = llmProviderDefaults[provider] || llmProviderDefaults.openai;
  const apiKey = String(overrides.apiKey || "").trim()
    || process.env.LLM_API_KEY
    || defaults.apiKey()
    || process.env.OPENAI_API_KEY
    || process.env.DEEPSEEK_API_KEY
    || process.env.GLM_API_KEY
    || process.env.GLM_CODING_API_KEY
    || process.env.ANTHROPIC_AUTH_TOKEN;
  const model = String(overrides.model || "").trim()
    || process.env.LLM_MODEL
    || defaults.modelEnv()
    || defaults.model;
  const rawEndpoint = String(overrides.endpoint || "").trim()
    || process.env.LLM_API_URL
    || defaults.endpointEnv()
    || defaults.endpoint;
  let endpoint = rawEndpoint;
  if (defaults.protocol === "anthropic" && !/\/v1\/messages\/?$/i.test(rawEndpoint)) {
    endpoint = `${rawEndpoint.replace(/\/+$/, "")}/v1/messages`;
  } else if (provider === "glm-coding" && !/\/chat\/completions\/?$/i.test(rawEndpoint)) {
    endpoint = `${rawEndpoint.replace(/\/+$/, "")}/chat/completions`;
  }

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    endpoint,
    model,
    provider,
    protocol: defaults.protocol,
    mode: defaults.mode,
    disableThinking: defaults.disableThinking && !process.env.LLM_API_URL
  };
};

const llmTextFromResponse = (data, protocol = "openai") => {
  if (protocol === "anthropic") {
    if (typeof data.content === "string") {
      return data.content;
    }

    if (Array.isArray(data.content)) {
      return data.content
        .map((item) => typeof item === "string" ? item : item?.text || "")
        .filter(Boolean)
        .join("\n");
    }
  }

  return data.choices?.[0]?.message?.content || data.output_text || "";
};

const llmHeaders = (config) => config.protocol === "anthropic"
  ? {
      "authorization": `Bearer ${config.apiKey}`,
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    }
  : {
      "authorization": `Bearer ${config.apiKey}`,
      "content-type": "application/json"
    };

const callLlmAnalyzer = async ({ query, papers, llm }) => {
  const config = getLlmConfig(llm);

  if (!config) {
    const error = new Error("未配置 DeepSeek、GLM、GLM Coding Plan 或 OpenAI 兼容 API key。");
    error.code = "LLM_NOT_CONFIGURED";
    throw error;
  }

  const { endpoint, model, disableThinking, protocol } = config;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), llmRequestTimeoutMs);

  try {
    const payload = {
      model,
      temperature: 0.2,
      max_tokens: llmMaxOutputTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你是网络通信和 AI 论文推荐助手。",
            "请优先使用给定的论文标题、作者、arXiv/DOI/论文链接在网上搜索论文原文页面、PDF、HTML、出版页、代码页或项目页，并基于可核对到的论文原文和公开页面做详细分析。",
            "如果当前 API 环境无法联网检索、无法打开链接或无法读取论文原文，必须在 limitations 和 whyRecommend 中明确说明检索限制，只能基于输入的摘要和元数据分析，不要假装读过全文。",
            "请用中文输出，给每篇论文计算 0 到 100 的推荐分，并按指定维度给出分项分。",
            "分析正文要尽量具体、完整、可读：把问题背景、方法机制、技术路线、实验可信度、网络应用价值、局限和阅读路径写成可以直接帮助研究人员快速判断论文价值的内容。",
            "如果只能基于摘要分析，也要明确区分事实、合理推断和需要打开原文核验的部分。",
            "只返回 JSON，不要输出 Markdown。"
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            query,
            onlineSearchInstruction: "对每篇论文先用 title、authors、absLink、link 检索并核对公开论文信息。优先阅读论文原始页面、arXiv PDF/HTML、DOI 出版页、作者项目页或代码仓库；公开元数据页只能作为辅助线索，不能替代论文原文；无法访问时必须如实说明。",
            dimensions,
            outputSchema: {
              recommendations: [
                {
                  id: "paper id",
                  score: "0-100 integer",
                  scores: {
                    scenarioProblemValue: "0-100",
                    methodNovelty: "0-100",
                    practicalValue: "0-100",
                    evidence: "0-100"
                  },
                  tldr: "一句话概要，说明论文核心价值",
                  problem: "论文解决的问题，至少 180 字",
                  background: "研究背景、业务/技术动机、为什么这个问题重要，至少 300 字",
                  method: "核心方法或系统思路，至少 350 字",
                  technicalDetails: "技术细节、模型/算法/系统设计、关键模块、输入输出、训练/推理流程、数据流和与网络场景的结合方式，至少 600 字",
                  contribution: "主要贡献，至少 220 字",
                  experiment: "实验设置、数据集、指标、基线、结果可信度、消融/鲁棒性/泛化线索和需要核验的点，至少 320 字",
                  networkUseCase: "对网络/电信/5G/6G的潜在价值、适用场景、落地前提和可能收益，至少 280 字",
                  limitations: "从摘要和元数据可见的不足、风险、假设、泛化边界和需要进一步确认点，至少 220 字",
                  recommendedReadingPath: "建议快速阅读这篇论文时按什么顺序读，每部分重点看什么，如何判断是否值得深入复现，至少 240 字",
                  readingGuide: ["快速阅读建议1", "快速阅读建议2", "快速阅读建议3", "快速阅读建议4", "快速阅读建议5", "快速阅读建议6"],
                  matchedKeywords: ["命中的关键词"],
                  whyRecommend: "为什么进入或接近推荐列表，包含分数解释和适合/不适合推荐的理由，至少 220 字"
                }
              ]
            },
            papers: papers.map((paper) => ({
              id: paper.id,
              title: paper.title,
              authors: paper.authors,
              categories: paper.categories,
              primaryCategory: paper.primaryCategory,
              published: paper.published,
              updated: paper.updated,
              absLink: paper.absLink,
              link: paper.link,
              summary: paper.summary
            }))
          })
        }
      ]
    };

    if (protocol === "anthropic") {
      const [systemMessage, userMessage] = payload.messages;
      payload.system = systemMessage.content;
      payload.messages = [userMessage];
      delete payload.response_format;
    }

    if (disableThinking && protocol === "openai") {
      payload.thinking = { type: "disabled" };
    }

    const llmResponse = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: llmHeaders(config),
      body: JSON.stringify(payload)
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      throw new Error(`LLM request failed with ${llmResponse.status}: ${truncate(redactSensitive(errorText), 300)}`);
    }

    const data = await llmResponse.json();
    const content = llmTextFromResponse(data, protocol);
    const parsed = extractJson(content);
    return Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutSeconds = Math.round(llmRequestTimeoutMs / 1000);
      const timeoutError = new Error(`LLM 请求超过 ${timeoutSeconds} 秒未完成，已自动中止。请稍后重试，或通过 LLM_REQUEST_TIMEOUT_MS 调大超时时间。`);
      timeoutError.code = "LLM_ANALYSIS_TIMEOUT";
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const callLlmTranslation = async ({ title, summary, llm }) => {
  const config = getLlmConfig(llm);

  if (!config) {
    const error = new Error("未配置 DeepSeek、GLM、GLM Coding Plan 或 OpenAI 兼容 API key。");
    error.code = "LLM_NOT_CONFIGURED";
    throw error;
  }

  const { endpoint, model, disableThinking, protocol } = config;
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

    if (protocol === "anthropic") {
      const [systemMessage, userMessage] = payload.messages;
      payload.system = systemMessage.content;
      payload.messages = [userMessage];
    }

    if (disableThinking && protocol === "openai") {
      payload.thinking = { type: "disabled" };
    }

    const llmResponse = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: llmHeaders(config),
      body: JSON.stringify(payload)
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      throw new Error(`LLM request failed with ${llmResponse.status}: ${truncate(redactSensitive(errorText), 300)}`);
    }

    const data = await llmResponse.json();
    return ensureLlmResponseWithinLimit(llmTextFromResponse(data, protocol));
  } finally {
    clearTimeout(timeout);
  }
};

const callLlmReadingList = async ({ report, papers, llm }) => {
  const config = getLlmConfig(llm);

  if (!config) {
    const error = new Error("未配置 DeepSeek、GLM、GLM Coding Plan 或 OpenAI 兼容 API key。");
    error.code = "LLM_NOT_CONFIGURED";
    throw error;
  }

  const { endpoint, model, disableThinking, protocol } = config;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), llmRequestTimeoutMs);

  try {
    const title = truncate(report.title, 120) || "每周高价值论文阅读清单";
    const payload = {
      model,
      temperature: 0.25,
      max_tokens: llmMaxOutputTokens,
      messages: [
        {
          role: "system",
          content: [
            "你是一名面向科研读者和技术负责人的论文周报编辑。",
            "请基于输入中的高价值论文列表，生成一篇适合发布到洞察网站的中文 Markdown 阅读清单。",
            "读者重点关注大模型、智能体、网络自治、网络数字孪生、系统架构与工程化集成，以及华为 ADN（Autonomous Driving Network，自智网络/自动驾驶网络）相关研究。",
            "这份清单要帮助读者快速判断：本周哪些论文值得读、每篇文章做了什么、为什么值得读、它对 ADN 网络研究有什么启发、应该按什么顺序读。",
            "输出必须是 Markdown 正文，不要使用代码围栏，不要输出额外解释。"
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            report: {
              title,
              date: report.date,
              month: report.month,
              weekOfMonth: report.weekOfMonth,
              sourceReport: report.sourceReport,
              paperCount: papers.length,
              tags: ["大模型", "智能体", "网络自治", "网络数字孪生", "系统架构", "华为 ADN"]
            },
            instruction: [
              `请生成「${title}」。`,
              "标题格式固定为：{year} 年 {month} 月第 {weekOfMonth} 周高价值论文阅读清单。",
              "输出必须包含 YAML front matter 和正文标题。",
              "报告导读要说明本周收录概况、最值得关注的 2-4 篇论文、以及对 ADN 网络研究最有价值的研究信号。不要在导读里再写一组独立的阅读建议，避免和后面的阅读顺序重复。",
              "增加「本周趋势判断」章节，提炼 3-5 条趋势。每条趋势都要说明：技术信号是什么、为什么值得关注、成熟度或风险如何、它和华为 ADN 的意图驱动、闭环自治、网络数字孪生、网络智能体、跨域协同、自治运维或评估体系有什么关系。",
              "方向标签要尽量正交，不要把系统架构/工程化集成和网络数字孪生、网络智能体、自治闭环混作同一层级。每篇论文的方向用「主问题域 / 关键支撑技术」表达：主问题域优先从自治闭环与意图驱动、网络数字孪生与仿真评估、网络智能体与多智能体协同、网络基础模型与表征学习、系统架构与工程化集成、可信评估与安全可靠中选择；关键支撑技术再补充 LLM、Agent、RAG、工具调用、仿真平台、评测基准等。",
              "每篇论文都要重点介绍文章内容：研究问题、方法或系统设计、实验/验证方式、主要结论。不要只写推荐理由。",
              "每篇论文都必须补充「洞察观点与 ADN 启发」小节。这个小节要从华为 ADN 网络研究视角提炼观点，说明它对网络自治分级、意图理解、闭环控制、数字孪生环境、智能体编排、故障自愈、体验保障、可观测性、可评估性或落地架构的启发。不要泛泛而谈，要指出可借鉴的机制、可验证的假设或需要规避的风险。",
              "论文条目按照「本周必读」「值得跟进」「快速扫读」分层组织。输入论文数量少时可以减少层级，但完整论文清单必须覆盖全部论文。",
              "「本周趋势判断」必须综合多篇论文，不能只是单篇论文摘要。可以包含研究机会、工程落地约束和下一步值得跟踪的问题。",
              "「推荐阅读顺序」要给出实际阅读路线和原因，只保留这一处阅读优先级建议，不要再新增独立的精简阅读、优先三篇或快速取舍章节。",
              "不要在发布内容中体现内部筛选阈值、推荐阈值或具体推荐分数。可以表达阅读级别和推荐原因，但不要输出分数列、推荐分字段或阈值说明。",
              "完整论文清单放在最后，表格列为：论文、一句话介绍、阅读级别、链接。不要在完整论文清单里放方向、主问题域、关键支撑技术或分数字段；一句话介绍要概括文章做了什么或为什么值得关注。"
            ].join("\n"),
            outputTemplate: [
              "---",
              `title: \"${title}\"`,
              `date: \"${report.date}\"`,
              `month: \"${report.month}\"`,
              `week_of_month: ${report.weekOfMonth}`,
              "category: \"论文周报\"",
              "tags:",
              "  - 大模型",
              "  - 智能体",
              "  - 网络自治",
              "  - 网络数字孪生",
              "  - 系统架构",
              "  - 华为 ADN",
              `paper_count: ${papers.length}`,
              "---",
              "",
              `# ${title}`,
              "",
              "## 报告导读",
              "",
              "## 本周趋势判断",
              "",
              "## 本周必读",
              "",
              "### 1. 论文标题",
              "",
              "- 主问题域：",
              "- 关键支撑技术：",
              "- 链接：",
              "",
              "**文章内容**",
              "",
              "**为什么值得读**",
              "",
              "**洞察观点与 ADN 启发**",
              "",
              "**重点看什么**",
              "",
              "**适合谁读**",
              "",
              "**局限提醒**",
              "",
              "## 值得跟进",
              "",
              "## 快速扫读",
              "",
              "## 推荐阅读顺序",
              "",
              "## 完整论文清单",
              "",
              "| 论文 | 一句话介绍 | 阅读级别 | 链接 |",
              "| --- | --- | --- | --- |"
            ].join("\n"),
            papers
          })
        }
      ]
    };

    if (protocol === "anthropic") {
      const [systemMessage, userMessage] = payload.messages;
      payload.system = systemMessage.content;
      payload.messages = [userMessage];
    }

    if (disableThinking && protocol === "openai") {
      payload.thinking = { type: "disabled" };
    }

    const llmResponse = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: llmHeaders(config),
      body: JSON.stringify(payload)
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      throw new Error(`LLM request failed with ${llmResponse.status}: ${truncate(redactSensitive(errorText), 300)}`);
    }

    const data = await llmResponse.json();
    return ensureLlmResponseWithinLimit(llmTextFromResponse(data, protocol)).replace(/^```(?:markdown)?\s*|\s*```$/g, "").trim();
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutSeconds = Math.round(llmRequestTimeoutMs / 1000);
      const timeoutError = new Error(`LLM 请求超过 ${timeoutSeconds} 秒未完成，已自动中止。请稍后重试，或通过 LLM_REQUEST_TIMEOUT_MS 调大超时时间。`);
      timeoutError.code = "LLM_READING_LIST_TIMEOUT";
      throw timeoutError;
    }

    throw error;
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
    tldr: normalizeText(analysis.tldr),
    problem: normalizeText(analysis.problem),
    background: normalizeText(analysis.background),
    method: normalizeText(analysis.method),
    technicalDetails: normalizeText(analysis.technicalDetails),
    contribution: normalizeText(analysis.contribution),
    experiment: normalizeText(analysis.experiment),
    networkUseCase: normalizeText(analysis.networkUseCase),
    limitations: normalizeText(analysis.limitations),
    recommendedReadingPath: normalizeText(analysis.recommendedReadingPath),
    readingGuide: analysis.readingGuide.map((item) => normalizeText(item)).filter(Boolean),
    matchedKeywords: Array.isArray(analysis.matchedKeywords)
      ? analysis.matchedKeywords.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    whyRecommend: normalizeText(analysis.whyRecommend)
  };
};

const handleArxivSyncRequest = async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET") {
    const library = await readArxivPaperLibrary();
    const history = await readArxivSyncHistory();
    sendJson(response, 200, {
      count: library.papers.length,
      lastSyncedAt: library.lastSyncedAt || "",
      lastSyncCount: library.lastSyncCount || 0,
      lastSyncAdded: library.lastSyncAdded || 0,
      lastSyncRecord: history.records[0] || null,
      categories: library.categories || arxivRssCategories,
      stale: !library.lastSyncedAt || Date.now() - Date.parse(library.lastSyncedAt) >= arxivDailySyncMs
    });
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const force = /^(1|true|yes)$/i.test(String(url.searchParams.get("force") || ""));
  const requestId = String(url.searchParams.get("requestId") || "");
  const trigger = String(url.searchParams.get("trigger") || "manual");

  try {
    const result = await syncArxivPaperLibrary({ force, requestId, trigger });
    sendJson(response, 200, {
      count: result.total,
      fetched: result.fetched,
      added: result.added,
      updated: result.updated,
      skipped: result.skipped,
      syncHistory: result.syncHistory || null,
      lastSyncedAt: result.library.lastSyncedAt || "",
      lastSyncCount: result.library.lastSyncCount || 0,
      lastSyncAdded: result.library.lastSyncAdded || 0,
      categories: result.library.categories || arxivRssCategories
    });
  } catch (error) {
    sendJson(response, error.status || 502, {
      error: error.code || "ARXIV_SYNC_FAILED",
      message: error.message || "arXiv sync failed.",
      detail: error.detail || error.message,
      sourceReturns: error.sourceReturns || []
    });
  }
};

const handleArxivSyncHistoryRequest = async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), arxivSyncHistoryLimit);
  const history = await readArxivSyncHistory();

  sendJson(response, 200, {
    count: Math.min(history.records.length, limit),
    total: history.records.length,
    records: history.records.slice(0, limit)
  });
};

const handlePapersRequest = async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const maxResults = Math.min(Math.max(Number(url.searchParams.get("limit") || 10), 5), 30);
  const start = Math.max(Number(url.searchParams.get("start") || 0), 0);
  const rawQuery = (url.searchParams.get("query") || defaultQuery).trim();
  const days = Math.min(Math.max(Number(url.searchParams.get("days") || 0), 0), 365);
  const requestId = String(url.searchParams.get("requestId") || "");
  const forceRefresh = /^(1|true|yes)$/i.test(String(url.searchParams.get("refresh") || ""));
  const forceArxivApi = /^(1|true|yes|api)$/i.test(String(url.searchParams.get("forceArxiv") || url.searchParams.get("arxivApi") || ""))
    || /^api$/i.test(String(url.searchParams.get("arxivMode") || ""));
  const ignoreCooldown = forceArxivApi || /^(1|true|yes)$/i.test(String(url.searchParams.get("ignoreCooldown") || ""));
  let searchQuery = normalizeQueryForArxiv(rawQuery);

  if (days > 0 && !/submittedDate:/i.test(searchQuery)) {
    const { start: startDate, end } = arxivSubmittedDateWindow(days);
    searchQuery = `(${searchQuery}) AND submittedDate:[${formatArxivDate(startDate)} TO ${formatArxivDate(end)}]`;
  }

  const arxivUrl = new URL("https://export.arxiv.org/api/query");
  arxivUrl.searchParams.set("search_query", searchQuery);
  arxivUrl.searchParams.set("start", String(start));
  arxivUrl.searchParams.set("max_results", String(maxResults));
  arxivUrl.searchParams.set("sortBy", "submittedDate");
  arxivUrl.searchParams.set("sortOrder", "descending");
  const primaryMode = forceArxivApi ? "api" : "library";
  const cacheKey = arxivCacheKey(primaryMode === "api"
    ? arxivUrl
    : `arxiv-library:${arxivRssCategories.join("+")}:${rawQuery}:${days}:${maxResults}:${start}`);
  const cached = primaryMode === "api" ? await readArxivCache(cacheKey) : null;
  const cachedAge = cached ? Date.now() - Number(cached.fetchedAt) : Infinity;
  const cachedCount = cached ? atomEntryCount(cached.xml) : 0;
  const cachedSource = cached?.source || "arxiv";
  const canUseFreshCache = Boolean(cached) && isArxivSource(cachedSource) && !forceRefresh;
  const canUseStaleCache = cached && isArxivSource(cachedSource) && !forceRefresh;

  const sendPapersXml = (xml, cacheStatus, source = "arxiv", extraHeaders = {}) => {
    send(response, 200, xml, {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": cacheStatus === "miss" ? "public, max-age=300" : "public, max-age=60",
      "x-arxiv-search-query": encodeURIComponent(searchQuery),
      "x-paper-insight-arxiv-cache": cacheStatus,
      "x-paper-insight-source": source,
      "x-paper-insight-cache-age-seconds": cached ? String(arxivCacheAgeSeconds(cached)) : "0",
      "x-paper-insight-arxiv-method": primaryMode,
      ...(forceRefresh ? { "x-paper-insight-cache-bypass": "1" } : {}),
      ...(ignoreCooldown ? { "x-paper-insight-ignore-cooldown": "1" } : {}),
      ...extraHeaders
    });
  };

  if (primaryMode === "api" && canUseFreshCache && cachedAge < arxivFreshCacheMs) {
    setPaperRequestStatus(requestId, cachedSource || "cache", "已命中本地缓存。", "done");
    sendPapersXml(cached.xml, "hit", cachedSource, cachedCount < maxResults
      ? { "x-paper-insight-arxiv-warning": encodeURIComponent(`arXiv 缓存中只有 ${cachedCount} 篇匹配候选，未使用备用数据源。`) }
      : {});
    return;
  }

  if (primaryMode === "api" && arxivInflight.has(cacheKey)) {
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240000);

    try {
      if (primaryMode === "library") {
        try {
          const sync = await syncArxivPaperLibrary({
            force: forceRefresh,
            requestId,
            signal: controller.signal,
            trigger: forceRefresh ? "candidate-refresh" : "candidate-fetch"
          });
          const library = sync.library || await readArxivPaperLibrary();
          const selection = selectArxivLibraryPapers({ library, rawQuery, days, maxResults, start });
          const { papers } = selection;
          const xml = atomFeedFromPapers({ papers, query: rawQuery, source: "arXiv Library" });
          const rangeText = days > 0 ? `最近 ${days} 天` : "不限时间";
          const countMessage = selection.relaxedUsed
            ? `严格匹配 ${selection.strictTotal} 篇，已用“AI + 另一组关键词”补充到 ${papers.length} 篇候选论文。`
            : papers.length >= maxResults
              ? `已从本地 arXiv 库筛选 ${papers.length} 篇候选论文。`
              : `本地 arXiv 库${rangeText}只找到 ${papers.length} 篇匹配候选。可用 arXiv API 扩展到${rangeText}。`;
          setPaperRequestStatus(
            requestId,
            "arxiv-library",
            countMessage,
            "done"
          );
          return {
            xml,
            cacheStatus: "library",
            source: "arxiv-library",
            headers: {
              ...((papers.length < maxResults || selection.relaxedUsed) ? { "x-paper-insight-arxiv-warning": encodeURIComponent(countMessage) } : {}),
              "x-paper-insight-library-total": String(library.papers.length),
              "x-paper-insight-library-strict-matches": String(selection.strictTotal),
              "x-paper-insight-library-relaxed-matches": String(selection.relaxedTotal),
              "x-paper-insight-last-sync": encodeURIComponent(library.lastSyncedAt || ""),
              "x-paper-insight-sync-skipped": sync.skipped ? "1" : "0",
              "x-paper-insight-cache-age-seconds": "0"
            }
          };
        } catch (error) {
          const sourceReturns = Array.isArray(error.sourceReturns) ? [...error.sourceReturns] : [];
          const sourceReturn = sourceReturns[0];

          if (canUseStaleCache && cachedAge < arxivStaleCacheMs) {
            setPaperRequestStatus(requestId, cachedSource || "cache", "本地 arXiv 库暂时不可用，已使用本地缓存。", "done", { sourceReturns });
            return {
              xml: cached.xml,
              cacheStatus: "stale",
              source: cachedSource,
              headers: {
                "x-paper-insight-arxiv-warning": encodeURIComponent("本地 arXiv 库暂时不可用，已使用本地缓存。"),
                ...(sourceReturn ? { "x-paper-insight-source-return": responseReturnHeader(sourceReturn) } : {})
              }
            };
          }

          const wrapped = new Error(error.name === "AbortError" ? "arXiv sync request timed out." : error.message);
          wrapped.status = error.status || 502;
          wrapped.code = typeof error.code === "string" ? error.code : "ARXIV_LIBRARY_UNAVAILABLE";
          wrapped.detail = error.detail || wrapped.message;
          wrapped.sourceReturns = sourceReturns;
          setPaperRequestStatus(requestId, "none", wrapped.detail, "error", { sourceReturns });
          throw wrapped;
        }
      }

      const blockedUntil = ignoreCooldown ? 0 : await readArxivCooldown();
      const now = Date.now();

      if (blockedUntil > now) {
        if (canUseStaleCache && cachedAge < arxivStaleCacheMs) {
          setPaperRequestStatus(requestId, cachedSource || "cache", "arXiv API 正在限流，已使用本地缓存。", "done");
          return {
            xml: cached.xml,
            cacheStatus: "stale",
            source: cachedSource,
            headers: {
              "x-paper-insight-arxiv-warning": encodeURIComponent("arXiv API 正在限流，已使用本地缓存。"),
              "retry-after": String(Math.ceil((blockedUntil - now) / 1000))
            }
          };
        }

        const error = new Error("arXiv API 正在限流，本次不会切换备用数据源。");
        error.status = 429;
        error.code = "ARXIV_RATE_LIMITED";
        error.detail = error.message;
        error.retryAfterSeconds = Math.ceil((blockedUntil - now) / 1000);
        setPaperRequestStatus(requestId, "arxiv", error.detail, "error");
        throw error;
      }

      setPaperRequestStatus(requestId, "arxiv", ignoreCooldown ? "正在强制连接 arXiv API，已绕过本地冷却。" : "正在获取 arXiv API 候选论文。");
      const arxivResponse = await fetchArxivQueued(arxivUrl, controller.signal);

      if (arxivResponse.status === 429) {
        const arxivReturn = await readResponseReturnValue("arXiv", arxivResponse);
        const retryMs = nextArxiv429Cooldown(parseRetryAfter(arxivReturn.retryAfter));
        await writeArxivCooldown(Date.now() + retryMs, arxivReturn);

        if (canUseStaleCache && cachedAge < arxivStaleCacheMs) {
          setPaperRequestStatus(requestId, cachedSource || "cache", "arXiv 返回 429，已使用本地缓存。", "done", { sourceReturns: [arxivReturn] });
          return {
            xml: cached.xml,
            cacheStatus: "stale",
            source: cachedSource,
            headers: {
              "x-paper-insight-arxiv-warning": encodeURIComponent("arXiv 返回 429，已使用本地缓存。"),
              "x-paper-insight-source-return": responseReturnHeader(arxivReturn),
              "retry-after": String(Math.ceil(retryMs / 1000))
            }
          };
        }

        const error = responseSourceError("arXiv", arxivReturn);
        error.status = 429;
        error.code = "ARXIV_RATE_LIMITED";
        error.retryAfterSeconds = Math.ceil(retryMs / 1000);
        error.detail = `${describeResponseReturnValue(arxivReturn)}；本次不会切换备用数据源。`;
        setPaperRequestStatus(requestId, "arxiv", error.detail, "error", { sourceReturns: [arxivReturn] });
        throw error;
      }

      if (!arxivResponse.ok) {
        const returnValue = await readResponseReturnValue("arXiv", arxivResponse);
        throw responseSourceError("arXiv", returnValue);
      }

      const xml = await arxivResponse.text();
      await clearArxivCooldown();
      const apiPapers = parseArxivRssPapers(xml);
      if (apiPapers.length) {
        await mergeArxivPapersIntoLibrary(apiPapers, { updateLastSynced: false });
      }
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

      if (canUseStaleCache && cachedAge < arxivStaleCacheMs) {
        setPaperRequestStatus(requestId, cachedSource || "cache", "arXiv 暂时不可用，已使用本地缓存。", "done", { sourceReturns });
        return {
          xml: cached.xml,
          cacheStatus: "stale",
          source: cachedSource,
          headers: {
            "x-paper-insight-arxiv-warning": encodeURIComponent("arXiv 暂时不可用，已使用本地缓存。"),
            ...(sourceReturn ? { "x-paper-insight-source-return": responseReturnHeader(sourceReturn) } : {})
          }
        };
      }

      const wrapped = new Error(error.name === "AbortError" ? "arXiv request timed out." : error.message);
      wrapped.status = error.status || 502;
      wrapped.code = typeof error.code === "string" ? error.code : "ARXIV_UNAVAILABLE";
      wrapped.detail = error.detail || wrapped.message;
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
    const mode = llmProviderDefaults[inferLlmProvider(requestLlm)]?.mode || "llm";

    try {
      llmAnalyses = await callLlmAnalyzer({ query: payload.query || defaultQuery, papers, llm: requestLlm });
    } catch (error) {
      const status = error.code === "LLM_NOT_CONFIGURED"
        ? 503
        : error.code === "LLM_ANALYSIS_TIMEOUT"
          ? 504
          : 500;
      sendJson(response, status, {
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
      mode: llmProviderDefaults[inferLlmProvider({
        apiKey: payload.llmApiKey,
        provider: payload.llmProvider,
        model: payload.llmModel
      })]?.mode || "llm"
    });
  } catch (error) {
    sendJson(response, error.code === "LLM_NOT_CONFIGURED" ? 503 : 500, {
      error: error.code || "TRANSLATION_FAILED",
      message: "Could not translate the abstract.",
      detail: error.message
    });
  }
};

const handleReadingListRequest = async (request, response) => {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const papers = Array.isArray(payload.papers)
      ? payload.papers.slice(0, 40).map(sanitizeReadingListPaper)
      : [];

    if (!papers.length) {
      sendJson(response, 400, { error: "NO_RECOMMENDED_PAPERS", message: "No recommended papers were provided." });
      return;
    }

    const report = {
      title: truncate(payload.title, 160),
      date: String(payload.date || new Date().toISOString().slice(0, 10)),
      month: truncate(payload.month, 16),
      weekOfMonth: Math.min(Math.max(Number(payload.weekOfMonth || 1), 1), 6),
      sourceReport: truncate(payload.sourceReport, 240)
    };

    const requestLlm = {
      apiKey: payload.llmApiKey,
      provider: payload.llmProvider,
      model: payload.llmModel
    };
    const markdown = await callLlmReadingList({
      report,
      papers,
      llm: requestLlm
    });

    sendJson(response, 200, {
      markdown,
      mode: llmProviderDefaults[inferLlmProvider(requestLlm)]?.mode || "llm",
      paperCount: papers.length,
      title: report.title
    });
  } catch (error) {
    const status = error.code === "LLM_NOT_CONFIGURED"
      ? 503
      : error.code === "LLM_READING_LIST_TIMEOUT"
        ? 504
        : 500;
    sendJson(response, status, {
      error: error.code || "READING_LIST_FAILED",
      message: "Could not generate the weekly reading list.",
      detail: error.message,
      retryable: error.code !== "LLM_NOT_CONFIGURED"
    });
  }
};

const handleReadingListEmailRequest = async (request, response) => {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const title = truncate(payload.title, 160) || "每周高价值论文阅读清单";
    const markdown = String(payload.markdown || "").trim();

    if (!markdown) {
      sendJson(response, 400, { error: "NO_MARKDOWN", message: "No reading list Markdown was provided." });
      return;
    }

    if (markdown.length > llmResponseMaxChars) {
      sendJson(response, 400, { error: "MARKDOWN_TOO_LARGE", message: "The reading list Markdown is too large to email." });
      return;
    }

    const result = await sendSmtpMail({ title, markdown });

    sendJson(response, 200, {
      message: "SENT",
      to: result.to,
      sentAt: new Date().toISOString()
    });
  } catch (error) {
    const status = error.code === "SMTP_NOT_CONFIGURED"
      ? 503
      : error.code === "INVALID_EMAIL"
        ? 500
        : 502;
    sendJson(response, status, {
      error: error.code || "EMAIL_SEND_FAILED",
      message: error.code === "SMTP_NOT_CONFIGURED"
        ? "邮件服务未配置。请在服务端设置 SMTP_HOST、SMTP_FROM，并按需设置 SMTP_USER/SMTP_PASS。"
        : "邮件发送失败。",
      detail: truncate(redactSensitive(error.message), 500)
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

  if (url.pathname === "/api/arxiv-sync/history") {
    await handleArxivSyncHistoryRequest(request, response);
    return;
  }

  if (url.pathname === "/api/arxiv-sync") {
    await handleArxivSyncRequest(request, response);
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

  if (url.pathname === "/api/reading-list") {
    await handleReadingListRequest(request, response);
    return;
  }

  if (url.pathname === "/api/reading-list-email") {
    await handleReadingListEmailRequest(request, response);
    return;
  }

  await serveStatic(request, response);
});

server.listen(port, host || undefined, () => {
  const visibleHost = host || "localhost";
  console.log(`Paper Insight is running at http://${visibleHost}:${port}`);
  startArxivAutoSync();
});
