# Evidence Source-ID Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate Evidence failures caused by models retyping arXiv excerpts, while keeping every published fact and number bound to exact original text and separating transient transport failures from content disputes.

**Architecture:** Build a deterministic, per-paper registry of bounded source units before the Evidence call. Every unit keeps an exact raw substring for audit and a server-generated readable form for model input. The model selects opaque `sourceId` values and writes summaries; it never copies source text. The server materializes each selected ID into `{ sourceId, section, anchor, excerpt, rawExcerpt }`, where `excerpt` is the readable server-owned form and `rawExcerpt` is the exact audit form. Deterministic Evidence validation checks source identity, paper identity, numeric tokens and reference structure; the independent Review Agent then checks units, direction, comparison subject and scope against the readable source before scoring. Typography, whitespace, LaTeX wrappers, and duplicate arXiv rendering tokens are not publication gates. Existing legacy source objects remain readable for cached traces, but new prompts request IDs only. A single transport retry remains the policy; concurrent retries receive deterministic per-paper staggering so they do not repeat simultaneously.

**Tech Stack:** Node.js ESM, `node:test`, PaperInsight weekly-report Agent Loop, BigModel Coding OpenAI-compatible API.

**Spec:** [WEEKLY_REPORT_AGENT_LOOP_DEV.md](../../../WEEKLY_REPORT_AGENT_LOOP_DEV.md)

## Global Constraints

- Only original text that passed the context quality gate may enter the source registry.
- Source IDs are scoped to one `paperId`; unknown or cross-paper IDs fail closed.
- Server materialization must produce `{ sourceId, section, anchor, excerpt, rawExcerpt }`; `sourceId` and `rawExcerpt` are optional only for legacy cached artifacts.
- The registry must retain the exact raw substring for Trace/audit. The model and final Markdown use the readable server-owned form and never need to reproduce formulas or punctuation character-for-character.
- Typography, normalized whitespace, LaTeX delimiters, and duplicated arXiv-rendered tokens are not rejection reasons. Numeric tokens are checked deterministically; exact facts, units, direction, comparison subject, and cohort/scope remain strict through the independent Review Agent before scoring.
- Exact-number, problem-statement, affiliation, cohort-scope, identity, and cross-paper validation remain enabled after materialization.
- A model may select multiple source units, but it cannot supply or override their text.
- The model still processes one paper per request; default paper concurrency remains 2 with configurable range 1–5.
- Automatic transport retry remains one retry. Staggering changes timing only, not retry count.
- `processing_failure` and `evidence_dispute` remain distinct and neither changes the paper's research score.
- Do not include the API key, full raw response, or unrelated working-tree changes in fixtures, diagnostics, or commits.
- The current worktree is dirty; do not commit until the user explicitly requests it.

---

### Task 1: Align the written Evidence repair rule with the approved staged repair policy

**Files:**
- Modify: `WEEKLY_REPORT_AGENT_LOOP_DEV.md:615-620`
- Test: `test/weekly-report-evidence-agent.test.js`

**Interfaces:**
- Consumes: complete normalized Evidence artifacts plus current validation issues.
- Produces: one field-scoped repair at a time; retained Value Signals are fully revalidated and repaired separately only if they become invalid.

- [x] **Step 1: Add or retain the failing behavioral test**

```js
test("证据字段和 Value Signal 同时失败时不强制在同一模型调用中重写", async () => {
  // Initial response has one invalid Evidence field and one numeric Value Signal issue.
  // The first repair prompt must request only the Evidence field.
  // Full validation must still remove or request repair for the invalid Value Signal.
});
```

- [x] **Step 2: Run the focused test**

Run: `node --test --test-name-pattern="不强制在同一模型调用中重写" test/weekly-report-evidence-agent.test.js`

Expected: PASS with the already approved staged repair implementation.

- [x] **Step 3: Update the specification**

Replace the requirement that every Evidence-field repair must regenerate all Value Signals in the same response with this rule:

```text
Evidence 字段修正时只返回本轮目标字段。服务端保留现有 valueSignals，合并后执行完整校验；只有 valueSignals 的引用或内容因此失效时，下一次定向修正才单独替换 valueSignals。不得在同一次响应中强制重写两类产物。
```

- [x] **Step 4: Verify the spec and behavior agree**

Run: `rg -n "valueSignals|字段级合并|完整校验" WEEKLY_REPORT_AGENT_LOOP_DEV.md weekly-report/evidence-agent.js test/weekly-report-evidence-agent.test.js`

