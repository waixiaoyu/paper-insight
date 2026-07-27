import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs";

const outDir = "D:/code/paper-insight/outputs/promo-assets";
await mkdir(outDir, { recursive: true });

const now = "2026-07-25T02:30:00.000Z";

const makePaper = ({
  id,
  title,
  authors,
  published,
  category,
  source,
  summary,
  scores,
  interestFit = "target_network_autonomy",
  interestLabel = "网络自治/电信方向",
  interestAdjustment = 4,
  tldr,
  highlight,
  keywords,
  tags = ["ICT"],
  notRecommendReason = ""
}) => ({
  id: `https://arxiv.org/abs/${id}`,
  arxivId: id,
  title,
  authors,
  published,
  updated: published,
  primaryCategory: category,
  categories: [category, "cs.AI", "cs.LG"],
  absLink: `https://arxiv.org/abs/${id}`,
  link: `https://arxiv.org/abs/${id}`,
  candidateSourceLabel: source,
  summary,
  analysis: {
    score: 0,
    scores,
    interestFit,
    interestLabel,
    interestAdjustment,
    interestReason: interestFit === "target_network_autonomy"
      ? "方向适配：命中网络自治、网络数字孪生或闭环网络运维问题，小幅提升排序优先级。"
      : "方向适配：属于通用 AI/Agent 系统方法，适合评估向网络自治场景迁移的可能性。",
    dimensionDetails: [
      { key: "scenarioProblemValue", label: "研究问题价值", score: scores.scenarioProblemValue },
      { key: "methodNovelty", label: "方法新意", score: scores.methodNovelty },
      { key: "practicalValue", label: "系统价值", score: scores.practicalValue },
      { key: "evidence", label: "证据强度", score: scores.evidence }
    ],
    matchedDimensions: ["方法新意", "系统价值"],
    tldr,
    valueHighlight: highlight,
    problem: "面向自治网络场景，论文尝试解决跨域感知、策略生成和闭环验证之间割裂的问题。",
    background: "现有网络智能化系统往往把异常检测、根因分析和策略执行拆成孤立模块，难以形成可追踪的端到端闭环。",
    method: "论文构建了以任务分解、工具调用、状态记忆和安全校验为核心的智能体流程，将网络状态、意图约束和执行反馈纳入同一分析链路。",
    technicalDetails: "系统采用检索增强上下文、候选策略排序、规则约束校验和人工复核接口，降低模型直接下发网络策略的风险。",
    contribution: "主要贡献在于把大模型智能体从问答助手推进到可审计的网络运维工作流，并提供了可复用的模块边界。",
    experiment: "实验部分给出了多个网络故障与策略优化案例，报告了基线对比、消融和人工评审结果，但仍需要在真实生产网中继续验证。",
    networkUseCase: "适合用于告警聚合、根因定位、网络数字孪生仿真建议和变更方案初审。",
    limitations: "论文主要依赖离线数据和半自动评测，在线闭环执行的安全边界和回滚机制仍需工程补充。",
    recommendedReadingPath: "先读系统架构和评测设计，再核验工具调用约束、失败处理和真实网络数据来源。",
    whyRecommend: "它把智能体能力放进网络自治闭环中讨论，方法边界、系统模块和验证路径都比较清楚。",
    notRecommendReason,
    readingGuide: [
      "先看系统架构图，确认智能体、工具和网络状态之间的数据流。",
      "重点核验实验部分是否包含基线、消融和失败案例。",
      "评估策略执行前是否有可解释校验与人工接管机制。"
    ],
    industryTags: tags,
    matchedKeywords: keywords
  }
});

