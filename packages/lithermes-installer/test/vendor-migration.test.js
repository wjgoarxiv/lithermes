const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { assetRoot, installLitHermes, manifestPath, pluginDest } = require("../src/lib/install");
const { copyTree, sha256 } = require("../src/lib/files");

const packageVersion = require("../package.json").version;
const migrations = [
  { legacy: "vendor/022_handoff", canonical: "vendor/handoff" },
  { legacy: "vendor/045_scientific-visualization", canonical: "vendor/scientific-visualization" },
];

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function regularFiles(root, base = root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...regularFiles(full, base));
    else if (entry.isFile()) files.push(path.relative(base, full).split(path.sep).join("/"));
    else throw new Error(`fixture contains unsupported entry: ${path.relative(base, full)}`);
  }
  return files.sort();
}

function seedNumberedInstallation(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-vendor-migration-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dest = pluginDest(home);
  fs.mkdirSync(dest, { recursive: true });
  copyTree(assetRoot, dest);

  // The fixture is derived from the bundled source, then deliberately put in
  // the legacy numbered layout. It does not depend on installer output.
  for (const { legacy, canonical } of migrations) {
    const oldPath = path.join(dest, legacy);
    const newPath = path.join(dest, canonical);
    if (fs.existsSync(newPath)) fs.renameSync(newPath, oldPath);
  }

  const files = regularFiles(dest).map((relative) => ({
    path: relative,
    sha256: sha256(path.join(dest, relative)),
  }));
  fs.mkdirSync(path.dirname(manifestPath(home)), { recursive: true });
  fs.writeFileSync(manifestPath(home), JSON.stringify({ version: packageVersion, files }, null, 2));
  return {
    home,
    dest,
    flags: { yes: true, "hermes-home": home, "no-patch-installed-hermes": true },
    files,
  };
}

function manifestEntries(home) {
  return JSON.parse(fs.readFileSync(manifestPath(home), "utf8")).files;
}

function mapCanonical(relative) {
  for (const { legacy, canonical } of migrations) {
    if (relative === legacy) return canonical;
    if (relative.startsWith(`${legacy}/`)) return `${canonical}${relative.slice(legacy.length)}`;
  }
  return relative;
}

test("[slice31-hermes] migrates pristine numbered vendor payloads to canonical paths", (t) => {
  const { home, dest, flags, files: before } = seedNumberedInstallation(t);
  const beforeVendor = new Map(
    before
      .filter((entry) => migrations.some(({ legacy }) => entry.path === legacy || entry.path.startsWith(`${legacy}/`)))
      .map((entry) => [entry.path, {
        bytes: fs.readFileSync(path.join(dest, entry.path)),
        mode: fs.lstatSync(path.join(dest, entry.path)).mode & 0o777,
      }]),
  );

  installLitHermes(flags);

  const installed = manifestEntries(home).map((entry) => entry.path);
  assert.ok(installed.some((entry) => entry.startsWith("vendor/handoff/")), "canonical handoff path is recorded");
  assert.ok(installed.some((entry) => entry.startsWith("vendor/scientific-visualization/")), "canonical science path is recorded");
  assert.equal(installed.some((entry) => entry.startsWith("vendor/022_handoff/")), false, "numbered handoff path is absent");
  assert.equal(installed.some((entry) => entry.startsWith("vendor/045_scientific-visualization/")), false, "numbered science path is absent");
  for (const [legacy, expected] of beforeVendor) {
    const canonical = mapCanonical(legacy);
    const file = path.join(dest, canonical);
    assert.deepEqual(fs.readFileSync(file), expected.bytes, canonical);
    assert.equal(fs.lstatSync(file).mode & 0o777, expected.mode, canonical);
  }
  assert.equal(fs.existsSync(path.join(dest, "vendor", "022_handoff")), false);
  assert.equal(fs.existsSync(path.join(dest, "vendor", "045_scientific-visualization")), false);
});

for (const mutation of ["modified", "foreign", "symlink", "nonregular", "unsupported"]) {
  test(`[slice31-hermes] refuses and preserves numbered vendor ${mutation} state`, (t) => {
    const { home, dest, flags } = seedNumberedInstallation(t);
    const handoff = path.join(dest, "vendor", "022_handoff");
    const target = path.join(handoff, "SKILL.md");
    if (mutation === "modified") {
      fs.appendFileSync(target, "\nuser modification\n");
    } else if (mutation === "foreign") {
      fs.writeFileSync(path.join(handoff, "foreign-user-file.txt"), "user content\n");
    } else if (mutation === "symlink") {
      const outside = path.join(home, "outside-skill.md");
      fs.renameSync(target, outside);
      fs.symlinkSync(outside, target);
    } else if (mutation === "nonregular") {
      fs.unlinkSync(target);
      const fifo = spawnSync("mkfifo", [target], { encoding: "utf8" });
      assert.equal(fifo.status, 0, fifo.stderr || "mkfifo failed");
    } else if (mutation === "unsupported") {
      fs.mkdirSync(path.join(dest, "vendor", "999_unsupported"));
      fs.writeFileSync(path.join(dest, "vendor", "999_unsupported", "SKILL.md"), "unsupported\n");
    }

    const manifestBefore = fs.readFileSync(manifestPath(home));
    assert.throws(() => installLitHermes(flags), (error) => error.exitCode === 5);
    assert.deepEqual(fs.readFileSync(manifestPath(home)), manifestBefore);
    assert.equal(fs.existsSync(path.join(dest, "vendor", "handoff")), false);
    assert.equal(fs.existsSync(path.join(dest, "vendor", "scientific-visualization")), false);
    assert.equal(fs.existsSync(path.join(dest, "vendor", "022_handoff")), true);
    assert.equal(fs.existsSync(path.join(dest, "vendor", "045_scientific-visualization")), true);
    if (mutation === "nonregular") {
      // FIFO is checked only through metadata; this assertion never opens it.
      const stat = fs.lstatSync(target);
      assert.equal(stat.isFIFO(), true);
      assert.equal(stat.isSymbolicLink(), false);
      assert.equal(stat.mode & 0o777, 0o644);
    } else if (mutation === "symlink") {
      assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
    } else if (mutation === "foreign") {
      assert.equal(fs.readFileSync(path.join(handoff, "foreign-user-file.txt"), "utf8"), "user content\n");
    } else if (mutation === "modified") {
      assert.match(fs.readFileSync(target, "utf8"), /user modification/);
    } else {
      assert.equal(fs.existsSync(path.join(dest, "vendor", "999_unsupported", "SKILL.md")), true);
    }
  });
}

test("[slice31-hermes] canonical migration preserves vendor bytes and modes", (t) => {
  const { home, dest, flags, files: before } = seedNumberedInstallation(t);
  const records = before.filter((entry) => entry.path.startsWith("vendor/"));
  installLitHermes(flags);
  for (const entry of records) {
    const canonical = mapCanonical(entry.path);
    const actual = path.join(dest, canonical);
    assert.equal(digest(fs.readFileSync(actual)), entry.sha256, canonical);
    assert.equal(fs.lstatSync(actual).mode & 0o777, 0o644, canonical);
  }
});
