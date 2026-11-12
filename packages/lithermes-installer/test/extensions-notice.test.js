const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { runAutomaticUpdate } = require("../src/lib/updateNotifier");
const { autoUpdateDoctorLines } = require("../src/lib/updateDoctor");

const pkg = path.resolve(__dirname, "..");
const bin = path.join(pkg, "bin", "lithermes.js");
const version = require(path.join(pkg, "package.json")).version;
const plainEnv = { NO_COLOR: "1", LITHERMES_NO_UPDATE_CHECK: "1", LITHERMES_NO_AUTO_UPDATE: "1", XDG_CACHE_HOME: "" };

function home(prefix = "lithermes-ext-notice-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function install(hermesHome, extra = [], env = {}) {
  return spawnSync(process.execPath, [bin, "install", "--yes", "--offline", "--no-style", "--no-hud", "--hermes-home", hermesHome, ...extra], {
    cwd: hermesHome,
    encoding: "utf8",
    env: { ...process.env, ...plainEnv, HOME: hermesHome, HERMES_HOME: hermesHome, ...env },
  });
}

function manifestFile(hermesHome) {
  return path.join(hermesHome, "lithermes", "install-manifest.json");
}

// Pretend the installed copy came from an older release, so the next install is an upgrade.
function ageInstall(hermesHome, from = "1.0.39") {
  const manifest = JSON.parse(fs.readFileSync(manifestFile(hermesHome), "utf8"));
  fs.writeFileSync(manifestFile(hermesHome), JSON.stringify({ ...manifest, version: from }, null, 2));
}

const NOTICE_LINES = [
  "LitFamily extensions",
  "LitHermes's core is complete and works on its own.",
  "are now LitFamily extensions, kept on the extension shelf at",
  "https://github.com/wjgoarxiv/wjgoarxiv-skills",
  "full LitFamily experience",
  "git clone https://github.com/wjgoarxiv/wjgoarxiv-skills.git",
  'mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills"',
  'cp -R wjgoarxiv-skills/variants/lithermes/<id> "${HERMES_HOME:-$HOME/.hermes}/skills/"',
];

test("a fresh install prints the LitFamily extensions notice and leaves it for the first session", () => {
  const h = home();
  const result = install(h);
  assert.equal(result.status, 0, result.stderr);
  for (const line of NOTICE_LINES) assert.ok(result.stdout.includes(line), `missing: ${line}\n${result.stdout}`);
  for (const id of ["lit-pptx", "lit-docx", "lit-diagram-drawer", "lit-schematic", "lit-scientific-visualization",
    "frontend-ui-ux", "visual-qa", "lit-typographic-motion", "readme-studio"]) {
    assert.ok(result.stdout.includes(id), id);
  }
  const block = result.stdout.slice(result.stdout.indexOf("LitFamily extensions")).trimEnd().split("\n");
  assert.ok(block.length <= 10, `the notice stays short (${block.length} lines)`);
  assert.doesNotMatch(result.stdout, /\x1b\[/, "no colour under NO_COLOR");
  assert.doesNotMatch(result.stdout, /old version left these behind/, "a fresh install has nothing left behind");
  const pending = JSON.parse(fs.readFileSync(path.join(h, "lithermes", "notices", "extensions.json"), "utf8"));
  assert.equal(pending.kind, "extensions");
  assert.equal(pending.version, version);
  assert.equal(pending.upgradedFrom, null);
});

test("an upgrade names the caches and update backups the old version left, and only those that exist", () => {
  const h = home();
  assert.equal(install(h).status, 0);
  const cache = path.join(h, "xdg-cache");
  const motion = path.join(cache, "lithermes", "motion");
  const office = path.join(h, ".cache", "lithermes", "office");
  const backups = path.join(h, "lithermes", "auto-update");
  for (const dir of [motion, office, backups]) fs.mkdirSync(dir, { recursive: true });
  ageInstall(h);
  const result = install(h, [], { XDG_CACHE_HOME: cache });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`Upgraded LitHermes 1\\.0\\.39 → ${version.replace(/\./g, "\\.")}`));
  assert.match(result.stdout, /The old version left these behind\. If you do not install those extensions, you can delete them:/);
  for (const dir of [motion, office, backups]) assert.ok(result.stdout.includes(`    ${dir}`), dir);
  assert.ok(!result.stdout.includes(path.join(cache, "lithermes", "office")), "a folder that does not exist is not named");
  const pending = JSON.parse(fs.readFileSync(path.join(h, "lithermes", "notices", "extensions.json"), "utf8"));
  assert.equal(pending.upgradedFrom, "1.0.39");
  assert.deepEqual(pending.leftovers.sort(), [motion, office, backups].sort());
});

