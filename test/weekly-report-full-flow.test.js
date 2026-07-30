import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const fixtureUrl = (name) => new URL(`./fixtures/weekly-report/${name}`, import.meta.url);
const papers = JSON.parse(await readFile(fixtureUrl("papers.json"), "utf8"));
const validMarkdown = await readFile(fixtureUrl("valid-summary-report.md"), "utf8");
const reviewedMarkdown = validMarkdown
  .replace("阅读价值评分：86", "阅读价值评分：77")
  .replace("阅读价值评分：68", "阅读价值评分：56");

const passingSemanticReview = JSON.stringify({
  verdict: "pass",
  score: 95,
  summary: "逐篇事实、趋势和证据边界均与输入一致。",
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

const reviewByPaperId = {
  "https://arxiv.org/abs/2607.11111": {
    scores: {
      scenarioProblemValue: 78,
      methodNovelty: 84,
      practicalValue: 69,
      evidence: 82
    },
    interestFit: "target_network_autonomy",
    interestReason: "论文直接研究网络智能体的动作护栏与安全验证。",
    affiliations: ["示例网络研究院"],
    affiliationEvidence: "原文作者区显示作者来自示例网络研究院。",
    tldr: "动作前护栏验证具有直接的网络智能体安全价值。",
    valueHighlight: "方法与证据较强，适合作为本周重点阅读。",
    reviewReason: "原文给出了动作候选、策略约束和验证结果之间的明确流程，并在仿真故障场景中评估危险动作控制效果。",
    evidenceBasis: "full-text"
  },
  "https://arxiv.org/abs/2607.22222": {
    scores: {
      scenarioProblemValue: 72,
      methodNovelty: 62,
      practicalValue: 70,
      evidence: 61
    },
    interestFit: "target_network_autonomy",
    interestReason: "论文直接研究网络数字孪生与闭环控制评估。",
    affiliations: ["示例通信大学"],
    affiliationEvidence: "原文作者区显示作者来自示例通信大学。",
    tldr: "数字孪生评估流程有参考价值，但方法与证据有限。",
    valueHighlight: "系统流程较清楚，适合作为低优先级补充阅读。",
    reviewReason: "原文说明了遥测、孪生状态和控制策略之间的数据流，但实验主要是少量仿真案例，缺少强基线和跨场景验证。",
    evidenceBasis: "full-text"
  }
};

const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

test("完整主流程经过原文、复评、选文、生成、质量门和语义评审", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "paper-insight-full-flow-"));
  const nativeFetch = globalThis.fetch;
  const arxivRequests = [];
  const llmRequests = [];
  const previousEnvironment = Object.fromEntries([
    "ARXIV_AUTO_SYNC",
    "ARXIV_MIN_INTERVAL_MS",
    "GLM_CODING_ANTHROPIC_API_URL",
    "LLM_API_KEY",
    "PAPER_ORIGINAL_TEXT_CACHE_DIR",
    "PAPER_ORIGINAL_TEXT_FETCH_TIMEOUT_MS",
    "WEEKLY_REPORT_SEMANTIC_REVIEW_MODE"
  ].map((key) => [key, process.env[key]]));
  let appServer;
  let llmServer;

  try {
    llmServer = createServer(async (request, response) => {
      let body = "";

      for await (const chunk of request) {
        body += chunk;
      }

      const envelope = JSON.parse(body);
      const userPayload = JSON.parse(envelope.messages[0].content);
      const task = userPayload.task === "weekly_report_semantic_review"
        ? "semantic-review"
        : userPayload.reviewContext
          ? "review"
          : "generation";
      llmRequests.push({ task, payload: userPayload });

      let text = reviewedMarkdown;

      if (task === "semantic-review") {
        text = passingSemanticReview;
      } else if (task === "review") {
        text = JSON.stringify({
          reviews: userPayload.papers.map((paper) => ({
            id: paper.id,
            ...reviewByPaperId[paper.id]
          }))
        });
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        content: [{ type: "text", text }]
      }));
    });

    await new Promise((resolve, reject) => {
      llmServer.once("error", reject);
      llmServer.listen(0, "127.0.0.1", () => {
        llmServer.off("error", reject);
        resolve();
      });
    });

    const llmAddress = llmServer.address();
    process.env.ARXIV_AUTO_SYNC = "0";
    process.env.ARXIV_MIN_INTERVAL_MS = "0";
    process.env.GLM_CODING_ANTHROPIC_API_URL = `http://127.0.0.1:${llmAddress.port}`;
    process.env.LLM_API_KEY = "test-api-key";
    process.env.PAPER_ORIGINAL_TEXT_CACHE_DIR = cacheDir;
    process.env.PAPER_ORIGINAL_TEXT_FETCH_TIMEOUT_MS = "5000";
    process.env.WEEKLY_REPORT_SEMANTIC_REVIEW_MODE = "warn";

    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

      if (url.startsWith("https://arxiv.org/html/")) {
        arxivRequests.push(url);
        const paperTopic = url.includes("2607.11111")
          ? "guardrail verification for autonomous network agents"
          : "digital twin evaluation for closed-loop network control";
        const evidence = `${paperTopic}. The authors describe methods, experiments, limitations, and affiliation evidence. `.repeat(30);
        return new Response(`<html><body><h1>${paperTopic}</h1><p>${evidence}</p></body></html>`, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }

      return nativeFetch(input, init);
    };

    ({ server: appServer } = await import("../server.js"));

    await new Promise((resolve, reject) => {
      appServer.once("error", reject);
      appServer.listen(0, "127.0.0.1", () => {
        appServer.off("error", reject);
        resolve();
      });
    });

    const appAddress = appServer.address();
    const response = await fetch(`http://127.0.0.1:${appAddress.port}/api/reading-list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "full-flow-test",
        date: "2026-07-29",
        month: "2026-07",
        weekOfMonth: 5,
        weekStart: "2026-07-26T16:00:00.000Z",
        weekEnd: "2026-08-02T16:00:00.000Z",
        useOriginalText: true,
        reviewBeforeGenerate: true,
        reviewScoreThreshold: 70,
        minSelectedCount: 2,
        papers
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200, payload.detail || payload.message);
    assert.equal(payload.useOriginalText, true);
    assert.equal(payload.reviewBeforeGenerate, true);
    assert.equal(payload.originalTextCount, 2);
    assert.equal(payload.originalTextUnavailableCount, 0);
    assert.equal(payload.reviewedPaperCount, 2);
    assert.equal(payload.thresholdSelectedCount, 1);
    assert.equal(payload.fallbackSelectedCount, 1);
    assert.equal(payload.publishValidation.valid, true);
    assert.equal(payload.semanticReview.verdict, "pass");
    assert.equal(payload.requiresManualReview, false);
    assert.match(payload.markdown, /阅读价值评分：77/);
    assert.match(payload.markdown, /阅读价值评分：56/);
    assert.equal(arxivRequests.length, 2);
    assert.deepEqual(llmRequests.map((item) => item.task), [
      "review",
      "review",
      "generation",
      "semantic-review"
    ]);

    const reviewRequests = llmRequests.filter((item) => item.task === "review");
    assert.equal(reviewRequests.length, 2);
    reviewRequests.forEach(({ payload: reviewPayload }) => {
      assert.equal(reviewPayload.reviewContext.useOriginalText, true);
      assert.equal(reviewPayload.papers[0].originalText.status, "available");
      assert.ok(reviewPayload.papers[0].originalText.excerpt.length >= 800);
    });

    const generationRequest = llmRequests.find((item) => item.task === "generation");
    assert.equal(generationRequest.payload.report.originalTextCount, 2);
    assert.equal(generationRequest.payload.report.reviewBeforeGenerate, true);
    assert.deepEqual(
      generationRequest.payload.papers.map((paper) => paper.readingListReview.score),
      [77, 56]
    );

    const semanticRequest = llmRequests.find((item) => item.task === "semantic-review");
    assert.equal(semanticRequest.payload.papers.length, 2);
    assert.ok(semanticRequest.payload.papers.every((paper) => paper.evidenceBasis === "full-text"));
  } finally {
    globalThis.fetch = nativeFetch;

    if (appServer?.listening) {
      await closeServer(appServer);
    }

    if (llmServer?.listening) {
      await closeServer(llmServer);
    }

    Object.entries(previousEnvironment).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });

    await rm(cacheDir, { recursive: true, force: true });
  }
});
