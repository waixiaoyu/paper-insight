# Weekly Report Unified Manual Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent papers that passed the full-text gate from being silently excluded by PaperInsight processing failures, provide one auditable administrator review queue for processing, evidence, and score decisions, and allow a reasoned below-threshold selection override without weakening evidence credibility.

**Architecture:** Add a normalized manual-review domain model shared by Job persistence, Pipeline routing, and the browser. Evidence, Review, and Calibration continue processing independent papers while collecting bounded review backlog items; Selection becomes the synchronization point that either continues to writing or exposes the queue. Administrator decisions are idempotent and scoped to one item, and every retry, confirmation, override, skip, and exit is persisted to Trace before the Pipeline resumes.

**Tech Stack:** Node.js 20+ ES modules, built-in `node:test`, dependency-free browser JavaScript, HTML/CSS, JSON-backed Job and Trace stores.

**Spec:** `docs/superpowers/specs/2026-09-08-weekly-report-manual-review-selection-design.md`; authoritative workflow `WEEKLY_REPORT_AGENT_LOOP_DEV.md` section 2.1.1.2; gray ledger `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`.

## Global Constraints

- Final report credibility and reading value remain the release standard; Agent Loop visibility is administrator operations support.
- A paper with no valid full text cannot enter weekly-report publication.
- Processing failures never lower a paper score and never become a paper-quality conclusion.
- Manual inclusion only overrides the Selection score threshold; it never changes the real score.
- Manual inclusion cannot bypass full-text, identity, evidence, cross-paper isolation, sensitive-information, or final-QA gates.
- Independent papers continue with bounded concurrency; a single paper failure does not cancel the batch.
- Reader-facing Markdown must not expose scores, internal issue codes, administrator decisions, prompts, artifacts, or Trace terminology.
- Administrator-facing copy uses direct Chinese descriptions; internal codes are available only in technical Trace details.
- Final Job states remain `publish` and `reject`; waiting for review remains a running Job.
- Only one weekly-report Job may run globally, and this change does not add service-restart checkpoint recovery.
- No new runtime dependencies are introduced.

## File Structure

- Create `weekly-report/manual-review.js`: manual-review kinds, actions, item/queue normalization, legacy wrapping, active-item lookup, queue removal, and bounded public payloads.
- Modify `weekly-report/schema.js`: validate queue-shaped `manualReview` and bounded idempotency receipts while preserving legacy Job readability.
- Modify `weekly-report/job-manager.js`: persist normalized review queues, validate item-scoped decisions, deduplicate decision IDs, and record Trace receipts.
- Modify `weekly-report/evidence-agent.js`: deterministic numeric-token boundaries and narrowly scoped Evidence-envelope normalization.
- Modify `weekly-report/rules.js`: deterministic `admin_override` selection without score mutation.
- Modify `weekly-report/orchestrator.js`: collect review backlog items, preserve successful artifacts, retry minimal paper/stage scope, and build Selection review items.
- Modify `weekly-report/pipeline-runner.js`: route item-scoped decisions and resume only the affected stage.
- Modify `server.js`: validate and forward the expanded decision body without changing endpoint paths.
- Create `public/manual-review-view.js`: pure queue/view/action presentation model.
- Modify `public/manual-review-details.js`: Chinese issue explanations for all three review kinds.
- Modify `public/manual-review-actions.js`: new action labels and accepted-result copy.
- Modify `public/index.html`, `public/app.js`, `public/styles.css`: queue/detail/gate/action layout, required reason input, state restoration, and long-preview layout correction.
- Add or modify the matching `test/weekly-report-*.test.js` files and redacted fixtures under `test/fixtures/weekly-report/`.

---

### Task 1: Add deterministic Evidence recovery guardrails

**Files:**
- Modify: `weekly-report/evidence-agent.js:36-80,259-402,487-760`
- Test: `test/weekly-report-evidence-agent.test.js`
- Create: `test/fixtures/weekly-report/gray-124-flat-evidence-response.json`

**Interfaces:**
- Produces: `extractEvidenceNumericTokens(value: unknown): string[]`.
- Produces: `normalizeEvidenceResponseShape(value: object): { value: object, normalized: boolean, reason: string }`.
- Consumes: the existing `validateEvidenceArtifacts(value, { contextPacket, expectedPaperId })` contract.

