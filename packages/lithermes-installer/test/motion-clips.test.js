// Declared keyed overlay clips on the stage path (references/stage.md, Clips): frames inside a
// declared clip folder leave the flipbook and count rule, every other raster keeps its limits.
// The Chrome tests need a pre-warmed cache named by LITHERMES_MOTION_TEST_XDG; they skip without one.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { stageTreatment, writeTreatment } = require("./motion-director-support");

const skillRoot = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const motion = path.join(skillRoot, "bin", "motion.mjs");
const fixtures = path.join(__dirname, "fixtures", "motion-stage");
const load = (name) => import(pathToFileURL(path.join(skillRoot, "engine", name)).href);
const temps = [];
const tmp = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(dir); return dir; };
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const XDG = process.env.LITHERMES_MOTION_TEST_XDG;
const skipReason = !fs.existsSync(CHROME) ? `Chrome not found at ${CHROME}`
  : !XDG || !fs.existsSync(path.join(XDG, "lithermes", "motion")) ? "LITHERMES_MOTION_TEST_XDG does not name a pre-warmed motion cache" : null;
const chromeTest = (name, fn) => test(name, { skip: skipReason || false, timeout: 900000 }, fn);

// ---- PNG helpers: a real RGBA / RGB encoder, so the scan reads true bytes ----
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
function encode(pixels, width, height, channels) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
// A keyed frame: one corner pixel transparent, the rest opaque. `opaque` makes it solid.
function keyed(width, height, { opaque = false, shade = 90 } = {}) {
  const px = Buffer.alloc(width * height * 4, shade);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  if (!opaque) px[3] = 0;
  return encode(px, width, height, 4);
}
const frameName = (i) => `frame_${String(i).padStart(4, "0")}.png`;

// A stage dir with clips/<dir>/frame_NNNN.png for each clip and clips/clips.json for `declare`.
function stageWith(clips, { declare = clips, extra = () => {} } = {}) {
  const stage = path.join(tmp("clips-"), "stage");
  fs.mkdirSync(path.join(stage, "clips"), { recursive: true });
  fs.writeFileSync(path.join(stage, "index.html"), "<!doctype html><title>clips</title>");
  for (const c of clips) {
    fs.mkdirSync(path.join(stage, "clips", c.dir), { recursive: true });
    const png = c.png ?? keyed(c.w ?? 8, c.h ?? 6);
    for (let i = 1; i <= (c.files ?? c.count); i++) fs.writeFileSync(path.join(stage, "clips", c.dir, frameName(i)), png);
  }
  fs.writeFileSync(path.join(stage, "clips", "clips.json"), JSON.stringify({ clips: declare.map(({ id, dir, count, fps }) => ({ id, dir, count, fps })) }));
  extra(stage);
  return stage;
}
const A = { id: "boom", dir: "01-boom", count: 12, fps: 30 };
const B = { id: "cat", dir: "10-cat", count: 30, fps: 30 };

test("a declared clip set leaves the flipbook and count rule and is listed in the scan", async () => {
  const { scanStage } = await load("stage.mjs");
  const found = scanStage(stageWith([A, B]));
  assert.deepEqual(found.contract, []);
  assert.equal(found.rasters.count, 0, "clip frames are not page rasters");
  assert.deepEqual(found.clips.map((c) => [c.id, c.count, c.fps, c.width, c.height]), [["boom", 12, 30, 8, 6], ["cat", 30, 30, 8, 6]]);
  assert.ok(found.clips.every((c) => c.bytes > 0 && !("frames" in c)), "the manifest copy carries sizes, not frame lists");
});

test("an undeclared frame sequence is still a flipbook, also beside a declared clip", async () => {
  const { scanStage } = await load("stage.mjs");
  const stage = stageWith([A], {
    extra: (dir) => {
      fs.mkdirSync(path.join(dir, "flip"));
      for (let i = 1; i <= 12; i++) fs.writeFileSync(path.join(dir, "flip", frameName(i)), keyed(8, 6));
    },
  });
  assert.match(scanStage(stage).contract.join("\n"), /read as a flipbook/);
});

