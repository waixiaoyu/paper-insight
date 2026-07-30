import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertSemanticReviewAllowsPublication,
  normalizeSemanticReviewMode,
  normalizeWeeklyReportSemanticReview,
  semanticReviewUnavailable
} from "../weekly-report/semantic-review.js";

const semanticCases = JSON.parse(await readFile(
  new URL("./fixtures/weekly-report/semantic-cases.json", import.meta.url),
  "utf8"
));

const passingChecks = {
  paperGrounding: true,
  crossPaperIsolation: true,
  trendGrounding: true,
  scoreToneConsistency: true,
  affiliationGrounding: true,
  evidenceBoundary: true,
  adnSpecificity: true
};

test("语义评审模式只接受 off、warn 和 enforce", () => {
  assert.equal(normalizeSemanticReviewMode("OFF"), "off");
  assert.equal(normalizeSemanticReviewMode("warn"), "warn");
  assert.equal(normalizeSemanticReviewMode("enforce"), "enforce");
  assert.equal(normalizeSemanticReviewMode("unknown"), "warn");
});

test("没有中高风险问题的 pass 结果允许发布", () => {
  const review = normalizeWeeklyReportSemanticReview({
    verdict: "pass",
    score: 93,
    summary: "事实与输入证据一致。",
    checks: passingChecks,
    issues: [
      {
        severity: "low",
        category: "other",
        reason: "个别句子可以更精炼。"
      }
    ]
  }, { mode: "warn" });

  assert.equal(review.verdict, "pass");
  assert.equal(review.publishable, true);
  assert.equal(review.requiresManualReview, false);
  assert.equal(review.score, 93);
});

test("pass 结果包含 medium 问题时自动降为 review", () => {
  const review = normalizeWeeklyReportSemanticReview({
    verdict: "pass",
    score: 78,
    summary: "趋势支撑不足。",
    checks: passingChecks,
    issues: [
      {
        severity: "medium",
        category: "trend_grounding",
        claim: "该趋势已成为本周共同主线",
        reason: "只有一篇论文提供直接支撑。"
      }
    ]
  });

  assert.equal(review.verdict, "review");
  assert.equal(review.publishable, true);
  assert.equal(review.requiresManualReview, true);
});

test("任何 high 问题都会把语义结论提升为 reject", () => {
  const review = normalizeWeeklyReportSemanticReview({
    verdict: "review",
    score: 42,
    summary: "存在跨论文污染。",
    checks: {
      ...passingChecks,
      crossPaperIsolation: false
    },
    issues: [
      {
        severity: "high",
        category: "cross_paper_contamination",
        paperId: "paper-a",
        claim: "把论文 B 的实验结果写入论文 A",
        reason: "对应证据属于另一篇论文。"
      }
    ]
  });

  assert.equal(review.verdict, "reject");
  assert.equal(review.publishable, false);
  assert.equal(review.requiresManualReview, true);
});

test("无效 verdict 会被拒绝而不是静默当作通过", () => {
  assert.throws(
    () => normalizeWeeklyReportSemanticReview({
      verdict: "probably",
      score: 80,
      issues: []
    }),
    (error) => error.code === "WEEKLY_REPORT_SEMANTIC_REVIEW_INVALID"
  );
});

test("人工语义样本覆盖正确内容和核心高风险错误", () => {
  assert.ok(semanticCases.cases.length >= 8);
  assert.ok(semanticCases.cases.length <= 12);

  const caseIds = semanticCases.cases.map((item) => item.id);
  assert.equal(new Set(caseIds).size, caseIds.length);

  const coveredFocuses = new Set(semanticCases.cases.map((item) => item.focus));
  [
    "clean",
    "cross_paper_contamination",
    "unsupported_claim",
    "affiliation",
    "evidence_boundary",
    "trend_grounding",
    "adn_relevance",
    "score_tone_mismatch"
  ].forEach((focus) => assert.ok(coveredFocuses.has(focus), `缺少语义样本：${focus}`));

  semanticCases.cases.forEach((item) => {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(["pass", "review", "reject"].includes(item.expectedVerdict));
    assert.ok(Array.isArray(item.papers) && item.papers.length > 0);
    assert.ok(item.papers.every((paper) => paper.id && paper.title && paper.evidence));
    assert.ok(String(item.markdown || "").trim().length >= 30);
    assert.ok(String(item.rationale || "").trim().length >= 20);

    if (item.expectedVerdict === "pass") {
      assert.deepEqual(item.expectedIssueCategories, []);
    } else {
      assert.ok(item.expectedIssueCategories.length > 0);
    }
  });
});

test("缺少语义检查字段的残缺响应不会被静默当作通过", () => {
  assert.throws(
    () => normalizeWeeklyReportSemanticReview({
      verdict: "pass",
      score: 90,
      summary: "看似通过但缺少完整检查。",
      checks: {
        paperGrounding: true
      },
      issues: []
    }),
    (error) => error.code === "WEEKLY_REPORT_SEMANTIC_REVIEW_INVALID"
  );
});

test("warn 模式保留 review 结果但不阻断发布", () => {
  const review = normalizeWeeklyReportSemanticReview({
    verdict: "review",
    score: 70,
    summary: "需要人工核对。",
    checks: passingChecks,
    issues: []
  }, { mode: "warn" });

  assert.equal(assertSemanticReviewAllowsPublication(review, { mode: "warn" }), review);
});

test("enforce 模式只允许 pass，review 和 reject 均阻止发布", () => {
  const review = normalizeWeeklyReportSemanticReview({
    verdict: "review",
    score: 70,
    summary: "需要人工核对。",
    checks: {
      ...passingChecks,
      trendGrounding: false
    },
    issues: []
  }, { mode: "enforce" });

  assert.throws(
    () => assertSemanticReviewAllowsPublication(review, { mode: "enforce" }),
    (error) => {
      assert.equal(error.code, "WEEKLY_REPORT_SEMANTIC_REVIEW_REJECTED");
      assert.equal(error.semanticReview, review);
      return true;
    }
  );
});

test("评审不可用时 warn 标记人工复核，enforce 阻止发布", () => {
  const review = semanticReviewUnavailable(new Error("mock timeout"), { mode: "warn" });

  assert.equal(review.status, "unavailable");
  assert.equal(review.requiresManualReview, true);
  assert.equal(assertSemanticReviewAllowsPublication(review, { mode: "warn" }), review);
  assert.throws(
    () => assertSemanticReviewAllowsPublication(review, { mode: "enforce" }),
    (error) => error.code === "WEEKLY_REPORT_SEMANTIC_REVIEW_FAILED"
  );
});