- [ ] **Step 1: Write failing numeric-boundary tests**

Add tests that validate summaries containing `6G`, `3D`, `1B`, and `F1` without requiring numeric evidence for `6`, `3`, or `1`, while preserving detection of `10 秒`, `37.5%`, and `120 samples`.

```js
test("Evidence numeric claims ignore alphanumeric identifiers", () => {
  assert.deepEqual(extractEvidenceNumericTokens("6G、3D、1B 与 F1"), []);
  assert.deepEqual(extractEvidenceNumericTokens("10 秒内降低 37.5%，覆盖 120 samples"), ["10", "37.5%", "120"]);
});
```

- [ ] **Step 2: Run the focused test and verify the boundary case fails**

Run: `node --test --test-name-pattern="alphanumeric identifiers" test/weekly-report-evidence-agent.test.js`

Expected: FAIL because the current regex extracts the numeric prefix from `6G`, `3D`, and `1B`.

- [ ] **Step 3: Implement two-sided alphanumeric boundaries**

Export and use one tokenizer with both left and right boundaries:

```js
export const extractEvidenceNumericTokens = (value) => {
  const matches = normalizeText(value).match(
    /(?<![A-Za-z0-9_])\d+(?:,\d{3})*(?:\.\d+)?\s*%?(?![A-Za-z0-9_])/g
  ) || [];
  return [...new Set(matches.map((token) => token.replace(/[\s,]/g, "").toLowerCase()))];
};
```

Use this function everywhere the Evidence Agent compares summary and excerpt numbers.

- [ ] **Step 4: Write a failing flat-envelope regression**

The fixture must contain the redacted production shape with root fields `paperId`, `problem`, `method`, `systemDesign`, `experiments`, `results`, `limitations`, `affiliations`, `evidenceInsufficient`, `warnings`, and nested `valueSignals`, but no `evidenceCard` wrapper. Assert it is deterministically wrapped once and then passes the unchanged Schema and content validation.

- [ ] **Step 5: Run the flat-envelope regression and verify it fails as `schema_invalid`**

Run: `node --test --test-name-pattern="flat Evidence envelope" test/weekly-report-evidence-agent.test.js`

Expected: FAIL because `normalizeEvidenceArtifacts` currently requires `response.evidenceCard`.

- [ ] **Step 6: Implement narrow envelope normalization**

Only wrap a response when all Evidence field keys and an object-valued `valueSignals` are present. Do not guess missing fields or alter content.

```js
export const normalizeEvidenceResponseShape = (value) => {
  if (value?.evidenceCard && value?.valueSignals) {
    return { value, normalized: false, reason: "" };
  }
  const hasCardFields = value && EVIDENCE_FIELDS.every((field) => Object.hasOwn(value, field));
  if (!hasCardFields || !value.valueSignals || Array.isArray(value.valueSignals)) {
    return { value, normalized: false, reason: "" };
  }
  const { valueSignals, ...evidenceCard } = value;
  return { value: { evidenceCard, valueSignals }, normalized: true, reason: "flat_evidence_envelope" };
};
```

Emit `evidence_response_normalized` with paper ID and reason, then run the complete existing Evidence validation.

- [ ] **Step 7: Run the complete Evidence tests**

Run: `node --test test/weekly-report-evidence-agent.test.js`

Expected: PASS, including malformed JSON, missing fields, fabricated excerpts, and unsupported numeric controls.

- [ ] **Step 8: Commit the Evidence guardrails**

```bash
git add weekly-report/evidence-agent.js test/weekly-report-evidence-agent.test.js test/fixtures/weekly-report/gray-124-flat-evidence-response.json
git commit -m "fix: recover common evidence response failures"
```

### Task 2: Define the unified manual-review queue contract

**Files:**
- Create: `weekly-report/manual-review.js`
- Modify: `weekly-report/schema.js:1-20,210-340`
- Test: `test/weekly-report-manual-review.test.js`
- Test: `test/weekly-report-schema.test.js`

