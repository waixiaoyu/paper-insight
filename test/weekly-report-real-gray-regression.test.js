import test from "node:test";
import assert from "node:assert/strict";

import { validateHeadTailDraft } from "../weekly-report/editorial-agent.js";
import { validatePaperDraft } from "../weekly-report/report-writer.js";

const source = (field, index, excerpt) => ({
  anchor: `${field}-${index}`,
  section: "ExtractBench source",
  excerpt
});

const evidenceCard = {
  paperId: "2607.29677",
  problem: {
    status: "supported",
    sources: [
      source("problem", 0, "Although there have been attempts from multiple existing benchmarks to tackle this challenge, they all have critical limitations."),
      source("problem", 1, "Even the best overall word-level grounding F1 remains below 50%. Systems are increasingly capable of extracting values and often identifying their source pages, but reliably connecting each value to its exact supporting evidence remains an open problem.")
    ]
  },
  method: {
    status: "supported",
    sources: [
      source("method", 0, "ExtractBench contains 370 documents ( 4,869 pages) across 8 business domains and 67 document types."),
      source("method", 1, "To establish high-quality ground truth at scale, we design a scalable pipeline: independent-system proposals are adjudicated for real documents, values are set before rendering for synthetic lists, and humans verify both values and grounding on scanned forms.")
    ]
  },
  systemDesign: {
    status: "supported",
    sources: [
      source("systemDesign", 0, "ExtractBench instead tags each document along five independent axes: task challenge, perception challenge, table structure, length, and business domain."),
      source("systemDesign", 1, "We combine three sources of documents: frontier-model ensembles for real documents, programmatic generation for synthetic long lists, and human labelers for scanned forms.")
    ]
  },
  experiments: {
    status: "supported",
    sources: [
      source("experiments", 0, "We evaluate 14 extraction systems. Models and prices reflect those available as of July 1, 2026."),
      source("experiments", 1, "All systems receive the same document-schema pairs and are evaluated without benchmark-specific tuning; all runs took place in June-July 2026.")
    ]
  },
  results: {
    status: "supported",
    sources: [
      source("results", 0, "Agentic Plus outperforms both coding agents while costing no more than half as much."),
      source("results", 1, "On long documents the commercial VLMs fall below 40%, while Claude Code Opus 4.8 (88.1%) and Reducto Deep Extract (92.0%) remain close to their short-document scores."),
      source("results", 2, "Even the best overall word-level grounding F1 remains below 50%.")
    ]
  },
  limitations: {
    status: "supported",
    sources: [
      source("limitations", 0, "Because the four self-hosted VLMs have no directly comparable API price, we omit them from cost comparisons."),
      source("limitations", 1, "VLMs and coding agents do not return evidence by default; they therefore score zero at both grounding levels.")
    ]
  },
  affiliations: { status: "not_present", sources: [] }
};

const selectedItem = {
  paper: {
    id: "2607.29677",
    title: "ExtractBench: A Benchmark for Schema-Guided Enterprise Document Extraction",
    absLink: "https://arxiv.org/abs/2607.29677"
  },
  contextPacket: { paperId: "2607.29677" },
  evidenceCard,
  valueSignals: { paperId: "2607.29677", signals: [] },
  reviewResult: {
    paperId: "2607.29677",
    scores: {
      scenarioProblemValue: 85,
      methodNovelty: 80,
      practicalValue: 90,
      evidence: 85
    },
    interestFit: "general_ai_system"
  },
  calibrationResult: {
    paperId: "2607.29677",
    status: "consistent",
    readingTier: "worth_reading"
  },
  selection: { finalScore: 79, readingTier: "worth_reading", rank: 1 }
};

