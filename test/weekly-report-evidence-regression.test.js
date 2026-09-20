import assert from "node:assert/strict";
import test from "node:test";

import {
  formatEvidenceRegressionFailure,
  runEvidenceRegression
} from "../scripts/run-weekly-report-evidence-regression.mjs";

const paperId = "2608.00001";

const contextPacket = {
  paperId,
  source: "arxiv-html",
  status: "available",
  qualityGate: { passed: true, reasons: [] },
  inputSections: []
};

const validEvidenceResponse = {
  evidenceCard: {
    paperId,
    problem: { summary: "The supplied source does not state a research problem.", status: "not_present", sources: [] },
    method: { summary: "The supplied source does not state a method.", status: "not_present", sources: [] },
    systemDesign: { summary: "The supplied source does not state a system design.", status: "not_present", sources: [] },
    experiments: { summary: "The supplied source does not state an experiment.", status: "not_present", sources: [] },
    results: { summary: "The supplied source does not state a result.", status: "not_present", sources: [] },
    limitations: { summary: "The supplied source does not state a limitation.", status: "not_present", sources: [] },
    affiliations: { summary: "The supplied source does not state an affiliation.", status: "not_present", sources: [] },
    evidenceInsufficient: true,
    warnings: []
  },
  valueSignals: { paperId, signals: [] }
};

test("Evidence 真实回归运行器只处理指定缓存论文，并输出脱敏的逐篇摘要", async () => {
  const run = await runEvidenceRegression({
    contextSnapshot: {
      eligible: [
        { paper: { id: paperId, title: "Included" }, contextPacket },
        { paper: { id: "2608.00002", title: "Not selected" }, contextPacket: { ...contextPacket, paperId: "2608.00002" } }
      ]
    },
    paperIds: [paperId],
    callModel: async () => validEvidenceResponse
  });

  assert.equal(run.items, 1);
  assert.deepEqual(run.succeeded, [{ paperId, callCount: 1 }]);
  assert.deepEqual(run.excluded, []);
  assert.deepEqual(run.processingFailed, []);
  assert.equal(run.calls[0].rawOutput, undefined);
  assert.equal(run.calls[0].paperId, paperId);
  assert.equal(run.calls[0].valid, true);
});

test("Evidence 真实回归运行器保留限长脱敏的结构错误诊断", async () => {
  const sensitiveValue = "regression-secret-value";
  const invalidResponse = `{"token":"${sensitiveValue}","message":"未结束\n请继续处理`;

  const run = await runEvidenceRegression({
    contextSnapshot: {
      eligible: [{ paper: { id: paperId, title: "Invalid" }, contextPacket }]
    },
    paperIds: [paperId],
    callModel: async () => invalidResponse
  });

  assert.equal(run.processingFailed.length, 1);
  assert.deepEqual(run.calls[0].issues.map(({ code, path }) => ({ code, path })), [
    { code: "invalid_json", path: "response" }
  ]);
  assert.match(run.calls[0].issues[0].detail, /JSON/);
  assert.equal(run.calls[0].responsePreview.length, invalidResponse.length);
  assert.match(run.calls[0].responsePreview.tail, /继续处理/);
  assert.doesNotMatch(JSON.stringify(run), new RegExp(sensitiveValue));
  assert.equal(run.calls[0].rawOutput, undefined);
});

test("Evidence 真实回归摘要保留脱敏的传输失败原因", async () => {
  const sensitiveValue = "transport-secret-value";
  const run = await runEvidenceRegression({
    contextSnapshot: {
      eligible: [{ paper: { id: paperId, title: "Transport failure" }, contextPacket }]
    },
    paperIds: [paperId],
    networkRetryDelayMs: 0,
    callModel: async () => {
      const error = new Error(`upstream reset authorization=Bearer ${sensitiveValue} retry denied`);
      error.code = "READING_LIST_AGENT_CALL_FAILED";
      error.stopReason = "connection_reset";
      throw error;
    }
  });

  assert.equal(run.processingFailed.length, 1);
  assert.equal(run.processingFailed[0].errorCode, "READING_LIST_AGENT_CALL_FAILED");
  assert.match(run.processingFailed[0].errorMessage, /upstream reset/);
  assert.equal(run.processingFailed[0].stopReason, "connection_reset");
  assert.match(run.calls[0].errorMessage, /upstream reset/);
  assert.equal(run.calls[0].stopReason, "connection_reset");
  assert.doesNotMatch(JSON.stringify(run), new RegExp(sensitiveValue));
});

test("Evidence 回归台账脱敏校验问题详情和顶层失败信息", async () => {
  const sensitiveValue = "validation-secret-value";
  const invalidResponse = structuredClone(validEvidenceResponse);
  invalidResponse.valueSignals.signals = [{
    dimension: "evidence",
    claim: "Claim",
    evidenceRefs: ["results:0"],
    readerImplication: "Reader implication",
    adnImplication: {
      relevance: "direct",
      angle: `token=${sensitiveValue}`,
      insight: "Insight",
      limit: "Limit"
    },
    caveat: "Caveat"
  }];

  const run = await runEvidenceRegression({
    contextSnapshot: {
      eligible: [{ paper: { id: paperId, title: "Invalid detail" }, contextPacket }]
    },
    paperIds: [paperId],
    callModel: async () => invalidResponse
  });

  assert.equal(run.processingFailed.length, 1);
  assert.doesNotMatch(JSON.stringify(run.calls), new RegExp(sensitiveValue));
  assert.doesNotMatch(
    formatEvidenceRegressionFailure(new Error(`authorization=Bearer ${sensitiveValue}`)),
    new RegExp(sensitiveValue)
  );
});
