// Cover mode of lit-typographic-motion: the cover treatment, the loop kit and the cover init
// script, the decoded-file gate (G0-G6, SEEK, ART), the asset list, cover look rounds with defects,
// the cover done-check, the shipped recipes and negatives, and the CLI surface. Unit tests run
// everywhere; tests that drive Chrome need a pre-warmed cache named by LITHERMES_MOTION_TEST_XDG
// (as for motion-stage) plus img2webp and dwebp, and skip without them.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { stageTreatment, writeTreatment } = require("./motion-director-support");

const packageRoot = path.join(__dirname, "..");
const skillRoot = path.join(packageRoot, "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const motion = path.join(skillRoot, "bin", "motion.mjs");
const fixtures = path.join(__dirname, "fixtures", "motion-cover");
const load = (name) => import(pathToFileURL(path.join(skillRoot, "engine", name)).href);
const temps = [];
const tmp = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(dir); return dir; };
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
const has = (tool) => spawnSync("which", [tool], { encoding: "utf8" }).status === 0;

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const XDG = process.env.LITHERMES_MOTION_TEST_XDG;
const renderSkip = !fs.existsSync(CHROME) ? `Chrome not found at ${CHROME}`
  : !XDG || !fs.existsSync(path.join(XDG, "lithermes", "motion")) ? "LITHERMES_MOTION_TEST_XDG does not name a pre-warmed motion cache"
    : !(has("img2webp") && has("dwebp")) ? "img2webp and dwebp (libwebp) are not on PATH" : null;
const renderTest = (name, fn) => test(name, { skip: renderSkip || false, timeout: 1800000 }, fn);
const env = (extra = {}) => ({ ...process.env, XDG_CACHE_HOME: XDG || path.join(os.tmpdir(), "lithermes-no-cache"), HOME: tmp("cover-home-"), ...extra });
const cli = (args, extra = {}) => spawnSync(process.execPath, [motion, ...args], { encoding: "utf8", env: env(extra), timeout: 1800000 });

const coverTreatment = (over = {}) => ({
  mode: "cover",
  request: "An animated cover for the top of the Tideway readme.",
  idea: "Stripes drift one period per loop while a disc laps a ring beside a still word.",
  recipe: "own",
  recipeReason: "A test pattern with all three speed layers and nothing else.",
  brandWord: "TIDEWAY",
  aspect: "2:1",
  loopSec: 6,
  fps: 16,
  layers: { slow: "Stripes drift one period per loop.", mid: "A disc laps its ring twice per loop.", beat: "The disc swells as it passes the top." },
  system: { rule: "One stripe rule.", copies: "Fourteen stripes.", offset: "Each stripe's x position." },
  title: { box: [0.06, 0.37, 0.56, 0.27], kind: "live" },
  ambition: "Every frame moves and the seam disappears in the decoded file.",
  ...over,
});

function coverRun(fixture, over = {}) {
  const out = path.join(tmp(`cover-${fixture}-`), "out");
  fs.cpSync(path.join(fixtures, fixture), path.join(out, "cover"), { recursive: true });
  writeTreatment(out, coverTreatment(over));
  return out;
}

// RGB PNG of a flat grey, or of a pixel function.
async function png(width, height, fill) {
  const { encodePng } = await load("cover-png.mjs");
  const px = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = typeof fill === "function" ? fill(x, y) : fill;
    px.fill(v, (y * width + x) * 4, (y * width + x) * 4 + 3);
  }
  return encodePng(px, width, height);
}

// A finished cover run without Chrome: treatment, manifest, report, a cover stills set, run-state.
async function fakeCover(out, { verdict = "PASS+TARGET", exit = 0, round = 1 } = {}) {
  writeTreatment(out, coverTreatment());
  fs.mkdirSync(path.join(out, "stills"), { recursive: true });
  const files = [];
  for (const [name, kind] of [["frame-00.png", "frame"], ["frame-01.png", "frame"], ["poster.png", "poster"], ["seam.png", "seam"], ["sheet.png", "sheet"]]) {
    const bytes = await png(8, 4, files.length * 20);
    fs.writeFileSync(path.join(out, "stills", name), bytes);
    files.push({ file: `stills/${name}`, sha256: sha(bytes), kind });
  }
  const manifest = JSON.stringify({ path: "cover", mode: "cover", round, treatment: { sha256: sha(fs.readFileSync(path.join(out, "treatment.json"))) } });
  fs.writeFileSync(path.join(out, "manifest.json"), manifest);
  fs.writeFileSync(path.join(out, "stills", "stills.json"), JSON.stringify({ schema: "lithermes.stills/v1", round, mode: "cover", size: [1000, 500], durationSec: 6.048, files, required: ["stills/poster.png", "stills/seam.png", "stills/sheet.png"], manifestSha256: sha(manifest) }));
  fs.writeFileSync(path.join(out, "gate-report.txt"), `COVER gate --strict: ${verdict}\n`);
  fs.writeFileSync(path.join(out, "run-state.json"), JSON.stringify({ exitCode: exit, mode: "cover", round, finished: true, failed: exit ? ["G4"] : [], path: "cover" }));
  return out;
}

// Move the fake run to the next render (a new manifest and stills set for round `round`).
function rerender(out, round) {
  const manifest = JSON.stringify({ path: "cover", mode: "cover", round, treatment: { sha256: sha(fs.readFileSync(path.join(out, "treatment.json"))) } });
  fs.writeFileSync(path.join(out, "manifest.json"), manifest);
  const set = JSON.parse(fs.readFileSync(path.join(out, "stills", "stills.json"), "utf8"));
  fs.writeFileSync(path.join(out, "stills", "stills.json"), JSON.stringify({ ...set, round, manifestSha256: sha(manifest) }));
  fs.writeFileSync(path.join(out, "run-state.json"), JSON.stringify({ exitCode: 0, mode: "cover", round, finished: true, failed: [], path: "cover" }));
}

const coverAnswers = (over = {}) => ({
  viewed: ["stills/sheet.png", "stills/poster.png", "stills/seam.png"],
  change: "Sharpen the light window's edge from 60 px to 24 px so the encoder keeps it.",
  answers: [1, 2, 3, 4, 5, 6, 7, 8].map((q) => ({
    q, verdict: q === 8 ? "none" : [6, 7].includes(q) ? "no" : "yes", frame: q === 2 ? "stills/seam.png" : "stills/sheet.png",
    observed: `Question ${q}: the orange disc sits at a different angle in every tile of row ${q}.`,
  })),
  ...over,
});
const defect = (over = {}) => ({
  t: 1.2, region: [340, 10, 330, 50], frame: "stills/frame-01.png",
  observed: "The glint turns the Y of the painted title into a solid red block on the second tile.",
  cause: "A colour-dodge blend saturates the coloured letters.", fix: "Run the glint in overlay blend.", ...over,
});
const look = (out, round, doc) => {
  const file = path.join(out, `answers-${round}.json`);
  fs.writeFileSync(file, JSON.stringify(doc));
  return cli(["look", "--out", out, "--round", String(round), "--answers", file]);
};

