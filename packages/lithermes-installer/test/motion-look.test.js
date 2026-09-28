// Look rounds and Done. Synthetic run dirs drive the real `look` and
// `complete` commands; one Chrome test walks the whole loop on a real render.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { stageTreatment, typeTreatment, writeTreatment } = require("./motion-director-support");

const skillRoot = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const motion = path.join(skillRoot, "bin", "motion.mjs");
const temps = [];
const tmp = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(dir); return dir; };
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
const cli = (args, extra = {}) => spawnSync(process.execPath, [motion, ...args], { encoding: "utf8", ...extra });

// A finished render dir with a stills set of the given mode and round.
function render(out, { mode, round, exit = 0, manifestTag = "a" }) {
  fs.mkdirSync(path.join(out, "stills"), { recursive: true });
  fs.mkdirSync(path.join(out, "sheet"), { recursive: true });
  const manifest = JSON.stringify({ path: "stage", mode, round, tag: manifestTag });
  fs.writeFileSync(path.join(out, "manifest.json"), manifest);
  const files = [];
  const add = (rel, kind) => { const bytes = Buffer.from(`${rel}|${manifestTag}`); fs.writeFileSync(path.join(out, rel), bytes); files.push({ file: rel, kind, sha256: sha(bytes) }); };
  add("stills/beat-01-f40.png", "beat-mid"); add("stills/beat-02-f120.png", "beat-mid"); add("stills/beat-03-f200.png", "beat-mid");
  add("stills/strip-01-f80.png", "strip"); add("stills/strip-02-f160.png", "strip"); add("stills/poster-f120.png", "poster"); add("sheet/contact.png", "contact");
  fs.writeFileSync(path.join(out, "stills", "stills.json"), JSON.stringify({ round, mode, files, required: files.map((f) => f.file), manifestSha256: sha(manifest) }));
  fs.writeFileSync(path.join(out, "run-state.json"), JSON.stringify({ exitCode: exit, mode, round, finished: true, failed: exit ? ["text-contrast"] : [], path: "stage" }));
  return files.map((f) => f.file);
}

function answers(frames, overrides = {}, change = "The second beat was the weakest; the beam now sweeps across the tower instead of fading in.") {
  const list = Array.from({ length: 9 }, (_, i) => ({
    q: i + 1, frame: frames[i % frames.length],
    verdict: [4, 8, 9].includes(i + 1) ? "no" : i + 1 === 7 ? "none" : "yes",
    observed: "The white tower stands left of centre while a pale beam crosses the dark water.",
    ...(i === 0 ? { by: "self" } : {}),
    ...(overrides[i + 1] || {}),
  }));
  return { viewed: frames, change, answers: list };
}

function look(out, round, body) {
  const file = path.join(out, `answers-${round}.json`);
  fs.writeFileSync(file, JSON.stringify(body));
  return cli(["look", "--out", out, "--round", String(round), "--answers", file]);
}

function stageRun() {
  const out = tmp("look-");
  writeTreatment(out, stageTreatment({ durationSec: 4 }));
  fs.mkdirSync(path.join(out, ".run"), { recursive: true });
  fs.copyFileSync(path.join(out, "treatment.json"), path.join(out, ".run", "treatment-first.json"));
  return out;
}

test("look refuses frames outside the latest stills set and bare yes/no observations", () => {
  const out = stageRun();
  const frames = render(out, { mode: "stage-stills", round: 1 });
  const unknown = look(out, 1, answers([...frames, "stills/beat-09-f999.png"]));
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /stills\/beat-09-f999\.png is not in the latest stills set/);
  const bare = look(out, 1, answers(frames, { 5: { observed: "yes" } }));
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /question 5: "observed" must be at least one sentence naming a concrete visible detail/);
  const noChange = look(out, 1, answers(frames, {}, ""));
  assert.equal(noChange.status, 2);
  assert.match(noChange.stderr, /round 1 must name the weakest beat and the change/);
  const wrongRound = look(out, 2, answers(frames));
  assert.equal(wrongRound.status, 2);
  assert.match(wrongRound.stderr, /belongs to round 1/);
  assert.equal(fs.existsSync(path.join(out, "look.json")), false, "only a valid round writes look.json");
});

