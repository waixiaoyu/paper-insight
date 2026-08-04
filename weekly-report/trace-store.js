import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;
const REDACTED = "[REDACTED]";

const normalizedKey = (key) => String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const sensitiveKey = (key) => {
  const normalized = normalizedKey(key);
  return normalized.includes("apikey")
    || [
      "authorization",
      "proxyauthorization",
      "cookie",
      "setcookie",
      "password",
      "passphrase",
      "clientsecret",
      "secretkey",
      "accesstoken",
      "refreshtoken",
      "idtoken",
      "bearertoken",
      "sessionid"
    ].includes(normalized);
};

const redactString = (value) => String(value)
  .replace(/(authorization\s*[:=]\s*)([^\r\n]+)/gi, `$1${REDACTED}`)
  .replace(/(cookie\s*[:=]\s*)([^\r\n]+)/gi, `$1${REDACTED}`)
  .replace(/((?:api[-_ ]?key|llmApiKey)\s*[:=]\s*)([^\s\r\n,;]+)/gi, `$1${REDACTED}`);

export const redactTraceValue = (value, seen = new WeakSet()) => {
  if (typeof value === "string") {
    return redactString(value);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactTraceValue(item, seen));
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sensitiveKey(key) ? REDACTED : redactTraceValue(item, seen)
  ]));
};

const safeSegment = (value, label) => {
  const segment = String(value || "").trim();

  if (!segment || !/^[a-zA-Z0-9._-]+$/.test(segment)) {
    throw new TypeError(`${label} contains unsupported characters.`);
  }

  return segment;
};

const readJsonIfPresent = async (path, fallback = null) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
};

const readTextIfPresent = async (path, fallback = "") => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
};

const writeJsonAtomic = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(redactTraceValue(value), null, 2)}\n`, "utf8");

  try {
    await rename(temporaryPath, path);
  } catch (error) {
    if (["EEXIST", "EPERM"].includes(error?.code)) {
      await rm(path, { force: true });
      await rename(temporaryPath, path);
    } else {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
};

export class WeeklyReportTraceStore {
  constructor({
    rootDir,
    maxJobs = 20,
    retentionDays = 30,
    now = () => new Date()
  } = {}) {
    if (!String(rootDir || "").trim()) {
      throw new TypeError("Weekly report Trace rootDir is required.");
    }

    this.rootDir = rootDir;
    this.maxJobs = Math.max(1, Math.trunc(Number(maxJobs) || 20));
    this.retentionDays = Math.max(1, Math.trunc(Number(retentionDays) || 30));
    this.now = now;
  }

  traceDirectory(traceId) {
    return join(this.rootDir, safeSegment(traceId, "traceId"));
  }

  async createTrace({ traceId, jobId, input = {}, createdAt = this.now() } = {}) {
    const safeTraceId = safeSegment(traceId, "traceId");
    const safeJobId = safeSegment(jobId, "jobId");
    const timestamp = new Date(createdAt).toISOString();
    const directory = this.traceDirectory(safeTraceId);
    const meta = {
      traceId: safeTraceId,
      jobId: safeJobId,
      state: "running",
      createdAt: timestamp,
      updatedAt: timestamp,
      input: redactTraceValue(input)
    };

    await mkdir(directory, { recursive: true });
    await writeJsonAtomic(join(directory, "meta.json"), meta);
    await this.prune();
    return meta;
  }

  async updateMeta(traceId, patch = {}) {
    const directory = this.traceDirectory(traceId);
    const current = await readJsonIfPresent(join(directory, "meta.json"));

    if (!current) {
      throw new Error(`Weekly report Trace ${traceId} was not found.`);
    }

    const next = {
      ...current,
      ...redactTraceValue(patch),
      traceId: current.traceId,
      jobId: current.jobId,
      updatedAt: new Date(this.now()).toISOString()
    };
    await writeJsonAtomic(join(directory, "meta.json"), next);
    return next;
  }

  async appendTimeline(traceId, event) {
    const directory = this.traceDirectory(traceId);
    await mkdir(directory, { recursive: true });
    const entry = redactTraceValue({
      ...event,
      timestamp: new Date(this.now()).toISOString()
    });
    await appendFile(join(directory, "timeline.ndjson"), `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }

  async writeJson(traceId, name, value) {
    const fileName = `${safeSegment(name, "Trace section name")}.json`;
    const path = join(this.traceDirectory(traceId), fileName);
    await writeJsonAtomic(path, value);
    return path;
  }

  async writeResult(traceId, markdown) {
    const path = join(this.traceDirectory(traceId), "result.md");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, redactString(markdown || ""), "utf8");
    return path;
  }

  async readTrace(traceId) {
    const directory = this.traceDirectory(traceId);
    const meta = await readJsonIfPresent(join(directory, "meta.json"));

    if (!meta) {
      return null;
    }

    const timelineText = await readTextIfPresent(join(directory, "timeline.ndjson"));
    const timeline = timelineText
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const entries = await readdir(directory, { withFileTypes: true });
    const artifacts = {};

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "meta.json") {
        continue;
      }

      artifacts[entry.name.slice(0, -5)] = await readJsonIfPresent(join(directory, entry.name));
    }

    return {
      meta,
      timeline,
      artifacts,
      resultMarkdown: await readTextIfPresent(join(directory, "result.md"))
    };
  }

  async listTraces() {
    await mkdir(this.rootDir, { recursive: true });
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const traces = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      try {
        const meta = await readJsonIfPresent(join(this.rootDir, entry.name, "meta.json"));
        if (meta) {
          traces.push(meta);
        }
      } catch {
        // A damaged Trace is ignored here and remains available for manual inspection.
      }
    }

    return traces.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async prune() {
    const traces = await this.listTraces();
    const cutoff = new Date(this.now()).getTime() - this.retentionDays * DAY_MS;
    const retained = traces
      .filter((trace) => Date.parse(trace.createdAt) >= cutoff)
      .slice(0, this.maxJobs);
    const retainedIds = new Set(retained.map((trace) => trace.traceId));

    await Promise.all(traces
      .filter((trace) => !retainedIds.has(trace.traceId))
      .map((trace) => this.deleteTrace(trace.traceId)));

    return retained;
  }

  async deleteTrace(traceId) {
    await rm(this.traceDirectory(traceId), { recursive: true, force: true });
  }

  async clear() {
    const traces = await this.listTraces();
    await Promise.all(traces.map((trace) => this.deleteTrace(trace.traceId)));
  }
}
