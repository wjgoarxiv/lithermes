const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
const skillRoot = path.join(pluginRoot, "skills", "lit-scientific-visualization");
const mirrorRoot = path.join(pluginRoot, "vendor", "scientific-visualization");
const aggregateHash = "fe87715f1bf2992fae7fdb0b25af2e10fbf6f3c15fd0afe3e5f5bca90fa00091";
const expectedFiles = new Map([
  ["SKILL.md", "d6084a7e3adf283157820ea20dbe1b46fa22fa1be17b138ab1203be550f4ef68"],
  ["assets/color_palettes.py", "ffea28da930406ecb11bbeaebfc530dfac40b772827a7653f449cb3b0bb35309"],
  ["assets/nature.mplstyle", "6a7343788bf772b7e1bc813d094f7bafa97c1e5544586e7b76002ad8547229b6"],
  ["assets/presentation.mplstyle", "e3ee23f0470d7fb07a0be75cd1210e231becfc2f5267aa404e4186aa077a3339"],
  ["assets/publication.mplstyle", "18447af3bc47310d23fc27255413c23d8bbe3ff441463cc54fcecdfacd205bea"],
  ["evals/evals.json", "00db6d77a6fbd92e00dca6b8dc1a8c7818c22d3e97500ad3c125bc7cf60262e1"],
  ["references/color_palettes.md", "0298691c8de8379570488a7b7768663971bc20af1fb05d464c5438d43a21dcfa"],
  ["references/journal_requirements.md", "56fdde590a9d778547dbcb609b77d86f1f31865e803bcecca5d8c4c72b91b3c7"],
  ["references/matplotlib_examples.md", "c99cd4f83e2452773e9580e2fa0984e61433c7a9b57ca0d2562dc400dfe4f83d"],
  ["references/mdanalysis_martini_visualization.md", "abcb3c61f1c3984ba9014d9ae197b726d23c1df844dc90988ecc4d8f0e349bfe"],
  ["references/publication_guidelines.md", "d9f5d0f115872c4c190a11d83432d44635e38ef9f1740db471fcc70f4c91dd2c"],
  ["references/seaborn_for_publications.md", "2da2147ae8974b4b5d16096c1484b982d5d1e5f91113808ebfd12111a0a6597a"],
  ["scripts/figure_export.py", "b22c7708afaf2a1cfa4f821eb9230d4262f1d52948af7f0815855aa9d0960403"],
  ["scripts/style_presets.py", "e9d450bd4ab6b11303b02d5029177c8d49466cc597648d12de0ecdb7620f64c4"],
  ["tests/test_figure_export.py", "b18414369e6721ad93d417914114d71af006248675eb20bb1f4989c48ec9a58e"],
  ["tests/test_style_presets.py", "ff0e190196480848f1fea2398220038771f386ee7967a0ef122b0dfbca3aed46"],
]);

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sha256(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function listFiles(root, base = root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join("/")];
  });
}

function canonicalAggregate(entries) {
  const records = [...entries]
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([relative, hash]) => `${hash}  045_scientific-visualization/${relative}\n`)
    .join("");
  return sha256Bytes(Buffer.from(records, "utf8"));
}

test("science mirror preserves exactly the 16 canonical authored files", () => {
  const bundledFiles = listFiles(mirrorRoot).sort();
  assert.deepEqual(bundledFiles, [...expectedFiles.keys()].sort());
  for (const [relative, expectedHash] of expectedFiles) {
    assert.equal(sha256(path.join(mirrorRoot, relative)), expectedHash, relative);
  }
  assert.equal(canonicalAggregate(expectedFiles), aggregateHash);
  assert.equal(
    canonicalAggregate(new Map([...expectedFiles].map(([relative]) => [relative, sha256(path.join(mirrorRoot, relative))]))),
    aggregateHash,
  );
  assert.equal(bundledFiles.some((file) => file.includes("__pycache__") || file.endsWith(".pyc")), false);
});