test("done: a gate PASS without a look, or with one round only, is not done", () => {
  const out = stageRun();
  const frames = render(out, { mode: "stage", round: 2 });
  const none = cli(["complete", "--out", out]);
  assert.equal(none.status, 1);
  assert.match(none.stdout, /NOT COMPLETE: no look round is recorded/);
  const first = stageRun();
  const f1 = render(first, { mode: "stage-stills", round: 1 });
  assert.equal(look(first, 1, answers(f1)).status, 0);
  render(first, { mode: "stage", round: 2, manifestTag: "b" });
  const one = cli(["complete", "--out", first]);
  assert.equal(one.status, 1);
  assert.match(one.stdout, /NOT COMPLETE: done needs two look rounds/);
  assert.ok(frames.length);
});

test("done: a last round against an older manifest is not done; the full receipt is", () => {
  const out = stageRun();
  const f1 = render(out, { mode: "stage-stills", round: 1 });
  assert.equal(look(out, 1, answers(f1)).status, 0);
  const f2 = render(out, { mode: "stage", round: 2, manifestTag: "b" });
  assert.equal(look(out, 2, answers(f2)).status, 0);
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ path: "stage", mode: "stage", round: 2, tag: "c" }));
  const stale = cli(["complete", "--out", out]);
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /NOT COMPLETE: the last look round was recorded against an older render/);
  const good = stageRun();
  const g1 = render(good, { mode: "stage-stills", round: 1 });
  assert.equal(look(good, 1, answers(g1)).status, 0);
  const g2 = render(good, { mode: "stage", round: 2, manifestTag: "b" });
  const partial = look(good, 2, answers(g2.slice(0, 3)));
  assert.equal(partial.status, 0);
  assert.match(cli(["complete", "--out", good]).stdout, /NOT COMPLETE: the last round did not view stills\/strip-01-f80\.png/);
});

test("done: complete after two full rounds, with the tool hook's receipts when it is live", () => {
  const out = stageRun();
  const f1 = render(out, { mode: "stage-stills", round: 1 });
  assert.equal(look(out, 1, answers(f1)).status, 0);
  const f2 = render(out, { mode: "stage", round: 2, manifestTag: "b" });
  assert.equal(look(out, 2, answers(f2)).status, 0);
  const done = cli(["complete", "--out", out]);
  assert.equal(done.status, 0, done.stdout);
  assert.match(done.stdout, /^COMPLETE: gate passed; 2 look rounds; the last viewed all 7 stills of the final render$/m);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "done.json"), "utf8")).status, "COMPLETE");
  const events = path.join(out, ".run", "host-events.jsonl");
  fs.writeFileSync(events, `${JSON.stringify({ tool: "terminal", motion: true })}\n`);
  const noReceipts = cli(["complete", "--out", out]);
  assert.equal(noReceipts.status, 1);
  assert.match(noReceipts.stdout, /the tool hook saw no vision_analyze call on stills\/beat-01-f40\.png/);
  for (const file of f2) fs.appendFileSync(events, `${JSON.stringify({ tool: "vision_analyze", file, sha256: sha(fs.readFileSync(path.join(out, file))) })}\n`);
  const withReceipts = cli(["complete", "--out", out]);
  assert.equal(withReceipts.status, 0, withReceipts.stdout);
  assert.match(withReceipts.stdout, /vision_analyze receipts matched/);
});

test("done: another round is due after a no, a yes on a negative question or a named Q7", () => {
  const out = stageRun();
  const f1 = render(out, { mode: "stage-stills", round: 1 });
  assert.equal(look(out, 1, answers(f1)).status, 0);
  const f2 = render(out, { mode: "stage", round: 2, manifestTag: "b" });
  const r = look(out, 2, answers(f2, { 7: { verdict: "named", observed: "A designer would have shown the keeper climbing the stairs inside the tower." }, 4: { verdict: "yes", observed: "The top left corner shows the word treatment in small grey type." } }));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /another round is due \(Q4: yes; Q7: a designer would have shown something this film does not\)/);
  const blocked = cli(["complete", "--out", out]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /the last look round asks for another round/);
});

