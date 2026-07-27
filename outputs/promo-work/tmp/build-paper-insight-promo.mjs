import fs from "node:fs/promises";
import { join } from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const OUT_DIR = "D:/code/paper-insight/outputs";
const ASSET_DIR = "D:/code/paper-insight/outputs/promo-assets";
const QA_DIR = "D:/code/paper-insight/outputs/promo-work/tmp/qa";
const FINAL_PPTX = join(OUT_DIR, "agentic-paper-insight-promo.pptx");

const W = 1280;
const H = 720;
const FONT = "Microsoft YaHei";

const C = {
  ink: "#071321",
  muted: "#52657A",
  quiet: "#EEF3F6",
  panel: "#F4F7F9",
  rule: "#CED9E2",
  teal: "#15748A",
  tealDark: "#0E5E72",
  tealSoft: "#DDF4F7",
  green: "#BFE8D7",
  amber: "#F7D894",
  white: "#FFFFFF",
  black: "#000000"
};

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.rm(QA_DIR, { recursive: true, force: true });
await fs.mkdir(QA_DIR, { recursive: true });

async function bytes(fileName) {
  const buffer = await fs.readFile(join(ASSET_DIR, fileName));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function line(fill = "none", width = 0) {
  return { style: "solid", fill, width };
}

function addShape(slide, position, fill = C.panel, lineFill = "none", radius = 0) {
  return slide.shapes.add({
    geometry: radius ? "roundRect" : "rect",
    position,
    fill,
    line: line(lineFill, lineFill === "none" ? 0 : 1),
    borderRadius: radius
  });
}

function addText(slide, text, position, opts = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    position,
    fill: "none",
    line: line(),
  });
  shape.text = text;
  shape.text.style = {
    fontSize: opts.size ?? 20,
    fontSizePt: opts.sizePt,
    bold: opts.bold ?? false,
    color: opts.color ?? C.ink,
    alignment: opts.align ?? "left",
    verticalAlignment: opts.valign ?? "top",
    lineSpacing: opts.lineSpacing ?? 1.12,
    typeface: opts.typeface ?? FONT,
    autoFit: opts.autoFit ?? "shrinkText",
    wrap: "square",
    insets: opts.insets ?? { top: 0, right: 0, bottom: 0, left: 0 }
  };
  return shape;
}

function addRule(slide, left, top, width, color = C.rule) {
  slide.shapes.add({
    geometry: "line",
    position: { left, top, width, height: 0 },
    fill: "none",
    line: { style: "solid", fill: color, width: 1 }
  });
}

function addFooter(slide, number) {
  addRule(slide, 42, 650, 1196, "#E3E8ED");
  addText(slide, "Agentic Paper Insight 宣传材料", { left: 42, top: 664, width: 420, height: 24 }, {
    size: 14,
    color: C.muted
  });
  addText(slide, String(number).padStart(2, "0"), { left: 1170, top: 662, width: 68, height: 26 }, {
    size: 14,
    color: C.muted,
    align: "right"
  });
}

function addEyebrow(slide, text, top = 40) {
  addText(slide, text, { left: 42, top, width: 420, height: 24 }, {
    size: 15,
    bold: true,
    color: C.tealDark
  });
}

function addTitle(slide, text, top = 70, width = 980) {
  addText(slide, text, { left: 42, top, width, height: 68 }, {
    size: 44,
    bold: true,
    color: C.ink,
    lineSpacing: 0.95
  });
}

function addSectionSlide(presentation, eyebrow, title, number) {
  const slide = presentation.slides.add();
  slide.background.fill = C.white;
  addEyebrow(slide, eyebrow);
  addTitle(slide, title);
  addFooter(slide, number);
  return slide;
}

async function addScreenshot(slide, fileName, position, alt, fit = "cover") {
  addShape(slide, {
    left: position.left - 6,
    top: position.top - 6,
    width: position.width + 12,
    height: position.height + 12
  }, C.white, C.rule, 8);
  slide.images.add({
    blob: await bytes(fileName),
    contentType: "image/png",
    alt,
    fit,
    position,
    geometry: "roundRect",
    borderRadius: 6
  });
}

