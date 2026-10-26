const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { typeTreatment, stageTreatment } = require("./motion-director-support");

const skillRoot = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const load = () => import(pathToFileURL(path.join(skillRoot, "engine", "treatment.mjs")).href);
const strip = (treatment, ...keys) => {
  const copy = JSON.parse(JSON.stringify(treatment));
  for (const key of keys) delete copy[key];
  return copy;
};

test("story: a treatment without one fails naming the field", async () => {
  const { validateTreatment } = await load();
  for (const treatment of [typeTreatment(), stageTreatment()]) {
    const result = validateTreatment(strip(treatment, "story"));
    assert.equal(result.ok, false, "expected the story rule to fail");
    assert.equal(result.field, "story", result.message);
  }
});

test("story: the turn must differ and the beat must sit inside the film", async () => {
  const { validateTreatment } = await load();
  const same = typeTreatment();
  same.story.turn = same.story.expect;
  assert.equal(validateTreatment(same).field, "story.turn");
  const outside = typeTreatment();
  outside.story.beat = outside.beats.length;
  assert.equal(validateTreatment(outside).field, "story.beat");
});

test("protagonist: a stage treatment without one fails", async () => {
  const { validateTreatment } = await load();
  const result = validateTreatment(strip(stageTreatment(), "protagonist"));
  assert.equal(result.ok, false, "expected the protagonist rule to fail");
  assert.equal(result.field, "protagonist", result.message);
  const typeResult = validateTreatment(strip(typeTreatment(), "protagonist"));
  assert.equal(typeResult.ok, true, `the type path needs no protagonist: ${typeResult.message}`);
});

test("protagonist: acts must cover half the film including the turn shot", async () => {
  const { validateTreatment } = await load();
  const brief = stageTreatment();
  brief.protagonist.acts = [{ beat: 0, action: "the keeper lifts the lamp" }];
  assert.equal(validateTreatment(brief).field, "protagonist.acts");
  const elsewhere = stageTreatment();
  elsewhere.story.beat = 2;
  elsewhere.protagonist.acts = elsewhere.protagonist.acts.filter((act) => act.beat !== 2);
  assert.equal(validateTreatment(elsewhere).field, "protagonist.acts");
});

test("depth: a depth3d subject needs depth 3d, and 3d needs the subject", async () => {
  const { validateTreatment } = await load();
  const solid = stageTreatment();
  solid.visualDevices.unshift({ kind: "depth3d", role: "subject", beats: [0, 1, 2] });
  assert.equal(validateTreatment(solid).field, "depth");
  const flat = stageTreatment();
  flat.depth = "3d";
  assert.equal(validateTreatment(flat).field, "depth");
  const three = stageTreatment();
  three.visualDevices.unshift({ kind: "depth3d", role: "subject", beats: [0, 1, 2] });
  three.depth = "3d";
  three.render3d = "three";
  const result = validateTreatment(three);
  assert.equal(result.ok, true, `a depth 3d three.js film validates: ${result.message}`);
});

test("world: a rich stage film without one fails", async () => {
  const { validateTreatment } = await load();
  const result = validateTreatment(strip(stageTreatment(), "world"));
  assert.equal(result.ok, false, "expected the world rule to fail");
  assert.equal(result.field, "world", result.message);
});
