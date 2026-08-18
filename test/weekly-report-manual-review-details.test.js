import assert from "node:assert/strict";
import test from "node:test";
import { describeWeeklyReportManualReview } from "../public/manual-review-details.js";

test("QA 定向修正缺少逐篇稿件时说明目标、要求和实际失败", () => {
  const result = describeWeeklyReportManualReview({
    kind: "execution_failure",
    stage: "repair_once",
    paperId: "2608.06791",
    summary: "Targeted paper item or paperDraft is missing.",
    allowedActions: ["retry_job", "exit_task"],
    issues: [{
      code: "READING_LIST_QA_REPAIR_FAILED",
      message: "The weekly report could not complete its single targeted repair.",
      detail: "Targeted paper item or paperDraft is missing."
    }]
  });

  assert.equal(result.title, "论文 2608.06791 的自动修正未完成");
  assert.equal(result.summary, "修正后缺少可用的逐篇稿件，无法继续整稿检查。");
  assert.deepEqual(result.details, [
    { label: "修正目标", value: "论文 2608.06791 的逐篇稿件（paperDraft）" },
    { label: "必须满足", value: "修正后必须存在与该论文 ID 一致的 paperDraft，才能重新执行检查。" },
    { label: "实际失败", value: "没有找到该论文的原始候选项或修正后的逐篇稿件。" },
    { label: "可选操作", value: "重新执行任务会从头生成本次周报；退出任务不会发布本次结果。" }
  ]);
});

test("通用自动处理失败优先显示记录的具体 detail", () => {
  const result = describeWeeklyReportManualReview({
    kind: "execution_failure",
    stage: "publish",
    paperId: "",
    summary: "Report storage unavailable.",
    allowedActions: ["retry_job", "exit_task"],
    issues: [{
      code: "READING_LIST_PUBLISH_FAILED",
      message: "The weekly report could not be published.",
      detail: "Report storage unavailable."
    }]
  });

  assert.equal(result.details[1].label, "实际失败");
  assert.equal(result.details[1].value, "Report storage unavailable.");
});

test("没有结构化 detail 时明确说明未记录具体失败原因", () => {
  const result = describeWeeklyReportManualReview({
    kind: "execution_failure",
    stage: "publish",
    issues: [{
      code: "READING_LIST_PUBLISH_FAILED",
      message: "The weekly report could not be published."
    }]
  });

  assert.equal(result.details[1].value, "未记录具体失败原因。");
});
