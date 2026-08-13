import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { server } from "../server.js";

let baseUrl = "";
let mockLlmUrl = "";
let mockLlmCallCount = 0;
let mockGenerationText = "# 不完整的周报";
const passingSemanticReviewText = JSON.stringify({
  verdict: "pass",
  score: 95,
  summary: "语义事实与输入证据一致。",
  checks: {
    paperGrounding: true,
    crossPaperIsolation: true,
    trendGrounding: true,
    scoreToneConsistency: true,
    affiliationGrounding: true,
    evidenceBoundary: true,
    adnSpecificity: true
  },
  issues: []
});
let mockSemanticReviewText = passingSemanticReviewText;
const mockLlmTasks = [];
const validMarkdown = await readFile(
  new URL("./fixtures/weekly-report/valid-summary-report.md", import.meta.url),
  "utf8"
);
const fixturePapers = JSON.parse(await readFile(
  new URL("./fixtures/weekly-report/papers.json", import.meta.url),
  "utf8"
));
const previousLlmApiKey = process.env.LLM_API_KEY;
const previousLlmApiUrl = process.env.GLM_CODING_ANTHROPIC_API_URL;
const previousSemanticReviewMode = process.env.WEEKLY_REPORT_SEMANTIC_REVIEW_MODE;
const mockLlmServer = createServer(async (request, response) => {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
  }

  const isSemanticReview = body.includes("weekly_report_semantic_review");
  mockLlmCallCount += 1;
  mockLlmTasks.push(isSemanticReview ? "semantic-review" : "generation");
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    content: [
      {
        type: "text",
        text: isSemanticReview ? mockSemanticReviewText : mockGenerationText
      }
    ]
  }));
});

const semanticReviewRequestPayload = () => ({
  date: "2026-07-29",
  month: "2026-07",
  weekOfMonth: 5,
  weekStart: "2026-07-26T16:00:00.000Z",
  weekEnd: "2026-08-02T16:00:00.000Z",
  useOriginalText: false,
  reviewBeforeGenerate: false,
  papers: fixturePapers
});

const withSemanticReviewMode = async (mode, callback) => {
  const previous = process.env.WEEKLY_REPORT_SEMANTIC_REVIEW_MODE;
  process.env.WEEKLY_REPORT_SEMANTIC_REVIEW_MODE = mode;

  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.WEEKLY_REPORT_SEMANTIC_REVIEW_MODE;
    } else {
      process.env.WEEKLY_REPORT_SEMANTIC_REVIEW_MODE = previous;
    }
  }
};

