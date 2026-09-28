const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
const canonicalRoot = path.join(
  pluginRoot,
  "skills",
  "frontend-ui-ux",
  "references",
  "_canonical-corpus",
);
const manifestPath = path.join(canonicalRoot, "manifest.json");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function loadVerifier() {
  assert.equal(fs.existsSync(manifestPath), true, "canonical frontend manifest is missing");
  return require("../src/lib/canonicalCorpus");
}

function copyTree(source, target) {
  fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true });
}

test("canonical frontend corpus pins the approved path, size, and digest inventory", () => {
  const { verifyCanonicalCorpus } = loadVerifier();
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.source.commit, "8ec16c5129df7b9778959e8367657d0e79c2c3bb");
  assert.equal(manifest.source.tree, "9188410be0af35f2421ba300d91a0d7a7341caf0");
  assert.equal(manifest.corpus.fileCount, 167);
  assert.equal(manifest.corpus.totalBytes, 2596360);
  assert.equal(manifest.corpus.digest, "b0d1a085de8856e7edeba24127d26875fe5473b80c0d95f6578addfdc801e445");
  assert.equal(manifest.files.length, 167);
  assert.deepEqual(manifest.files.map((entry) => entry.path), [...manifest.files.map((entry) => entry.path)].sort());
  assert.deepEqual(verifyCanonicalCorpus(canonicalRoot), {
    ok: true,
    failures: [],
    protectedFiles: 171,
  });

  const stream = manifest.files.map((entry) => `${entry.sha256}  ${entry.path}\n`).join("");
  assert.equal(crypto.createHash("sha256").update(stream).digest("hex"), manifest.corpus.digest);
  assert.equal(manifest.files.reduce((sum, entry) => sum + entry.size, 0), manifest.corpus.totalBytes);
});

test("canonical legal files and CRLF policy are exact manifest-owned bytes", () => {
  const { verifyCanonicalCorpus } = loadVerifier();
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.deepEqual(manifest.legal.map((entry) => entry.path), [
    "legal/ATTRIBUTION.md",
    "legal/LICENSE",
    "legal/LICENSE-Apache-2.0.txt",
  ]);
  for (const entry of manifest.legal) {
    const file = path.join(canonicalRoot, ...entry.path.split("/"));
    assert.equal(fs.lstatSync(file).isFile(), true);
    assert.equal(fs.statSync(file).size, entry.size);
    assert.equal(sha256(file), entry.sha256);
  }
  assert.equal(
    fs.readFileSync(path.join(canonicalRoot, ".gitattributes"), "utf8"),
    "corpus/** -text\nlegal/** -text\n",
  );
  assert.equal(verifyCanonicalCorpus(canonicalRoot).ok, true);
});

test("canonical verification fails closed for tamper, missing, extra, symlink, and special entries", (t) => {
  const { verifyCanonicalCorpus } = loadVerifier();
  const sourceManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const first = sourceManifest.files[0].path;
  const cases = [
    ["tamper", (root) => fs.appendFileSync(path.join(root, "corpus", first), "\n")],
    ["missing", (root) => fs.rmSync(path.join(root, "corpus", first))],
    ["extra", (root) => fs.writeFileSync(path.join(root, "corpus", "extra.txt"), "extra")],
    ["symlink", (root) => {
      const target = path.join(root, "corpus", first);
      fs.rmSync(target);
      fs.symlinkSync(path.join(root, "manifest.json"), target);
    }],
  ];
  if (process.platform !== "win32") {
    cases.push(["special", (root) => {
      const target = path.join(root, "corpus", first);
      fs.rmSync(target);
      const result = require("node:child_process").spawnSync("mkfifo", [target]);
      assert.equal(result.status, 0, result.stderr?.toString());
    }]);
  }

  for (const [label, mutate] of cases) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `lithermes-canonical-${label}.`));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    copyTree(canonicalRoot, temp);
    mutate(temp);
    const result = verifyCanonicalCorpus(temp);
    assert.equal(result.ok, false, `${label} must fail closed`);
    assert.ok(result.failures.length >= 1, `${label} must report a bounded failure`);
  }
});

