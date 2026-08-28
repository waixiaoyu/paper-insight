import assert from "node:assert/strict";
import test from "node:test";

import { recommendationRetryAction } from "../public/recommendation-retry-policy.js";

test("candidate retrieval failures retry the current retrieval operation", () => {
  assert.equal(
    recommendationRetryAction({ stage: "candidate-fetch", error: new Error("arXiv temporarily unavailable") }),
    "fetch-candidates"
  );
});

test("analysis failures retry from the current paper when no user correction is needed", () => {
  assert.equal(
    recommendationRetryAction({ stage: "analysis", error: new SyntaxError("Unexpected end of JSON input") }),
    "resume-analysis"
  );
});

test("missing credentials and authentication failures do not offer a retry", () => {
  assert.equal(
    recommendationRetryAction({ stage: "analysis", error: { code: "LLM_NOT_CONFIGURED" } }),
    ""
  );
  assert.equal(
    recommendationRetryAction({ stage: "analysis", error: { status: 401 } }),
    ""
  );
});