Expected: the spec, implementation, and regression test all describe staged repair with full post-merge validation.

### Task 2: Build a deterministic per-paper source registry

**Files:**
- Create: `weekly-report/evidence-source-registry.js`
- Create: `test/weekly-report-evidence-source-registry.test.js`

**Interfaces:**
- Produces: `buildEvidenceSourceRegistry(contextPacket) -> { paperId, sections, byId }`.
- Produces: `materializeEvidenceSources(value, registry) -> object` without mutating `value`.
- Source unit shape: `{ sourceId, anchor, section, kind, rawText, text }`; only `{ sourceId, text }` is sent to the model.

- [x] **Step 1: Write failing registry tests**

```js
test("source registry emits stable paper-scoped IDs and retains exact contiguous raw text", () => {
  const registry = buildEvidenceSourceRegistry(contextPacketFor("2606.20621"));
  assert.match(registry.sections[0].units[0].sourceId, /^2606\.20621:S0:U000$/);
  assert.ok(contextPacket.inputSections[0].text.includes(registry.sections[0].units[0].rawText));
});

test("materialization replaces sourceId with server-owned source text", () => {
  const materialized = materializeEvidenceSources({
    evidenceCard: { method: { sources: [{ sourceId: "2606.20621:S2:U000" }] } }
  }, registry);
  assert.deepEqual(materialized.evidenceCard.method.sources[0], {
    sourceId: "2606.20621:S2:U000",
    anchor: "S2",
    section: "2 Method",
    excerpt: registry.byId.get("2606.20621:S2:U000").text,
    rawExcerpt: registry.byId.get("2606.20621:S2:U000").rawText
  });
});

test("unknown and cross-paper source IDs fail closed", () => {
  assert.throws(() => materializeEvidenceSources(valueWith("2510.01359:S2:U000"), registry), /sourceId/);
});
```

- [x] **Step 2: Run tests to verify RED**

Run: `node --test test/weekly-report-evidence-source-registry.test.js`

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement exact source units**

```js
export const buildEvidenceSourceRegistry = (contextPacket, { maxUnitChars = 1200 } = {}) => {
  // Split at existing paragraph, sentence, or whitespace boundaries.
  // Preserve rawText as an exact substring and derive readable text server-side.
  // Fall back to a whitespace boundary for a single overlong fragment.
  // Prefix every sourceId with the normalized paperId and section anchor.
};

export const materializeEvidenceSources = (value, registry) => {
  // Clone the response, replace every { sourceId } in evidenceCard or patch fields,
  // reject unknown IDs and any model-supplied source text alongside sourceId.
};
```

- [x] **Step 4: Run tests to verify GREEN**

Run: `node --test test/weekly-report-evidence-source-registry.test.js`

Expected: PASS.

### Task 3: Change new Evidence prompts from copied excerpts to source IDs

**Files:**
- Modify: `weekly-report/prompts.js`
- Modify: `test/weekly-report-evidence-agent.test.js`

**Interfaces:**
- Consumes: `buildEvidenceSourceRegistry(contextPacket).sections`.
- Produces: prompt context containing `{ sourceId, text }` units and output schemas whose source item is `{ sourceId }`.

- [x] **Step 1: Write failing prompt tests**

```js
test("Evidence prompt exposes exact source units and requests IDs instead of copied excerpts", () => {
  const payload = JSON.parse(buildEvidencePrompt({ paper, contextPacket }));
  assert.ok(payload.context.sections[0].units[0].sourceId);
  assert.ok(payload.context.sections[0].units[0].text);
  assert.deepEqual(payload.outputSchema.evidenceField.sources, [{ sourceId: "one supplied sourceId" }]);
  assert.doesNotMatch(JSON.stringify(payload.outputSchema), /verbatim short excerpt/);
});
```

- [x] **Step 2: Run the prompt test to verify RED**

Run: `node --test --test-name-pattern="requests IDs" test/weekly-report-evidence-agent.test.js`

Expected: FAIL because prompts currently request `{ section, anchor, excerpt }`.

- [x] **Step 3: Implement the compact contract**

Update `baseEvidencePayload`, `evidenceOutputSchema`, `evidencePatchOutputSchema`, and Evidence rules so the model:

```js
sources: [{ sourceId: "one supplied sourceId" }]
```