**Interfaces:**
- Produces: `MANUAL_REVIEW_KINDS`, `MANUAL_REVIEW_ACTIONS`.
- Produces: `normalizeManualReviewRequest(review, { requestedAt }): ManualReviewQueue`.
- Produces: `manualReviewItem(review, itemId): ManualReviewItem | null`.
- Produces: `withoutManualReviewItem(review, itemId): ManualReviewQueue | null`.
- `ManualReviewQueue`: `{ status, stage, resumeStage, activeItemId, items, requestedAt }`.
- `ManualReviewItem`: `{ itemId, paperId, relatedPaperIds, kind, scope, sourceStage, summary, details, issues, evidenceReviews, approvableIssueKeys, scoreSnapshot, gateStatus, repairAttempts, allowedActions }`.

- [ ] **Step 1: Write failing contract tests for all three review kinds**

Use literal requests for `processing_failure`, `evidence_dispute`, and `quality_below_threshold`. Assert stable item IDs, bounded text and arrays, deduplicated paper IDs/actions, and correct queue lookup/removal.

```js
const queue = normalizeManualReviewRequest({
  stage: "select",
  resumeStage: "select",
  items: [{
    itemId: "selection-2609.02514",
    paperId: "2609.02514",
    kind: "quality_below_threshold",
    scope: "paper",
    sourceStage: "select",
    summary: "横向校准后为 67 分，低于 70 分入选线。",
    scoreSnapshot: { finalScore: 67, threshold: 70 },
    gateStatus: { fullText: "passed", identity: "passed", evidence: "passed", crossPaper: "passed" },
    allowedActions: ["include_below_threshold", "keep_excluded", "exit_task"]
  }]
}, { requestedAt: "2026-09-08T00:00:00.000Z" });
assert.equal(manualReviewItem(queue, "selection-2609.02514").scoreSnapshot.finalScore, 67);
```

- [ ] **Step 2: Run the new contract tests and verify module-not-found failure**

Run: `node --test test/weekly-report-manual-review.test.js`

Expected: FAIL because `weekly-report/manual-review.js` does not exist.

- [ ] **Step 3: Implement normalization and legacy wrapping**

Define these exact actions:

```js
export const MANUAL_REVIEW_ACTIONS = Object.freeze([
  "continue_repair", "retry_paper", "retry_stage", "retry_job",
  "confirm_evidence", "include_below_threshold", "keep_excluded",
  "skip_paper", "ignore_warning", "exit_task"
]);
```

If an old request has top-level `paperId`, `issues`, and `allowedActions` but no `items`, wrap it into one item. The normalized public queue must omit private retry payloads and cap evidence content through the existing `compactEvidenceReviews` helper.

- [ ] **Step 4: Write failing Job Schema tests**

Assert queue-shaped review data is accepted; unknown kind/action, duplicate item ID, missing `resumeStage`, invalid score snapshot, or an `include_below_threshold` item whose evidence gate is not `passed` is rejected. Assert a legacy single-item Job still loads.

- [ ] **Step 5: Replace duplicated action sets and validate the normalized queue**

Import `MANUAL_REVIEW_ACTIONS` into `schema.js` and `job-manager.js`. Add `adminDecisionReceipts: []` to new Jobs and validate each receipt as `{ decisionId, itemId, action, decidedAt }`, with at most 50 receipts retained.

- [ ] **Step 6: Run contract and Schema tests**

Run: `node --test test/weekly-report-manual-review.test.js test/weekly-report-schema.test.js`

Expected: PASS.

- [ ] **Step 7: Commit the queue contract**

```bash
git add weekly-report/manual-review.js weekly-report/schema.js test/weekly-report-manual-review.test.js test/weekly-report-schema.test.js
git commit -m "feat: define unified weekly report review queue"
```

### Task 3: Make administrator decisions item-scoped and idempotent

**Files:**
- Modify: `weekly-report/job-manager.js:462-652`
- Modify: `server.js:4350-4428`
- Test: `test/weekly-report-job-manager.test.js`
- Test: `test/weekly-report-job-api.test.js`

**Interfaces:**
- Consumes: `POST /api/reading-list/jobs/:jobId/decision` body `{ decisionId, itemId, action, paperId?, reason? }`.
- Produces: resolved Pipeline decision with the same fields plus `decidedAt`, scoped evidence approvals when applicable, and a persisted receipt.
- Preserves: existing endpoint path and legacy single-item decision support.

