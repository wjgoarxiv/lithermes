const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { findDirectNpmPublishCommands } = require("./documentation-commands");

const repoRoot = path.resolve(__dirname, "..", "..", "..");

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), "utf8");
}

test("plugin.yaml version matches package.json version", () => {
  const pkg = require(path.join(__dirname, "..", "package.json"));
  const pluginYaml = fs.readFileSync(
    path.join(__dirname, "..", "assets", "lithermes-plugin", "plugin.yaml"),
    "utf8",
  );
  const m = pluginYaml.match(/^version:\s*(.+)$/m);
  assert.ok(m, "plugin.yaml has no version field");
  assert.equal(
    m[1].trim(),
    pkg.version,
    `plugin.yaml version ${m[1].trim()} must equal package.json version ${pkg.version}`,
  );
});

test("package-lock version entries match package.json version", () => {
  const pkg = require(path.join(__dirname, "..", "package.json"));
  const lock = require(path.join(__dirname, "..", "package-lock.json"));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
});

test("RELEASE_CHECKLIST describes the actual 0.9.1 candidate scope and regressions", () => {
  const text = read("RELEASE_CHECKLIST.md");
  const start = text.indexOf("### 0.9.1 factual release scope");
  const end = text.indexOf("### 0.8.49 factual release scope", start);
  assert.ok(start >= 0 && end > start, "RELEASE_CHECKLIST must isolate the 0.9.1 scope");
  const scope = text.slice(start, end);
  for (const required of [
    "output-channel",
    "post_tool_call",
    "pre_llm_call",
    "machine-readable metadata",
    "A/B",
    "0.9.1",
    "Full Node",
    "Python",
    "forbidden-token",
    "real-surface",
    "dry-pack",
  ]) {
    assert.match(scope, new RegExp(required.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")), `0.9.1 scope missing ${required}`);
  }
  assert.match(scope, /required regressions/i);
  assert.doesNotMatch(scope, /patch-only alignment/i);
});

test("package metadata invokes the source-only prepublish guard without packing release tooling", () => {
  const packageRoot = path.join(__dirname, "..");
  const pkg = require(path.join(packageRoot, "package.json"));
  assert.equal(pkg.scripts.prepublishOnly, "node scripts/prepublish-guard.js");

  const { spawnSync } = require("node:child_process");
  const packed = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const paths = JSON.parse(packed.stdout).flatMap((entry) => entry.files || []).map((entry) => entry.path);
  assert.equal(paths.some((entry) => entry.startsWith("scripts/")), false);
  assert.equal(paths.some((entry) => entry.startsWith("test/")), false);
  assert.equal(paths.includes("scripts/prepublish-guard.js"), false);
});

test("packed complete-contract transcripts match plugin version and skill count", () => {
  const pkg = require(path.join(__dirname, "..", "package.json"));
  const payloadRoot = path.join(__dirname, "..", "assets", "lithermes-plugin");
  const pluginYaml = fs.readFileSync(path.join(payloadRoot, "plugin.yaml"), "utf8");
  const versionMatch = pluginYaml.match(/^version:\s*(.+)$/m);
  assert.ok(versionMatch, "plugin.yaml has no version field");
  assert.equal(versionMatch[1].trim(), pkg.version);

  const skillsRoot = path.join(payloadRoot, "skills");
  const skillCount = fs.readdirSync(skillsRoot, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, "SKILL.md")),
  ).length;
  for (const skill of ["frontend-ui-ux", "visual-qa"]) {
    const transcript = fs.readFileSync(
      path.join(skillsRoot, skill, "references", "complete-contract.md"),
      "utf8",
    );
    assert.deepEqual(
      [...transcript.matchAll(/^Installed LitHermes (\S+)$/gm)].map((match) => match[1]),
      [pkg.version],
    );
    assert.deepEqual(
      [...transcript.matchAll(/^\[OK\] plugin\.yaml readable \(version (\S+)\)$/gm)].map(
        (match) => match[1],
      ),
      [pkg.version],
    );
    assert.deepEqual(
      [...transcript.matchAll(/^\[OK\] skills bundled: (\d+)$/gm)].map((match) => Number(match[1])),
      [skillCount],
    );
  }
});