before(async () => {
  await new Promise((resolve, reject) => {
    mockLlmServer.once("error", reject);
    mockLlmServer.listen(0, "127.0.0.1", () => {
      mockLlmServer.off("error", reject);
      const address = mockLlmServer.address();
      mockLlmUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
  process.env.LLM_API_KEY = "test-api-key";
  process.env.GLM_CODING_ANTHROPIC_API_URL = mockLlmUrl;
  process.env.WEEKLY_REPORT_SEMANTIC_REVIEW_MODE = "off";

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await new Promise((resolve, reject) => {
    mockLlmServer.close((error) => error ? reject(error) : resolve());
  });

  if (previousLlmApiKey === undefined) {
    delete process.env.LLM_API_KEY;
  } else {
    process.env.LLM_API_KEY = previousLlmApiKey;
  }

  if (previousLlmApiUrl === undefined) {
    delete process.env.GLM_CODING_ANTHROPIC_API_URL;
  } else {
    process.env.GLM_CODING_ANTHROPIC_API_URL = previousLlmApiUrl;
  }

  if (previousSemanticReviewMode === undefined) {
    delete process.env.WEEKLY_REPORT_SEMANTIC_REVIEW_MODE;
  } else {
    process.env.WEEKLY_REPORT_SEMANTIC_REVIEW_MODE = previousSemanticReviewMode;
  }
});

test("首页和静态资源仍可访问", async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") || "", /text\/html/);
  const html = await page.text();
  assert.match(html, /weekly-semantic-review-v2026-07-30/);
  assert.match(html, /id="weeklyReportTraceDialog"/);
  assert.match(html, /id="weeklyReportTraceRawList"/);
  assert.match(html, /id="weeklyReportManualReview"/);
  assert.match(html, /data-manual-review-action="continue_repair"/);
  assert.match(html, /data-manual-review-action="exit_task"/);
  assert.match(html, /data-manual-review-action="skip_paper"/);
  assert.match(html, /data-manual-review-action="ignore_warning"/);
  assert.match(html, /确认范围，抓取原文，排除无法支撑写作的论文。/);
  assert.match(html, /id="readingListMaxSelected"/);

  const app = await fetch(`${baseUrl}/app.js`);
  assert.equal(app.status, 200);
  const source = await app.text();
  assert.match(source, /\/api\/reading-list\/jobs\/active/);
  assert.match(source, /weekly-report-job/);
  assert.match(source, /weeklyReportTracePhases/);
  assert.match(source, /weeklyReportTraceEventText/);
  assert.match(source, /appendWeeklyReportTraceDetail/);
  assert.match(source, /\[name, artifact\]/);
  assert.match(source, /\/decision/);
  assert.match(source, /renderWeeklyReportManualReview/);
  assert.match(source, /本步骤做什么：/);
  assert.match(source, /确认取消当前周报任务？/);
});

test("周报 API 在调用 LLM 前拒绝全部跨周候选", async () => {
  const callsBeforeRequest = mockLlmCallCount;
  const response = await fetch(`${baseUrl}/api/reading-list`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      date: "2026-07-29",
      month: "2026-07",
      weekOfMonth: 5,
      weekStart: "2026-07-26T16:00:00.000Z",
      weekEnd: "2026-08-02T16:00:00.000Z",
      useOriginalText: false,
      papers: [
        {
          id: "https://arxiv.org/abs/2607.90001",
          title: "Previous Week Paper",
          published: "2026-07-26T15:59:59.999Z",
          summary: "This paper belongs to the previous week."
        }
      ]
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, "NO_READING_LIST_CANDIDATES_IN_WEEK");
  assert.equal(payload.excludedCrossWeekCount, 1);
  assert.equal(mockLlmCallCount, callsBeforeRequest);
});

test("周报 API 不接受 GET", async () => {
  const response = await fetch(`${baseUrl}/api/reading-list`);
  assert.equal(response.status, 405);
});

test("周报 API 在 LLM 返回不完整 Markdown 时触发发布质量门", async () => {
  mockGenerationText = "# 不完整的周报";
  const response = await fetch(`${baseUrl}/api/reading-list`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      date: "2026-07-29",
      month: "2026-07",
      weekOfMonth: 5,
      weekStart: "2026-07-26T16:00:00.000Z",
      weekEnd: "2026-08-02T16:00:00.000Z",
      useOriginalText: false,
      reviewBeforeGenerate: false,
      papers: [
        {
          id: "https://arxiv.org/abs/2607.90002",
          absLink: "https://arxiv.org/abs/2607.90002",
          title: "Current Week Paper",
          published: "2026-07-29T08:00:00.000Z",
          summary: "A current-week paper used to verify the publishing quality gate."
        }
      ]
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.error, "WEEKLY_REPORT_QUALITY_GATE_FAILED");
  assert.equal(payload.qualityGate.valid, false);
  assert.match(payload.qualityGate.errors.join("\n"), /YAML front matter/);
});

test("周报 API 在模拟 LLM 返回合格正文时通过质量门并返回发布结果", async () => {
  mockGenerationText = validMarkdown;
  const response = await fetch(`${baseUrl}/api/reading-list`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      date: "2026-07-29",
      month: "2026-07",
      weekOfMonth: 5,
      weekStart: "2026-07-26T16:00:00.000Z",
      weekEnd: "2026-08-02T16:00:00.000Z",
      useOriginalText: false,
      reviewBeforeGenerate: false,
      papers: fixturePapers
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 200, payload.detail || payload.message);
  assert.equal(payload.paperCount, 2);
  assert.equal(payload.candidateCount, 2);
  assert.equal(payload.publishValidation.valid, true);
  assert.equal(payload.publishValidation.metrics.matchedPaperCount, 2);
  assert.match(payload.markdown, /^---/);
  assert.match(payload.markdown, /## 完整论文清单/);
});

test("warn 模式下 LLM 语义评审 pass，结果标记为可直接发布", async () => {
  mockGenerationText = validMarkdown;
  mockSemanticReviewText = passingSemanticReviewText;
  const taskStart = mockLlmTasks.length;
  const response = await withSemanticReviewMode("warn", () => fetch(`${baseUrl}/api/reading-list`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(semanticReviewRequestPayload())
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, payload.detail || payload.message);
  assert.equal(payload.semanticReview.status, "completed");
  assert.equal(payload.semanticReview.verdict, "pass");
  assert.equal(payload.requiresManualReview, false);
  assert.deepEqual(mockLlmTasks.slice(taskStart), ["generation", "semantic-review"]);
});

test("warn 模式下 LLM 语义评审 reject，保留结果但标记人工复核", async () => {
  mockGenerationText = validMarkdown;
  mockSemanticReviewText = JSON.stringify({
    verdict: "reject",
    score: 38,
    summary: "发现明确的跨论文污染。",
    checks: {
      paperGrounding: false,
      crossPaperIsolation: false,
      trendGrounding: true,
      scoreToneConsistency: true,
      affiliationGrounding: true,
      evidenceBoundary: true,
      adnSpecificity: true
    },
    issues: [
      {
        severity: "high",
        category: "cross_paper_contamination",
        paperId: fixturePapers[0].id,
        claim: "论文 A 使用了论文 B 的实验结论",
        reason: "该结果只存在于论文 B 的证据中。",
        evidence: "论文 A 输入证据未包含该结果。"
      }
    ]
  });
  const response = await withSemanticReviewMode("warn", () => fetch(`${baseUrl}/api/reading-list`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(semanticReviewRequestPayload())
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, payload.detail || payload.message);
  assert.equal(payload.semanticReview.verdict, "reject");
  assert.equal(payload.semanticReview.publishable, false);
  assert.equal(payload.requiresManualReview, true);
});

test("enforce 模式下 LLM 语义评审 review 或 reject 会阻止发布", async () => {
  mockGenerationText = validMarkdown;
  mockSemanticReviewText = JSON.stringify({
    verdict: "review",
    score: 72,
    summary: "趋势判断只有一篇论文支撑。",
    checks: {
      paperGrounding: true,
      crossPaperIsolation: true,
      trendGrounding: false,
      scoreToneConsistency: true,
      affiliationGrounding: true,
      evidenceBoundary: true,
      adnSpecificity: true
    },
    issues: [
      {
        severity: "medium",
        category: "trend_grounding",
        claim: "该方向已成为本周共同趋势",
        reason: "只有一篇论文提供直接证据。",
        evidence: "另一篇论文未覆盖该主题。"
      }
    ]
  });
  const response = await withSemanticReviewMode("enforce", () => fetch(`${baseUrl}/api/reading-list`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(semanticReviewRequestPayload())
  }));
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.error, "WEEKLY_REPORT_SEMANTIC_REVIEW_REJECTED");
  assert.equal(payload.semanticReview.verdict, "review");
});

test("warn 模式下语义评审响应损坏时降级为人工复核", async () => {
  mockGenerationText = validMarkdown;
  mockSemanticReviewText = "not-json";
  const response = await withSemanticReviewMode("warn", () => fetch(`${baseUrl}/api/reading-list`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(semanticReviewRequestPayload())
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, payload.detail || payload.message);
  assert.equal(payload.semanticReview.status, "unavailable");
  assert.equal(payload.semanticReview.verdict, "review");
  assert.equal(payload.requiresManualReview, true);
});
