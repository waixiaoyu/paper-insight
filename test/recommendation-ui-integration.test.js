import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("frontend and backend share the domain-selected default query configuration", () => {
  assert.match(appSource, /from "\.\/query-defaults\.js"/);
  assert.match(serverSource, /from "\.\/public\/query-defaults\.js"/);
  assert.doesNotMatch(appSource, /const queryKeywordGroups\s*=\s*\[/);
  assert.doesNotMatch(serverSource, /const defaultQuery\s*=\s*`/);
  assert.match(appSource, /const scoringRulesVersion\s*=/);
  assert.match(appSource, /const readingListStepOrder\s*=/);
});

test("recommendation analysis uses the fixed three-request concurrency pool", () => {
  assert.match(appSource, /from "\.\/analysis-pool\.js"/);
  assert.match(appSource, /recommendationAnalysisConcurrency\s*=\s*3/);
  assert.match(appSource, /runConcurrentTasks\s*\(/);
  assert.match(appSource, /papers:\s*\[paper\]/);
  assert.match(appSource, /session\.failedPapers\s*=\s*outcome\.errors\.map/);
  assert.match(appSource, /retryingFailures\s*\?\s*\[\.\.\.session\.failedPapers\]/);
});

test("recommendation analysis errors offer a per-paper skip action in both status views", () => {
  assert.match(htmlSource, /id="taskSkipAnalysisPaper"[^>]*>跳过这篇论文并继续<\/button>/);
  assert.match(htmlSource, /id="skipAnalysisPaperButton"[^>]*>跳过这篇论文并继续<\/button>/);
  assert.match(appSource, /skipFailedAnalysisPaper\s*\(/);
  assert.match(appSource, /确认跳过论文/);
});

test("shared retry buttons keep a generic label for non-analysis failures", () => {
  assert.match(htmlSource, /id="taskRetry"[^>]*>重试当前操作<\/button>/);
  assert.match(htmlSource, /id="retryButton"[^>]*>重试当前操作<\/button>/);
});

test("failed-paper skip visibility does not depend on whether the error is retryable", () => {
  assert.match(appSource, /skipAnalysisPaperButton\.hidden\s*=\s*state\.taskLocked\s*\|\|\s*!currentFailedAnalysisPaper\(\)/);
  assert.match(appSource, /taskSkipAnalysisPaper\.hidden\s*=\s*state\.taskLocked\s*\|\|\s*!currentFailedAnalysisPaper\(\)/);
  assert.doesNotMatch(appSource, /skipAnalysisPaperButton\.hidden\s*=\s*action\s*!==\s*"retry"/);
  assert.doesNotMatch(appSource, /taskSkipAnalysisPaper\.hidden\s*=\s*action\s*!==\s*"retry"/);
});

test("closing a failed recommendation task exposes recovery controls on the main page", () => {
  assert.match(appSource, /function showPausedRecommendationAnalysis\s*\(/);
  assert.match(appSource, /taskClose\.addEventListener[\s\S]*?showPausedRecommendationAnalysis\(\)/);
  assert.match(appSource, /taskDialog\.addEventListener\("cancel"[\s\S]*?showPausedRecommendationAnalysis\(\)/);
});

test("skipping validates the API key before mutating the failed-paper queue", () => {
  const start = appSource.indexOf("async function skipCurrentRecommendationPaper()");
  const end = appSource.indexOf("elements.taskRetry.addEventListener", start);
  const functionSource = appSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.ok(functionSource.indexOf("ensureApiKey(") >= 0);
  assert.ok(functionSource.indexOf("ensureApiKey(") < functionSource.indexOf("skipFailedAnalysisPaper(session)"));
});

test("starting or resuming analysis immediately removes stale skip controls", () => {
  const progressStart = appSource.indexOf("function showProgressView(");
  const progressEnd = appSource.indexOf("function analysisErrorFromPayload", progressStart);
  const progressSource = appSource.slice(progressStart, progressEnd);
  const skipStart = appSource.indexOf("async function skipCurrentRecommendationPaper()");
  const skipEnd = appSource.indexOf("elements.taskRetry.addEventListener", skipStart);
  const skipSource = appSource.slice(skipStart, skipEnd);

  assert.match(progressSource, /hideStatus\(\)/);
  assert.match(skipSource, /if\s*\(state\.taskLocked\)\s*\{\s*return false;/);
});
