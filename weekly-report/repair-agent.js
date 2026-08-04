import { validateHeadTailDraft } from "./editorial-agent.js";
import {
  buildHeadTailQaRepairPrompt,
  buildHeadTailQaRepairResponsePrompt,
  buildPaperSectionQaRepairPrompt,
  buildPaperSectionQaRepairResponsePrompt
} from "./prompts.js";
import { validatePaperDraft } from "./report-writer.js";

const cleanText = (value, maximum = 1200) => String(value || "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, maximum);

const normalizedPaperId = (value) => cleanText(value, 200).replace(/v\d+$/i, "");

const paperIdForItem = (item = {}) => normalizedPaperId(
  item?.reviewResult?.paperId
  || item?.contextPacket?.paperId
  || item?.paper?.id
  || ""
);

const validationIssue = (code, path, message) => ({
  code,
  path,
  message: cleanText(message, 800)
});

const parseModelJson = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  const text = String(value || "").trim();
  if (!text) {
    throw new Error("Targeted repair returned an empty response.");
  }
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(unfenced.slice(start, end + 1));
    }
    throw new Error("Targeted repair did not return a JSON object.");
  }
};

export class RepairStageError extends Error {
  constructor(message, {
    code = "READING_LIST_QA_REPAIR_FAILED",
    paperId = "",
    retryable = false,
    issues = [],
    cause
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "RepairStageError";
    this.code = code;
    this.stage = "repair_once";
    this.paperId = paperId;
    this.retryable = retryable;
    this.excludePaper = false;
    this.rejectJob = true;
    this.issues = issues;
  }
}

const abortError = () => {
  const error = new Error("Weekly report targeted repair was cancelled.");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
};

const waitForRetry = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (!milliseconds) {
    resolve();
    return;
  }
  if (signal?.aborted) {
    reject(abortError());
    return;
  }
  const timer = setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(abortError());
  }, { once: true });
});

const serializedError = (error, paperId = "") => ({
  code: String(error?.code || "READING_LIST_QA_REPAIR_FAILED"),
  message: String(error?.message || "Targeted repair failed."),
  stage: String(error?.stage || "repair_once"),
  paperId: String(error?.paperId || paperId),
  retryable: Boolean(error?.retryable),
  excludePaper: false,
  rejectJob: Boolean(error?.rejectJob),
  issues: Array.isArray(error?.issues) ? error.issues : []
});

const runTargetedRepairCall = async ({
  prompt,
  responsePrompt,
  role,
  paperId,
  validate,
  outputKey,
  callModel,
  signal,
  onCall,
  onEvent,
  networkRetryDelayMs
}) => {
  const calls = [];
  const invoke = async (currentPrompt, attemptType) => {
    if (signal?.aborted) {
      throw abortError();
    }
    const startedAt = Date.now();
    let rawOutput;
    try {
      rawOutput = await callModel(currentPrompt, {
        role,
        paperId,
        attemptType,
        signal
      });
    } catch (error) {
      const record = {
        role,
        paperId,
        attemptType,
        prompt: currentPrompt,
        rawOutput: null,
        normalizedOutput: null,
        validation: null,
        durationMs: Math.max(0, Date.now() - startedAt),
        error: serializedError(error, paperId)
      };
      calls.push(record);
      await onCall?.(record);
      error.modelCallFailed = true;
      throw error;
    }

    let validation;
    try {
      validation = validate(parseModelJson(rawOutput));
    } catch (error) {
      validation = {
        valid: false,
        issues: [validationIssue("invalid_json", "response", error.message)],
        [outputKey]: null
      };
    }
    const record = {
      role,
      paperId,
      attemptType,
      prompt: currentPrompt,
      rawOutput,
      normalizedOutput: validation[outputKey],
      validation: { valid: validation.valid, issues: validation.issues },
      durationMs: Math.max(0, Date.now() - startedAt),
      error: null
    };
    calls.push(record);
    await onCall?.(record);
    return validation;
  };

  const invokeWithNetworkRetry = async (currentPrompt, attemptType) => {
    try {
      return await invoke(currentPrompt, attemptType);
    } catch (error) {
      if (!error?.modelCallFailed || error?.name === "AbortError" || signal?.aborted) {
        throw error;
      }
      await onEvent?.({
        type: "network_retry",
        stage: "repair_once",
        scope: paperId ? "paper" : "report",
        paperId,
        waitMs: networkRetryDelayMs,
        error: serializedError(error, paperId)
      });
      await waitForRetry(networkRetryDelayMs, signal);
      try {
        return await invoke(currentPrompt, `${attemptType}_network_retry`);
      } catch (retryError) {
        if (retryError?.name === "AbortError") {
          throw retryError;
        }
        throw new RepairStageError("Targeted repair model call failed after one network retry.", {
          paperId,
          cause: retryError
        });
      }
    }
  };

  let validation = await invokeWithNetworkRetry(prompt, "content_repair");
  if (validation.valid) {
    return {
      artifact: validation[outputKey],
      responseRepairAttempted: false,
      calls
    };
  }

  await onEvent?.({
    type: "repair_response_correction_requested",
    stage: "repair_once",
    scope: paperId ? "paper" : "report",
    paperId,
    issues: validation.issues
  });
  validation = await invokeWithNetworkRetry(
    responsePrompt(validation.issues),
    "content_repair_response"
  );
  if (!validation.valid) {
    throw new RepairStageError("Targeted content remains invalid after its response correction.", {
      paperId,
      issues: validation.issues
    });
  }

  return {
    artifact: validation[outputKey],
    responseRepairAttempted: true,
    calls
  };
};

