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
const mockLlmRequests = [];
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
  mockLlmRequests.push({
    path: request.url,
    payload: JSON.parse(body)
  });
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

test("recommendation scores use the four-dimension weighted average plus interest adjustment", async () => {
  const previousGenerationText = mockGenerationText;
  const papers = [
    {
      id: "2608.30001",
      title: "Balanced recommendation candidate",
      authors: ["Test Author"],
      categories: ["cs.AI"],
      primaryCategory: "cs.AI",
      published: "2026-08-28T00:00:00Z",
      summary: "A balanced general AI systems paper."
    },
    {
      id: "2608.30002",
      title: "Evidence-limited recommendation candidate",
      authors: ["Test Author"],
      categories: ["cs.AI"],
      primaryCategory: "cs.AI",
      published: "2026-08-28T00:00:00Z",
      summary: "A general AI systems paper with limited evidence."
    }
  ];
  const analysisFor = (paper, scores) => ({
    id: paper.id,
    score: 0,
    scores,
    interestFit: "general_ai_system",
    interestReason: "The method is transferable to general AI systems.",
    tldr: "A concrete recommendation judgment.",
    problem: "A defined research problem.",
    background: "Relevant research background.",
    method: "A concrete technical method.",
    technicalDetails: "Technical implementation details.",
    contribution: "A specific contribution.",
    experiment: "The reported experimental evidence.",
    networkUseCase: "Potential application value.",
    limitations: "The current evidence boundary.",
    recommendedReadingPath: "Read the method and experiments first.",
    readingGuide: ["Check the method.", "Check the evidence."],
    whyRecommend: "The paper has a clear research contribution.",
    matchedKeywords: ["agent"],
    industryTags: []
  });

  try {
    mockGenerationText = JSON.stringify({
      recommendations: [
        analysisFor(papers[0], {
          scenarioProblemValue: 70,
          methodNovelty: 70,
          practicalValue: 70,
          evidence: 70
        }),
        analysisFor(papers[1], {
          scenarioProblemValue: 80,
          methodNovelty: 80,
          practicalValue: 80,
          evidence: 60
        })
      ]
    });

    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "AI agent",
        threshold: 70,
        maxAnalyze: 2,
        maxRecommendations: 2,
        papers,
        llmApiKey: "test-api-key",
        llmProvider: "glm-coding-anthropic",
        llmModel: "glm-5.3"
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200, payload.detail || payload.message);
    assert.deepEqual(
      payload.analyzedPapers.map((paper) => paper.analysis.score),
      [72, 76]
    );
  } finally {
    mockGenerationText = previousGenerationText;
  }
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
  assert.match(html, /weekly-report-trace-summary-v2026-08-31/);
  assert.match(html, /id="weeklyReportTraceDialog"/);
  assert.match(html, /id="weeklyReportJobHealth"/);
  assert.match(html, /id="weeklyReportTraceReconnect"/);
  assert.match(html, /id="weeklyReportTraceRawList"/);
  assert.match(html, /id="weeklyReportManualReview"/);
  assert.match(html, /GLM-5\.3 \(Anthropic\)/);
  assert.match(html, /data-manual-review-action="continue_repair"/);
  assert.match(html, /data-manual-review-action="retry_job"/);
  assert.match(html, /data-manual-review-action="exit_task"/);
  assert.match(html, /data-manual-review-action="skip_paper"/);
  assert.match(html, /data-manual-review-action="ignore_warning"/);
  assert.match(html, /确认范围，抓取原文，排除无法支撑写作的论文。/);
  assert.match(html, /id="readingListMaxSelected"/);
  assert.match(html, /候选目标数/);

  const app = await fetch(`${baseUrl}/app.js`);
  assert.equal(app.status, 200);
  const source = await app.text();
  assert.match(source, /\/api\/reading-list\/jobs\/active/);
  assert.match(source, /weekly-report-job/);
  assert.match(source, /weeklyReportTracePhases/);
  assert.match(source, /weeklyReportTraceEventText/);
  assert.match(source, /weeklyReportHealthState/);
  assert.match(source, /connectionInterrupted: true/);
  assert.match(source, /weeklyReportDisconnectedJob/);
  assert.match(source, /weeklyReportRequestRetryable/);
  assert.match(source, /from "\.\/candidate-expansion\.js"/);
  assert.match(source, /expandCandidateBatches\(/);
  assert.match(source, /candidateExpansionNotice\(/);
  assert.match(source, /while \(!payload\)/);
  assert.match(source, /error\?\.status === 404/);
  assert.match(source, /weeklyReportTraceReconnect\.addEventListener/);
  assert.match(source, /appendWeeklyReportTraceDetail/);
  assert.match(source, /\[name, artifact\]/);
  assert.match(source, /weekly-report-trace-section-title/);
  assert.match(source, /weekly-report-trace-artifact-list/);
  assert.match(source, /weekly-report-trace-artifact/);
  assert.match(source, /\/decision/);
  assert.match(source, /renderWeeklyReportManualReview/);
  assert.match(source, /submitWeeklyReportManualReviewDecision/);
  assert.match(source, /if \(!report\)\s*\{[\s\S]*?renderWeeklyReportJobProgress\(job\);/);
  const styles = await fetch(`${baseUrl}/styles.css`);
  assert.equal(styles.status, 200);
  const stylesheet = await styles.text();
  assert.match(stylesheet, /\.weekly-report-trace-shell\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(stylesheet, /\.weekly-report-trace-shell\s*\{[^}]*overscroll-behavior:\s*contain/s);
  assert.match(stylesheet, /\.reading-list-shell\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(stylesheet, /\.reading-list-shell\s*\{[^}]*overscroll-behavior:\s*contain/s);
  assert.match(stylesheet, /\.reading-list-shell\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  assert.match(stylesheet, /\.weekly-report-trace-artifact-list\s*\{/);
  assert.match(stylesheet, /\.weekly-report-trace-artifact\s*\{/);
  assert.match(source, /本步骤做什么：/);
  assert.match(source, /确认取消当前周报任务？/);
  assert.match(
    source,
    /function weeklyReportPapers\(report = state\.currentReport\)\s*\{\s*return reportPapers\(report\);\s*\}/s
  );
});

test("周报弹窗只使用外层纵向滚动", async () => {
  const styles = await fetch(`${baseUrl}/styles.css`);
  assert.equal(styles.status, 200);
  const stylesheet = await styles.text();
  assert.match(stylesheet, /\.reading-list-output\s*\{[^}]*overflow:\s*hidden/s);
  assert.doesNotMatch(stylesheet, /\.reading-list-output\s*\{[^}]*overflow:\s*auto/s);
});

test("周报弹窗在关键状态时显示进度区", async () => {
  const [app, styles] = await Promise.all([
    fetch(`${baseUrl}/app.js`),
    fetch(`${baseUrl}/styles.css`)
  ]);
  assert.equal(app.status, 200);
  assert.equal(styles.status, 200);
  const source = await app.text();
  const stylesheet = await styles.text();
  assert.match(stylesheet, /\.reading-list-progress\s*\{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*z-index:/s);
  assert.match(source, /function revealReadingListProgress\(/);
  assert.match(source, /readingListShell\.scrollTo\(\{\s*top:/s);
  assert.match(source, /reveal:\s*true/);
});

test("周报弹窗不会为 Markdown 预览压缩进度步骤", async () => {
  const styles = await fetch(`${baseUrl}/styles.css`);
  assert.equal(styles.status, 200);
  const stylesheet = await styles.text();
  assert.match(stylesheet, /\.reading-list-progress\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
  assert.match(stylesheet, /\.reading-list-preview\s*\{[^}]*flex:\s*1\s+0\s+240px/s);
  assert.match(stylesheet, /@media\s*\(max-height:\s*700px\)[\s\S]*?\.reading-list-preview\s*\{[^}]*flex-basis:\s*160px/s);
});

test("周报未开始和等待管理员处理时不显示旋转动画", async () => {
  const [app, styles] = await Promise.all([
    fetch(`${baseUrl}/app.js`),
    fetch(`${baseUrl}/styles.css`)
  ]);
  assert.equal(app.status, 200);
  assert.equal(styles.status, 200);
  const source = await app.text();
  const stylesheet = await styles.text();
  assert.match(source, /classList\.toggle\("idle",\s*type === "idle"\)/);
  assert.match(source, /classList\.toggle\("waiting",\s*type === "waiting"\)/);
  assert.match(source, /waitingForAdmin\s*\?\s*"waiting"\s*:/);
  assert.match(stylesheet, /\.reading-list-dialog\.idle \.reading-list-progress \.spinner[\s\S]*?animation:\s*none/);
  assert.match(stylesheet, /\.reading-list-dialog\.waiting \.reading-list-progress \.spinner[\s\S]*?animation:\s*none/);
});

test("Agent Loop Trace 摘要不会被长告警文本挤出卡片", async () => {
  const styles = await fetch(`${baseUrl}/styles.css`);
  assert.equal(styles.status, 200);
  const stylesheet = await styles.text();
  assert.match(stylesheet, /\.reading-list-source-heading\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/s);
  assert.match(stylesheet, /\.reading-list-source-heading strong\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(stylesheet, /\.reading-list-source-actions span\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere[^}]*-webkit-line-clamp:\s*2/s);
  assert.match(stylesheet, /\.reading-list-source-toggle\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
});

test("周报 API 接受当前推荐列表中的跨周候选", async () => {
  const callsBeforeRequest = mockLlmCallCount;
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
      papers: fixturePapers.map((paper) => ({
        ...paper,
        published: "2026-07-20T00:00:00.000Z"
      }))
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 200, payload.detail || payload.message);
  assert.equal(payload.paperCount, 2);
  assert.equal(payload.candidateCount, 2);
  assert.equal(payload.excludedCrossWeekCount, 0);
  assert.equal(mockLlmCallCount, callsBeforeRequest + 1);
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

test("GLM-5.3 默认保留 Anthropic 接口和既有请求形状", async () => {
  mockGenerationText = validMarkdown;
  const requestsBeforeCall = mockLlmRequests.length;
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
  const request = mockLlmRequests.at(requestsBeforeCall);
  assert.equal(request.path, "/v1/messages");
  assert.equal(request.payload.model, "glm-5.3");
  assert.equal(request.payload.thinking, undefined);
  assert.equal(request.payload.messages[0].role, "user");
  assert.match(request.payload.system, /论文周报编辑/);
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
