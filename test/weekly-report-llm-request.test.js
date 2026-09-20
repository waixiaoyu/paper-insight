import assert from "node:assert/strict";
import { getDefaultAutoSelectFamily } from "node:net";
import test from "node:test";

import {
  callLlmAnalyzer,
  callWeeklyReportAgentModel,
  createModelUsageTraceNameFactory,
  normalizeWeeklyReportAgentMaxOutputTokens
} from "../server.js";

test("Windows server startup disables Node network family auto-selection", {
  skip: process.platform !== "win32"
}, () => {
  assert.equal(getDefaultAutoSelectFamily(), false);
});

test("weekly-report output token configuration uses a finite bounded integer", () => {
  assert.equal(normalizeWeeklyReportAgentMaxOutputTokens(undefined), 65536);
  assert.equal(normalizeWeeklyReportAgentMaxOutputTokens("not-a-number"), 65536);
  assert.equal(normalizeWeeklyReportAgentMaxOutputTokens(8000), 12000);
  assert.equal(normalizeWeeklyReportAgentMaxOutputTokens(200000), 128000);
  assert.equal(normalizeWeeklyReportAgentMaxOutputTokens("70000.9"), 70000);
});

test("weekly-report GLM-5.3 uses low-effort thinking controls and parses Coding OpenAI streams", async () => {
  const nativeFetch = globalThis.fetch;
  let requestPayload = null;
  let reportedUsage = null;

  try {
    globalThis.fetch = async (_input, init = {}) => {
      requestPayload = JSON.parse(init.body);
      return new Response([
        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"检查\"},\"finish_reason\":null}]}",
        "",
        "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"status\\\":\\\"ok\\\"}\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":40,\"completion_tokens_details\":{\"reasoning_tokens\":0}}}",
        "",
        "data: [DONE]",
        ""
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    };

    const output = await callWeeklyReportAgentModel("{\"task\":\"test\"}", {
      role: "evidence_agent",
      onUsage: (usage) => {
        reportedUsage = usage;
      },
      llm: {
        apiKey: "test-key",
        endpoint: "https://example.test/api/coding/paas/v4/chat/completions",
        model: "glm-5.3"
      }
    });

    assert.equal(output, "{\"status\":\"ok\"}");
    assert.deepEqual(requestPayload.thinking, { type: "enabled" });
    assert.equal(requestPayload.reasoning_effort, "low");
    assert.equal(requestPayload.stream, true);
    assert.deepEqual(requestPayload.stream_options, { include_usage: true });
    assert.deepEqual(requestPayload.response_format, { type: "json_object" });
    assert.equal(requestPayload.messages[0].role, "system");
    assert.match(requestPayload.messages[0].content, /受约束组件/);
    assert.equal(requestPayload.max_tokens, 65536);
    assert.deepEqual(reportedUsage, {
      promptTokens: 100,
      completionTokens: 40,
      reasoningTokens: 0,
      finishReason: "stop"
    });
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("weekly-report defaults to the BigModel Coding OpenAI endpoint", async () => {
  const nativeFetch = globalThis.fetch;
  const endpointEnvKeys = [
    "GLM_CODING_OPENAI_API_URL",
    "GLM_CODING_ANTHROPIC_API_URL",
    "ANTHROPIC_BASE_URL",
    "GLM_CODING_API_URL",
    "LLM_API_URL"
  ];
  const previousEndpoints = Object.fromEntries(endpointEnvKeys.map((key) => [key, process.env[key]]));
  let requestEndpoint = "";
  let requestPayload = null;

  try {
    endpointEnvKeys.forEach((key) => delete process.env[key]);
    globalThis.fetch = async (input, init = {}) => {
      requestPayload = JSON.parse(init.body);
      requestEndpoint = String(input);
      return new Response(JSON.stringify({
        choices: [{
          message: { content: "{\"status\":\"ok\"}" },
          finish_reason: "stop"
        }]
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const output = await callWeeklyReportAgentModel("{\"task\":\"test\"}", {
      llm: { apiKey: "test-key" }
    });

    assert.equal(output, "{\"status\":\"ok\"}");
    assert.equal(
      requestEndpoint,
      "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions"
    );
  } finally {
    assert.equal(requestPayload.model, "glm-5.3");
    globalThis.fetch = nativeFetch;
    endpointEnvKeys.forEach((key) => {
      if (previousEndpoints[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEndpoints[key];
      }
    });
  }
});

test("weekly-report infers Anthropic protocol from supported environment endpoint overrides", async () => {
  const nativeFetch = globalThis.fetch;
  const endpointEnvKeys = [
    "LLM_API_URL",
    "GLM_CODING_OPENAI_API_URL",
    "GLM_CODING_API_URL",
    "GLM_CODING_ANTHROPIC_API_URL",
    "ANTHROPIC_BASE_URL"
  ];
  const previousEndpoints = Object.fromEntries(endpointEnvKeys.map((key) => [key, process.env[key]]));

  try {
    for (const scenario of [
      {
        key: "LLM_API_URL",
        value: "https://legacy.test/api/anthropic/v1/messages",
        expectedEndpoint: "https://legacy.test/api/anthropic/v1/messages"
      },
      {
        key: "GLM_CODING_ANTHROPIC_API_URL",
        value: "https://legacy.test/api/anthropic",
        expectedEndpoint: "https://legacy.test/api/anthropic/v1/messages"
      }
    ]) {
      endpointEnvKeys.forEach((key) => delete process.env[key]);
      process.env[scenario.key] = scenario.value;
      let requestEndpoint = "";
      let requestPayload = null;

      globalThis.fetch = async (input, init = {}) => {
        requestEndpoint = String(input);
        requestPayload = JSON.parse(init.body);
        return new Response(JSON.stringify({
          content: [{ type: "text", text: "{\"status\":\"ok\"}" }],
          stop_reason: "end_turn"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      };

      const output = await callWeeklyReportAgentModel("{\"task\":\"test\"}", {
        llm: { apiKey: "test-key", model: "glm-5.3-flash" }
      });

      assert.equal(output, "{\"status\":\"ok\"}");
      assert.equal(requestEndpoint, scenario.expectedEndpoint);
      assert.equal(requestPayload.messages[0].role, "user");
      assert.match(requestPayload.system, /受约束组件/);
      assert.equal(requestPayload.stream, undefined);
    }
  } finally {
    globalThis.fetch = nativeFetch;
    endpointEnvKeys.forEach((key) => {
      if (previousEndpoints[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEndpoints[key];
      }
    });
  }
});

test("weekly-report classifies interrupted or truncated OpenAI streams as retryable", async () => {
  const nativeFetch = globalThis.fetch;

  try {
    const scenarios = [
      {
        response: {
          ok: true,
          headers: { get: () => "text/event-stream" },
          text: async () => {
            throw new TypeError("terminated");
          }
        },
        code: "READING_LIST_AGENT_CALL_FAILED"
      },
      {
        response: new Response("data: {\"choices\":[", {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        }),
        code: "READING_LIST_AGENT_RESPONSE_INCOMPLETE"
      }
    ];

    for (const scenario of scenarios) {
      globalThis.fetch = async () => scenario.response;
      await assert.rejects(
        () => callWeeklyReportAgentModel("{\"task\":\"test\"}", {
          llm: {
            apiKey: "test-key",
            endpoint: "https://example.test/api/coding/paas/v4/chat/completions",
            model: "glm-5.3-flash"
          }
        }),
        (error) => error.code === scenario.code && error.retryable === true
      );
    }
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("weekly-report preserves an SSE body AbortError for administrator cancellation handling", async () => {
  const nativeFetch = globalThis.fetch;
  const controller = new AbortController();
  controller.abort();

  try {
    globalThis.fetch = async () => ({
      ok: true,
      headers: { get: () => "text/event-stream" },
      text: async () => {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        throw error;
      }
    });

    await assert.rejects(
      () => callWeeklyReportAgentModel("{\"task\":\"test\"}", {
        signal: controller.signal,
        llm: {
          apiKey: "test-key",
          endpoint: "https://example.test/api/coding/paas/v4/chat/completions",
          model: "glm-5.3-flash"
        }
      }),
      (error) => error.code === "READING_LIST_JOB_CANCELLED" && error.name === "AbortError"
    );
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("model usage Trace names remain unique across whole-task executions", () => {
  const firstExecution = createModelUsageTraceNameFactory();
  const secondExecution = createModelUsageTraceNameFactory();
  const firstNames = [firstExecution(), firstExecution()];
  const secondNames = [secondExecution(), secondExecution()];

  assert.notEqual(firstNames[0], firstNames[1]);
  assert.equal(new Set([...firstNames, ...secondNames]).size, 4);
  assert.match(firstNames[0], /^model-usage-[a-f0-9-]+-0000$/);
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

test("recommendation analysis requests the maximum configured model output capacity", async () => {
  const nativeFetch = globalThis.fetch;
  let requestPayload = null;
  const paper = {
    id: "2608.23105",
    title: "Bounded Recommendation Analysis",
    authors: ["Test Author"],
    categories: ["cs.AI"],
    published: "2026-08-27T00:00:00Z",
    summary: "A test paper."
  };

  try {
    globalThis.fetch = async (_input, init = {}) => {
      requestPayload = JSON.parse(init.body);
      return new Response(JSON.stringify({
        content: [{
          type: "text",
          text: JSON.stringify({ recommendations: [{ id: paper.id }] })
        }],
        stop_reason: "end_turn"
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    await callLlmAnalyzer({
      query: "AI agent",
      papers: [paper],
      llm: {
        apiKey: "test-key",
        endpoint: "https://example.test/api/anthropic/v1/messages",
        model: "glm-5.3"
      }
    });

    assert.equal(requestPayload.max_tokens, 128000);
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
