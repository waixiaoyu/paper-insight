import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(
  new URL(`../${path}`, import.meta.url),
  "utf8"
));

const minimumVersion = (range) => {
  const match = String(range || "").match(/^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u);
  assert.ok(match, `Expected a minimum Node range, received ${range}`);
  return match.slice(1).map((part) => Number(part || 0));
};

const compareVersions = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
};

test("declared Node minimum satisfies the locked direct Cheerio engine", async () => {
  const [packageJson, packageLock] = await Promise.all([
    readJson("package.json"),
    readJson("package-lock.json")
  ]);
  const declaredRange = packageJson.engines?.node;
  const lockedRootRange = packageLock.packages?.[""]?.engines?.node;
  const cheerioRange = packageLock.packages?.["node_modules/cheerio"]?.engines?.node;

  assert.equal(lockedRootRange, declaredRange);
  assert.ok(
    compareVersions(minimumVersion(declaredRange), minimumVersion(cheerioRange)) >= 0,
    `Project Node engine ${declaredRange} must satisfy locked Cheerio engine ${cheerioRange}`
  );
});
