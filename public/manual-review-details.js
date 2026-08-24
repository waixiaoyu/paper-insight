const fallbackDetail = "未记录具体失败原因。";
const isSafeChineseDescription = (value) => {
  const text = String(value || "").trim();
  return /[\u3400-\u9fff]/u.test(text) && !/[a-z]/iu.test(text);
};

const issueDetail = (review = {}) => {
  const issue = Array.isArray(review.issues) ? review.issues[0] : null;
  return issue && typeof issue === "object" ? String(issue.detail || fallbackDetail) : fallbackDetail;
};

const retryOrExitDetail = "重新执行任务会从头生成本次周报；退出任务不会发布本次结果。";

const editorialIssueExplanation = (issue = {}) => {
  const field = String(issue.path || "编辑计划字段");
  const actualText = String(issue.triggerText || "").trim();
  const explanations = {
    rhetorical_prose_style: "措辞包含对比、修辞或宣传性表达。需要改为直接陈述研究对象、结果和适用边界。",
    numeric_claim_not_in_evidence: "该字段出现了证据中找不到的具体数字。需要删除该数字，或补充包含该数字的证据引用。",
    metric_label_not_in_evidence: "指标名称与引用证据不一致。需要保留证据中的原始指标名称。",
    specific_setup_claim_not_in_evidence: "该字段扩大了实验设置或适用范围。需要改为引用证据明确支持的表述。"
  };
  return {
    field,
    value: actualText ? `触发内容：“${actualText}”` : "未保存触发句，需按该字段的证据与结构要求修正。",
    requirement: explanations[String(issue.code || "")] || "该字段未满足编辑计划的证据、结构或中性技术表述要求。"
  };
};

const paperIssueRequirement = (code) => ({
  schema_invalid: "逐篇稿件必须返回完整的结构化内容。",
  grounded_text_invalid: "每个正文段落必须同时提供正文和证据引用。",
  writer_field_forbidden: "逐篇稿件只能包含发布格式允许的字段。",
  paper_id_mismatch: "稿件中的论文编号必须与当前论文一致。",
  writer_text_missing: "每个必填段落都必须有可发布的正文内容。",
  writer_evidence_missing: "每个正文段落都必须引用至少一条原文证据。",
  evidence_ref_unknown: "引用的证据编号必须存在于该论文的证据清单中。",
  numeric_claim_not_in_evidence: "正文中的每个数字必须能在其引用的原文摘录中找到。",
  metric_label_not_in_evidence: "指标名称必须与所引用原文中的指标名称一致。",
  specific_setup_claim_not_in_evidence: "实验设置、资源或适用范围必须由引用的原文直接支持。",
  limitations_insufficient: "限制与边界部分必须包含至少两项分别有证据支持的内容。",
  limitations_not_independent: "每项限制与边界必须描述不同的问题，不能拆分重复表述。",
  limitation_not_study_boundary: "限制与边界必须说明实验、数据、比较或适用范围的约束，不能只重复性能结果。",
  internal_term_leak: "面向读者的正文不能出现内部流程或选文术语。",
  rhetorical_prose_style: "正文必须使用直接、中性的技术描述。",
  awkward_literal_translation: "正文必须使用自然的中文技术表达。",
  inline_evidence_ref_leak: "证据编号只能出现在引用字段中，不能出现在面向读者的正文中。",
  cross_paper_reference: "单篇稿件不能引用其他论文。",
  unsupported_fact: "稿件中的事实必须由该论文的原文证据支持。",
  method_mismatch: "方法描述必须与该论文的原文一致。",
  experiment_mismatch: "实验设置和结果描述必须与该论文的原文一致。",
  unsupported_number: "数字必须能在该论文的原文证据中找到。",
  affiliation_mismatch: "作者或机构信息必须与该论文的原文一致。",
  limitation_gap: "稿件必须说明原文明确给出的限制或适用边界。",
  recommendation_tone_mismatch: "阅读建议必须保持中性，不能超出论文证据。",
  reader_language_mismatch: "面向读者的逐篇稿件必须以中文撰写。",
  cross_paper_contamination: "稿件不能混入其他论文的内容。",
  evidence_boundary: "稿件的表述不能超出所引用原文证据的范围。",
  model_cohort_scope_overgeneralized: "结论必须保留原文中模型、系统或实验对象的限定范围。",
  model_count_track_scope_mismatch: "不同实验轨道中的模型数量不能混合表述。",
  model_count_track_scope_missing: "涉及模型数量时必须保留原文中的实验轨道限定。",
  temporal_scope_overgeneralized: "时间跨度必须与引用原文一致，不能把中期或多轮结果写成长周期结论。",
  single_encounter_recast_as_single_step: "单次交互结果不能改写为单步决策结果。",
  awkward_domain_translation: "领域术语必须采用正确、可读的中文表达。",
  track_metric_scope_mismatch: "不同实验轨道的指标必须分开表述，不能将胜率附加到跨日结果。",
  reading_value_invalid: "阅读价值部分必须包含完整的结构化内容。",
  invalid_json: "模型必须返回可解析的结构化内容。",
  unknown_field: "模型返回内容不能包含未定义字段。",
  input_identity_mismatch: "当前论文与输入稿件必须是同一篇论文。",
  verdict_invalid: "语义检查结论只能是通过或需要修正。",
  summary_required: "语义检查必须提供摘要说明。",
  checks_required: "语义检查必须提供完整的检查结果。",
  check_required: "每个必填检查项必须明确为通过或不通过。",
  issues_required: "语义检查必须提供问题列表。",
  issue_invalid: "问题列表中的每一项必须是完整的结构化问题。",
  issue_incomplete: "每个语义问题必须说明涉及字段和原因。",
  false_check_without_issue: "标记为不通过的检查项必须关联具体问题。",
  repair_without_issue: "要求修正时必须关联至少一个具体问题。",
  other: "未归类的语义问题仍须说明与原文证据、事实边界或读者表达不一致的具体位置。"
}[String(code || "")] || "该字段必须符合原文证据、稿件结构和技术表述要求。");

