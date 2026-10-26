const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { stageTreatment, writeTreatment } = require("./motion-director-support");

const skillRoot = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const load = (name) => import(pathToFileURL(path.join(skillRoot, "engine", name)).href);
const cli = path.join(skillRoot, "bin", "motion.mjs");
const temps = [];
const tmp = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(dir); return dir; };
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

function blenderTreatment() {
  const t = stageTreatment({ durationSec: 8 });
  t.visualDevices.unshift({ kind: "depth3d", role: "subject", beats: [0, 1, 2] });
  t.depth = "3d";
  t.render3d = "blender";
  return t;
}

test("findBlender: override first, then the app, then PATH, else null", async () => {
  const { findBlender } = await load("blender.mjs");
  assert.equal(findBlender({ env: {}, exists: () => false, platform: "linux" }), null);
  const fake = tmp("blender-bin-");
  fs.writeFileSync(path.join(fake, "blender"), "x");
  assert.deepEqual(findBlender({ env: { PATH: fake }, exists: (p) => p === path.join(fake, "blender"), platform: "linux" }), { path: path.join(fake, "blender"), source: "PATH" });
  assert.deepEqual(findBlender({ env: { LITHERMES_BLENDER: "/opt/blender" }, exists: () => true }), { path: "/opt/blender", source: "LITHERMES_BLENDER" });
  assert.equal(findBlender({ env: { LITHERMES_BLENDER: "/opt/missing" }, exists: () => false }), null);
});

test("blenderArgs: preview stills at the beat midpoints, final the frame range", async () => {
  const { blenderArgs } = await load("blender.mjs");
  const t = blenderTreatment();
  const preview = blenderArgs({ treatment: t, scene: "s.py", out: "d", quality: "preview" });
  assert.ok(preview.includes("-b") && preview.includes("--factory-startup"));
  const stills = preview[preview.indexOf("--stills") + 1].split(",");
  assert.deepEqual(stills, ["1.333", "4", "6.667"], "the beat midpoints of the 8 s film");
  const final = blenderArgs({ treatment: t, scene: "s.py", out: "d", quality: "final" });
  assert.equal(final[final.indexOf("--frames") + 1], "1-240", "8 s at 30 fps");
  assert.ok(final.includes("--seed"));
  assert.throws(() => blenderArgs({ treatment: t, scene: "s.py", out: "d", quality: "nope" }), /preview or final/);
});

test("rungNote: a 2d film gets no note, a 3d film gets its rung", async () => {
  const { rungNote } = await load("scaffold.mjs");
  assert.equal(rungNote("out", stageTreatment({ durationSec: 8 })), null);
  const three = blenderTreatment();
  three.render3d = "three";
  assert.match(rungNote("out", three), /GPU rung/);
  const note = rungNote("out", blenderTreatment());
  assert.match(note, /Blender is (here|not installed here)/);
});

test("blender CLI: no treatment exits 16, a type path exits 16, render3d three exits 2", () => {
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  assert.equal(run(["blender", "--out", tmp("blender-empty-")]).status, 16);
  const typeOut = tmp("blender-type-");
  const { typeTreatment } = require("./motion-director-support");
  writeTreatment(typeOut, typeTreatment());
  assert.equal(run(["blender", "--out", typeOut]).status, 16);
  const threeOut = tmp("blender-three-");
  const three = blenderTreatment();
  three.render3d = "three";
  writeTreatment(threeOut, three);
  const wrong = run(["blender", "--out", threeOut]);
  assert.equal(wrong.status, 2, wrong.stderr);
  assert.match(wrong.stderr, /render3d "blender"/);
});

test("blender CLI: a blender film without scene.py exits 17", () => {
  const out = tmp("blender-noscene-");
  writeTreatment(out, blenderTreatment());
  const run = spawnSync(process.execPath, [cli, "blender", "--out", out], { encoding: "utf8" });
  assert.equal(run.status, 17, run.stderr);
  assert.match(run.stderr, /scene\.py is missing/);
});
