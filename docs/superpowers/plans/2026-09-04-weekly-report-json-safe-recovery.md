# Weekly Report JSON Safe Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover weekly-report model responses only when their JSON content is complete and they are missing no more than three trailing object or array delimiters.

**Architecture:** A focused `weekly-report/model-json.js` module normalizes the existing object/text/content-block response forms, scans the JSON text without modifying existing characters, and returns both the parsed value and an optional normalization record. `Paper Section Writer` consumes that result, emits a trace event for safe completion, and always runs its existing schema and evidence validation afterward.

**Tech Stack:** Node.js 20+ ECMAScript modules and the built-in `node:test` runner.

**Spec:** `docs/superpowers/specs/2026-09-04-local-service-watchdog-json-recovery-design.md`

## Global Constraints

- Do not change recommendation scope, weekly-report selection, scoring, or quality-gate rules.
- Never repair an unterminated string, dangling escape, mismatched delimiter, missing value, or more than three trailing delimiters.
- Never delete or replace existing model-response characters; recovery may only append `}` or `]`.
- A recovered value must still pass the existing full paper-draft validation.
- Record recovery in Trace without counting it as a model repair attempt.
- Use only Node.js standard-library code and existing repository modules.

---

### Task 1: Add and test the safe model JSON parser

**Files:**
- Create: `weekly-report/model-json.js`
- Create: `test/weekly-report-model-json.test.js`

**Interfaces:**
- Produces `parseModelJsonObject(raw, { label = "Model", maxTrailingClosures = 3 } = {})`.
- Returns `{ value, normalization }`, where `normalization` is `null` for an unchanged response or `{ kind: "trailing_delimiters_completed", addedDelimiters: string, count: number }` after safe recovery.
- Throws `TypeError` containing the supplied `label` when the input does not contain a recoverable JSON object.

- [ ] **Step 1: Write failing parser contract tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { parseModelJsonObject } from "../weekly-report/model-json.js";

test("parses an unchanged object without normalization", () => {
  assert.deepEqual(parseModelJsonObject('{"paperId":"2608.28194"}'), {
    value: { paperId: "2608.28194" },
    normalization: null
  });
});

test("completes only missing trailing delimiters", () => {
  const result = parseModelJsonObject('{"paperId":"2608.28194","readingValue":{"evidenceBoundary":{"text":"完整"}}');
  assert.equal(result.value.readingValue.evidenceBoundary.text, "完整");
  assert.deepEqual(result.normalization, {
    kind: "trailing_delimiters_completed",
    addedDelimiters: "}",
    count: 1
  });
});

for (const malformed of [
  '{"paperId":"2608.28194","text":"未结束',
  '{"paperId":"2608.28194","value":',
  '{"paperId":"2608.28194"]',
  '[[[[{"paperId":"2608.28194"}'
]) {
  test(`does not guess truncated JSON: ${malformed.slice(0, 24)}`, () => {
    assert.throws(() => parseModelJsonObject(malformed), TypeError);
  });
}
```

- [ ] **Step 2: Run the parser tests and verify RED**

Run: `node --test test/weekly-report-model-json.test.js`

Expected: FAIL because `weekly-report/model-json.js` does not exist.

- [ ] **Step 3: Implement normalization, scanning, and guarded completion**

```js
const responseText = (raw) => {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw.text === "string") return raw.text;
  if (Array.isArray(raw?.content)) {
    return raw.content.filter((block) => block?.type === "text").map((block) => block.text || "").join("\n");
  }
  return "";
};