export const repairPaperSectionFromQa = async ({
  item,
  paperDraft,
  issues,
  callModel,
  signal,
  onCall,
  onEvent,
  networkRetryDelayMs = 50
} = {}) => {
  const paperId = paperIdForItem(item);
  if (!paperId || normalizedPaperId(paperDraft?.paperId) !== paperId) {
    throw new RepairStageError("Paper repair requires matching paper artifacts.", { paperId });
  }
  if (!Array.isArray(issues) || issues.length === 0) {
    throw new RepairStageError("Paper repair requires at least one normalized QA issue.", { paperId });
  }
  if (typeof callModel !== "function") {
    throw new TypeError("Paper repair callModel is required.");
  }

  const result = await runTargetedRepairCall({
    prompt: buildPaperSectionQaRepairPrompt({ item, paperDraft, issues }),
    responsePrompt: (responseIssues) => buildPaperSectionQaRepairResponsePrompt({
      item,
      paperDraft,
      issues,
      responseIssues
    }),
    role: "paper_section_writer",
    paperId,
    validate: (value) => validatePaperDraft(value, { item }),
    outputKey: "paperDraft",
    callModel,
    signal,
    onCall,
    onEvent,
    networkRetryDelayMs
  });
  return {
    paperDraft: result.artifact,
    responseRepairAttempted: result.responseRepairAttempted,
    calls: result.calls
  };
};

export const repairHeadTailFromQa = async ({
  editorialPlan,
  selectedItems,
  paperDrafts,
  headTailDraft,
  issues,
  callModel,
  signal,
  onCall,
  onEvent,
  networkRetryDelayMs = 50
} = {}) => {
  if (!Array.isArray(selectedItems) || selectedItems.length === 0
    || !headTailDraft || typeof headTailDraft !== "object"
    || !Array.isArray(issues) || issues.length === 0) {
    throw new RepairStageError("Head/Tail repair requires aligned report artifacts and QA issues.");
  }
  if (typeof callModel !== "function") {
    throw new TypeError("Head/Tail repair callModel is required.");
  }

  const promptOptions = {
    editorialPlan,
    selectedItems,
    paperDrafts,
    headTailDraft,
    issues
  };
  const result = await runTargetedRepairCall({
    prompt: buildHeadTailQaRepairPrompt(promptOptions),
    responsePrompt: (responseIssues) => buildHeadTailQaRepairResponsePrompt({
      ...promptOptions,
      responseIssues
    }),
    role: "editorial_head_tail_writer",
    paperId: "",
    validate: (value) => validateHeadTailDraft(value, {
      editorialPlan,
      selectedItems,
      paperDrafts
    }),
    outputKey: "headTailDraft",
    callModel,
    signal,
    onCall,
    onEvent,
    networkRetryDelayMs
  });
  return {
    headTailDraft: result.artifact,
    responseRepairAttempted: result.responseRepairAttempted,
    calls: result.calls
  };
};
