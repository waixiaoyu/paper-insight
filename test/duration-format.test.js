import assert from "node:assert/strict";
import test from "node:test";

import { formatElapsedSeconds, formatDurationMs } from "../public/duration-format.js";

test("elapsed seconds use minutes after one minute and hours after one hour", () => {
  assert.equal(formatElapsedSeconds(59), "59 秒");
  assert.equal(formatElapsedSeconds(60), "1 分");
  assert.equal(formatElapsedSeconds(125), "2 分 5 秒");
  assert.equal(formatElapsedSeconds(4116), "1 小时 8 分");
});

test("millisecond durations preserve sub-minute precision and then use readable units", () => {
  assert.equal(formatDurationMs(850), "850 ms");
  assert.equal(formatDurationMs(1500), "1.5 秒");
  assert.equal(formatDurationMs(61000), "1 分 1 秒");
  assert.equal(formatDurationMs(3660000), "1 小时 1 分");
});