const demoReport = {
  key: "demo-2026-07-25-paper-insight",
  title: "演示推荐列表",
  createdAt: now,
  mode: "glm-coding-anthropic",
  threshold: 70,
  minRecommended: 3,
  extraBatchCount: 1,
  stoppedAfterTarget: true,
  skippedAfterTarget: 4,
  candidateCount: 6,
  items: [
    makePaper({
      id: "2607.25101",
      title: "Agentic Closed-Loop Control for Autonomous Network Operations",
      authors: ["Li Wei", "Chen Ming", "Aisha Rahman", "Tom Berger"],
      published: "2026-07-23",
      category: "cs.NI",
      source: "本地 arXiv 库",
      scores: { scenarioProblemValue: 92, methodNovelty: 91, practicalValue: 88, evidence: 92 },
      summary: "This paper studies an agentic workflow for autonomous network operations with retrieval, policy validation, and operator-in-the-loop control.",
      tldr: "把 LLM Agent 放入网络运维闭环，系统边界和验证机制都比较完整。",
      highlight: "强项来自方法新意和证据强度，给出了工具调用约束、策略校验和多场景评测。",
      keywords: ["LLM agent", "closed-loop autonomy", "network operations", "policy validation"]
    }),
    makePaper({
      id: "2607.25112",
      title: "Network Digital Twin Planning with Tool-Augmented Language Agents",
      authors: ["Maria Novak", "Zhang Rui", "Kenta Sato"],
      published: "2026-07-22",
      category: "cs.DC",
      source: "arXiv API",
      scores: { scenarioProblemValue: 84, methodNovelty: 86, practicalValue: 82, evidence: 84 },
      summary: "The work connects language agents with network digital twin simulators to produce and verify candidate planning actions.",
      tldr: "将智能体和网络数字孪生仿真器连接起来，适合关注规划建议的可验证性。",
      highlight: "系统价值较强，明确区分了生成建议、仿真验证和人工确认三个阶段。",
      keywords: ["network digital twin", "tool use", "planning", "simulation"]
    }),
    makePaper({
      id: "2607.25133",
      title: "Benchmarking Multi-Agent Reasoning for Telecom Incident Response",
      authors: ["Nora Smith", "Huang Jie", "Luis Ortega"],
      published: "2026-07-21",
      category: "cs.AI",
      source: "本地 arXiv 库",
      scores: { scenarioProblemValue: 80, methodNovelty: 78, practicalValue: 74, evidence: 76 },
      summary: "A benchmark for evaluating multi-agent reasoning on telecom incident triage, evidence gathering, and repair suggestion tasks.",
      tldr: "用电信故障响应任务评测多智能体推理，适合作为基准和流程设计参考。",
      highlight: "价值主要来自研究问题定义，任务拆解和评测标签对后续复现实验有帮助。",
      keywords: ["multi-agent", "telecom", "incident response", "benchmark"]
    }),
    makePaper({
      id: "2607.25145",
      title: "General Tool-Calling Agents for Enterprise Knowledge Work",
      authors: ["Priya Kumar", "Alex Johnson"],
      published: "2026-07-20",
      category: "cs.AI",
      source: "arXiv API 缓存",
      scores: { scenarioProblemValue: 74, methodNovelty: 68, practicalValue: 70, evidence: 62 },
      interestFit: "general_ai_system",
      interestLabel: "通用 AI/Agent 方法",
      interestAdjustment: 2,
      summary: "The paper presents a general-purpose tool-calling workflow for knowledge work, without a network-specific scenario or strong evaluation.",
      tldr: "通用工具调用流程有参考价值，但缺少网络场景和扎实评测。",
      highlight: "",
      keywords: ["tool calling", "workflow", "enterprise agent"],
      tags: [],
      notRecommendReason: "方法主要是常规工具调用流程拼装，缺少可迁移的新机制和强基线评测。"
    })
  ],
  readingList: {
    title: "【精选论文】26年7月第4周阅读清单：智能体闭环开始走向网络运维",
    generatedAt: "2026-07-25T03:10:00.000Z",
    markdown: "# 【精选论文】26年7月第4周阅读清单：智能体闭环开始走向网络运维\n\n本周高价值论文集中在 LLM Agent 与网络数字孪生、闭环运维、故障响应评测的结合。\n\n## 本周必读\n\n1. Agentic Closed-Loop Control for Autonomous Network Operations：建议优先阅读系统架构、策略校验和实验设计。\n2. Network Digital Twin Planning with Tool-Augmented Language Agents：关注仿真验证和人工确认流程。\n\n## 快速扫读\n\n- Benchmarking Multi-Agent Reasoning for Telecom Incident Response：适合作为评测任务设计参考。\n\n> 本段为演示数据，用于展示 Paper Insight 的周报导出形态。",
    paperCount: 3,
    reviewedPaperCount: 4,
    fallbackSelectedCount: 1,
    candidateFloor: 60,
    reviewScoreThreshold: 70,
    minSelectedCount: 3,
    useOriginalText: true,
    originalTextCount: 2,
    skippedOriginalTextCount: 1
  }
};

const candidateXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>https://arxiv.org/abs/2607.25101</id>
    <updated>2026-07-23T00:00:00Z</updated>
    <published>2026-07-23T00:00:00Z</published>
    <title>Agentic Closed-Loop Control for Autonomous Network Operations</title>
    <summary>This paper studies an agentic workflow for autonomous network operations with retrieval, policy validation, and operator-in-the-loop control.</summary>
    <author><name>Li Wei</name></author>
    <author><name>Chen Ming</name></author>
    <arxiv:primary_category term="cs.NI"/>
    <category term="cs.NI"/>
    <link href="https://arxiv.org/abs/2607.25101" rel="alternate" type="text/html"/>
  </entry>
  <entry>
    <id>https://arxiv.org/abs/2607.25112</id>
    <updated>2026-07-22T00:00:00Z</updated>
    <published>2026-07-22T00:00:00Z</published>
    <title>Network Digital Twin Planning with Tool-Augmented Language Agents</title>
    <summary>The work connects language agents with network digital twin simulators to produce and verify candidate planning actions.</summary>
    <author><name>Maria Novak</name></author>
    <author><name>Zhang Rui</name></author>
    <arxiv:primary_category term="cs.DC"/>
    <category term="cs.DC"/>
    <link href="https://arxiv.org/abs/2607.25112" rel="alternate" type="text/html"/>
  </entry>
</feed>`;

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe"
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1
});

await context.addInitScript(({ report, query }) => {
  localStorage.setItem("paper-insight:scoring-rules-version", "research-quality-rubric-soft-interest-no-cap-v2026-07-21b");
  localStorage.setItem("paper-insight:query-defaults-version", "agentic-autonomy-no-domain-2026-06");
  localStorage.setItem("paper-insight:weekly", JSON.stringify([report]));
  localStorage.setItem("paper-insight:query", query);
  localStorage.setItem("paper-insight:query-mode", "builder");
  sessionStorage.setItem("paper-insight:llm-key", "demo-key-for-screenshot");
  sessionStorage.setItem("paper-insight:llm-provider", "glm-coding-anthropic");
  sessionStorage.setItem("paper-insight:llm-model:glm-coding-anthropic", "glm-5.2");
}, {
  report: demoReport,
  query: "(\"large language model\" OR \"LLM\" OR \"AI agent\") AND (\"autonomous network\" OR \"network digital twin\" OR \"closed-loop autonomy\")"
});

const page = await context.newPage();
await page.route("**/api/papers?**", async (route) => {
  await route.fulfill({
    status: 200,
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      "x-paper-insight-source": "arxiv-library"
    },
    body: candidateXml
  });
});

async function shot(name) {
  await page.screenshot({ path: join(outDir, name), fullPage: false });
}

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.locator("#homeView.active").waitFor();
await shot("01-home-dashboard.png");

await page.locator("#openApiDialog").click();
await page.locator("#apiDialog[open]").waitFor();
await shot("02-api-settings.png");
await page.locator("#apiClose").click();

await page.locator("#openQueryDialog").click();
await page.locator("#queryDialog[open]").waitFor();
await shot("03-query-builder.png");
await page.locator("#queryClose").click();

await page.locator("#generateReport").click();
await page.locator("#taskDialog[open]").waitFor();
await page.locator("#candidateList .candidate-item").first().waitFor({ timeout: 15000 });
await shot("04-candidate-confirmation.png");
await page.locator("#taskClose").click();

await page.locator(".report-card").first().click();
await page.locator("#reportView.active").waitFor();
await page.locator(".paper-card").first().waitFor();
await shot("05-recommendation-report.png");

await page.locator(".paper-card .detail-button").first().click();
await page.locator("#paperView.active").waitFor();
await page.locator("#analysisDetail").waitFor();
await shot("06-paper-detail.png");

await page.locator("#backToReports").click();
await page.locator("#reportView.active").waitFor();
await page.locator("#generateReadingList").click();
await page.locator("#readingListDialog[open]").waitFor();
await shot("07-reading-list-dialog.png");

await browser.close();
