import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleWeeklyReportMarkdown,
  READING_LIST_FOOTER_NOTE,
  WeeklyReportAssemblyError
} from "../weekly-report/report-writer.js";
import { validateWeeklyReportMarkdown } from "../weekly-report/publish-guard.js";

const source = (anchor, section, excerpt) => ({ anchor, section, excerpt });

const selectedItemFor = (paperId, rank, {
  title,
  finalScore,
  readingTier,
  selectionReason,
  affiliation
}) => ({
  paper: {
    id: paperId,
    title,
    absLink: `https://arxiv.org/abs/${paperId}`,
    summary: "OLD_ABSTRACT_MUST_NOT_ENTER_ASSEMBLED_REPORT"
  },
  evidenceCard: {
    paperId,
    problem: {
      summary: "Autonomous actions require pre-execution safety checks.",
      status: "supported",
      sources: [source("S1", "1 Introduction", "Autonomous actions require pre-execution safety checks.")]
    },
    method: {
      summary: "The method validates actions against explicit constraints.",
      status: "supported",
      sources: [source("S2", "2 Method", "The method validates actions against explicit constraints.")]
    },
    systemDesign: {
      summary: "A separate validation layer precedes execution.",
      status: "supported",
      sources: [source("S2", "2 Method", "A separate validation layer precedes execution.")]
    },
    experiments: {
      summary: "The evaluation uses simulated failure scenarios.",
      status: "supported",
      sources: [source("S3", "3 Evaluation", "The evaluation uses simulated failure scenarios.")]
    },
    results: {
      summary: "Unsafe actions are reduced by 37%.",
      status: "supported",
      sources: [source("S4", "4 Results", "Unsafe actions are reduced by 37%.")]
    },
    limitations: {
      summary: "Production traffic and validation latency are not evaluated.",
      status: "supported",
      sources: [
        source("S5", "5 Limitations", "Production traffic is not evaluated."),
        source("S5", "5 Limitations", "Validation latency is not quantified.")
      ]
    },
    affiliations: {
      summary: affiliation,
      status: "supported",
      sources: [source("S0", "Paper metadata", affiliation)]
    }
  },
  valueSignals: {
    paperId,
    signals: [{
      dimension: "methodNovelty",
      claim: "Constraint validation is the reusable method signal.",
      evidenceRefs: ["method:0"],
      readerImplication: "Read the validation mechanism first.",
      adnImplication: {
        relevance: "direct",
        angle: "closed_loop",
        insight: "The mechanism may constrain closed-loop network actions.",
        limit: "The evidence is simulation-only."
      },
      caveat: "No production deployment is evaluated."
    }]
  },
  reviewResult: {
    paperId,
    scores: {
      scenarioProblemValue: 82,
      methodNovelty: 86,
      practicalValue: 76,
      evidence: 70
    },
    rawScore: finalScore,
    interestFit: "target_network_autonomy",
    interestReason: "The work studies safety for autonomous network actions.",
    affiliations: [affiliation],
    affiliationEvidenceRefs: ["affiliations:0"]
  },
  calibrationResult: {
    paperId,
    status: "consistent",
    readingTier,
    relativePosition: "cohort position",
    suspectedMisjudgments: [],
    calibrationReason: "calibrated"
  },
  selection: {
    selected: true,
    selectionReason,
    finalScore,
    readingTier,
    rank
  }
});

const selectedItems = [
  selectedItemFor("2607.70001", 1, {
    title: "Guardrail Validation for Autonomous Actions",
    finalScore: 88,
    readingTier: "must_read",
    selectionReason: "threshold",
    affiliation: "示例网络研究院"
  }),
  selectedItemFor("2607.70002", 2, {
    title: "Evaluation Boundaries | Before Deployment",
    finalScore: 65,
    readingTier: "background_only",
    selectionReason: "fallback",
    affiliation: "示例通信大学"
  })
];

const grounded = (text, evidenceRefs) => ({ text, evidenceRefs });

