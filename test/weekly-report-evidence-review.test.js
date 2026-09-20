import assert from "node:assert/strict";
import test from "node:test";
import {
  compactEvidenceReviews,
  editorialEvidenceReviewsForIssues,
  evidenceExtractionReviewsForIssues,
  enrichEvidenceReviewIssues,
  removeApprovedEvidenceIssues
} from "../weekly-report/evidence-review.js";

const selectedItems = [{
  paper: { id: "2608.50020" },
  evidenceCard: {
    results: {
      sources: [{
        section: "4 Results",
        anchor: "S4",
        excerpt: "The first benchmark improves while the second benchmark is unchanged."
      }]
    }
  }
}];

const paperDrafts = [{
  paperId: "2608.50020",
  experimentsAndResults: {
    text: "第一个基准有所改善，第二个基准没有变化。",
    evidenceRefs: ["results:0"]
  }
}];

test("同一字段的多个同类证据问题拥有独立指纹，确认一个不会放行另一个", () => {
  const issues = enrichEvidenceReviewIssues({
    selectedItems,
    paperDrafts,
    issues: [
      {
        code: "unsupported_fact",
        paperId: "2608.50020",
        field: "experimentsAndResults",
        claim: "第一个基准显著改善。",
        evidenceRefs: ["results:0"]
      },
      {
        code: "unsupported_fact",
        paperId: "2608.50020",
        field: "experimentsAndResults",
        claim: "第二个基准也有所改善。",
        evidenceRefs: ["results:0"]
      }
    ]
  });

  assert.notEqual(issues[0].evidenceReview.issueKey, issues[1].evidenceReview.issueKey);
  const remaining = removeApprovedEvidenceIssues(issues, [{
    issueKey: issues[0].evidenceReview.issueKey
  }]);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].claim, "第二个基准也有所改善。");
});

test("人工复核只保留局部稿件和有限原文摘录，并限制整个复核包大小", () => {
  const longReview = {
    issueKey: "unsupported_fact|2608.50020|experimentsAndResults|large|1",
    paperId: "2608.50020",
    fieldPath: "experimentsAndResults",
    fieldLabel: "实验与结果",
    draftExcerpt: "稿".repeat(5000),
    evidenceSources: Array.from({ length: 8 }, (_, index) => ({
      ref: `results:${index}`,
      section: "Results".repeat(100),
      anchor: `S${index}`.repeat(100),
      excerpt: "证".repeat(5000)
    }))
  };
  const reviews = compactEvidenceReviews(Array.from({ length: 50 }, (_, index) => ({
    ...longReview,
    issueKey: `${longReview.issueKey}-${index}`
  })));

  assert.equal(reviews.length <= 20, true);
  assert.equal(JSON.stringify(reviews).length <= 60_000, true);
  reviews.forEach((review) => {
    assert.equal(review.draftExcerpt.length <= 800, true);
    assert.equal(review.evidenceSources.length <= 3, true);
    review.evidenceSources.forEach((source) => {
      assert.equal(source.excerpt.length <= 1200, true);
    });
  });
});

test("同一数字争议在逐篇写作和后续 QA 中使用稳定的问题键", () => {
  const writerIssue = enrichEvidenceReviewIssues({
    selectedItems,
    paperDrafts,
    issues: [{
      code: "numeric_claim_not_in_evidence",
      paperId: "2608.50020",
      path: "experimentsAndResults",
      reason: "Exact number 37.5% is not supported by bound Evidence."
    }]
  })[0];
  const qaIssue = enrichEvidenceReviewIssues({
    selectedItems,
    paperDrafts,
    issues: [{
      code: "unsupported_exact_number",
      paperId: "2608.50020",
      path: "experimentsAndResults",
      reason: "Exact number 37.5% is not supported by bound Evidence."
    }]
  })[0];

  assert.equal(writerIssue.evidenceReview.issueKey, qaIssue.evidenceReview.issueKey);
  assert.equal(removeApprovedEvidenceIssues([qaIssue], [{
    issueKey: writerIssue.evidenceReview.issueKey
  }]).length, 0);
});