test("canonical verification rejects unreadable and legal mismatches when permissions are enforced", (t) => {
  const { verifyCanonicalCorpus } = loadVerifier();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-canonical-unreadable."));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  copyTree(canonicalRoot, temp);
  const legal = path.join(temp, "legal", "LICENSE");
  fs.appendFileSync(legal, "\n");
  assert.equal(verifyCanonicalCorpus(temp).ok, false, "legal mismatch must fail closed");

  copyTree(canonicalRoot, temp);
  const first = JSON.parse(fs.readFileSync(path.join(temp, "manifest.json"), "utf8")).files[0].path;
  const target = path.join(temp, "corpus", first);
  fs.chmodSync(target, 0o000);
  let enforced = false;
  try {
    fs.readFileSync(target);
  } catch {
    enforced = true;
  }
  const result = verifyCanonicalCorpus(temp);
  fs.chmodSync(target, 0o600);
  if (enforced) assert.equal(result.ok, false, "unreadable file must fail closed");
});

test("canonical protected paths come from one descriptor-bound carrier open and stay inside the canonical root", (t) => {
  const { canonicalProtectedPaths } = loadVerifier();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-canonical-carrier-swap."));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  copyTree(canonicalRoot, temp);
  const carrier = path.resolve(temp, "manifest.json");
  const originalOpen = fs.openSync;
  let carrierOpens = 0;
  fs.openSync = function guardedOpen(file, ...args) {
    if (path.resolve(file) === carrier) {
      carrierOpens += 1;
    }
    return originalOpen.call(this, file, ...args);
  };
  let result;
  try {
    result = canonicalProtectedPaths(temp);
  } finally {
    fs.openSync = originalOpen;
  }

  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.equal(carrierOpens, 1, "canonical protection must open the verified carrier once");
  assert.equal(result.paths.size, 171);
  const resolvedRoot = path.resolve(temp);
  for (const protectedPath of result.paths) {
    const relative = path.relative(resolvedRoot, protectedPath);
    assert.equal(relative === "" || relative.split(path.sep).includes(".."), false, protectedPath);
    assert.ok(protectedPath.startsWith(`${resolvedRoot}${path.sep}`), protectedPath);
  }
});

test("canonical protected paths reject manifest traversal instead of resolving dot-dot", (t) => {
  const { canonicalProtectedPaths } = loadVerifier();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-canonical-traversal."));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  copyTree(canonicalRoot, temp);
  const carrier = path.join(temp, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(carrier, "utf8"));
  manifest.files[0].path = "../outside-canonical-root";
  fs.writeFileSync(carrier, JSON.stringify(manifest));

  const result = canonicalProtectedPaths(temp);
  assert.equal(result.ok, false);
  assert.equal(result.paths.size, 0);
  assert.ok(result.failures.some((failure) => /invalid-or-duplicate-file-path/.test(failure)), JSON.stringify(result));
});

test("canonical verification rejects final-file replacement after descriptor open", (t) => {
  const { verifyCanonicalCorpus } = loadVerifier();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-canonical-final-replace."));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  copyTree(canonicalRoot, temp);
  const manifest = JSON.parse(fs.readFileSync(path.join(temp, "manifest.json"), "utf8"));
  const target = path.join(temp, "corpus", ...manifest.files[0].path.split("/"));
  const displaced = `${temp}.final-displaced`;
  t.after(() => fs.rmSync(displaced, { force: true }));
  const originalOpen = fs.openSync;
  let replaced = false;
  fs.openSync = function replaceAfterOpen(file, ...args) {
    const descriptor = originalOpen.call(this, file, ...args);
    if (!replaced && path.resolve(file) === path.resolve(target)) {
      replaced = true;
      fs.renameSync(target, displaced);
      fs.copyFileSync(displaced, target);
    }
    return descriptor;
  };
  let result;
  try {
    result = verifyCanonicalCorpus(temp);
  } finally {
    fs.openSync = originalOpen;
  }

  assert.equal(replaced, true, "fixture must replace the named file after descriptor open");
  assert.equal(result.ok, false, "final-file identity replacement must fail closed");
  assert.ok(result.failures.some((failure) => /identity|changed/.test(failure)), JSON.stringify(result));
});

