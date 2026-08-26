import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertWeeklyReportPublishable, validateWeeklyReportMarkdown } from "../weekly-report/publish-guard.js";

const fixtureUrl = (name) => new URL(`./fixtures/weekly-report/${name}`, import.meta.url);
const papers = JSON.parse(await readFile(fixtureUrl("papers.json"), "utf8"));
const markdown = await readFile(fixtureUrl("valid-summary-report.md"), "utf8");
const footerNote = "本文由论文推荐Agent生成+人工校对，欢迎提出宝贵建议。代码可开源，欢迎联系作者。编码工具Codex，编码模型chatgpt 5.5，论文分析模型GLM 5.3";
const report = { date: "2026-07-29", month: "2026-07", weekOfMonth: 5 };

const validate = (nextMarkdown, overrides = {}) => validateWeeklyReportMarkdown({
  markdown: nextMarkdown,
  papers,
  report,
  useOriginalText: false,
  footerNote,
  ...overrides
});

test("固定发布样本通过质量门", () => {
  const result = validateWeeklyReportMarkdown({
    markdown,
    papers,
    report,
    useOriginalText: false,
    footerNote
  });

  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.metrics.paperCount, 2);
  assert.equal(result.metrics.matchedPaperCount, 2);
  assert.deepEqual(result.metrics.unknownArxivIds, []);
});

test("缺少入选论文并混入未知 arXiv 论文时阻止发布", () => {
  const invalid = markdown
    .replaceAll("2607.22222", "2607.99999")
    .replaceAll(
      "Digital Twin Evaluation for Closed-Loop Network Control",
      "Hallucinated Cross-Domain Paper"
    );
  const result = validateWeeklyReportMarkdown({
    markdown: invalid,
    papers,
    report,
    useOriginalText: false,
    footerNote
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /正文缺少入选论文/);
  assert.match(result.errors.join("\n"), /未入选的 arXiv 论文/);
});

test("保底论文进入本周必读时阻止发布", () => {
  const invalid = markdown.replace(
    /## 本周必读\r?\n/,
    (marker) => `${marker}\nDigital Twin Evaluation for Closed-Loop Network Control\n`
  );
  const result = validateWeeklyReportMarkdown({
    markdown: invalid,
    papers,
    report,
    useOriginalText: false,
    footerNote
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /保底论文不能进入「本周必读」/);
});

test("摘要模式下每篇论文都必须声明证据边界", () => {
  const invalid = markdown.replace("基于摘要和已有分析看", "从论文内容看");
  const result = validateWeeklyReportMarkdown({
    markdown: invalid,
    papers,
    report,
    useOriginalText: false,
    footerNote
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /摘要模式下依据声明/);
});

test("发布正文出现内部流程词时阻止发布", () => {
  const invalid = markdown.replace("本周两篇论文", "本周复评阈值通过的两篇论文");

  assert.throws(
    () => assertWeeklyReportPublishable({
      markdown: invalid,
      papers,
      report,
      useOriginalText: false,
      footerNote
    }),
    (error) => {
      assert.equal(error.code, "WEEKLY_REPORT_QUALITY_GATE_FAILED");
      assert.equal(error.status, 502);
      assert.match(error.message, /内部流程词/);
      return true;
    }
  );
});

test("发布元数据或固定尾注不符合约定时阻止发布", () => {
  const invalid = markdown
    .replace('month: "2026-07"', 'month: "2026-06"')
    .replace("category: \"论文周报\"", "category: \"临时草稿\"")
    .replace(footerNote, "临时尾注");
  const result = validateWeeklyReportMarkdown({
    markdown: invalid,
    papers,
    report: { date: "2026-07-29", month: "2026-07", weekOfMonth: 5 },
    useOriginalText: false,
    footerNote
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /YAML month 应为 2026-07/);
  assert.match(result.errors.join("\n"), /YAML category/);
  assert.match(result.errors.join("\n"), /固定发布尾注/);
});

test("YAML 标题与正文标题不一致时阻止发布", () => {
  const invalid = markdown.replace(
    "# 【精选论文】26年7月第5周阅读清单：护栏验证与数字孪生评估构成本周主线",
    "# 【精选论文】26年7月第5周阅读清单：另一个不一致的发布标题观点"
  );
  const result = validate(invalid);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /YAML title 与正文一级标题不一致/);
});

test("日期、周次和论文数量与发布上下文不一致时阻止发布", () => {
  const invalid = markdown
    .replace('date: "2026-07-29"', 'date: "2026-07-22"')
    .replace("week_of_month: 5", "week_of_month: 4")
    .replace("paper_count: 2", "paper_count: 3");
  const result = validate(invalid);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /YAML date 应为 2026-07-29/);
  assert.match(result.errors.join("\n"), /YAML week_of_month 应为 5/);
  assert.match(result.errors.join("\n"), /YAML paper_count 为 3，实际入选 2 篇/);
});

test("核心章节、逐篇小节或发布字段缺失时阻止发布", () => {
  const invalid = markdown
    .replace("## 推荐阅读顺序", "## 建议阅读路线")
    .replace("**实验与结果**", "**实验摘要**")
    .replace("- 发表单位：示例通信大学", "- 机构：示例通信大学");
  const result = validate(invalid);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /缺少「推荐阅读顺序」章节/);
  assert.match(result.errors.join("\n"), /「实验与结果」小节只有 1 个/);
  assert.match(result.errors.join("\n"), /「发表单位」字段只有 1 个/);
});

test("完整论文清单表头被改变时阻止发布", () => {
  const invalid = markdown.replace(
    "| 论文 | 一句话介绍 | 阅读级别 | 链接 |",
    "| 论文 | 评分 | 链接 |"
  );
  const result = validate(invalid);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /完整论文清单缺少规定的四列表头/);
});

