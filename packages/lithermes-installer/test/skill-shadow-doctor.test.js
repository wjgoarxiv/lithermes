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
  const shadowedSkillDir = path.join(externalRoot, "frontend-ui-ux");
  fs.mkdirSync(shadowedSkillDir, { recursive: true });
  fs.writeFileSync(path.join(shadowedSkillDir, "SKILL.md"), "# a different frontend-ui-ux skill\n");

  const configText = `skills:\n  external_dirs:\n    - ${externalRoot}\n`;
  const warnings = detectSkillShadows({ configText, hermesHome: home });

  const match = warnings.find((warning) => warning.id === "frontend-ui-ux");
  assert.ok(match, `expected a shadow warning for frontend-ui-ux, got ${JSON.stringify(warnings)}`);
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
  const shadowedSkillDir = path.join(externalRoot, "frontend-ui-ux");
  fs.mkdirSync(shadowedSkillDir, { recursive: true });
  fs.writeFileSync(path.join(shadowedSkillDir, "SKILL.md"), "# a different frontend-ui-ux skill\n");
  writeExternalDirConfig(home, externalRoot);

  const withoutShadow = run(["doctor", "--offline", "--hermes-home", home]);
  const baselineStatus = withoutShadow.status;

  const result = run(["doctor", "--offline", "--hermes-home", home]);
  assert.equal(result.status, baselineStatus, result.stdout + result.stderr);
  assert.match(result.stdout, /WARNING/);
  assert.match(result.stdout, /frontend-ui-ux/);
  assert.match(result.stdout, new RegExp(path.join(shadowedSkillDir, "SKILL.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.stdout, /lithermes:frontend-ui-ux/);
});

test("doctor prints no skill shadow warning and keeps its status when there is no collision", (t) => {
  const home = makeTempHome(t);
  installLitHermes(home);

  const result = run(["doctor", "--offline", "--hermes-home", home]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /WARNING/);
  assert.match(result.stdout, /skill shadow check: PASS/);
});