test("canonical verification rejects ancestor replacement during descriptor-bound read", (t) => {
  const { verifyCanonicalCorpus } = loadVerifier();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-canonical-ancestor-replace."));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  copyTree(canonicalRoot, temp);
  const manifest = JSON.parse(fs.readFileSync(path.join(temp, "manifest.json"), "utf8"));
  const target = path.join(temp, "corpus", ...manifest.files[0].path.split("/"));
  const ancestor = path.join(temp, "corpus", manifest.files[0].path.split("/")[0]);
  const replacement = `${temp}.replacement-ancestor`;
  const displaced = `${temp}.displaced-ancestor`;
  t.after(() => fs.rmSync(replacement, { recursive: true, force: true }));
  t.after(() => fs.rmSync(displaced, { recursive: true, force: true }));
  fs.cpSync(ancestor, replacement, { recursive: true });
  const originalOpen = fs.openSync;
  let replaced = false;
  fs.openSync = function replaceAncestorAfterOpen(file, ...args) {
    const descriptor = originalOpen.call(this, file, ...args);
    if (!replaced && path.resolve(file) === path.resolve(target)) {
      replaced = true;
      fs.renameSync(ancestor, displaced);
      fs.renameSync(replacement, ancestor);
    }
    return descriptor;
  };
  let result;
  try {
    result = verifyCanonicalCorpus(temp);
  } finally {
    fs.openSync = originalOpen;
  }

  assert.equal(replaced, true, "fixture must replace an opened ancestor deterministically");
  assert.equal(result.ok, false, "ancestor identity replacement must fail closed");
  assert.ok(result.failures.some((failure) => /ancestor|identity|changed/.test(failure)), JSON.stringify(result));
});

test("installer payload inspection exposes the canonical frontend verdict used by doctor", () => {
  const skillPayload = require("../src/lib/skillPayload");
  assert.equal(typeof skillPayload.inspectCanonicalFrontend, "function");
  assert.deepEqual(skillPayload.inspectCanonicalFrontend(path.join(packageRoot, "assets", "lithermes-plugin")), {
    ok: true,
    failures: [],
    protectedFiles: 171,
  });
});

test("canonical manifest rejects unknown fields at every schema layer", (t) => {
  const { verifyCanonicalCorpus } = loadVerifier();
  const mutations = [
    ["top", (manifest) => { manifest.note = "carrier"; }],
    ["source", (manifest) => { manifest.source.note = "carrier"; }],
    ["corpus", (manifest) => { manifest.corpus.note = "carrier"; }],
    ["file", (manifest) => { manifest.files[0].note = "carrier"; }],
    ["legal", (manifest) => { manifest.legal[0].note = "carrier"; }],
  ];
  for (const [label, mutate] of mutations) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `lithermes-canonical-schema-${label}.`));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    copyTree(canonicalRoot, temp);
    const carrier = path.join(temp, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(carrier, "utf8"));
    mutate(manifest);
    fs.writeFileSync(carrier, JSON.stringify(manifest));
    const result = verifyCanonicalCorpus(temp);
    assert.equal(result.ok, false, `${label} unknown field must fail closed`);
    assert.equal(result.protectedFiles, 0);
  }
});

