const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const guard = require("./scripts/scan-forbidden-paths.js");

// The published tarball must not ship development surfaces. scan-forbidden-tokens
// inspects CONTENT for brand tokens and cannot see path shapes; this is the other
// half. Both are required — neither substitutes for the other.

test("the published package ships no development paths, covers, or release artifacts", () => {
  const entries = guard.packEntries();
  assert.ok(entries.length > 100, `pack listing looks wrong: ${entries.length} entries`);
  assert.ok(entries.includes("readme-assets/ignition-film.mp4"), "the npm README ignition link must target a packed file");
  const hits = guard.scanPaths(entries);
  assert.deepEqual(
    hits, [],
    `forbidden package paths:\n${hits.map((h) => `  ${h.path} (${h.reason})`).join("\n")}`,
  );
});

test("every ALLOWED exception is still packed and still carries a reason", () => {
  const entries = guard.packEntries();
  assert.deepEqual(
    guard.unusedAllowances(entries), [],
    "a stale ALLOWED entry means the guard is excusing a file that is no longer shipped",
  );
  for (const [entry, reason] of guard.ALLOWED) {
    assert.ok(reason && reason.length > 30, `ALLOWED ${entry} needs a real reason, got: ${reason}`);
    assert.ok(
      guard.violationFor(entry),
      `ALLOWED ${entry} is not actually a forbidden shape — remove the exception`,
    );
  }
});

test("the guard goes red on planted development paths (negative control)", () => {
  // A guard never observed failing is not evidence. These are the exact shapes an
  // independent reviewer demonstrated slipping past a content-only scanner.
  const planted = [
    "scripts/tests/leak_helper.py",
    "assets/lithermes-plugin/visual-qa/fixture/sample.json",
    "scripts/scratch-notes.txt",
    "src/thing.test.js",
    "assets/foo/test_probe.py",
    "src/patch.js.orig",
    "src/__tests__/helper.js",
    "assets/tmp/leftover.json",
    "cover.png",
    "cover.webp",
    "docs/assets/cover.webp",
    "docs/assets/cover.svg",
    "generate_cover.py",
    "RELEASE_CHECKLIST.md",
  ];
  const hits = guard.scanPaths(planted);
  assert.equal(hits.length, planted.length, `expected every planted path to be caught: ${JSON.stringify(hits)}`);
  for (const hit of hits) assert.ok(hit.reason, `${hit.path} caught without a reason`);
});

test("the guard leaves legitimate product paths alone (no false positives)", () => {
  const legitimate = [
    "src/cli.js",
    "src/lib/files.js",
    "bin/lithermes.js",
    "assets/lithermes-plugin/core.py",
    "assets/lithermes-plugin/rules/globmatch.py",
    "assets/lithermes-plugin/skills/litgoal/SKILL.md",
    "assets/lithermes-plugin/payload-version.json",
    "README.md",
    "readme-assets/cover.webp",
    "readme-assets/cover-motion.webp",
    "readme-assets/lithermes-wordmark.svg",
    "readme-assets/lithermes-clay-icon.png",
    "readme-assets/badge-version.svg",
    "readme-assets/badge-license.svg",
    // 'latest' contains 'test' as a substring but is not a path segment
    "assets/lithermes-plugin/skills/rules/latest/notes.md",
    // a component named 'contest' likewise
    "assets/contest/index.md",
    "assets/icons/native-icon.png",
  ];
  assert.deepEqual(guard.scanPaths(legitimate), []);
});

test("matrix row 18 measures path shapes, not brand tokens", () => {
  // The row was labelled "forbidden package paths" while running the brand-token
  // scanner, which has no notion of path shapes — a green that could not fail.
  const fs = require("node:fs");
  const matrix = fs.readFileSync(path.join(__dirname, "..", "qa", "negative-gate-matrix.js"), "utf8");
  const start = matrix.indexOf('name: "forbidden package paths"');
  assert.notEqual(start, -1, "the row must still exist");
  // The row runs to the next row header, or to end-of-array when it is last.
  const after = matrix.indexOf('name: "', start + 10);
  const body = matrix.slice(start, after === -1 ? matrix.length : after);
  assert.match(body, /pathScanner/, "row must invoke the path-shape guard");
  assert.doesNotMatch(
    body, /tokenScanner/,
    "row must not measure brand tokens while claiming to measure paths",
  );
  // pathScanner must resolve to the real script, not a stale alias.
  const surface = fs.readFileSync(path.join(__dirname, "..", "qa", "lib", "surface.js"), "utf8");
  assert.match(surface, /const pathScanner = .*scan-forbidden-paths\.js/);
  // and the content scan must survive as its own, truthfully-named row
  assert.match(matrix, /name: "forbidden brand tokens in packed files"/);
});
