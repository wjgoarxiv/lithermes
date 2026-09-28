const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { installLitHermes, manifestPath, pluginDest } = require("../src/lib/install");
const { sha256 } = require("../src/lib/files");

function seedPriorInstall(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-legacy-skill-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dest = pluginDest(home);
  const legacy = path.join(dest, "skills", "lit-korean");
  fs.mkdirSync(path.join(legacy, "references"), { recursive: true });
  fs.mkdirSync(path.join(dest, "skills", "lit-code"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "SKILL.md"), "legacy Korean skill\n");
  fs.writeFileSync(path.join(legacy, "references", "notes.md"), "legacy reference\n");
  fs.writeFileSync(path.join(dest, "skills", "lit-code", "SKILL.md"), "managed sibling skill\n");
  fs.writeFileSync(path.join(dest, "plugin.yaml"), "name: lithermes\n");
  const files = [];
  for (const relative of [
    "plugin.yaml",
    "skills/lit-code/SKILL.md",
    "skills/lit-korean/SKILL.md",
    "skills/lit-korean/references/notes.md",
  ]) {
    files.push({ path: relative, sha256: sha256(path.join(dest, relative)) });
  }
  fs.mkdirSync(path.dirname(manifestPath(home)), { recursive: true });
  fs.writeFileSync(manifestPath(home), JSON.stringify({ version: "1.0.0", files }, null, 2));
  fs.writeFileSync(path.join(home, "config.yaml"), "custom_setting: keep-me\n");
  return {
    home,
    dest,
    legacy,
    flags: { yes: true, "hermes-home": home, "no-patch-installed-hermes": true },
  };
}

function assertNewSkillInstalled(dest) {
  assert.equal(fs.existsSync(path.join(dest, "skills", "lit-humanizer", "SKILL.md")), true);
}

function assertLegacySkillGone(dest) {
  assert.equal(fs.existsSync(path.join(dest, "skills", "lit-korean")), false);
}

test("fresh install exposes lit-humanizer and no legacy skill", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-fresh-humanizer-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const result = installLitHermes({ yes: true, "hermes-home": home, "no-patch-installed-hermes": true });
  assertNewSkillInstalled(pluginDest(home));
  assert.doesNotMatch(result.message, /warning: modified legacy lit-korean skill retained/);
  assertLegacySkillGone(pluginDest(home));
});

test("clean managed lit-korean upgrade removes it through tree replacement", (t) => {
  const { home, dest, flags } = seedPriorInstall(t);
  const result = installLitHermes(flags);
  assertNewSkillInstalled(dest);
  assert.doesNotMatch(result.message, /warning: modified legacy lit-korean skill retained/);
  assert.equal(fs.existsSync(path.join(home, "lithermes", "retained-skills")), false);
  assertLegacySkillGone(dest);
});

test("modified legacy skill is retained atomically outside the active plugin with one warning", (t) => {
  const { home, dest, legacy, flags } = seedPriorInstall(t);
  fs.appendFileSync(path.join(legacy, "SKILL.md"), "\nuser edit\n");
  fs.writeFileSync(path.join(legacy, "personal-notes.md"), "keep this user file\n");
  const expected = new Map([
    ["SKILL.md", fs.readFileSync(path.join(legacy, "SKILL.md"))],
    ["personal-notes.md", fs.readFileSync(path.join(legacy, "personal-notes.md"))],
    ["references/notes.md", fs.readFileSync(path.join(legacy, "references", "notes.md"))],
  ]);

  const result = installLitHermes(flags);
  assertNewSkillInstalled(dest);
  const warnings = result.message.split("\n").filter((line) => line.startsWith("warning: modified legacy lit-korean skill retained at "));
  assert.equal(warnings.length, 1, result.message);
  const retained = warnings[0].slice("warning: modified legacy lit-korean skill retained at ".length);
  assert.equal(path.dirname(retained), path.join(home, "lithermes", "retained-skills"));
  assert.match(path.basename(retained), /^lit-korean-[a-f0-9]{64}$/);
  for (const [relative, bytes] of expected) assert.deepEqual(fs.readFileSync(path.join(retained, relative)), bytes, relative);
  assert.equal(fs.existsSync(legacy), false);
  assertLegacySkillGone(dest);
  const receipt = JSON.parse(fs.readFileSync(manifestPath(home), "utf8"));
  assert.equal(receipt.retainedLegacySkill, retained);
});

test("dry-run previews modified-skill retention without creating or moving files", (t) => {
  const { home, dest, legacy } = seedPriorInstall(t);
  fs.appendFileSync(path.join(legacy, "SKILL.md"), "\nuser edit\n");
  const original = fs.readFileSync(path.join(legacy, "SKILL.md"));
  const manifest = fs.readFileSync(manifestPath(home));
  const config = fs.readFileSync(path.join(home, "config.yaml"));

  const result = installLitHermes({ "dry-run": true, "hermes-home": home });
  assert.match(result.message, /legacy skill migration: would retain modified copy at .*retained-skills[\/]lit-korean-[a-f0-9]{64}/);
  assert.deepEqual(fs.readFileSync(path.join(legacy, "SKILL.md")), original);
  assert.deepEqual(fs.readFileSync(manifestPath(home)), manifest);
  assert.deepEqual(fs.readFileSync(path.join(home, "config.yaml")), config);
  assert.equal(fs.existsSync(path.join(home, "lithermes", "retained-skills")), false);
  assert.equal(fs.existsSync(path.join(dest, "skills", "lit-humanizer")), false);
  assert.equal(fs.existsSync(path.join(home, "lithermes", "install.lock")), false);
});

test("drift outside lit-korean still fails closed and preserves both trees", (t) => {
  const { home, dest, legacy, flags } = seedPriorInstall(t);
  fs.appendFileSync(path.join(legacy, "SKILL.md"), "\nuser edit\n");
  fs.appendFileSync(path.join(dest, "plugin.yaml"), "# unrelated user edit\n");
  const legacyBytes = fs.readFileSync(path.join(legacy, "SKILL.md"));
  const manifest = fs.readFileSync(manifestPath(home));
  const config = fs.readFileSync(path.join(home, "config.yaml"));

  assert.throws(() => installLitHermes(flags), (error) => error.exitCode === 5);
  assert.deepEqual(fs.readFileSync(path.join(legacy, "SKILL.md")), legacyBytes);
  assert.deepEqual(fs.readFileSync(manifestPath(home)), manifest);
  assert.deepEqual(fs.readFileSync(path.join(home, "config.yaml")), config);
  assert.equal(fs.existsSync(path.join(dest, "skills", "lit-humanizer")), false);
  assert.equal(fs.existsSync(path.join(home, "lithermes", "retained-skills")), false);
});