test("全文模式不强制要求摘要依据声明", () => {
  const fullTextMarkdown = markdown.replaceAll("基于摘要和已有分析看", "根据论文原文证据");
  const result = validate(fullTextMarkdown, { useOriginalText: true });

  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("带版本号的入选 arXiv 链接可以匹配无版本号发布链接", () => {
  const versionedPapers = papers.map((paper, index) => index === 0
    ? {
      ...paper,
      id: `${paper.id}v3`,
      absLink: `${paper.absLink}v3`
    }
    : paper);
  const result = validate(markdown, { papers: versionedPapers });

  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.metrics.matchedPaperCount, 2);
});

test("空论文集合不能形成可发布周报", () => {
  const result = validate(markdown, { papers: [] });

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /没有可发布的入选论文/);
  assert.match(result.errors.join("\n"), /YAML paper_count 为 2，实际入选 0 篇/);
});

test("过长标题观点和 description 会被质量门拒绝", () => {
  const longSuffix = "这是一个超过三十二个字符并且不适合直接发布到洞察网站的冗长周报标题观点";
  const longDescription = "这是一段明显超过五十五个字符限制的周报描述，为了验证发布质量门能够阻止过长元数据进入最终发布内容而专门构造，并继续补充足够多的文字确保长度确实越过限制。";
  const invalid = markdown
    .replaceAll(
      "护栏验证与数字孪生评估构成本周主线",
      longSuffix
    )
    .replace(
      "网络智能体开始重视可验证护栏，数字孪生成为闭环评估的重要工具",
      longDescription
    );
  const result = validate(invalid);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /YAML description 超过 55 个字符/);
  assert.match(result.errors.join("\n"), /标题观点超过 32 个字符/);
});

test("逐篇发布评分必须与复评分一致", () => {
  const invalid = markdown.replace("阅读价值评分：86", "阅读价值评分：96");
  const result = validate(invalid);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /发布评分 96 与复评分 86 不一致/);
});

test("逐篇高分维度必须与复评维度及分数一致", () => {
  const invalid = markdown.replace("方法新意 84", "方法新意 64");
  const result = validate(invalid);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /发布维度缺少 方法新意 84/);
});

test("发表单位与复评单位线索不一致或串入其他论文时阻止发布", () => {
  const invalid = markdown.replace(
    "发表单位：示例网络研究院",
    "发表单位：示例通信大学"
  );
  const result = validate(invalid);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /发表单位与复评单位线索不一致/);
  assert.match(result.errors.join("\n"), /发表单位疑似串入其他论文/);
});

test("单位线索不足时发布正文必须保留证据边界", () => {
  const uncertainPapers = papers.map((paper, index) => index === 1
    ? {
      ...paper,
      readingListReview: {
        ...paper.readingListReview,
        affiliations: ["单位线索不足"]
      }
    }
    : paper);
  const result = validate(markdown, { papers: uncertainPapers });

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /单位线索不足，发布正文却未保留该证据边界/);
});

test("逐篇正文串入另一篇入选论文链接时阻止发布", () => {
  const invalid = markdown.replace(
    "适合用于设计 ADN 网络智能体的动作审批和审计接口。",
    "适合用于设计 ADN 网络智能体的动作审批和审计接口，同时参考 https://arxiv.org/abs/2607.22222。"
  );
  const result = validate(invalid);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /逐篇正文串入其他入选论文链接/);
});

test("论文只出现在完整清单、没有独立正文条目时阻止发布", () => {
  const invalid = markdown.replace(
    /## 快速扫读[\s\S]*?(?=## 推荐阅读顺序)/,
    ""
  );
  const result = validate(invalid);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /论文缺少独立的逐篇正文条目/);
});

test("无法从该论文输入证据核对的精确数字会被视为语义幻觉", () => {
  const invalid = markdown.replace(
    "验证层降低了危险动作比例，但真实部署证据仍有限。",
    "验证层将危险动作比例降低了 37.5%，但真实部署证据仍有限。"
  );
  const result = validate(invalid);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /无法从输入证据核对的精确数字：37.5%/);
});

test("精确数字能在对应论文证据中找到时允许发布", () => {
  const supportedMarkdown = markdown.replace(
    "验证层降低了危险动作比例，但真实部署证据仍有限。",
    "验证层将危险动作比例降低了 37.5%，但真实部署证据仍有限。"
  );
  const groundedPapers = papers.map((paper, index) => index === 0
    ? {
      ...paper,
      summary: `${paper.summary} The dangerous-action rate was reduced by 37.5%.`
    }
    : paper);
  const result = validate(supportedMarkdown, { papers: groundedPapers });

  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("每篇论文的局限与适用约束必须至少包含两条", () => {
  const invalid = markdown.replace(
    "- 复杂策略的维护成本和验证延迟尚未被充分量化。",
    "复杂策略的维护成本和验证延迟尚未被充分量化。"
  );
  const result = validate(invalid);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /局限与适用约束少于 2 条/);
});

test("测试样本路径可从 ESM URL 正确解析", () => {
  assert.match(fileURLToPath(fixtureUrl("papers.json")), /papers\.json$/);
});