test("人工证据复核可将选稿中的完整 arXiv 链接匹配到稿件论文编号", () => {
  const issues = enrichEvidenceReviewIssues({
    selectedItems: [{
      ...selectedItems[0],
      paper: { id: "https://arxiv.org/abs/2608.50020v2" }
    }],
    paperDrafts,
    issues: [{
      code: "numeric_claim_not_in_evidence",
      paperId: "2608.50020",
      path: "experimentsAndResults.text",
      detail: "Exact number 37.5% does not occur in the cited Evidence excerpts."
    }]
  });

  assert.equal(issues[0].path, "experimentsAndResults");
  assert.match(issues[0].evidenceReview.draftExcerpt, /第一个基准/u);
  assert.equal(issues[0].evidenceReview.evidenceSources[0].section, "4 Results");
});

test("Evidence 摘要和 Value Signal 引用问题生成局部原文复核卡", () => {
  const artifacts = {
    evidenceCard: {
      results: {
        summary: "The measured speedup is 3.27x.",
        status: "supported",
        sources: [{
          sourceId: "2604.16625:S9:U001",
          section: "Results",
          anchor: "S9",
          excerpt: "AdaExplore reaches a 3.27 × speedup."
        }]
      }
    },
    valueSignals: {
      signals: [{
        dimension: "practicalValue",
        claim: "The measured speedup is 3.27x.",
        evidenceRefs: ["results:0", "results:23"]
      }]
    }
  };
  const reviews = evidenceExtractionReviewsForIssues({
    paperId: "2604.16625",
    artifacts,
    contextPacket: {
      inputSections: [{
        anchor: "S9",
        heading: "Results",
        text: "AdaExplore reaches a 3.27 × speedup."
      }]
    },
    issues: [
      {
        code: "numeric_claim_not_in_excerpt",
        path: "evidenceCard.results.summary",
        detail: "Numeric token 3 is not present in the bound excerpt."
      },
      {
        code: "evidence_ref_not_found",
        path: "valueSignals.signals[0].evidenceRefs[1]",
        detail: "Evidence reference results:23 does not exist."
      }
    ]
  });

  assert.equal(reviews.length, 2);
  assert.deepEqual(reviews.map((entry) => entry.reviewContext), [
    "evidence_extraction",
    "evidence_extraction"
  ]);
  assert.equal(reviews[0].draftExcerpt, artifacts.evidenceCard.results.summary);
  assert.equal(reviews[1].draftExcerpt, artifacts.valueSignals.signals[0].claim);
  assert.deepEqual(reviews.map((entry) => entry.evidenceSources[0].ref), [
    "results:0",
    "results:0"
  ]);
  assert.match(reviews[0].evidenceSources[0].excerpt, /3\.27/);
});

test("跨论文趋势漏引数字时从 supporting papers 找到原文并生成逐项复核卡", () => {
  const reviews = editorialEvidenceReviewsForIssues({
    issues: [{
      code: "numeric_claim_not_in_evidence",
      path: "trends[0].claim",
      detail: "Exact number 44.7% does not occur in the cited Evidence."
    }, {
      code: "numeric_claim_not_in_evidence",
      path: "trends[0].claim",
      detail: "Exact number 61.2% does not occur in the cited Evidence."
    }],
    editorialPlan: {
      trends: [{
        claim: "DocCite 的候选错误率为 44.7% 到 61.2%。",
        supportingPaperIds: ["2609.05802", "2609.05881"],
        evidenceRefs: ["2609.05802:results:0", "2609.05881:method:0"]
      }]
    },
    selectedItems: [{
      paper: { id: "2609.05802" },
      evidenceCard: {
        results: { sources: [{ section: "Results", excerpt: "Other supported result." }] },
        experiments: { sources: [{
          section: "3 Testbeds and Ground Truth",
          anchor: "S7",
          excerpt: "Candidate-error prevalence ranges from 44.7% to 61.2% across generators."
        }] }
      }
    }, {
      paper: { id: "2609.05881" },
      evidenceCard: {
        method: { sources: [{ section: "Method", excerpt: "A separate artifact survey method." }] }
      }
    }]
  });

  assert.equal(reviews.length, 2);
  assert.deepEqual(reviews.map((review) => review.paperId), ["2609.05802", "2609.05802"]);
  assert.deepEqual(reviews.map((review) => review.fieldLabel), ["跨论文趋势", "跨论文趋势"]);
  assert.deepEqual(reviews.map((review) => review.evidenceSources[0].ref), [
    "2609.05802:experiments:0",
    "2609.05802:experiments:0"
  ]);
  assert.match(reviews[0].evidenceSources[0].excerpt, /44\.7%/u);
  assert.match(reviews[1].evidenceSources[0].excerpt, /61\.2%/u);
  assert.notEqual(reviews[0].issueKey, reviews[1].issueKey);
});
