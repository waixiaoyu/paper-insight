# Evidence Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent malformed Evidence responses from excluding papers while retaining strict checks for claims, citations, and original-text excerpts.

**Architecture:** `weekly-report/evidence-agent.js` will classify validation output before content repair. A format-only response repair retries a complete Evidence response up to two times and reports persistent failures as `processingFailed`; content validation retains its bounded, field-scoped repair path. The orchestrator and Trace will preserve the distinction so candidate refill decisions and administrator diagnostics use the correct cause.

**Tech Stack:** Node.js 20+, native `node:test`, dependency-free ES modules.

**Spec:** `WEEKLY_REPORT_AGENT_LOOP_DEV.md`, section 2.1.1.1; `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`, GRAY-088 and GRAY-103.

## Global Constraints

- Only arXiv HTML original text may supply weekly-report Evidence; no abstract fallback.
- Format recovery never weakens exact excerpt, numeric, or evidence-reference validation.
- Format recovery does not consume the three content-repair attempts and never emits `evidence_excluded`.
- Single-paper model calls remain isolated; paper concurrency remains 1–5 and defaults to 2.
- Preserve task and Trace history; do not delete prior reports or traces during deployment or real validation.

---

### Task 1: Separate format-only recovery from Evidence content repair

**Files:**
- Modify: `weekly-report/evidence-agent.js`
- Modify: `weekly-report/prompts.js`
- Test: `test/weekly-report-evidence-agent.test.js`

**Interfaces:**
- Consumes: `runEvidenceAgent({ paper, contextPacket, callModel, onCall, onEvent })`.
- Produces: successful result fields `responseRepairAttempted` and `responseRepairCount`; persistent format failure as `EvidenceAgentError` with `processingFailed: true` and `excludePaper: false`.

- [ ] **Step 1: Write failing tests for initial malformed responses**

```js
test("Evidence retries two format-only repairs before reporting a processing failure", async () => {
  const calls = [];
  await assert.rejects(() => runEvidenceAgent({
    paper: { id: "2607.11111" }, contextPacket: contextPacketFor(),
    callModel: async () => "{\"evidenceCard\":" ,
    onEvent: async (event) => calls.push(event)
  }), (error) => error.processingFailed === true && error.excludePaper === false);
  assert.equal(calls.filter((event) => event.type === "evidence_response_repair_requested").length, 2);
});
```

- [ ] **Step 2: Run the focused Evidence test and verify it fails**

Run: `node --test test/weekly-report-evidence-agent.test.js`

Expected: the new test fails because the current agent performs a single generic repair then sets `excludePaper: true`.

- [ ] **Step 3: Implement format classification and bounded response repairs**

```js
const RESPONSE_CONTRACT_ISSUE_CODES = new Set(["invalid_json", "schema_invalid"]);
const hasOnlyResponseContractIssues = (validation) => /* every issue is a response-contract issue */;

// Before content repair, invoke buildEvidenceResponseRepairPrompt twice when
// hasOnlyResponseContractIssues(validation) is true. On exhaustion, throw an
// EvidenceAgentError with processingFailed: true and excludePaper: false.
```

Add `buildEvidenceResponseRepairPrompt` that uses the same original-text context and output schema, explicitly requests only a complete JSON response, and does not include a content-repair target or permit field merging.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test test/weekly-report-evidence-agent.test.js`

Expected: the new format recovery test passes and existing Evidence tests remain green.

- [ ] **Step 5: Add the content-path regression tests**

```js
test("format recovery does not consume the later content repair", async () => {
  // malformed initial response -> valid but numerically unsupported response
  // -> one field-scoped content repair -> valid result
});

