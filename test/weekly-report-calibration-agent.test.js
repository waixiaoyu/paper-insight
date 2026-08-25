import assert from "node:assert/strict";
import test from "node:test";
import {
  CalibrationAgentError,
  calibrateReviewBatch,
  validateCalibrationResponse
} from "../weekly-report/calibration-agent.js";
import {
  buildCalibrationPrompt,
  buildTargetedReviewPrompt
} from "../weekly-report/prompts.js";
import { calculateReviewRawScore } from "../weekly-report/review-agent.js";

const evidenceField = (summary, status = "supported") => ({
  summary,
  status,
  sources: status === "supported" ? [{
    anchor: "S1",
    section: "1 Main",
    excerpt: "BOUND_EXCERPT_MUST_NOT_ENTER_CALIBRATION"
  }] : []
});

const reviewItemFor = (paperId, scores = {
  scenarioProblemValue: 80,
  methodNovelty: 80,
  practicalValue: 70,
  evidence: 60
}) => ({
  paper: {
    id: paperId,
    title: "OLD_TITLE_MUST_NOT_ENTER_CALIBRATION",
    summary: "ABSTRACT_MUST_NOT_ENTER_CALIBRATION",
    score: 99
  },
  contextPacket: {
    paperId,
    inputText: "LONG_ORIGINAL_TEXT_MUST_NOT_ENTER_CALIBRATION",
    inputSections: [{ text: "LONG_SECTION_MUST_NOT_ENTER_CALIBRATION" }]
  },
  evidenceCard: {
    paperId,
    problem: evidenceField("Autonomous actions require safety controls."),
    method: evidenceField("The method validates actions before execution."),
    systemDesign: evidenceField("A separate system decomposition is absent.", "not_present"),
    experiments: evidenceField("The evaluation uses simulated failure scenarios."),
    results: evidenceField("Unsafe actions are reduced."),
    limitations: evidenceField("Production traffic is not evaluated."),
    affiliations: evidenceField("The authors are affiliated with Example University."),
    evidenceInsufficient: false,
    warnings: []
  },
  valueSignals: {
    paperId,
    signals: [{
      dimension: "evidence",
      claim: "The result is supported only by simulation.",
      evidenceRefs: ["results:0"],
      readerImplication: "Inspect the evaluation boundary.",
      adnImplication: {
        relevance: "transferable",
        angle: "safety",
        insight: "The mechanism may transfer to network agents.",
        limit: "There is no production evidence."
      },
      caveat: "Simulation-only evidence."
    }]
  },
  reviewResult: {
    paperId,
    evidenceValidation: { status: "pass", issues: [] },
    scores,
    scoreReason: "The method is useful but evidence is limited.",
    weakness: "No production evaluation.",
    uncertainty: "Operational generalization is unclear.",
    interestFit: "target_network_autonomy",
    interestReason: "The paper concerns autonomous network safety.",
    affiliations: ["示例大学"],
    affiliationEvidenceRefs: ["affiliations:0"],
    rawScore: calculateReviewRawScore(scores)
  }
});

const calibrationResultFor = (paperId, {
  status = "consistent",
  suspectedMisjudgments = [],
  readingTier = "worth_reading"
} = {}) => ({
  paperId,
  status,
  relativePosition: "Comparable to the middle of this weekly cohort.",
  suspectedMisjudgments,
  readingTier,
  calibrationReason: "The score is aligned with the supplied evidence and peer artifacts."
});

const calibrationResponseFor = (items, optionsByPaper = {}) => ({
  results: items.map((item) => calibrationResultFor(
    item.reviewResult.paperId,
    optionsByPaper[item.reviewResult.paperId]
  ))
});

test("Calibration prompt uses compact artifacts only and never asks the model to adjust scores", () => {
  const items = [reviewItemFor("2607.30001"), reviewItemFor("2607.30002")];
  const prompt = buildCalibrationPrompt({ items });
  const payload = JSON.parse(prompt);

  assert.equal(payload.task, "weekly_report_calibration");
  assert.equal(payload.papers.length, 2);
  assert.equal(payload.papers[0].review.rawScore, items[0].reviewResult.rawScore);
  assert.equal(payload.outputSchema.results[0].calibratedScore, undefined);
  assert.doesNotMatch(prompt, /BOUND_EXCERPT|LONG_ORIGINAL_TEXT|LONG_SECTION|ABSTRACT_MUST|OLD_TITLE_MUST/);
  assert.match(JSON.stringify(payload.rules), /must not change|must not return/i);
});

