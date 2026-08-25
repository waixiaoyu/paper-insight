# Weekly Report Selection and Operations Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure weekly reports only publish papers that meet the reading-value threshold, exhaust the original recommendation reserve before accepting a below-target paper count, and make the administrator operations view clearly explain task health, execution events, artifacts, selection reasons, and processing failures.

**Architecture:** Keep the existing single background Job and eight-phase Agent Loop. Extend calibration refill decisions to use the count of calibrated papers meeting `reviewScoreThreshold`, make deterministic selection threshold-only, and expose normalized progress metadata on the Job. Move administrator-facing status and artifact summaries into pure browser-side helpers so behavior can be unit-tested independently from DOM assembly; keep raw Trace available for diagnostics.

**Tech Stack:** Node.js ES modules, built-in `node:test`, dependency-free browser JavaScript, HTML/CSS, JSON-backed Job and Trace stores.

**Spec:** `WEEKLY_REPORT_AGENT_LOOP_DEV.md`; issue ledger `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md` (`GRAY-088`, `GRAY-101`, `GRAY-103`, `GRAY-104`, `GRAY-105`, plus the approved threshold-only selection change).

## Global Constraints

- Final report credibility and reading value take priority over reaching a target paper count.
- Only same-week, visible papers from `primaryCandidates` and `reserveCandidates` may enter the Agent Loop.
- A reserve paper must pass full text, Evidence, Review, and Calibration before selection.
- `minSelectedCount` is a target for reserve expansion, not permission to select a below-threshold paper.
- When the reserve is exhausted, publish one or more threshold-qualified papers even if fewer than `minSelectedCount`; reject when zero papers meet the threshold.
- Reader-facing prose must not expose internal selection, Agent, Review, Calibration, or repair terminology.
- Administrator-facing descriptions use direct Chinese technical language; internal codes remain secondary diagnostic data.
- No checkpoint recovery or multiple concurrent weekly-report Jobs are added.

---

### Task 1: Verify and close the Evidence response-format repair legacy item

**Files:**
- Verify: `weekly-report/evidence-agent.js`
- Test: `test/weekly-report-evidence-agent.test.js`
- Modify: `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`

**Interfaces:**
- Consumes: `runEvidenceAgent({ paper, contextPacket, callModel, ... })`.
- Produces: independent `responseRepairCount` and `repairCount`; exhausted format repair throws a `processingFailed` error instead of a content exclusion.

- [ ] **Step 1: Run the focused Evidence tests that cover malformed initial and repaired responses**

Run: `node --test test/weekly-report-evidence-agent.test.js`

Expected: existing tests prove two response-format repairs do not consume the three targeted content repairs and exhausted format recovery is returned in `processingFailed`.

- [ ] **Step 2: Add a missing integration regression only if the existing suite does not exercise malformed JSON during a content repair**

The test must feed a valid initial response with a content issue, a malformed repair response, a valid response-format recovery, and then assert `repairCount === 1`, `responseRepairCount === 1`, and a valid artifact.

- [ ] **Step 3: Run the focused Evidence tests again**

Run: `node --test test/weekly-report-evidence-agent.test.js`

Expected: PASS.

- [ ] **Step 4: Mark `GRAY-088` closed only after the behavior is verified**

Change its status to `已关闭` without weakening the documented requirements.

### Task 2: Distinguish time windows from experimental numeric claims

**Files:**
- Modify: `weekly-report/editorial-agent.js`
- Test: `test/weekly-report-editorial-agent.test.js`
- Modify: `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`

**Interfaces:**
- Consumes: Editorial Plan and Head/Tail claims plus cited Evidence text.
- Produces: numeric validation that ignores a duration token only when it is syntactically part of a time-window expression such as `7-day`, while preserving validation of experimental counts, percentages, scores, and durations presented as results.

- [ ] **Step 1: Write failing Editorial Plan numeric tests**

Add one test where `7-day window` is accepted without a literal `7` in the cited excerpt, and one control where `7 trials` still produces `numeric_claim_not_in_evidence`.