const paperDraft = {
  paperId: "2607.29677",
  oneSentenceTakeaway: {
    text: "ExtractBench 提出了一个包含 370 份文档、覆盖 8 个业务领域的抽取评测基准，评测发现现有系统的词级证据定位 F1 仍低于 50%。",
    evidenceRefs: ["method:0", "results:2"]
  },
  researchProblem: {
    text: "现有的文档抽取基准存在关键局限性，将每个数值可靠地连接到其确切支持证据仍然是一个未解决的问题。",
    evidenceRefs: ["problem:0", "problem:1"]
  },
  coreContribution: {
    text: "该工作构建了包含 370 份文档、覆盖 8 个业务领域和 67 种文档类型的 ExtractBench 基准。",
    evidenceRefs: ["method:0"]
  },
  methodFramework: {
    text: "标注流程结合独立系统裁决、程序化生成和人工验证。",
    evidenceRefs: ["method:1"]
  },
  experimentsAndResults: {
    text: "该研究评估了 14 个抽取系统。在长文档上，商业 VLM 的得分低于 40%，Claude Code Opus 4.8 为 88.1%，Reducto Deep Extract 为 92.0%。",
    evidenceRefs: ["experiments:0", "results:1"]
  },
  limitationsAndConstraints: [
    {
      text: "四个自托管 VLM 没有可直接比较的 API 价格，因此未进入成本比较。",
      evidenceRefs: ["limitations:0"]
    },
    {
      text: "VLM 和编码代理默认不返回证据，因此它们在两个证据定位级别上的得分均为零。",
      evidenceRefs: ["limitations:1"]
    }
  ],
  adnInsight: {
    text: "该基准可作为文档抽取与证据溯源能力的标准化测试场景。",
    evidenceRefs: ["experiments:0", "experiments:1"]
  },
  readingValue: {
    whyWorthReading: {
      text: "该研究提供了跨多种文档类型和业务领域的标准化评测数据。",
      evidenceRefs: ["method:0"]
    },
    recommendedFocus: {
      text: "建议关注不同系统在长文档处理上的表现差异，以及各系统在词级证据定位方面的具体测量结果。",
      evidenceRefs: ["results:1", "results:2"]
    },
    evidenceBoundary: {
      text: "结果基于 2026 年 7 月 1 日可用的模型和价格，运行时间为 2026 年 6 月至 7 月。",
      evidenceRefs: ["experiments:0", "experiments:1"]
    }
  }
};

const editorialPlan = {
  coreTheme: "文档信息抽取系统的多维度评测与证据定位能力评估",
  titleAngle: "文档抽取系统在长文本与证据定位上的评测",
  trends: [],
  singlePaperObservations: [{
    paperId: "2607.29677",
    claim: "ExtractBench 对 14 个抽取系统进行评测。",
    evidenceRefs: ["2607.29677:experiments:0"],
    caveat: "四个自托管 VLM 未进入成本比较。"
  }],
  readingOrder: [{ paperId: "2607.29677", reason: "建议先核对评测范围。" }]
};

const headTailDraft = {
  titleAngle: editorialPlan.titleAngle,
  description: "评测文档抽取系统的长文档处理与证据定位边界",
  tags: ["文档信息抽取", "证据定位"],
  reportIntroduction: "本周报告介绍 ExtractBench 的问题范围与阅读入口。",
  trendJudgments: [],
  singlePaperObservations: [{
    observationIndex: 0,
    claim: editorialPlan.singlePaperObservations[0].claim,
    caveat: editorialPlan.singlePaperObservations[0].caveat
  }],
  readingOrder: [{ paperId: "2607.29677", reason: editorialPlan.readingOrder[0].reason }],
  closingSummary: "建议重点关注各系统在长文档条件下准确率的衰减幅度，以及不同系统架构在词级证据定位任务上的具体测量差异。"
};

test("the 2026-08-10 ExtractBench publish candidate is rejected for all four human-audit findings", () => {
  const paperValidation = validatePaperDraft(paperDraft, { item: selectedItem });
  const headTailValidation = validateHeadTailDraft(headTailDraft, {
    editorialPlan,
    selectedItems: [selectedItem],
    paperDrafts: [paperDraft]
  });

  assert.equal(paperValidation.valid, false);
  assert.equal(headTailValidation.valid, false);
  assert.equal(paperValidation.issues.some((entry) => (
    entry.code === "model_cohort_scope_overgeneralized"
    && entry.path === "oneSentenceTakeaway.text"
  )), true);
  assert.equal(paperValidation.issues.some((entry) => (
    entry.code === "limitation_not_study_boundary"
    && entry.path === "limitationsAndConstraints[1].text"
  )), true);
  assert.equal(headTailValidation.issues.some((entry) => (
    entry.code === "metric_label_not_in_evidence"
    && entry.path === "closingSummary"
  )), true);
  assert.equal(headTailValidation.issues.some((entry) => (
    entry.code === "head_tail_repeated_content"
    && entry.path === "headTailDraft"
  )), true);
});