// --- treatment ------------------------------------------------------------------------------

test("cover treatment: accepted with its derived page, cover size, frame count and encode", async () => {
  const { validateCoverTreatment } = await load("cover-treatment.mjs");
  const ok = validateCoverTreatment(coverTreatment());
  assert.equal(ok.ok, true, ok.message);
  assert.deepEqual([...ok.plan.page], [1200, 600]);
  assert.deepEqual([...ok.plan.size], [1000, 500]);
  assert.equal(ok.plan.frames, 96);
  assert.deepEqual(ok.plan.encode, { q: 86, edgeQ: 97, edgeFrames: 15, method: 4 });
  const tall = validateCoverTreatment(coverTreatment({ aspect: "3:2", encode: { q: 80 } }));
  assert.deepEqual([...tall.plan.size], [960, 640]);
  assert.equal(tall.plan.encode.q, 80);
});

test("cover treatment: film fields, sound, an invented tagline and out-of-range loops are refused by field", async () => {
  const { validateCoverTreatment } = await load("cover-treatment.mjs");
  const cases = [
    [{ copy: { lines: ["A"] } }, "copy"], [{ beats: [] }, "beats"], [{ sound: { mode: "generated" } }, "sound"],
    [{ motto: { text: "Ride the tide", source: "user" } }, "motto.text"], [{ loopSec: 4 }, "loopSec"], [{ loopSec: 13 }, "loopSec"],
    [{ fps: 30 }, "fps"], [{ aspect: "16:9" }, "aspect"], [{ brandWord: "One two three four" }, "brandWord"],
    [{ title: { box: [0.6, 0.1, 0.5, 0.2], kind: "live" } }, "title.box"], [{ recipe: "slides" }, "recipe"],
    [{ idea: "An animated cover for the top of the Tideway readme." }, "idea"], [{ layers: { slow: "Drift.", mid: "<mid>", beat: "Pulse." } }, "layers.mid"],
  ];
  for (const [over, field] of cases) {
    const r = validateCoverTreatment(coverTreatment(over));
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.equal(r.field, field, `${JSON.stringify(over)} -> ${r.field}: ${r.message}`);
  }
  assert.equal(validateCoverTreatment(coverTreatment({ motto: { text: "Keep the work lit", source: "project", from: "the repository artwork" } })).ok, true);
});

test("cover and film treatments refuse each other with exit 16 naming the way to render", async () => {
  const { validateTreatment } = await load("treatment.mjs");
  const film = validateTreatment(coverTreatment());
  assert.equal(film.field, "mode");
  assert.match(film.message, /cover --out DIR/);
  const out = tmp("cover-film-");
  writeTreatment(out, stageTreatment());
  const r = cli(["cover", "--out", out, "--round", "1"]);
  assert.equal(r.status, 16, r.stdout + r.stderr);
  assert.match(r.stderr, /BLOCKED_TREATMENT_INVALID: field mode: this treatment is a film/);
  const staged = coverRun("good");
  fs.cpSync(path.join(staged, "cover"), path.join(staged, "stage"), { recursive: true });
  const s = cli(["stage", "--out", staged, "--stills-only", "--round", "1"]);
  assert.equal(s.status, 16, s.stdout + s.stderr);
  assert.match(s.stderr, /field mode: this is a cover treatment; render it with `cover --out DIR`/);
});

// --- loop kit and init script ------------------------------------------------------------------

test("loop kit: every helper is pure or periodic in t, and the kit reads no clock or entropy", () => {
  const source = fs.readFileSync(path.join(skillRoot, "engine", "loop-kit.js"), "utf8");
  assert.doesNotMatch(source, /Math\.random|Date\.now|performance\.now|requestAnimationFrame|new Date\(|crypto/);
  const scope = {};
  vm.runInNewContext(source, { globalThis: scope, window: undefined });
  const L = scope.LitLoop;
  const noise = L.makeNoise(5);
  for (const offset of [0, 1.7, 9.3]) assert.ok(Math.abs(L.loopNoise(noise, 0, offset) - L.loopNoise(noise, 1, offset)) < 1e-9);
  assert.deepEqual(Array.from({ length: 4 }, L.rng(7)), Array.from({ length: 4 }, L.rng(7)));
  assert.ok(Math.abs(L.window(0.02, 0.95, 0.1) - 0.7) < 1e-9, "a one-shot event wraps across t = 0");
  assert.equal(L.window(0.5, 0.95, 0.1), -1);
  assert.ok(Math.abs(L.cdist(0.98, 0.02) - 0.04) < 1e-9);
  assert.equal(L.cubicPulse(0.5, 0.1, 0.5), 1);
  assert.equal(L.cubicPulse(0.5, 0.1, 0.7), 0);
  assert.ok(Math.abs(L.swell(0) - L.swell(1)) < 1e-12);
  assert.equal(L.steps(0.1, 4), 0);
});

test("cover init script: every clock and entropy source throws and is remembered by name", () => {
  const init = fs.readFileSync(path.join(skillRoot, "engine", "cover-init.js"), "utf8");
  class Performance {}
  Performance.prototype.now = () => 1;
  const appended = [];
  const window = { crypto: { getRandomValues: () => null }, requestAnimationFrame: () => 1, setInterval: () => 1 };
  const document = { documentElement: {}, head: { appendChild: (el) => appended.push(el) }, createElement: () => ({}) , addEventListener() {} };
  const context = { window, document, Performance, Math: Object.create(Math), Date, Reflect, Object, Error };
  vm.runInNewContext(`(${init.replace(/^\/\/.*\n/gmu, "").trim()})()`, context);
  assert.throws(() => context.Math.random(), /Math\.random is not available in a cover page/);
  assert.throws(() => window.Date.now(), /Date\.now/);
  assert.throws(() => new window.Date(), /Date is not available/);
  assert.equal(new window.Date(0).getTime(), 0, "a fixed date is still allowed");
  assert.throws(() => new Performance().now(), /performance\.now/);
  assert.throws(() => window.requestAnimationFrame(() => {}), /requestAnimationFrame/);
  assert.throws(() => window.crypto.getRandomValues(new Uint8Array(4)), /getRandomValues/);
  assert.deepEqual([...window.__litCoverMisuse()], ["Math.random", "Date.now", "Date", "performance.now", "requestAnimationFrame", "crypto.getRandomValues"]);
  assert.match(appended[0].textContent, /animation: none !important; transition: none !important/);
});

// --- gate ------------------------------------------------------------------------------------

const ring = (n, frame) => Array.from({ length: n }, (_, i) => frame(i));
const lumaOf = (values) => Float32Array.from(values);

test("gate metrics: a still loop is all still; a steady drift moves everywhere with a seam like its neighbours; a reset spikes the seam", async () => {
  const { motionMetrics } = await load("cover-gate.mjs");
  const still = motionMetrics({ lumas: ring(96, () => lumaOf([10, 20, 30, 40])), delays: ring(96, () => 63) });
  assert.equal(still.movingFrac, 0);
  assert.ok(Math.abs(still.longestStillSec - 96 * 0.063) < 1e-9);
  const drift = motionMetrics({ lumas: ring(96, (i) => lumaOf(Array.from({ length: 64 }, (_, k) => 128 + 100 * Math.sin((2 * Math.PI * (k + i * (64 / 96))) / 64)))), delays: ring(96, () => 63) });
  assert.equal(drift.movingFrac, 1);
  assert.ok(drift.seamLocal > 0.9 && drift.seamLocal < 1.1, String(drift.seamLocal));
  assert.equal(drift.longestStillSec, 0);
  const reset = motionMetrics({ lumas: ring(96, (i) => lumaOf(Array.from({ length: 64 }, (_, k) => (k < (64 * i) / 96 ? 200 : 20)))), delays: ring(96, () => 63) });
  assert.ok(reset.seamLocal > 8, String(reset.seamLocal));
});

test("gate metrics: frames merged into one long frame read as a hold on the time grid", async () => {
  const { motionMetrics, resample } = await load("cover-gate.mjs");
  assert.deepEqual(resample(["a", "b", "c"], [100, 300, 100], 100), ["a", "b", "b", "b", "c"]);
  // Three decoded frames, the middle one shown for 2.5 s: on the 500 ms grid that is four still
  // steps in a row (2.0 s), which no frame count would show.
  const merged = motionMetrics({ lumas: [lumaOf([0]), lumaOf([255]), lumaOf([0])], delays: [500, 2500, 500] });
  assert.equal(merged.gridFrames, 7);
  assert.ok(Math.abs(merged.longestStillSec - 2.0) < 1e-9, String(merged.longestStillSec));
  assert.ok(merged.movingFrac < 0.3, String(merged.movingFrac));
});

test("gate: the GIF fallback's delays and loop count come from the container", async () => {
  const { gifTiming } = await load("cover-gate.mjs");
  const gce = (cs) => Buffer.from([0x21, 0xf9, 4, 0, cs & 255, cs >> 8, 0, 0]);
  const image = Buffer.from([0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0, 2, 2, 0x44, 0x01, 0]);
  const loop = Buffer.concat([Buffer.from([0x21, 0xff, 11]), Buffer.from("NETSCAPE2.0"), Buffer.from([3, 1, 0, 0, 0])]);
  const head = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([2, 0, 2, 0, 0, 0, 0])]);
  const gif = Buffer.concat([head, loop, gce(6), image, gce(7), image, Buffer.from([0x3b])]);
  assert.deepEqual(gifTiming(gif), { delays: [60, 70], loop: 0, width: 2, height: 2 });
});

