const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..', 'assets', 'lithermes-plugin', 'skills', 'lit-typographic-motion');
const load = (name) => import(pathToFileURL(path.join(root, 'engine', name)).href);

// ---- synthetic frames (320x180 px = one pixel per flash cell) ----
const toByte = (linear) => Math.round(255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055));
function frame(fill, block = null) {
  const w = 320, h = 180, buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = block && x >= block.x && x < block.x + block.w && y >= block.y && y < block.y + block.h;
    const [r, g, b] = inside ? block.rgb : fill;
    const o = (y * w + x) * 4;
    buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
  }
  return buf;
}
async function audit(frames, fps = 60, loop = false) {
  const { FlashDetector, flashesFromRecords } = await load('flash.mjs');
  const detector = new FlashDetector(320, 180);
  const records = frames.map((f, i) => ({ frame: i, ...detector.push(f) }));
  return flashesFromRecords(records, fps, { loop });
}

test('flash fixture (i): a 0.05<->0.55 full-frame pulse, 6-frame attack and decay, 4/s at 60 fps FAILS', async () => {
  const frames = [];
  for (let i = 0; i < 180; i++) {
    const phase = i % 15;
    const level = phase < 6 ? 0.05 + (0.5 * phase) / 6 : phase < 9 ? 0.55 : phase < 15 ? 0.55 - (0.5 * (phase - 9)) / 6 : 0.05;
    const v = toByte(level);
    frames.push(frame([v, v, v]));
  }
  const result = await audit(frames);
  assert.ok(result.general > 3, `expected > 3 general flashes, got ${result.general}`);
});

test('flash fixture (ii): a 700x400 block toggling 4/s on a static frame FAILS', async () => {
  const frames = [];
  const block = { x: 50, y: 40, w: Math.round(700 / 6), h: Math.round(400 / 6) };
  for (let i = 0; i < 120; i++) frames.push(frame([20, 20, 20], { ...block, rgb: i % 15 < 8 ? [255, 255, 255] : [0, 0, 0] }));
  assert.ok((await audit(frames)).general > 3);
});

test('four flashes in the final second of a non-looping master FAIL (no wrap into the start)', async () => {
  const frames = [];
  for (let i = 0; i < 180; i++) {
    const late = i >= 120;
    const on = late && i % 15 < 8;
    frames.push(frame(on ? [255, 255, 255] : [10, 10, 10]));
  }
  const result = await audit(frames);
  assert.ok(result.general >= 4, `final-second flashes must count, got ${result.general}`);
  assert.ok(result.worstGeneral.startFrame >= 60);
});

test('red flashes are counted per 1 s window, not as a flat film-wide count', async () => {
  const slow = [];
  for (let i = 0; i < 600; i++) slow.push(frame(i % 30 < 15 ? [230, 10, 10] : [10, 10, 10]));
  const spread = await audit(slow);
  assert.ok(spread.red <= 3, `2 red flashes per second must pass, got ${spread.red}`);
  const fast = [];
  for (let i = 0; i < 120; i++) fast.push(frame(i >= 60 && i % 15 < 8 ? [230, 10, 10] : [10, 10, 10]));
  assert.ok((await audit(fast)).red > 3);
});

test('the looping preview audit counts a flash across the loop seam', async () => {
  const frames = [];
  for (let i = 0; i < 60; i++) frames.push(frame(i < 4 || i > 55 ? [255, 255, 255] : [10, 10, 10]));
  const master = await audit(frames, 60, false);
  const looped = await audit(frames, 60, true);
  assert.ok(looped.general >= master.general);
});