test("Calibration validation rejects direct score changes and unknown comparison papers", () => {
  const items = [reviewItemFor("2607.30001"), reviewItemFor("2607.30002")];
  const directScore = calibrationResponseFor(items);
  directScore.results[0].calibratedScore = 99;
  const scoreValidation = validateCalibrationResponse(directScore, { items, phase: "initial" });
  assert.equal(scoreValidation.valid, false);
  assert.equal(scoreValidation.issues.some((issue) => issue.code === "calibration_score_forbidden"), true);

  const unknownComparison = calibrationResponseFor(items, {
    "2607.30001": {
      status: "rereview_required",
      suspectedMisjudgments: [{
        dimension: "evidence",
        direction: "overrated",
        reason: "The evidence score appears high relative to the cohort.",
        comparisonPaperIds: ["2607.39999"]
      }]
    }
  });
  const comparisonValidation = validateCalibrationResponse(unknownComparison, { items, phase: "initial" });
  assert.equal(comparisonValidation.valid, false);
  assert.equal(comparisonValidation.issues.some((issue) => issue.code === "comparison_paper_unknown"), true);
});

test("Calibration status follows suspected misjudgments when the model returns a contradictory resolved status", () => {
  const items = [reviewItemFor("2607.30501"), reviewItemFor("2607.30502")];
  const suspicion = [{
    dimension: "evidence",
    direction: "overrated",
    reason: "The evidence is weaker than the comparison paper.",
    comparisonPaperIds: ["2607.30502"]
  }];

  const initialValidation = validateCalibrationResponse(calibrationResponseFor(items, {
    "2607.30501": {
      status: "consistent",
      suspectedMisjudgments: suspicion
    }
  }), { items, phase: "initial" });

  assert.equal(initialValidation.valid, true);
  assert.equal(initialValidation.results[0].status, "rereview_required");
  assert.deepEqual(initialValidation.normalizations, [{
    code: "calibration_status_inferred_from_suspicions",
    path: "results[0].status",
    paperId: "2607.30501",
    from: "consistent",
    to: "rereview_required"
  }]);

  const confirmationValidation = validateCalibrationResponse(calibrationResponseFor(items, {
    "2607.30501": {
      status: "repaired",
      suspectedMisjudgments: suspicion
    }
  }), { items, phase: "confirm" });

  assert.equal(confirmationValidation.valid, true);
  assert.equal(confirmationValidation.results[0].status, "unresolved");
  assert.deepEqual(confirmationValidation.normalizations, [{
    code: "calibration_status_inferred_from_suspicions",
    path: "results[0].status",
    paperId: "2607.30501",
    from: "repaired",
    to: "unresolved"
  }]);
});

test("A contradictory consistent Calibration result still triggers one targeted Review and records normalization", async () => {
  const items = [reviewItemFor("2607.30701"), reviewItemFor("2607.30702")];
  const events = [];
  const result = await calibrateReviewBatch(items, {
    networkRetryDelayMs: 0,
    onEvent: async (event) => events.push(event),
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      if (payload.task === "weekly_report_calibration") {
        return calibrationResponseFor(items, {
          "2607.30701": {
            status: "consistent",
            suspectedMisjudgments: [{
              dimension: "evidence",
              direction: "overrated",
              reason: "The evidence is weaker than the comparison paper.",
              comparisonPaperIds: ["2607.30702"]
            }]
          }
        });
      }
      if (payload.task === "weekly_report_targeted_rereview") {
        return {
          paperId: "2607.30701",
          dimensions: {
            evidence: { score: 55, reason: "The evidence is limited to simulation." }
          }
        };
      }
      return calibrationResponseFor(items, {
        "2607.30701": { status: "repaired" }
      });
    }
  });

  assert.equal(result.succeeded.length, 2);
  assert.equal(result.succeeded[0].reviewResult.scores.evidence, 55);
  assert.equal(events.filter((event) => event.type === "model_call_started").length, 3);
  assert.equal(events.some((event) => (
    event.type === "calibration_status_normalized"
    && event.paperId === "2607.30701"
    && event.from === "consistent"
    && event.to === "rereview_required"
  )), true);
});