test("gate report: the strict verdict, then one line per gate, INFO for an exempt title", async () => {
  const { formatCoverReport } = await load("cover-gate.mjs");
  const text = formatCoverReport({ pass: true, target: false, width: 1000, height: 500, format: "webp", sourceFrames: 96, sourceDurationSec: 6.048, bytes: 2300000, loop: 0, stepMs: 63,
    gates: { G1: { pass: true, target: false, bytes: 2300000 }, G2: { pass: true, medianD: 0.002 }, G6: { pass: null, capPx: 11, reason: "painted" } } }, { strict: true });
  assert.match(text, /^COVER gate --strict: PASS\(floor\)\n/);
  assert.match(text, /^ {2}G1 pass\(floor\) bytes=2300000$/m);
  assert.match(text, /^ {2}G2 pass medianD=0\.002$/m);
  assert.match(text, /^ {2}G6 INFO capPx=11 reason=painted$/m);
});

test("decode: img2webp encodes with frame 0 and the frames before the seam at the edge quality, and the gate decodes every frame", { skip: !(has("img2webp") && has("dwebp")) && "libwebp tools not on PATH" }, async () => {
  const { img2webpArgs, frameMs } = await load("cover.mjs");
  const args = img2webpArgs({ files: ["a", "b", "c", "d"], fps: 16, encode: { q: 80, edgeQ: 97, edgeFrames: 2, method: 4 }, output: "o.webp" });
  assert.deepEqual(args, ["-loop", "0", "-lossy", "-q", "80", "-m", "4", "-d", "63", "-q", "97", "a", "-d", "63", "-q", "80", "b", "-d", "63", "-q", "97", "c", "-d", "63", "-q", "97", "d", "-o", "o.webp"]);
  assert.equal(frameMs(25), 40);
  const dir = tmp("cover-decode-");
  const files = [];
  for (let i = 0; i < 6; i++) { const f = path.join(dir, `f${i}.png`); fs.writeFileSync(f, await png(64, 32, (x) => ((x + 8 * i) % 64) * 4)); files.push(f); }
  const out = path.join(dir, "c.webp");
  assert.equal(spawnSync("img2webp", img2webpArgs({ files, fps: 16, encode: { q: 90, edgeQ: 97, edgeFrames: 1, method: 4 }, output: out }), { encoding: "utf8" }).status, 0);
  const { loadCover } = await load("cover-gate.mjs");
  const kept = [];
  const cover = loadCover(out, { keep: (i) => { kept.push(i); return i === 0; } });
  assert.equal(cover.format, "webp");
  assert.equal(cover.loop, 0);
  assert.deepEqual(cover.delays, [63, 63, 63, 63, 63, 63]);
  assert.equal(cover.width, 64);
  assert.equal(cover.kept.get(0).length, 64 * 32 * 4);
});

test("pixels: the PNG codec round-trips, Lanczos keeps a flat field flat, the luma grid is about 300 px wide", async () => {
  const { decodePng } = await load("cover-png.mjs");
  const { lanczosResize, lumaGrid, ssim } = await load("cover-image.mjs");
  const bytes = await png(40, 20, (x, y) => (x * 5 + y) & 255);
  const back = decodePng(bytes);
  assert.equal(back.width, 40);
  assert.equal(back.rgba[(3 * 40 + 7) * 4], (7 * 5 + 3) & 255);
  const flat = Buffer.alloc(2400 * 4 * 4, 120);
  const small = lanczosResize(flat, 2400, 4, 1000, 2);
  assert.ok(small.every((v, i) => (i % 4 === 3 ? v === 255 : v === 120)));
  assert.equal(lumaGrid(Buffer.alloc(1000 * 500 * 4), 1000, 500).w, 333);
  assert.ok(ssim(back.rgba, back.rgba, 40, 20) > 0.999);
});

// White letters `glyph` px tall inside the title box, on black, at the cover size.
async function masks(dir, glyph, count = 4) {
  fs.mkdirSync(dir, { recursive: true });
  const { encodePng } = await load("cover-png.mjs");
  for (let i = 0; i < count; i++) {
    const px = Buffer.alloc(1000 * 500 * 4);
    for (let g = 0; g < 6; g++) for (let y = 100; y < 100 + glyph; y++) for (let x = 120 + g * (glyph + 8); x < 120 + g * (glyph + 8) + Math.max(3, Math.round(glyph * 0.6)); x++) px.fill(255, (y * 1000 + x) * 4, (y * 1000 + x) * 4 + 3);
    fs.writeFileSync(path.join(dir, `m${String(i).padStart(4, "0")}.png`), encodePng(px, 1000, 500));
  }
  return dir;
}

