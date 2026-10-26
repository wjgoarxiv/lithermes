const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { typeTreatment, stageTreatment, writeTreatment } = require("./motion-director-support");

const skillRoot = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const load = (name) => import(pathToFileURL(path.join(skillRoot, "engine", name)).href);
const temps = [];
const tmp = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(dir); return dir; };
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

function scoreTreatment() {
  const t = stageTreatment({ durationSec: 8 });
  t.sound = {
    mode: "score", plan: "a house score that drops on the turn",
    events: [
      { t: 2, on: "the tower draws in", kind: "tap" },
      { t: 6, on: "the beam crosses the water", kind: "whoosh" },
    ],
  };
  return t;
}

test("score: the plan takes the style genre and drops on the turn", async () => {
  const { planScore } = await load("score.mjs");
  const plan = planScore({ treatment: scoreTreatment(), durationSec: 8, cutTimes: [4] });
  assert.equal(plan.genre, "house", "swiss-signal scores house");
  assert.match(plan.key, /^[A-G][#b]?$/);
  assert.ok(["major", "minor"].includes(plan.mode), `mode, got ${plan.mode}`);
  assert.ok(plan.bpm >= 120 && plan.bpm <= 126, `house tempo band, got ${plan.bpm}`);
  const drop = plan.sections.find((s) => s.kind === "drop");
  assert.ok(drop, "the arrangement has a drop");
  assert.ok(plan.kicks.some((t) => t >= drop.t0 && t < drop.t1), "kicks land in the drop");
});

test("score: the same treatment builds the same bytes twice", async () => {
  const { buildScore } = await load("score.mjs");
  const treatment = scoreTreatment();
  const a = buildScore({ treatment, frameCount: 480, fps: 60, cutTimes: [4] });
  const b = buildScore({ treatment, frameCount: 480, fps: 60, cutTimes: [4] });
  assert.equal(a.sampleCount, 480 * 800, "8 s at 48 kHz");
  assert.equal(Buffer.from(a.left).toString("hex"), Buffer.from(b.left).toString("hex"), "left channel is deterministic");
  assert.equal(Buffer.from(a.right).toString("hex"), Buffer.from(b.right).toString("hex"), "right channel is deterministic");
  assert.ok(Math.abs(a.lufs - -16) <= 2, `${a.lufs} LUFS`);
  assert.ok(a.peakDbfs <= -2, `peak ${a.peakDbfs} dBFS`);
});

test("score: writeScore keeps stems and cues beside the track", async () => {
  const { writeScore } = await load("score.mjs");
  const out = tmp("score-");
  const summary = writeScore({ treatment: scoreTreatment(), frameCount: 480, fps: 60, cutTimes: [4], dir: out });
  assert.ok(fs.existsSync(path.join(out, "sound", "score.wav")));
  assert.ok(fs.existsSync(path.join(out, "sound-cues.json")));
  assert.ok(summary.stems.length >= 8, `${summary.stems.length} stems`);
  assert.ok(summary.stems.every((s) => fs.existsSync(path.join(out, s.file))), "every stem is a file");
  assert.equal(summary.schema, "lithermes.motion-sound-cues/v1");
  assert.ok(summary.cues.length >= 2, "beat and event cues are planned");
});

test("treatment: a rich film scores, a minimal film keeps the bed", async () => {
  const { validateTreatment } = await load("treatment.mjs");
  const richBed = stageTreatment({ durationSec: 8 });
  richBed.sound = { mode: "generated", plan: "a pad", palette: "soft-mallet", events: [{ t: 2, on: "the tower draws", kind: "tap" }, { t: 6, on: "the beam crosses", kind: "whoosh" }] };
  assert.equal(validateTreatment(richBed).field, "sound.mode");
  const minimalScore = stageTreatment({ durationSec: 8, register: "minimal" });
  minimalScore.request += " 차분한 영상으로 만들어줘";
  minimalScore.sound = { mode: "score", plan: "a score", events: [{ t: 2, on: "the tower draws", kind: "tap" }, { t: 6, on: "the beam crosses", kind: "whoosh" }] };
  assert.equal(validateTreatment(minimalScore).field, "sound.mode");
  assert.equal(validateTreatment(scoreTreatment()).ok, true, validateTreatment(scoreTreatment()).message);
});

test("treatment: a stage score without events fails", async () => {
  const { validateTreatment } = await load("treatment.mjs");
  const t = scoreTreatment();
  delete t.sound.events;
  assert.equal(validateTreatment(t).field, "sound.events");
  t.sound.events = [{ t: 2, on: "the tower draws", kind: "tap" }];
  assert.equal(validateTreatment(t).field, "sound.events");
  t.sound.genre = "polka";
  t.sound.events.push({ t: 6, on: "the beam crosses", kind: "whoosh" });
  assert.equal(validateTreatment(t).field, "sound.genre");
});

test("sound CLI: a score treatment builds the track and cues", () => {
  const out = tmp("sound-score-");
  writeTreatment(out, scoreTreatment());
  const run = spawnSync(process.execPath, [path.join(skillRoot, "bin", "motion.mjs"), "sound", "--out", out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /score, house in [A-G][#b]? (major|minor), \d+ BPM/);
  assert.ok(fs.existsSync(path.join(out, "sound", "score.wav")) && fs.existsSync(path.join(out, "sound-cues.json")));
});

test("type path: a score needs no events", async () => {
  const { validateTreatment } = await load("treatment.mjs");
  assert.equal(validateTreatment(typeTreatment()).ok, true, validateTreatment(typeTreatment()).message);
});