test("done: a downgrade from the first valid treatment is recorded and reported", () => {
  const out = stageRun();
  const f1 = render(out, { mode: "stage-stills", round: 1 });
  assert.equal(look(out, 1, answers(f1)).status, 0);
  const t = JSON.parse(fs.readFileSync(path.join(out, "treatment.json"), "utf8"));
  const first = { ...t, durationSec: 12, beats: [0, 1, 2].map((i) => ({ ...t.beats[i], t0: i * 4, t1: (i + 1) * 4 })), sound: { mode: "generated", plan: "pad", palette: "soft-mallet" } };
  fs.writeFileSync(path.join(out, ".run", "treatment-first.json"), JSON.stringify(first));
  const f2 = render(out, { mode: "stage", round: 2, manifestTag: "b" });
  assert.equal(look(out, 2, answers(f2)).status, 0);
  const done = cli(["complete", "--out", out]);
  assert.equal(done.status, 0);
  assert.match(done.stdout, /downgraded: durationSec dropped from 12 s to 4 s/);
  assert.match(done.stdout, /downgraded: sound changed to none without a user request/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "done.json"), "utf8")).downgraded.length, 2);
});

test("done: with no image tool the round is recorded as blocked and complete ends DONE_UNVIEWED", () => {
  const out = stageRun();
  render(out, { mode: "stage", round: 2 });
  const r = look(out, 2, { blocked: "no-vision-tool" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /blocked: no image tool reached the frames/);
  const done = cli(["complete", "--out", out]);
  assert.equal(done.status, 0);
  assert.match(done.stdout, /^DONE_UNVIEWED: the gate passed but no image tool could view the frames/m);
});

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const XDG = process.env.LITHERMES_MOTION_TEST_XDG;
const chromeSkip = !fs.existsSync(CHROME) ? "no Chrome" : !XDG || !fs.existsSync(path.join(XDG, "lithermes", "motion")) ? "LITHERMES_MOTION_TEST_XDG does not name a pre-warmed motion cache" : false;

function walkLoop(out, renderArgs) {
  const env = { ...process.env, XDG_CACHE_HOME: XDG, HOME: tmp("home-") };
  const r1 = cli([...renderArgs, "--out", out, "--stills-only", "--round", "1"], { env, timeout: 900000 });
  assert.equal(r1.status, 0, r1.stderr);
  const set1 = JSON.parse(fs.readFileSync(path.join(out, "stills", "stills.json"), "utf8")).files.map((f) => f.file);
  assert.equal(look(out, 1, answers(set1)).status, 0);
  const r2 = cli([...renderArgs, "--out", out, "--round", "2"], { env, timeout: 900000 });
  assert.equal(r2.status, 0, r2.stderr + r2.stdout);
  const set2 = JSON.parse(fs.readFileSync(path.join(out, "stills", "stills.json"), "utf8")).files.map((f) => f.file);
  assert.ok(set2.includes("sheet/contact.png") && set2.some((f) => f.startsWith("stills/poster")) && set2.some((f) => f.startsWith("stills/strip-")));
  assert.equal(look(out, 2, answers(set2)).status, 0);
  const viewedLine = (text) => text.match(/frames (?:viewed \(look\.json\)|actually viewed this run): (\d+)/)[1];
  const before = viewedLine(fs.readFileSync(path.join(out, "gate-report.txt"), "utf8"));
  const regate = cli(["gate", "--out", out, "--no-rerender"], { env, timeout: 900000 });
  assert.equal(regate.status, 0, regate.stderr);
  const afterCount = viewedLine(fs.readFileSync(path.join(out, "gate-report.txt"), "utf8"));
  assert.equal(afterCount, String(set2.length), `a gate rerun keeps the viewed count (${before} before the last look)`);
  const done = cli(["complete", "--out", out], { env });
  assert.equal(done.status, 0, done.stdout);
  assert.match(done.stdout, /^COMPLETE:/m);
}

test("loop: stage path stills round, look, film, look, gate rerun, complete", { skip: chromeSkip, timeout: 900000 }, () => {
  const out = tmp("loop-stage-");
  fs.cpSync(path.join(__dirname, "fixtures", "motion-stage", "clock", "stage"), path.join(out, "stage"), { recursive: true });
  writeTreatment(out, stageTreatment({ durationSec: 4 }));
  walkLoop(out, ["stage"]);
});

test("loop: type path stills round, look, film, look, gate rerun, complete", { skip: chromeSkip, timeout: 900000 }, () => {
  const out = tmp("loop-type-");
  writeTreatment(out, typeTreatment(undefined, { durationSec: 4 }));
  walkLoop(out, ["run"]);
});
