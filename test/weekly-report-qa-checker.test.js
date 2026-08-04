import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  QaCheckerError,
  runDeterministicQa
} from "../weekly-report/qa-checker.js";
import { READING_LIST_FOOTER_NOTE } from "../weekly-report/report-writer.js";

const fixtureUrl = (name) => new URL(`./fixtures/weekly-report/${name}`, import.meta.url);
const papers = JSON.parse(await readFile(fixtureUrl("papers.json"), "utf8"));
const markdown = await readFile(fixtureUrl("valid-summary-report.md"), "utf8");
const report = {
  date: "2026-07-29",
  month: "2026-07",
  weekOfMonth: 5
};

test("deterministic QA passes a structurally and factually consistent assembled report", () => {
  const result = runDeterministicQa({
    markdown,
    publishedPapers: papers,
    report,
    footerNote: READING_LIST_FOOTER_NOTE
  });

  assert.equal(result.status, "passed");
  assert.deepEqual(result.deterministicIssues, []);
  assert.equal(result.repairAttempted, false);
  assert.equal(result.validation.valid, true);
});

test("deterministic QA normalizes a paper score mismatch into a repair target", () => {
  const tampered = markdown.replace("阅读价值评分：86", "阅读价值评分：96");
  const result = runDeterministicQa({
    markdown: tampered,
    publishedPapers: papers,
    report,
    footerNote: READING_LIST_FOOTER_NOTE
  });

  assert.equal(result.status, "repair_required");
  const scoreIssue = result.deterministicIssues.find((issue) => issue.code === "published_score_mismatch");
  assert.equal(scoreIssue.scope, "paper");
  assert.equal(scoreIssue.paperId, "2607.11111");
  assert.equal(scoreIssue.repairTarget, "assemble");
  assert.equal(scoreIssue.severity, "high");
});

test("deterministic QA identifies internal process leakage without exposing a third publication state", () => {
  const tampered = markdown.replace(
    READING_LIST_FOOTER_NOTE,
    `本段错误泄漏 fallback 和 selectionReason。\n\n${READING_LIST_FOOTER_NOTE}`
  );
  const result = runDeterministicQa({
    markdown: tampered,
    publishedPapers: papers,
    report,
    footerNote: READING_LIST_FOOTER_NOTE
  });

  assert.equal(result.status, "repair_required");
  assert.equal(result.deterministicIssues.some((issue) => (
    issue.code === "internal_process_leak"
    && issue.scope === "report"
    && issue.repairTarget === "head_tail"
  )), true);
});

test("deterministic QA rejects instead of granting a second repair", () => {
  const tampered = markdown.replace("阅读价值评分：86", "阅读价值评分：96");
  const result = runDeterministicQa({
    markdown: tampered,
    publishedPapers: papers,
    report,
    footerNote: READING_LIST_FOOTER_NOTE,
    repairAttempted: true
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.repairAttempted, true);
});

test("deterministic QA rejects unusable invocation context with a structured error", () => {
  assert.throws(
    () => runDeterministicQa({ markdown: "", publishedPapers: [], report }),
    (error) => (
      error instanceof QaCheckerError
      && error.code === "READING_LIST_DETERMINISTIC_QA_INPUT_INVALID"
      && error.stage === "deterministic_qa"
      && error.rejectJob === true
    )
  );
});
