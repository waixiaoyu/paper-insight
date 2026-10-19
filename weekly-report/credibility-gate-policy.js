const BLOCKING_CREDIBILITY_CODES = new Set([
  // Response and artifact structure.
  "invalid_json",
  "schema_invalid",
  "unknown_field",
  "writer_field_forbidden",
  "grounded_text_invalid",
  "writer_text_missing",
  "writer_evidence_missing",
  "reading_value_invalid",
  "limitations_insufficient",
  "core_theme_missing",
  "title_angle_missing",
  "trends_invalid",
  "trend_claim_missing",
  "trend_requires_two_papers",
  "trend_maturity_invalid",
  "trend_caveat_missing",
  "single_paper_observations_invalid",
  "single_paper_observation_missing",
  "single_paper_observation_duplicate",
  "observation_claim_missing",
  "observation_evidence_missing",
  "observation_caveat_missing",
  "reading_order_invalid",
  "reading_reason_missing",
  "head_tail_text_missing",
  "head_tail_markdown_forbidden",
  "head_tail_collection_invalid",
  "head_tail_field_forbidden",
  "title_angle_length_invalid",
  "description_too_long",
  "paper_section_too_long",
  "tags_invalid",
  "tag_too_long",
  "tag_duplicate",
  "issues_required",
  "issue_invalid",
  "issue_incomplete",
  "checks_required",
  "check_required",
  "summary_required",
  "verdict_invalid",
  "false_check_without_issue",
  "repair_without_issue",
  "evidence_validation_status_invalid",
  "evidence_issue_field_invalid",
  "evidence_issue_incomplete",
  "pass_with_evidence_issues",
  "repair_without_evidence_issues",
  "score_out_of_range",
  "required_text_missing",

  // Deterministic identity, ownership and source binding.
  "paper_id_mismatch",
  "input_identity_mismatch",
  "editorial_paper_unknown",
  "unknown_source_id",
  "unknown_section_anchor",
  "excerpt_not_in_source",
  "missing_evidence_source",
  "evidence_ref_unknown",
  "evidence_ref_not_found",
  "trend_support_missing_evidence",
  "trend_evidence_paper_mismatch",
  "observation_evidence_paper_mismatch",
  "cross_paper_reference",

  // Deterministic set, ordering and publication-artifact integrity.
  "reading_order_mismatch",
  "paper_set_mismatch",
  "paper_set_empty",
  "publication_metadata_invalid",
  "publication_structure_invalid",
  "published_score_mismatch",
  "published_dimension_mismatch",
  "reading_tier_mismatch"
]);

const warningEntry = (issue = {}) => ({
  ...issue,
  severity: "warning",
  blocking: false
});

export const isBlockingCredibilityIssue = (issue = {}) => (
  BLOCKING_CREDIBILITY_CODES.has(String(issue?.code || "").trim())
);

export const applyCredibilityGatePolicy = ({ issues = [], warnings = [] } = {}) => {
  const blockingIssues = [];
  const advisoryIssues = [];
  (Array.isArray(issues) ? issues : []).forEach((issue) => {
    if (isBlockingCredibilityIssue(issue)) {
      blockingIssues.push(issue);
    } else {
      advisoryIssues.push(warningEntry(issue));
    }
  });
  return {
    issues: blockingIssues,
    warnings: [
      ...(Array.isArray(warnings) ? warnings : []),
      ...advisoryIssues
    ]
  };
};

export const acceptCredibilityAdvisories = (validation = {}) => {
  const policy = applyCredibilityGatePolicy(validation);
  return {
    ...validation,
    valid: policy.issues.length === 0 && Boolean(
      validation?.paperDraft
      || validation?.editorialPlan
      || validation?.headTailDraft
      || validation?.artifacts
      || validation?.qaResult
    ),
    issues: policy.issues,
    warnings: policy.warnings
  };
};
