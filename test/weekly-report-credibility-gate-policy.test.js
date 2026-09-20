import test from "node:test";
import assert from "node:assert/strict";

import {
  acceptCredibilityAdvisories,
  applyCredibilityGatePolicy,
  isBlockingCredibilityIssue
} from "../weekly-report/credibility-gate-policy.js";

test("credibility policy blocks only deterministic identity, provenance and structure failures", () => {
  [
    "schema_invalid",
    "paper_id_mismatch",
    "evidence_ref_unknown",
    "evidence_ref_not_found",
    "observation_evidence_paper_mismatch",
    "paper_set_mismatch",
    "publication_structure_invalid"
  ].forEach((code) => assert.equal(isBlockingCredibilityIssue({ code }), true, code));
});

test("credibility policy turns semantic judgments into non-blocking warnings", () => {
  [
    "numeric_claim_not_in_evidence",
    "numeric_claim_not_in_excerpt",
    "metric_label_not_in_evidence",
    "unsupported_fact",
    "model_cohort_scope_overgeneralized",
    "affiliation_source_not_metadata",
    "rhetorical_prose_style",
    "other"
  ].forEach((code) => assert.equal(isBlockingCredibilityIssue({ code }), false, code));

  const result = applyCredibilityGatePolicy({
    issues: [
      { code: "paper_id_mismatch", path: "paperId", detail: "wrong paper" },
      { code: "numeric_claim_not_in_evidence", path: "results", detail: "1000 vs 10 million" },
      { code: "unsupported_fact", path: "method", detail: "model suspicion" }
    ],
    warnings: [{ code: "internal_process_leak", path: "text", detail: "reader wording" }]
  });

  assert.deepEqual(result.issues.map((entry) => entry.code), ["paper_id_mismatch"]);
  assert.deepEqual(result.warnings.map((entry) => entry.code), [
    "internal_process_leak",
    "numeric_claim_not_in_evidence",
    "unsupported_fact"
  ]);
  assert.equal(result.warnings[1].severity, "warning");
  assert.equal(result.warnings[1].blocking, false);
});

test("agent validation accepts an artifact when every remaining issue is advisory", () => {
  const paperDraft = { paperId: "2609.08482" };
  const accepted = acceptCredibilityAdvisories({
    valid: false,
    issues: [
      { code: "numeric_claim_not_in_evidence", path: "experimentsAndResults", detail: "1000" },
      { code: "metric_label_not_in_evidence", path: "experimentsAndResults", detail: "accuracy" }
    ],
    warnings: [],
    paperDraft
  });

  assert.equal(accepted.valid, true);
  assert.deepEqual(accepted.issues, []);
  assert.equal(accepted.warnings.length, 2);
  assert.equal(accepted.paperDraft, paperDraft);

  const rejected = acceptCredibilityAdvisories({
    valid: false,
    issues: [{ code: "evidence_ref_unknown", path: "evidenceRefs[0]" }],
    warnings: [],
    paperDraft
  });
  assert.equal(rejected.valid, false);
  assert.equal(rejected.issues[0].code, "evidence_ref_unknown");
});
