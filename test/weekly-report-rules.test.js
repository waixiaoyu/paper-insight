import assert from "node:assert/strict";
import test from "node:test";
import {
  filterReadingListPapersByWeek,
  paperIsInReadingListWeek,
  prepareReadingListCandidatePool,
  readingListWeekRange,
  selectCalibratedPapers,
  selectReadingListPapers
} from "../weekly-report/rules.js";

test("自然周范围包含起点但不包含下周起点", () => {
  const range = readingListWeekRange({
    weekStart: "2026-07-26T16:00:00.000Z",
    weekEnd: "2026-08-02T16:00:00.000Z"
  });

  assert.equal(paperIsInReadingListWeek({ published: "2026-07-26T15:59:59.999Z" }, range), false);
  assert.equal(paperIsInReadingListWeek({ published: "2026-07-26T16:00:00.000Z" }, range), true);
  assert.equal(paperIsInReadingListWeek({ published: "2026-08-02T15:59:59.999Z" }, range), true);
  assert.equal(paperIsInReadingListWeek({ published: "2026-08-02T16:00:00.000Z" }, range), false);
});

test("缺少合法范围时按报告日期回退到 UTC 自然周", () => {
  const range = readingListWeekRange({
    date: "2026-07-29",
    weekStart: "invalid",
    weekEnd: "invalid"
  });

  assert.equal(range.start, "2026-07-27T00:00:00.000Z");
  assert.equal(range.end, "2026-08-03T00:00:00.000Z");
});

test("自然周过滤排除跨周和无日期论文", () => {
  const range = readingListWeekRange({
    weekStart: "2026-07-27T00:00:00.000Z",
    weekEnd: "2026-08-03T00:00:00.000Z"
  });
  const papers = [
    { id: "in", published: "2026-07-29T00:00:00.000Z" },
    { id: "old", published: "2026-07-26T23:59:59.999Z" },
    { id: "invalid", published: "not-a-date" }
  ];

  assert.deepEqual(filterReadingListPapersByWeek(papers, range).map((paper) => paper.id), ["in"]);
});

test("选文按复评分排序、去重，并且只保留达到阈值的论文", () => {
  const papers = [
    {
      id: "https://arxiv.org/abs/2607.10001",
      published: "2026-07-29T00:00:00.000Z",
      readingListReview: { score: 86 }
    },
    {
      id: "https://arxiv.org/abs/2607.10001v2",
      published: "2026-07-30T00:00:00.000Z",
      readingListReview: { score: 82 }
    },
    {
      id: "https://arxiv.org/abs/2607.10002",
      published: "2026-07-28T00:00:00.000Z",
      readingListReview: { score: 68 }
    },
    {
      id: "https://arxiv.org/abs/2607.10003",
      published: "2026-07-27T00:00:00.000Z",
      readingListReview: { score: 64 }
    }
  ];

  const result = selectReadingListPapers(papers, { threshold: 70, minSelectedCount: 3 });

  assert.equal(result.thresholdCount, 1);
  assert.equal(result.fallbackCount, 0);
  assert.equal(result.minSelectedCount, 3);
  assert.deepEqual(
    result.selected.map((paper) => [paper.id, paper.readingListReview.selectionReason]),
    [
      ["https://arxiv.org/abs/2607.10001", "threshold"]
    ]
  );
});

test("达到阈值的论文全部保留，不受保底数量限制", () => {
  const papers = [92, 84, 76, 68].map((score, index) => ({
    id: `paper-${index}`,
    published: `2026-07-${29 - index}T00:00:00.000Z`,
    readingListReview: { score }
  }));

  const result = selectReadingListPapers(papers, { threshold: 70, minSelectedCount: 1 });

  assert.equal(result.thresholdCount, 3);
  assert.equal(result.fallbackCount, 0);
  assert.deepEqual(result.selected.map((paper) => paper.readingListReview.score), [92, 84, 76]);
});

test("目标数量不会使低于阈值的可用论文自动入选", () => {
  const papers = [
    { id: "paper-a", readingListReview: { score: 66 } },
    { id: "paper-b", readingListReview: { score: 64 } }
  ];

  const result = selectReadingListPapers(papers, { threshold: 70, minSelectedCount: 20 });

  assert.equal(result.minSelectedCount, 2);
  assert.equal(result.selected.length, 0);
  assert.equal(result.fallbackCount, 0);
});

test("没有论文时返回空选择而不是虚假的保底数量", () => {
  const result = selectReadingListPapers([], { threshold: 70, minSelectedCount: 3 });

  assert.deepEqual(result.selected, []);
  assert.equal(result.thresholdCount, 0);
  assert.equal(result.fallbackCount, 0);
  assert.equal(result.minSelectedCount, 0);
});

test("同分论文按发布时间从新到旧排序", () => {
  const papers = [
    {
      id: "older",
      published: "2026-07-27T00:00:00.000Z",
      readingListReview: { score: 75 }
    },
    {
      id: "newer",
      published: "2026-07-29T00:00:00.000Z",
      readingListReview: { score: 75 }
    }
  ];

  const result = selectReadingListPapers(papers, { threshold: 70, minSelectedCount: 1 });

  assert.deepEqual(result.selected.map((paper) => paper.id), ["newer", "older"]);
});