const scanDelimiters = (text) => {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" || character === "]") {
      const opener = stack.pop();
      if ((opener === "{" && character !== "}") || (opener === "[" && character !== "]") || !opener) {
        return { safe: false, stack: [] };
      }
    }
  }
  return { safe: !inString && !escaped, stack };
};
```

Implement `parseModelJsonObject` so it first accepts an already-structured object, strips one surrounding Markdown fence, starts at the first `{`, and attempts standard parsing. On failure, use `scanDelimiters`, reject an empty stack or a stack longer than `maxTrailingClosures`, append only the reverse matching delimiters, and require the completed text to pass `JSON.parse`. Inputs such as `{"value":` remain rejected because delimiter completion still does not produce valid JSON.

- [ ] **Step 4: Run focused parser tests and verify GREEN**

Run: `node --check weekly-report/model-json.js && node --test test/weekly-report-model-json.test.js`

Expected: syntax check succeeds and every parser test passes.

- [ ] **Step 5: Record the parser checkpoint**

Review only `weekly-report/model-json.js` and `test/weekly-report-model-json.test.js`; confirm there is no character deletion, replacement, heuristic content generation, or dependency addition before proceeding.

### Task 2: Integrate safe recovery into Paper Section Writer and Trace

**Files:**
- Modify: `weekly-report/report-writer.js`
- Modify: `test/weekly-report-paper-section-writer.test.js`

**Interfaces:**
- Consumes `parseModelJsonObject` from Task 1.
- Adds `normalization` to each Paper Section model-call record.
- Emits `paper_section_json_normalized` with `{ stage, scope, paperId, attemptType, addedDelimiters, count, validationPassed, message }`.
- Preserves the existing `repairAttempted` and `responseRepairAttempted` meanings.

- [ ] **Step 1: Write the failing GRAY-118 integration test**

```js
test("Paper Section safely closes a complete response without spending a model repair", async () => {
  const events = [];
  let calls = 0;
  const raw = JSON.stringify(validDraft()).slice(0, -1);
  const result = await runPaperSectionWriter({
    item,
    networkRetryDelayMs: 0,
    onEvent: async (event) => events.push(event),
    callModel: async () => { calls += 1; return raw; }
  });

  assert.equal(calls, 1);
  assert.equal(result.responseRepairAttempted, false);
  assert.equal(result.paperDraft.paperId, item.paper.id);
  assert.equal(result.calls[0].normalization.kind, "trailing_delimiters_completed");
  assert.equal(events.some((event) => (
    event.type === "paper_section_json_normalized"
    && event.addedDelimiters === "}"
    && event.validationPassed === true
  )), true);
});
```

Add a second integration test returning `JSON.stringify({ paperId: item.paper.id }).slice(0, -1)`. Assert that parsing is recovered but existing schema validation still triggers the existing content/response handling and never publishes that incomplete object.

- [ ] **Step 2: Run the focused writer tests and verify RED**

Run: `node --test test/weekly-report-paper-section-writer.test.js --test-name-pattern="safely closes|schema incomplete"`

Expected: FAIL because the writer does not expose normalization or emit the event.

- [ ] **Step 3: Replace the local parser with the shared parser**

Import `parseModelJsonObject` and replace `const parsedOutput = parseModelJson(rawOutput)` with:

```js
const parsed = parseModelJsonObject(rawOutput, { label: "Paper Section Writer" });
const parsedOutput = parsed.value;
normalization = parsed.normalization;
```

Initialize `normalization = null` beside `validation`, add it to the model-call record, and after validation emit:

```js
if (normalization) {
  await onEvent?.({
    type: "paper_section_json_normalized",
    stage: "write_paper_sections",
    scope: "paper",
    paperId,
    attemptType,
    addedDelimiters: normalization.addedDelimiters,
    count: normalization.count,
    validationPassed: validation.valid,
    message: "模型响应末尾缺少 JSON 闭合符，系统已补全并继续校验。"
  });
}
```

Remove only the writer-local `parseModelJson`; do not change validators, repair limits, prompts, or batch selection.

- [ ] **Step 4: Run writer and parser suites and verify GREEN**

Run: `node --test test/weekly-report-model-json.test.js test/weekly-report-paper-section-writer.test.js`

Expected: all tests pass, including existing malformed-string response-repair cases.

- [ ] **Step 5: Record the integration checkpoint**

Review the diff and confirm the GRAY-118 response uses one model call, unsafe truncation retains the existing response-format repair path, and recovered but schema-invalid content cannot publish.

### Task 3: Update the gray issue record and run regression verification

**Files:**
- Modify: `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`

**Interfaces:**
- Changes GRAY-118 status only after the focused and full tests pass.

- [ ] **Step 1: Run the weekly-report focused regression set**

Run: `node --test test/weekly-report-model-json.test.js test/weekly-report-paper-section-writer.test.js test/weekly-report-orchestrator.test.js test/weekly-report-trace-store.test.js`

Expected: all tests pass.

- [ ] **Step 2: Run repository syntax and full tests**

Run: `npm run check`

Expected: syntax checks and all tests pass.

- [ ] **Step 3: Update GRAY-118 with exact evidence**

Change GRAY-118 from “已定位，待用例和实现” to “防护已实现，待真实复核”, and append the exact focused test command and result count to its resolution text. Do not mark real-world verification complete until a live model response exercises the recovery path.

- [ ] **Step 4: Review the final JSON-recovery diff**

Run: `git diff --check -- weekly-report/model-json.js weekly-report/report-writer.js test/weekly-report-model-json.test.js test/weekly-report-paper-section-writer.test.js WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`

Expected: no whitespace errors.

