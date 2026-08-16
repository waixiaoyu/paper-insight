import assert from "node:assert/strict";
import test from "node:test";

import { callWeeklyReportAgentModel } from "../server.js";

test("weekly-report Anthropic requests disable GLM thinking for structured JSON output", async () => {
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
        model: "glm-5.2"
      }
    });

    assert.equal(output, "{\"status\":\"ok\"}");
    assert.deepEqual(requestPayload.thinking, { type: "disabled" });
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
            model: "glm-5.2"
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