test("G6: 13 px letters on a 1000 px cover are about 10.8 px at README width and fail; 60 px letters pass; a painted title is INFO", async () => {
  const { glyphHeights } = await load("cover-gate.mjs");
  const { COVER } = await load("constants.mjs");
  const box = [0.1, 0.15, 0.8, 0.3];
  const small = glyphHeights({ masksDir: await masks(path.join(tmp("g6-"), "m"), 13), box });
  assert.equal(small.pass, false);
  assert.ok(Math.abs(small.capPx - 13 * 0.83) < 0.6, JSON.stringify(small));
  const big = glyphHeights({ masksDir: await masks(path.join(tmp("g6-"), "m"), 60), box });
  assert.equal(big.pass, true);
  assert.ok(big.capPx >= COVER.minCapPx);
  const painted = glyphHeights({ masksDir: await masks(path.join(tmp("g6-"), "m"), 13), box, exempt: "painted into the declared base art cover/assets/base.png" });
  assert.equal(painted.pass, null);
  assert.match(painted.reason, /painted into the declared base art/);
  const gate = fs.readFileSync(path.join(skillRoot, "engine", "cover-gate.mjs"), "utf8");
  assert.match(gate, /gates\.G5 = /);
  assert.match(gate, /gates\.G6 = /);
});

test("seek order: a seeded shuffle of 16 distinct frames, and a one-level tolerance that two levels exceed", async () => {
  const { seekOrder, maxLevelDiff } = await load("cover.mjs");
  const { COVER } = await load("constants.mjs");
  assert.equal(COVER.seekLevels, 1);
  const order = seekOrder(96, 20261020);
  assert.equal(new Set(order).size, 16);
  assert.deepEqual(order, seekOrder(96, 20261020));
  assert.notDeepEqual(order, [...order].sort((a, b) => a - b));
  const dir = tmp("seek-");
  const frame = async (v) => { const f = path.join(dir, `f${v}.png`); fs.writeFileSync(f, await png(16, 8, v)); return f; };
  assert.equal(maxLevelDiff(await frame(100), await frame(101)), 1);
  assert.equal(maxLevelDiff(await frame(100), await frame(102)), 2);
});

// --- assets ----------------------------------------------------------------------------------

async function paintedRun({ listed = true, writeArt = true, extra = null, hash = null } = {}) {
  const out = path.join(tmp("cover-assets-"), "out");
  fs.mkdirSync(path.join(out, "cover", "assets"), { recursive: true });
  fs.copyFileSync(path.join(fixtures, "good", "index.html"), path.join(out, "cover", "index.html"));
  const art = await png(96, 64, (x, y) => ((x * 7) ^ (y * 13)) & 255);
  if (writeArt) fs.writeFileSync(path.join(out, "cover", "assets", "base.png"), art);
  if (extra) fs.writeFileSync(path.join(out, "cover", "assets", extra), art);
  writeTreatment(out, coverTreatment({ recipe: "painted-light", recipeReason: "The painting carries the picture; the page relights it.", title: { box: [0.35, 0.03, 0.31, 0.09], kind: "painted" } }));
  if (listed) fs.writeFileSync(path.join(out, "assets.json"), JSON.stringify({ assets: [{ path: "cover/assets/base.png", role: "base-art", source: "user", sha256: hash || sha(art), box: [0.125, 0, 0.75, 1] }] }));
  return out;
}

test("assets: a listed asset that is missing is exit 22 before any frame; the painted recipe needs its base art; an unlisted raster or a changed file is exit 17", async () => {
  const missing = await paintedRun({ writeArt: false });
  const r = cli(["cover", "--out", missing, "--round", "1"]);
  assert.equal(r.status, 22, r.stdout + r.stderr);
  assert.match(r.stderr, /BLOCKED_ASSET_MISSING: cover\/assets\/base\.png is listed in assets\.json and missing; supply it or generate it, never draw a stand-in/);
  assert.equal(fs.existsSync(path.join(missing, ".run", "cover")), false, "no frame was captured");
  assert.equal(JSON.parse(fs.readFileSync(path.join(missing, "run-state.json"), "utf8")).exitCode, 22);
  const unlisted = cli(["cover", "--out", await paintedRun({ listed: false }), "--round", "1"]);
  assert.equal(unlisted.status, 22, unlisted.stderr);
  assert.match(unlisted.stderr, /the painted-light recipe needs its base art listed in assets\.json/);
  const extra = cli(["cover", "--out", await paintedRun({ extra: "logo.png" }), "--round", "1"]);
  assert.equal(extra.status, 17, extra.stderr);
  assert.match(extra.stderr, /cover\/assets\/logo\.png is a raster the page can load but assets\.json does not list/);
  const changed = cli(["cover", "--out", await paintedRun({ hash: "0".repeat(64) }), "--round", "1"]);
  assert.equal(changed.status, 17, changed.stderr);
  assert.match(changed.stderr, /cover\/assets\/base\.png no longer matches its sha256 in assets\.json/);
});

test("assets: frame 0 must show the base art (SSIM of its check box), a flat fill does not", async () => {
  const { artCheck } = await load("cover-assets.mjs");
  const { COVER } = await load("constants.mjs");
  const W = 200, H = 100, box = [50, 10, 96, 64];
  const frame = Buffer.alloc(W * H * 4, 255), src = Buffer.alloc(96 * 64 * 4, 255);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) {
    const v = ((x * 7) ^ (y * 13)) & 255;
    src.fill(v, (y * 96 + x) * 4, (y * 96 + x) * 4 + 3);
    frame.fill(v, ((box[1] + y) * W + box[0] + x) * 4, ((box[1] + y) * W + box[0] + x) * 4 + 3);
  }
  const fractions = [box[0] / W, box[1] / H, box[2] / W, box[3] / H];
  const ok = artCheck({ frame0: frame, width: W, height: H, art: { rgba: src, width: 96, height: 64 }, box: fractions });
  assert.ok(ok.pass && ok.ssim > 0.99, JSON.stringify(ok));
  const flat = artCheck({ frame0: Buffer.alloc(W * H * 4, 40), width: W, height: H, art: { rgba: src, width: 96, height: 64 }, box: fractions });
  assert.equal(flat.pass, false);
  assert.ok(flat.ssim < COVER.artSsim);
});

test("encoder: with neither img2webp and dwebp nor gifski on PATH a cover render stops with exit 21 before any capture", () => {
  const out = coverRun("good");
  const r = spawnSync(process.execPath, [motion, "cover", "--out", out, "--round", "1"], { encoding: "utf8", env: { ...env(), PATH: path.join(os.tmpdir(), "lithermes-empty-path") } });
  assert.equal(r.status, 21, r.stdout + r.stderr);
  assert.match(r.stderr, /BLOCKED_NO_COVER_ENCODER: install libwebp \(img2webp and dwebp\) or gifski; a cover is never an MP4/);
  assert.equal(fs.existsSync(path.join(out, ".run", "cover")), false);
});