- [ ] **Step 1: Write failing JobManager tests for queue selection and reason validation**

Request a two-item queue, decide the second item by `itemId`, and assert only that item's actions are accepted. Assert `include_below_threshold` fails without an eight-character trimmed reason and fails when any hard gate is not `passed`.

- [ ] **Step 2: Write failing idempotency tests**

Submit the same `decisionId` twice. Assert the Pipeline promise resolves once, Trace contains one `manual_review_decided` event, and the second call returns the current Job. Reuse the ID with another action and assert HTTP 409.

- [ ] **Step 3: Run focused Job tests and verify the new actions are rejected**

Run: `node --test --test-name-pattern="item-scoped|idempotent|below-threshold reason" test/weekly-report-job-manager.test.js`

Expected: FAIL on unknown actions, missing queue lookup, and duplicate request handling.

- [ ] **Step 4: Normalize requests and validate the selected item in `requestManualReview` and `decide`**

Use `normalizeManualReviewRequest`. In `decide`, check `adminDecisionReceipts` before requiring a currently pending review. Append the Trace event, persist the receipt and cleared public review, then resolve the in-memory decision promise. Never resolve before Trace persistence succeeds.

- [ ] **Step 5: Add API contract tests**

POST one valid decision, repeat it, submit an unknown `itemId`, submit a missing override reason, and submit a conflicting reused decision ID. Expected statuses are 200, 200, 409, 409, and 409 respectively.

- [ ] **Step 6: Run JobManager and Job API tests**

Run: `node --test test/weekly-report-job-manager.test.js test/weekly-report-job-api.test.js`

Expected: PASS; existing cancel, interruption, Trace redaction, and failed-Trace-write cases remain green.

- [ ] **Step 7: Commit idempotent decisions**

```bash
git add weekly-report/job-manager.js server.js test/weekly-report-job-manager.test.js test/weekly-report-job-api.test.js
git commit -m "feat: scope weekly report decisions to review items"
```

### Task 4: Collect processing and evidence failures without excluding papers

**Files:**
- Modify: `weekly-report/orchestrator.js:352-850,913-1350`
- Test: `test/weekly-report-orchestrator.test.js`
- Create: `test/fixtures/weekly-report/gray-124-stage-failures.json`

**Interfaces:**
- Produces internal `manualReviewBacklog: ManualReviewBacklogItem[]` on stage results.
- A backlog item contains the public `ManualReviewItem` plus private `retryInput`; only the public item reaches Job persistence and Trace.
- Preserves successful `evidenceItems`, `reviewItems`, and initial Calibration inputs while failures are pending.

- [ ] **Step 1: Write failing mixed Evidence outcome tests**

Use the redacted `10 unsupported + 8 response invalid + 6 succeeded` counts from the real run. Assert response-invalid items become `processing_failure`, content disputes become `evidence_dispute`, `counts.excluded` does not include either group, and all six successful items continue.

- [ ] **Step 2: Write failing zero-success-but-reviewable tests**

When every full-text-qualified paper has a retryable processing failure or reviewable evidence dispute, assert the stage returns a running state that can reach `manual_review`; it must not throw `READING_LIST_NO_EVIDENCE_PAPERS` or write `reject_requested`.

- [ ] **Step 3: Run the Evidence/Review orchestrator tests and verify current exclusion behavior fails**

Run: `node --test --test-name-pattern="review backlog|mixed Evidence|zero success" test/weekly-report-orchestrator.test.js`

Expected: FAIL because current code increments `counts.excluded`, says “跳过”, and rejects when no item succeeds.

- [ ] **Step 4: Accumulate bounded backlog items while continuing independent work**

Map `processingFailed` to `processing_failure` with `retry_paper`; map Evidence/Review content failures to `evidence_dispute` with `continue_repair` or evidence confirmation only when a bounded evidence package exists. Keep source-gate exclusions in `counts.excluded`; remove “已跳过” from processing-warning copy.

- [ ] **Step 5: Write the failing Calibration batch-failure regression for GRAY-116**

