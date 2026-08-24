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

test("逐篇稿件人工决策逐项说明嵌套的证据校验失败", () => {
  const result = describeWeeklyReportManualReview({
    stage: "write_paper_sections",
    paperId: "2608.50003",
    allowedActions: ["exit_task", "skip_paper"],
    issues: [{
      code: "READING_LIST_PAPER_SECTION_UNSUPPORTED",
      paperId: "2608.50003",
      reason: "paperDraft remains unsupported after one structured repair.",
      details: [{
        code: "numeric_claim_not_in_evidence",
        path: "experimentsAndResults.text",
        message: "Exact number 37% does not occur in the cited Evidence excerpts.",
        evidenceRefs: ["results-2"]
      }]
    }]
  });

  assert.equal(result.title, "论文 2608.50003 的逐篇稿件未通过校验");
  assert.equal(result.summary, "自动修正后，以下校验项仍未通过。可选择：跳过该论文并重新校准其余候选、退出任务。");
  assert.equal(result.details[0].label, "未通过校验 1");
  assert.match(result.details[0].value, /字段：实验与结果/);
  assert.match(result.details[0].value, /每个数字必须能在其引用的原文摘录中找到/);
  assert.match(result.details[0].value, /37%/);
  assert.match(result.details[0].value, /results-2/);
  assert.doesNotMatch(JSON.stringify(result), /READING_LIST_PAPER_SECTION_UNSUPPORTED|numeric_claim_not_in_evidence|experimentsAndResults/);
});

test("逐篇语义检查人工决策展示未被证据支撑的具体表述", () => {
  const result = describeWeeklyReportManualReview({
    stage: "paper_semantic_qa",
    paperId: "2608.50004",
    issues: [{
      code: "unsupported_fact",
      field: "coreContribution",
      claim: "该方法在所有数据集上都显著优于基线。",
      reason: "The cited excerpts do not support an all-datasets conclusion.",
      evidenceRefs: ["results-1"]
    }]
  });

  assert.equal(result.title, "论文 2608.50004 的逐篇稿件未通过校验");
  assert.match(result.details[0].value, /该方法在所有数据集上都显著优于基线/);
  assert.match(result.details[0].value, /results-1/);
  assert.doesNotMatch(JSON.stringify(result), /unsupported_fact|The cited excerpts/);
});

test("逐篇语义检查不直接展示英文问题表述", () => {
  const result = describeWeeklyReportManualReview({
    stage: "paper_semantic_qa",
    paperId: "2608.50007",
    issues: [{
      code: "unsupported_fact",
      field: "coreContribution",
      claim: "This method outperforms every baseline on every dataset."
    }]
  });

  assert.doesNotMatch(JSON.stringify(result), /This method outperforms/);
  assert.match(result.details[0].value, /稿件中的事实无法由该论文的原文证据支撑/);
});

test("逐篇稿件人工决策展示全部校验失败，不截断为前五项", () => {
  const result = describeWeeklyReportManualReview({
    stage: "write_paper_sections",
    paperId: "2608.50005",
    issues: [{
      details: [
        { code: "writer_text_missing", path: "oneSentenceTakeaway.text" },
        { code: "writer_text_missing", path: "researchProblem.text" },
        { code: "writer_text_missing", path: "coreContribution.text" },
        { code: "writer_text_missing", path: "methodFramework.text" },
        { code: "writer_text_missing", path: "experimentsAndResults.text" },
        { code: "writer_text_missing", path: "adnInsight.text" }
      ]
    }]
  });

  assert.equal(result.details.length, 6);
  assert.equal(result.details[5].label, "未通过校验 6");
});