function addMiniCard(slide, title, body, position, opts = {}) {
  addShape(slide, position, opts.fill ?? C.panel, opts.line ?? "none", 0);
  addText(slide, title, {
    left: position.left + 18,
    top: position.top + 18,
    width: position.width - 36,
    height: 34
  }, { size: opts.titleSize ?? 22, bold: true, color: opts.titleColor ?? C.ink });
  addText(slide, body, {
    left: position.left + 18,
    top: position.top + 62,
    width: position.width - 36,
    height: position.height - 80
  }, { size: opts.bodySize ?? 17, color: opts.bodyColor ?? C.muted, lineSpacing: 1.16 });
}

function addNumberedStep(slide, n, title, body, position, active = false) {
  const fill = active ? C.tealSoft : C.panel;
  addShape(slide, position, fill, active ? "#9DD3DD" : "none", 0);
  addShape(slide, { left: position.left + 18, top: position.top + 18, width: 34, height: 34 }, active ? C.teal : C.black, "none", 0);
  addText(slide, String(n), { left: position.left + 18, top: position.top + 21, width: 34, height: 24 }, {
    size: 16,
    bold: true,
    color: C.white,
    align: "center"
  });
  addText(slide, title, { left: position.left + 64, top: position.top + 16, width: position.width - 82, height: 28 }, {
    size: 20,
    bold: true,
    color: C.ink
  });
  addText(slide, body, { left: position.left + 64, top: position.top + 48, width: position.width - 82, height: position.height - 62 }, {
    size: 16,
    color: C.muted,
    lineSpacing: 1.12
  });
}

function addMetric(slide, stat, label, position) {
  addShape(slide, position, C.panel, "none", 0);
  addText(slide, stat, { left: position.left + 22, top: position.top + 22, width: position.width - 44, height: 62 }, {
    size: 52,
    bold: true,
    color: C.ink
  });
  addText(slide, label, { left: position.left + 22, top: position.top + 96, width: position.width - 44, height: position.height - 108 }, {
    size: 17,
    color: C.muted,
    lineSpacing: 1.14
  });
}

const presentation = Presentation.create({ slideSize: { width: W, height: H } });

// 1. Cover
{
  const slide = presentation.slides.add();
  slide.background.fill = C.white;
  addShape(slide, { left: 710, top: 0, width: 570, height: 720 }, C.panel);
  await addScreenshot(slide, "01-home-dashboard.png", { left: 692, top: 88, width: 548, height: 308 }, "Paper Insight 首页截图");
  await addScreenshot(slide, "05-recommendation-report.png", { left: 754, top: 370, width: 430, height: 242 }, "推荐报告截图");
  addText(slide, "AGENTIC PAPER INSIGHT", { left: 42, top: 48, width: 320, height: 28 }, {
    size: 16,
    bold: true,
    color: C.tealDark
  });
  addText(slide, "Agentic Paper Insight\n研究情报引擎", { left: 42, top: 112, width: 615, height: 190 }, {
    size: 58,
    bold: true,
    color: C.ink,
    lineSpacing: 0.94
  });
  addText(slide, "面向 AI Agent / 网络自治研究，把 arXiv 增量同步、内部推荐列表、人工确认、证据评分和外部精选报告串成可视化 Agentic 流程。", {
    left: 46,
    top: 330,
    width: 560,
    height: 92
  }, { size: 24, color: C.muted, lineSpacing: 1.18 });
  addShape(slide, { left: 42, top: 498, width: 260, height: 52 }, C.teal, "none", 0);
  addText(slide, "人机共控 / 全流程可视化", { left: 60, top: 512, width: 224, height: 28 }, {
    size: 18,
    bold: true,
    color: C.white,
    align: "center"
  });
  addFooter(slide, 1);
}

// 2. Problem and role
{
  const slide = addSectionSlide(presentation, "为什么需要", "真正难点是让研究判断可控、可见、不漂", 2);
  addText(slide, "周期性研究情报最容易出问题的地方不在生成文字，而在候选、评分和取舍。全自动会快，但容易把方向相关、证据薄弱和重复结果混在一起。", {
    left: 42,
    top: 152,
    width: 910,
    height: 70
  }, { size: 22, color: C.muted, lineSpacing: 1.18 });
  const items = [
    ["痛点 1：最新性难保证", "RSS 延迟、API 限流、重复记录和服务重启补同步，都会影响候选池的时间边界。"],
    ["痛点 2：候选口径会漂", "同样叫 AI Agent / 网络自治，不同查询会拉来不同候选；没有确认环节，噪声会直接进入分析。"],
    ["痛点 3：评分容易被主题带偏", "方向契合不等于研究质量高。只看单篇摘要，容易把概念包装误判为高价值。"],
    ["痛点 4：全自动流程不可见", "长链路里一次错误会被后续放大。没有可视化状态和人工关口，就很难追问依据或中途纠偏。"]
  ];
  items.forEach((item, i) => {
    addMiniCard(slide, item[0], item[1], {
      left: 42 + (i % 2) * 598,
      top: 272 + Math.floor(i / 2) * 132,
      width: 540,
      height: 108
    }, { titleSize: 19, bodySize: 16 });
  });
  addText(slide, "设计取向：AI 批量处理和组织证据，人通过可视化流程把住候选、阈值、隐藏/推荐和最终发布。", {
    left: 42,
    top: 566,
    width: 1030,
    height: 48
  }, { size: 22, bold: true, color: C.tealDark });
}

