const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { cleanPythonCache } = require("../src/lib/files");
const {
  formatHits,
  gitFiles,
  repoRoot,
  scanFiles,
  scanPackPaths,
  scanText,
  variants,
  walkFiles,
} = require("./scripts/scan-forbidden-tokens");

const root = repoRoot(__dirname);
const packageRoot = path.resolve(__dirname, "..");
const foreignLocalStateName = `.lit${String.fromCharCode(111, 112, 101, 110, 99, 111, 100, 101)}`;
const foreignLocalStateRe = new RegExp(`(^|/)${foreignLocalStateName.replace(".", "\\\\.")}(/|$)`);
const npmPackCommand = [
  "npm",
  "pack",
  "--dry-run",
  "--json",
  "--ignore-scripts",
];

function assertNoHits(hits, label) {
  assert.equal(hits.length, 0, `${label} matches:\n${formatHits(hits)}`);
}

test("scanner constructs the blocked variant set without source literals", () => {
  const values = variants();
  assert.ok(values.length >= 20);
  assert.ok(scanText(values[0]).length >= 1);
  const source = fs.readFileSync(path.join(__dirname, "scripts", "scan-forbidden-tokens.js"), "utf8");
  assert.equal(scanText(source).length, 0);
});

test("tracked files are clean (strict no allowlist)", () => {
  assertNoHits(scanFiles(gitFiles(root), root), "tracked");
});

test("package files are clean (STRICT — no allowlist on packed surfaces)", () => {
  assertNoHits(scanFiles(walkFiles(packageRoot), root), "package");
});

test("Wikify contract names only supported product-local claim states", () => {
  const wikifyRoot = path.join(packageRoot, "assets", "lithermes-plugin", "skills", "wikify");
  const skill = fs.readFileSync(path.join(wikifyRoot, "SKILL.md"), "utf8");
  const policy = skill.match(/3\. \*\*Inventory and review policy\.\*\*[\s\S]*?(?=\n\d+\.)/)?.[0];
  assert.ok(policy, "Wikify review policy must remain present");
  const declaredStates = [...policy.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(declaredStates)].sort(),
    ["accepted", "rejected", "review-needed", "stale"],
    "Wikify must use the Python runtime claim states only",
  );
  assert.match(policy, /Generated product-local claims begin as `review-needed`/);
  assert.doesNotMatch(policy, /\bdraft\b/i, "product-local claim review policy must not name draft");

  const draftStateFiles = walkFiles(wikifyRoot).filter((file) => {
    const text = fs.readFileSync(file, "utf8");
    return text.split(/\r?\n/).some((line) => /\b(?:status|state)\s*:[^\n]*\bdraft\b/i.test(line));
  });
  assert.ok(draftStateFiles.length > 0, "Wikify must retain valid wiki metadata draft states");
  const unscopedDraftStateFiles = draftStateFiles
    .filter((file) => !/wiki page\/source-note metadata, not product-local claim review states/i.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(wikifyRoot, file));
  assert.deepEqual(
    unscopedDraftStateFiles,
    [],
    "every Wikify metadata draft state must be scoped away from product-local claim review states",
  );
});

test("plans are not a tracked no-trace exemption surface", () => {
  const trackedPlans = gitFiles(root)
    .map((file) => path.relative(root, file))
    .filter((file) => file.startsWith("plans/"));
  assert.deepEqual(trackedPlans, [], `tracked plan artifacts must stay untracked:\n${trackedPlans.join("\n")}`);
});

