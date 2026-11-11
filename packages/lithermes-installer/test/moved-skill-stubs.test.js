const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { requiredSkills } = require("../src/lib/skillPayload");
const { readLock } = require("../scripts/sync-skills-lock");

// The five content families moved to wjgoarxiv-skills; each id keeps a same-name stub here.
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

test("every moved id is a stub that names its wjgoarxiv-skills path and the Hermes copy line", () => {
  for (const [id, family] of Object.entries(MOVED)) {
    const text = stub(id);
    assert.match(text, new RegExp(`^---\\nname: ${id}\\n`), id);
    assert.ok(text.includes(`plugins/${family}/skills/${id}`), `${id} names its repository path`);
    assert.ok(
      text.includes(`cp -R "<path to your wjgoarxiv-skills clone>/plugins/${family}/skills/${id}" "\${HERMES_HOME:-$HOME/.hermes}/skills/"`),
      `${id} carries the one-skill copy line`,
    );
    assert.ok(text.includes(`skill_view("${id}")`), `${id} loads the installed copy by its bare name`);
    assert.doesNotMatch(text, /\/Users\/|\/home\/|\/private\/tmp/, `${id} names no private path`);
    for (const heading of ["#contract.activation", "#contract.inputs", "#contract.mode_matrix", "#contract.procedure",
      "#contract.outputs", "#contract.evidence", "#contract.hard_stops", "#contract.anti_patterns"]) {
      assert.ok(text.includes(`## ${heading}`), `${id} keeps ${heading}`);
    }
    assert.ok(requiredSkills.includes(id), `${id} stays a required payload skill`);
  }
  assert.ok(stub("lit-scientific-visualization").includes("plugins/figures/vendor/scientific-visualization"));
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
