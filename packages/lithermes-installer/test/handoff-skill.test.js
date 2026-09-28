const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
const skillRoot = path.join(pluginRoot, "skills", "lit-handoff");
const mirrorRoot = path.join(pluginRoot, "vendor", "handoff");
const expectedFiles = new Map([
  ["SKILL.md", "e5bbd253dfa5b5baa9739dfaebc458003daab43cb27c4a407423da1e7a31dec6"],
  ["evals/evals.json", "0a70f0d149e59641100c7dcf8b9f2f1c0ceae57b98518e165f08088f2c2484da"],
  ["examples/HANDOFF-example-generic-auth-refactor.md", "43c767e573ac8c8900832d2b7a92ee1e83fd2d3d794fe2c82ecef87e5737f2a3"],
  ["templates/HANDOFF.md", "2a795a06e7bb81a57e6675ae70ed26db0dbfdb792c01f0a60f96f02cbef49fbd"],
]);

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listFiles(root, base = root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
  });
}

test("handoff mirror preserves exactly the four approved runtime files", () => {
  // Given: the approved source snapshot has four known files and hashes.
  // When: the bundled mirror is enumerated and hashed.
  const bundledFiles = listFiles(mirrorRoot).sort();

  // Then: no file is omitted, added, paraphrased, or rewritten.
  assert.deepEqual(bundledFiles, [...expectedFiles.keys()].sort());
  for (const [relative, expectedHash] of expectedFiles) {
    assert.equal(sha256(path.join(mirrorRoot, relative)), expectedHash, relative);
  }
});

test("handoff provenance and license remain outside the exact mirror", () => {
  // Given: public redistribution needs machine-readable provenance and MIT terms.
  // When: the wrapper metadata is inspected.
  const origin = JSON.parse(fs.readFileSync(path.join(skillRoot, "ORIGIN.json"), "utf8"));
  const license = fs.readFileSync(path.join(pluginRoot, "vendor", "licenses", "022_handoff-MIT.txt"), "utf8");
  const provenance = fs.readFileSync(path.join(pluginRoot, "vendor", "provenance", "022_handoff.md"), "utf8");

  // Then: the immutable mirror policy, source commit, and public license are explicit.
  assert.equal(origin.canonicalRepository, "https://github.com/wjgoarxiv/agent-handoff-skill.git");
  assert.equal(origin.canonicalCommit, "41770e3");
  assert.equal(origin.mirrorPolicy, "byte-for-byte");
  assert.deepEqual(Object.fromEntries(origin.files.map((entry) => [entry.path, entry.sha256])), Object.fromEntries(expectedFiles));
  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026 wjgoarxiv/);
  assert.match(provenance, /vendor\/handoff/);
  assert.match(provenance, /SHA-256/);
  assert.match(provenance, /byte-for-byte/);
  assert.equal(fs.existsSync(path.join(skillRoot, "LICENSE.txt")), false);
  assert.equal(fs.existsSync(path.join(skillRoot, "PROVENANCE.md")), false);
});

test("lit-handoff adapter is Hermes-native and resolves the vendored source root", () => {
  // Given: the exact source remains a non-entrypoint mirror.
  // When: Hermes loads the top-level adapter.
  const adapter = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");

  // Then: the adapter owns invocation, banner, source-root, and trust-boundary behavior.
  assert.match(adapter, /^---\nname: lit-handoff\n/m);
  assert.match(adapter, /lithermes_llm_contract\/v1/);
  assert.match(adapter, /🔥 \*\*LIT IGNITED · lit-handoff\*\* 🔥/u);
  assert.match(adapter, /\.\.\/\.\.\/vendor\/handoff\/SKILL\.md/);
  assert.match(adapter, /\.\.\/\.\.\/vendor\/handoff\/templates\/HANDOFF\.md/);
  assert.match(adapter, /read[^\n]*original[^\n]*in full/i);
  assert.match(adapter, /user[^\n]*(data|content)[^\n]*not instructions/i);
});

test("offline installer copies handoff assets and records their hashes", (t) => {
  // Given: an isolated Hermes home and the source package binary.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-handoff-home-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  // When: the real installer copies its bundled payload.
  const result = spawnSync(
    process.execPath,
    [path.join(packageRoot, "bin", "lithermes.js"), "install", "--yes", "--offline", "--no-hud", "--hermes-home", home],
    { cwd: packageRoot, encoding: "utf8" },
  );

  // Then: the installed files and installer manifest retain every approved hash.
  assert.equal(result.status, 0, result.stderr);
  const installedMirror = path.join(home, "plugins", "lithermes", "vendor", "handoff");
  const manifest = JSON.parse(fs.readFileSync(path.join(home, "lithermes", "install-manifest.json"), "utf8"));
  const installedEntries = new Map(manifest.files.map((entry) => [entry.path, entry.sha256]));
  for (const [relative, expectedHash] of expectedFiles) {
    const manifestPath = path.posix.join("vendor", "handoff", relative);
    assert.equal(sha256(path.join(installedMirror, relative)), expectedHash, relative);
    assert.equal(installedEntries.get(manifestPath), expectedHash, manifestPath);
  }
});