test("payload manifest rejects unknown top-level and entry fields before exemption", () => {
  const { inspectSkillPayload } = require("../src/lib/skillPayload");
  const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "payload-version.json"), "utf8"));
  for (const mutate of [
    (carrier) => { carrier.note = "carrier"; },
    (carrier) => { carrier.files[0].note = "carrier"; },
  ]) {
    const carrier = structuredClone(manifest);
    mutate(carrier);
    const result = inspectSkillPayload(pluginRoot, carrier, true);
    assert.equal(result.ok, false);
    assert.match(result.manifestIssue || "", /schema|field|invalid/i);
  }
});

test("canonical and payload manifests reject duplicate raw JSON keys before parsing", (t) => {
  const { verifyCanonicalCorpus } = loadVerifier();
  const canonicalMutations = [
    ["top", (raw) => raw.replace('"schema": "lithermes.canonical-frontend-corpus/v1"', '"schema": "shadow",\n  "schema": "lithermes.canonical-frontend-corpus/v1"')],
    ["entry", (raw) => raw.replace('"path": "design/', '"path": "shadow",\n      "path": "design/')],
    ["legal", (raw) => {
      const marker = '"legal": [';
      const start = raw.indexOf(marker);
      return `${raw.slice(0, start)}${raw.slice(start).replace('"path": "legal/', '"path": "shadow",\n      "path": "legal/')}`;
    }],
  ];
  for (const [label, mutate] of canonicalMutations) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `lithermes-canonical-duplicate-${label}.`));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    copyTree(canonicalRoot, temp);
    const carrier = path.join(temp, "manifest.json");
    fs.writeFileSync(carrier, mutate(fs.readFileSync(carrier, "utf8")));
    const result = verifyCanonicalCorpus(temp);
    assert.equal(result.ok, false, `${label} duplicate key must fail closed`);
    assert.equal(result.protectedFiles, 0);
    assert.ok(result.failures.some((failure) => /duplicate|invalid-json/.test(failure)), JSON.stringify(result));
  }

  const { readPayloadManifest } = require("../src/lib/skillPayload");
  assert.equal(typeof readPayloadManifest, "function");
  const payloadSource = path.join(pluginRoot, "payload-version.json");
  for (const [label, mutate] of [
    ["top", (raw) => raw.replace('"source": "bundled-payload"', '"source": "shadow",\n  "source": "bundled-payload"')],
    ["entry", (raw) => raw.replace('"path": "NOTICE.md"', '"path": "shadow",\n      "path": "NOTICE.md"')],
  ]) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `lithermes-payload-duplicate-${label}.`));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const carrier = path.join(temp, "payload-version.json");
    fs.writeFileSync(carrier, mutate(fs.readFileSync(payloadSource, "utf8")));
    assert.equal(readPayloadManifest(carrier), null, `${label} duplicate payload key must fail closed`);
  }
});

test("duplicate-key detection reuses the installed YAML parser instead of a custom JSON parser", () => {
  const customParser = path.join(packageRoot, "src", "lib", "strictJson.js");
  const canonicalSource = fs.readFileSync(path.join(packageRoot, "src", "lib", "canonicalCorpus.js"), "utf8");
  assert.equal(fs.existsSync(customParser), false, "hand-rolled strictJson parser must be removed");
  assert.match(canonicalSource, /require\("yaml"\)/);
  assert.match(canonicalSource, /parseDocument\([\s\S]*uniqueKeys:\s*true/);
  assert.match(canonicalSource, /JSON\.parse\(/);
});

test("repository-root git attributes preserve canonical corpus and legal bytes", () => {
  const repoRoot = path.resolve(packageRoot, "..", "..");
  const paths = [
    path.relative(repoRoot, path.join(canonicalRoot, "corpus", "design", "README.md")),
    path.relative(repoRoot, path.join(canonicalRoot, "legal", "LICENSE")),
  ];
  const result = require("node:child_process").spawnSync(
    "git",
    ["check-attr", "text", "--", ...paths],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  for (const relative of paths) assert.match(result.stdout, new RegExp(`${relative.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: text: unset`));
});