Simulate a successful Review cohort followed by a network failure during confirmation Calibration. Assert the reviewed cohort and prior call artifacts remain present, the failure creates one job-scope `processing_failure` with `retry_stage`, and no paper is added to `calibrationResult.excluded`.

- [ ] **Step 6: Preserve the cohort on Calibration transport/format failure**

Replace the current `calibrationPool = []`/whole-batch exclusion branch with a review item containing `sourceStage: "calibrate"`, `scope: "job"`, related paper IDs, and a private snapshot of the existing Review pool. Content-level unresolved single-paper results become paper-scoped review items instead of automatic exclusions.

- [ ] **Step 7: Run all Orchestrator stage tests**

Run: `node --test test/weekly-report-orchestrator.test.js`

Expected: PASS, including reserve expansion, 30-paper ceiling, manual skip, and existing successful traces.

- [ ] **Step 8: Commit non-excluding backlog collection**

```bash
git add weekly-report/orchestrator.js test/weekly-report-orchestrator.test.js test/fixtures/weekly-report/gray-124-stage-failures.json
git commit -m "fix: preserve papers after agent processing failures"
```

### Task 5: Add audited below-threshold Selection overrides

**Files:**
- Modify: `weekly-report/rules.js:221-345`
- Modify: `weekly-report/orchestrator.js:1353-1455`
- Test: `test/weekly-report-rules.test.js`
- Test: `test/weekly-report-orchestrator.test.js`
- Test: `test/weekly-report-operations.test.js`

**Interfaces:**
- Extends: `selectCalibratedPapers(items, { threshold, minSelectedCount, maxSelectedCount, adminSelectionOverrides })`.
- `adminSelectionOverrides`: `{ paperId, reason, decisionId, decidedAt }[]`.
- Produces selected item `selection`: `{ selected, selectionReason: "threshold" | "admin_override", selectionSource, finalScore, thresholdMet, readingTier, originalCalibrationReadingTier, rank, adminReason? }`.

- [ ] **Step 1: Write failing deterministic override tests**

Use scores 74, 72, 67, and 65 at threshold 70/minimum 3. Assert the first two select normally; an override for 67 selects it third with unchanged `finalScore: 67`, `thresholdMet: false`, `selectionReason: "admin_override"`, and stored reason. Assert 65 remains not selected.

- [ ] **Step 2: Add hard-gate and capacity controls**

Assert an uncalibrated item, Evidence status other than `pass`, mismatched paper identity, unknown paper ID, and an override beyond `maxSelectedCount` are never selected. The function must return rejected override IDs for Trace diagnostics.

- [ ] **Step 3: Run rule tests and verify failure on the new option**

Run: `node --test --test-name-pattern="admin override" test/weekly-report-rules.test.js`

Expected: FAIL because the current selector ignores `adminSelectionOverrides`.

- [ ] **Step 4: Implement override-aware deterministic ordering**

Select threshold candidates first. Then append explicitly overridden, otherwise eligible below-threshold candidates in the same score/tier/date/ID order until `maxSelectedCount`. Never write a replacement score.

- [ ] **Step 5: Build quality review items at the Selection barrier**

If selected count is below `minSelectedCount`, create `quality_below_threshold` items for the highest-ranked eligible candidates needed to close the gap, excluding IDs already declined. Include four-dimensional scores, final score, threshold, calibration status/comparison reason, and passed gate states.

- [ ] **Step 6: Persist selection reason and Trace summary**

Add `adminOverrideCount`, selected paper IDs, real scores, decision IDs, and reasons to `selection-artifacts`. Update the operations summary to render “管理员复核纳入（实际 67 分，默认入选线 70 分）” while keeping this internal to the administrator view.

- [ ] **Step 7: Run rules, Orchestrator, and operations tests**

Run: `node --test test/weekly-report-rules.test.js test/weekly-report-orchestrator.test.js test/weekly-report-operations.test.js`

Expected: PASS.

- [ ] **Step 8: Commit Selection overrides**

```bash
git add weekly-report/rules.js weekly-report/orchestrator.js test/weekly-report-rules.test.js test/weekly-report-orchestrator.test.js test/weekly-report-operations.test.js
git commit -m "feat: support audited manual paper selection"
```