const paperDraftFor = (item, marker) => ({
  paperId: item.paper.id,
  oneSentenceTakeaway: grounded(
    `${marker}：论文使用执行前约束验证降低自主动作风险。`,
    ["method:0"]
  ),
  researchProblem: grounded(
    "自主动作在执行前需要经过安全检查。",
    ["problem:0"]
  ),
  coreContribution: grounded(
    "论文将显式约束组织成可复用的验证机制。",
    ["method:0"]
  ),
  methodFramework: grounded(
    `${marker}：验证层位于规划和执行之间。`,
    ["method:0", "systemDesign:0"]
  ),
  experimentsAndResults: grounded(
    "在仿真故障场景中，危险动作减少了 37%。",
    ["experiments:0", "results:0"]
  ),
  limitationsAndConstraints: [
    grounded("尚未评估生产流量。", ["limitations:0"]),
    grounded("验证延迟尚未量化。", ["limitations:1"])
  ],
  adnInsight: grounded(
    "该机制可用于约束闭环网络动作，但当前证据仍以仿真为主。",
    ["method:0", "experiments:0"]
  ),
  readingValue: {
    whyWorthReading: grounded("它提供了具体的动作验证机制。", ["method:0"]),
    recommendedFocus: grounded("优先阅读验证机制及其执行位置。", ["method:0"]),
    evidenceBoundary: grounded("生产环境适用性仍待验证。", ["limitations:0"])
  },
  publicationMeta: {
    title: "TAMPERED MODEL TITLE",
    url: "https://arxiv.org/abs/9999.99999",
    affiliations: "串写单位",
    finalScore: 1,
    readingTier: "must_read",
    rank: 99,
    reviewScores: {}
  }
});

const paperDrafts = [
  paperDraftFor(selectedItems[0], "FIRST_PAPER_ONLY"),
  paperDraftFor(selectedItems[1], "SECOND_PAPER_ONLY")
];

const headTailDraft = {
  titleAngle: "Verifiable action constraints",
  description: "Grounded guidance for safer autonomous execution.",
  tags: ["network autonomy", "safety", "validation"],
  reportIntroduction: "本周入选论文共同关注自主动作执行前的验证机制及其部署边界。",
  trendJudgments: [{
    trendIndex: 0,
    claim: "安全验证正在前移到自主动作执行之前。",
    caveat: "现有评估仍以仿真为主。",
    supportingPaperIds: ["2607.70001", "2607.70002"],
    evidenceRefs: ["2607.70001:method:0", "2607.70002:results:0"],
    maturity: "developing"
  }],
  singlePaperObservations: [{
    observationIndex: 0,
    paperId: "2607.70002",
    claim: "第二篇论文适合作为部署边界的补充观察。",
    caveat: "不应将其单篇结论扩展为周趋势。",
    evidenceRefs: ["2607.70002:limitations:0"]
  }],
  readingOrder: [
    { paperId: "2607.70001", reason: "先理解约束验证机制。" },
    { paperId: "2607.70002", reason: "再检查部署与评估边界。" }
  ],
  closingSummary: "先读机制，再对照证据边界，并谨慎判断生产迁移价值。"
};

const reportMeta = {
  date: "2026-08-03",
  month: "2026-08",
  weekOfMonth: 1
};

