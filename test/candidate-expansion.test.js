import assert from "node:assert/strict";
import test from "node:test";
import {
  expandCandidateBatches,
  candidateExpansionDays,
  candidateExpansionNotice
} from "../public/candidate-expansion.js";

test("7 天候选不足时按 14 天和 30 天扩展，但不限时间不重复查询", () => {
  assert.deepEqual(candidateExpansionDays(7), [7, 14, 30]);
  assert.deepEqual(candidateExpansionDays(14), [14, 30]);
  assert.deepEqual(candidateExpansionDays(30), [30]);
  assert.deepEqual(candidateExpansionDays(0), [0]);
});

test("候选补足说明显示目标、初始命中和最终使用范围", () => {
  assert.equal(candidateExpansionNotice({
    target: 50,
    initialDays: 7,
    initialCount: 24,
    finalDays: 14,
    finalCount: 50
  }), "目标 50 篇；最近 7 天匹配 24 篇，已按相同关键词扩展至最近 14 天，当前获得 50 篇。");
});

test("候选池耗尽时明确说明扩展后的实际数量", () => {
  assert.equal(candidateExpansionNotice({
    target: 50,
    initialDays: 7,
    initialCount: 24,
    finalDays: 30,
    finalCount: 31
  }), "目标 50 篇；最近 7 天匹配 24 篇，已按相同关键词扩展至最近 30 天，当前仅找到 31 篇。");
});

test("首轮不足时只请求必要的扩展范围并在达到目标后停止", async () => {
  const selected = [];
  const seen = new Set();
  const appendUnique = (papers) => {
    const added = papers.filter((paper) => !seen.has(paper.id));
    added.forEach((paper) => seen.add(paper.id));
    selected.push(...added);
    return added;
  };
  const initialPapers = Array.from({ length: 24 }, (_, index) => ({ id: `paper-${index}` }));
  const expandedPapers = Array.from({ length: 50 }, (_, index) => ({ id: `paper-${index}` }));
  const requestedDays = [];

  const result = await expandCandidateBatches({
    target: 50,
    initialDays: 7,
    initialPapers,
    appendUnique,
    loadBatch: async (days) => {
      requestedDays.push(days);
      return days === 14 ? expandedPapers : [];
    }
  });

  assert.deepEqual(requestedDays, [14]);
  assert.equal(result.initialCount, 24);
  assert.equal(result.finalDays, 14);
  assert.equal(result.finalCount, 50);
  assert.equal(selected.length, 50);
});