test("format repair never accepts an excerpt or evidence reference that fails validation", async () => {
  // response repair returns syntactically valid but non-verbatim source
  // and the result remains on the content-repair path
});
```

- [ ] **Step 6: Run the focused tests and commit**

Run: `node --test test/weekly-report-evidence-agent.test.js`

Expected: PASS.

Commit: `git add weekly-report/evidence-agent.js weekly-report/prompts.js test/weekly-report-evidence-agent.test.js && git commit -m "fix: separate evidence format recovery"`

### Task 2: Preserve processing failures in batch results and Trace

**Files:**
- Modify: `weekly-report/evidence-agent.js`
- Modify: `weekly-report/orchestrator.js`
- Test: `test/weekly-report-evidence-agent.test.js`
- Test: `test/weekly-report-orchestrator.test.js`

**Interfaces:**
- Consumes: `extractEvidenceBatch` entries containing an `EvidenceAgentError` marked `processingFailed`.
- Produces: `processingFailed` batch entries, `evidence_processing_failed` Trace events, and evidence-stage artifacts that do not add these papers to `excluded`.

- [ ] **Step 1: Write a failing batch/orchestrator regression test**

```js
test("exhausted Evidence format recovery is processingFailed and the next candidate is processed", async () => {
  // First candidate always returns malformed JSON; reserve candidate returns valid Evidence.
  // Assert no evidence_excluded event for the first paper and one successful candidate.
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test test/weekly-report-evidence-agent.test.js test/weekly-report-orchestrator.test.js`

Expected: failure because the old error becomes an Evidence exclusion rather than a processing failure.

- [ ] **Step 3: Implement processing-failure propagation**

```js
if (error?.processingFailed === true || error?.modelCallFailed) {
  await onEvent?.({ type: "evidence_processing_failed", ... });
  return { ok: false, processingFailed: true, item, error };
}
```

Include `responseRepairCount` in successful Evidence artifacts and use separate Trace event names for format recovery, content repair, processing failure, and content exclusion.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `node --test test/weekly-report-evidence-agent.test.js test/weekly-report-orchestrator.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `git add weekly-report/evidence-agent.js weekly-report/orchestrator.js test/weekly-report-evidence-agent.test.js test/weekly-report-orchestrator.test.js && git commit -m "fix: trace evidence processing failures"`

### Task 3: Make the research-problem check evidence-based rather than keyword-only

**Files:**
- Modify: `weekly-report/evidence-agent.js`
- Test: `test/weekly-report-evidence-agent.test.js`

**Interfaces:**
- Consumes: `evidenceCard.problem` bound excerpts.
- Produces: a `problem_excerpt_not_problem_statement` issue only when no bound excerpt states a problem, gap, limitation, need, research objective, or tested capability.

- [ ] **Step 1: Write failing acceptance and rejection tests**

```js
test("research objective wording is accepted as problem Evidence", () => {
  // A verbatim excerpt such as "We study whether..." has no contribution-only wording.
  assert.equal(validateEvidenceArtifacts(response, options).valid, true);
});

test("contribution-only wording remains invalid as problem Evidence", () => {
  // Existing "We introduce..." regression stays invalid.
});
```

- [ ] **Step 2: Run the focused test and verify the acceptance case fails**

Run: `node --test test/weekly-report-evidence-agent.test.js`

Expected: the new research-objective case fails only on `problem_excerpt_not_problem_statement`.

- [ ] **Step 3: Implement the narrow validator adjustment**

Expand the problem-evidence signal matcher to recognize direct research-objective and tested-capability wording while retaining the contribution-only counterexample. Do not alter numeric, excerpt, anchor, or evidence-reference validators.

- [ ] **Step 4: Run the focused test and commit**

Run: `node --test test/weekly-report-evidence-agent.test.js`

Expected: PASS.

Commit: `git add weekly-report/evidence-agent.js test/weekly-report-evidence-agent.test.js && git commit -m "fix: recognize research objective evidence"`

### Task 4: Verify, deploy, and execute a real end-to-end weekly report

**Files:**
- Modify: `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`
- Test: full test suite and remote browser workflow

**Interfaces:**
- Consumes: the completed implementation and the existing remote weekly-report candidate data.
- Produces: a pushed `main` revision, remote service running the same revision, a new non-destructive real task and Trace, plus a GRAY-088/103 verification record.

- [ ] **Step 1: Run local validation**

Run: `npm test` and `npm run check`

Expected: all tests pass; no syntax error.

- [ ] **Step 2: Push and deploy without deleting remote data**

Run: push `main`, copy/update only source files on `/home/guguji/paper-insight`, verify no active task before restarting `paper-insight`, restart the service, verify health and deployed revision.

- [ ] **Step 3: Simulate the administrator workflow through the local tunnel**

Use the browser to open the deployed application, restore the existing list, create one new weekly-report task, poll its stage and Trace until a publish, manual decision, or terminal failure. Do not delete existing reports, tasks, or traces.

- [ ] **Step 4: Record the real outcome and run final regression**

Append the new Trace identifier, selected count, Evidence format/content failure counts, and result to GRAY-088/103. Re-run `npm test` after the documentation update.

- [ ] **Step 5: Commit the verification record**

Commit: `git add WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md && git commit -m "test: record evidence recovery gray run"`
