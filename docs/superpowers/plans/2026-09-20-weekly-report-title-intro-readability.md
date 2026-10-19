# Weekly Report Title and Introduction Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate academic, understandable weekly-report titles and introductions without forcing unrelated papers into one abstract theme.

**Architecture:** Keep the existing Editorial Plan and Head/Tail schemas for backward compatibility. Improve both prompt contracts, relax the title-length floor that currently encourages padding, and add a narrow deterministic rejection for question-style news headlines. Use prompt-level topic grouping and terminology rules instead of adding broad readability blockers that could interrupt publication.

**Tech Stack:** Node.js 20+, built-in `node:test`, existing weekly-report Editorial Agent and prompt builders.

**Spec:** `WEEKLY_REPORT_AGENT_LOOP_DEV.md`

## Global Constraints

- Reader-facing text uses direct, neutral technical Chinese.
- Do not add a broad subjective quality gate that can reject otherwise publishable reports.
- Reports may contain one to three real topic groups; do not invent a shared conclusion when the selected papers are heterogeneous.
- Titles remain academic descriptive phrases, not questions, news headlines, slogans, or lists of internal terminology.
- Existing factual-evidence validation and paper ordering remain unchanged.

---

### Task 1: Capture the Readability Contract in Tests

**Files:**
- Modify: `test/weekly-report-editorial-agent.test.js`

**Interfaces:**
- Consumes: `buildEditorialPlanPrompt`, `buildHeadTailPrompt`, `validateEditorialPlan`, `validateHeadTailDraft`.
- Produces: regression coverage for topic grouping, terminology translation, academic title style, and the revised title-length range.

- [x] **Step 1: Write failing prompt-contract tests**

Assert that both planning and Head/Tail prompts explicitly allow one to three topic groups, prohibit forced common themes, require common Chinese technical terms, and map model-registry `distributed artifacts` to publicly distributed model files rather than distributed-computing components.

- [x] **Step 2: Run the focused test and verify the new assertions fail**

Run: `node --test test/weekly-report-editorial-agent.test.js`

Expected: FAIL because the existing prompt does not contain the new readability contract.

- [x] **Step 3: Write failing title-validation tests**

Add one case proving a concise 12–17 character academic title is accepted and one case proving a question-style title such as `AI生成结果为什么需要独立验证？` is rejected with a targeted repair kind.

- [x] **Step 4: Run the focused test and verify both validation cases fail for the expected reasons**

Run: `node --test test/weekly-report-editorial-agent.test.js`

Expected: the concise title fails the old 18-character floor and the question title is not identified as news-style wording.

### Task 2: Implement the Minimal Prompt and Validator Changes

**Files:**
- Modify: `weekly-report/prompts.js`
- Modify: `weekly-report/editorial-agent.js`

**Interfaces:**
- Consumes: existing Editorial Plan and Head/Tail payload shapes.
- Produces: updated prompt rules and deterministic title validation without changing persisted artifact schemas.

- [x] **Step 1: Add shared title-length values to prompt contracts**

Change the accepted range to 12–32 Unicode characters and the preferred range to 14–24 characters in Editorial Plan and Head/Tail instructions and repair hints.

- [x] **Step 2: Add topic-organization and terminology rules**

Require one to three factual topic groups in `coreTheme` and `reportIntroduction` when necessary; prohibit a fabricated common conclusion; require first-use explanation of unfamiliar terms; prefer `模型文件` or `模型产物` over `模型构件`; distinguish public distribution from distributed computing.

- [x] **Step 3: Add the narrow academic-title validator**

Reject titles containing a Chinese question mark or question-headline construction and return repair kind `academic_descriptive_title`.

- [x] **Step 4: Run the focused tests until they pass**

Run: `node --test test/weekly-report-editorial-agent.test.js`

Expected: PASS.

### Task 3: Verify Compatibility

**Files:**
- Modify only if an existing expectation encodes the old title-length contract.

**Interfaces:**
- Consumes: the complete project test suite.
- Produces: evidence that existing evidence, repair, assembly, and publishing behavior remains intact.

- [x] **Step 1: Run weekly-report tests**

Run: `node --test test/weekly-report-*.test.js`

Expected: PASS.

- [x] **Step 2: Run the complete test suite**

Run: `npm test`

Expected: PASS with zero failures.

- [x] **Step 3: Inspect the final diff**

Confirm only the plan, prompt rules, title validator, and their regression tests changed; leave the six existing local evidence-regression output files untouched.