test("逐篇稿件人工决策只说明当前可用的处理操作", () => {
  const summaries = [
    [["continue_repair"], "自动修正后，以下校验项仍未通过。可选择：继续修正这些问题。"],
    [["skip_paper"], "自动修正后，以下校验项仍未通过。可选择：跳过该论文并重新校准其余候选。"],
    [["exit_task"], "自动修正后，以下校验项仍未通过。可选择：退出任务。"],
    [["continue_repair", "skip_paper", "exit_task"], "自动修正后，以下校验项仍未通过。可选择：继续修正这些问题、跳过该论文并重新校准其余候选、退出任务。"]
  ];

  summaries.forEach(([allowedActions, expected]) => {
    const result = describeWeeklyReportManualReview({
      stage: "paper_semantic_qa",
      paperId: "2608.50006",
      allowedActions,
      issues: [{ code: "unsupported_fact", field: "coreContribution" }]
    });
    assert.equal(result.summary, expected);
  });
});

test("逐篇稿件人工决策不为没有授权的退出操作生成提示", () => {
  const result = describeWeeklyReportManualReview({
    stage: "paper_semantic_qa",
    paperId: "2608.50008",
    allowedActions: [],
    issues: [{ code: "unsupported_fact", field: "coreContribution" }]
  });

  assert.equal(result.summary, "自动修正后，以下校验项仍未通过。当前没有可执行操作，请查看 Trace 了解问题。");
  assert.doesNotMatch(result.summary, /退出/);
});

test("逐篇稿件生产校验均提供具体中文说明", () => {
  const codes = [
    "model_cohort_scope_overgeneralized",
    "model_count_track_scope_mismatch",
    "model_count_track_scope_missing",
    "temporal_scope_overgeneralized",
    "single_encounter_recast_as_single_step",
    "awkward_domain_translation",
    "track_metric_scope_mismatch",
    "reading_value_invalid"
  ];
  const result = describeWeeklyReportManualReview({
    stage: "write_paper_sections",
    paperId: "2608.50009",
    issues: codes.map((code) => ({ code, path: "experimentsAndResults.text" }))
  });

  assert.equal(result.details.length, codes.length);
  result.details.forEach(({ value }) => {
    assert.doesNotMatch(value, /该字段必须符合原文证据、稿件结构和技术表述要求|未记录更细的可定位内容/);
  });
});

test("未归类的逐篇语义问题展示记录的中文原因", () => {
  const result = describeWeeklyReportManualReview({
    stage: "paper_semantic_qa",
    paperId: "2608.50010",
    issues: [{
      code: "other",
      field: "experimentsAndResults",
      reason: "实验结果段将两个不同评价指标合并为一个结论。"
    }]
  });

  assert.match(result.details[0].value, /未归类的语义问题/);
  assert.match(result.details[0].value, /实验结果段将两个不同评价指标合并为一个结论/);
  assert.doesNotMatch(JSON.stringify(result), /\bother\b/);
});

test("混合中英文的未归类原因不直接展示给管理员", () => {
  const result = describeWeeklyReportManualReview({
    stage: "paper_semantic_qa",
    paperId: "2608.50011",
    issues: [{
      code: "other",
      field: "experimentsAndResults",
      reason: "实验结果段不符合 unsupported_fact 校验。",
      claim: "该方法优于 baseline。"
    }]
  });

  assert.doesNotMatch(JSON.stringify(result), /unsupported_fact|baseline/);
  assert.match(result.details[0].value, /语义检查没有提供中文的具体原因/);
  assert.doesNotMatch(result.details[0].value, /问题表述/);
});

test("编辑计划人工决策使用中文业务说明而不暴露规则码", () => {
  const result = describeWeeklyReportManualReview({
    stage: "editorial_plan",
    paperId: "2608.02764",
    relatedPaperIds: ["2608.02764"],
    issues: [{
      code: "rhetorical_prose_style",
      path: "singlePaperObservations[0].caveat",
      detail: "Editorial Plan text must use direct, neutral technical description.",
      triggerText: "评估工作负载为受控基准而非部署轨迹。"
    }]
  });

  assert.match(result.title, /编辑计划需要修正/);
  assert.match(result.details.map((item) => item.value).join(" "), /评估工作负载/);
  assert.doesNotMatch(JSON.stringify(result), /rhetorical_prose_style|Editorial Plan text/);
});