test("a clip folder missing from clips.json is a flipbook, and so is any folder when clips.json is absent", async () => {
  const { scanStage } = await load("stage.mjs");
  assert.match(scanStage(stageWith([A], { declare: [] })).contract.join("\n"), /read as a flipbook/);
  const stage = stageWith([A]);
  fs.rmSync(path.join(stage, "clips", "clips.json"));
  assert.match(scanStage(stage).contract.join("\n"), /read as a flipbook/);
});

test("cover mode never takes clips: the scan option turns them off, and the cover scan asks for that", async () => {
  const { scanStage } = await load("stage.mjs");
  assert.match(scanStage(stageWith([A]), { clips: false }).contract.join("\n"), /read as a flipbook/);
  assert.match(fs.readFileSync(path.join(skillRoot, "engine", "cover.mjs"), "utf8"), /scanStage\(coverDir, \{ clips: false \}\)/);
});

const refused = [
  ["more frames than a clip may have", { ...A, count: 361 }, /clip "boom".*361 frames/],
  ["a frame missing from the run", { ...A, files: 11 }, /frame_0012\.png is missing/],
  ["a stray frame beyond the declared count", { ...A, files: 13 }, /frame_0013\.png is not one of the 12 declared frames/],
  ["opaque RGB frames, which are not keyed", { ...A, png: encode(Buffer.alloc(8 * 6 * 3, 90), 8, 6, 3) }, /8-bit RGBA PNG/],
  ["RGBA frames with no transparent pixel", { ...A, png: keyed(8, 6, { opaque: true }) }, /no transparent pixel/],
  ["a frame larger than the overlay cap", { ...A, w: 721, h: 20 }, /clip "boom".*721x20.*720 px/],
  ["frames of mixed sizes", { ...A, mixed: true }, /one size per clip/],
  ["a frame rate above 30", { ...A, fps: 60 }, /fps must be a whole number from 1 to 30/],
  ["a folder name that climbs out", { ...A, dir: "x", badDir: ".." }, /dir must be a folder name directly under clips\//],
  ["an id that is not a plain token", { ...A, id: "a b" }, /id must be a plain token/],
];
for (const [name, clip, message] of refused) {
  test(`refuses ${name} as a stage contract finding (exit 17)`, async () => {
    const { scanStage } = await load("stage.mjs");
    const stage = stageWith([clip], {
      extra: (dir) => {
        if (clip.badDir) fs.writeFileSync(path.join(dir, "clips", "clips.json"), JSON.stringify({ clips: [{ id: clip.id, dir: clip.badDir, count: clip.count, fps: clip.fps }] }));
        if (clip.mixed) fs.writeFileSync(path.join(dir, "clips", clip.dir, frameName(5)), keyed(9, 6));
      },
    });
    const found = scanStage(stage);
    assert.match(found.contract.join("\n"), message);
  });
}

test("a duplicate id, a malformed clips.json and more than the clip cap are contract findings", async () => {
  const { scanStage } = await load("stage.mjs");
  assert.match(scanStage(stageWith([A, { ...B, dir: "other", id: "boom" }])).contract.join("\n"), /duplicate id boom/);
  const bad = stageWith([A]);
  fs.writeFileSync(path.join(bad, "clips", "clips.json"), "{ not json");
  assert.match(scanStage(bad).contract.join("\n"), /clips\/clips\.json is not valid JSON/);
  const many = Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, dir: `d${i}`, count: 2, fps: 30 }));
  assert.match(scanStage(stageWith(many)).contract.join("\n"), /13 clips declared \(at most 12 clips\)/);
});

test("the caps are exported and hold frames and bytes, per clip and in all", async () => {
  const { scanClips, CLIP_LIMITS } = await load("stage.mjs");
  assert.deepEqual(CLIP_LIMITS, { clips: 12, framesPerClip: 360, framesTotal: 1500, bytesPerClip: 40 * 1024 * 1024, bytesTotal: 128 * 1024 * 1024, side: 720, fps: 30 });
  const stage = stageWith([A, B]);
  const problems = (limits) => scanClips(stage, { limits: { ...CLIP_LIMITS, ...limits } }).problems;
  assert.deepEqual(problems({}), []);
  assert.match(problems({ bytesPerClip: 100 }).join("\n"), /MB \(at most 0 MB per clip\)/);
  assert.match(problems({ bytesTotal: 100 }).join("\n"), /MB of clip frames in all/);
  assert.match(problems({ framesTotal: 41 }).join("\n"), /42 clip frames in all \(at most 41\)/);
});

