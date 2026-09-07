import assert from "node:assert/strict";
import test from "node:test";
import {
  compactEvidenceReviews,
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
