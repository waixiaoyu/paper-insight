import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContextPacket,
  buildContextPacketFromLegacyPaper,
  prepareContextCandidates
} from "../weekly-report/context-builder.js";

const paragraph = (label, index, repeat = 5) => (
  `${label} paragraph ${index}. We describe concrete assumptions, mechanisms, inputs, outputs, `
  + `constraints, observations, and validation details needed to assess the paper accurately. `
).repeat(repeat);

const section = (heading, label, count = 3) => `
  <section>
    <h2>${heading}</h2>
    ${Array.from({ length: count }, (_, index) => `<p>${paragraph(label, index)}</p>`).join("\n")}
  </section>
`;

const validHtml = ({ includeExperiments = true, largeIntroduction = false } = {}) => `
<!doctype html>
<html>
  <head><title>Traceable Network Agent</title><style>.hidden { display: none; }</style></head>
  <body>
    <nav>Navigation must not enter the paper text.</nav>
    <article>
      <h1>Traceable Network Agent</h1>
      <p>Alice Example, Example University</p>
      <section><h2>Abstract</h2><p>${paragraph("abstract", 0, 2)}</p></section>
      ${section("1 Introduction", "INTRODUCTION_FILLER", largeIntroduction ? 24 : 3)}
      ${section("2 Method and System Architecture", "METHOD_PRIORITY_MARKER", 4)}
      ${includeExperiments ? section("3 Experimental Evaluation", "EXPERIMENT_PRIORITY_MARKER", 3) : ""}
      ${section(includeExperiments ? "4 Results and Discussion" : "3 Theoretical Analysis and Discussion", "RESULT_PRIORITY_MARKER", 3)}
      ${section("5 Limitations", "LIMITATION_PRIORITY_MARKER", 2)}
      ${section("6 Conclusion", "CONCLUSION_PRIORITY_MARKER", 2)}
      <section class="ltx_bibliography"><h2>References</h2><p>REFERENCES_SECRET_SHOULD_BE_REMOVED</p></section>
    </article>
    <footer>Footer must not enter the paper text.</footer>
    <script>const secret = "SCRIPT_SECRET";</script>
  </body>
</html>
`;

const validInput = (overrides = {}) => ({
  paperId: "2607.12345",
  source: "arxiv-html",
  url: "https://arxiv.org/html/2607.12345v1",
  httpStatus: 200,
  html: validHtml(),
  ...overrides
});

test("有效 arXiv HTML 生成结构化 contextPacket 并清除页面噪音", () => {
  const packet = buildContextPacket(validInput());

  assert.equal(packet.status, "available");
  assert.equal(packet.qualityGate.passed, true);
  assert.equal(packet.source, "arxiv-html");
  assert.equal(packet.sections.introduction, true);
  assert.equal(packet.sections.methodOrTheory, true);
  assert.equal(packet.sections.experimentOrEvaluation, true);
  assert.equal(packet.sections.resultsOrDiscussion, true);
  assert.equal(packet.sections.limitations, true);
  assert.equal(packet.sections.conclusion, true);
  assert.equal(packet.paragraphCount >= 8, true);
  assert.equal(packet.bodyChars > 2500, true);
  assert.equal(packet.qualityGate.checks.sourceValid, true);
  assert.equal(packet.qualityGate.checks.methodOrTheoryPresent, true);
  assert.equal(packet.qualityGate.thresholds.minBodyChars, 2500);
  assert.doesNotMatch(packet.inputText, /Navigation must not|Footer must not|SCRIPT_SECRET|REFERENCES_SECRET/);
});

test("摘要来源和 arXiv 摘要页永远不能进入周报发布链路", () => {
  const abstractSource = buildContextPacket(validInput({ source: "abstract_only" }));
  const abstractPage = buildContextPacket(validInput({
    url: "https://arxiv.org/abs/2607.12345",
    html: `<html><body><h1>Title</h1><h2>Abstract</h2><p>${paragraph("abstract", 0, 8)}</p></body></html>`
  }));

  assert.equal(abstractSource.status, "unavailable");
  assert.equal(abstractSource.qualityGate.passed, false);
  assert.equal(abstractSource.qualityGate.reasons.includes("source_not_arxiv_html"), true);
  assert.equal(abstractPage.status, "insufficient_full_text");
  assert.equal(abstractPage.qualityGate.reasons.includes("abstract_page_detected"), true);
});

test("正文过短或没有方法、理论、模型、系统、算法主体章节时失败", () => {
  const shortPacket = buildContextPacket(validInput({
    html: "<html><body><h1>Paper</h1><h2>Introduction</h2><p>Too short.</p></body></html>"
  }));
  const structurePacket = buildContextPacket(validInput({
    html: `<html><body><article><h1>Paper</h1>${section("1 Introduction", "intro", 10)}${section("2 Conclusion", "end", 5)}</article></body></html>`
  }));

  assert.equal(shortPacket.status, "insufficient_full_text");
  assert.equal(shortPacket.qualityGate.reasons.includes("clean_text_too_short"), true);
  assert.equal(structurePacket.status, "insufficient_full_text");
  assert.equal(structurePacket.qualityGate.reasons.includes("missing_method_or_theory_section"), true);
});

test("理论论文可以没有实验章节，但必须明确记录实验缺失", () => {
  const packet = buildContextPacket(validInput({ html: validHtml({ includeExperiments: false }) }));

  assert.equal(packet.status, "available");
  assert.equal(packet.qualityGate.passed, true);
  assert.equal(packet.sections.methodOrTheory, true);
  assert.equal(packet.sections.experimentOrEvaluation, false);
  assert.equal(packet.warnings.includes("experiment_or_evaluation_not_detected"), true);
});