test("science provenance, MIT authorization, and aggregate manifest remain outside the mirror", () => {
  const origin = JSON.parse(fs.readFileSync(path.join(skillRoot, "ORIGIN.json"), "utf8"));
  const provenance = fs.readFileSync(path.join(pluginRoot, "vendor", "provenance", "045_scientific-visualization.md"), "utf8");
  const notice = fs.readFileSync(path.join(pluginRoot, "vendor", "NOTICE.md"), "utf8");
  const license = fs.readFileSync(path.join(pluginRoot, "vendor", "licenses", "045_scientific-visualization-MIT.txt"), "utf8");

  assert.equal(origin.canonicalCommit, "235ed3af614a7becaee6ef1d1a18e5c4b13994f4");
  assert.equal(origin.canonicalDirectory, "045_scientific-visualization");
  assert.equal(origin.fileCount, 16);
  assert.equal(origin.aggregateSha256, aggregateHash);
  assert.match(origin.aggregateAlgorithm, /two ASCII spaces/);
  assert.deepEqual(Object.fromEntries(origin.files.map((entry) => [entry.path, entry.sha256])), Object.fromEntries(expectedFiles));
  assert.match(provenance, /author-controlled private skill repository/i);
  assert.match(provenance, /52051b3164b0d5c3440cc312c4fa2817b31a1800/);
  assert.match(notice, /color palette/i);
  assert.match(notice, /CP\/SDS/i);
  assert.match(notice, /time-sensitive/i);
  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026 wjgoarxiv/);
  assert.equal(fs.existsSync(path.join(skillRoot, "LICENSE.txt")), false);
  assert.equal(fs.existsSync(path.join(skillRoot, "NOTICE.md")), false);
  assert.equal(fs.existsSync(path.join(skillRoot, "PROVENANCE.md")), false);
});

test("science adapter is Hermes-native and resolves immutable scripts and assets", () => {
  const adapter = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  assert.match(adapter, /^---\nname: lit-scientific-visualization\n/m);
  assert.match(adapter, /lithermes_llm_contract\/v1/);
  assert.match(adapter, /🔥 \*\*LIT IGNITED · lit-scientific-visualization\*\* 🔥/u);
  assert.match(adapter, /\.\.\/\.\.\/vendor\/scientific-visualization\/SKILL\.md/);
  assert.match(adapter, /\.\.\/\.\.\/vendor\/scientific-visualization\/scripts\/figure_export\.py/);
  assert.match(adapter, /\.\.\/\.\.\/vendor\/scientific-visualization\/assets\/publication\.mplstyle/);
  assert.match(adapter, /assets\/.*Python's import path/);
  assert.match(adapter, /exact_natural_routes:[\s\S]*lit-scientific-visualization[\s\S]*lit scientific visualization/);
  assert.match(adapter, /quoted\/code forms, mixed prompts/);
  assert.match(adapter, /no silent (pip|uv)|never silently (pip|uv)/i);
  assert.match(adapter, /DEGRADED/);
});

test("offline installer preserves science hashes and excludes generated bytecode", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-science-home-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [path.join(packageRoot, "bin", "lithermes.js"), "install", "--yes", "--offline", "--no-hud", "--hermes-home", home],
    { cwd: packageRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const installedRoot = path.join(home, "plugins", "lithermes", "vendor", "scientific-visualization");
  const manifest = JSON.parse(fs.readFileSync(path.join(home, "lithermes", "install-manifest.json"), "utf8"));
  const installedEntries = new Map(manifest.files.map((entry) => [entry.path, entry.sha256]));
  for (const [relative, expectedHash] of expectedFiles) {
    const manifestPath = path.posix.join("vendor", "scientific-visualization", relative);
    assert.equal(sha256(path.join(installedRoot, relative)), expectedHash, relative);
    assert.equal(installedEntries.get(manifestPath), expectedHash, manifestPath);
  }
  assert.equal(listFiles(installedRoot).some((file) => file.includes("__pycache__") || file.endsWith(".pyc")), false);
});

test("npm pack retains science source and excludes pycache", (t) => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-science-pack-"));
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  // --ignore-scripts is load-bearing, not incidental. Without it `npm pack` fires
  // `prepack` -> `clean:payload`, which rm -rf's every __pycache__ under the REAL
  // assets/ tree (11 directories, measured) while other tests and any concurrent
  // gate run are reading it. That is a destructive writer inside the tree under
  // test, and it is the same defect already fixed in pack-paths.test.js.
  //
  // Skipping the script does not weaken this test. The pycache exclusion is
  // enforced by the `files` globs in package.json ("!assets/**/__pycache__/**",
  // "!assets/**/*.pyc"), not by prepack: packing with __pycache__ present and
  // scripts disabled still yields 0 pycache entries in the tarball. So the
  // assertion below now proves the packaging CONFIG excludes pycache, which is
  // the property that actually ships, rather than proving a pre-step deleted the
  // files first.
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const metadata = JSON.parse(packed.stdout);
  const tarball = path.join(destination, metadata[0].filename);
  const listed = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  const entries = listed.stdout.split("\n");
  for (const relative of expectedFiles.keys()) {
    assert.ok(
      entries.includes(`package/assets/lithermes-plugin/vendor/scientific-visualization/${relative}`),
      relative,
    );
  }
  assert.equal(entries.some((entry) => entry.includes("__pycache__") || entry.endsWith(".pyc")), false);
});

test("package files explicitly retain the scoped science vendor payload", () => {
  const files = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).files;
  assert.ok(files.includes("assets/lithermes-plugin/vendor/scientific-visualization/**"));
});
