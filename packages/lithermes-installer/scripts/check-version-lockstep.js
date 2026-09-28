#!/usr/bin/env node
"use strict";

// Single-pass proof that every version-bearing file agrees with package.json.
//
// LitHermes threads its release version through registered tracked files, and those files
// are mutually referential: the tests assert README content and the READMEs document
// what the tests expect. A partial bump therefore fails in places that look unrelated
// to the file that was missed. This guard makes the disagreement itself the error.
//
// It never writes. Bumping stays a human edit to package.json plus each pinned site;
// this only proves they agree afterwards.

const { readFileSync } = require("node:fs");
const path = require("node:path");

const PACKAGE_ROOT = path.dirname(__dirname);
const DEFAULT_REPO_ROOT = path.dirname(path.dirname(PACKAGE_ROOT));

/** Package-name-qualified pins, the shape a stale leftover takes. */
const QUALIFIED_PIN = /(?:lithermes-ai|@litfamily\/lithermes|litfamily-lithermes)(?:@|-)(\d+\.\d+\.\d+)/gu;

/**
 * A version appears in two shapes. Test files embed it inside regular expressions with
 * escaped dots, and that form does not contain the plain literal at all — a substring
 * scan is blind to it, and so is a plain find-and-replace. The blindness is not
 * theoretical: one bump moved every literal site, left six escaped ones behind, and this
 * guard reported agreement while seven tests failed. Count both shapes.
 *
 * This file must not name a release version in prose; the registry-completeness test
 * treats any tracked file carrying the version as a site that has to be registered.
 */
function versionPatterns(version) {
  return [version, version.replace(/\./gu, "\\.")];
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function countVersion(haystack, version) {
  const [literal, escaped] = versionPatterns(version);
  // An escaped occurrence never contains the literal, so the two counts do not overlap.
  return countOccurrences(haystack, literal) + countOccurrences(haystack, escaped);
}

function parseRepoRoot(args) {
  if (args.length === 0) return DEFAULT_REPO_ROOT;
  if (args.length === 2 && args[0] === "--repo-root" && args[1] && !args[1].startsWith("--")) {
    return path.resolve(args[1]);
  }

  console.error("usage: check-version-lockstep.js [--repo-root <dir>]");
  return null;
}

function main(repoRoot) {
  const packageRoot = path.join(repoRoot, "packages", "lithermes-installer");
  const registry = require(path.join(packageRoot, "scripts", "version-manifests.json"));
  const version = require(path.join(packageRoot, "package.json")).version;

  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    console.error(`version lockstep: package.json version is not a plain release semver: ${version}`);
    return 2;
  }

  const failures = [];
  for (const entry of registry.manifests) {
    const absolute = path.join(repoRoot, entry.path);
    let text;
    try {
      text = readFileSync(absolute, "utf8");
    } catch (error) {
      failures.push(`${entry.path}: cannot read (${error.code ?? error.message})`);
      continue;
    }

    if (entry.kind === "history") {
      if (!text.includes(`## [${version}]`)) {
        failures.push(`${entry.path}: no release heading '## [${version}]' for the current version`);
      }
      continue;
    }

    if (entry.kind === "fixture") {
      const fixedVersions = [
        { version: entry.versionParts.join("."), occurrences: entry.occurrences },
        ...(entry.additionalFixedVersions ?? []).map((fixed) => ({
          version: fixed.versionParts.join("."),
          occurrences: fixed.occurrences
        }))
      ];
      for (const fixed of fixedVersions) {
        const actual = countVersion(text, fixed.version);
        if (actual !== fixed.occurrences) {
          failures.push(
            `${entry.path}: expected ${fixed.occurrences} fixed occurrence(s) of ${fixed.version}, found ${actual} — ${entry.why}`,
          );
        }
      }
      if (!fixedVersions.some((fixed) => fixed.version === version) && countVersion(text, version) !== 0) {
        failures.push(`${entry.path}: unclassified current release pin in fixed example`);
      }
      if (fixedVersions.some((fixed) => countVersion(text, fixed.version) !== fixed.occurrences)) continue;

      // A correct count is not proof: a file can carry the right number of new pins and a
      // stale qualified pin beside them. Reject any lithermes-ai@X.Y.Z that is not VERSION.
      for (const match of text.matchAll(QUALIFIED_PIN)) {
        if (match[1] !== version) {
          failures.push(`${entry.path}: stale pin '${match[0]}' alongside the current ${version}`);
        }
      }
      continue;
    }

    const expectedVersion = version;
    const actual = countVersion(text, expectedVersion);
    if (actual !== entry.occurrences) {
      failures.push(
        `${entry.path}: expected ${entry.occurrences} occurrence(s) of ${expectedVersion}, found ${actual} — ${entry.why}`,
      );
      continue;
    }
    // A correct count is not proof: a file can carry the right number of new pins and a
    // stale qualified pin beside them. Reject any lithermes-ai@X.Y.Z that is not VERSION.
    for (const match of text.matchAll(QUALIFIED_PIN)) {
      if (match[1] !== version) {
        failures.push(`${entry.path}: stale pin '${match[0]}' alongside the current ${version}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`version lockstep FAILED against package.json ${version}:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(`\n${failures.length} disagreement(s). Every pinned site must move in one pass.`);
    return 1;
  }

  console.log(`version lockstep OK: ${registry.manifests.length} manifests validate release ${version} and fixed examples`);
  return 0;
}

const repoRoot = parseRepoRoot(process.argv.slice(2));
process.exitCode = repoRoot === null ? 2 : main(repoRoot);