### Task 6: Route queue decisions through minimal retries and resume points

**Files:**
- Modify: `weekly-report/orchestrator.js`
- Modify: `weekly-report/pipeline-runner.js:17-310`
- Test: `test/weekly-report-pipeline-runner.test.js`
- Test: `test/weekly-report-orchestrator.test.js`

**Interfaces:**
- Produces: `retryWeeklyReportPaper(current, context, modelOptions)`.
- Produces: `retryWeeklyReportStage(current, context, modelOptions)`.
- Consumes item-scoped decisions from Task 3.
- Preserves existing `confirm_evidence`, `continue_repair`, `skip_paper`, and `exit_task` behavior.

- [ ] **Step 1: Write failing multi-item Pipeline tests**

Return a queue with a processing failure, evidence dispute, and quality item. Decide the quality item first, then retry the processing item, then confirm or repair the evidence item. Assert the queue remains visible until all items are resolved and no decision removes an unrelated item.

- [ ] **Step 2: Write failing minimal-retry tests**

For an Evidence processing failure, count model calls and assert only the failed paper executes Evidence and Review again; successful papers are not regenerated. For a writer failure, assert only that paper receives a new `paperSectionRetry`. For Calibration batch failure, assert only Calibration reruns with the preserved Review pool.

- [ ] **Step 3: Run focused Pipeline tests and verify invalid-transition failures**

Run: `node --test --test-name-pattern="review queue|minimal retry|retry stage" test/weekly-report-pipeline-runner.test.js`

Expected: FAIL because current manual review handles one top-level item and has no `retry_paper`, `retry_stage`, `include_below_threshold`, or `keep_excluded` routes.

- [ ] **Step 4: Add queue-aware decision routing**

For each accepted decision:

```js
const remaining = withoutManualReviewItem(review, decision.itemId);
current = {
  ...current,
  manualReview: remaining,
  nextStage: remaining ? "manual_review" : review.resumeStage
};
```

`include_below_threshold` appends an immutable override receipt and returns to Selection. `keep_excluded` records a declined ID without increasing content-failure counts. `skip_paper` removes the paper and returns to Calibration. Evidence confirmation retains the existing stable issue-key behavior.

- [ ] **Step 5: Implement paper and stage retry helpers**

`retryWeeklyReportPaper` must recover from the smallest stored stage input: Evidence then Review when Evidence failed; Review only when Review failed; one Paper Section repair when writing failed. `retryWeeklyReportStage` accepts only Calibration, deterministic QA, paper semantic QA, report semantic QA, Editorial Plan, or Head/Tail and reuses their current normalized artifacts.

- [ ] **Step 6: Rebuild downstream cross-paper artifacts only when membership changes**

Retry success that adds a candidate, manual skip, or manual inclusion returns to Calibration/Selection and invalidates Editorial Plan, Paper Draft, Head/Tail, assembled Markdown, and QA artifacts. A scoped evidence confirmation that does not change membership returns to its originating QA stage.

- [ ] **Step 7: Keep hard gates non-overridable**

Tests must prove no action route exists for invalid full text, identity mismatch, cross-paper contamination, missing displayable evidence, or sensitive configuration leakage. `include_below_threshold` must be rejected server-side even if a client forges it.

- [ ] **Step 8: Run Pipeline and Orchestrator suites**

Run: `node --test test/weekly-report-pipeline-runner.test.js test/weekly-report-orchestrator.test.js`

Expected: PASS.

- [ ] **Step 9: Commit retry and resume routing**

```bash
git add weekly-report/orchestrator.js weekly-report/pipeline-runner.js test/weekly-report-pipeline-runner.test.js test/weekly-report-orchestrator.test.js
git commit -m "feat: resume weekly report from scoped review decisions"
```

### Task 7: Build the administrator review layout and fix long Markdown preview flow

**Files:**
- Create: `public/manual-review-view.js`
- Modify: `public/manual-review-details.js`
- Modify: `public/manual-review-actions.js`
- Modify: `public/index.html:295-325`
- Modify: `public/app.js:2745-2881,5473-5505`
- Modify: `public/styles.css:215-361,1175-1280,3335-3365`
- Create: `test/weekly-report-manual-review-view.test.js`
- Modify: `test/weekly-report-manual-review-details.test.js`
- Modify: `test/weekly-report-manual-review-actions.test.js`
- Modify: `test/weekly-report-api.test.js`