// ---- gate fixtures over manifest + render log ----
async function goodRun() {
  const { passSeed } = await load('util.mjs');
  const fps = 60, total = 240;
  const timeline = [
    { id: 'title-slam', sceneId: 'title-slam', shotIndex: 0, start: 0, end: 1.8, holdSec: 1.8, kind: 'line', text: 'Quiet signals', script: 'latin', beatSec: 0 },
    { id: 'end-card', sceneId: 'end-card', shotIndex: 0, start: 1.8, end: 4, holdSec: 2.2, kind: 'line', text: '작은 신호가 모인다', script: 'hangul', beatSec: 1.8 },
  ];
  const ranges = [];
  for (const shot of timeline) {
    const a = Math.round(shot.start * fps), b = Math.round(shot.end * fps) - 1;
    ranges.push({ pass: 'swiss-grid', frameStart: a, frameEnd: b, sceneId: shot.sceneId, shotIndex: 0, seed: null, params: { columns: 12, gutterPx: 24, marginPx: 96, baselinePx: 8, showGuides: false }, downgraded: false });
    ranges.push({ pass: 'dither', frameStart: a, frameEnd: b, sceneId: shot.sceneId, shotIndex: 0, seed: passSeed(7, shot.sceneId, 0, 'dither'), params: { mode: 1, paletteSize: 12, pixelScale: 1, ditherStrength: 0.3 }, downgraded: false });
  }
  const manifest = {
    schemaVersion: 1, engineCredit: 'mexicat/pdoom-video ca251e3dddda422b364385eb484b5a3593a0990d (MIT)', presetId: 'swiss-signal', seed: 7, fps, resolution: [1920, 1080], scale: 1,
    samples: 4, shutter: 0.5, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)', softwareRenderer: false,
    chromeFlags: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--use-mock-keychain', '--password-store=basic'],
    previewEncoder: 'img2webp', audioTier: 'text-reading-time', bpm: 100, durationSec: 4, generatedAt: '2026-09-27T00:00:00Z',
    passRanges: ranges, timeline, warnings: [],
    lithermes: { presetReason: 'no terminal or tidal keyword in the brief (auto-pick default)', round: 1, events: [], shots: timeline.map((s) => ({ sceneId: s.sceneId, shotIndex: 0, stateful: false })), previewFps: 30,
      determinism: { checks: [{ frame: 108, sequential: 'a'.repeat(64), seeked: 'a'.repeat(64), match: true }], warnings: [] }, perf: { p95Ms: 18, frames: 120, software: false }, reducedInk: 5000, poster: { ink: 4000 } },
  };
  const records = [];
  const box = (t) => ({ elementId: t.id, text: t.text, voice: 'display', fontFile: t.script === 'hangul' ? 'Pretendard-Bold.otf' : 'Archivo-w1000-900.ttf', fontSizePx: 120, capHeightPx: 84, weight: 900, fill: '#0C0E13', fills: ['#0C0E13'], bbox: [120, 470, 900, 600], lines: [t.text], lineHeight: 1.5, trackingEm: t.script === 'hangul' ? 0 : -0.02, script: t.script, runs: [{ script: t.script, fontFile: t.script === 'hangul' ? 'Pretendard-Bold.otf' : 'Archivo-w1000-900.ttf', trackingEm: t.script === 'hangul' ? 0 : -0.02, widthStep: t.script === 'hangul' ? null : 100 }], scaleX: 1, scaleY: 1, settled: true, role: 'text', outline: false, halo: false });
  for (let f = 0; f < total; f++) {
    const t = f / fps;
    const shot = timeline.find((s) => t >= s.start && t < s.end) || timeline.at(-1);
    records.push({ frame: f, pass: null, rgbaSha256: 'a'.repeat(64), textBoxes: [box(shot)], graphics: [{ id: 'rule', bbox: [120, 655, 1080, 665], fill: '#0C0E13', role: 'rule', area: [960, 2] }],
      glyphInk: 5000, lumP995: 0.9, flash: { general: 0, red: 0 }, fullFrameStep: 0, overrides: { flash: 0, invert: false, zoom: 1, shake: [0, 0], fade: 1, grain: 0.035 }, accent: false,
      fills: [{ hex: '#E9EBE4', w: 1920, h: 1080, role: 'background' }, { hex: '#0C0E13', w: 780, h: 130, role: 'text' }, { hex: '#0F7A82', w: 600, h: 90, role: 'emphasis' }],
      sampleTimes: [0, 1, 2, 3].map((i) => Math.max(0, Math.round((t + (0.5 / fps) * ((i + 0.5) / 4 - 0.5)) * 1e6) / 1e6)), sceneId: shot.sceneId, shotIndex: 0 });
    for (const pass of ['swiss-grid', 'dither']) records.push({ frame: f, pass, draws: 1, uniforms: pass === 'dither' ? { u_seed: passSeed(7, shot.sceneId, 0, 'dither') } : { u_showGuides: false } });
  }
  const exports = { probe: { codec_name: 'h264', width: 1920, height: 1080, fps: 60, pix_fmt: 'yuv420p', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709', color_range: 'tv', duration: 4 },
    sizes: { film: 4_000_000, preview: 1_200_000, poster: 300_000, reduced: 300_000 }, present: { film: true, preview: true, poster: true, reduced: true, manifest: true } };
  const contrast = [{ frame: 60, elementId: 'title-slam', ratio: 16, floor: 3, fontSizePx: 120 }];
  const preview = Array.from({ length: 120 }, (_, frame) => ({ frame, general: 0, red: 0 }));
  return { manifest, records, preview, exports, contrast, preflight: { missingGlyphs: [] } };
}