- [ ] **Step 2: Run the focused tests and verify the new time-window test fails for the expected numeric issue**

Run: `node --test --test-name-pattern="time window|experimental number" test/weekly-report-editorial-agent.test.js`

Expected: the `7-day window` case fails before implementation; the experimental-count control continues to pass.

- [ ] **Step 3: Implement contextual numeric token classification**

Add a focused helper used by Editorial Plan numeric validation to exclude tokens attached to `day/week/month/year` window or interval syntax. Do not globally ignore duration values and do not change Evidence excerpt numeric validation.

- [ ] **Step 4: Run the complete Editorial Agent test file**

Run: `node --test test/weekly-report-editorial-agent.test.js`

Expected: PASS.

- [ ] **Step 5: Mark `GRAY-101` closed**

Record the exact accepted time-window form and the preserved experimental-number guardrail.

### Task 3: Expand reserves until the threshold-qualified target is met

**Files:**
- Modify: `weekly-report/rules.js`
- Modify: `weekly-report/orchestrator.js`
- Test: `test/weekly-report-rules.test.js`
- Test: `test/weekly-report-orchestrator.test.js`
- Modify: `WEEKLY_REPORT_AGENT_LOOP_DEV.md`
- Modify: `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`

**Interfaces:**
- Consumes: calibrated items with `reviewResult.rawScore`, `calibrationResult.status`, `reviewScoreThreshold`, `minSelectedCount`, `maxSelectedCount`, and ordered `reserveCandidates`.
- Produces: `selection.selected` containing threshold-qualified items only; calibration Trace records `thresholdQualifiedCount`, `thresholdTarget`, `reserveAttempted`, and `reserveRemaining`.

- [ ] **Step 1: Write failing deterministic-selection tests**

Add literal fixtures with scores `68`, `67`, `65`, threshold `70`, and minimum `3`. Assert zero selected and all three items classified `below_threshold`; add a second fixture with scores `82`, `76`, `68` and assert only the first two are selected even though the minimum is three.

- [ ] **Step 2: Run the rule tests and verify they fail because fallback papers are currently selected**

Run: `node --test test/weekly-report-rules.test.js`

Expected: FAIL with selected paper counts larger than the threshold-qualified literals.

- [ ] **Step 3: Remove automatic below-threshold fallback from deterministic selection**

Keep stable score/tier/date ordering, `maxSelectedCount`, `thresholdMet`, and not-selected reasons. Return `fallbackCount: 0` for compatibility while treating `minSelectedCount` only as the reserve-expansion target.

- [ ] **Step 4: Run the rule tests**