test("local reference folder is ignored by git", () => {
  const status = spawnSync("git", ["status", "--short", "--ignored", "--", "# REFERENCE"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(status.status, 0, status.stderr);
  assert.doesNotMatch(status.stdout, /^\?\? /m);

  const ignored = spawnSync("git", ["check-ignore", "--no-index", "-q", "# REFERENCE/.__lithermes_ci_probe__"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(ignored.status, 0, "local reference folder must be ignored");
});

test("pack output stays free of forbidden variants and bytecode noise", (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-pack-cleanliness."));
  const copiedPackageRoot = path.join(sandbox, "package");
  fs.mkdirSync(copiedPackageRoot);
  for (const entry of ["assets", "bin", "src"]) {
    fs.cpSync(path.join(packageRoot, entry), path.join(copiedPackageRoot, entry), { recursive: true });
  }
  for (const entry of ["package.json", "README.md", "README_Ko-KR.md"]) {
    fs.copyFileSync(path.join(packageRoot, entry), path.join(copiedPackageRoot, entry));
  }
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const transientState = path.join(copiedPackageRoot, ".hermes", "lithermes", "runs", "fake-run");
  const transientKnowledge = path.join(copiedPackageRoot, ".hermes", "lithermes", "knowledge");
  const transientPlan = path.join(copiedPackageRoot, "plans");
  const transientForeignState = path.join(copiedPackageRoot, "assets", "lithermes-plugin", foreignLocalStateName);
  fs.mkdirSync(path.join(transientState, "evidence"), { recursive: true });
  fs.writeFileSync(path.join(transientState, "state.json"), JSON.stringify({ local: true }));
  fs.writeFileSync(path.join(transientState, "ledger.jsonl"), "{}\n");
  fs.writeFileSync(path.join(transientState, "notepad.md"), "# local only\n");
  fs.writeFileSync(path.join(transientState, "evidence", "proof.txt"), "local only\n");
  fs.mkdirSync(transientKnowledge, { recursive: true });
  fs.writeFileSync(path.join(transientKnowledge, "claims.jsonl"), "{\"local\":true}\n");
  fs.writeFileSync(path.join(transientKnowledge, "settings.json"), "{\"capture\":false}\n");
  fs.mkdirSync(transientPlan, { recursive: true });
  fs.writeFileSync(path.join(transientPlan, "fake-plan.md"), "# local plan\n");
  fs.mkdirSync(transientForeignState, { recursive: true });
  fs.writeFileSync(path.join(transientForeignState, "state.json"), JSON.stringify({ local: true }));

  const result = spawnSync(npmPackCommand[0], npmPackCommand.slice(1), {
    cwd: copiedPackageRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);

  const output = JSON.parse(result.stdout);
  const packedFiles = output.flatMap((entry) => entry.files || []).map((entry) => entry.path);
  assertNoHits(scanPackPaths(packedFiles, root), "pack paths");
  assert.equal(packedFiles.some((file) => /(^|\/)__pycache__(\/|$)/.test(file)), false, "pack output must not include __pycache__");
  assert.equal(packedFiles.some((file) => file.endsWith(".pyc")), false, "pack output must not include .pyc files");
  assert.equal(packedFiles.some((file) => /(^|\/)\.hermes(\/|$)/.test(file)), false, "pack output must not include .hermes/ runtime state");
  assert.equal(packedFiles.some((file) => /(^|\/)knowledge(\/|$)/.test(file)), false, "pack output must not include Wikify knowledge state");
  assert.equal(packedFiles.some((file) => foreignLocalStateRe.test(file)), false, "pack output must not include foreign local state");
  assert.equal(packedFiles.some((file) => /(^|\/)plans(\/|$)/.test(file)), false, "pack output must not include local plans/");
  assert.equal(packedFiles.some((file) => /(^|\/)runs(\/|$)/.test(file)), false, "pack output must not include runtime runs/");
  assert.equal(packedFiles.some((file) => /(^|\/)evidence(\/|$)/.test(file)), false, "pack output must not include local evidence/");
  assert.equal(packedFiles.some((file) => /(^|\/)state\.json$/.test(file)), false, "pack output must not include runtime state.json");
  assert.equal(packedFiles.some((file) => /(^|\/)ledger\.jsonl$/.test(file)), false, "pack output must not include runtime ledgers");
  assert.equal(packedFiles.some((file) => /(^|\/)notepad\.md$/.test(file)), false, "pack output must not include runtime notepads");
});

test("nested hidden local state below assets is excluded from pack output", (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-pack-hidden-state."));
  const copiedPackageRoot = path.join(sandbox, "package");
  fs.mkdirSync(copiedPackageRoot);
  for (const entry of ["assets", "bin", "src"]) {
    fs.cpSync(path.join(packageRoot, entry), path.join(copiedPackageRoot, entry), { recursive: true });
  }
  for (const entry of ["package.json", "README.md", "README_Ko-KR.md", ".npmignore"]) {
    fs.copyFileSync(path.join(packageRoot, entry), path.join(copiedPackageRoot, entry));
  }
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const hiddenState = path.join(
    copiedPackageRoot,
    "assets",
    "lithermes-plugin",
    "skills",
    "wikify",
    "modes",
    "query",
    ".lithermes-local-state",
    "claims.jsonl",
  );
  fs.mkdirSync(path.dirname(hiddenState), { recursive: true });
  fs.writeFileSync(hiddenState, "local only\n");

  const result = spawnSync(npmPackCommand[0], npmPackCommand.slice(1), {
    cwd: copiedPackageRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);

  const output = JSON.parse(result.stdout);
  const packedFiles = output.flatMap((entry) => entry.files || []).map((entry) => entry.path);
  assert.equal(
    packedFiles.some((file) => file.includes(".lithermes-local-state")),
    false,
    "nested hidden local state must stay outside the package",
  );
});

test("generated Python bytecode cleanup is explicit and bounded", (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-pycache-cleanup."));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const cache = path.join(sandbox, "nested", "__pycache__");
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, "module.cpython-312.pyc"), "generated");
  fs.writeFileSync(path.join(sandbox, "nested", "keep.py"), "pass\n");
  fs.writeFileSync(path.join(sandbox, "nested", "orphan.pyc"), "generated");

  const removed = cleanPythonCache(sandbox);
  assert.equal(removed, 2);
  assert.equal(fs.existsSync(cache), false);
  assert.equal(fs.existsSync(path.join(sandbox, "nested", "orphan.pyc")), false);
  assert.equal(fs.existsSync(path.join(sandbox, "nested", "keep.py")), true);

  const scripts = require("../package.json").scripts;
  assert.match(scripts["pack:dry"], /^npm run clean:payload && /);
});

test("payload manifest excludes Python bytecode entries", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "assets", "lithermes-plugin", "payload-version.json"), "utf8"),
  );
  const bytecode = manifest.files.filter(
    (entry) => /(^|\/)__pycache__(\/|$)/.test(entry.path) || entry.path.endsWith(".pyc"),
  );
  assert.deepEqual(bytecode, [], `payload manifest must exclude generated bytecode: ${JSON.stringify(bytecode)}`);
});

