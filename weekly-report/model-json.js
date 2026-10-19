// Only syntactic closing delimiters may be inferred. Business validators still own completeness.
export const parseModelJsonObject = (raw, {
  label = "Model",
  maxTrailingClosures = 3,
  allowTrailingProse = false
} = {}) => {
  const invalid = () => new TypeError(`${label}：模型响应 JSON 格式不完整或有语法错误；仅允许补全末尾闭合符，不能补写缺失正文。`);
  const unwrapAnswer = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "answer" || typeof value.answer !== "string") return null;
    const parsed = parseModelJsonObject(value.answer, {
      label, maxTrailingClosures, allowTrailingProse
    });
    return {
      value: parsed.value,
      normalization: {
        kind: "answer_wrapper_unwrapped",
        innerNormalization: parsed.normalization
      }
    };
  };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const unwrapped = unwrapAnswer(raw);
    if (unwrapped) return unwrapped;
    if (raw.paperId || raw.oneSentenceTakeaway || raw.researchProblem || Array.isArray(raw.patches)) {
      return { value: raw, normalization: null };
    }
    if (typeof raw.text === "string") return parseModelJsonObject(raw.text, {
      label, maxTrailingClosures, allowTrailingProse
    });
    if (Array.isArray(raw.content)) return parseModelJsonObject(raw.content
      .filter((block) => block?.type === "text").map((block) => block.text || "").join("\n"), {
        label, maxTrailingClosures, allowTrailingProse
      });
    return { value: raw, normalization: null };
  }
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // Do not extract an object from a surrounding array or discard trailing malformed content.
  if (!text.startsWith("{")) throw invalid();
  try {
    const value = JSON.parse(text);
    return unwrapAnswer(value) || { value, normalization: null };
  } catch { /* Scan below. */ }
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") {
      if (stack.pop() !== (char === "}" ? "{" : "[")) throw invalid();
      if (!stack.length) {
        const trailing = text.slice(index + 1);
        if (!trailing.trim()) break;
        if (!allowTrailingProse || /[{}\[\]`]/u.test(trailing)) throw invalid();
        let value;
        try { value = JSON.parse(text.slice(0, index + 1)); } catch { throw invalid(); }
        return { value, normalization: {
          kind: "trailing_prose_ignored",
          ignoredCharacters: trailing.length,
          originalErrorCategory: "trailing_non_json_text"
        } };
      }
    }
  }
  // An un-delimited number/literal may itself have been cut short. Reject even if JSON.parse would accept it.
  if (inString || escaped || !stack.length || stack.length > Math.min(3, maxTrailingClosures)
    || !/["}\]]$/.test(text)) throw invalid();
  const addedDelimiters = stack.reverse().map((char) => char === "{" ? "}" : "]").join("");
  let value;
  try { value = JSON.parse(text + addedDelimiters); } catch { throw invalid(); }
  return { value, normalization: {
    kind: "trailing_delimiters_completed", addedDelimiters, count: addedDelimiters.length,
    originalErrorCategory: "missing_trailing_delimiters"
  } };
};
