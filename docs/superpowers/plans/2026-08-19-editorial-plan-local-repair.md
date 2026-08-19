# Editorial Plan Local Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Editorial Plan repairs path-local and auditable, enable scoped paper skipping, and show manual-review failures in readable Chinese.

**Architecture:** Preserve the normalized Editorial Plan after first generation. Each repair receives that plan and returns a patch limited to failing paths; the server rejects unapproved paths, applies approved values, and revalidates the full merged plan. Issue provenance derives a unique `paperId` or ordered `relatedPaperIds` from the failing Plan entry and its evidence references, so the decision API can validate an administrator-selected skip.

**Tech Stack:** Node.js ESM, `node:test`, existing HTTP Job API, static HTML/JavaScript frontend.

**Spec:** `WEEKLY_REPORT_AGENT_LOOP_DEV.md` sections 2.1.1, 8.6, 20.2, and 21.

## Global Constraints

- Keep all existing Evidence, numeric, structure, scope, and prose gates fail-closed.
- Automatic repairs remain capped at three; administrator-triggered local repairs are not numerically capped.
- Only issue-authorized paths may change during a repair; every other normalized value is retained.
- Skip excludes one administrator-approved related paper, reruns calibration and every downstream stage, and never publishes a failing draft.
- Trace must retain redacted decision inputs, repair paths, patches, before/after differences, and scope provenance.
- Administrator-facing copy is Simplified Chinese and does not use internal codes or English validator details as the primary explanation.

---

### Task 1: Add path-local patching and Editorial Plan issue provenance

**Files:**

- Create: `weekly-report/editorial-plan-repair.js`
- Modify: `weekly-report/editorial-agent.js:500-1070`
- Modify: `weekly-report/prompts.js:654-681`
- Test: `test/weekly-report-editorial-plan-repair.test.js`
- Test: `test/weekly-report-editorial-agent.test.js`

**Interfaces:**

- `buildEditorialPlanRepairTargets(issues) -> string[]`
- `applyEditorialPlanPatch(plan, patch, allowedPaths) -> { plan, changedPaths, rejectedPaths }`
- `deriveEditorialPlanIssueScope(plan, issues) -> { paperId, relatedPaperIds, paths }`

- [ ] Write failing tests that apply a patch only to `singlePaperObservations[0].caveat`, assert an unchanged `trends` collection, and reject a patch key outside the allowed path.
- [ ] Run `node --test test/weekly-report-editorial-plan-repair.test.js` and verify the tests fail because the new primitive is absent.
- [ ] Implement safe path parsing, cloning, allow-list validation, and provenance extraction. A single-paper entry resolves via `paperId` and evidence refs; a trend resolves via `supportingPaperIds` and evidence refs.
- [ ] Change `buildEditorialPlanRepairPrompt` to include the current normalized plan, repair targets, and normalized issues, and require only a path/value patch response. Change `runEditorialPlanAgent` to apply that patch then run `validateEditorialPlan` on the merged plan.
- [ ] Add regressions for “受控基准而非部署轨迹” repaired at one caveat path, unrelated plan content returned by the model being ignored, and a two-paper trend deriving ordered `relatedPaperIds`.
- [ ] Run `node --test test/weekly-report-editorial-plan-repair.test.js test/weekly-report-editorial-agent.test.js` and commit with `git commit -m "fix editorial plan local repairs"`.

### Task 2: Persist scope and accept selected skip-paper decisions

**Files:**

- Modify: `weekly-report/schema.js:1-300`
- Modify: `weekly-report/orchestrator.js:1420-1485`
- Modify: `weekly-report/job-manager.js:406-530`
- Modify: `weekly-report/pipeline-runner.js:124-195`
- Test: `test/weekly-report-job-manager.test.js`
- Test: `test/weekly-report-pipeline-runner.test.js`
- Test: `test/weekly-report-orchestrator.test.js`

**Interfaces:**

- `manualReview` gains `relatedPaperIds`, `repairPaths`, and a redacted repair-history summary.
- `WeeklyReportJobManager.decide(jobId, { action, paperId? })` validates `paperId` against the persisted related-paper set for `skip_paper`.