async function gate(run) {
  const { runGate } = await load('gate.mjs');
  return runGate(run);
}
const failed = (result) => result.rules.filter((r) => r.status === 'FAIL').map((r) => r.id);

test('the clean fixture passes every enforced rule', async () => {
  const result = await gate(await goodRun());
  assert.deepEqual(failed(result), []);
  assert.equal(result.withhold, false);
});

test('MO-B-00: a style the agent wrote into the brief passes; an auto-pick that disagrees with the copy still fails', async () => {
  const rule = (result) => result.rules.find((r) => r.id === 'MO-B-00');
  const chosen = await goodRun();
  chosen.manifest.presetId = 'tidal';
  chosen.manifest.lithermes.presetReason = 'agent default';
  assert.equal(rule(await gate(chosen)).status, 'PASS');
  const auto = await goodRun();
  auto.manifest.presetId = 'tidal';
  auto.manifest.lithermes.presetReason = 'agent default (no terminal or tidal keyword in the brief)';
  assert.equal(rule(await gate(auto)).status, 'FAIL');
});

const cases = [
  ['MO-C-01', 'a frame with no drawing look pass', (r) => { r.records.filter((x) => x.frame === 30 && x.pass).forEach((x) => { x.draws = 0; }); }],
  ['MO-C-01', 'empty passRanges', (r) => { r.manifest.passRanges = []; }],
  ['MO-C-02', 'an unlabelled software renderer', (r) => { r.manifest.renderer = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)'; }],
  ['MO-C-04', 'title-safe overrun', (r) => { r.records.find((x) => x.frame === 10 && x.pass === null).textBoxes[0].bbox = [40, 470, 900, 600]; }],
  ['MO-C-05', 'action-safe overrun by a non-glyph element', (r) => { r.records.find((x) => x.frame === 10 && x.pass === null).graphics[0].bbox = [10, 655, 1080, 665]; }],
  ['MO-C-06', 'body type under 4.5:1', (r) => { r.contrast.push({ frame: 60, elementId: 'note', ratio: 3.2, floor: 4.5, fontSizePx: 22 }); }],
  ['MO-C-06', 'large gradient type under 3:1', (r) => { r.contrast.push({ frame: 60, elementId: 'grad', ratio: 2.4, floor: 3, fontSizePx: 90, fill: 'gradient' }); }],
  ['MO-C-07', 'an English line held under its floor', (r) => { r.manifest.timeline[0].end = 0.6; r.manifest.timeline[0].holdSec = 0.6; r.manifest.timeline[1].start = 0.6; r.manifest.timeline[1].beatSec = 0.6; r.manifest.timeline[1].holdSec = 3.4; }],
  ['MO-C-08', 'a Korean line held under its floor', (r) => { const u = r.manifest.timeline[1]; u.text = '작은 신호가 모여서 커다란 물결이 된다 오늘 밤'; }],
  ['MO-C-09', 'an rgbaSha256 mismatch that the software re-check confirms', (r) => { r.manifest.lithermes.determinism.checks[0] = { frame: 108, sequential: 'a'.repeat(64), seeked: 'b'.repeat(64), match: false, software: { first: 'c'.repeat(64), second: 'd'.repeat(64) } }; }],
  ['MO-C-10/11/12', 'wrong ffprobe tags', (r) => { r.exports.probe.color_space = 'bt470bg'; }],
  ['MO-C-10/11/12', 'resolution, fps and duration under the floors', (r) => { Object.assign(r.exports.probe, { width: 1280, height: 720, fps: 24, duration: 2 }); }],
  ['MO-C-13', 'preview over 3 MB', (r) => { r.exports.sizes.preview = 3_400_000; }],
  ['MO-C-13', 'poster over 1 MB', (r) => { r.exports.sizes.poster = 1_300_000; }],
  ['MO-C-14', 'an unsettled reduced-motion still', (r) => { r.manifest.lithermes.reducedInk = 3000; }],
  ['MO-C-25', 'display tracking past -0.04em', (r) => { r.records.find((x) => x.frame === 5 && x.pass === null).textBoxes[0].trackingEm = -0.06; }],
  ['MO-C-25', 'negative tracking on the machine voice', (r) => { const b = r.records.find((x) => x.frame === 5 && x.pass === null).textBoxes[0]; b.voice = 'machine'; b.trackingEm = -0.01; }],
  ['MO-FT-04', 'tracking on a Hangul run', (r) => { r.records.find((x) => x.frame === 150 && x.pass === null).textBoxes[0].runs[0].trackingEm = -0.02; }],
  ['MO-FT-04', 'width motion on a Hangul run', (r) => { r.records.find((x) => x.frame === 150 && x.pass === null).textBoxes[0].runs[0].widthStep = 125; }],
  ['MO-C-26', 'multi-line line-height under its floor', (r) => { const b = r.records.find((x) => x.frame === 5 && x.pass === null).textBoxes[0]; b.lines = ['Quiet', 'signals']; b.lineHeight = 1.2; }],
  ['MO-C-27', 'a Latin paragraph card outside 60-75ch', (r) => { const b = r.records.find((x) => x.frame === 5 && x.pass === null).textBoxes[0]; b.paragraph = true; b.measureCh = 42; }],
  ['MO-C-29', 'the accent in two timeline entries', (r) => { for (const f of [5, 150]) r.records.find((x) => x.frame === f && x.pass === null).fills.push({ hex: '#D9A441', w: 28, h: 28, role: 'accent' }); }],
  ['MO-C-29', 'the accent on more than 10% of frames', (r) => { r.records.filter((x) => x.pass === null && x.frame < 60).forEach((x) => x.fills.push({ hex: '#D9A441', w: 28, h: 28, role: 'accent' })); }],
  ['MO-C-29', 'a third saturated cluster', (r) => { r.records.filter((x) => x.pass === null && x.frame < 60).forEach((x) => x.fills.push({ hex: '#D9A441', w: 28, h: 28, role: 'accent' }, { hex: '#7A2BD9', w: 200, h: 200, role: 'text' })); }],
  ['MO-A-15', 'a cut more than 1 frame off the beat', (r) => { r.manifest.timeline[1].start = 1.84; r.manifest.timeline[0].end = 1.84; r.manifest.timeline[0].holdSec = 1.84; r.manifest.timeline[1].holdSec = 2.16; }],
  ['MO-A-16', 'a scene held under 2 beats', (r) => { r.manifest.timeline.push({ id: 'end-card-2', sceneId: 'end-card', shotIndex: 1, start: 4, end: 4.6, holdSec: 0.6, kind: 'line', text: 'Go', script: 'latin', beatSec: 4.2 }); }],
  ['MO-SH-03', 'three events in one 1 s window of one shot', (r) => { r.manifest.lithermes.events = [0.2, 0.5, 0.8].map((t) => ({ kind: 'glitch-hit', t, sceneId: 'title-slam', shotIndex: 0 })); }],
  ['MO-SH-04a', 'a full-frame luminance step in one frame pair', (r) => { r.records.find((x) => x.frame === 70 && x.pass === null).fullFrameStep = 0.6; }],
  ['MO-SH-05', 'glitch over 2.0 hits/s', (r) => { r.manifest.passRanges.push({ pass: 'glitch', frameStart: 0, frameEnd: 107, sceneId: 'title-slam', shotIndex: 0, seed: 1, params: { hitRatePerSec: 2.5, areaCapPct: 12, hitRatePerSecRealized: 2.5, hits: [] }, downgraded: false }); r.records.filter((x) => x.pass === null && x.frame <= 107).forEach((x) => r.records.push({ frame: x.frame, pass: 'glitch', draws: 1, uniforms: {} })); }],
  ['MO-SH-05', 'a glitch hit over 20% area', (r) => { r.manifest.passRanges.push({ pass: 'glitch', frameStart: 0, frameEnd: 107, sceneId: 'title-slam', shotIndex: 0, seed: 1, params: { hitRatePerSec: 1, areaCapPct: 25, hitRatePerSecRealized: 0.5, hits: [{ frame: 30, areaPct: 25 }] }, downgraded: false }); r.records.filter((x) => x.pass === null && x.frame <= 107).forEach((x) => r.records.push({ frame: x.frame, pass: 'glitch', draws: 1, uniforms: {} })); }],
  ['MO-SH-06', 'a surge over 2/s or with a short attack', (r) => { r.manifest.passRanges.push({ pass: 'tidal-gradient', frameStart: 0, frameEnd: 107, sceneId: 'title-slam', shotIndex: 0, seed: 1, params: { surgeCapPerSec: 3, surgeAttackSec: 0.05, surgeDecaySec: 0.25, octaves: 4, surges: [] }, downgraded: false }); r.records.filter((x) => x.pass === null && x.frame <= 107).forEach((x) => r.records.push({ frame: x.frame, pass: 'tidal-gradient', draws: 1, uniforms: {} })); }],
  ['MO-SH-07', 'CRT flicker over 0.06', (r) => { r.manifest.passRanges.push({ pass: 'crt', frameStart: 0, frameEnd: 107, sceneId: 'title-slam', shotIndex: 0, seed: 1, params: { flickerAmp: 0.09, flickerAmpRealized: 0.09, persistenceEnabled: false }, downgraded: false }); r.records.filter((x) => x.pass === null && x.frame <= 107).forEach((x) => r.records.push({ frame: x.frame, pass: 'crt', draws: 1, uniforms: {} })); }],
  ['MO-SH-07', 'persistence on a non-stateful scene', (r) => { r.manifest.passRanges.push({ pass: 'crt', frameStart: 0, frameEnd: 107, sceneId: 'title-slam', shotIndex: 0, seed: 1, params: { flickerAmp: 0.03, flickerAmpRealized: 0.03, persistenceEnabled: true }, downgraded: false }); r.records.filter((x) => x.pass === null && x.frame <= 107).forEach((x) => r.records.push({ frame: x.frame, pass: 'crt', draws: 1, uniforms: {} })); }],
  ['MO-SH-08', 'a dither reseed inside a shot', (r) => { r.records.find((x) => x.frame === 40 && x.pass === 'dither').uniforms.u_seed = 12345; }],
  ['MO-SH-09', 'a software renderer without the downgrade', (r) => { r.manifest.renderer = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)'; r.manifest.softwareRenderer = true; r.manifest.samples = 1; }],
  ['MO-SH-10', 'showGuides true', (r) => { r.manifest.passRanges[0].params.showGuides = true; }],
  ['MO-A-58', 'an invert change off a cut', (r) => { r.records.filter((x) => x.pass === null && x.frame >= 30 && x.frame < 200).forEach((x) => { x.overrides.invert = true; }); }],
  ['MO-A-58', 'an invert held under 2 beats', (r) => { r.records.filter((x) => x.pass === null && x.frame >= 108 && x.frame < 140).forEach((x) => { x.overrides.invert = true; }); }],
  ['MO-D-02', 'p95 over the ceiling', (r) => { r.manifest.lithermes.perf.p95Ms = 55; }],
  ['MO-D-03', 'a near-black empty run', (r) => { r.manifest.bpm = 200; r.records.filter((x) => x.pass === null && x.frame >= 110 && x.frame < 239).forEach((x) => { x.glyphInk = 0; x.lumP995 = 0.01; }); }],
  ['MO-D-04', 'a missing glyph', (r) => { r.preflight.missingGlyphs = [{ ch: '뷁', font: 'Galmuri9.ttf' }]; }],
  ['MO-A-33', 'a synthetic horizontal scale on Hangul', (r) => { r.records.find((x) => x.frame === 150 && x.pass === null).textBoxes[0].scaleX = 0.8; }],
  ['MO-FT-05', 'a line break inside a 어절', (r) => { const b = r.records.find((x) => x.frame === 150 && x.pass === null).textBoxes[0]; b.lines = ['작은 신', '호가 모인다']; b.lineHeight = 1.6; }],
  ['MO-SH-01', 'a seed that ignores the formula', (r) => { r.manifest.passRanges[1].seed = 99; }],
  ['MO-SH-00a', 'a range with a frame that has no log line', (r) => { r.records = r.records.filter((x) => !(x.frame === 50 && x.pass === 'swiss-grid')); }],
  ['MO-A-28', 'sub-sample times off the pinned formula', (r) => { r.records.find((x) => x.frame === 12 && x.pass === null).sampleTimes = [0.2, 0.2, 0.2, 0.2]; }],
  ['MO-A-51', 'chromeFlags not on the ladder', (r) => { r.manifest.chromeFlags = ['--no-sandbox']; }],
];

for (const [rule, name, mutate] of cases) {
  test(`gate fixture FAILS ${rule}: ${name}`, async () => {
    const run = await goodRun();
    mutate(run);
    const result = await gate(run);
    assert.ok(failed(result).includes(rule), `${rule} did not fail; failed: ${failed(result).join(', ') || 'none'}`);
  });
}

test('flash failure is the only failure that withholds; MO-D-02 alone still delivers', async () => {
  const run = await goodRun();
  run.records.filter((x) => x.pass === null && x.frame >= 60 && x.frame < 120).forEach((x, i) => { x.flash = { general: i % 15 === 0 ? 1 : i % 15 === 8 ? -1 : 0, red: 0 }; });
  const result = await gate(run);
  assert.ok(failed(result).includes('MO-C-03'));
  assert.equal(result.withhold, true);
  const slow = await goodRun();
  slow.manifest.lithermes.perf.p95Ms = 90;
  const slowResult = await gate(slow);
  assert.deepEqual(failed(slowResult), ['MO-D-02']);
  assert.equal(slowResult.withhold, false);
});

test('a surviving flash FAIL leaves no MP4, preview or poster at the deliverable names', async () => {
  const { promoteExports } = await load('gate.mjs');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-withhold-'));
  try {
    fs.mkdirSync(path.join(out, '.run'));
    for (const name of ['film.mp4', 'preview.webp', 'poster.png', 'reduced-motion.png']) fs.writeFileSync(path.join(out, '.run', name), name);
    promoteExports(out, { withhold: true, previewName: 'preview.webp' });
    for (const name of ['film.mp4', 'preview.webp', 'poster.png', 'reduced-motion.png']) {
      assert.equal(fs.existsSync(path.join(out, name)), false, `${name} must not be deliverable`);
      assert.equal(fs.existsSync(path.join(out, 'withheld', name)), true);
    }
    promoteExports(out, { withhold: false, previewName: 'preview.webp' });
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('the report keeps the MO-C-17 structure, adds the fixed extra lines in order and labels provisional numbers', async () => {
  const { runGate, renderReport } = await load('gate.mjs');
  const run = await goodRun();
  const text = renderReport(run.manifest, runGate(run), { outputs: { film: 'film.mp4', preview: 'preview.webp', poster: 'poster.png', reduced: 'reduced-motion.png' }, framesViewed: [0, 108], egress: 'websocket' });
  const lines = text.split('\n');
  assert.equal(lines[0], 'lit-typographic-motion — render report');
  const order = ['MO-C-01', 'MO-C-02', 'MO-C-03', 'MO-C-04', 'MO-C-05', 'MO-C-06', 'MO-C-07/08', 'MO-C-09', 'MO-C-10/11/12', 'MO-C-13', 'MO-C-14', 'MO-C-25', 'MO-C-26', 'MO-C-27', 'MO-C-29', 'MO-D-02', 'MO-D-03', 'MO-D-04'];
  const positions = order.map((id) => lines.findIndex((line) => line.trimStart().startsWith(id + ' ')));
  assert.ok(positions.every((p) => p > 0), `missing lines: ${order.filter((_, i) => positions[i] < 0).join(', ')}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  for (const id of ['MO-C-05', 'MO-C-06', 'MO-C-13', 'MO-C-14', 'MO-C-25', 'MO-C-29', 'MO-D-02', 'MO-D-03', 'MO-D-04']) {
    assert.match(lines.find((line) => line.trimStart().startsWith(id + ' ')), /provisional/);
  }
  assert.match(text, /craft rounds run: 1 \/ 3 max/);
  assert.match(text, /frames actually viewed this run: 2/);
  assert.ok(lines.findIndex((l) => l.trimStart().startsWith('MO-A-')) > positions.at(-1));
});