The prompt must say that selected source text is immutable and that the server will materialize it. It must continue requiring every exact number, unit, direction, comparison subject, and scope in a summary or Value Signal claim to be supported by at least one selected unit. It must not ask the model to reproduce formulas or exact punctuation. The Review prompt must independently check those semantic relations before scoring.

- [x] **Step 4: Run focused prompt and Evidence tests**

Run: `node --test test/weekly-report-evidence-agent.test.js`

Expected: PASS, including field-scoped repair prompt tests.

### Task 4: Materialize source IDs before existing Evidence validation

**Files:**
- Modify: `weekly-report/evidence-agent.js`
- Modify: `test/weekly-report-evidence-agent.test.js`

**Interfaces:**
- Consumes: parsed full Evidence responses or scoped patch responses containing source IDs.
- Produces: the existing complete normalized Evidence artifact with exact server-owned excerpts.

- [x] **Step 1: Write failing end-to-end agent tests**

```js
test("Evidence Agent materializes source IDs before exact-number validation", async () => {
  const result = await runEvidenceAgent({
    paper,
    contextPacket,
    callModel: async () => responseUsingOnlySourceIds
  });
  assert.equal(result.validation.valid, true);
  assert.equal(result.evidenceCard.results.sources[0].sourceId, selectedSourceId);
  assert.equal(result.evidenceCard.results.sources[0].excerpt, serverReadableText);
});

test("scoped Evidence patches materialize IDs before merging", async () => {
  // Initial response contains one unsupported method source.
  // Repair returns only { paperId, patch: { method: { sources: [{ sourceId }] } } }.
  // Assert retained fields are unchanged and the method excerpt is exact original text.
});
```

- [x] **Step 2: Run tests to verify RED**

Run: `node --test --test-name-pattern="materializes source IDs|patches materialize IDs" test/weekly-report-evidence-agent.test.js`

Expected: FAIL because source IDs are not yet expanded.

- [x] **Step 3: Materialize at the response boundary**

In `runEvidenceAgent`, build one registry from the current `contextPacket`. After JSON parsing and before `mergeEvidenceRepairArtifacts` or `validateEvidenceArtifacts`, call:

```js
const materialized = materializeEvidenceSources(parsed, sourceRegistry);
```

Keep compatibility only when reading or validating cached legacy artifacts that already contain `{ anchor, section, excerpt }`. A realtime model response without `sourceId` must fail the response contract and enter bounded format repair. Never allow one source object to contain both `sourceId` and model-supplied `excerpt`.

- [x] **Step 4: Run the full Evidence test group**

Run: `node --test test/weekly-report-evidence-source-registry.test.js test/weekly-report-evidence-agent.test.js test/weekly-report-model-json.test.js`

Expected: PASS; fabricated excerpts and cross-paper IDs remain rejected.

### Task 5: Stagger the one allowed transport retry and expose its reason

**Files:**
- Modify: `weekly-report/evidence-agent.js`
- Modify: `scripts/run-weekly-report-evidence-regression.mjs`
- Modify: `test/weekly-report-evidence-agent.test.js`
- Modify: `test/weekly-report-evidence-regression.test.js`

**Interfaces:**
- Consumes: `networkRetryDelayMs` and current `paperId`.
- Produces: `retryWaitMs = networkRetryDelayMs + deterministicOffset(paperId)` and preserves `errorCode`, `errorMessage`, `stopReason`, and duration in the sanitized regression output.

- [x] **Step 1: Write failing retry tests**

```js
test("concurrent paper retries use deterministic different wait values", async () => {
  // Fail the first call for two different paper IDs and succeed on retry.
  // Capture network_retry events and assert both retry once and waitMs values differ.
});

test("regression summary preserves sanitized transport failure reason", async () => {
  // Throw an error with code and message twice.
  // Assert errorCode/errorMessage/stopReason exist and no raw response or secret is stored.
});
```

- [x] **Step 2: Run retry tests to verify RED**

Run: `node --test --test-name-pattern="different wait values|transport failure reason" test/weekly-report-evidence-agent.test.js test/weekly-report-evidence-regression.test.js`

Expected: FAIL because retries currently use the same delay and regression calls omit the message.

- [x] **Step 3: Implement deterministic staggering and diagnostics**

```js
const retryOffsetForPaper = (paperId, baseDelayMs) => {
  const hash = [...String(paperId)].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 0);
  return baseDelayMs > 0 ? hash % Math.min(1000, baseDelayMs + 1) : 0;
};
```