**Interfaces:**
- Produces: `weeklyReportManualReviewView(review, selectedItemId): { items, activeItem, title, summary, details, evidenceReviews, scoreRows, gateRows, actions, requiresReason }`.
- Decision body: `{ decisionId, itemId, action, paperId?, reason? }`.
- Preserves: the Trace dialog as the single administrator surface and the outer dialog shell as the single scroll owner.

- [ ] **Step 1: Write failing pure view-model tests**

Assert three queue rows have Chinese type labels; processing failures never say paper quality is low; evidence disputes include draft/evidence comparisons; quality items expose four scores, threshold, comparison reason, and `requiresReason: true`.

- [ ] **Step 2: Run the view-model test and verify module-not-found failure**

Run: `node --test test/weekly-report-manual-review-view.test.js`

Expected: FAIL because `public/manual-review-view.js` does not exist.

- [ ] **Step 3: Implement the pure presenter and Chinese action copy**

Return only actions permitted by the selected server item. Do not render unavailable actions as unexplained gray buttons. Each action includes an effect sentence, for example “只重试论文 2609.00590 的证据提取，不会重新生成其他论文”。

- [ ] **Step 4: Replace the single warning strip with the approved queue/detail/gate layout**

Add semantic DOM for:

```html
<nav id="weeklyReportManualReviewQueue" aria-label="待复核论文"></nav>
<section id="weeklyReportManualReviewDetail" aria-live="polite"></section>
<aside id="weeklyReportManualReviewGates" aria-label="发布可信度检查"></aside>
<textarea id="weeklyReportManualReviewReason" maxlength="500"></textarea>
```

The top health panel remains visible. The queue, detail, gate list, and action bar are separate from Trace phases and artifacts.

- [ ] **Step 5: Wire item selection, reason validation, confirmation, and idempotency**

Keep the selected item ID in browser state while the same queue is displayed. Generate one `crypto.randomUUID()` per submitted decision, include the item ID and trimmed reason, and reuse the same decision ID only when retrying the same failed HTTP request. Confirm skip and exit. Disable manual inclusion until the reason has at least eight trimmed characters.

- [ ] **Step 6: Write the failing long-Markdown layout regression**

Assert ready-state preview uses an auto-sized grid row and the outer `.reading-list-shell` remains the vertical scroll owner. The regression must reject the current combination of a fixed preview row and a textarea whose JavaScript height exceeds that row.

- [ ] **Step 7: Fix preview expansion without adding an inner scrollbar**

Keep `adjustReadingListOutputHeight()` for content measurement, but make the ready preview participate in normal document flow:

```css
.reading-list-dialog.ready .reading-list-preview {
  flex: 0 0 auto;
  grid-template-rows: auto auto;
}

.reading-list-dialog.ready .reading-list-output {
  min-height: 240px;
  height: auto;
}
```

The footer must follow the expanded preview and remain reachable through `.reading-list-shell` scrolling. At widths below 680px, stack queue, detail, gate list, and actions in that order.

- [ ] **Step 8: Run view, action, details, and static UI tests**

Run: `node --test test/weekly-report-manual-review-view.test.js test/weekly-report-manual-review-details.test.js test/weekly-report-manual-review-actions.test.js test/weekly-report-api.test.js`

Expected: PASS, including existing button-restoration, evidence-package, dialog-scroll, and no-spinner tests.

- [ ] **Step 9: Commit the administrator interface**

```bash
git add public/manual-review-view.js public/manual-review-details.js public/manual-review-actions.js public/index.html public/app.js public/styles.css test/weekly-report-manual-review-view.test.js test/weekly-report-manual-review-details.test.js test/weekly-report-manual-review-actions.test.js test/weekly-report-api.test.js
git commit -m "feat: add unified weekly report review workspace"
```

### Task 8: Add full-flow regressions, update the gray ledger, and verify release behavior

