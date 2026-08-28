export function recommendationRetryAction({ stage, error } = {}) {
  const code = String(error?.code || "");
  const status = Number(error?.status || 0);

  if (code === "LLM_NOT_CONFIGURED" || status === 401 || status === 403) {
    return "";
  }

  if (stage === "candidate-fetch") {
    return "fetch-candidates";
  }

  return stage === "analysis" ? "resume-analysis" : "";
}