// 3. Workflow
{
  const slide = addSectionSlide(presentation, "系统流程", "系统把研究判断串成可视化 Agentic 闭环", 3);
  const steps = [
    ["arXiv 同步", "RSS 自动入库\n必要时 API 扩展"],
    ["设置查询", "点选或手输\n定义本轮主题"],
    ["确认候选", "人工保留\n要分析的论文"],
    ["AI 分析", "四维评分\n输出阅读建议"],
    ["推荐列表", "内部筛选层\n排序/隐藏/详情"],
    ["精选报告", "外部发布层\n复评后成稿"]
  ];
  steps.forEach((step, i) => {
    const x = 42 + i * 199;
    addShape(slide, { left: x, top: 230, width: 164, height: 164 }, i === 3 ? C.tealSoft : C.panel, i === 3 ? "#9DD3DD" : "none", 0);
    addText(slide, String(i + 1), { left: x + 18, top: 250, width: 32, height: 28 }, {
      size: 18,
      bold: true,
      color: i === 3 ? C.tealDark : C.black,
      align: "center"
    });
    addText(slide, step[0], { left: x + 22, top: 294, width: 120, height: 28 }, {
      size: 20,
      bold: true
    });
    addText(slide, step[1], { left: x + 22, top: 336, width: 120, height: 50 }, {
      size: 15,
      color: C.muted,
      lineSpacing: 1.12
    });
    if (i < steps.length - 1) {
      addText(slide, ">", { left: x + 171, top: 296, width: 28, height: 40 }, {
        size: 28,
        bold: true,
        color: C.rule,
        align: "center"
      });
    }
  });
  addText(slide, "两个结果层级：推荐列表用于内部筛选和复核；每周精选报告是外部发布层，只保留复评后真正入选的论文。", {
    left: 42,
    top: 470,
    width: 1020,
    height: 56
  }, { size: 23, bold: true, color: C.ink });
  addText(slide, "候选进入 AI 前由人确认，进入精选报告前再按阈值、保底数和原文复评结果把关。", {
    left: 42,
    top: 532,
    width: 900,
    height: 42
  }, { size: 20, color: C.muted });
}

// 4. Configuration
{
  const slide = addSectionSlide(presentation, "怎么用 1/4", "先配置 API 和查询口径，保证结果可控", 4);
  await addScreenshot(slide, "02-api-settings.png", { left: 50, top: 168, width: 560, height: 315 }, "API 设置界面");
  await addScreenshot(slide, "03-query-builder.png", { left: 670, top: 168, width: 560, height: 315 }, "查询条件设置界面");
  addText(slide, "API Key 只存当前浏览器会话，模型选择和 Key 管理集中在左上角设置。", {
    left: 56,
    top: 512,
    width: 500,
    height: 44
  }, { size: 18, color: C.muted });
  addText(slide, "查询条件支持点选和手工输入，适合把“默认主题”和“临时研究问题”分开管理。", {
    left: 676,
    top: 512,
    width: 510,
    height: 44
  }, { size: 18, color: C.muted });
  addText(slide, "推荐阈值、每轮候选数、最低达标数都在左侧控制，能适配扫读、重点跟踪和洞察输出三种强度。", {
    left: 42,
    top: 590,
    width: 1030,
    height: 32
  }, { size: 20, bold: true, color: C.tealDark });
}

