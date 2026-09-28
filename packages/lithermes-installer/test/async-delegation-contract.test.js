const { readDocumentation } = require("./documentation-reader");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
function markdownFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith(".md") ? [file] : [];
  });
}

const shippedSurfaces = [
  path.join(repoRoot, "README.md"),
  path.join(repoRoot, "README_Ko-KR.md"),
  path.join(repoRoot, "RELEASE_CHECKLIST.md"),
  path.join(repoRoot, "docs", "guide.md"),
  path.join(repoRoot, "docs", "guide.ko.md"),
  path.join(packageRoot, "README.md"),
  path.join(packageRoot, "README_Ko-KR.md"),
  path.join(pluginRoot, "core.py"),
  ...markdownFiles(pluginRoot),
];
const surfaces = [
  path.join(repoRoot, "README.md"),
  path.join(pluginRoot, "skills", "refactor", "SKILL.md"),
  path.join(pluginRoot, "skills", "lit-init", "SKILL.md"),
  path.join(pluginRoot, "skills", "start-work", "SKILL.md"),
  path.join(pluginRoot, "skills", "visual-qa", "SKILL.md"),
  path.join(pluginRoot, "skills", "lit-plan", "SKILL.md"),
  path.join(pluginRoot, "skills", "debugging", "references", "methodology", "02-investigate.md"),
  path.join(pluginRoot, "skills", "lit-burnoff", "SKILL.md"),
];

test("no shipped payload or public guide claims a combined Hermes batch result", () => {
  for (const file of shippedSurfaces) {
    const text = readDocumentation(file);
    const label = path.relative(repoRoot, file);
    assert.doesNotMatch(
      text,
      /(?:one|a) consolidated (?:batch )?(?:completion|result)|consolidated (?:completion|result)[^\n]{0,100}(?:re-enters?|arrives?|returns?)|(?:batch returns|receive)[^\n]{0,100}(?:all )?child results? together|every child's result at once|(?:orchestrator|parent)[^\n]{0,80}blocks? until every child returns|after the batch returns|delegate_task[^a-z\n]{0,5}call[^\n]{0,100}returns? (?:their|all) results/i,
      `${label} claims a combined batch result`,
    );
  }
});

test("every shipped async delegation surface uses Hermes per-child receipt semantics", () => {
  for (const file of surfaces) {
    const text = readDocumentation(file);
    const label = path.relative(repoRoot, file);
    assert.doesNotMatch(
      text,
      /(?:re-enters?|arrives?|returns?|continue only when|wait for)[^\n]{0,100}consolidated (?:completion|result)|consolidated (?:completion|result)[^\n]{0,100}(?:re-enters?|arrives?|returns?)/i,
      `${label} claims a combined batch result`,
    );
    assert.match(text, /per-child (?:re-entry )?receipts/i, `${label} lacks per-child receipts`);
    assert.match(text, /no combined wait/i, `${label} lacks the host wait boundary`);
    assert.match(
      text,
      /parent[^\n]{0,180}(?:tracks?|record)[^\n]{0,180}(?:merge|batch completion|accounted)/i,
      `${label} lacks parent-owned batch accounting`,
    );
  }
});