- [ ] Write failing tests that a `singlePaperObservations[0]` error for `2608.02764` enables `skip_paper`, and that a cross-paper trend rejects an unrelated administrator-selected ID but accepts `2608.08691`.
- [ ] Run `node --test test/weekly-report-job-manager.test.js test/weekly-report-pipeline-runner.test.js test/weekly-report-orchestrator.test.js` and verify the new behavior fails.
- [ ] Extend schema validation and orchestration to persist `paperId`, `relatedPaperIds`, and `repairPaths`; offer `skip_paper` whenever scope contains at least one related paper.
- [ ] Carry the decision’s validated `paperId` through JobManager to PipelineRunner; add it to `manualExcludedPaperIds`, reset selection, resume at `calibrate`, and record the selected ID in Trace.
- [ ] Run the focused tests, verify recalibration happens after skip, then commit with `git commit -m "feat support scoped weekly report skip decisions"`.

### Task 3: Fix only the arXiv numeric false positive

**Files:**

- Modify: `weekly-report/editorial-agent.js:375-425`
- Test: `test/weekly-report-editorial-agent.test.js`

- [ ] Write a failing test that `2608.02764` in Editorial Plan text does not create `numeric_claim_not_in_evidence`, plus a test that unsupported `7 天窗口` still does create that issue.
- [ ] Run `node --test test/weekly-report-editorial-agent.test.js` and verify the arXiv-ID assertion fails.
- [ ] Exclude only tokens that fully match `\d{4}\.\d{4,5}` from Editorial Plan numeric comparison. Do not exempt ordinary dotted numeric values, percentages, or number words.
- [ ] Run the focused tests and commit with `git commit -m "fix editorial plan arxiv number validation"`.

### Task 4: Render Chinese manual-review guidance and scoped skip controls

**Files:**

- Modify: `public/manual-review-details.js`
- Modify: `public/app.js:2784-2860,5191-5215`
- Modify: `public/index.html:285-310`
- Modify: `public/styles.css` near the manual-review panel
- Test: `test/weekly-report-manual-review-details.test.js`
- Test: `test/weekly-report-api.test.js`

**Interfaces:**

- `describeWeeklyReportManualReview(review)` returns Chinese field labels, trigger text, requirements, repair actions, and skip candidates.
- The decision request body is `{ action, paperId? }`.

- [ ] Write a failing test for a rhetorical Editorial Plan issue asserting Chinese output contains the field, “而非” source text, the direct-statement requirement, and no `rhetorical_prose_style` or English validator text.
- [ ] Run `node --test test/weekly-report-manual-review-details.test.js` and verify it fails in the generic quality-repair branch.
- [ ] Add fixed Chinese render mappings for emitted Editorial Plan issue classes, including rhetorical style and unsupported numbers. Render single-paper scope directly; for multiple related papers require one radio selection before sending `skip_paper` with its `paperId`.
- [ ] Add static/API regression assertions for the selected `paperId` decision body and enabled skip control; run `node --test test/weekly-report-manual-review-details.test.js test/weekly-report-api.test.js`.
- [ ] Commit with `git commit -m "fix weekly report manual review guidance"`.

### Task 5: Record the gray regression, verify, and deploy safely

**Files:**

- Modify: `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`
- Modify: `README.md` only if user-facing operation changes beyond the existing TODOs
- Test: all tests modified in Tasks 1-4

- [ ] Record the GLM-5.2 trace regression: full Editorial Plan regeneration introduced new errors, a uniquely attributable issue could not be skipped, and arXiv IDs were treated as numbers. Link each safeguard to its automated test.
- [ ] Run `npm test`, then `node --test test/weekly-report-full-flow.test.js test/weekly-report-gray-runner.test.js`; investigate any failure before continuing.
- [ ] Run `git diff --check`, inspect `git status --short`, and commit the ledger/documentation changes.
- [ ] Before remote deployment, query the remote active Job and require a terminal or absent active task. Deploy without deleting caches, job history, traces, or published data; validate the service endpoint and run a small real-data gray case before a full report.

## Plan Self-Review

- Tasks 1-2 cover path-local repair, unlimited administrator continuation, scope attribution, and skip selection.
- Task 3 retains strict numeric validation while removing only arXiv-ID false positives.
- Task 4 implements readable Chinese administrator guidance.
- Task 5 covers the required gray ledger, regression suite, and non-destructive deployment guard.