Use the calculated wait in the existing single retry. Add bounded, redacted `errorMessage` and `stopReason` fields to the regression runner; never write request headers, prompts, or API keys.

- [x] **Step 4: Run retry and regression tests**

Run: `node --test test/weekly-report-evidence-agent.test.js test/weekly-report-evidence-regression.test.js`

Expected: PASS with exactly two transport attempts per failed model operation.

### Task 6: Verify deterministic gates and replay real papers

**Files:**
- Modify: `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`
- Write: `outputs/evidence-regression-20260911-source-id-four-papers.json`
- Write: `outputs/evidence-regression-20260911-source-id-eight-papers.json`

**Interfaces:**
- Consumes: the preserved eight-paper context snapshot and the authorized BigModel Coding configuration.
- Produces: sanitized per-paper processing, dispute, call-count, retry, and issue summaries.

- [x] **Step 1: Run the focused automated suite**

Run: `node --test test/weekly-report-evidence-source-registry.test.js test/weekly-report-evidence-agent.test.js test/weekly-report-evidence-regression.test.js test/weekly-report-model-json.test.js`

Expected: PASS.

- [x] **Step 2: Replay the four currently failing papers with concurrency 1**

Run the Evidence regression runner for `2510.01359,2608.15669,2606.20621,2608.29530` with `--concurrency 1`.

Expected: no source-copy mismatch caused by model-authored excerpts; transport failures remain separately classified.

Observed on 2026-09-12: 4/4 succeeded, 0 excluded, 0 processing failures. The run used 12 model calls in total. Intermediate repairs handled incomplete JSON, unsupported numeric claims, one missing evidence reference, and one schema issue; no source-copy mismatch or sourceId binding failure occurred. Sanitized result: `outputs/evidence-regression-20260911-source-id-four-papers.json`.

- [x] **Step 3: Replay all eight papers with production concurrency 2**

Run the Evidence regression runner for all eight preserved IDs with `--concurrency 2`.

Acceptance criteria:

- No paper is excluded solely because of response format, source-copy formatting, network failure, or schema shape.
- Every successful artifact contains paper-scoped source IDs and server-materialized readable excerpts backed by exact raw substrings from its own context packet.
- Remaining content disagreements enter `evidence_dispute` or `processing_failure`, not a false paper-quality exclusion.
- The run records success, dispute, and transport-failure counts separately; target is 8/8 Evidence processing completion, with any unresolved factual dispute shown for administrator review.

Observed on 2026-09-13: production concurrency 2 completed 8/8 papers, with 0 excluded and 0 processing failures across 22 model calls. Intermediate JSON, schema, numeric-grounding, evidence-reference, and affiliation-source issues were corrected by bounded response/content repair or deterministic safe contraction. No `excerpt_not_in_source`, unknown/cross-paper sourceId, source-copy formatting, transport, or rate-limit failure occurred. The sanitized output contains no raw model output or credential marker: `outputs/evidence-regression-20260911-source-id-eight-papers.json`.

- [x] **Step 4: Run the full repository verification**

Run: `npm run check`

Expected: all syntax and tests pass.

Run: `git diff --check`

Expected: no whitespace errors.

- [x] **Step 5: Record the gray issue**

Add one registry entry describing the observed 0/4 and 1/4 runs, the root causes, the source-ID architecture, the retry-staggering guardrail, and links to both sanitized output files. Do not claim 8/8 unless the recorded run proves it.

## Self-Review

- **Spec coverage:** The plan preserves original-text-only Evidence, one-paper calls, bounded concurrency, exact-number validation, one transport retry, administrator review, and complete Trace diagnostics. Task 1 explicitly resolves the previously approved staged-repair change against the older line 618 wording.
- **Placeholder scan:** No implementation step relies on an unresolved placeholder or unspecified handler. Function names, source unit shapes, test commands, and acceptance criteria are explicit.
- **Type consistency:** New prompts emit `{ sourceId }`; `materializeEvidenceSources` restores the existing `{ section, anchor, excerpt }` shape before all existing consumers. Cached legacy artifacts remain supported through an explicit compatibility option, while realtime model responses fail closed without sourceId.
- **Risk control:** Source IDs are paper-scoped, model-supplied source text is rejected, and unique server-owned excerpts remain the only factual input to downstream Review and Writer agents.

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-09-11-evidence-source-id-binding.md`. Execute inline in the current session with `executing-plans`; do not delegate or commit unless the user explicitly requests it.
