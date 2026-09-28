"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const PACKAGE_ROOT = path.dirname(__dirname);
const REPO_ROOT = path.dirname(path.dirname(PACKAGE_ROOT));
const GUARD = path.join(PACKAGE_ROOT, "scripts", "check-version-lockstep.js");
const REGISTRY_PATH = path.join(PACKAGE_ROOT, "scripts", "version-manifests.json");
const REGISTRY = require("../scripts/version-manifests.json");
const VERSION = require("../package.json").version;

function runGuard(repoRoot) {
  const args = repoRoot ? [GUARD, "--repo-root", repoRoot] : [GUARD];
  return spawnSync(process.execPath, args, { cwd: PACKAGE_ROOT, encoding: "utf8" });
}

function guardInputPaths() {
  return [...new Set([
    path.relative(REPO_ROOT, REGISTRY_PATH),
    "packages/lithermes-installer/package.json",
    ...REGISTRY.manifests.map((entry) => entry.path),
  ])].sort();
}

function withVersionFixture(check) {
  const root = mkdtempSync(path.join(tmpdir(), "lithermes-version-fixture-"));
  try {
    for (const relativePath of guardInputPaths()) {
      const target = path.join(root, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(REPO_ROOT, relativePath), target);
    }
    return check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertLiveFileUnchanged(relativePath, originalBytes, phase) {
  assert.deepEqual(
    readFileSync(path.join(REPO_ROOT, relativePath)),
    originalBytes,
    `live ${relativePath} must remain byte-identical ${phase}`,
  );
}

test("the version lockstep guard accepts the repository as committed", () => {
  const result = runGuard();
  assert.equal(result.status, 0, `guard failed:\n${result.stdout}\n${result.stderr}`);
});

test("the guard fails and names the file when one pinned site drifts", () => withVersionFixture((root) => {
  // Drift only the temporary repository mirror; other test files may hash the live README concurrently.
  const relativePath = "README.md";
  const liveOriginal = readFileSync(path.join(REPO_ROOT, relativePath));
  const target = path.join(root, relativePath);
  const original = readFileSync(target, "utf8");
  assert.ok(original.includes(VERSION), "fixture precondition: README.md pins the version");
  try {
    writeFileSync(target, original.replace(VERSION, "0.0.0"), "utf8");
    assertLiveFileUnchanged(relativePath, liveOriginal, "while its fixture is drifted");
    const result = runGuard(root);
    assertLiveFileUnchanged(relativePath, liveOriginal, "after the drift check");
    assert.notEqual(result.status, 0, "guard must reject a drifted pin");
    assert.match(result.stdout + result.stderr, /README\.md/u, "guard must name the drifted file");
  } finally {
    writeFileSync(target, original, "utf8");
  }
  assert.equal(runGuard(root).status, 0, "guard must pass again once the file is restored");
}));

test("every tracked file carrying the version is registered", () => {
  const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(tracked.status, 0, "git must enumerate tracked files");
  const patterns = [VERSION, VERSION.replace(/\./gu, "\\.")];
  const found = tracked.stdout.split("\0").filter(Boolean).filter((file) => {
    const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
    return patterns.some((pattern) => text.includes(pattern));
  }).sort();
  const registry = require("../scripts/version-manifests.json");
  const registered = registry.manifests.map((entry) => entry.path).sort();
  assert.deepEqual(
    found.filter((file) => !registered.includes(file)),
    [],
    "a tracked file carries the version but is not in scripts/version-manifests.json",
  );
});

test("the registry declares a kind and an occurrence count for every entry", () => {
  const registry = require("../scripts/version-manifests.json");
  for (const entry of registry.manifests) {
    assert.ok(["pinned", "history", "derived", "fixture"].includes(entry.kind), `bad kind for ${entry.path}: ${entry.kind}`);
    if (entry.kind === "fixture") {
      assert.equal(entry.versionParts.length, 3);
      assert.ok(entry.versionParts.every((part) => Number.isSafeInteger(part) && part >= 0));
      for (const fixed of entry.additionalFixedVersions ?? []) {
        assert.equal(fixed.versionParts.length, 3);
        assert.ok(fixed.versionParts.every((part) => Number.isSafeInteger(part) && part >= 0));
        assert.ok(Number.isSafeInteger(fixed.occurrences) && fixed.occurrences > 0);
        assert.equal(typeof fixed.why, "string");
      }
    }
    assert.equal(typeof entry.occurrences, "number", `missing occurrences for ${entry.path}`);
    assert.ok(entry.occurrences > 0, `occurrences must be positive for ${entry.path}`);
    assert.equal(typeof entry.why, "string", `missing why for ${entry.path}`);
  }
});

test("the guard sees a version written inside a regular expression", () => {
  // Test files embed the version with escaped dots, a form that does not contain the
  // plain literal. A substring-only guard is blind to it, and so is a plain
  // find-and-replace: one bump moved every literal site, left six escaped ones behind,
  // and the guard reported agreement while seven tests failed. Drift must be caught.
  // Keep literal release versions out of this file's prose — the completeness test
  // treats any tracked file carrying the version as a site needing registration.
  withVersionFixture((root) => {
    const relativePath = "packages/lithermes-installer/test/readme.test.js";
    const liveOriginal = readFileSync(path.join(REPO_ROOT, relativePath));
    const target = path.join(root, relativePath);
    const original = readFileSync(target, "utf8");
    const escaped = VERSION.replace(/\./gu, "\\.");
    assert.ok(original.includes(escaped), "fixture precondition: the file pins an escaped version");
    try {
      writeFileSync(target, original.replace(escaped, "0\\.0\\.0"), "utf8");
      assertLiveFileUnchanged(relativePath, liveOriginal, "while its fixture is drifted");
      const result = runGuard(root);
      assertLiveFileUnchanged(relativePath, liveOriginal, "after the drift check");
      assert.notEqual(result.status, 0, "guard must reject a drifted escaped pin");
      assert.match(result.stdout + result.stderr, /readme\.test\.js/u);
    } finally {
      writeFileSync(target, original, "utf8");
    }
    assert.equal(runGuard(root).status, 0, "guard must pass again once restored");
  });
});


test("scoped and tarball stale pins fail even beside the correct version", () => withVersionFixture((root) => {
  const relativePath = "README.md";
  const liveOriginal = readFileSync(path.join(REPO_ROOT, relativePath));
  const target = path.join(root, relativePath);
  const original = readFileSync(target, "utf8");
  try {
    for (const pin of ["@litfamily/lithermes@98.76.54", "litfamily-lithermes-98.76.54.tgz", "lithermes-ai@98.76.54"]) {
      writeFileSync(target, `${original}\n${pin}\n`, "utf8");
      assertLiveFileUnchanged(relativePath, liveOriginal, "while a stale-pin fixture is drifted");
      const result = runGuard(root);
      assertLiveFileUnchanged(relativePath, liveOriginal, "after the stale-pin check");
      assert.notEqual(result.status, 0, pin);
      assert.match(result.stderr, /stale pin/);
    }
  } finally {
    writeFileSync(target, original, "utf8");
  }
  assert.equal(runGuard(root).status, 0);
}));


test("fixed example versions are classified and cannot drift unnoticed", () => withVersionFixture((root) => {
  const entry = REGISTRY.manifests.find((row) => row.additionalFixedVersions?.length > 0);
  assert.ok(entry, "native inventory must classify co-located fixed dependency versions");
  const liveOriginal = readFileSync(path.join(REPO_ROOT, entry.path));
  const target = path.join(root, entry.path);
  const original = readFileSync(target, "utf8");
  const fixedVersions = [
    { versionParts: entry.versionParts, occurrences: entry.occurrences },
    ...entry.additionalFixedVersions
  ];
  try {
    for (const fixed of fixedVersions) {
      const fixedVersion = fixed.versionParts.join(".");
      assert.ok(original.includes(fixedVersion), "fixture precondition: " + fixedVersion + " is present");
      writeFileSync(target, original.replace(fixedVersion, "98.76.54"), "utf8");
      assertLiveFileUnchanged(entry.path, liveOriginal, "while its fixed-example fixture is drifted");
      const result = runGuard(root);
      assertLiveFileUnchanged(entry.path, liveOriginal, "after the fixed-example drift check");
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(entry.path));
    }
  } finally {
    writeFileSync(target, original, "utf8");
  }
  assert.equal(runGuard(root).status, 0);
}));
