# Weekly Report Manual Review And Trace Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a weekly-report job running after its automatic content-repair budget is exhausted, let the administrator decide the next action, and make each Trace stage expose its actual event and artifact details.

**Architecture:** `WeeklyReportJobManager` owns a single in-memory pending decision while persisting a sanitized `manualReview` snapshot on the running job. The pipeline requests a decision only for repairable content failures; system/configuration failures continue to reject. The existing Trace dialog renders the persisted prompt and posts decisions to a dedicated job endpoint, while phase rows use native nested `details` elements to expose their own payloads.

**Tech Stack:** Node.js ESM, built-in `node:test`, HTTP API in `server.js`, browser UI in plain HTML/CSS/JavaScript.

**Spec:** `WEEKLY_REPORT_AGENT_LOOP_DEV.md` sections 2.1.1, 5.7, 6.1 and 6.4.

## Global Constraints

- Job state remains `running`, `publish`, or `reject`; waiting for an administrator is `running` plus `manualReview`.
- The global single-running-job lock remains held while waiting.
- Default automatic content-repair limit is three; each administrator “continue repair” grants exactly one additional repair.
- `ignore` cannot bypass blocking evidence, number, affiliation, cross-paper, structure, or semantic-QA failures.
- `skip_paper` is available only when the review has one concrete `paperId`; affected downstream cohort artifacts must be regenerated.
- Every decision and repair attempt is persisted in Trace.
- No history or previous published report is deleted or overwritten by a rejected job.

---

### Task 1: Persisted Manual-Review Job Contract

**Files:**
- Modify: `weekly-report/schema.js`
- Modify: `weekly-report/job-manager.js`
- Test: `test/weekly-report-job-manager.test.js`

**Interfaces:**
- Produces: `context.requestManualReview(review): Promise<decision>` and `manager.decide(jobId, decision)`.
- Produces: running job field `manualReview: { stage, paperId, issues, repairAttempts, allowedActions, requestedAt } | null`.

- [ ] **Step 1: Write the failing test**

```js
test("a manual review keeps the job running until the administrator decides", async () => {
  const created = await manager.createOrReuse({ reportKey: "2026-W32" });
  const waiting = await waitUntil(() => manager.getActive().then((job) => job?.manualReview));
  assert.equal(waiting.state, "running");
  assert.deepEqual(waiting.manualReview.allowedActions, ["continue_repair", "exit_task"]);
  await manager.decide(created.jobId, { action: "exit_task" });
  assert.equal((await manager.waitForCompletion(created.jobId)).state, "reject");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/weekly-report-job-manager.test.js`
Expected: FAIL because `context.requestManualReview` and `manager.decide` do not exist.

- [ ] **Step 3: Implement the minimal job contract**

Add schema validation for sanitized `manualReview`, a manager-owned deferred decision map, persisted waiting state, cancellation-safe resolution, `manual_review_requested` and `manual_review_decided` Trace events, and finalization cleanup.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/weekly-report-job-manager.test.js`
Expected: PASS.

### Task 2: Decision API

**Files:**
- Modify: `server.js`
- Test: `test/weekly-report-job-api.test.js`

**Interfaces:**
- Consumes: `manager.decide(jobId, { action })`.
- Produces: `POST /api/reading-list/jobs/:jobId/decision` with actions `continue_repair`, `exit_task`, `skip_paper`, and `ignore_warning`.

- [ ] **Step 1: Write the failing API test**

Create a test job whose executor calls `context.requestManualReview`, assert the job stays `running`, post `exit_task`, and assert the response and final job are `reject` with reason `admin_rejected`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/weekly-report-job-api.test.js`
Expected: FAIL with 404 for `/decision`.

- [ ] **Step 3: Add the route and validation**