test("超长原文按章节优先级裁剪，不能简单从头截断", () => {
  const packet = buildContextPacket(validInput({ html: validHtml({ largeIntroduction: true }) }), {
    storedMaxChars: 16000,
    inputMaxChars: 6500
  });

  assert.equal(packet.qualityGate.passed, true);
  assert.equal(packet.truncated, true);
  assert.equal(packet.inputChars <= 6500, true);
  assert.match(packet.inputText, /METHOD_PRIORITY_MARKER/);
  assert.match(packet.inputText, /RESULT_PRIORITY_MARKER/);
  assert.match(packet.inputText, /LIMITATION_PRIORITY_MARKER/);
  assert.match(packet.inputText, /CONCLUSION_PRIORITY_MARKER/);
  assert.equal(packet.truncation.omittedParagraphCount > 0, true);
});

test("旧 originalText 通过兼容入口复用同一质量门，且不读取摘要或旧分析补事实", () => {
  const htmlPacket = buildContextPacket(validInput());
  const legacyPacket = buildContextPacketFromLegacyPaper({
    id: "2607.12345",
    summary: "SUMMARY_SECRET_MUST_NOT_ENTER_CONTEXT",
    analysis: { tldr: "ANALYSIS_SECRET_MUST_NOT_ENTER_CONTEXT" },
    originalText: {
      status: "available",
      source: "arxiv-html",
      url: "https://arxiv.org/html/2607.12345v1",
      excerpt: htmlPacket.cleanText
    }
  });

  assert.equal(legacyPacket.qualityGate.passed, true);
  assert.equal(legacyPacket.compatibility.legacyOriginalText, true);
  assert.doesNotMatch(legacyPacket.inputText, /SUMMARY_SECRET|ANALYSIS_SECRET/);
});

test("prepare_context 先处理 primary，再按 reserve 原顺序增补到目标数量", async () => {
  const attempts = [];
  const packetFor = (paperId, passed) => ({
    paperId,
    status: passed ? "available" : "insufficient_full_text",
    qualityGate: {
      passed,
      reasons: passed ? [] : ["body_text_too_short"]
    }
  });
  const result = await prepareContextCandidates({
    primaryCandidates: [{ id: "p1" }, { id: "p2" }],
    reserveCandidates: [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
    minEligibleCount: 2,
    paperConcurrency: 2,
    buildContext: async (paper) => {
      attempts.push(paper.id);
      return packetFor(paper.id, ["p2", "r2"].includes(paper.id));
    }
  });

  assert.deepEqual(attempts, ["p1", "p2", "r1", "r2"]);
  assert.deepEqual(result.eligible.map((item) => item.paper.id), ["p2", "r2"]);
  assert.deepEqual(result.excluded.map((item) => item.paper.id), ["p1", "r1"]);
  assert.equal(result.reserveAttempted, 2);
  assert.equal(result.reserveRemaining, 1);
  assert.equal(result.outcome, "continue");
  assert.equal(result.underTarget, false);
});

test("候选耗尽时保留已有合格论文，只有零篇合格时才 reject", async () => {
  const packetFor = (paperId, passed) => ({
    paperId,
    status: passed ? "available" : "unavailable",
    qualityGate: { passed, reasons: passed ? [] : ["http_unavailable"] }
  });
  const partial = await prepareContextCandidates({
    primaryCandidates: [{ id: "only-valid" }],
    reserveCandidates: [{ id: "invalid" }],
    minEligibleCount: 3,
    buildContext: async (paper) => packetFor(paper.id, paper.id === "only-valid")
  });
  const empty = await prepareContextCandidates({
    primaryCandidates: [{ id: "invalid-primary" }],
    reserveCandidates: [],
    minEligibleCount: 3,
    buildContext: async (paper) => packetFor(paper.id, false)
  });

  assert.equal(partial.outcome, "continue");
  assert.equal(partial.underTarget, true);
  assert.equal(partial.eligible.length, 1);
  assert.equal(empty.outcome, "reject");
  assert.equal(empty.reason, "READING_LIST_NO_ELIGIBLE_PAPERS");
});

test("prepare_context 使用有限并发且结果顺序不依赖异步完成顺序", async () => {
  let active = 0;
  let maximumActive = 0;
  const result = await prepareContextCandidates({
    primaryCandidates: [{ id: "slow" }, { id: "fast" }, { id: "middle" }],
    reserveCandidates: [],
    minEligibleCount: 1,
    paperConcurrency: 2,
    buildContext: async (paper) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, { slow: 20, fast: 1, middle: 8 }[paper.id]));
      active -= 1;
      return {
        paperId: paper.id,
        status: "available",
        qualityGate: { passed: true, reasons: [] }
      };
    }
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(result.eligible.map((item) => item.paper.id), ["slow", "fast", "middle"]);
});

test("prepare_context 拒绝 contextPacket 与候选 paperId 不一致", async () => {
  const result = await prepareContextCandidates({
    primaryCandidates: [{ id: "2607.12345v2" }],
    reserveCandidates: [],
    buildContext: async () => ({
      paperId: "2607.99999",
      status: "available",
      qualityGate: { passed: true, reasons: [] }
    })
  });

  assert.equal(result.outcome, "reject");
  assert.equal(
    result.excluded[0].contextPacket.qualityGate.reasons.includes("context_paper_id_mismatch"),
    true
  );
});
