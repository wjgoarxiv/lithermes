const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const matrix = path.join(packageRoot, "qa", "negative-gate-matrix.js");
const behaviors = path.join(packageRoot, "qa", "behavior-replacement-probe.js");
const redactionProbe = path.join(packageRoot, "qa", "lib", "redaction_probe.py");

function assertHonestProfileReceipts(output) {
  assert.match(output, /isolated profile check: UNCHANGED isolated QA target events\.jsonl/);
  assert.match(output, /live\/operator Hermes profile: not mutated by design \(not measured by isolated fingerprint\)/i);
  assert.doesNotMatch(output, /isolated profile check:[^\n]*live/i);
  assert.doesNotMatch(output, /live events\.jsonl bytes before=/i);
  assert.doesNotMatch(output, /probe leaves the live Hermes profile untouched/i);
}

test("negative gate matrix uses completion-eligible fixtures and isolated blockers", () => {
  const result = spawnSync(process.execPath, [matrix], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" },
    timeout: 600000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;

  assert.equal(result.status, 0, output);
  for (const row of [
    /01\. valid design contract[^\n]*observed=PASS[^\n]*PASS/,
    /03\. public evidence lacks host provenance[^\n]*observed=BLOCKED_CAPTURE_PROVENANCE_UNAVAILABLE[^\n]*PASS/,
    /07\. auth unavailable[^\n]*observed=BLOCKED_AUTH_UNAVAILABLE[^\n]*PASS/,
    /08\. renderer ownership unverified[^\n]*observed=BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED[^\n]*PASS/,
    /13\. unsafe test account[^\n]*observed=BLOCKED_TEST_ACCOUNT_UNSAFE[^\n]*PASS/,
  ]) {
    assert.match(output, row);
  }
  assert.match(output, /summary: rows=18 pass=18 blocked=0 mismatch=0/);
  assert.match(output, /temporary roots created=\d+ remaining=0/);
  assertHonestProfileReceipts(output);
});

test("named-behaviour QA distinguishes measured isolated state from the live-profile design boundary", () => {
  const result = spawnSync(process.execPath, [behaviors], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" },
    timeout: 600000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;

  assert.equal(result.status, 0, output);
  assert.match(output, /probe leaves the isolated QA target profile unchanged/);
  assert.match(output, /profile boundary: live\/operator Hermes profile is not mutated by design \(not measured by isolated fingerprint\)/i);
  for (const signal of [
    /WIKIFY KNOWLEDGE ADVERSARIAL/,
    /hardlink rejection[^\n]*observed=PASS/,
    /secret rejection[^\n]*observed=PASS/,
    /wrapper escaping[^\n]*observed=PASS/,
    /oversize rejection[^\n]*observed=PASS/,
    /duplicate capture[^\n]*observed=PASS/,
    /opt-out[^\n]*observed=PASS/,
    /workspace isolation[^\n]*observed=PASS/,
    /cleanup-bound probe[^\n]*observed=PASS/,
  ]) {
    assert.match(output, signal);
  }
  assert.doesNotMatch(output, /live\/operator Hermes profile is not mutated by design[^\n]*expected=[^\n]*observed=/i);
  assertHonestProfileReceipts(output);
});

test("standalone redaction probe isolates plugin import and registration side effects", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-redaction-import-isolation."));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = path.join(root, "plugin");
  const operatorHome = path.join(root, "operator-home");
  fs.mkdirSync(fixture);
  fs.mkdirSync(operatorHome);
  fs.writeFileSync(path.join(fixture, "__init__.py"), [
    "import os",
    "from pathlib import Path",
    "def mark(stage):",
    "    root = Path(os.environ['HERMES_HOME'])",
    "    root.mkdir(parents=True, exist_ok=True)",
    "    (root / f'{stage}.txt').write_text(stage, encoding='utf-8')",
    "mark('import')",
    "def register(host):",
    "    mark('register')",
    "    raise RuntimeError('fixture stop after registration')",
    "",
  ].join("\n"));

  const result = spawnSync(process.env.LITHERMES_PYTHON || "python3", [redactionProbe, fixture], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: operatorHome,
      HERMES_HOME: operatorHome,
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONNOUSERSITE: "1",
    },
    timeout: 60000,
  });
  assert.notEqual(result.status, 0, "fixture intentionally stops after registration");
  assert.deepEqual(fs.readdirSync(operatorHome), [], `operator profile was touched: ${result.stderr}`);
});

test("negative-control self-check removes its parent isolated profile under TMPDIR", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-self-check-tmpdir."));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [matrix, "--self-check"], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TMPDIR: temp,
      NODE_COMPILE_CACHE: "",
      NODE_DISABLE_COMPILE_CACHE: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONNOUSERSITE: "1",
    },
    timeout: 600000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /SELF-CHECK PASS/);
  const leftovers = fs.readdirSync(temp);
  assert.deepEqual(leftovers, [], `self-check left temporary roots: ${leftovers.join(", ")}`);
});
