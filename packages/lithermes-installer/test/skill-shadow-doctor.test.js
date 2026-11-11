const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { detectSkillShadows } = require("../src/lib/check");
const { readExternalSkillDirsConfig } = require("../src/lib/config");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "lithermes.js");

function run(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env },
  });
}

function makeTempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-skill-shadow-"));
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  return home;
}

function installLitHermes(home) {
  const result = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function writeExternalDirConfig(home, externalDir) {
  const configPath = path.join(home, "config.yaml");
  const existing = fs.readFileSync(configPath, "utf8");
  fs.writeFileSync(configPath, `${existing}skills:\n  external_dirs:\n    - ${externalDir}\n`);
}

test("readExternalSkillDirsConfig reads skills.external_dirs entries", () => {
  const text = "skills:\n  external_dirs:\n    - ~/skills\n    - /opt/other-skills\n";
  assert.deepEqual(readExternalSkillDirsConfig(text), ["~/skills", "/opt/other-skills"]);
});

test("readExternalSkillDirsConfig returns an empty list when the key is absent", () => {
  assert.deepEqual(readExternalSkillDirsConfig(""), []);
  assert.deepEqual(readExternalSkillDirsConfig("plugins:\n  enabled:\n    - lithermes\n"), []);
});

test("readExternalSkillDirsConfig fails closed on malformed YAML", () => {
  assert.deepEqual(readExternalSkillDirsConfig("skills:\n  external_dirs: [\n"), []);
});

test("detectSkillShadows warns when an external dir shadows a plugin skill", (t) => {
  const home = makeTempHome(t);
  fs.mkdirSync(home, { recursive: true });
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-skills-"));
  t.after(() => fs.rmSync(externalRoot, { force: true, recursive: true }));
  const shadowedSkillDir = path.join(externalRoot, "debugging");
  fs.mkdirSync(shadowedSkillDir, { recursive: true });
  fs.writeFileSync(path.join(shadowedSkillDir, "SKILL.md"), "# a different debugging skill\n");

  const configText = `skills:\n  external_dirs:\n    - ${externalRoot}\n`;
  const warnings = detectSkillShadows({ configText, hermesHome: home });

  const match = warnings.find((warning) => warning.id === "debugging");
  assert.ok(match, `expected a shadow warning for debugging, got ${JSON.stringify(warnings)}`);
  assert.equal(match.path, path.join(shadowedSkillDir, "SKILL.md"));
  assert.equal(match.source, "skills.external_dirs");
});

test("detectSkillShadows reports no warnings when external_dirs is absent", (t) => {
  const home = makeTempHome(t);
  fs.mkdirSync(home, { recursive: true });
  const warnings = detectSkillShadows({ configText: "", hermesHome: home });
  assert.deepEqual(warnings, []);
});

test("detectSkillShadows reports no warnings when external dirs contain no colliding skill", (t) => {
  const home = makeTempHome(t);
  fs.mkdirSync(home, { recursive: true });
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-skills-"));
  t.after(() => fs.rmSync(externalRoot, { force: true, recursive: true }));
  fs.mkdirSync(path.join(externalRoot, "totally-unrelated-skill"), { recursive: true });
  fs.writeFileSync(path.join(externalRoot, "totally-unrelated-skill", "SKILL.md"), "# unrelated\n");

  const configText = `skills:\n  external_dirs:\n    - ${externalRoot}\n`;
  const warnings = detectSkillShadows({ configText, hermesHome: home });
  assert.deepEqual(warnings, []);
});

test("doctor warns when skills.external_dirs shadows a plugin skill, and exit status is unchanged", (t) => {
  const home = makeTempHome(t);
  installLitHermes(home);
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-skills-"));
  t.after(() => fs.rmSync(externalRoot, { force: true, recursive: true }));
  const shadowedSkillDir = path.join(externalRoot, "debugging");
  fs.mkdirSync(shadowedSkillDir, { recursive: true });
  fs.writeFileSync(path.join(shadowedSkillDir, "SKILL.md"), "# a different debugging skill\n");
  writeExternalDirConfig(home, externalRoot);

  const withoutShadow = run(["doctor", "--offline", "--hermes-home", home]);
  const baselineStatus = withoutShadow.status;

  const result = run(["doctor", "--offline", "--hermes-home", home]);
  assert.equal(result.status, baselineStatus, result.stdout + result.stderr);
  assert.match(result.stdout, /WARNING/);
  assert.match(result.stdout, /debugging/);
  assert.match(result.stdout, new RegExp(path.join(shadowedSkillDir, "SKILL.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.stdout, /lithermes:debugging/);
});

test("doctor prints no skill shadow warning and keeps its status when there is no collision", (t) => {
  const home = makeTempHome(t);
  installLitHermes(home);

  const result = run(["doctor", "--offline", "--hermes-home", home]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /WARNING/);
  assert.match(result.stdout, /skill shadow check: PASS/);
});

// A moved id's bundled SKILL.md is a stub that hands over to the bare-name copy the user installs from
// wjgoarxiv-skills (variants/lithermes/<id>), so that copy is the expected install, not a shadow.
const { pluginDest } = require("../src/lib/install");
const MOVED_IDS = ["lit-pptx", "lit-docx", "lit-diagram-drawer", "lit-schematic", "lit-scientific-visualization",
  "frontend-ui-ux", "visual-qa", "lit-typographic-motion", "readme-studio"];

function placeMovedCopy(home, id) {
  const dir = path.join(home, "skills", id);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  const skill = path.join(dir, "SKILL.md");
  fs.writeFileSync(skill, `---\nname: ${id}\ndescription: the Hermes edition copied from wjgoarxiv-skills\n---\n`);
  fs.writeFileSync(path.join(dir, "scripts", "tool.py"), "print('kept')\n");
  return skill;
}

test("detectSkillShadows does not warn about the installed copy of a moved skill, for every moved id", (t) => {
  const home = makeTempHome(t);
  for (const id of MOVED_IDS) placeMovedCopy(home, id);
  assert.deepEqual(detectSkillShadows({ configText: "", hermesHome: home }), []);
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-skills-"));
  t.after(() => fs.rmSync(externalRoot, { force: true, recursive: true }));
  fs.mkdirSync(path.join(externalRoot, "visual-qa"), { recursive: true });
  fs.writeFileSync(path.join(externalRoot, "visual-qa", "SKILL.md"), "# visual-qa edition\n");
  assert.deepEqual(detectSkillShadows({ configText: `skills:\n  external_dirs:\n    - ${externalRoot}\n`, hermesHome: home }), []);
});

test("doctor reports a moved skill's copy as installed, keeps the shadow check PASS and its status", (t) => {
  const home = makeTempHome(t);
  installLitHermes(home);
  const baseline = run(["doctor", "--offline", "--hermes-home", home]);
  const skill = placeMovedCopy(home, "lit-pptx");
  const result = run(["doctor", "--offline", "--hermes-home", home]);
  assert.equal(result.status, baseline.status, result.stdout + result.stderr);
  assert.match(result.stdout, /skill shadow check: PASS/);
  assert.doesNotMatch(result.stdout, /WARNING: skill "lit-pptx"/);
  assert.ok(result.stdout.includes(`moved skill copy: lit-pptx at ${skill} (local skills); the lithermes:lit-pptx stub hands over to it`), result.stdout);
});

test("an upgrade and an uninstall leave the installed copy of a moved skill byte for byte", (t) => {
  const home = makeTempHome(t);
  installLitHermes(home);
  const skill = placeMovedCopy(home, "lit-pptx");
  const before = [fs.readFileSync(skill), fs.readFileSync(path.join(home, "skills", "lit-pptx", "scripts", "tool.py"))];
  installLitHermes(home);
  assert.ok(fs.existsSync(path.join(pluginDest(home), "skills", "lit-pptx", "SKILL.md")), "the stub is reinstalled");
  const after = run(["uninstall", "--yes", "--hermes-home", home]);
  assert.equal(after.status, 0, after.stdout + after.stderr);
  assert.equal(fs.existsSync(path.join(pluginDest(home), "skills", "lit-pptx", "SKILL.md")), false, "the stub left with the plugin");
  assert.deepEqual([fs.readFileSync(skill), fs.readFileSync(path.join(home, "skills", "lit-pptx", "scripts", "tool.py"))], before);
});
