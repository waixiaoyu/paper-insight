#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizedId = (paper = {}) => String(paper.id || paper.paperId || paper.absLink || paper.link || "")
  .match(/(?:arxiv\.org\/(?:abs|html|pdf)\/)?([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/i)?.[1] || "";
const safeSegment = (value) => String(value || "weekly-report")
  .replace(/[^a-zA-Z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 80) || "weekly-report";

const sensitiveInputKey = (key) => {
  const normalized = String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized.includes("apikey") || [
    "authorization",
    "cookie",
    "password",
    "clientsecret",
    "secretkey",
    "accesstoken",
    "refreshtoken",
    "bearertoken"
  ].includes(normalized);
};

export const assertNoGrayInputSecrets = (value, path = "input", seen = new WeakSet()) => {
  if (!value || typeof value !== "object") {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  for (const [key, item] of Object.entries(value)) {
    if (sensitiveInputKey(key)) {
      throw new TypeError(`灰度输入不能包含敏感字段：${path}.${key}。请只通过环境变量配置模型密钥。`);
    }
    assertNoGrayInputSecrets(item, `${path}.${key}`, seen);
  }
};

const normalizedPaper = (paper, label) => {
  if (!paper || typeof paper !== "object" || Array.isArray(paper)) {
    throw new TypeError(`${label} 必须是论文对象。`);
  }
  const id = normalizedId(paper);
  if (!id || !String(paper.title || "").trim()) {
    throw new TypeError(`${label} 必须包含合法 arXiv ID 和标题。`);
  }
  if (paper.hidden === true || String(paper.status || "").toLowerCase() === "hidden") {
    throw new TypeError(`${label} 是隐藏论文，不能进入真实周报灰度。`);
  }
  return { ...clone(paper), id };
};

export const normalizeGrayInput = (input = {}) => {
  assertNoGrayInputSecrets(input);
  const primarySource = Array.isArray(input.primaryPapers)
    ? input.primaryPapers
    : Array.isArray(input.papers)
      ? input.papers
      : Array.isArray(input.recommendations)
        ? input.recommendations
        : [];
  const reserveSource = Array.isArray(input.reservePapers) ? input.reservePapers : [];
  const primaryPapers = primarySource.map((paper, index) => normalizedPaper(paper, `primaryPapers[${index}]`));
  const reservePapers = reserveSource.map((paper, index) => normalizedPaper(paper, `reservePapers[${index}]`));

  if (!primaryPapers.length && !reservePapers.length) {
    throw new TypeError("灰度输入至少需要一篇 primary 或 reserve 论文。");
  }

  const seen = new Set();
  for (const paper of [...primaryPapers, ...reservePapers]) {
    if (seen.has(paper.id)) {
      throw new TypeError(`灰度输入包含重复论文：${paper.id}。`);
    }
    seen.add(paper.id);
  }

  const date = String(input.date || new Date().toISOString().slice(0, 10));
  const reportKey = String(input.reportKey || `${date}-gray`).trim();
  if (!reportKey) {
    throw new TypeError("灰度输入 reportKey 不能为空。");
  }

  return {
    ...clone(input),
    reportKey,
    date,
    month: String(input.month || date.slice(0, 7)),
    weekOfMonth: Math.max(1, Math.min(6, Math.trunc(Number(input.weekOfMonth) || 1))),
    sourceReport: String(input.sourceReport || `真实灰度 ${reportKey}`),
    reviewScoreThreshold: Math.max(0, Math.min(100, Math.round(Number(input.reviewScoreThreshold) || 70))),
    minSelectedCount: Math.max(1, Math.min(20, Math.round(Number(input.minSelectedCount) || 3))),
    maxSelectedCount: Math.max(3, Math.min(20, Math.round(Number(input.maxSelectedCount) || 10))),
    paperConcurrency: Math.max(1, Math.min(5, Math.round(Number(input.paperConcurrency) || 2))),
    calibrationMaxPapers: Math.max(1, Math.min(30, Math.round(Number(input.calibrationMaxPapers) || 30))),
    useOriginalText: true,
    primaryPapers,
    reservePapers
  };
};

const readJsonResponse = async (response) => {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`灰度 API 返回了非 JSON 响应（HTTP ${response.status}）。`);
  }
  if (!response.ok) {
    throw new Error(data?.detail || data?.message || `灰度 API 请求失败（HTTP ${response.status}）。`);
  }
  return data;
};

export const runGrayJob = async ({
  baseUrl,
  input,
  fetchImpl = fetch,
  pollMs = 1000,
  onProgress = () => {}
} = {}) => {
  const normalized = normalizeGrayInput(input);
  const root = String(baseUrl || "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(root)) {
    throw new TypeError("灰度运行 baseUrl 必须是 HTTP(S) 地址。");
  }

  let job = await readJsonResponse(await fetchImpl(`${root}/api/reading-list/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(normalized)
  }));
  onProgress(job);

  while (job.state === "running") {
    await sleep(Math.max(10, Number(pollMs) || 1000));
    job = await readJsonResponse(await fetchImpl(`${root}/api/reading-list/jobs/${encodeURIComponent(job.jobId)}`));
    onProgress(job);
  }

  const [result, trace] = await Promise.all([
    readJsonResponse(await fetchImpl(`${root}/api/reading-list/jobs/${encodeURIComponent(job.jobId)}/result`)),
    readJsonResponse(await fetchImpl(`${root}/api/reading-list/jobs/${encodeURIComponent(job.jobId)}/trace`))
  ]);
  return { input: normalized, job, result, trace };
};

export const arxivIdsFromMarkdown = (markdown) => [...new Set(
  [...String(markdown || "").matchAll(/arxiv\.org\/(?:abs|html|pdf)\/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/gi)]
    .map((match) => match[1])
)];

const selectedIdsFromTrace = (trace) => {
  const selected = trace?.artifacts?.["selection-artifacts"]?.selected;
  return Array.isArray(selected) ? selected.map((item) => normalizedId(item.paper || item)).filter(Boolean) : [];
};

export const buildGrayEvaluation = ({ input, job, result, trace, baselineMarkdown = "" } = {}) => {
  const timeline = Array.isArray(trace?.timeline) ? trace.timeline : [];
  const stageDurations = timeline
    .filter((event) => event.type === "stage_completed" && Number.isFinite(Number(event.durationMs)))
    .map((event) => `| ${event.stage} | ${Number(event.durationMs)} | ${event.decision || "-"} |`);
  const modelCalls = timeline.filter((event) => event.type === "model_call_completed" || event.type === "model_call_failed");
  const repairs = modelCalls.filter((event) => String(event.attemptType || "") !== "initial");
  const selectedIds = selectedIdsFromTrace(trace);
  const publishedIds = arxivIdsFromMarkdown(result?.markdown);
  const baselineIds = arxivIdsFromMarkdown(baselineMarkdown);
  const warnings = result?.result?.warnings || job?.warnings || [];
  const qaReport = result?.result?.qaReport || null;
  const addedIds = publishedIds.filter((id) => !baselineIds.includes(id));
  const removedIds = baselineIds.filter((id) => !publishedIds.includes(id));

  return `# 周报 Agent Loop 真实灰度验收

## 运行结论

- Job：${job?.jobId || "-"}
- Trace：${job?.traceId || trace?.meta?.traceId || "-"}
- 报告：${input?.reportKey || "-"}
- 终态：${result?.state || job?.state || "-"}
- 原因：${result?.reason || job?.result?.reason || "-"}
- 最终 QA：${qaReport?.status || "未通过/未执行"}
- 是否使用一次内容修正：${qaReport?.repairAttempted ? "是" : "否"}
- 模型调用：${modelCalls.length} 次，其中非 initial 调用 ${repairs.length} 次
- 入选论文：${selectedIds.join("、") || "无"}
- 发布稿论文链接：${publishedIds.join("、") || "无"}
- 管理员告警：${warnings.length ? JSON.stringify(warnings) : "无"}

自动候选标准：只有终态为 publish、最终 QA 为 passed、入选论文与发布链接一致时，才进入下面的人工质量对照；这仍不等于灰度验收通过。

## 阶段耗时

| 阶段 | 耗时（ms） | 决策 |
| --- | ---: | --- |
${stageDurations.join("\n") || "| - | - | - |"}

## 与旧稿的结构差异

- 旧稿字符数：${String(baselineMarkdown || "").length}
- 新稿字符数：${String(result?.markdown || "").length}
- 新增论文链接：${addedIds.join("、") || "无"}
- 移除论文链接：${removedIds.join("、") || "无"}

## 逐篇可信度抽查（必须对照 arXiv HTML 原文）

| 论文 | 问题与方法准确 | 数字/实验可定位 | 机构准确 | 未跨论文串写 | 局限充分 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
${selectedIds.map((id) => `| ${id} | ☐ | ☐ | ☐ | ☐ | ☐ | 待检查 |`).join("\n") || "| 无 | - | - | - | - | - | 不通过 |"}

## 最终稿阅读价值对照（新稿必须显著优于旧稿）

- [ ] 标题和导读给出了本周具体技术信号，不是泛化口号。
- [ ] 每篇都明确回答“为什么值得打开原文”，而不是复述摘要。
- [ ] 必读、值得读、快速扫读、背景了解的差异有证据支撑。
- [ ] 趋势由至少两篇论文共同支撑；单篇只写成观察。
- [ ] ADN/工程启发具体到机制、假设、接口或风险。
- [ ] 新稿没有因为变长而增加重复、空话或认知负担。
- [ ] 与旧稿盲评时，新稿在可信度和阅读价值上均明显更好。

## 失败保护

- [ ] reject、取消或调用失败没有覆盖上一份有效周报。
- [ ] 所有管理员告警在运维界面顶部可见。
- [ ] Trace 能解释每一步输入、输出、耗时、重试、修正和最终决策。
- [ ] 除规格要求的固定发布页脚外，发布 Markdown 没有暴露 prompt、JSON、阈值、fallback、Trace 或其他运维信息。

## 最终签字

- 严重事实问题数量：____
- 跨论文串写数量：____
- 无依据精确数字数量：____
- 阅读价值盲评：旧稿 ____ / 5；新稿 ____ / 5
- 结论：☐ 通过灰度  ☐ 调整后重跑  ☐ reject
`;
};

export const writeGrayArtifacts = async ({ outputRoot, run, baselineMarkdown = "" } = {}) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = resolve(outputRoot, `${stamp}-${safeSegment(run.input.reportKey)}-${safeSegment(run.job.jobId)}`);
  await mkdir(directory, { recursive: true });
  const evaluation = buildGrayEvaluation({ ...run, baselineMarkdown });
  await Promise.all([
    writeFile(join(directory, "input.json"), `${JSON.stringify(run.input, null, 2)}\n`, "utf8"),
    writeFile(join(directory, "job.json"), `${JSON.stringify(run.job, null, 2)}\n`, "utf8"),
    writeFile(join(directory, "trace.json"), `${JSON.stringify(run.trace, null, 2)}\n`, "utf8"),
    writeFile(join(directory, "result.md"), `${String(run.result?.markdown || "").trim()}\n`, "utf8"),
    writeFile(join(directory, "evaluation.md"), evaluation, "utf8")
  ]);
  return directory;
};

export const parseGrayArgs = (argv = []) => {
  const options = { input: "", baseline: "", output: "outputs/weekly-report-gray", baseUrl: "", pollMs: 1000 };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (["--input", "--baseline", "--output", "--base-url", "--poll-ms"].includes(name)) {
      if (!value || value.startsWith("--")) {
        throw new TypeError(`${name} 缺少参数值。`);
      }
      const key = { "--input": "input", "--baseline": "baseline", "--output": "output", "--base-url": "baseUrl", "--poll-ms": "pollMs" }[name];
      options[key] = key === "pollMs" ? Math.max(10, Number(value) || 1000) : value;
      index += 1;
    } else {
      throw new TypeError(`未知参数：${name}`);
    }
  }
  if (!options.input) {
    throw new TypeError("必须提供 --input <gray-input.json>。需先准备真实同周论文候选。 ");
  }
  return options;
};

const listen = (server) => new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    server.off("error", reject);
    resolveListen(server.address());
  });
});

const close = (server) => new Promise((resolveClose) => server.close(() => resolveClose()));

export const main = async (argv = process.argv.slice(2)) => {
  const options = parseGrayArgs(argv);
  const inputPath = resolve(options.input);
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const baselineMarkdown = options.baseline ? await readFile(resolve(options.baseline), "utf8") : "";
  let localServer = null;
  let baseUrl = options.baseUrl;

  if (!baseUrl) {
    ({ server: localServer } = await import("../server.js"));
    const address = await listen(localServer);
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  let lastStage = "";
  try {
    const run = await runGrayJob({
      baseUrl,
      input,
      pollMs: options.pollMs,
      onProgress: (job) => {
        const stage = `${job.state}:${job.agentStage}`;
        if (stage !== lastStage) {
          lastStage = stage;
          const counts = job.counts || {};
          console.log(`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${stage} · 全文 ${counts.fullTextEligible || 0} · 复评 ${counts.reviewed || 0} · 入选 ${counts.selected || 0}`);
        }
      }
    });
    const directory = await writeGrayArtifacts({ outputRoot: resolve(options.output), run, baselineMarkdown });
    console.log(`灰度产物已保存：${directory}`);
    console.log(`验收单：${join(directory, "evaluation.md")}`);
    if (run.result.state !== "publish") {
      process.exitCode = 2;
    }
  } finally {
    if (localServer) {
      await close(localServer);
    }
  }
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`真实灰度运行失败：${error.message}`);
    process.exitCode = 1;
  });
}
