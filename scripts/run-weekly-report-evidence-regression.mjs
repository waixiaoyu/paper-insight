#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { extractEvidenceBatch } from "../weekly-report/evidence-agent.js";
import { redactTraceValue } from "../weekly-report/trace-store.js";

const MAX_DIAGNOSTIC_DETAIL_CHARS = 600;
const MAX_RESPONSE_PREVIEW_CHARS = 600;

const boundedText = (value, limit = MAX_DIAGNOSTIC_DETAIL_CHARS) => {
  const text = String(value || "").replace(/\u0000/g, "").trim();
  return text.length > limit ? text.slice(0, limit) + "…（已截断）" : text;
};

const redactedDiagnosticText = (value) => String(redactTraceValue(
  boundedText(value, Number.MAX_SAFE_INTEGER)
));

const rawResponseText = (value) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (Array.isArray(value.content)) {
      return value.content
        .filter((block) => block?.type === "text")
        .map((block) => String(block.text || ""))
        .join("\n");
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value || "");
};

const diagnosticIssuesFor = (issues = []) => (Array.isArray(issues) ? issues : [])
  .map((entry) => ({
    code: boundedText(entry?.code, 120),
    path: boundedText(entry?.path, 240),
    detail: boundedText(
      redactedDiagnosticText(entry?.detail),
      MAX_DIAGNOSTIC_DETAIL_CHARS
    )
  }));

export const formatEvidenceRegressionFailure = (error) => (
  "Evidence regression failed: "
  + boundedText(redactedDiagnosticText(error?.message || error), MAX_DIAGNOSTIC_DETAIL_CHARS)
);

const responsePreviewFor = (rawOutput) => {
  const text = rawResponseText(rawOutput);
  if (!text) return null;
  const redacted = redactedDiagnosticText(text);
  return {
    length: text.length,
    head: boundedText(redacted.slice(0, MAX_RESPONSE_PREVIEW_CHARS), MAX_RESPONSE_PREVIEW_CHARS),
    tail: boundedText(redacted.slice(-MAX_RESPONSE_PREVIEW_CHARS), MAX_RESPONSE_PREVIEW_CHARS)
  };
};

const normalizedPaperId = (value) => String(value || "")
  .match(/(?:arxiv\.org\/(?:abs|html|pdf)\/)?(\d{4}\.\d{4,5})(?:v\d+)?/i)?.[1]
  || String(value || "").trim().replace(/v\d+$/i, "");

const paperIdFor = (entry = {}) => normalizedPaperId(
  entry?.paper?.id || entry?.paperId || entry?.contextPacket?.paperId
);

const summaryFor = (entries = [], calls = []) => (Array.isArray(entries) ? entries : [])
  .map((entry) => {
    const paperId = paperIdFor(entry);
    const error = entry?.error || {};
    return {
      paperId,
      callCount: calls.filter((call) => call.paperId === paperId).length,
      ...(String(error?.code || "") ? { errorCode: String(error.code) } : {}),
      ...(String(error?.message || "") ? {
        errorMessage: boundedText(redactedDiagnosticText(error.message), MAX_DIAGNOSTIC_DETAIL_CHARS)
      } : {}),
      ...(String(error?.stopReason || "") ? {
        stopReason: boundedText(error.stopReason, 120)
      } : {}),
      ...(Array.isArray(error?.issues) && error.issues.length
        ? { issueCodes: [...new Set(error.issues.map((issue) => String(issue?.code || "")).filter(Boolean))] }
        : {})
    };
  });