Run: `node --test test/weekly-report-rules.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing calibration refill tests**

Cover: initial calibrated papers meet the quantity target but not the score threshold; reserve papers are then processed through context, Evidence, Review, and Calibration until three threshold-qualified papers exist or the reserve is exhausted. Assert the Trace refill reason is `threshold_qualified_below_target`.

- [ ] **Step 6: Run the focused orchestrator tests and verify the new refill case fails because the current loop stops on calibrated count**

Run: `node --test --test-name-pattern="threshold-qualified|select stage" test/weekly-report-orchestrator.test.js`

Expected: FAIL before implementation at the reserve call/count assertion.

- [ ] **Step 7: Change calibration refill termination to threshold-qualified count**

After each calibration cycle, count only converged items whose `rawScore >= reviewScoreThreshold`. Request the next ordered reserve batch while the count is below `minSelectedCount`, reserve remains, and the 30-paper calibration ceiling is not exceeded. Each reserve item still executes the existing context, Evidence, Review, and Calibration functions.

- [ ] **Step 8: Preserve fewer-than-target publication and zero-qualified rejection**

If one or two threshold-qualified items remain after reserve exhaustion, continue with a warning and publish them. If zero threshold-qualified items remain, `select` rejects with a Chinese administrator-readable reason explaining that the original candidate pool was exhausted without a paper meeting the configured threshold.

- [ ] **Step 9: Run rule and orchestrator tests**

Run: `node --test test/weekly-report-rules.test.js test/weekly-report-orchestrator.test.js`

Expected: PASS.

- [ ] **Step 10: Update the authoritative spec and issue ledger**

Remove statements that automatic fallback may select a below-threshold paper. Add the approved rule that reserve expansion is based on threshold-qualified count and add a new gray issue recording the production behavior caught by the `68/67/65` run.

### Task 4: Normalize administrator-facing outcome and selection summaries

**Files:**
- Create: `public/weekly-report-operations.js`
- Modify: `public/app.js`
- Test: `test/weekly-report-operations.test.js`
- Test: `test/weekly-report-api.test.js`
- Modify: `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`

**Interfaces:**
- Produces: `weeklyReportArtifactSummary(name, artifact)` with Chinese summary groups and `weeklyReportSelectionRows(selectionArtifact)` with paper ID, title, final score, threshold, and admission reason.
- Consumes: Trace artifacts without mutating them.

- [ ] **Step 1: Write failing pure-function tests for Evidence outcome separation**

Use a literal artifact containing five `processingFailed`, three `excluded`, and four `succeeded` items. Assert the summary labels them as “模型处理或响应格式失败 5 篇”, “论据内容未通过 3 篇”, and “证据通过 4 篇”.

- [ ] **Step 2: Write failing pure-function tests for selection reasons**

Assert a selected score of `76` with threshold `70` renders “达到 70 分入选”; assert a score of `68` is rendered as “未达到 70 分，不入选”, never as an unfinished step.

- [ ] **Step 3: Run the new unit tests and verify failure because the module does not exist**

Run: `node --test test/weekly-report-operations.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 4: Implement the pure summary module and integrate it into phase artifacts**

Keep internal codes available only inside the expanded raw detail. Show Chinese counts and business meaning before raw JSON.

- [ ] **Step 5: Run operations and API tests**

Run: `node --test test/weekly-report-operations.test.js test/weekly-report-api.test.js`

Expected: PASS.

- [ ] **Step 6: Mark `GRAY-103` closed after the 5:3 mixed-failure regression passes**