// --- look and done ---------------------------------------------------------------------------

test("cover look: eight cover questions, no stills-only round 1, no weakest beat; damage or a slide read asks for another round", async () => {
  const out = await fakeCover(tmp("cover-look-"));
  const r = look(out, 1, coverAnswers());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /render the cover with --round 2/);
  const recorded = JSON.parse(fs.readFileSync(path.join(out, "look.json"), "utf8")).rounds[0];
  assert.equal(recorded.stillsMode, "cover");
  assert.equal(recorded.another, false);
  const damaged = await fakeCover(tmp("cover-look-"));
  look(damaged, 1, coverAnswers({ answers: coverAnswers().answers.map((a) => (a.q === 7 ? { ...a, verdict: "yes" } : a)) }));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(damaged, "look.json"), "utf8")).rounds[0].reasons, ["Q7: yes"]);
  const nine = await fakeCover(tmp("cover-look-"));
  const film = look(nine, 1, coverAnswers({ answers: [...coverAnswers().answers, { q: 9, verdict: "no", frame: "stills/sheet.png", observed: "Question nine has no place in a cover round at all." }] }));
  assert.equal(film.status, 2);
  assert.match(film.stderr, /unknown question 9/);
});

test("cover defects: up to three, each with a loop time, a region on the cover and a frame from the current stills", async () => {
  const out = await fakeCover(tmp("cover-defect-"));
  assert.equal(look(out, 1, coverAnswers({ defects: [defect()] })).status, 0);
  const saved = JSON.parse(fs.readFileSync(path.join(out, "look.json"), "utf8")).rounds[0].defects;
  assert.deepEqual(saved[0].region, [340, 10, 330, 50]);
  assert.equal(saved[0].t, 1.2);
  const bad = [
    [{ t: undefined }, /defect 1: t must be the loop time in seconds where it shows \(0 to 6\.048\)/],
    [{ t: 7 }, /defect 1: t must be the loop time/],
    [{ frame: "stills/beat-01.png" }, /defect 1: frame "stills\/beat-01\.png" is not in the latest stills set/],
    [{ region: [900, 400, 300, 200] }, /defect 1: region must be \[x, y, w, h\] inside the 1000x500 cover/],
    [{ observed: "red" }, /defect 1: observed must be at least one sentence/],
    [{ fix: "" }, /defect 1: cause and fix must each say something concrete/],
  ];
  for (const [over, message] of bad) {
    const dir = await fakeCover(tmp("cover-defect-bad-"));
    const r = look(dir, 1, coverAnswers({ defects: [defect(over)] }));
    assert.equal(r.status, 2, JSON.stringify(over));
    assert.match(r.stderr, message, JSON.stringify(over));
  }
  const four = await fakeCover(tmp("cover-defect-four-"));
  assert.match(look(four, 1, coverAnswers({ defects: [defect(), defect({ t: 2 }), defect({ t: 3 }), defect({ t: 4 })] })).stderr, /at most 3 defects per round/);
});

test("a film look round may not carry cover defects", async () => {
  const out = await fakeCover(tmp("cover-film-defect-"));
  const set = JSON.parse(fs.readFileSync(path.join(out, "stills", "stills.json"), "utf8"));
  fs.writeFileSync(path.join(out, "stills", "stills.json"), JSON.stringify({ ...set, mode: "stage-stills" }));
  const r = look(out, 1, { ...coverAnswers({ defects: [defect()] }) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /defects are a cover-mode record/);
});

test("cover done: TARGET on the last render and two rounds whose last viewed the sheet, the poster and the seam pair", async () => {
  const out = await fakeCover(tmp("cover-done-"));
  assert.equal(look(out, 1, coverAnswers()).status, 0);
  let done = cli(["complete", "--out", out]);
  assert.equal(done.status, 1);
  assert.match(done.stdout, /done needs two look rounds/);
  rerender(out, 2);
  assert.equal(look(out, 2, coverAnswers({ change: undefined })).status, 0);
  done = cli(["complete", "--out", out]);
  assert.equal(done.status, 0, done.stdout);
  assert.match(done.stdout, /^COMPLETE: cover reached TARGET; 2 look rounds/);
  fs.writeFileSync(path.join(out, "assets.json"), JSON.stringify({ assets: [{ path: "cover/assets/base.png", role: "base-art", source: "generated", sha256: "a".repeat(64), box: [0.125, 0, 0.75, 1] }] }));
  assert.match(cli(["complete", "--out", out]).stdout, /^label: the base art cover\/assets\/base\.png was generated for this cover, not supplied: label it as generated in the reply$/m);
});

test("cover done refuses a floor-only gate, a skipped seam pair, a changed treatment and missing vision receipts", async () => {
  const floor = await fakeCover(tmp("cover-floor-"), { verdict: "PASS(floor)", exit: 13 });
  assert.match(cli(["complete", "--out", floor]).stdout, /did not reach every TARGET gate on the last render \(exit 13; G4\)/);
  const seam = await fakeCover(tmp("cover-seam-"));
  look(seam, 1, coverAnswers());
  rerender(seam, 2);
  look(seam, 2, coverAnswers({ viewed: ["stills/sheet.png", "stills/poster.png"] }));
  assert.match(cli(["complete", "--out", seam]).stdout, /the last round did not view stills\/seam\.png/);
  const changed = await fakeCover(tmp("cover-changed-"));
  writeTreatment(changed, coverTreatment({ loopSec: 8 }));
  assert.match(cli(["complete", "--out", changed]).stdout, /treatment\.json changed after the last cover render/);
  const hooked = await fakeCover(tmp("cover-receipts-"));
  look(hooked, 1, coverAnswers());
  rerender(hooked, 2);
  look(hooked, 2, coverAnswers());
  fs.mkdirSync(path.join(hooked, ".run"), { recursive: true });
  const set = JSON.parse(fs.readFileSync(path.join(hooked, "stills", "stills.json"), "utf8"));
  const receipt = (file) => JSON.stringify({ tool: "vision_analyze", file, sha256: set.files.find((f) => f.file === file).sha256 });
  fs.writeFileSync(path.join(hooked, ".run", "host-events.jsonl"), `${receipt("stills/sheet.png")}\n${receipt("stills/poster.png")}\n`);
  assert.match(cli(["complete", "--out", hooked]).stdout, /the tool hook saw no vision_analyze call on stills\/seam\.png/);
});

// --- recipes, negatives and surfaces ---------------------------------------------------------

test("recipes: each ships its page and the decoded gate row it reached, inside TARGET and at most 2 MiB; no encoded cover ships", async () => {
  const { COVER } = await load("constants.mjs");
  const { validateCoverTreatment } = await load("cover-treatment.mjs");
  for (const name of ["painted-light", "weight-tide", "orbit-loop"]) {
    const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, "recipes", name, "expected.json"), "utf8"));
    for (const k of ["medianD", "movingFrac", "longestStillSec", "spike", "seamLocal", "bytes"]) assert.equal(typeof doc.row[k], "number", `${name}.${k}`);
    assert.ok(doc.row.bytes <= COVER.targetBytes, name);
    assert.ok(doc.row.seamLocal >= COVER.target.seamLo && doc.row.seamLocal <= COVER.target.seamHi, name);
    assert.ok(doc.row.medianD >= COVER.target.medianD && doc.row.movingFrac >= COVER.target.movingFrac, name);
    assert.equal(doc.verdict, "PASS+TARGET", name);
    assert.equal(doc.treatment.recipe, name);
    assert.equal(validateCoverTreatment(doc.treatment).ok, true, name);
    const page = fs.readFileSync(path.join(skillRoot, "recipes", name, "index.html"), "utf8");
    assert.match(page, /window\.renderFrame = /);
    assert.match(page, /\/lit\/loop-kit\.js/);
    assert.doesNotMatch(page, /Math\.random|Date\.now|requestAnimationFrame\(|performance\.now/);
  }
  assert.equal(fs.readdirSync(path.join(skillRoot, "recipes"), { recursive: true }).some((f) => /\.(webp|gif|mp4|png)$/.test(String(f))), false);
});