**Files:**
- Modify: `test/weekly-report-full-flow.test.js`
- Modify: `test/weekly-report-real-gray-regression.test.js`
- Modify: `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`
- Modify: `WEEKLY_REPORT_AGENT_LOOP_DEV.md`
- Modify: `docs/superpowers/specs/2026-09-08-weekly-report-manual-review-selection-design.md`
- Verify: every production and test file changed in Tasks 1-7

**Interfaces:**
- Consumes all Task 1-7 deliverables.
- Produces a publish result only after queue decisions and unchanged final credibility gates pass.

- [ ] **Step 1: Add a mocked end-to-end publish regression**

Use four papers: two score above 70, one scores 67 with all credibility gates passed, and one has an Evidence response-format failure. Allow the administrator to retry the failed paper or skip it, manually include the 67-point paper with a reason, then assert at least three papers reach writing and final QA. Assert the 67 score remains 67 and only Trace contains the override metadata.

- [ ] **Step 2: Add failure controls**

Forge manual inclusion for a paper with no full text, a mismatched paper ID, unsupported evidence, and cross-paper contamination. Each must remain blocked and the previously published Markdown must remain unchanged.

- [ ] **Step 3: Add page-recovery and duplicate-click integration coverage**

Create a Job that reaches a three-item queue, fetch it as a newly opened page would, submit one decision twice with the same ID, and assert the active Job resumes once with the remaining two items.

- [ ] **Step 4: Run the focused full-flow tests**

Run: `node --test test/weekly-report-full-flow.test.js test/weekly-report-real-gray-regression.test.js test/weekly-report-job-api.test.js`

Expected: PASS without calling the paid model or public arXiv service.

- [ ] **Step 5: Record every discovered issue in the gray ledger**

Add these entries with their exact regression files and status `已加防护，待真实复核`:

- `GRAY-124`: 24 full-text-qualified papers produced only 2 published papers because 18 model/validator failures were treated as exclusions.
- `GRAY-125`: no administrator path existed to include an evidence-qualified 60-point paper while preserving its real score and reason.
- `GRAY-126`: Evidence numeric matching treated `6G/3D/1B` as unsupported numbers and common flat Evidence envelopes as unusable Schema failures.
- `GRAY-127`: long generated Markdown expanded the textarea beyond its fixed preview grid row, overlapping the footer.

Update `GRAY-116` to reference the new Calibration retry-stage tests once they pass.

- [ ] **Step 6: Reconcile the authoritative specification with implemented names**

Verify the spec uses exactly `processing_failure`, `evidence_dispute`, `quality_below_threshold`, `retry_paper`, `retry_stage`, `include_below_threshold`, `keep_excluded`, and `selectionSource=admin_override`. Remove obsolete statements that processing failures or repair exhaustion automatically exclude a paper or reject the Job.

- [ ] **Step 7: Run syntax and whitespace checks**

Run: `node --check server.js`

Run: `node --check public/app.js`

Run: `node --check public/manual-review-view.js`

Run: `git diff --check`

Expected: all commands exit 0.

- [ ] **Step 8: Run the complete automated suite**

Run: `npm test`

Expected: all tests pass with zero failures; the exact count is recorded in the implementation handoff.

- [ ] **Step 9: Perform a local manual UI smoke test on port 3100**

Use a mocked or persisted local Job, not a paid-model run. Verify queue selection, evidence expansion, reason validation, retry status, skip/exit confirmation, dialog scrolling, long Markdown preview flow, and page reopen recovery. Do not delete or rewrite historical Job, Trace, paper, recommendation, or published-report data.

- [ ] **Step 10: Commit documentation and final regressions**

```bash
git add test/weekly-report-full-flow.test.js test/weekly-report-real-gray-regression.test.js WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md WEEKLY_REPORT_AGENT_LOOP_DEV.md docs/superpowers/specs/2026-09-08-weekly-report-manual-review-selection-design.md docs/superpowers/plans/2026-09-08-weekly-report-unified-manual-review.md
git commit -m "test: cover weekly report manual review recovery"
```

- [ ] **Step 11: Stop before deployment**

Report the local test evidence and remaining real-gray checks. Do not push, deploy, stop services, or run the paid model until the user explicitly requests those operations.