### Task 5: Separate execution events from phase artifacts

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/weekly-report-api.test.js`
- Modify: `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`

**Interfaces:**
- Consumes: phase `events` and `[name, artifact]` pairs.
- Produces: one event timeline container and one visually distinct artifact-card container per phase.

- [ ] **Step 1: Write a failing static UI contract test**

Assert phase rendering creates separate classes `weekly-report-trace-event-list` and `weekly-report-trace-artifact-list`, artifacts use `weekly-report-trace-artifact`, and the artifact renderer never appends to the event list.

- [ ] **Step 2: Run the API/UI test and verify failure on the missing artifact container**

Run: `node --test --test-name-pattern="Trace|artifact" test/weekly-report-api.test.js`

Expected: FAIL before implementation.

- [ ] **Step 3: Split the phase body into labeled sections**

Render “执行过程” only when events exist and “阶段产物” only when artifacts exist. A phase with artifacts but no running event must derive status from events and Job state, not from artifact presence.

- [ ] **Step 4: Add distinct artifact-card CSS and responsive behavior**

Artifact cards must not use a time column. Preserve independent scrolling and expandable structured details.

- [ ] **Step 5: Run API/UI and operations tests**

Run: `node --test test/weekly-report-api.test.js test/weekly-report-operations.test.js`

Expected: PASS.

- [ ] **Step 6: Mark `GRAY-105` closed**

### Task 6: Add explicit task-health and reconnection state

**Files:**
- Modify: `weekly-report/schema.js`
- Modify: `weekly-report/job-manager.js`
- Modify: `public/weekly-report-operations.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/weekly-report-schema.test.js`
- Test: `test/weekly-report-job-manager.test.js`
- Test: `test/weekly-report-operations.test.js`
- Test: `test/weekly-report-api.test.js`
- Modify: `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`

**Interfaces:**
- Produces Job `progress`: `{ stageStartedAt, lastEventAt, lastEventType, paperId }`.
- Produces browser health states: `running_recent`, `waiting_admin`, `connection_interrupted`, `possibly_stalled`, `publish`, `reject`.

- [ ] **Step 1: Write failing Job progress tests**

Assert `updateStage` initializes `stageStartedAt`, `recordTrace` updates `lastEventAt`, `lastEventType`, and `paperId`, and `getActive` returns those fields after the page would have been closed.

- [ ] **Step 2: Run Job tests and verify failure on missing progress metadata**

Run: `node --test test/weekly-report-schema.test.js test/weekly-report-job-manager.test.js`

Expected: FAIL before implementation.

- [ ] **Step 3: Add normalized progress metadata without adding checkpoint recovery**

Persist progress with the active Job. Preserve `stageStartedAt` while the same stage updates counts; reset it only when `agentStage` changes. Store only redacted event type and paper ID, not prompt or response bodies.

- [ ] **Step 4: Write failing health-state tests**

Use a fixed clock to assert recent events show “运行中（最近有进展）”, manual review shows “等待管理员处理”, a fetch failure shows “连接中断，后台状态待确认”, stale events show “可能停滞”, and publish/reject remain terminal.

- [ ] **Step 5: Run operations tests and verify the state-classification assertions fail**

Run: `node --test test/weekly-report-operations.test.js`

Expected: FAIL before implementation.

- [ ] **Step 6: Implement the prominent operations health panel**

Show state label, current stage, current paper ID when present, last server event time, time since progress, stage elapsed time, and total elapsed time. A stale threshold only warns; it never changes the Job state or triggers rejection.

- [ ] **Step 7: Make polling tolerate temporary connection failures**

On `Failed to fetch`, retain the Job ID, render `connection_interrupted`, and continue bounded polling. Add a visible “刷新状态/重新连接” control that requests the existing Job; it must not create a new Job.

- [ ] **Step 8: Run Job, operations, and UI tests**

Run: `node --test test/weekly-report-schema.test.js test/weekly-report-job-manager.test.js test/weekly-report-operations.test.js test/weekly-report-api.test.js`

Expected: PASS.

- [ ] **Step 9: Mark `GRAY-104` closed**

### Task 7: Full regression, documentation consistency, and ledger closure

**Files:**
- Modify: `WEEKLY_REPORT_AGENT_LOOP_DEV.md`
- Modify: `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`
- Verify: all production and test files changed above

**Interfaces:**
- Consumes all deliverables from Tasks 1-6.
- Produces an internally consistent specification, passing suite, and explicit remaining gray-test requirements.

- [ ] **Step 1: Run syntax checks**

Run: `node --check server.js && node --check public/app.js && node --check public/weekly-report-operations.js`

Expected: PASS.

- [ ] **Step 2: Run the complete automated suite**

Run: `npm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 3: Review pending ledger entries**

Run an encoding-safe script that lists every `待实现` and `待修复` entry. `GRAY-088`, `GRAY-101`, `GRAY-103`, `GRAY-104`, and `GRAY-105` must no longer be pending. Any newly discovered behavior must receive a new gray ID with a corresponding test or explicit guardrail.

- [ ] **Step 4: Verify specification consistency**

Search for obsolete statements that below-threshold fallback is automatically selected or that progress and artifacts share one list. Replace them with the implemented threshold-only and separated-operations behavior.

- [ ] **Step 5: Run whitespace and diff checks**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 6: Perform a local API integration run**

Create a controlled Job fixture with fewer than three threshold-qualified papers and verify the terminal result publishes only the qualified set; use mocked model responses from existing test fixtures, not the paid remote model.

- [ ] **Step 7: Leave remote deployment and paid-model gray testing for explicit deployment authorization**

Do not modify or delete remote historical data. The next real gray run must preserve the complete Trace and confirm the administrator UI manually.