test("negatives: four slide-like pages, each declaring the gates it must keep failing", () => {
  const expected = { "title-slam": ["G2.floor", "G3.floor"], "card-scenes": ["G2.floor"], "still-glow": ["G2.floor", "G3.floor"], "reset-sweep": ["G4.floor"] };
  for (const [name, mustFail] of Object.entries(expected)) {
    const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, "recipes", "negatives", name, "expected.json"), "utf8"));
    assert.deepEqual(doc.mustFail, mustFail, name);
    assert.ok(doc.mustFail.every((id) => /^G[0-6]\.(floor|target)$/.test(id)), name);
    assert.deepEqual(doc.observed.failed, mustFail.map((id) => id.replace(/\.floor$/, "")), `${name}: the last measured run failed what it declares`);
    assert.match(fs.readFileSync(path.join(skillRoot, "recipes", "negatives", name, "index.html"), "utf8"), /NEGATIVE \(never a recipe\)/);
  }
});

test("the painted recipe declares one regression, feather-150, that must fail the size TARGET only", () => {
  const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, "recipes", "painted-light", "expected.json"), "utf8"));
  assert.deepEqual(Object.keys(doc.regressions), ["feather-150"]);
  const reg = doc.regressions["feather-150"];
  assert.deepEqual(reg.mustFail, ["G1.target"]);
  assert.match(reg.defect, /look review/);
  assert.deepEqual(reg.patch, { find: "feather: 24,", replace: "feather: 150," });
  assert.ok(fs.readFileSync(path.join(skillRoot, "recipes", "painted-light", "index.html"), "utf8").includes(reg.patch.find));
});

// The cover recipe QA proves a negative only by the gates it declares. These run without Chrome: the
// motion cache is an empty directory, so every cover render blocks at once (exit 14).
const qaScript = path.join(packageRoot, "qa", "cover-recipes.js");
const qa = (args) => {
  const home = tmp("cover-qa-home-");
  const { LITHERMES_MOTION_TEST_XDG, HERMES_HOME, ...rest } = process.env;
  return spawnSync(process.execPath, [qaScript, ...args], { encoding: "utf8", timeout: 300000, env: { ...rest, HOME: home, XDG_CACHE_HOME: path.join(home, "none") } });
};

test("qa: a crashed render is never a caught negative or regression", () => {
  const one = qa(["--feather", "150"]);
  assert.equal(one.status, 1, one.stdout + one.stderr);
  assert.match(one.stdout, /^FAIL +regression painted-light feather-150 +not proven: the render did not complete and gate the decoded file \(exit 14\)/m);
  const all = qa(["--negatives"]);
  assert.equal(all.status, 1, all.stdout + all.stderr);
  for (const name of ["title-slam", "card-scenes", "still-glow", "reset-sweep"]) assert.match(all.stdout, new RegExp(`^FAIL +negative ${name} +not proven: the render did not complete and gate the decoded file \\(exit 14\\)`, "m"));
  assert.match(all.stdout, /^FAIL +regression painted-light feather-150 +not proven/m);
});