const paperIssueActual = (issue = {}) => {
  const code = String(issue.code || "");
  const message = String(issue.message || issue.reason || issue.detail || "").trim();
  const number = message.match(/Exact number\s+([^\s]+)\s+does not occur/i)?.[1];
  if (code === "numeric_claim_not_in_evidence") {
    return number
      ? `正文中出现了 ${number}，但引用的原文摘录中没有该数字。`
      : "正文中的数字无法在引用的原文摘录中找到。";
  }
  if (code === "other") {
    const chineseReason = [issue.reason, issue.detail, issue.message]
      .map((value) => String(value || "").trim())
      .find(isSafeChineseDescription);
    return chineseReason
      ? `语义检查记录的具体问题：${chineseReason}`
      : "语义检查没有提供中文的具体原因，请在 Trace 中核对原始记录。";
  }
  const actualByCode = {
    schema_invalid: "模型返回的逐篇稿件不是可用的完整结构。",
    grounded_text_invalid: "该字段缺少正文或证据引用结构。",
    writer_field_forbidden: "返回了发布格式不允许的字段。",
    paper_id_mismatch: "稿件中的论文编号与当前论文不一致。",
    writer_text_missing: "该必填字段没有正文内容。",
    writer_evidence_missing: "该字段没有关联原文证据。",
    evidence_ref_unknown: "引用了证据清单中不存在的编号。",
    metric_label_not_in_evidence: "正文使用的指标名称与引用原文不一致。",
    specific_setup_claim_not_in_evidence: "正文加入了引用原文未直接支持的实验设置、资源或适用范围。",
    limitations_insufficient: "限制与边界部分少于两项有证据支持的内容。",
    limitations_not_independent: "限制与边界中存在重复的内容。",
    limitation_not_study_boundary: "限制与边界只重复了性能结果，没有说明研究边界。",
    internal_term_leak: "正文包含内部流程或选文术语。",
    rhetorical_prose_style: "正文包含修辞、宣传或非中性的表达。",
    awkward_literal_translation: "正文存在不自然的直译表达。",
    inline_evidence_ref_leak: "正文中直接出现了证据编号。",
    cross_paper_reference: "正文出现了其他论文的引用或内容。",
    unsupported_fact: "稿件中的事实无法由该论文的原文证据支撑。",
    method_mismatch: "方法描述与该论文原文不一致。",
    experiment_mismatch: "实验设置或结果描述与该论文原文不一致。",
    unsupported_number: "稿件中的数字无法由该论文原文证据支撑。",
    affiliation_mismatch: "作者或机构信息与该论文原文不一致。",
    limitation_gap: "稿件没有覆盖原文明确给出的限制或适用边界。",
    recommendation_tone_mismatch: "阅读建议的语气或结论超出了论文证据。",
    reader_language_mismatch: "逐篇稿件没有以中文为主撰写。",
    cross_paper_contamination: "稿件混入了其他论文的内容。",
    evidence_boundary: "稿件的表述超出了所引用原文证据的范围。",
    model_cohort_scope_overgeneralized: "把只适用于部分、指定或表现最强模型的结果扩展成了对全部模型的结论。",
    model_count_track_scope_mismatch: "将某一实验轨道的模型数量同时用于多个实验轨道。",
    model_count_track_scope_missing: "描述模型数量时遗漏了原文中的实验轨道限定。",
    temporal_scope_overgeneralized: "把中期或多轮交互结果扩展成了长周期结论。",
    single_encounter_recast_as_single_step: "把单次交互结果改写成了单步决策结果。",
    awkward_domain_translation: "领域术语的中文表述不准确或不自然。",
    track_metric_scope_mismatch: "将一个实验轨道的胜率或指标用于另一个实验轨道的结果。",
    reading_value_invalid: "阅读价值部分缺少可用的结构化内容。",
    invalid_json: "模型返回内容无法解析为结构化数据。",
    unknown_field: "模型返回了发布格式中不存在的字段。",
    input_identity_mismatch: "当前论文、输入稿件或检查结果的论文编号不一致。",
    verdict_invalid: "模型返回了不支持的语义检查结论。",
    summary_required: "模型没有提供语义检查摘要。",
    checks_required: "模型没有提供完整的检查结果。",
    check_required: "至少一个必填检查项没有明确结果。",
    issues_required: "模型没有提供结构化问题列表。",
    issue_invalid: "问题列表中存在不是完整对象的条目。",
    issue_incomplete: "至少一个问题没有说明涉及字段或原因。",
    false_check_without_issue: "标记为不通过的检查项没有对应的具体问题。",
    repair_without_issue: "模型要求修正，但没有列出具体问题。"
  };
  return actualByCode[code] || "该校验未通过，但未记录更细的可定位内容。";
};

