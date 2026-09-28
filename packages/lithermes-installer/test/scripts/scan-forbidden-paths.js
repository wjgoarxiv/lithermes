#!/usr/bin/env node
// Path-SHAPE guard for the published package.
//
// Distinct from scan-forbidden-tokens.js, which inspects file CONTENT for brand
// tokens and has no notion of path shapes. This one asks a different question:
// does the tarball ship a file whose PATH says it is a test, fixture, or scratch
// artifact? Those are development surfaces; shipping them is a packaging defect.
//
// Every exception is listed in ALLOWED with a reason. An unexplained exception is
// how a guard turns into a green that cannot fail.
//
// Usage:
//   node test/scripts/scan-forbidden-paths.js            # runs npm pack --dry-run itself
//   node test/scripts/scan-forbidden-paths.js --pack-json <file>
//   node test/scripts/scan-forbidden-paths.js --paths a/b.py c/d.js
// Exit 0 = clean, 1 = at least one unallowlisted forbidden path.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..", "..");

// A path segment matching any of these marks a development-only artifact.
const FORBIDDEN_SEGMENTS = [
  "test",
  "tests",
  "spec",
  "specs",
  "__tests__",
  "fixture",
  "fixtures",
  "scratch",
  "scratchpad",
  "sandbox",
  "tmp",
  "temp",
];

// Filenames that are development artifacts wherever they sit.
const FORBIDDEN_FILE_PATTERNS = [
  /(^|[./-])test_[^/]*\.py$/i,
  /(^|[./-])[^/]*_test\.py$/i,
  /(^|[./-])[^/]*\.test\.(js|mjs|cjs|ts|tsx)$/i,
  /(^|[./-])[^/]*\.spec\.(js|mjs|cjs|ts|tsx)$/i,
  /(^|\/)scratch-[^/]*$/i,
  /\.orig$/i,
  /\.rej$/i,
  /\.bak$/i,
];

// Explicit, reasoned exceptions. Key = exact packed path.
const ALLOWED = new Map([
  [
    "assets/lithermes-plugin/vendor/scientific-visualization/tests/test_figure_export.py",
    "pinned upstream corpus shipped byte-exact; executed by " +
      "test/python/test_scientific_visualization_execution.py::test_canonical_upstream_python_tests_pass",
  ],
  [
    "assets/lithermes-plugin/vendor/scientific-visualization/tests/test_style_presets.py",
    "pinned upstream corpus shipped byte-exact; executed by " +
      "test/python/test_scientific_visualization_execution.py::test_canonical_upstream_python_tests_pass",
  ],
]);

function segmentsOf(entry) {
  return entry.split("/").filter(Boolean);
}

function violationFor(entry) {
  if (/^(?:(?:cover\.(?:png|webp)|generate_cover\.py|RELEASE_CHECKLIST\.md)$|docs\/assets\/)/i.test(entry)) {
    return "repository-only cover or release artifact";
  }
  const segments = segmentsOf(entry);
  // The final segment is the filename; only directories count for segment rules.
  for (const segment of segments.slice(0, -1)) {
    if (FORBIDDEN_SEGMENTS.includes(segment.toLowerCase())) {
      return `directory segment "${segment}"`;
    }
  }
  for (const pattern of FORBIDDEN_FILE_PATTERNS) {
    if (pattern.test(entry)) return `filename matches ${pattern}`;
  }
  return "";
}

let cachedEntries = null;

function packEntries() {
  // --ignore-scripts is load-bearing, not an optimization. `prepack` runs
  // `clean:payload`, which DELETES files under assets/. This guard only needs the
  // file listing, and running a destructive hook from a test that executes
  // concurrently with installer/doctor tests over the same tree is a real race —
  // it produced an intermittent `doctor exit=1` in roughly one full run in three.
  // The pack:dry GATE still runs prepack; only this read-only guard skips it.
  //
  // Cached because the listing cannot change within a single process run, and each
  // spawn is ~1s.
  if (cachedEntries) return cachedEntries;
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: packageRoot,
    encoding: "utf8",
    timeout: 180000,
  });
  if (result.status !== 0) {
    throw new Error(`npm pack --dry-run failed: ${result.stderr || result.stdout}`);
  }
  cachedEntries = parsePackJson(result.stdout);
  return cachedEntries;
}

function parsePackJson(raw) {
  const start = raw.indexOf("[");
  if (start === -1) throw new Error("no JSON array in npm pack output");
  const parsed = JSON.parse(raw.slice(start));
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  return (entry.files || []).map((file) => file.path);
}

function scanPaths(entries) {
  const hits = [];
  for (const entry of entries) {
    const reason = violationFor(entry);
    if (!reason) continue;
    if (ALLOWED.has(entry)) continue;
    hits.push({ path: entry, reason });
  }
  return hits;
}

function unusedAllowances(entries) {
  const present = new Set(entries);
  return [...ALLOWED.keys()].filter((entry) => !present.has(entry));
}

function runCli(argv) {
  let entries;
  const packIndex = argv.indexOf("--pack-json");
  const pathsIndex = argv.indexOf("--paths");
  if (packIndex !== -1) {
    entries = parsePackJson(fs.readFileSync(argv[packIndex + 1], "utf8"));
  } else if (pathsIndex !== -1) {
    entries = argv.slice(pathsIndex + 1).filter((value) => !value.startsWith("--"));
  } else {
    entries = packEntries();
  }

  const hits = scanPaths(entries);
  if (hits.length) {
    for (const hit of hits) {
      process.stderr.write(`forbidden package path: ${hit.path}  (${hit.reason})\n`);
    }
    process.stderr.write(
      `${hits.length} forbidden path(s). Exclude them via package.json "files", ` +
        "or add an ALLOWED entry with the reason it must ship.\n",
    );
    return 1;
  }
  // A stale allowance hides a guard that no longer guards anything.
  const stale = unusedAllowances(entries);
  if (stale.length && packIndex === -1 && pathsIndex === -1) {
    for (const entry of stale) {
      process.stderr.write(`stale ALLOWED entry (no longer packed): ${entry}\n`);
    }
    return 1;
  }
  return 0;
}

module.exports = {
  ALLOWED,
  FORBIDDEN_FILE_PATTERNS,
  FORBIDDEN_SEGMENTS,
  packEntries,
  parsePackJson,
  scanPaths,
  unusedAllowances,
  violationFor,
};

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}