test("Calibration suspicion triggers targeted Review for only the named dimension and server recomputes rawScore", async () => {
  const items = [reviewItemFor("2607.31001"), reviewItemFor("2607.31002")];
  const tasks = [];
  const result = await calibrateReviewBatch(items, {
    paperConcurrency: 2,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      tasks.push(payload);
      if (payload.task === "weekly_report_calibration") {
        return calibrationResponseFor(items, {
          "2607.31001": {
            status: "rereview_required",
            suspectedMisjudgments: [{
              dimension: "evidence",
              direction: "underrated",
              reason: "Its controlled evaluation is stronger than the initial score suggests.",
              comparisonPaperIds: ["2607.31002"]
            }]
          }
        });
      }
      if (payload.task === "weekly_report_targeted_rereview") {
        return {
          paperId: "2607.31001",
          dimensions: {
            evidence: {
              score: 75,
              reason: "The controlled comparisons justify a higher evidence score."
            }
          }
        };
      }
      const updatedItems = items.map((item) => (
        item.reviewResult.paperId === "2607.31001"
          ? {
            ...item,
            reviewResult: {
              ...item.reviewResult,
              scores: { ...item.reviewResult.scores, evidence: 75 }
            }
          }
          : item
      ));
      return calibrationResponseFor(updatedItems, {
        "2607.31001": { status: "repaired", readingTier: "must_read" }
      });
    }
  });

  assert.deepEqual(tasks.map((payload) => payload.task), [
    "weekly_report_calibration",
    "weekly_report_targeted_rereview",
    "weekly_report_calibration_confirm"
  ]);
  const targetedPrompt = JSON.stringify(tasks[1]);
  assert.match(targetedPrompt, /2607\.31001/);
  assert.doesNotMatch(targetedPrompt, /2607\.31002/);
  assert.deepEqual(Object.keys(tasks[1].requestedDimensions), ["evidence"]);
  const repaired = result.succeeded.find((item) => item.reviewResult.paperId === "2607.31001");
  assert.equal(repaired.reviewResult.scores.evidence, 75);
  assert.equal(repaired.reviewResult.scores.methodNovelty, 80);
  assert.equal(repaired.reviewResult.rawScore, calculateReviewRawScore(repaired.reviewResult.scores));
  assert.equal(repaired.calibrationResult.status, "repaired");
});

test("Calibration confirmation that remains suspicious marks the paper unresolved and excludes it", async () => {
  const items = [reviewItemFor("2607.32001"), reviewItemFor("2607.32002")];
  const events = [];
  const result = await calibrateReviewBatch(items, {
    networkRetryDelayMs: 0,
    onEvent: async (event) => events.push(event),
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      if (payload.task === "weekly_report_calibration") {
        return calibrationResponseFor(items, {
          "2607.32001": {
            status: "rereview_required",
            suspectedMisjudgments: [{
              dimension: "methodNovelty",
              direction: "overrated",
              reason: "The method is less novel than the peer evidence suggests.",
              comparisonPaperIds: ["2607.32002"]
            }]
          }
        });
      }
      if (payload.task === "weekly_report_targeted_rereview") {
        return {
          paperId: "2607.32001",
          dimensions: {
            methodNovelty: { score: 65, reason: "The mechanism largely combines known components." }
          }
        };
      }
      return calibrationResponseFor(items, {
        "2607.32001": {
          status: "unresolved",
          suspectedMisjudgments: [{
            dimension: "methodNovelty",
            direction: "overrated",
            reason: "The revised score is still inconsistent with the cohort.",
            comparisonPaperIds: ["2607.32002"]
          }]
        }
      });
    }
  });

  assert.deepEqual(result.succeeded.map((item) => item.reviewResult.paperId), ["2607.32002"]);
  assert.deepEqual(result.excluded.map((item) => item.reviewResult.paperId), ["2607.32001"]);
  assert.equal(result.excluded[0].error.code, "READING_LIST_CALIBRATION_UNRESOLVED");
  assert.equal(events.some((event) => event.type === "calibration_unresolved"), true);
});

test("Targeted Review cannot return an unrequested dimension", async () => {
  const items = [reviewItemFor("2607.33001"), reviewItemFor("2607.33002")];
  const result = await calibrateReviewBatch(items, {
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      if (payload.task === "weekly_report_calibration") {
        return calibrationResponseFor(items, {
          "2607.33001": {
            status: "rereview_required",
            suspectedMisjudgments: [{
              dimension: "evidence",
              direction: "overrated",
              reason: "The evidence appears overrated.",
              comparisonPaperIds: ["2607.33002"]
            }]
          }
        });
      }
      if (payload.task === "weekly_report_targeted_rereview_repair") {
        return {
          paperId: "2607.33001",
          dimensions: {
            evidence: { score: 55, reason: "Evidence is limited." },
            methodNovelty: { score: 10, reason: "This dimension was not requested." }
          }
        };
      }
      return {
        paperId: "2607.33001",
        dimensions: {
          evidence: { score: 55, reason: "Evidence is limited." },
          methodNovelty: { score: 10, reason: "This dimension was not requested." }
        }
      };
    }
  });

  assert.deepEqual(result.succeeded.map((item) => item.reviewResult.paperId), ["2607.33002"]);
  assert.equal(result.excluded[0].error.code, "READING_LIST_TARGETED_REVIEW_UNSUPPORTED");
});

