const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const packageRoot = path.resolve(__dirname, "..");
const payload = path.join(packageRoot, "assets", "lithermes-plugin");
const channelModule = path.join(packageRoot, "assets", "npm-channel", "auto_update.py");
const markerName = ".lithermes-npm-channel";
const markerToken = "lithermes-npm-channel-v1\n";

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

test("catalog payload carries no self-updater", () => {
  assert.equal(fs.existsSync(path.join(payload, "auto_update.py")), false);
  assert.equal(fs.existsSync(channelModule), true);
  const core = fs.readFileSync(path.join(payload, "core.py"), "utf8");
  assert.equal(core.includes("import auto_update"), false);
  assert.equal(core.includes("_auto_update"), false);
  assert.match(core, /_npm_channel_pre_llm/);
  const readme = fs.readFileSync(path.join(payload, "README.md"), "utf8");
  assert.equal(readme.includes("__auto-update"), false);
  assert.equal(readme.includes("foreground update barrier"), false);
  const channel = fs.readFileSync(channelModule, "utf8");
  assert.match(channel, new RegExp(`NPM_CHANNEL_MARKER_NAME = ${JSON.stringify(markerName)}`));
  // A raw newline inside the quotes is not valid Python. The escape is the token.
  assert.match(channel, /NPM_CHANNEL_TOKEN = "lithermes-npm-channel-v1\\n"/);
  assert.equal(fs.existsSync(path.join(payload, markerName)), false);
});

test("npm install writes the channel marker the catalog tree never contains", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-catalog-channel-"));
  try {
    const installed = spawnSync(process.execPath, [
      path.join(packageRoot, "bin", "lithermes.js"),
      "install", "--yes", "--offline", "--no-hud", "--no-auto-update",
      "--no-patch-installed-hermes", "--hermes-home", home,
    ], { cwd: packageRoot, encoding: "utf8" });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const dest = path.join(home, "plugins", "lithermes");
    assert.equal(fs.readFileSync(path.join(dest, markerName), "utf8"), markerToken);
    assert.equal(fs.existsSync(path.join(dest, "auto_update.py")), true);
    const manifest = JSON.parse(fs.readFileSync(path.join(home, "lithermes", "install-manifest.json"), "utf8"));
    assert.equal(manifest.distribution, "npm");
    assert.ok(manifest.files.some((entry) => entry.path === markerName));
    assert.ok(manifest.files.some((entry) => entry.path === "auto_update.py"));
    const installedCore = fs.readFileSync(path.join(dest, "core.py"), "utf8");
    assert.equal(installedCore.includes("import auto_update"), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("payload has no home-delete literal and no bang immediately before a backtick", () => {
  const hits = [];
  for (const file of walk(payload)) {
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    const relative = path.relative(payload, file);
    if (text.includes("rm -rf ~/")) hits.push(`${relative}: rm -rf ~/`);
    if (text.includes("!`")) hits.push(`${relative}: bang-backtick`);
  }
  assert.deepEqual(hits, []);
});

test("the live skin object is not assigned a banner logo", () => {
  const source = fs.readFileSync(path.join(payload, "lit_mark.py"), "utf8");
  assert.equal(source.includes("banner_logo"), false);
});

test("review-work puts -- before a caller-supplied diff base", () => {
  const source = fs.readFileSync(path.join(payload, "core_review.py"), "utf8");
  assert.match(source, /\["diff", "--name-only", "-z", "--", base\]/);
  assert.match(source, /\["diff", "--", base\]/);
});

test("a missing PyYAML import is named instead of disappearing inside a bare except", () => {
  const source = fs.readFileSync(path.join(payload, "auto_handoff.py"), "utf8");
  assert.match(source, /PyYAML is not importable/);
});
