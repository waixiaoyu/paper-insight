import assert from "node:assert/strict";
import test from "node:test";

import {
  callLlmAnalyzer,
  callWeeklyReportAgentModel,
  normalizeWeeklyReportAgentMaxOutputTokens
} from "../server.js";

test("weekly-report output token configuration uses a finite bounded integer", () => {
  assert.equal(normalizeWeeklyReportAgentMaxOutputTokens(undefined), 65536);
  assert.equal(normalizeWeeklyReportAgentMaxOutputTokens("not-a-number"), 65536);
  assert.equal(normalizeWeeklyReportAgentMaxOutputTokens(8000), 12000);
  assert.equal(normalizeWeeklyReportAgentMaxOutputTokens(200000), 128000);
  assert.equal(normalizeWeeklyReportAgentMaxOutputTokens("70000.9"), 70000);
});

test("weekly-report GLM-5.3 keeps the existing Anthropic request contract", async () => {
  const nativeFetch = globalThis.fetch;
  let requestPayload = null;

  try {
    globalThis.fetch = async (_input, init = {}) => {
      requestPayload = JSON.parse(init.body);
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "{\"status\":\"ok\"}" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 20 }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const output = await callWeeklyReportAgentModel("{\"task\":\"test\"}", {
      role: "evidence_agent",
      llm: {
        apiKey: "test-key",
        endpoint: "https://example.test/api/anthropic/v1/messages",
        model: "glm-5.3"
      }
    });

    assert.equal(output, "{\"status\":\"ok\"}");
    assert.deepEqual(requestPayload.thinking, { type: "disabled" });
    assert.equal(requestPayload.messages[0].role, "user");
    assert.match(requestPayload.system, /受约束组件/);
    assert.equal(requestPayload.max_tokens, 65536);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("recommendation analysis retries one truncated Anthropic JSON response and returns the completed result", async () => {
  const nativeFetch = globalThis.fetch;
  let calls = 0;
  const paper = {
    id: "2608.23104",
    title: "Molecular LLM Agents",
    authors: ["Test Author"],
    categories: ["cs.AI"],
    published: "2026-08-26T00:00:00Z",
    summary: "A test paper."
  };

  try {
    globalThis.fetch = async () => {
      calls += 1;
      const text = calls === 1
        ? "{\"recommendations\":[{\"id\":\"2608.23104\",\"tldr\":\"输出在这里中断"
        : JSON.stringify({
          recommendations: [{ id: "2608.23104", tldr: "重试后返回完整分析。" }]
        });
      return new Response(JSON.stringify({
        content: [{ type: "text", text }],
        stop_reason: calls === 1 ? "max_tokens" : "end_turn",
        usage: { input_tokens: 100, output_tokens: calls === 1 ? 12000 : 30 }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const result = await callLlmAnalyzer({
      query: "AI agent",
      papers: [paper],
      llm: {
        apiKey: "test-key",
        endpoint: "https://example.test/api/anthropic/v1/messages",
        model: "glm-5.3"
      }
    });

    assert.deepEqual(result, [{ id: "2608.23104", tldr: "重试后返回完整分析。" }]);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("weekly-report model rejects empty or max-token Anthropic responses as retryable transport failures", async () => {
  const nativeFetch = globalThis.fetch;

  try {
    for (const responsePayload of [
      {
        content: [],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 0 }
      },
      {
        content: [{ type: "text", text: "{\"evidenceCard\":" }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 100, output_tokens: 12000 }
      },
      {
        content: [{ type: "text", text: "{\"evidenceCard\":" }],
        choices: [{
          finish_reason: "length",
          message: { content: "{\"evidenceCard\":" }
        }],
        usage: { prompt_tokens: 100, completion_tokens: 12000 }
      }
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });

      await assert.rejects(
        () => callWeeklyReportAgentModel("{\"task\":\"test\"}", {
          role: "evidence_agent",
          llm: {
            apiKey: "test-key",
            endpoint: "https://example.test/api/anthropic/v1/messages",
            model: "glm-5.3"
          }
        }),
        (error) => (
          error.code === "READING_LIST_AGENT_RESPONSE_INCOMPLETE"
          && error.retryable === true
        )
      );
    }
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("weekly-report model classifies a fetch failure as a retryable call error", async () => {
  const nativeFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };

    await assert.rejects(
      () => callWeeklyReportAgentModel("{\"task\":\"test\"}", {
        role: "evidence_agent",
        llm: {
          apiKey: "test-key",
          endpoint: "https://example.test/api/anthropic/v1/messages",
          model: "glm-5.3"
        }
      }),
      (error) => (
        error.code === "READING_LIST_AGENT_CALL_FAILED"
        && error.retryable === true
        && /fetch failed/.test(error.message)
      )
    );
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("weekly-report model does not misclassify response parsing TypeErrors as network failures", async () => {
  const nativeFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => {
        throw new TypeError("response parser bug");
      }
    });

    await assert.rejects(
      () => callWeeklyReportAgentModel("{\"task\":\"test\"}", {
        role: "evidence_agent",
        llm: {
          apiKey: "test-key",
          endpoint: "https://example.test/api/anthropic/v1/messages",
          model: "glm-5.3"
        }
      }),
      (error) => (
        error instanceof TypeError
        && error.message === "response parser bug"
        && error.code === undefined
      )
    );
  } finally {
    globalThis.fetch = nativeFetch;
  }
});
