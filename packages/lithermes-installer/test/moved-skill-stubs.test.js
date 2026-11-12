const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { requiredSkills } = require("../src/lib/skillPayload");
const { readLock } = require("../scripts/sync-skills-lock");

// The five content families moved to wjgoarxiv-skills; each id keeps a same-name stub here. The family is
// where the generic body sits in that repository; Hermes installs the Hermes edition, variants/lithermes/<id>.
const MOVED = {
  "lit-pptx": "decks",
  "lit-docx": "documents",
  "lit-diagram-drawer": "figures",
  "lit-schematic": "figures",
  "lit-scientific-visualization": "figures",
  "frontend-ui-ux": "design",
  "visual-qa": "design",
  "lit-typographic-motion": "video-covers",
  "readme-studio": "video-covers",
};
const PROBE_KEPT = [
  "SKILL.md",
  "references/craft-floor.md",
  "references/slop-register.md",
  "scripts/hostexec.mjs",
  "scripts/probe-page.js",
  "scripts/probe-rules.json",
  "scripts/probe.mjs",
];
const pkg = path.resolve(__dirname, "..");
const plugin = path.join(pkg, "assets", "lithermes-plugin");
const stub = (id) => fs.readFileSync(path.join(plugin, "skills", id, "SKILL.md"), "utf8");

test("every moved id is a stub that names its Hermes edition and the copy line", () => {
  for (const [id, family] of Object.entries(MOVED)) {
    const text = stub(id);
    assert.match(text, new RegExp(`^---\\nname: ${id}\\n`), id);
    assert.ok(text.includes(`variants/lithermes/${id}`), `${id} names its Hermes edition`);
    assert.ok(
      text.includes(`cp -R "<path to your wjgoarxiv-skills clone>/variants/lithermes/${id}" "\${HERMES_HOME:-$HOME/.hermes}/skills/"`),
      `${id} carries the one-skill copy line`,
    );
    assert.ok(!text.includes(`plugins/${family}`), `${id} no longer points at the generic body or its family folder`);
    assert.doesNotMatch(text, /Claude|reload-plugins|Skill\(|Use one form or the other/, `${id} gives no tool-mapping or family-copy advice`);
    assert.ok(text.includes("replaces only its own plugin folder"), `${id} says the installer leaves the copy alone`);
    assert.ok(text.includes(`skill_view("${id}")`), `${id} loads the installed copy by its bare name`);
    assert.doesNotMatch(text, /\/Users\/|\/home\/|\/private\/tmp/, `${id} names no private path`);
    for (const heading of ["#contract.activation", "#contract.inputs", "#contract.mode_matrix", "#contract.procedure",
      "#contract.outputs", "#contract.evidence", "#contract.hard_stops", "#contract.anti_patterns"]) {
      assert.ok(text.includes(`## ${heading}`), `${id} keeps ${heading}`);
    }
    assert.ok(requiredSkills.includes(id), `${id} stays a required payload skill`);
  }
  assert.ok(stub("lit-scientific-visualization").includes("variants/lithermes/lit-scientific-visualization/vendor/scientific-visualization"));
});

test("every stub and every moved notice calls the skill a LitFamily extension", () => {
  for (const id of Object.keys(MOVED)) {
    const text = stub(id);
    assert.match(text, new RegExp(`^description: "A LitFamily extension: ${id} lives on the wjgoarxiv-skills extension shelf`, "m"), id);
    assert.ok(text.includes(`# ${id} (LitFamily extension)`), `${id} heading`);
    assert.ok(text.includes("LitHermes's core works without it, and installing it alongside LitHermes gives the full LitFamily experience"), id);
    assert.ok(text.includes("git clone https://github.com/wjgoarxiv/wjgoarxiv-skills.git"), `${id} gives the clone line`);
    assert.doesNotMatch(text, /on its way|Moved out of LitHermes|\(moved\)/, `${id} drops the moved-out wording`);
  }
  const plugin = (name) => fs.readFileSync(path.join(pkg, "assets", "lithermes-plugin", name), "utf8");
  assert.doesNotMatch(plugin("__init__.py"), /Moved to wjgoarxiv-skills/);
  assert.match(plugin("core_contract.py"), /is a LitFamily extension, kept at \{where\}\/ in the wjgoarxiv-skills repository/);
  assert.match(plugin("core_commands.py"), /a LitFamily extension on the wjgoarxiv-skills shelf/);
  assert.match(plugin("diagnostics.py"), /LitFamily extensions answer through same-name stubs/);
});

test("no moved body ships: the pack holds the stubs, the kept probe and nothing else of the five families", () => {
  const { pack } = readLock();
  for (const [id] of Object.entries(MOVED)) {
    const prefix = `assets/lithermes-plugin/skills/${id}/`;
    const shipped = pack.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length)).sort();
    assert.deepEqual(shipped, id === "frontend-ui-ux" ? PROBE_KEPT : ["SKILL.md"], id);
  }
  for (const gone of ["assets/lithermes-plugin/vendor/scientific-visualization/", "assets/lithermes-plugin/motion_receipts.py",
    "assets/lithermes-plugin/uiux_runtime_common.py", "assets/lithermes-plugin/vendor/provenance/045_scientific-visualization.md"]) {
    assert.equal(pack.some((file) => file.startsWith(gone)), false, `${gone} left the pack`);
  }
});

test("the motion runtime command and its doctor lines left with the film skill", () => {
  const cli = path.join(pkg, "bin", "lithermes.js");
  const result = spawnSync(process.execPath, [cli, "motion-runtime", "status"], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  assert.notEqual(result.status, 0);
  const source = fs.readFileSync(path.join(pkg, "src", "cli.js"), "utf8") + fs.readFileSync(path.join(pkg, "src", "lib", "check.js"), "utf8");
  assert.doesNotMatch(source, /motion-runtime|runtime\.mjs/);
});