test("published 无效但 updated 有效时仍可按自然周判断", () => {
  const range = readingListWeekRange({
    weekStart: "2026-07-27T00:00:00.000Z",
    weekEnd: "2026-08-03T00:00:00.000Z"
  });
  const papers = [
    {
      id: "updated-in-week",
      published: "invalid",
      updated: "2026-07-30T00:00:00.000Z"
    }
  ];

  assert.deepEqual(filterReadingListPapersByWeek(papers, range).map((paper) => paper.id), ["updated-in-week"]);
});

test("候选池排除 hidden、跨周和重复论文，并保持增补原始顺序", () => {
  const range = readingListWeekRange({
    weekStart: "2026-07-27T00:00:00.000Z",
    weekEnd: "2026-08-03T00:00:00.000Z"
  });
  const primaryPapers = [
    { id: "2607.00001v2", published: "2026-07-29T00:00:00.000Z" },
    { id: "hidden-primary", hidden: true, published: "2026-07-29T00:00:00.000Z" },
    { id: "old-primary", published: "2026-07-20T00:00:00.000Z" }
  ];
  const reservePapers = [
    { id: "2607.00001", published: "2026-07-29T00:00:00.000Z" },
    { id: "reserve-first", published: "2026-07-30T00:00:00.000Z" },
    { id: "reserve-hidden", isHidden: true, published: "2026-07-30T00:00:00.000Z" },
    { id: "reserve-second", published: "2026-07-31T00:00:00.000Z" },
    { id: "reserve-old", published: "2026-07-01T00:00:00.000Z" }
  ];

  const result = prepareReadingListCandidatePool({ primaryPapers, reservePapers, range });

  assert.deepEqual(result.primaryCandidates.map((paper) => paper.id), ["2607.00001v2"]);
  assert.deepEqual(result.reserveCandidates.map((paper) => paper.id), ["reserve-first", "reserve-second"]);
  assert.deepEqual(result.excluded, {
    hidden: 2,
    crossWeek: 2,
    duplicate: 1,
    invalid: 0
  });
});

test("最终选文受 maxSelectedCount 限制且同分使用稳定 paperId 次序", () => {
  const papers = ["paper-c", "paper-a", "paper-b", "paper-d"].map((id) => ({
    id,
    published: "2026-07-29T00:00:00.000Z",
    readingListReview: { score: 80 }
  }));

  const result = selectReadingListPapers(papers, {
    threshold: 70,
    minSelectedCount: 3,
    maxSelectedCount: 0
  });

  assert.equal(result.thresholdCount, 4);
  assert.equal(result.maxSelectedCount, 3);
  assert.deepEqual(result.selected.map((paper) => paper.id), ["paper-a", "paper-b", "paper-c"]);
});

test("低于阈值的 must_read 和 background_only 都不会自动入选", () => {
  const result = selectReadingListPapers([
    {
      id: "fallback-must-read",
      readingListReview: { score: 65, readingTier: "must_read" }
    },
    {
      id: "fallback-background",
      readingListReview: { score: 60, readingTier: "background_only" }
    }
  ], {
    threshold: 70,
    minSelectedCount: 2,
    maxSelectedCount: 10
  });

  assert.deepEqual(result.selected, []);
  assert.equal(result.fallbackCount, 0);
});

test("legacy Selection does not fill the minimum with below-threshold papers", () => {
  const result = selectReadingListPapers([
    {
      id: "paper-65",
      readingListReview: { score: 65, readingTier: "worth_reading" }
    },
    {
      id: "paper-60",
      readingListReview: { score: 60, readingTier: "background_only" }
    }
  ], {
    threshold: 70,
    minSelectedCount: 2,
    maxSelectedCount: 10
  });

  assert.deepEqual(result.selected, []);
  assert.equal(result.fallbackCount, 0);
});

const calibratedItem = (paperId, rawScore, readingTier, extras = {}) => ({
  paper: {
    id: paperId,
    published: extras.published || "2026-07-29T00:00:00.000Z",
    readingListReview: { score: extras.oldScore ?? 100 },
    analysis: { score: extras.oldAnalysisScore ?? 100 }
  },
  reviewResult: {
    paperId,
    rawScore,
    evidenceValidation: { status: "pass", issues: [] },
    scores: {
      scenarioProblemValue: rawScore,
      methodNovelty: rawScore,
      practicalValue: rawScore,
      evidence: rawScore
    }
  },
  calibrationResult: {
    paperId,
    status: extras.calibrationStatus || "consistent",
    readingTier,
    relativePosition: "cohort position",
    suspectedMisjudgments: [],
    calibrationReason: "calibrated"
  }
});