test("qa: a regression nobody declared is a QA failure, not a caught defect", () => {
  const r = qa(["--feather", "200"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^FAIL +regression painted-light feather-200 +not proven: painted-light\/expected\.json declares no regression feather-200/m);
});

test("qa: the verdict needs a gated render and every declared gate failing, and an undeclared FLOOR failure is not enough", async () => {
  const { judgeCase, EXIT_OK, EXIT_GATE_FAIL_QA } = require("../qa/cover-recipes.js");
  const { EXIT } = await load("constants.mjs");
  assert.equal(EXIT_OK, EXIT.OK);
  assert.equal(EXIT_GATE_FAIL_QA, EXIT.GATE_FAIL_QA);
  const gates = (over) => ({ G1: { pass: true, target: true }, G2: { pass: true, target: true }, G3: { pass: true, target: true }, G4: { pass: true, target: true }, ...over });
  const run = (status, g) => ({ status, gates: g });
  assert.equal(judgeCase(["G1.target"], run(14, null)).ok, false);
  assert.match(judgeCase(["G1.target"], run(14, null)).why, /did not complete/);
  assert.equal(judgeCase(["G1.target"], run(1, gates({ G1: { pass: true, target: false } }))).ok, false, "a crash exit with a stale gate set");
  assert.match(judgeCase(["G1.target"], run(13, gates({ G4: { pass: true, target: false } }))).why, /G1\.target did not fail/);
  assert.equal(judgeCase(["G1.target"], run(13, gates({ G1: { pass: true, target: false }, G4: { pass: true, target: false } }))).ok, true);
  assert.match(judgeCase(["G1.target"], run(13, gates({ G1: { pass: true, target: false }, G3: { pass: false, target: false } }))).why, /G3\.floor, which it does not declare/);
  assert.equal(judgeCase(["G2.floor", "G3.floor"], run(13, gates({ G2: { pass: false, target: false } }))).ok, false);
  assert.equal(judgeCase(["G2.floor", "G3.floor"], run(13, gates({ G2: { pass: false, target: false }, G3: { pass: false, target: false } }))).ok, true);
  assert.match(judgeCase(["G5.floor"], run(13, gates({}))).why, /G5 was not measured/);
  assert.match(judgeCase([], run(13, gates({}))).why, /declares no gate/);
  assert.match(judgeCase(undefined, run(13, gates({}))).why, /declares no gate/);
});

test("surfaces: the CLI usage, the route subcommands, the doctor probe and the QA script all name cover mode", () => {
  const usage = spawnSync(process.execPath, [motion, "--help"], { encoding: "utf8" }).stdout;
  assert.match(usage, /^ {2}cover {4}--out DIR \[--round 1-3\] \[--window t0,t1\] \[--detach\]/m);
  assert.match(usage, /^ {2}cover-gate FILE/m);
  assert.match(usage, /21 no cover encoder \(img2webp and dwebp, or gifski\), 22 a listed cover asset is missing/);
  const contract = fs.readFileSync(path.join(packageRoot, "assets", "lithermes-plugin", "core_contract.py"), "utf8");
  assert.match(contract, /MOTION_SUBCOMMANDS = "stage\|cover\|run\|sound\|look\|gate\|cover-gate\|complete"/);
  assert.match(contract, /A README cover loop takes cover mode \(references\/cover\.md\)\./);
  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  assert.match(skill, /\$M cover --out DIR --round N/);
  assert.match(skill, /references\/cover\.md/);
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(pkg.scripts["qa:cover-recipes"], "node qa/cover-recipes.js");
  assert.ok(fs.existsSync(path.join(packageRoot, "qa", "cover-recipes.js")));
  // JetBrains Mono is pinned for the pre-warm like every motion font (MO-A-47: nothing is bundled).
  const notices = fs.readFileSync(path.join(skillRoot, "engine", "THIRD_PARTY_NOTICES"), "utf8");
  assert.match(notices, /<cache>\/assets\/fonts\/JetBrainsMono-wght-latin\.woff2/);
  const pins = JSON.parse(fs.readFileSync(path.join(skillRoot, "runtime", "fonts.json"), "utf8")).entries;
  const mono = pins.find((p) => p.path === "fonts/JetBrainsMono-wght-latin.woff2");
  assert.equal(mono.sha256, "18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e");
  assert.match(mono.url, /@fontsource-variable\/jetbrains-mono@5\.3\.0\//);
  assert.ok(pins.some((p) => p.path === mono.license));
  assert.equal(fs.existsSync(path.join(skillRoot, "fonts")), false);
});

test("cover-gate: a PNG frame folder is gated on the grid, and `gate` on a cover dir points at cover-gate", async () => {
  const dir = tmp("cover-gate-");
  const frames = path.join(dir, "frames");
  fs.mkdirSync(frames);
  for (let i = 0; i < 96; i++) fs.writeFileSync(path.join(frames, `f${String(i).padStart(4, "0")}.png`), await png(96, 32, (x) => ((x + i) % 96) * 2));
  const r = spawnSync(process.execPath, [motion, "cover-gate", frames, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const row = JSON.parse(r.stdout);
  assert.equal(row.format, "png");
  assert.equal(row.movingFrac, 1);
  const strict = spawnSync(process.execPath, [motion, "cover-gate", frames, "--strict"], { encoding: "utf8" });
  assert.match(strict.stdout, /^COVER gate --strict: PASS\+TARGET$/m);
  const out = await fakeCover(tmp("cover-regate-"));
  const g = cli(["gate", "--out", out]);
  assert.equal(g.status, 2);
  assert.match(g.stderr, /holds a cover: re-gate it with `cover-gate .*cover\.webp --strict`/);
});

// --- real renders ----------------------------------------------------------------------------

renderTest("GREEN: a loop with three speed layers reaches every TARGET gate on the decoded file, with SEEK, G5 and G6", () => {
  const out = coverRun("good");
  const r = cli(["cover", "--out", out, "--round", "1"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const report = fs.readFileSync(path.join(out, "gate-report.txt"), "utf8");
  assert.match(report, /^COVER gate --strict: PASS\+TARGET$/m);
  assert.match(report, /^ {2}SEEK pass sampled=16 identical=1[56] oneLevel=[01]$/m);
  assert.match(report, /^ {2}G5 pass min=/m);
  assert.match(report, /^ {2}G6 pass capPx=/m);
  assert.ok(fs.existsSync(path.join(out, "cover.webp")));
  assert.ok(fs.statSync(path.join(out, "cover.webp")).size <= 2 * 1024 * 1024);
  const set = JSON.parse(fs.readFileSync(path.join(out, "stills", "stills.json"), "utf8"));
  assert.equal(set.mode, "cover");
  assert.deepEqual(set.required, ["stills/poster.png", "stills/seam.png", "stills/sheet.png"]);
  assert.equal(set.files.filter((f) => f.kind === "frame").length, 12);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "run-state.json"), "utf8")).exitCode, 0);
});

renderTest("a page that reads Math.random is exit 18 naming the call; a page without renderFrame is exit 17", () => {
  const random = cli(["cover", "--out", coverRun("random"), "--round", "1"]);
  assert.equal(random.status, 18, random.stdout + random.stderr);
  assert.match(random.stderr, /STAGE_NONDETERMINISTIC: the cover page called Math\.random/);
  const none = cli(["cover", "--out", coverRun("no-render"), "--round", "1"]);
  assert.equal(none.status, 17, none.stdout + none.stderr);
  assert.match(none.stderr, /defines no window\.renderFrame\(t\)/);
});

renderTest("a page that keeps state between frames fails the seek-order check and names the frame time (exit 18)", () => {
  const r = cli(["cover", "--out", coverRun("trails"), "--round", "1"]);
  assert.equal(r.status, 18, r.stdout + r.stderr);
  assert.match(r.stderr, /STAGE_NONDETERMINISTIC: frame \d+ \(t = \d\.\d{3} s\) differs by up to \d+ levels when sought out of order/);
});

renderTest("a window render sheets only [t0 - 0.5, t1 + 0.5] and never touches the delivered stills", () => {
  const out = coverRun("good");
  const r = cli(["cover", "--out", out, "--round", "1", "--window", "2.0,2.5"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const dir = path.join(out, "windows", "round-1", "2.000-2.500");
  const doc = JSON.parse(fs.readFileSync(path.join(dir, "window.json"), "utf8"));
  assert.ok(doc.frames.length >= 8);
  for (const f of doc.frames) assert.ok(f.t >= 1.5 - 1e-9 && f.t <= 3.0 + 1e-9, String(f.t));
  assert.ok(fs.existsSync(path.join(dir, "sheet.png")));
  assert.equal(fs.existsSync(path.join(out, "stills")), false);
  assert.equal(fs.existsSync(path.join(out, "gate-report.txt")), false);
  assert.match(r.stdout, /a window render never counts as done/);
});

renderTest("the shipped negatives fail exactly their named gates and two recipes still reach TARGET in the same run", async () => {
  const { renderQuick } = await load("cover.mjs");
  const quickEnv = { ...process.env, XDG_CACHE_HOME: XDG };
  for (const name of ["title-slam", "card-scenes", "still-glow", "reset-sweep"]) {
    const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, "recipes", "negatives", name, "expected.json"), "utf8"));
    const gate = await renderQuick({ coverDir: path.join(skillRoot, "recipes", "negatives", name), treatment: doc.treatment, workDir: tmp(`neg-${name}-`), env: quickEnv });
    assert.deepEqual(Object.entries(gate.gates).filter(([, g]) => g.pass === false).map(([id]) => id).sort(), doc.mustFail.map((id) => id.replace(/\.floor$/, "")), name);
  }
  for (const name of ["weight-tide", "orbit-loop"]) {
    const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, "recipes", name, "expected.json"), "utf8"));
    const gate = await renderQuick({ coverDir: path.join(skillRoot, "recipes", name), treatment: doc.treatment, workDir: tmp(`recipe-${name}-`), env: quickEnv });
    assert.equal(gate.target, true, `${name}: ${JSON.stringify({ medianD: gate.medianD, seamLocal: gate.seamLocal, bytes: gate.bytes })}`);
  }
});