test("a reinstall of the same version prints no notice and writes none", () => {
  const h = home();
  assert.equal(install(h).status, 0);
  fs.unlinkSync(path.join(h, "lithermes", "notices", "extensions.json"));
  const again = install(h);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /already up to date/);
  assert.doesNotMatch(again.stdout, /LitFamily extensions/);
  assert.equal(fs.existsSync(path.join(h, "lithermes", "notices", "extensions.json")), false);
});

test("install --json keeps the notice out of its output", () => {
  const h = home();
  const result = install(h, ["--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /LitFamily extensions|wjgoarxiv-skills/);
});

test("a changed plugin folder blocks the install, names each file and the --force way out, and keeps the files", () => {
  const h = home();
  assert.equal(install(h).status, 0);
  const plugin = path.join(h, "plugins", "lithermes");
  const edited = path.join(plugin, "skills", "lit-pptx", "SKILL.md");
  const added = path.join(plugin, "skills", "lit-pptx", "my-template-notes.md");
  fs.appendFileSync(edited, "\n<!-- my note -->\n");
  fs.writeFileSync(added, "my notes\n");
  const editedBytes = fs.readFileSync(edited);
  ageInstall(h);
  const refused = install(h);
  assert.equal(refused.status, 5);
  const text = refused.stdout + refused.stderr;
  assert.match(text, /not manifest-owned: skills\/lit-pptx\/my-template-notes\.md \(added\), skills\/lit-pptx\/SKILL\.md \(changed\)\./);
  assert.match(text, /Nothing was changed\. To replace it anyway, run the same install with --force; it first keeps a copy of those files under /);
  assert.ok(text.includes(path.join(h, "lithermes", "replaced-files")), text);
  assert.ok(text.includes(`Skills of your own belong in ${path.join(h, "skills")}`), text);
  assert.deepEqual(fs.readFileSync(edited), editedBytes, "a refusal leaves the edited file alone");
  assert.equal(fs.readFileSync(added, "utf8"), "my notes\n");

  const forced = install(h, ["--force"]);
  assert.equal(forced.status, 0, forced.stderr);
  const kept = /your changed files: copied to (\S+) before the plugin folder was replaced/.exec(forced.stdout);
  assert.ok(kept, forced.stdout);
  assert.ok(kept[1].startsWith(path.join(h, "lithermes", "replaced-files")));
  assert.deepEqual(fs.readFileSync(path.join(kept[1], "skills", "lit-pptx", "SKILL.md")), editedBytes, "the edit survives in the copy");
  assert.equal(fs.readFileSync(path.join(kept[1], "skills", "lit-pptx", "my-template-notes.md"), "utf8"), "my notes\n");
  assert.equal(fs.existsSync(added), false, "--force still replaces the plugin folder");
});

function blockedUpdate(h) {
  return runAutomaticUpdate({
    currentVersion: "1.0.39",
    latestVersion: version,
    hermesHome: h,
    env: { PATH: process.env.PATH, HOME: h },
    // The real install child of this package, offline, in place of `npx --package`.
    spawnSync: (_command, argv, options) => spawnSync(process.execPath, [bin, ...argv.slice(argv.indexOf("install")), "--offline"], {
      ...options, env: { ...options.env, ...plainEnv },
    }),
    doctor: () => ({ ok: true }),
  });
}

test("an automatic update refused by a changed file leaves a notice for the next reply, once per version and files", async () => {
  const h = home();
  assert.equal(install(h).status, 0);
  const edited = path.join(h, "plugins", "lithermes", "skills", "lit-pptx", "SKILL.md");
  fs.appendFileSync(edited, "\n<!-- my note -->\n");
  const editedBytes = fs.readFileSync(edited);
  ageInstall(h);
  fs.rmSync(path.join(h, "lithermes", "notices"), { recursive: true, force: true });

  const result = await blockedUpdate(h);
  assert.equal(result.status, "failed");
  assert.equal(result.rollback.status, "restored");
  assert.deepEqual(result.blockedBy, [{ path: "skills/lit-pptx/SKILL.md", change: "changed" }]);
  assert.deepEqual(fs.readFileSync(edited), editedBytes, "the edited file is back after the rollback");
  const notice = path.join(h, "lithermes", "notices", "update-blocked.json");
  const record = JSON.parse(fs.readFileSync(notice, "utf8"));
  assert.equal(record.kind, "update-blocked");
  assert.equal(record.currentVersion, "1.0.39");
  assert.equal(record.targetVersion, version);
  assert.equal(record.summary, "skills/lit-pptx/SKILL.md (changed)");
  assert.equal(record.remedy, `npx --yes --package @litfamily/lithermes@${version} -- lithermes install --yes --force`);
  assert.equal(record.replacedFilesPath, path.join(h, "lithermes", "replaced-files"));
  const backup = path.join(result.transactionRoot, "backup", "pluginPath", "skills", "lit-pptx", "SKILL.md");
  assert.deepEqual(fs.readFileSync(backup), editedBytes, "the update's own backup holds the edited file too");

  const doctor = autoUpdateDoctorLines(h, { env: {}, isAlive: () => false });
  assert.ok(doctor.some((line) => line.includes("did not install because files in the plugin folder were changed: skills/lit-pptx/SKILL.md (changed)")), doctor.join("\n"));
  assert.ok(doctor.some((line) => line.includes("lithermes install --yes --force")), doctor.join("\n"));

  // The plugin shows it and renames it; the same refusal does not raise it again.
  fs.renameSync(notice, path.join(h, "lithermes", "notices", "update-blocked.shown.json"));
  const again = await blockedUpdate(h);
  assert.equal(again.status, "failed");
  assert.equal(fs.existsSync(notice), false, "the same files blocking the same version are not shown twice");

  // A later install that goes through clears both records.
  assert.equal(install(h, ["--force"]).status, 0);
  assert.equal(fs.existsSync(path.join(h, "lithermes", "notices", "update-blocked.shown.json")), false);
});

test("the installer's extension ids match the plugin's moved-skill list", () => {
  const { EXTENSION_IDS } = require("../src/lib/sessionNotices");
  const contract = fs.readFileSync(path.join(pkg, "assets", "lithermes-plugin", "core_contract.py"), "utf8");
  const block = /MOVED_SKILL_FAMILIES = \{([^}]*)\}/.exec(contract)[1];
  const ids = [...block.matchAll(/"([a-z-]+)": "/g)].map((match) => match[1]);
  assert.deepEqual(EXTENSION_IDS, ids);
});

test("an empty folder or a stray cache file in the plugin folder is named too, so no refusal is silent", async () => {
  const h = home();
  assert.equal(install(h).status, 0);
  const plugin = path.join(h, "plugins", "lithermes");
  fs.mkdirSync(path.join(plugin, "skills", "my-own-skill"));
  fs.mkdirSync(path.join(plugin, "__pycache__"), { recursive: true });
  fs.writeFileSync(path.join(plugin, "__pycache__", "my_helper.cpython-311.pyc"), "compiled\n");
  ageInstall(h);
  const refused = install(h);
  assert.equal(refused.status, 5);
  assert.match(refused.stdout + refused.stderr, /not manifest-owned: __pycache__\/my_helper\.cpython-311\.pyc \(added\), skills\/my-own-skill\/ \(added\)\./);

  fs.rmSync(path.join(h, "lithermes", "notices"), { recursive: true, force: true });
  const result = await blockedUpdate(h);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.blockedBy, [
    { path: "__pycache__/my_helper.cpython-311.pyc", change: "added" },
    { path: "skills/my-own-skill/", change: "added" },
  ]);
  assert.ok(fs.existsSync(path.join(h, "lithermes", "notices", "update-blocked.json")), "the refused update leaves a notice");

  const forced = install(h, ["--force"]);
  assert.equal(forced.status, 0, forced.stderr);
  const kept = /your changed files: copied to (\S+) before the plugin folder was replaced/.exec(forced.stdout);
  assert.ok(kept, forced.stdout);
  assert.equal(fs.readFileSync(path.join(kept[1], "__pycache__", "my_helper.cpython-311.pyc"), "utf8"), "compiled\n");
  assert.ok(fs.statSync(path.join(kept[1], "skills", "my-own-skill")).isDirectory());
});