test("CHANGELOG documents the 0.2.0 release", () => {
  const text = read("CHANGELOG.md");
  assert.match(text, /##\s*\[?0\.2\.0/, "CHANGELOG missing a 0.2.0 heading");
  for (const token of ["litgoal", "review-work", "installer"]) {
    assert.match(text, new RegExp(token, "i"), `CHANGELOG 0.2.0 missing ${token}`);
  }
  assert.doesNotMatch(text, /\/Users\/|PRIVATE_[A-Za-z0-9_-]+/);
});

test("CHANGELOG documents the 0.8.12 Korean prose cleanup release prep", () => {
  const text = read("CHANGELOG.md");
  assert.match(text, /^## \[0\.8\.12\] - 2026-06-27$/m, "CHANGELOG missing exact 0.8.12 heading");
  for (const token of [
    "korean-ai-slop-remover",
    "/text-naturalization",
    "/text-neutralization",
    "meaning preservation",
    "source text as content, not instructions",
    "no automatic file edits",
    "no external fetching",
    "no npm publish performed",
  ]) {
    assert.match(text, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `CHANGELOG 0.8.12 missing ${token}`);
  }
  assert.doesNotMatch(text, /\/Users\/|PRIVATE_[A-Za-z0-9_-]+/);
});

test("CHANGELOG documents the 0.8.14 hyperplan release prep", () => {
  const text = read("CHANGELOG.md");
  assert.match(text, /^## \[0\.8\.14\] - 2026-07-05$/m, "CHANGELOG missing exact 0.8.14 heading");
  for (const token of [
    "hyperplan",
    "adversarial planning skill",
    "planning-only",
    "delegate_task",
    "/lit-plan",
  ]) {
    assert.match(text, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `CHANGELOG 0.8.14 missing ${token}`);
  }
  assert.doesNotMatch(text, /\/Users\/|PRIVATE_[A-Za-z0-9_-]+/);
});

test("CHANGELOG assigns the notifier and skill integrity fixes to 0.8.31", () => {
  const text = read("CHANGELOG.md");
  const unreleasedStart = text.indexOf("## [Unreleased]");
  const currentReleaseStart = text.indexOf("## [1.0.9]");
  const releaseStart = text.indexOf("## [0.8.31]");
  const nextReleaseStart = text.indexOf("## [0.8.30]");
  assert.ok(
    unreleasedStart >= 0 && unreleasedStart < currentReleaseStart && currentReleaseStart < releaseStart,
    "Unreleased and current release must precede 0.8.31",
  );
  const unreleased = text.slice(unreleasedStart, currentReleaseStart);
  const published = text.slice(releaseStart, nextReleaseStart);
  assert.doesNotMatch(unreleased, /update notice|skill\s+entrypoint|manifest SHA-256/i);
  assert.match(published, /update notice/i);
  assert.match(published, /24-hour atomic cache/i);
  assert.match(published, /skill\s+entrypoint/i);
  assert.match(published, /manifest/i);
  assert.match(published, /SHA-256/i);
  assert.match(published, /nonzero\s+exit/i);
});

test("CHANGELOG preserves the published UI/UX and visual-QA 0.8.32 history", () => {
  const text = read("CHANGELOG.md");
  const priorReleaseStart = text.indexOf("## [0.8.33]");
  const releaseStart = text.indexOf("## [0.8.32]");
  const nextReleaseStart = text.indexOf("## [0.8.31]");
  assert.ok(
    priorReleaseStart >= 0 && priorReleaseStart < releaseStart && releaseStart < nextReleaseStart,
    "0.8.32 must remain between 0.8.33 and 0.8.31",
  );
  const published = text.slice(releaseStart, nextReleaseStart);
  assert.doesNotMatch(published, /reference router|permission-state|BLOCKED/i);
  assert.match(published, /frontend-ui-ux/i);
  assert.match(published, /visual-qa/i);
  assert.match(published, /Design\s+Contract/i);
  assert.match(published, /Evidence\s+and\s+Review\s+receipts/i);
  assert.match(published, /PNG/i);
  assert.match(published, /terminal-grid/i);
  assert.match(published, /fail closed/i);
});

test("CHANGELOG assigns staged workflow, UI/UX, permission, and visual-QA work to 0.8.33", () => {
  const text = read("CHANGELOG.md");
  const priorReleaseStart = text.indexOf("## [0.8.34]");
  const releaseStart = text.indexOf("## [0.8.33]");
  const nextReleaseStart = text.indexOf("## [0.8.32]");
  assert.ok(
    priorReleaseStart >= 0 && priorReleaseStart < releaseStart && releaseStart < nextReleaseStart,
    "0.8.33 must remain between 0.8.34 and 0.8.32",
  );
  const published = text.slice(releaseStart, nextReleaseStart);
  for (const required of [
    "rules engine",
    "structural-search",
    "on_session_start",
    "post_tool_call",
    "session-scoped",
    "attempt-scoped evidence",
    "18-row",
    "read-only",
    "reference router",
    "permission",
    "BLOCKED",
    "FAIL",
  ]) {
    assert.match(published, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `CHANGELOG 0.8.33 missing ${required}`);
  }
});

test("CHANGELOG assigns beta schemas, material evidence, and bounded context to 0.8.34", () => {
  const text = read("CHANGELOG.md");
  const priorReleaseStart = text.indexOf("## [0.8.35]");
  const releaseStart = text.indexOf("## [0.8.34]");
  const nextReleaseStart = text.indexOf("## [0.8.33]");
  assert.ok(
    priorReleaseStart >= 0 && priorReleaseStart < releaseStart && releaseStart < nextReleaseStart,
    "0.8.34 must sit between 0.8.35 and 0.8.33",
  );
  const published = text.slice(releaseStart, nextReleaseStart);
  for (const required of [
    "v1beta1",
    "material evidence",
    "authorized-root",
    "SHA-256",
    "v1alpha1",
    "3840",
    "lazy references",
    "doctor",
    "bytecode",
    "fail closed",
  ]) {
    assert.match(published, new RegExp(required, "i"), `CHANGELOG 0.8.34 missing ${required}`);
  }
});

test("CHANGELOG assigns the canonical frontend corpus and semantic families to 0.8.35", () => {
  const changelog = read("CHANGELOG.md");
  const release = changelog.slice(changelog.indexOf("## [0.8.35]"), changelog.indexOf("## [0.8.34]"));
  for (const required of [
    "exact frontend reference corpus",
    "canonical manifest",
    "autoresearch",
    "autoconference",
    "wikify",
    "10, 7, and 5 nested modes",
    "bounded authority",
    "root-only conference delegation",
    "inert task-local wiki input",
    "single verified manifest pass",
    "pack projections",
    "nested mode SKILL.md",
    "first visible token",
    "removed researchers",
    "isolated QA target",
    "root-family mode",
    "UTF-8",
  ]) {
    assert.match(release, new RegExp(required, "i"), `CHANGELOG 0.8.35 missing ${required}`);
  }
  assert.doesNotMatch(release, /live (?:profile|events[^\n]*)[^\n]*(?:fingerprint|UNCHANGED|SHA-256)/i);
});

test("RELEASE_CHECKLIST enumerates the version surfaces and gates", () => {
  const text = read("RELEASE_CHECKLIST.md");
  for (const token of [
    "package.json",
    "plugin.yaml",
    "README",
    "scan-forbidden-tokens",
    "npm pack",
    "npm test",
  ]) {
    assert.match(text, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `RELEASE_CHECKLIST missing ${token}`);
  }
});

test("RELEASE_CHECKLIST records the factual 0.8.35 release scope", () => {
  const text = read("RELEASE_CHECKLIST.md");
  for (const required of [
    "0.8.35 factual release scope",
    "exact frontend corpus",
    "canonical",
    "autoresearch",
    "autoconference",
    "wikify",
    "10/7/5",
    "exact leading",
    "single-pass carrier",
    "nested-mode hash",
    "first-visible-token",
    "isolated-QA",
  ]) {
    assert.match(text, new RegExp(required, "i"), `RELEASE_CHECKLIST missing ${required}`);
  }
});

test("RELEASE_CHECKLIST requires isolated QA evidence without claiming a live event-log fingerprint", () => {
  const text = read("RELEASE_CHECKLIST.md");
  assert.match(text, /isolated HOME[\s\S]{0,200}HERMES_HOME/i);
  assert.match(text, /isolated profile check[^\n]*UNCHANGED/i);
  assert.match(text, /cleanup receipt[^\n]*remaining=0/i);
  assert.match(text, /live Hermes profile[^\n]*(?:must remain untouched|must not be mutated)/i);
  assert.doesNotMatch(text, /live Hermes event log[^\n]*UNCHANGED/i);
  assert.doesNotMatch(text, /before=.*after=.*SHA-256/i);
});

test("CI and manual publish bootstrap dependencies before complete test gates", () => {
  const workflows = [
    [".github/workflows/ci.yml", read(".github/workflows/ci.yml")],
    [".github/workflows/publish.yml", read(".github/workflows/publish.yml")],
  ];
  for (const [label, text] of workflows) {
    assert.match(
      text,
      /working-directory:\s*packages\/lithermes-installer/,
      `${label} must run package commands from the installer package`,
    );
    const install = text.indexOf("run: npm ci");
    const pythonInstall = text.indexOf("python -m pip install PyYAML==6.0.3");
    const schemaInstall = text.indexOf("jsonschema==4.26.0");
    const nodeTest = text.indexOf("npm test");
    assert.ok(install >= 0, `${label} must install locked Node dependencies with npm ci`);
    assert.ok(pythonInstall >= 0, `${label} must install the pinned Python test dependency`);
    assert.ok(schemaInstall >= 0, `${label} must install the pinned schema test dependency`);
    assert.ok(nodeTest >= 0, `${label} must run the Node test gate`);
    assert.ok(install < nodeTest, `${label} must run npm ci before npm test`);
    assert.ok(pythonInstall < nodeTest, `${label} must install PyYAML before npm test`);
    assert.ok(schemaInstall < nodeTest, `${label} must install jsonschema before npm test`);
    assert.match(text, /npm run test:python/, `${label} must run the isolated Python gate`);
  }
});

test("publish workflow stays manual-only and is never tag-triggered", () => {
  const text = read(".github/workflows/publish.yml");
  assert.match(text, /^\s{2}workflow_dispatch:\s*$/m);
  assert.doesNotMatch(text, /^\s{2}(?:push|pull_request):\s*$/m);
  assert.doesNotMatch(text, /^\s+tags(?:-ignore)?:\s*$/m);
});

test("publish workflow binds dispatch to one canonical reviewed main commit", () => {
  const text = read(".github/workflows/publish.yml");
  assert.match(text, /^\s{6}commit:\s*\n\s{8}description:.*full.*SHA.*\n\s{8}required:\s*true\s*$/mi);
  assert.match(text, /^\s{10}DISPATCH_REF:\s*\$\{\{ github\.ref \}\}\s*$/m);
  assert.match(text, /^\s{10}DISPATCH_SHA:\s*\$\{\{ github\.sha \}\}\s*$/m);
  assert.match(text, /^\s{10}REQUESTED_COMMIT:\s*\$\{\{ github\.event\.inputs\.commit \}\}\s*$/m);
  assert.match(text, /\[ "\$DISPATCH_REF" != "refs\/heads\/main" \]/);
  assert.match(text, /\[\[ "\$REQUESTED_COMMIT" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(text, /\[ "\$REQUESTED_COMMIT" != "\$DISPATCH_SHA" \]/);

  const lines = text.split("\n");
  let runIndent = null;
  for (const line of lines) {
    const indent = line.match(/^\s*/)[0].length;
    if (/^\s+run:\s*(?:\||>)?\s*$/.test(line)) {
      runIndent = indent;
      continue;
    }
    if (runIndent !== null && line.trim() && indent <= runIndent) runIndent = null;
    if (runIndent !== null) {
      assert.doesNotMatch(line, /\$\{\{/, `GitHub expressions must enter shell through env: ${line.trim()}`);
    }
  }
});

test("the release checklist retains the sealed workflow and guarded local path", () => {
  const capture = 'REVIEWED_SHA="$(git rev-parse --verify \'origin/main^{commit}\')"';
  const dispatch = 'gh workflow run publish.yml --repo wjgoarxiv/lithermes --ref main -f version=1.0.9 -f commit="$REVIEWED_SHA"';
  const docs = [
    ["RELEASE_CHECKLIST.md", read("RELEASE_CHECKLIST.md")],
  ];
  for (const [label, text] of docs) {
    const dispatchAt = text.indexOf(dispatch);
    assert.ok(dispatchAt >= 0, `${label} must expose the exact approved workflow dispatch`);
    const captureAt = text.indexOf(capture);
    assert.ok(captureAt >= 0 && captureAt < dispatchAt, `${label} must capture the reviewed origin/main commit before dispatch`);
    const prerequisites = text.slice(Math.max(0, dispatchAt - 1400), dispatchAt);
    assert.match(prerequisites, /HUMAN-ONLY/, `${label} must mark release dispatch HUMAN-ONLY`);
    assert.match(prerequisites, /remote HEAD/i, `${label} must check the remote HEAD before dispatch`);
    assert.match(prerequisites, /version[^\n]*1\.0\.9/i, `${label} must check the exact version before dispatch`);
    assert.match(prerequisites, /explicit(?:ly)?[^\n]*approv/i, `${label} must require explicit approval before dispatch`);
    assert.match(
      prerequisites,
      /^\s*git fetch --quiet origin refs\/heads\/main:refs\/remotes\/origin\/main$/m,
      `${label} must refresh origin/main explicitly before capture`,
    );
    assert.deepEqual(
      findDirectNpmPublishCommands(text),
      ["npm publish --access public"],
      `${label} must expose exactly one guarded local publication command`,
    );
    assert.match(text, /prepublishOnly/i, `${label} must name the source-only prepublish guard`);
    assert.match(text, /not byte-identical/i, `${label} must explain that npm repacks after preflight`);
    assert.match(text, /never blind-retry/i, `${label} must prohibit blind retries after a nonzero result`);
    assert.match(text, /published artifact/i, `${label} must require inspection of the registry artifact`);
    assert.match(text, /NPM_TOKEN/, `${label} must retain the workflow credential prerequisite`);
  }

  const workflow = read(".github/workflows/publish.yml");
  assert.equal(
    (workflow.match(/npm publish "\$SEALED_ARCHIVE" --access public/g) || []).length,
    1,
    "the tracked workflow must remain the sole sealed-artifact npm publication surface",
  );
});

test("0.8.39 release history records both human-only publication policies", () => {
  const changelog = read("CHANGELOG.md");
  const release = changelog.slice(changelog.indexOf("## [0.8.39]"), changelog.indexOf("## [0.8.38]"));
  for (const required of [
    "prepublishOnly",
    "source-only",
    "not byte-identical",
    "never blind-retry",
    "published artifact",
    "Linux",
    "descriptor-sealed",
    "exact-artifact",
    "NPM_TOKEN",
  ]) {
    assert.match(release, new RegExp(required, "i"), `CHANGELOG 0.8.39 missing ${required}`);
  }
});

test("publish workflow labels the stronger Linux exact-artifact policy without changing its seal", () => {
  const workflow = read(".github/workflows/publish.yml");
  assert.match(workflow, /stronger Linux descriptor-sealed exact-artifact option/i);
  assert.match(workflow, /requires[^\n]*NPM_TOKEN/i);
  assert.equal((workflow.match(/npm publish "\$SEALED_ARCHIVE" --access public/g) || []).length, 1);
});

test("real-surface QA fails closed on blocked rows", () => {
  const { exitCodeForSummary } = require(path.join(
    repoRoot,
    "packages/lithermes-installer/qa/negative-gate-matrix.js",
  ));
  assert.equal(exitCodeForSummary({ failed: 0, blocked: 0, profileUnchanged: true }), 0);
  assert.equal(exitCodeForSummary({ failed: 1, blocked: 0, profileUnchanged: true }), 1);
  assert.equal(exitCodeForSummary({ failed: 0, blocked: 1, profileUnchanged: true }), 1);
  assert.equal(exitCodeForSummary({ failed: 0, blocked: 0, profileUnchanged: false }), 1);
});

test("publish workflow enforces real-surface QA before npm publish", () => {
  const text = read(".github/workflows/publish.yml");
  const qa = text.indexOf("npm run qa:real-surface");
  const publish = text.indexOf('npm publish "$SEALED_ARCHIVE" --access public');
  assert.ok(qa >= 0, "publish workflow must run qa:real-surface");
  assert.ok(qa < publish, "qa:real-surface must run before npm publish");
});

test("publish workflow scans and publishes one exact sealed snapshot with failure cleanup", () => {
  const text = read(".github/workflows/publish.yml");
  const actualPack = text.indexOf('npm pack --ignore-scripts --json --pack-destination "$PACK_DIR"');
  const tarScan = text.indexOf('scan-forbidden-tokens.js --pack-tar "$ARCHIVE" --snapshot-out "$VALIDATED_ARCHIVE" --json');
  const cleanup = text.indexOf("trap cleanup EXIT");
  const openPublishFd = text.indexOf('exec {PUBLISH_FD}<"$VALIDATED_ARCHIVE"');
  const unlink = text.indexOf('rm -f "$VALIDATED_ARCHIVE"');
  const publishEndpoint = text.indexOf('PUBLISH_ENDPOINT="/proc/$$/fd/$PUBLISH_FD"');
  const sealedLink = text.indexOf('ln -s "$PUBLISH_ENDPOINT" "$SEALED_ARCHIVE"');
  const lockDirectory = text.indexOf('chmod 500 "$HANDOFF_DIR"');
  const digestCheck = text.indexOf('sha256sum "$PUBLISH_ENDPOINT"');
  const publish = text.indexOf('npm publish "$SEALED_ARCHIVE" --access public');
  const validatedOpens = text.match(/exec \{[A-Z_]+_FD\}<"\$VALIDATED_ARCHIVE"/g) || [];
  assert.ok(actualPack >= 0, "publish workflow must create the actual npm tarball");
  assert.ok(tarScan > actualPack, "publish workflow must byte-scan the created tarball");
  assert.ok(cleanup >= 0 && cleanup < actualPack, "publish workflow must register cleanup before packing");
  assert.deepEqual(validatedOpens, ['exec {PUBLISH_FD}<"$VALIDATED_ARCHIVE"'], "validated snapshot must have exactly one descriptor open");
  assert.ok(openPublishFd > tarScan && unlink > openPublishFd, "validated snapshot pathname must be unlinked after its sole descriptor opens");
  assert.ok(publishEndpoint > unlink, "publish endpoint must name the sole open descriptor after unlink");
  assert.ok(sealedLink > publishEndpoint && lockDirectory > sealedLink, "npm tar path must resolve only to the exact publish endpoint");
  assert.ok(digestCheck > lockDirectory && publish > digestCheck, "sealed bytes must match the scanner digest before publish");
  assert.doesNotMatch(text, /VERIFY_FD/, "a second verification descriptor would reintroduce an exact-artifact gap");
  assert.equal((text.match(/npm publish/g) || []).length, 1, "workflow must expose exactly one publish invocation");
  assert.doesNotMatch(text, /npm publish --access public/, "workflow must never repack by publishing the source directory");
  assert.doesNotMatch(text, /npm publish "\$ARCHIVE"/, "mutable pack pathname must never be published");
  assert.match(text, /cleanup\(\)[\s\S]*chmod 700 "\$HANDOFF_DIR"[\s\S]*rm -rf "\$PACK_DIR"/, "failure cleanup must unlock and remove the handoff directory");
  assert.doesNotMatch(text, /npm pack --dry-run/);
  assert.doesNotMatch(text, /scan-forbidden-tokens\.js --pack-json/);
});

test("QA scripts name measured isolated-profile state without presenting it as a live-profile fingerprint", () => {
  const surface = require(path.join(
    repoRoot,
    "packages/lithermes-installer/qa/lib/surface.js",
  ));
  const os = require("node:os");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-profile-fingerprint."));
  const events = path.join(home, "lithermes", "events.jsonl");
  fs.mkdirSync(path.dirname(events), { recursive: true });
  fs.writeFileSync(events, "alpha\n");
  try {
    const before = surface.isolatedProfileFingerprint({ HERMES_HOME: home });
    fs.writeFileSync(events, "bravo\n"); // same byte count, different bytes
    const after = surface.isolatedProfileFingerprint({ HERMES_HOME: home });
    const comparison = surface.compareIsolatedProfiles(before, after);
    assert.equal(comparison.unchanged, false);
    assert.match(comparison.detail, /MUTATED/);
    assert.match(comparison.detail, /isolated QA target events\.jsonl/);
    assert.doesNotMatch(comparison.detail, /\blive\b|operator|real profile/i);
    assert.equal(surface.liveProfileFingerprint, undefined);
    assert.equal(surface.compareLiveProfiles, undefined);

    const workspace = surface.scratch();
    const env = { HOME: "/live-home", HERMES_HOME: "/live-hermes" };
    const isolation = surface.enterIsolatedProfile(workspace, env);
    assert.notEqual(env.HOME, "/live-home");
    assert.notEqual(env.HERMES_HOME, "/live-hermes");
    assert.ok(env.HOME.startsWith(workspace.created[0]));
    assert.ok(env.HERMES_HOME.startsWith(workspace.created[0]));
    isolation.restore();
    assert.deepEqual(env, { HOME: "/live-home", HERMES_HOME: "/live-hermes" });
    workspace.removeAll();
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }

  for (const relative of [
    "packages/lithermes-installer/qa/negative-gate-matrix.js",
    "packages/lithermes-installer/qa/behavior-replacement-probe.js",
  ]) {
    const script = read(relative);
    assert.match(script, /enterIsolatedProfile/);
    assert.match(script, /compareIsolatedProfiles/);
    assert.match(script, /isolated profile check/);
    assert.match(script, /live\/operator Hermes profile[^\n]*not mutated by design[^\n]*not measured by isolated fingerprint/i);
    assert.doesNotMatch(script, /liveProfileFingerprint|compareLiveProfiles/);
  }

  const redactionProbe = read("packages/lithermes-installer/qa/lib/redaction_probe.py");
  assert.match(redactionProbe, /isolated_target_profile_fingerprint/);
  assert.match(redactionProbe, /isolated QA target profile unchanged/i);
  assert.match(redactionProbe, /live\/operator Hermes profile is not mutated by design/i);
  assert.match(redactionProbe, /not measured by isolated fingerprint/i);
  assert.match(redactionProbe, /profile_boundary/);
  assert.doesNotMatch(redactionProbe, /live_profile_fingerprint|probe leaves the live Hermes profile untouched/i);
});