// --- the painted recipe lets any machine be the lead ---------------------------------------------

// A seven-panel painting as an opaque flat grey plate: every lit pixel reads 128, every dimmed one less.
const SEVEN = [[13, 217], [231, 435], [449, 653], [667, 872], [886, 1090], [1104, 1308], [1322, 1526]];
const LAMPS = {
  0: [{ x: 68, y: 385, rx: 20, ry: 7, eye: true }, { x: 97, y: 373, rx: 16, ry: 7, eye: true }, { x: 61, y: 689, rx: 32, ry: 32, eye: false }],
  3: [{ x: 720, y: 350, rx: 16, ry: 16, eye: true }, { x: 712, y: 436, rx: 8, ry: 14, eye: true }, { x: 694, y: 680, rx: 16, ry: 28, eye: false }],
};

async function leadPage(lead, lamps) {
  const dir = tmp("lit-lead-");
  const html = fs.readFileSync(path.join(skillRoot, "recipes", "painted-light", "index.html"), "utf8");
  const painting = { src: "assets/base.png", w: 1536, h: 1024, left: 150, scale: 0.5859375, panels: SEVEN, top: 148, bottom: 945, lead, title: { box: [455, 32, 635, 88], lift: 1, maskLevel: 60 }, lamps, accent: { cx: 902, cy: 987, rx: 60, ry: 22 } };
  const page = html.replace(/^const PAINTING = \{[\s\S]*?^\};$/mu, `const PAINTING = ${JSON.stringify(painting)};`);
  assert.notEqual(page, html, "the recipe keeps one `const PAINTING = { ... };` block");
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), page);
  const { encodePng } = await load("cover-png.mjs");
  fs.writeFileSync(path.join(dir, "assets", "base.png"), encodePng(Buffer.alloc(1536 * 1024 * 4, 128), 1536, 1024));
  return dir;
}

async function openLead(lead, lamps) {
  const { openCover } = await load("cover-capture.mjs");
  const { fontRoutes } = await load("stage.mjs");
  const { COVER } = await load("constants.mjs");
  const runtime = await import(pathToFileURL(path.join(skillRoot, "bin", "runtime.mjs")).href);
  const e = { ...process.env, XDG_CACHE_HOME: XDG };
  return openCover({ runtime: runtime.runtimeRequire(e), coverDir: await leadPage(lead, lamps), fonts: fontRoutes(runtime.findCache(e)), width: 1200, height: 600, scale: COVER.captureScale, profileRoot: tmp("lit-lead-chrome-"), env: e });
}

// Mean luminance of one panel (inset 40 painting px) in a device-scale capture of the 1200 x 600 page.
async function panelLuma(shot, [x0, x1]) {
  const { decodePng } = await load("cover-png.mjs");
  const { width, rgba } = decodePng(shot), s = width / 1200, S = 0.5859375;
  const X0 = Math.round((150 + (x0 + 40) * S) * s), X1 = Math.round((150 + (x1 - 40) * S) * s);
  const Y0 = Math.round((148 + 40) * S * s), Y1 = Math.round((945 - 40) * S * s);
  let sum = 0;
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const o = (y * width + x) * 4; sum += 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2]; }
  return sum / ((X1 - X0) * (Y1 - Y0));
}

renderTest("a lead panel in the middle (3 of 7) is as bright as the source at frame 0 while a sleeping panel is dimmed", async () => {
  const browser = await openLead(3, LAMPS);
  try {
    await browser.frame(0);
    const shot = await browser.capture();
    const lead = await panelLuma(shot, SEVEN[3]), sleeper = await panelLuma(shot, SEVEN[5]);
    assert.ok(lead >= 0.95 * 128, `lead panel luminance ${lead.toFixed(1)} against source 128`);
    assert.ok(sleeper < 0.6 * 128, `sleeping panel luminance ${sleeper.toFixed(1)} should sit under the dim pool`);
  } finally { await browser.close(); }
});

// Mean luminance of a small box around each painting-pixel point of a capture at loop time t.
async function glowAt(lead, lamps, t, points) {
  const { decodePng } = await load("cover-png.mjs");
  const browser = await openLead(lead, lamps);
  try {
    await browser.frame(t);
    const { width, rgba } = decodePng(await browser.capture()), s = width / 1200, S = 0.5859375;
    return points.map(([px, py]) => {
      const X = Math.round((150 + px * S) * s), Y = Math.round(py * S * s), r = Math.round(3 * s);
      let sum = 0, n = 0;
      for (let y = Y - r; y <= Y + r; y++) for (let x = X - r; x <= X + r; x++) { const o = (y * width + x) * 4; sum += 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2]; n++; }
      return sum / n;
    });
  } finally { await browser.close(); }
}

renderTest("the beat lights glow on the lead panel's own anchors, never on another machine's", async () => {
  const points = [...LAMPS[0], ...LAMPS[3]].map((l) => [l.x, l.y]);
  for (const lead of [0, 3]) {
    const own = LAMPS[lead].length, first = lead === 0 ? 0 : LAMPS[0].length;
    const lit = await glowAt(lead, LAMPS, 0.25, points);
    const dark = await glowAt(lead, { ...LAMPS, [lead]: [] }, 0.25, points);
    points.forEach((_, i) => {
      const gain = lit[i] - dark[i];
      if (i >= first && i < first + own) assert.ok(gain > 20, `lead ${lead}: anchor ${i} gains ${gain.toFixed(1)} levels, expected a glow`);
      else assert.ok(gain < 3, `lead ${lead}: anchor ${i} belongs to another machine but gains ${gain.toFixed(1)} levels`);
    });
  }
});

renderTest("a lead declared with an empty lamp list runs without beat lights", async () => {
  const anchor = [{ x: 1200, y: 400, rx: 16, ry: 16, eye: true }];
  const [lit] = await glowAt(5, { 5: anchor }, 0.25, [[1200, 400]]);
  const [none] = await glowAt(5, { 5: [] }, 0.25, [[1200, 400]]);
  assert.ok(lit - none > 20, `a listed anchor gains ${(lit - none).toFixed(1)} levels`);
  const [still] = await glowAt(5, { 5: [] }, 0.6, [[1200, 400]]);
  assert.ok(Number.isFinite(still), "a later frame renders");
});

renderTest("a lead with no lamp entry stops the page with a message naming the panel, instead of borrowing another machine's lights", async () => {
  await assert.rejects(openLead(5, LAMPS), /STAGE_CONTRACT_ERROR: .*first page error: PAINTING\.lamps has no entry for the lead panel 5/u);
});