// 5. Candidate confirmation
{
  const slide = addSectionSlide(presentation, "怎么用 2/4", "生成推荐列表前先确认候选，再交给 AI 分析", 5);
  addNumberedStep(slide, 1, "获取候选", "从本地 arXiv 库读取，必要时用 arXiv API 扩展。", { left: 42, top: 170, width: 320, height: 112 }, true);
  addNumberedStep(slide, 2, "确认论文", "取消明显不相关的候选，避免浪费模型调用。", { left: 42, top: 300, width: 320, height: 112 }, true);
  addNumberedStep(slide, 3, "继续分析", "分析失败可从当前论文重试，已成功项不重复调用。", { left: 42, top: 430, width: 320, height: 112 });
  await addScreenshot(slide, "04-candidate-confirmation.png", { left: 420, top: 166, width: 800, height: 450 }, "候选确认弹窗");
}

// 6. Recommendation report
{
  const slide = addSectionSlide(presentation, "怎么用 3/4", "推荐列表是内部筛选层，不是最终报告", 6);
  await addScreenshot(slide, "05-recommendation-report.png", { left: 390, top: 150, width: 840, height: 472 }, "推荐列表界面");
  addMetric(slide, "3", "推荐 / 隐藏 / 全部分析，用来做内部取舍", {
    left: 42,
    top: 160,
    width: 280,
    height: 142
  });
  addMetric(slide, "4", "问题 / 方法 / 系统 / 证据，解释为什么排序", {
    left: 42,
    top: 326,
    width: 280,
    height: 142
  });
  addText(slide, "定位：推荐列表面向研究团队，承载排序、隐藏、详情复核和继续分析，目标是帮人决定哪些论文进入精选报告。", {
    left: 42,
    top: 512,
    width: 292,
    height: 76
  }, { size: 19, bold: true, color: C.tealDark, lineSpacing: 1.14 });
}

// 7. Paper detail
{
  const slide = addSectionSlide(presentation, "怎么用 4/4", "单篇详情帮助读者快速决定要不要深读", 7);
  await addScreenshot(slide, "06-paper-detail.png", { left: 512, top: 150, width: 718, height: 404 }, "单篇分析详情页");
  const points = [
    ["方向适配", "网络自治/电信、通用 AI、非目标领域分开校准。"],
    ["背景与问题", "快速看论文解决的痛点是否和本周主题一致。"],
    ["方法与技术路线", "关注机制、工具调用、闭环和系统边界。"],
    ["贡献与证据", "核验实验、基线、消融和结论边界。"],
    ["价值与局限", "判断是否精读、复现或写入洞察稿"]
  ];
  points.forEach((p, i) => {
    addText(slide, p[0], { left: 54, top: 164 + i * 75, width: 140, height: 28 }, {
      size: 21,
      bold: true,
      color: i === 0 ? C.tealDark : C.ink
    });
    addText(slide, p[1], { left: 200, top: 164 + i * 75, width: 250, height: 48 }, {
      size: 17,
      color: C.muted,
      lineSpacing: 1.12
    });
    if (i < points.length - 1) {
      addRule(slide, 54, 226 + i * 75, 392, "#E7ECF0");
    }
  });
}

// 8. Reading list
{
  const slide = addSectionSlide(presentation, "发布输出", "每周精选报告是外部发布物", 8);
  await addScreenshot(slide, "07-reading-list-dialog.png", { left: 430, top: 150, width: 800, height: 450 }, "精选论文阅读清单弹窗");
  addMiniCard(slide, "再次复评", "优先抓取 arXiv HTML 原文，失败时可降级为摘要和已有分析。", {
    left: 42,
    top: 166,
    width: 320,
    height: 118
  }, { fill: C.tealSoft, line: "#9DD3DD" });
  addMiniCard(slide, "只收精选", "按入选阈值和保底篇数收口，推荐列表里的论文不会全部进入报告。", {
    left: 42,
    top: 312,
    width: 320,
    height: 118
  });
  addMiniCard(slide, "面向读者", "生成 Markdown 后可复制或下载，重点讲为什么读、怎么读和局限在哪里。", {
    left: 42,
    top: 458,
    width: 320,
    height: 118
  });
}