Extend the job route matcher with `decision`, parse the JSON body, call the manager, return 409 for a stale or disallowed action, and preserve existing cancel behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/weekly-report-job-api.test.js`
Expected: PASS.

### Task 3: Three Repairs And Manual Pipeline Transition

**Files:**
- Modify: `weekly-report/orchestrator.js`
- Modify: `weekly-report/pipeline-runner.js`
- Test: `test/weekly-report-orchestrator.test.js`
- Test: `test/weekly-report-pipeline-runner.test.js`

**Interfaces:**
- Consumes: `context.requestManualReview(review)`.
- Produces: `qaReport.repairCount`, with `repairAttempted` retained for compatibility.
- Produces: manual decisions that either grant one repair, reject, or restart from calibration after excluding one paper.

- [ ] **Step 1: Write failing tests for three automatic repairs and waiting**

Assert that repeated repairable QA results call `repair_once` three times, that the fourth failure invokes `requestManualReview`, and that `continue_repair` grants exactly one more repair before another review request.

- [ ] **Step 2: Write a failing skip-paper test**

Assert that a `skip_paper` decision removes the named paper, adds it to `manualExcludedPaperIds`, and returns to calibration so selection, editorial planning, writing, assembly, and all QA stages rerun.

- [ ] **Step 3: Run the focused tests and confirm expected failures**

Run: `node --test test/weekly-report-pipeline-runner.test.js test/weekly-report-orchestrator.test.js`
Expected: FAIL because the current pipeline rejects after one repair and has no manual transition.

- [ ] **Step 4: Implement repair counting and decision handling**

Replace the boolean-only gate with `repairCount < 3`, increment it in `repairWeeklyReportOnce`, preserve each repair artifact with an attempt suffix, call `requestManualReview` after exhaustion, and map decisions as follows: `continue_repair` -> one approved `repair_once`; `exit_task` -> structured reject; `skip_paper` -> filter the concrete paper and rerun calibration; `ignore_warning` -> only when explicitly allowed by the review payload.

- [ ] **Step 5: Run the focused tests**

Run: `node --test test/weekly-report-pipeline-runner.test.js test/weekly-report-orchestrator.test.js`
Expected: PASS.

### Task 4: Administrator Decision Panel

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/weekly-report-api.test.js`

**Interfaces:**
- Consumes: `job.manualReview` and `POST .../decision`.
- Produces: a visible panel in the Trace dialog with issue summary, paper ID, repair history count, and only the actions permitted by the server.

- [ ] **Step 1: Add a failing static contract test**

Assert the served HTML contains `weeklyReportManualReview`, the application source contains `/decision`, and the four action values are present.

- [ ] **Step 2: Run the test and confirm failure**

Run: `node --test test/weekly-report-api.test.js`
Expected: FAIL because the panel and handler are absent.

- [ ] **Step 3: Implement the panel**

Render the panel whenever a running job has `manualReview`, open the Trace dialog automatically, disable actions not listed in `allowedActions`, post the chosen action, and keep polling the same job.

- [ ] **Step 4: Run the test**

Run: `node --test test/weekly-report-api.test.js`
Expected: PASS.

### Task 5: Expandable Per-Stage Trace Details

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/weekly-report-api.test.js`

**Interfaces:**
- Produces: each stage event and artifact as a nested native `details` element containing a readable summary and formatted JSON payload.

- [ ] **Step 1: Add a failing rendering-contract test**

Assert the application source contains the dedicated `appendWeeklyReportTraceDetail` renderer and stage artifacts pass both `name` and `artifact` rather than discarding the payload.

- [ ] **Step 2: Run the test and confirm failure**

Run: `node --test test/weekly-report-api.test.js`
Expected: FAIL because `appendWeeklyReportTracePhase` currently destructures only `[name]`.

- [ ] **Step 3: Implement nested details**

Render event meaning and payload together, render artifact name and full sanitized artifact together, keep the raw Trace fallback, and ensure the modal content owns vertical scrolling.

- [ ] **Step 4: Run the focused test**

Run: `node --test test/weekly-report-api.test.js`
Expected: PASS.

### Task 6: Full Verification And Deployment

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run syntax and full regression checks**

Run: `npm run check`
Expected: all tests pass with zero failures.

- [ ] **Step 2: Inspect the final diff**

Run: `git diff --check` and `git status --short`.
Expected: no whitespace errors and only intended files changed.

- [ ] **Step 3: Commit and push**

```bash
git add WEEKLY_REPORT_AGENT_LOOP_DEV.md docs/superpowers/plans/2026-08-13-weekly-report-manual-review-trace-details.md weekly-report public server.js test
git commit -m "Add weekly report manual review controls"
git push origin main
```

- [ ] **Step 4: Deploy without deleting history**

On the remote host, verify a clean worktree, use `git pull --ff-only`, restart `paper-insight`, confirm `active`, and call the read-only health endpoint.
