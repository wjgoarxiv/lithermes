const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const skillRoot = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const cli = path.join(skillRoot, "bin", "motion.mjs");
const temps = [];
const tmp = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(dir); return dir; };
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });
const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

test("styles lists the four house styles and exits 0", () => {
  const result = run(["styles"]);
  assert.equal(result.status, 0, result.stderr);
  for (const id of ["swiss-signal", "tidal", "terminalcore", "paper"]) {
    assert.match(result.stdout, new RegExp(`^${id}:`, "m"), `styles output names ${id}`);
  }
});

test("styles --out writes the versioned style catalog", () => {
  const dir = tmp("motion-styles-");
  const result = run(["styles", "--out", dir, "--format", "9:16"]);
  assert.equal(result.status, 0, result.stderr);
  const catalog = JSON.parse(fs.readFileSync(path.join(dir, "styles.json"), "utf8"));
  assert.equal(catalog.schema, "litfamily.motion-styles/v1");
  assert.equal(catalog.format, "9:16");
  assert.deepEqual(catalog.styles.map((s) => s.id).sort(), ["paper", "swiss-signal", "terminalcore", "tidal"]);
});

test("scaffold without a treatment exits 16 naming the field", () => {
  const result = run(["scaffold", "--out", tmp("motion-scaffold-empty-")]);
  assert.equal(result.status, 16, result.stdout + result.stderr);
  assert.match(result.stderr, /field treatment/, "the error names the missing field");
});

test("an unknown command exits 2 with usage", () => {
  const result = run(["no-such-command"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr + result.stdout, /Usage|usage/);
});

test("scaffoldHtml: the type block is absolutely positioned so place() lands it in its zone", async () => {
  const { scaffoldHtml } = await import(path.join(skillRoot, "engine", "scaffold.mjs"));
  const { stageTreatment } = require("./motion-director-support");
  const html = scaffoldHtml(stageTreatment());
  assert.match(html, /\.type \{ position: absolute;/, "the .type rule must pin the block for left/top/width/height");
});

test("scaffoldHtml: a depth 3d treatment gets the three.js world, a 2d one does not", async () => {
  const { scaffoldHtml } = await import(path.join(skillRoot, "engine", "scaffold.mjs"));
  const { stageTreatment } = require("./motion-director-support");
  const flat = scaffoldHtml(stageTreatment());
  for (const marker of ["importmap", 'id="world"', "HERO", "WORLD", "drawWorld", "preserveDrawingBuffer"]) {
    assert.doesNotMatch(flat, new RegExp(marker), `2d scaffold must not contain ${marker}`);
  }
  const solid = stageTreatment();
  solid.depth = "3d";
  solid.visualDevices.unshift({ kind: "depth3d", role: "subject", beats: [0, 1, 2] });
  const world = scaffoldHtml(solid);
  for (const marker of ["importmap", "/lit/three/three.module.js", 'id="world"', "HERO", "WORLD", "drawWorld", "preserveDrawingBuffer", "RoomEnvironment"]) {
    assert.match(world, new RegExp(marker), `3d scaffold must contain ${marker}`);
  }
});