test("the page reaches the declared clips at /lit/clips.js, and a stage with none has no such route", async () => {
  const { clipsScript, stageFile } = await load("stage.mjs");
  const stage = stageWith([A]);
  const body = clipsScript(stage);
  const sandbox = { window: {} };
  vm.runInNewContext(body, sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.LitClips)), { boom: { src: "clips/01-boom", count: 12, fps: 30, width: 8, height: 6 } });
  assert.equal(stageFile(fs.realpathSync(stage), "/clips/01-boom/frame_0001.png").status, 200);
  assert.equal(clipsScript(tmp("no-clips-")), null);
  const broken = stageWith([A]);
  fs.writeFileSync(path.join(broken, "clips", "clips.json"), "{ not json");
  assert.equal(clipsScript(broken), null, "a declaration the scan refuses is never served");
});

test("the pre-load list leaves declared clip frames out, so 1500 frames are not decoded up front", async () => {
  const { imageUrlsIn } = await load("stage.mjs");
  const stage = stageWith([A], { extra: (dir) => fs.writeFileSync(path.join(dir, "title.png"), keyed(8, 6)) });
  assert.deepEqual(imageUrlsIn(stage), ["http://lit.stage/title.png"]);
});

test("LitStage.clip picks the frame from film time alone", () => {
  const source = fs.readFileSync(path.join(skillRoot, "engine", "stage-kit.js"), "utf8");
  const element = (tag) => ({
    tag, style: {}, children: [], attrs: {}, parent: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    append(c) { this.children.push(c); c.parent = this; },
    replaceWith(n) { this.parent.children[this.parent.children.indexOf(this)] = n; n.parent = this.parent; },
  });
  const setup = (clips) => {
    const window = { LitClips: clips };
    vm.runInNewContext(source, { window, document: { createElement: element }, Intl, Math, Number, String, Array, Object, Error, JSON, parseFloat, parseInt });
    return { LitStage: window.LitStage, parent: element("div") };
  };
  const table = { boom: { src: "clips/01-boom", count: 10, fps: 30, width: 8, height: 6 } };
  const { LitStage, parent } = setup(table);
  const box = { x: 10, y: 20, w: 300, h: 300 };
  const show = LitStage.clip({ parent, id: "boom", box });
  const frameAt = (t, opts) => { const wrap = show(t, opts); return wrap ? wrap.children[0].src : null; };
  const f = (i) => `clips/01-boom/frame_${String(i).padStart(4, "0")}.png`;
  assert.equal(frameAt(0.9, { start: 1 }), null, "hidden before the cue");
  assert.equal(frameAt(1.0, { start: 1 }), f(1));
  assert.equal(frameAt(1 + 5 / 30, { start: 1 }), f(6));
  assert.equal(frameAt(1 + 9 / 30, { start: 1 }), f(10));
  assert.equal(frameAt(1 + 10 / 30, { start: 1 }), null, "hidden after the last frame");
  assert.equal(frameAt(1 + 12 / 30, { start: 1, hold: true }), f(10), "hold keeps the last frame");
  assert.equal(frameAt(1 + 12 / 30, { start: 1, loop: true }), f(3), "loop wraps by frame index");
  assert.equal(frameAt(1.0, { start: 1, from: 4, to: 6 }), f(4));
  assert.equal(frameAt(1 + 4 / 30, { start: 1, from: 4, to: 6, loop: true }), f(5));
  // The cue arithmetic of the doc: a clip whose own sound sits on frame 85 lands on a cue at 0.12 s.
  const long = setup({ boom: { src: "clips/01-boom", count: 122, fps: 30, width: 8, height: 6 } });
  const cued = long.LitStage.clip({ parent: long.parent, id: "boom", box });
  const start = 0.12 - 84 / 30;
  assert.equal(cued(0.12, { start }).children[0].src, f(85));
  assert.equal(parent.children.length, 1, "one wrapper, never one per frame");
  assert.deepEqual([parent.children[0].style.left, parent.children[0].style.top, parent.children[0].style.width, parent.children[0].style.height], ["10px", "20px", "300px", "300px"]);
  assert.throws(() => show(1, { start: 0, from: 0 }), /from\.\.to must lie within 1\.\.10/);
  assert.throws(() => LitStage.clip({ parent, id: "nope", box }), /no clip "nope"/);
  assert.throws(() => LitStage.clip({ parent, id: "boom" }), /needs \{ parent, id, box/);
  assert.throws(() => setup(undefined).LitStage.clip({ parent, id: "boom", box }), /clips\.js/);
});

test("the stage report names each clip", async () => {
  const { renderStageReport } = await load("stage-gate.mjs");
  const out = tmp("clips-report-");
  const manifest = {
    format: "16:9", resolution: [1920, 1080], durationSec: 4, fps: 60, totalFrames: 240, targetDurationSec: 4, renderer: "SwiftShader (software rung)", chromeFlags: [],
    frameTimeMs: { p50: 1, p95: 2, captured: 10 }, masterSec: 1, round: 2, warnings: [],
    scan: { clips: [{ id: "boom", count: 12, fps: 30, width: 8, height: 6, bytes: 400 }, { id: "cat", count: 30, fps: 24, width: 8, height: 6, bytes: 900 }] },
  };
  const text = renderStageReport(manifest, { rules: [], failed: [], withhold: false }, { out, previewName: "preview.mp4" });
  assert.match(text, /clips: boom 12 frames at 30 fps, cat 30 frames at 24 fps \(keyed overlays, chosen from film time\)/);
  const bare = renderStageReport({ ...manifest, scan: { clips: [] } }, { rules: [], failed: [], withhold: false }, { out, previewName: "preview.mp4" });
  assert.doesNotMatch(bare, /clips:/);
});

test("the kit lists clip, stays under its cap, and the docs and exit table carry the clip rules", () => {
  const kit = fs.readFileSync(path.join(skillRoot, "engine", "stage-kit.js"), "utf8");
  assert.ok(Buffer.byteLength(kit) <= 60 * 1024, `kit is ${Buffer.byteLength(kit)} bytes`);
  assert.match(kit, /clipInset, clipCircle, maskWipe, mix, text, define, clip/);
  const stageDoc = fs.readFileSync(path.join(skillRoot, "references", "stage.md"), "utf8");
  assert.match(stageDoc, /^## Clips$/m);
  for (const needle of ["stage/clips/clips.json", "/lit/clips.js", "LitStage.clip({ parent, id, box })", "start = cue - (N - 1) / fps", "at most 12 clips", "360 frames", "1500", "40 MB", "128 MB", "720 px", "8-bit RGBA", "Cover mode takes no clips"]) {
    assert.ok(stageDoc.includes(needle), `references/stage.md names ${needle}`);
  }
  assert.match(fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8"), /17 a stage or clip break/);
});

// ---- real renders: need Chrome and the pre-warmed cache ----
const env = (extra = {}) => ({ ...process.env, XDG_CACHE_HOME: XDG, HOME: tmp("clips-home-"), ...extra });

chromeTest("a declared clip shows the frame film time picks, hidden before the cue and held after the last frame, the same in a fresh browser", async () => {
  const { openStage, fontRoutes } = await load("stage.mjs");
  const { runtimeRequire, findCache } = await load("../bin/runtime.mjs");
  const cacheEnv = { ...process.env, XDG_CACHE_HOME: XDG };
  const runtime = runtimeRequire(cacheEnv);
  const cache = findCache(cacheEnv);
  const { PNG } = runtime("pngjs");
  const fonts = fontRoutes(cache);
  const centreOf = async (frames) => {
    const out = tmp("clip-render-");
    fs.cpSync(path.join(fixtures, "clip-overlay", "stage"), path.join(out, "stage"), { recursive: true });
    fs.mkdirSync(path.join(out, "stage", "clips", "swatch"), { recursive: true });
    for (let k = 1; k <= 8; k++) {
      const px = Buffer.alloc(8 * 6 * 4);
      for (let i = 0; i < px.length; i += 4) px.set([20 * k, 0, 0, 255], i);
      px[3] = 0;
      fs.writeFileSync(path.join(out, "stage", "clips", "swatch", frameName(k)), encode(px, 8, 6, 4));
    }
    fs.writeFileSync(path.join(out, "stage", "clips", "clips.json"), JSON.stringify({ clips: [{ id: "swatch", dir: "swatch", count: 8, fps: 30 }] }));
    const s = await openStage({ runtime, stageDir: path.join(out, "stage"), profileRoot: path.join(out, ".run", "t"), width: 1920, height: 1080, seed: 1, fontCss: fonts.css, fontFiles: fonts.routes });
    const seen = new Map();
    try {
      const loaded = await s.load();
      assert.deepEqual(loaded.errors, []);
      await s.prepare([]);
      const last = Math.max(...frames);
      for (let f = 0; f <= last; f++) {
        await s.step(f / 60, frames.includes(f));
        if (frames.includes(f)) { const img = PNG.sync.read(await s.capture()); const i = (450 * 1920 + 800) * 4; seen.set(f, [...img.data.subarray(i, i + 3)]); }
      }
    } finally { await s.close(); }
    return seen;
  };
  const frames = [54, 60, 70, 85, 100];
  const first = await centreOf(frames);
  const second = await centreOf(frames);
  const near = (got, want) => got.every((v, i) => Math.abs(v - want[i]) <= 3);
  assert.ok(near(first.get(54), [0, 0, 0]), `t = 0.9 s is before the cue: ${first.get(54)}`);
  assert.ok(near(first.get(60), [20, 0, 0]), `t = 1.0 s is clip frame 1: ${first.get(60)}`);
  assert.ok(near(first.get(70), [120, 0, 0]), `t = 1 + 10/60 s is clip frame 6: ${first.get(70)}`);
  assert.ok(near(first.get(85), [160, 0, 0]), `t = 1.417 s holds frame 8, which ended at 1.267 s: ${first.get(85)}`);
  assert.ok(near(first.get(100), [0, 0, 0]), `t = 1.667 s is past the hold: ${first.get(100)}`);
  for (const f of frames) assert.deepEqual(first.get(f), second.get(f), `frame ${f} matches in a fresh browser`);
});

chromeTest("a clip does not slip past the flash audit: a full-frame white and black clip fails MO-C-03 and withholds the film", async () => {
  const out = tmp("clip-strobe-");
  fs.cpSync(path.join(fixtures, "clip-strobe", "stage"), path.join(out, "stage"), { recursive: true });
  fs.mkdirSync(path.join(out, "stage", "clips", "strobe"), { recursive: true });
  for (let k = 1; k <= 6; k++) {
    const px = Buffer.alloc(8 * 6 * 4, k % 2 ? 255 : 0);
    px[3] = 0;
    for (let i = 7; i < px.length; i += 4) px[i] = 255;
    fs.writeFileSync(path.join(out, "stage", "clips", "strobe", frameName(k)), encode(px, 8, 6, 4));
  }
  fs.writeFileSync(path.join(out, "stage", "clips", "clips.json"), JSON.stringify({ clips: [{ id: "strobe", dir: "strobe", count: 6, fps: 30 }] }));
  writeTreatment(out, stageTreatment({}));
  const run = spawnSync(process.execPath, [motion, "stage", "--out", out, "--round", "2"], { encoding: "utf8", env: env(), timeout: 900000 });
  assert.equal(run.status, 13, run.stdout + run.stderr);
  assert.match(fs.readFileSync(path.join(out, "gate-report.txt"), "utf8"), /MO-C-03: FAIL/);
  assert.equal(fs.existsSync(path.join(out, "film.mp4")), false, "a flash audit FAIL withholds the film");
});