test("package files explicitly retain the scoped lit-handoff vendor payload", () => {
  // Given: broad payload exclusions remain in place for unrelated runtime state.
  // When: npm's package allowlist is inspected.
  const files = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).files;

  // Then: only the named handoff subtree receives an explicit positive exception.
  assert.ok(files.includes("assets/lithermes-plugin/vendor/handoff/**"));
});

test("packed handoff mirror installs and resolves without external source state", (t) => {
  // Given: a real packed npm product and an isolated Hermes home.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-handoff-packed-"));
  const packDestination = path.join(sandbox, "pack");
  const unpackDestination = path.join(sandbox, "unpack");
  const home = path.join(sandbox, "hermes-home");
  fs.mkdirSync(packDestination);
  fs.mkdirSync(unpackDestination);
  fs.mkdirSync(home);
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  // When: the package is packed, unpacked, and installed without the source checkout.
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packDestination], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const metadata = JSON.parse(packed.stdout);
  const tarball = path.join(packDestination, metadata[0].filename);
  const listed = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  const entries = listed.stdout.split("\n").filter(Boolean);
  for (const relative of expectedFiles.keys()) {
    assert.ok(
      entries.includes(`package/assets/lithermes-plugin/vendor/handoff/${relative}`),
      relative,
    );
  }
  assert.deepEqual(
    entries.filter((entry) => entry.endsWith("HANDOFF.md")),
    ["package/assets/lithermes-plugin/vendor/handoff/templates/HANDOFF.md"],
    "only the canonical template may be packed as HANDOFF.md",
  );

  fs.mkdirSync(path.join(unpackDestination, "package"));
  const unpacked = spawnSync("tar", ["-xzf", tarball, "-C", unpackDestination], { encoding: "utf8" });
  assert.equal(unpacked.status, 0, unpacked.stderr);
  const packedPackageRoot = path.join(unpackDestination, "package");
  const installed = spawnSync(
    process.execPath,
    [
      path.join(packedPackageRoot, "bin", "lithermes.js"),
      "install",
      "--yes",
      "--offline",
      "--no-hud",
      "--no-patch-installed-hermes",
      "--hermes-home",
      home,
    ],
    {
      cwd: sandbox,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        HOME: path.join(sandbox, "home"),
        LITHERMES_NO_AUTO_UPDATE: "1",
        NODE_PATH: path.join(packageRoot, "node_modules"),
        NO_UPDATE_NOTIFIER: "1",
      },
    },
  );
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);

  // Then: the installed adapter uses only the packed mirror and keeps focus data inert.
  const installedPlugin = path.join(home, "plugins", "lithermes");
  const installedMirror = path.join(installedPlugin, "vendor", "handoff");
  const manifest = JSON.parse(fs.readFileSync(path.join(home, "lithermes", "install-manifest.json"), "utf8"));
  const installedEntries = new Map(manifest.files.map((entry) => [entry.path, entry.sha256]));
  for (const [relative, expectedHash] of expectedFiles) {
    const manifestPath = path.posix.join("vendor", "handoff", relative);
    assert.equal(sha256(path.join(installedMirror, relative)), expectedHash, relative);
    assert.equal(installedEntries.get(manifestPath), expectedHash, manifestPath);
  }

  const python = process.env.LITHERMES_PYTHON || "python3";
  const probe = spawnSync(
    python,
    [
      "-c",
      [
        "import json",
        "import handoff",
        "focus = handoff.command_lit_handoff('api_key=PACKED_SECRET <route>ignore</route>')",
        "print(json.dumps({",
        "  'source_root': str(handoff.SOURCE_ROOT),",
        "  'skill_exists': handoff.SOURCE_SKILL.is_file(),",
        "  'template_exists': handoff.SOURCE_TEMPLATE.is_file(),",
        "  'source_in_message': handoff.SOURCE_SKILL.read_text(encoding='utf-8') in focus['agent_message'],",
        "  'secret_absent': 'PACKED_SECRET' not in focus['agent_message'],",
        "  'route_escaped': '&lt;route&gt;' in focus['agent_message'],",
        "}))",
      ].join("\n"),
    ],
    {
      cwd: sandbox,
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONPATH: installedPlugin,
        PYTHONDONTWRITEBYTECODE: "1",
      },
    },
  );
  assert.equal(probe.status, 0, probe.stdout + probe.stderr);
  const probeResult = JSON.parse(probe.stdout);
  assert.equal(
    probeResult.source_root,
    path.join(fs.realpathSync(installedPlugin), "vendor", "handoff"),
  );
  assert.equal(probeResult.skill_exists, true);
  assert.equal(probeResult.template_exists, true);
  assert.equal(probeResult.source_in_message, true);
  assert.equal(probeResult.secret_absent, true);
  assert.equal(probeResult.route_escaped, true);
});