test("Targeted Reviews use finite concurrency and stable paper order", async () => {
  const items = ["2607.34001", "2607.34002", "2607.34003"].map((id) => reviewItemFor(id));
  let active = 0;
  let maximumActive = 0;
  const result = await calibrateReviewBatch(items, {
    paperConcurrency: 2,
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      if (payload.task === "weekly_report_calibration") {
        return calibrationResponseFor(items, Object.fromEntries(items.map((item, index) => [
          item.reviewResult.paperId,
          {
            status: "rereview_required",
            suspectedMisjudgments: [{
              dimension: "evidence",
              direction: index % 2 ? "overrated" : "underrated",
              reason: "The evidence score needs a targeted check.",
              comparisonPaperIds: [items[(index + 1) % items.length].reviewResult.paperId]
            }]
          }
        ])));
      }
      if (payload.task === "weekly_report_targeted_rereview") {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, payload.paper.paperId.endsWith("1") ? 15 : 2));
        active -= 1;
        return {
          paperId: payload.paper.paperId,
          dimensions: {
            evidence: { score: 65, reason: "Targeted evidence reassessment." }
          }
        };
      }
      return calibrationResponseFor(items, Object.fromEntries(items.map((item) => [
        item.reviewResult.paperId,
        { status: "repaired" }
      ])));
    }
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(result.succeeded.map((item) => item.reviewResult.paperId), [
    "2607.34001",
    "2607.34002",
    "2607.34003"
  ]);
});

test("a previously rereviewed unresolved paper is omitted from confirmation", async () => {
  const items = ["2607.34501", "2607.34502", "2607.34503"].map((id) => reviewItemFor(id));
  let confirmationIds = [];
  const result = await calibrateReviewBatch(items, {
    rereviewedPaperIds: ["2607.34501"],
    networkRetryDelayMs: 0,
    callModel: async (prompt) => {
      const payload = JSON.parse(prompt);
      if (payload.task === "weekly_report_calibration") {
        return calibrationResponseFor(items, {
          "2607.34501": {
            status: "rereview_required",
            suspectedMisjudgments: [{
              dimension: "evidence",
              direction: "overrated",
              reason: "The score remains inconsistent after its prior review.",
              comparisonPaperIds: ["2607.34503"]
            }]
          },
          "2607.34502": {
            status: "rereview_required",
            suspectedMisjudgments: [{
              dimension: "methodNovelty",
              direction: "underrated",
              reason: "The method deserves one targeted reassessment.",
              comparisonPaperIds: ["2607.34503"]
            }]
          }
        });
      }
      if (payload.task === "weekly_report_targeted_rereview") {
        return {
          paperId: "2607.34502",
          dimensions: {
            methodNovelty: { score: 85, reason: "The mechanism contains a reusable contribution." }
          }
        };
      }
      confirmationIds = payload.papers.map((paper) => paper.paperId);
      return calibrationResponseFor(
        items.filter((item) => confirmationIds.includes(item.reviewResult.paperId)),
        { "2607.34502": { status: "repaired" } }
      );
    }
  });

  assert.deepEqual(confirmationIds, ["2607.34502", "2607.34503"]);
  assert.deepEqual(result.succeeded.map((item) => item.reviewResult.paperId), ["2607.34502", "2607.34503"]);
  assert.equal(result.excluded.some((item) => item.reviewResult.paperId === "2607.34501"), true);
});

test("Calibration refuses a batch above the configured 30-paper ceiling", async () => {
  const items = Array.from({ length: 31 }, (_, index) => reviewItemFor(
    `2607.${String(35000 + index).padStart(5, "0")}`
  ));

  await assert.rejects(
    () => calibrateReviewBatch(items, { callModel: async () => ({ results: [] }) }),
    (error) => (
      error instanceof CalibrationAgentError
      && error.code === "READING_LIST_CALIBRATION_BATCH_TOO_LARGE"
    )
  );
});

test("Targeted Review prompt contains only its target paper and requested dimensions", () => {
  const item = reviewItemFor("2607.36001");
  const prompt = buildTargetedReviewPrompt({
    item,
    suspectedMisjudgments: [{
      dimension: "evidence",
      direction: "overrated",
      reason: "Compared with 2607.36002, evidence appears weak.",
      comparisonPaperIds: ["2607.36002"]
    }]
  });

  assert.match(prompt, /2607\.36001/);
  assert.doesNotMatch(prompt, /2607\.36002|LONG_ORIGINAL_TEXT|ABSTRACT_MUST/);
});