test("assemble deterministically produces publishable Markdown from trusted artifacts", () => {
  const input = { reportMeta, selectedItems, paperDrafts, headTailDraft };
  const snapshot = structuredClone(input);
  const result = assembleWeeklyReportMarkdown(input);

  assert.deepEqual(input, snapshot);
  assert.match(result.markdown, /^---\ntitle: "【精选论文】26年8月第1周阅读清单：Verifiable action constraints"/);
  assert.match(result.markdown, /## 报告导读/);
  assert.match(result.markdown, /## 本周趋势判断/);
  assert.match(result.markdown, /### 单篇补充观察/);
  assert.match(result.markdown, /## 本周必读/);
  assert.match(result.markdown, /## 背景参考/);
  assert.match(result.markdown, /- 阅读价值评分：88/);
  assert.match(result.markdown, /- 阅读价值评分：65/);
  assert.match(result.markdown, /- 发表单位：示例网络研究院/);
  assert.match(result.markdown, /闭环评估/);
  assert.doesNotMatch(result.markdown, /闭环自治/);
  assert.match(result.markdown, /https:\/\/arxiv\.org\/abs\/2607\.70001/);
  assert.match(result.markdown, /\| Evaluation Boundaries \\| Before Deployment \|/);
  assert.equal(result.markdown.endsWith(READING_LIST_FOOTER_NOTE), true);
  assert.doesNotMatch(result.markdown, /。；/);
  assert.doesNotMatch(result.markdown, /[。！？]\s+边界：/u);
  assert.match(result.markdown, /安全验证正在前移到自主动作执行之前；边界：现有评估仍以仿真为主。/u);
  assert.match(result.markdown, /第二篇论文适合作为部署边界的补充观察；边界：不应将其单篇结论扩展为周趋势。/u);
  assert.match(result.markdown, /它提供了具体的动作验证机制；优先阅读验证机制及其执行位置。/);
  assert.doesNotMatch(result.markdown, /fallback|threshold|selectionReason|TAMPERED MODEL TITLE|9999\.99999|串写单位|OLD_ABSTRACT/);

  const validation = validateWeeklyReportMarkdown({
    markdown: result.markdown,
    papers: result.publishedPapers,
    report: result.report,
    useOriginalText: true,
    footerNote: result.footerNote
  });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
});

test("assemble follows Selection rank even when paperDraft input order is shuffled", () => {
  const result = assembleWeeklyReportMarkdown({
    reportMeta,
    selectedItems,
    paperDrafts: [...paperDrafts].reverse(),
    headTailDraft
  });
  const first = result.markdown.indexOf("### 1. Guardrail Validation");
  const second = result.markdown.indexOf("### 2. Evaluation Boundaries");

  assert.equal(first >= 0, true);
  assert.equal(second > first, true);
  const firstBlock = result.markdown.slice(first, second);
  const secondBlock = result.markdown.slice(second, result.markdown.indexOf("## 推荐阅读顺序"));
  assert.match(firstBlock, /FIRST_PAPER_ONLY/);
  assert.doesNotMatch(firstBlock, /SECOND_PAPER_ONLY/);
  assert.match(secondBlock, /SECOND_PAPER_ONLY/);
  assert.doesNotMatch(secondBlock, /FIRST_PAPER_ONLY/);
});

test("assemble preserves all four reading tiers with reader-facing labels", () => {
  const tiers = ["must_read", "worth_reading", "skim", "background_only"];
  const items = tiers.map((readingTier, index) => selectedItemFor(`2607.71${String(index).padStart(3, "0")}`, index + 1, {
    title: `Tier paper ${index + 1}`,
    finalScore: 90 - index * 10,
    readingTier,
    selectionReason: index ? "fallback" : "threshold",
    affiliation: `示例机构${index + 1}`
  }));
  const drafts = items.map((entry, index) => paperDraftFor(entry, `TIER_${index}`));
  const result = assembleWeeklyReportMarkdown({
    reportMeta,
    selectedItems: items,
    paperDrafts: drafts,
    headTailDraft: {
      ...headTailDraft,
      trendJudgments: [],
      singlePaperObservations: [],
      readingOrder: items.map((entry) => ({ paperId: entry.paper.id, reason: "按最终顺序阅读。" }))
    }
  });

  ["本周必读", "值得跟进", "快速扫读", "背景参考"].forEach((label) => {
    assert.match(result.markdown, new RegExp(`## ${label}`));
    assert.match(result.markdown, new RegExp(`\\| ${label} \\|`));
  });
});

test("assemble rejects missing, duplicate, or unknown paperDrafts", () => {
  const invalidCases = [
    paperDrafts.slice(0, 1),
    [paperDrafts[0], paperDrafts[0]],
    [...paperDrafts, { ...paperDrafts[0], paperId: "2607.79999" }]
  ];

  invalidCases.forEach((drafts) => {
    assert.throws(
      () => assembleWeeklyReportMarkdown({ reportMeta, selectedItems, paperDrafts: drafts, headTailDraft }),
      (error) => (
        error instanceof WeeklyReportAssemblyError
        && error.code === "READING_LIST_ASSEMBLY_ARTIFACT_MISMATCH"
      )
    );
  });
});