export const runEvidenceRegression = async ({
  contextSnapshot = {},
  paperIds = [],
  callModel,
  paperConcurrency = 2,
  networkRetryDelayMs = 1500
} = {}) => {
  if (typeof callModel !== "function") {
    throw new TypeError("Evidence regression requires callModel.");
  }

  const requestedIds = [...new Set((Array.isArray(paperIds) ? paperIds : [])
    .map(normalizedPaperId)
    .filter(Boolean))];
  if (!requestedIds.length) {
    throw new TypeError("Evidence regression requires at least one paperId.");
  }

  const eligible = Array.isArray(contextSnapshot?.eligible) ? contextSnapshot.eligible : [];
  const entriesByPaperId = new Map(eligible.map((entry) => [paperIdFor(entry), entry]));
  const missing = requestedIds.filter((paperId) => !entriesByPaperId.has(paperId));
  if (missing.length) {
    throw new Error("Cached context packets are missing: " + missing.join(", ") + ".");
  }

  const calls = [];
  const batch = await extractEvidenceBatch(
    requestedIds.map((paperId) => {
      const entry = entriesByPaperId.get(paperId);
      return { paper: entry.paper, contextPacket: entry.contextPacket };
    }),
    {
      paperConcurrency,
      networkRetryDelayMs,
      callModel,
      onCall: async (record) => {
        const issues = diagnosticIssuesFor(record?.validation?.issues);
        const responsePreview = record?.validation?.valid === false
          ? responsePreviewFor(record?.rawOutput)
          : null;
        calls.push({
          paperId: normalizedPaperId(record?.paperId),
          attemptType: String(record?.attemptType || ""),
          valid: Boolean(record?.validation?.valid),
          issueCodes: [...new Set(issues
            .map((issue) => String(issue?.code || ""))
            .filter(Boolean))],
          ...(issues.length ? { issues } : {}),
          ...(responsePreview ? { responsePreview } : {}),
          errorCode: String(record?.error?.code || ""),
          errorMessage: boundedText(redactedDiagnosticText(record?.error?.message), MAX_DIAGNOSTIC_DETAIL_CHARS),
          stopReason: boundedText(record?.error?.stopReason, 120),
          durationMs: Math.max(0, Math.trunc(Number(record?.durationMs) || 0))
        });
      }
    }
  );

  return {
    generatedAt: new Date().toISOString(),
    items: requestedIds.length,
    paperConcurrency: batch.concurrency,
    succeeded: summaryFor(batch.succeeded, calls),
    excluded: summaryFor(batch.excluded, calls),
    processingFailed: summaryFor(batch.processingFailed, calls),
    calls
  };
};

export const writeEvidenceRegressionSummary = async ({ outputPath, run } = {}) => {
  if (!String(outputPath || "").trim()) {
    throw new TypeError("Evidence regression requires an output path.");
  }
  const target = resolve(String(outputPath));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(run, null, 2) + "\n", "utf8");
  return target;
};

export const parseEvidenceRegressionArgs = (argv = []) => {
  const options = { trace: "", ids: [], output: "", paperConcurrency: 2 };
  for (let index = 0; index < argv.length; index += 1) {
    const name = String(argv[index] || "");
    const value = String(argv[index + 1] || "");
    if (!["--trace", "--ids", "--output", "--concurrency"].includes(name)) {
      throw new TypeError("Unknown argument: " + name + ".");
    }
    if (!value || value.startsWith("--")) {
      throw new TypeError(name + " requires a value.");
    }
    if (name === "--trace") options.trace = value;
    if (name === "--ids") options.ids = value.split(",").map(normalizedPaperId).filter(Boolean);
    if (name === "--output") options.output = value;
    if (name === "--concurrency") options.paperConcurrency = Math.min(5, Math.max(1, Math.trunc(Number(value) || 2)));
    index += 1;
  }
  if (!options.trace || !options.ids.length || !options.output) {
    throw new TypeError("--trace, --ids, and --output are required.");
  }
  return options;
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = parseEvidenceRegressionArgs(argv);
  const contextSnapshot = JSON.parse(await readFile(resolve(options.trace), "utf8"));
  const { callWeeklyReportAgentModel } = await import("../server.js");
  const run = await runEvidenceRegression({
    contextSnapshot,
    paperIds: options.ids,
    paperConcurrency: options.paperConcurrency,
    callModel: (prompt, modelOptions) => callWeeklyReportAgentModel(prompt, modelOptions)
  });
  const outputPath = await writeEvidenceRegressionSummary({
    outputPath: options.output,
    run
  });
  console.log("Evidence regression summary: " + outputPath);
  console.log(JSON.stringify({
    items: run.items,
    succeeded: run.succeeded.length,
    excluded: run.excluded.length,
    processingFailed: run.processingFailed.length
  }));
  return run;
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(formatEvidenceRegressionFailure(error));
    process.exitCode = 1;
  });
}