test("new Selection uses only calibrated Review score and ignores old recommendation scores", () => {
  const items = [
    calibratedItem("paper-low-final", 65, "skim", { oldScore: 100, oldAnalysisScore: 100 }),
    calibratedItem("paper-high-final", 85, "must_read", { oldScore: 1, oldAnalysisScore: 1 })
  ];
  const original = structuredClone(items);
  const result = selectCalibratedPapers(items, {
    threshold: 70,
    minSelectedCount: 1,
    maxSelectedCount: 10
  });

  assert.deepEqual(items, original);
  assert.deepEqual(result.selected.map((item) => item.paper.id), ["paper-high-final"]);
  assert.equal(result.selected[0].selection.finalScore, 85);
  assert.equal(result.selected[0].selection.selectionReason, "threshold");
});

test("new Selection does not use 68, 67, and 65 point papers to satisfy a three-paper target", () => {
  const result = selectCalibratedPapers([
    calibratedItem("paper-68", 68, "worth_reading"),
    calibratedItem("paper-67", 67, "worth_reading"),
    calibratedItem("paper-65", 65, "worth_reading")
  ], {
    threshold: 70,
    minSelectedCount: 3,
    maxSelectedCount: 10
  });

  assert.deepEqual(result.selected, []);
  assert.equal(result.fallbackCount, 0);
  assert.deepEqual(
    result.notSelected.map((item) => item.selection.selectionReason),
    ["below_threshold", "below_threshold", "below_threshold"]
  );
});

test("new Selection publishes two threshold-qualified papers without filling the third slot", () => {
  const result = selectCalibratedPapers([
    calibratedItem("paper-82", 82, "must_read"),
    calibratedItem("paper-76", 76, "worth_reading"),
    calibratedItem("paper-68", 68, "worth_reading")
  ], {
    threshold: 70,
    minSelectedCount: 3,
    maxSelectedCount: 10
  });

  assert.deepEqual(result.selected.map((item) => item.paper.id), ["paper-82", "paper-76"]);
  assert.equal(result.fallbackCount, 0);
  assert.equal(result.notSelected[0].paper.id, "paper-68");
  assert.equal(result.notSelected[0].selection.selectionReason, "below_threshold");
});

test("new Selection leaves every below-threshold paper out of the selected cohort", () => {
  const result = selectCalibratedPapers([
    calibratedItem("threshold", 82, "must_read"),
    calibratedItem("fallback-must", 69, "must_read"),
    calibratedItem("fallback-background", 68, "background_only"),
    calibratedItem("not-needed", 67, "worth_reading")
  ], {
    threshold: 70,
    minSelectedCount: 3,
    maxSelectedCount: 10
  });

  assert.deepEqual(result.selected.map((item) => item.paper.id), ["threshold"]);
  assert.deepEqual(result.selected.map((item) => item.selection.readingTier), ["must_read"]);
  assert.equal(result.fallbackCount, 0);
  assert.deepEqual(
    result.notSelected.map((item) => item.selection.selectionReason),
    ["below_threshold", "below_threshold", "below_threshold"]
  );
});

test("new Selection enforces maxSelectedCount with deterministic calibrated ordering", () => {
  const result = selectCalibratedPapers([
    calibratedItem("paper-c", 90, "worth_reading"),
    calibratedItem("paper-b", 90, "must_read"),
    calibratedItem("paper-a", 90, "must_read"),
    calibratedItem("paper-d", 80, "worth_reading")
  ], {
    threshold: 70,
    minSelectedCount: 1,
    maxSelectedCount: 3
  });

  assert.deepEqual(result.selected.map((item) => item.paper.id), ["paper-a", "paper-b", "paper-c"]);
  assert.equal(result.selected.every((item, index) => item.selection.rank === index + 1), true);
  assert.equal(result.notSelected[0].paper.id, "paper-d");
  assert.equal(result.notSelected[0].selection.selectionReason, "max_selected_count");
});

test("new Selection excludes papers without a converged calibrationResult", () => {
  const result = selectCalibratedPapers([
    calibratedItem("consistent", 75, "worth_reading"),
    calibratedItem("repaired", 74, "worth_reading", { calibrationStatus: "repaired" }),
    calibratedItem("unresolved", 99, "must_read", { calibrationStatus: "unresolved" }),
    calibratedItem("not-calibrated", 98, "must_read", { calibrationStatus: "rereview_required" })
  ], {
    threshold: 70,
    minSelectedCount: 4,
    maxSelectedCount: 10
  });

  assert.deepEqual(result.selected.map((item) => item.paper.id), ["consistent", "repaired"]);
  assert.deepEqual(result.ineligible.map((item) => item.paper.id), ["unresolved", "not-calibrated"]);
});

test("new Selection publishes the available calibrated count when it is below the requested minimum", () => {
  const result = selectCalibratedPapers([
    calibratedItem("only-paper", 75, "worth_reading")
  ], {
    threshold: 70,
    minSelectedCount: 3,
    maxSelectedCount: 10
  });

  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].selection.selectionReason, "threshold");
  assert.equal(result.requestedMinSelectedCount, 3);
  assert.equal(result.minSelectedCount, 1);
});