// 9. Advantages
{
  const slide = addSectionSlide(presentation, "优势在哪里", "优势来自可视化的人机共控 Agentic 流程", 9);
  addText(slide, "Agentic Paper Insight 把研究跟踪拆成可见、可控、可恢复的关口：机器负责同步、提取、评分和成稿，人负责方向、边界和最终判断。", {
    left: 42,
    top: 150,
    width: 1030,
    height: 56
  }, { size: 22, color: C.muted, lineSpacing: 1.16 });

  const hardParts = [
    ["优势 1：全流程可视化", "候选、确认、AI 分析、分数、详情和发布结果连续呈现，人能看见 Agent 走到哪一步、为什么这样判断。"],
    ["优势 2：人工参与是设计亮点", "候选确认、阈值调整、隐藏/推荐和阅读清单发布都留给人决策；Agent Loop 提供证据和建议。"],
    ["优势 3：评分和横向校准更硬", "四维质量评分与兴趣适配分离，同批候选再比较新意、证据和系统价值，避免“方向像”替代“质量高”。"],
    ["优势 4：长链路更稳", "增量同步、请求队列、429 冷却、失败续跑和 fallback 保底，让 Agentic 流程可恢复、可追踪。"]
  ];
  hardParts.forEach((item, i) => {
    addMiniCard(slide, item[0], item[1], {
      left: 42 + (i % 2) * 598,
      top: 238 + Math.floor(i / 2) * 142,
      width: 540,
      height: 116
    }, { fill: i === 3 ? C.tealSoft : C.panel, line: i === 3 ? "#9DD3DD" : "none", titleSize: 19, bodySize: 15.5 });
  });

  addShape(slide, { left: 42, top: 548, width: 1138, height: 72 }, C.teal, "none", 0);
  addText(slide, "Agentic 价值 = AI 扩展处理半径 + 全流程可视化 + 人在关键关口接管。\n系统不是替人做最终判断，而是把判断依据准备到足够清楚。", {
    left: 70,
    top: 560,
    width: 1082,
    height: 48
  }, { size: 21, bold: true, color: C.white, align: "center", lineSpacing: 1.05 });
}

// 10. Future roadmap
{
  const slide = presentation.slides.add();
  slide.background.fill = C.white;
  addEyebrow(slide, "未来优化");
  addTitle(slide, "从研究情报引擎扩展到团队 Agentic 系统", 70, 1120);
  addText(slide, "下一步不只是增加功能按钮，而是把论文跟踪、质量判断、团队协作和知识沉淀做成更完整的长期能力。", {
    left: 42,
    top: 150,
    width: 1030,
    height: 50
  }, { size: 22, color: C.muted, lineSpacing: 1.16 });

  const roadmap = [
    ["更强 Agent Loop", "把证据抽取、单篇复评、横向校准、成稿和 QA 做成可观察步骤，支持中间结果缓存和失败恢复。"],
    ["趋势雷达", "按主题、作者、机构和关键词聚类，持续追踪方向升温、交叉主题和异常高价值论文。"],
    ["团队协同", "支持多人标注、评论、收藏、入选理由和评分口径版本，让人工参与沉淀为团队资产。"],
    ["发布连接", "对接洞察网站、飞书 / Notion / Git 等发布流，输出模板化 Markdown 和历史精选合集。"],
    ["质量治理", "跟踪模型、提示词版本、评分一致性、成本和人工审核记录，让推荐质量可评估、可回滚。"]
  ];
  roadmap.slice(0, 3).forEach((item, i) => {
    addMiniCard(slide, item[0], item[1], {
      left: 42 + i * 398,
      top: 232,
      width: 356,
      height: 132
    }, { fill: i === 0 ? C.tealSoft : C.panel, line: i === 0 ? "#9DD3DD" : "none", titleSize: 19, bodySize: 15 });
  });
  roadmap.slice(3).forEach((item, i) => {
    addMiniCard(slide, item[0], item[1], {
      left: 42 + i * 598,
      top: 394,
      width: 540,
      height: 124
    }, { titleSize: 19, bodySize: 15.5 });
  });

  addShape(slide, { left: 42, top: 548, width: 1138, height: 72 }, C.teal, "none", 0);
  addText(slide, "未来方向：让系统从“帮人看一批论文”，升级为“持续维护一个可解释、可协作、可发布的研究情报流”。", {
    left: 74,
    top: 566,
    width: 1074,
    height: 36
  }, { size: 22, bold: true, color: C.white, align: "center", lineSpacing: 1.08 });
  addFooter(slide, 10);
}

for (const [index, slide] of presentation.slides.items.entries()) {
  const stem = `slide-${String(index + 1).padStart(2, "0")}`;
  const png = await presentation.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(join(QA_DIR, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(join(QA_DIR, `${stem}.layout.json`), await layout.text(), "utf8");
}

const montage = await presentation.export({ format: "webp", montage: true, scale: 1 });
await fs.writeFile(join(QA_DIR, "deck-montage.webp"), new Uint8Array(await montage.arrayBuffer()));

const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(FINAL_PPTX);

console.log(FINAL_PPTX);