const paperFieldLabel = (value) => {
  const path = String(value || "");
  const root = path.split(/[.[]/u)[0];
  const labels = {
    oneSentenceTakeaway: "一句话结论",
    researchProblem: "研究问题",
    coreContribution: "核心贡献",
    methodFramework: "方法框架",
    experimentsAndResults: "实验与结果",
    limitationsAndConstraints: "限制与边界",
    adnInsight: "ADN 解读",
    readingValue: "阅读价值",
    paperId: "论文编号",
    paperDraft: "逐篇稿件",
    response: "模型返回内容"
  };
  return labels[root] || "逐篇稿件字段";
};

const paperManualReviewSummary = (allowedActions) => {
  const actions = [
    ["continue_repair", "继续修正这些问题"],
    ["skip_paper", "跳过该论文并重新校准其余候选"],
    ["exit_task", "退出任务"]
  ].filter(([action]) => allowedActions.has(action)).map(([, label]) => label);
  return actions.length
    ? `自动修正后，以下校验项仍未通过。可选择：${actions.join("、")}。`
    : "自动修正后，以下校验项仍未通过。当前没有可执行操作，请查看 Trace 了解问题。";
};

const paperIssueDetails = (review = {}) => {
  const outerIssues = Array.isArray(review.issues) ? review.issues : [];
  const issues = outerIssues.flatMap((outer) => (
    Array.isArray(outer?.details) && outer.details.length ? outer.details : [outer]
  ));
  return issues.map((issue, index) => {
    const field = paperFieldLabel(issue?.path || issue?.field);
    const rawClaim = String(issue?.claim || issue?.triggerText || "").trim();
    const claim = isSafeChineseDescription(rawClaim) ? rawClaim : "";
    const refs = Array.isArray(issue?.evidenceRefs)
      ? issue.evidenceRefs.map(String).filter(Boolean) : [];
    const refText = refs.length ? `；关联证据：${refs.join("、")}` : "";
    return {
      label: `未通过校验 ${index + 1}`,
      value: `字段：${field}${claim ? `；问题表述：“${claim}”` : ""}；校验要求：${paperIssueRequirement(issue?.code)}；实际不符合：${paperIssueActual(issue)}${refText}`
    };
  });
};

export function describeWeeklyReportManualReview(review = {}) {
  const stage = String(review.stage || "当前阶段");
  const paperId = String(review.paperId || "");
  const issue = Array.isArray(review.issues) ? review.issues[0] : null;
  const code = String(issue?.code || "");
  const detail = issueDetail(review);

  if (review.kind === "execution_failure"
    && stage === "repair_once"
    && code === "READING_LIST_QA_REPAIR_FAILED"
    && paperId) {
    const missingDraft = /paperDraft|paper item/i.test(detail);
    return {
      title: `论文 ${paperId} 的自动修正未完成`,
      summary: missingDraft
        ? "修正后缺少可用的逐篇稿件，无法继续整稿检查。"
        : "该论文的定向修正未完成，无法继续整稿检查。",
      details: [
        { label: "修正目标", value: `论文 ${paperId} 的逐篇稿件（paperDraft）` },
        { label: "必须满足", value: "修正后必须存在与该论文 ID 一致的 paperDraft，才能重新执行检查。" },
        { label: "实际失败", value: missingDraft ? "没有找到该论文的原始候选项或修正后的逐篇稿件。" : detail },
        { label: "可选操作", value: retryOrExitDetail }
      ]
    };
  }

  if (review.kind === "execution_failure") {
    return {
      title: "自动处理未完成，需要管理员决定",
      summary: "系统未完成本次周报，尚未发布任何新结果。",
      details: [
        { label: "处理阶段", value: stage },
        { label: "实际失败", value: detail },
        { label: "可选操作", value: retryOrExitDetail }
      ]
    };
  }

  if (stage === "editorial_plan") {
    const explanation = editorialIssueExplanation(issue);
    const related = Array.isArray(review.relatedPaperIds) ? review.relatedPaperIds : [];
    return {
      title: paperId ? `论文 ${paperId} 的编辑计划需要修正` : "编辑计划需要修正",
      summary: "自动修正未满足质量门。继续修正只会修改下列失败字段，其他已通过内容保持不变。",
      details: [
        { label: "失败字段", value: explanation.field },
        { label: "触发内容", value: explanation.value },
        { label: "未达成要求", value: explanation.requirement },
        { label: "关联论文", value: related.length ? related.join("、") : paperId || "无法从该问题定位到单篇论文" },
        { label: "继续修正", value: "服务端仅接受失败字段的局部补丁，并重新检查整份编辑计划。" }
      ]
    };
  }

  if (stage === "write_paper_sections" || stage === "paper_semantic_qa") {
    const details = paperIssueDetails(review);
    const allowedActions = new Set(Array.isArray(review.allowedActions) ? review.allowedActions : []);
    return {
      title: paperId ? `论文 ${paperId} 的逐篇稿件未通过校验` : "逐篇稿件未通过校验",
      summary: paperManualReviewSummary(allowedActions),
      details
    };
  }

  return {
    title: `${stage}需要管理员决策`,
    summary: String(review.summary || "自动修正后仍未通过质量门，请选择后续处理方式。"),
    details: []
  };
}