test("public doctor reports package bytecode without mutating package payload", (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-doctor-readonly."));
  const home = path.join(sandbox, "home");
  const copiedPackageRoot = path.join(sandbox, "package");
  fs.mkdirSync(home);
  fs.mkdirSync(copiedPackageRoot);
  for (const entry of ["assets", "bin", "src"]) {
    fs.cpSync(path.join(packageRoot, entry), path.join(copiedPackageRoot, entry), { recursive: true });
  }
  fs.copyFileSync(path.join(packageRoot, "package.json"), path.join(copiedPackageRoot, "package.json"));
  const cache = path.join(copiedPackageRoot, "assets", "lithermes-plugin", "__pycache__");
  const bytecode = path.join(cache, "doctor-probe.cpython-312.pyc");
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(bytecode, "generated probe");
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [path.join(copiedPackageRoot, "bin", "lithermes.js"), "doctor", "--offline", "--hermes-home", home],
    {
      cwd: copiedPackageRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        NODE_PATH: path.join(packageRoot, "node_modules"),
        NO_UPDATE_NOTIFIER: "1",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    },
  );

  assert.equal(result.status, 1, "doctor must fail payload integrity when bytecode is unmanifested");
  assert.equal(fs.existsSync(bytecode), true, "doctor must leave installed package bytes unchanged");
  assert.match(result.stdout, /bundled bytecode cache: PRESENT \(\d+ generated (?:entry|entries); left unchanged\)/);
  assert.match(result.stdout, /bundled skill payload: FAIL/);
  assert.match(result.stdout, /__pycache__.*unexpected/);
});
