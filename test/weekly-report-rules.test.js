import assert from "node:assert/strict";
import test from "node:test";
import {
  filterReadingListPapersByWeek,
  paperIsInReadingListWeek,
  readingListWeekRange,
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

test("选文按复评分排序、去重，并只将不足部分标记为保底", () => {
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
  assert.equal(result.fallbackCount, 2);
  assert.equal(result.minSelectedCount, 3);
  assert.deepEqual(
    result.selected.map((paper) => [paper.id, paper.readingListReview.selectionReason]),
    [
      ["https://arxiv.org/abs/2607.10001", "threshold"],
      ["https://arxiv.org/abs/2607.10002", "fallback"],
      ["https://arxiv.org/abs/2607.10003", "fallback"]
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

test("保底数量不会超过去重后的可用论文数", () => {
  const papers = [
    { id: "paper-a", readingListReview: { score: 66 } },
    { id: "paper-b", readingListReview: { score: 64 } }
  ];

  const result = selectReadingListPapers(papers, { threshold: 70, minSelectedCount: 20 });

  assert.equal(result.minSelectedCount, 2);
  assert.equal(result.selected.length, 2);
  assert.equal(result.fallbackCount, 2);
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
