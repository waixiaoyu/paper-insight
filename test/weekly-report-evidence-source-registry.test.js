import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvidenceSourceRegistry,
  materializeEvidenceSources
} from "../weekly-report/evidence-source-registry.js";

const contextPacketFor = (paperId = "2606.20621") => ({
  paperId: `https://arxiv.org/abs/${paperId}`,
  status: "available",
  qualityGate: { passed: true },
  inputSections: [
    {
      anchor: "S0",
      heading: "Paper metadata",
      kind: "metadata",
      text: "Paper metadata\n\nAlice Example, Example University"
    },
    {
      anchor: "S2",
      heading: "2 Method",
      kind: "methodOrTheory",
      text: "2 Method\n\nThe method improves F1 by 5.1 5.1 points. The loss is \\(L = x^2\\) and is not needed in the published prose.\n\nA second paragraph describes the comparison cohort."
    }
  ]
});

test("source registry emits stable paper-scoped IDs and retains exact contiguous raw text", () => {
  const contextPacket = contextPacketFor();
  const first = buildEvidenceSourceRegistry(contextPacket, { maxUnitChars: 90 });
  const second = buildEvidenceSourceRegistry(contextPacket, { maxUnitChars: 90 });

  assert.deepEqual(first.sections, second.sections);
  assert.match(first.sections[0].units[0].sourceId, /^2606\.20621:S0:U000$/);
  for (const section of first.sections) {
    const contextSection = contextPacket.inputSections.find((entry) => entry.anchor === section.anchor);
    for (const unit of section.units) {
      assert.equal(contextSection.text.includes(unit.rawText), true);
    }
  }
});

test("source registry derives readable text without making typography a gate", () => {
  const registry = buildEvidenceSourceRegistry(contextPacketFor(), { maxUnitChars: 500 });
  const methodUnit = registry.sections.find((section) => section.anchor === "S2").units[0];

  assert.match(methodUnit.rawText, /5\.1 5\.1/);
  assert.match(methodUnit.rawText, /\\\(/);
  assert.match(methodUnit.text, /5\.1 points/);
  assert.doesNotMatch(methodUnit.text, /5\.1 5\.1/);
  assert.doesNotMatch(methodUnit.text, /\\[()]/);
});

test("materialization replaces sourceId with server-owned source metadata and text", () => {
  const registry = buildEvidenceSourceRegistry(contextPacketFor(), { maxUnitChars: 500 });
  const unit = registry.sections.find((section) => section.anchor === "S2").units[0];
  const response = {
    evidenceCard: {
      method: { sources: [{ sourceId: unit.sourceId }] }
    }
  };

  const materialized = materializeEvidenceSources(response, registry);

  assert.deepEqual(materialized.evidenceCard.method.sources[0], {
    sourceId: unit.sourceId,
    anchor: "S2",
    section: "2 Method",
    excerpt: unit.text,
    rawExcerpt: unit.rawText
  });
  assert.equal(contextPacketFor().inputSections[1].text.includes(
    materialized.evidenceCard.method.sources[0].rawExcerpt
  ), true);
  assert.deepEqual(response.evidenceCard.method.sources[0], { sourceId: unit.sourceId });
});

test("materialization supports field-scoped patch responses", () => {
  const registry = buildEvidenceSourceRegistry(contextPacketFor(), { maxUnitChars: 500 });
  const unit = registry.sections.find((section) => section.anchor === "S2").units[0];

  const materialized = materializeEvidenceSources({
    paperId: "2606.20621",
    patch: {
      method: { sources: [{ sourceId: unit.sourceId }] }
    }
  }, registry);

  assert.equal(materialized.patch.method.sources[0].excerpt, unit.text);
  assert.equal(materialized.patch.method.sources[0].sourceId, unit.sourceId);
});

test("unknown and cross-paper source IDs fail closed", () => {
  const registry = buildEvidenceSourceRegistry(contextPacketFor());
  const responseFor = (sourceId) => ({
    evidenceCard: { method: { sources: [{ sourceId }] } }
  });

  assert.throws(
    () => materializeEvidenceSources(responseFor("2510.01359:S2:U000"), registry),
    /sourceId.*current paper|unknown sourceId/iu
  );
  assert.throws(
    () => materializeEvidenceSources(responseFor("2606.20621:S9:U999"), registry),
    /unknown sourceId/iu
  );
});

test("model-supplied text cannot override a sourceId", () => {
  const registry = buildEvidenceSourceRegistry(contextPacketFor());
  const unit = registry.sections[0].units[0];

  assert.throws(
    () => materializeEvidenceSources({
      evidenceCard: {
        method: {
          sources: [{ sourceId: unit.sourceId, excerpt: "model-authored text" }]
        }
      }
    }, registry),
    /sourceId.*cannot include/iu
  );
  assert.throws(
    () => materializeEvidenceSources({
      evidenceCard: {
        method: {
          sources: [{ sourceId: unit.sourceId, rawExcerpt: "model-authored raw text" }]
        }
      }
    }, registry),
    /sourceId.*cannot include.*rawExcerpt/iu
  );
});

test("realtime materialization requires sourceId while legacy artifact migration is explicit", () => {
  const registry = buildEvidenceSourceRegistry(contextPacketFor());
  const legacyResponse = {
    evidenceCard: {
      method: {
        sources: [{
          anchor: "S2",
          section: "2 Method",
          excerpt: "The method improves F1 by 5.1 points."
        }]
      }
    }
  };

  assert.throws(
    () => materializeEvidenceSources(legacyResponse, registry),
    /source.*must use sourceId/iu
  );
  assert.deepEqual(
    materializeEvidenceSources(legacyResponse, registry, { allowLegacySources: true }),
    legacyResponse
  );
});
