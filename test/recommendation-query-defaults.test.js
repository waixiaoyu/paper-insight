import assert from "node:assert/strict";
import { test } from "node:test";

const queryDefaults = await import("../public/query-defaults.js").catch(() => null);

const expectedDomainTerms = [
  "network",
  "wireless network",
  "mobile network",
  "telecommunication network",
  "5G",
  "6G",
  "wireless communication",
  "telecommunication",
  "telecom",
  "cellular network",
  "radio access network",
  "RAN",
  "O-RAN",
  "core network",
  "edge network",
  "cloud network",
  "multi-access edge computing",
  "network slicing",
  "SDN",
  "NFV",
  "private network",
  "IoT network",
  "satellite network",
  "optical network"
];

test("background-domain keywords are all selected by default", () => {
  assert.ok(queryDefaults, "query defaults module should exist");

  const selection = queryDefaults.defaultQuerySelection();
  const domain = queryDefaults.queryKeywordGroups.find((group) => group.id === "domain");

  assert.ok(domain);
  assert.equal(domain.terms.length, 24);
  assert.deepEqual(domain.terms.map(queryDefaults.queryTermValue), expectedDomainTerms);
  assert.equal(selection.domain.length, domain.terms.length);
  assert.deepEqual(selection.domain, domain.terms.map(queryDefaults.queryTermValue));
  assert.equal(queryDefaults.buildQueryFromSelection(selection), queryDefaults.defaultQuery);
});

test("the previous no-domain default is upgraded without overwriting custom queries", () => {
  assert.ok(queryDefaults, "query defaults module should exist");

  assert.equal(queryDefaults.shouldResetStoredQueryDefaults({
    storedVersion: "agentic-autonomy-no-domain-2026-06",
    savedQuery: queryDefaults.legacyNoDomainDefaultQuery
  }), true);
  assert.equal(queryDefaults.shouldResetStoredQueryDefaults({
    storedVersion: queryDefaults.queryDefaultsVersion,
    savedQuery: queryDefaults.legacyNoDomainDefaultQuery
  }), false);
  assert.equal(queryDefaults.shouldResetStoredQueryDefaults({
    storedVersion: "agentic-autonomy-no-domain-2026-06",
    savedQuery: '("custom telecom query")'
  }), false);
});

test("default query includes upper-layer Agent Harness signals and network AI application tasks", () => {
  assert.ok(queryDefaults, "query defaults module should exist");

  const selection = queryDefaults.defaultQuerySelection();

  [
    "agent harness",
    "agent loop",
    "tool orchestration",
    "agent memory",
    "multi-agent coordination",
    "agent evaluation",
    "agent observability",
    "agent recovery"
  ].forEach((term) => assert.ok(selection.ai.includes(term), `missing default AI term: ${term}`));

  [
    "network orchestration",
    "network management",
    "anomaly detection",
    "traffic prediction",
    "root cause analysis",
    "fault diagnosis",
    "alarm correlation",
    "service assurance",
    "security monitoring"
  ].forEach((term) => assert.ok(selection.task.includes(term), `missing default task term: ${term}`));

  ["transformer", "deep learning", "Bayesian optimization"].forEach((term) => {
    assert.equal(selection.ai.includes(term), false, `low-level generic term should stay opt-in: ${term}`);
  });
});

test("the prior network-domain default is migrated while a custom query is preserved", () => {
  assert.ok(queryDefaults, "query defaults module should exist");
  assert.equal(typeof queryDefaults.legacyNetworkDomainAllDefaultQuery, "string");

  assert.equal(queryDefaults.shouldResetStoredQueryDefaults({
    storedVersion: "network-domain-all-2026-08",
    savedQuery: queryDefaults.legacyNetworkDomainAllDefaultQuery
  }), true);
  assert.equal(queryDefaults.shouldResetStoredQueryDefaults({
    storedVersion: "network-domain-all-2026-08",
    savedQuery: '("my custom network agent query")'
  }), false);
});
