import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseModelJsonObject } from "../weekly-report/model-json.js";

test("GRAY-118 both recorded model responses recover without changing existing content", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/weekly-report/gray-118-missing-closures.json", import.meta.url), "utf8"));
  assert.deepEqual(fixture.responses.map((entry) => entry.rawOutput.length), [3164, 3195]);
  for (const { rawOutput } of fixture.responses) {
    assert.throws(() => JSON.parse(rawOutput));
    const result = parseModelJsonObject(rawOutput);
    assert.equal(result.normalization.addedDelimiters, "}");
    assert.equal(result.value.paperId, fixture.paperId);
    assert.deepEqual(result.value, JSON.parse(rawOutput + "}"));
    assert.ok(result.value.readingValue.evidenceBoundary.text);
  }
});

test("model JSON keeps structured objects and text envelopes", () => {
  const value = { paperId: "2608.28194", text: "正文" };
  for (const raw of [value, JSON.stringify(value), { text: JSON.stringify(value) },
    { content: [{ type: "text", text: JSON.stringify(value) }] },
    '```json\n' + JSON.stringify(value) + '\n```']) {
    assert.deepEqual(parseModelJsonObject(raw), { value, normalization: null });
  }
});
test("model JSON completes missing trailing delimiters in reverse order", () => {
  for (const [raw, added] of [
    ['{"readingValue":{"evidenceBoundary":{"text":"完整"}}', '}'],
    ['{"refs":["method:0"', ']}'],
    ['{"value":{"refs":["method:0"', ']}}']
  ]) {
    const result = parseModelJsonObject(raw);
    assert.deepEqual(result.value, JSON.parse(raw + added));
    assert.deepEqual(result.normalization, {
      kind: "trailing_delimiters_completed", addedDelimiters: added, count: added.length,
      originalErrorCategory: "missing_trailing_delimiters"
    });
  }
});
for (const raw of [
  '{"text":"未结束', '{"text":"escape\\', '{"value":', '{"x":"y",',
  '{"x":"y"]', '{"x":"y"}}', '{"x":{"y":{"z":["a"',
  '{"value":123', '{"value":true',
  '[{"x":"y"}]', '[[[[{"x":"y"}', '{"x":"y"} broken',
  '{"x":oops,"y":"z"'
]) {
  test(`model JSON rejects unsafe recovery ${raw}`, () => {
    assert.throws(() => parseModelJsonObject(raw), /模型响应/);
  });
}
