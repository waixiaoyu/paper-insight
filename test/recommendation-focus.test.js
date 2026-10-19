import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inferResearchFocus,
  isPreferredResearchFocus,
  researchFocusAdjustment,
  researchFocusPresentation
} from "../public/research-focus.js";

test("research focus separates Agent Harness, AI applications, network AI, foundation models, internals, and hardware", () => {
  const cases = [
    {
      expected: "agent_harness",
      paper: {
        title: "KairosAgent: Agentic Time Series Forecasting with Fused Semantic Reasoning",
        summary: "We propose KairosAgent, an agentic framework with an LLM reasoner and tool execution."
      }
    },
    {
      expected: "agent_harness",
      paper: {
        title: "A Reliable Agent Harness for Long-Running Coding Tasks",
        summary: "We study tool orchestration, memory, recovery, observability, and evaluation for autonomous agents."
      }
    },
    {
      expected: "network_ai",
      paper: {
        title: "Closed-Loop AI Control for O-RAN",
        summary: "A learning-based controller optimizes radio access network operation and service assurance."
      }
    },
    {
      expected: "ai_application",
      paper: {
        title: "Language Models for Automated Failure Attribution",
        summary: "The system applies language models to root-cause diagnosis and validates the workflow on incident data."
      }
    },
    {
      expected: "foundation_model",
      paper: {
        title: "Scaling Laws for General-Purpose Language Models",
        summary: "We study capabilities and evaluation of large language models across general reasoning tasks."
      }
    },
    {
      expected: "model_internals",
      paper: {
        title: "REAL-Q: Low-Bit Quantization for Large Language Models",
        summary: "The method optimizes weight quantization and token encoding for efficient inference."
      }
    },
    {
      expected: "hardware",
      paper: {
        title: "A 3D-Stacked Chiplet Accelerator for Transformer Inference",
        summary: "The accelerator uses HBM, custom RTL, and a new memory hierarchy."
      }
    }
  ];

  cases.forEach(({ paper, expected }) => {
    assert.equal(inferResearchFocus({ paper }).focus, expected, paper.title);
  });
});

test("a speculative networkUseCase does not relabel a generic model paper as network AI", () => {
  const result = inferResearchFocus({
    paper: {
      title: "Scaling Laws for General-Purpose Language Models",
      summary: "We study language-model scaling across general reasoning tasks."
    },
    analysis: {
      networkUseCase: "This might eventually be adapted to telecom network automation.",
      matchedKeywords: ["wireless network", "network automation", "6G"]
    }
  });

  assert.equal(result.focus, "foundation_model");
});

test("hardware used only as an evaluation platform does not change an Agent paper's focus", () => {
  const result = inferResearchFocus({
    paper: {
      title: "Reliable Tool Recovery for Long-Running AI Agents",
      primaryCategory: "cs.AI",
      categories: ["cs.AI"],
      summary: "The agent harness is evaluated on a GPU accelerator platform with tool-failure recovery tasks."
    }
  });

  assert.equal(result.focus, "agent_harness");
});

test("focus priorities prefer upper-layer systems without excluding strong foundation-model research", () => {
  assert.equal(researchFocusAdjustment("network_ai"), 6);
  assert.equal(researchFocusAdjustment("agent_harness"), 5);
  assert.equal(researchFocusAdjustment("ai_application"), 4);
  assert.equal(researchFocusAdjustment("foundation_model"), 1);
  assert.equal(researchFocusAdjustment("model_internals"), -4);
  assert.equal(researchFocusAdjustment("hardware"), 0);
  assert.equal(isPreferredResearchFocus("agent_harness"), true);
  assert.equal(isPreferredResearchFocus("foundation_model"), false);
  assert.equal(researchFocusPresentation("agent_harness").label, "Agent / Harness");
});

test("real candidate titles distinguish upper-layer agents and applications from lower-level kernel work", () => {
  const cases = [
    {
      expected: "agent_harness",
      paper: {
        title: "AtomCite: Verification and Correction of Supplied Page-Level Citations in Multi-Page Documents",
        summary: "We propose an agentic framework that checks each claim and applies a deterministic repair policy."
      }
    },
    {
      expected: "ai_application",
      paper: {
        title: "LEBGen: An LLM-Enhanced Bayesian Network Framework for Few-Shot Travel Survey Data Generation",
        summary: "The system generates synthetic survey records from a few-shot sample for transportation planning."
      }
    },
    {
      expected: "model_internals",
      paper: {
        title: "AdaExplore: Failure-Driven Adaptation and Diversity-Preserving Search for Efficient Kernel Generation",
        summary: "An LLM agent improves performance-critical Triton kernel code generation."
      }
    }
  ];

  cases.forEach(({ paper, expected }) => {
    assert.equal(inferResearchFocus({ paper }).focus, expected, paper.title);
  });
});
