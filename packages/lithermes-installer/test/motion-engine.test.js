const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');

const root = join(__dirname, '..', 'assets', 'lithermes-plugin', 'skills', 'lit-typographic-motion');
const load = (name) => import(pathToFileURL(join(root, 'engine', name)).href);

// A monospace test font: every glyph is a 600x700 box on a 1000 upm grid, with
// one kerning pair so glyphX can be checked against a slice measurement.
function boxFont(id, { hangul = false, kernAV = -80 } = {}) {
  const glyphs = new Map();
  return {
    id, file: `${id}.ttf`, upm: 1000, ascender: 800, descender: -200, capHeight: 700,
    has: (ch) => (hangul ? /[가-힣\d\s.,]/u.test(ch) : !/[가-힣]/u.test(ch)),
    glyph(ch) {
      if (!glyphs.has(ch)) glyphs.set(ch, { index: ch.codePointAt(0), advance: ch === ' ' ? 300 : 600, bbox: ch === ' ' ? null : { x1: 40, y1: 0, x2: 560, y2: 700 }, raw: ch, pathData: () => 'M0 0Z' });
      return glyphs.get(ch);
    },
    kern: (a, b) => (a.raw === 'A' && b.raw === 'V' ? kernAV : 0),
  };
}

test('fnv1a32 and mulberry32 match their reference vectors', async () => {
  const { fnv1a32, mulberry32, passSeed } = await load('util.mjs');
  assert.equal(fnv1a32(''), 0x811c9dc5);
  assert.equal(fnv1a32('a'), 0xe40c292c);
  assert.equal(fnv1a32('foobar'), 0xbf9cf968);
  assert.equal(passSeed(20260926, 'title-slam', 0, 'dither'), 0xdc200f42);
  const rng = mulberry32(1);
  assert.deepEqual([rng(), rng(), rng()].map((v) => Math.round(v * 4294967296)), [2693262067, 11749833, 2265367787]);
  assert.equal(mulberry32(42)(), mulberry32(42)());
  assert.notEqual(mulberry32(42)(), mulberry32(43)());
});

test('sub-sample times follow the pinned shutter formula and clamp at 0', async () => {
  const { sampleTimes } = await load('frame.mjs');
  assert.deepEqual(sampleTimes(0, 60, 4, 0.5), [0, 0, 0.5 / 60 * 0.125, 0.5 / 60 * 0.375]);
  const t = sampleTimes(60, 60, 4, 0.5);
  assert.ok(Math.abs(t[0] - (1 - 0.375 / 120)) < 1e-12 && Math.abs(t[3] - (1 + 0.375 / 120)) < 1e-12);
  assert.deepEqual(sampleTimes(30, 60, 1, 0.5), [0.5]);
});

test('the one reading-floor function covers EN, KO and mixed units', async () => {
  const { readingFloor, readingCounts } = await load('type.mjs');
  assert.equal(readingFloor('가나다라 마바사아 자차카타 파하', 'line').toFixed(2), '2.80');
  assert.equal(readingFloor('Hello', 'line'), 0.9);
  assert.equal(readingFloor('안녕', 'line'), 1.0);
  assert.equal(readingFloor('Hi', 'word'), 0.5);
  assert.equal(readingFloor('anything at all', 'reveal'), 0.35);
  assert.ok(Math.abs(readingFloor('one two three four five six seven eight nine ten', 'line') - 10 / 3.3) < 1e-9);
  assert.deepEqual(readingCounts('LIT 스튜디오 2026'), { H: 4, W: 2, C: 4 });
  assert.ok(Math.abs(readingFloor('LIT 스튜디오 2026', 'line') - (0.8 + 2 / 3.3)) < 1e-9);
});

test('어절 breaking and wrapping never split a word', async () => {
  const { eojeols, wrapWords } = await load('type.mjs');
  assert.deepEqual(eojeols('  오늘은   바람이 좋다 '), ['오늘은', '바람이', '좋다']);
  const lines = wrapWords('오늘은 바람이 좋다 내일은 비', 7, (s) => Array.from(s).length);
  for (const line of lines) for (const word of line.split(' ')) assert.ok(['오늘은', '바람이', '좋다', '내일은', '비'].includes(word));
  assert.deepEqual(wrapWords('초장문단어하나', 3, (s) => Array.from(s).length), ['초장문단어하나']);
});

test('script runs attach digits and punctuation to the adjacent run', async () => {
  const { scriptRuns } = await load('type.mjs');
  const brief = (text) => scriptRuns(text).map((r) => [r.script, r.text]);
  assert.deepEqual(brief('2026년'), [['hangul', '2026년']]);
  assert.deepEqual(brief('LIT팀'), [['latin', 'LIT'], ['hangul', '팀']]);
  assert.deepEqual(brief('LIT 2026 팀'), [['latin', 'LIT 2026 '], ['hangul', '팀']]);
  assert.deepEqual(brief('Hello, 세계!'), [['latin', 'Hello, '], ['hangul', '세계!']]);
});

test('smart and plain punctuation round-trip our own brief text', async () => {
  const { smart, plain } = await load('type.mjs');
  assert.equal(smart('"Go" ... it\'s \'til dawn'), '“Go” … it’s ’til dawn');
  assert.equal(plain(smart('"Go" ... it\'s')), '"Go" ... it\'s');
});

test('glyphX keeps the kern between split pieces (never a slice measurement)', async () => {
  const { layoutLine, glyphX } = await load('type.mjs');
  const font = boxFont('latin');
  const layout = layoutLine('AVA', 100, () => font);
  assert.equal(layout.glyphs[1].x, 60 - 8);
  assert.equal(glyphX(layout, 1), 52);
  const slice = layoutLine('A', 100, () => font).width;
  assert.notEqual(glyphX(layout, 1), slice);
});

test('Hangul runs never receive tracking even inside a tracked Latin line', async () => {
  const { layoutLine } = await load('type.mjs');
  const latin = boxFont('latin'), hangul = boxFont('hangul', { hangul: true });
  const layout = layoutLine('LIT 스튜디오', 100, (run) => (run.script === 'hangul' ? hangul : latin), () => -0.04);
  const h = layout.glyphs.filter((g) => g.script === 'hangul');
  assert.equal(h[1].x - h[0].x, 60);
  const l = layout.glyphs.filter((g) => g.script === 'latin');
  assert.equal(Math.round((l[1].x - l[0].x) * 100) / 100, 56);
  assert.equal(layout.runs.find((r) => r.script === 'hangul').trackingEm, 0);
});

test('post-chain override ranges and neutral values are fixed', async () => {
  const { OVERRIDES, POST_ORDER } = await load('constants.mjs');
  assert.deepEqual(OVERRIDES.flash, [0, 1, 0]);
  assert.deepEqual(OVERRIDES.fade, [0, 1, 1]);
  assert.deepEqual(OVERRIDES.bloomThreshold, [0, 1, 0.85]);
  assert.deepEqual(OVERRIDES.zoom, [0, null, 1]);
  assert.deepEqual(POST_ORDER, ['bloom+halation', 'chromatic-aberration', 'tone-shoulder', 'film-grain', 'vignette', 'flash', 'shake/zoom', 'invert']);
});

test('preset auto-pick matches whole words, first row first, explicit style wins', async () => {
  const { pickPreset } = await load('presets.mjs');
  assert.equal(pickPreset({ text: ['A terminal wakes at midnight'] }).id, 'terminalcore');
  assert.equal(pickPreset({ text: ['터미널에 불이 켜진다'] }).id, 'terminalcore');
  assert.equal(pickPreset({ text: ['terminally curious'] }).id, 'swiss-signal');
  assert.equal(pickPreset({ text: ['결제 시스템 소개'] }).id, 'swiss-signal');
  assert.equal(pickPreset({ text: ['our workflow tool'] }).id, 'swiss-signal');
  assert.equal(pickPreset({ text: ['잔잔한 파도 소리'] }).id, 'tidal');
  assert.equal(pickPreset({ text: ['A calm terminal'] }).id, 'terminalcore');
  assert.equal(pickPreset({ text: ['A calm terminal'], style: 'tidal' }).id, 'tidal');
  assert.equal(pickPreset({ text: ['a quiet sea of waves'] }).id, 'swiss-signal');
  assert.throws(() => pickPreset({ text: ['x'], style: 'neon' }), /unknown style/);
});

test('the generated timeline clears its own floors, snaps cuts forward and never splits a 어절', async () => {
  const { buildTimeline, normalizeBrief } = await load('timeline.mjs');
  const { readingFloor } = await load('type.mjs');
  const brief = normalizeBrief({ text: ['Signals in the dark', '오늘 우리는 새로운 문장을 천천히 읽는다', '120,000 readers joined', 'Thank you'] });
  const { timeline, durationSec } = buildTimeline(brief, { presetId: 'swiss-signal' });
  const beat = 0.6;
  for (const unit of timeline) {
    assert.ok(unit.holdSec >= readingFloor(unit.text, unit.kind) - 1 / 60, `${unit.id} under its floor`);
    assert.ok(Math.abs(unit.start - unit.beatSec) <= 1 / 60, `${unit.id} off the beat`);
    if (unit.kind === 'line') assert.ok(unit.holdSec >= 2 * beat - 1 / 60);
    if (unit.kind === 'line') assert.ok(Math.abs(unit.beatSec / beat - Math.round(unit.beatSec / beat)) < 1e-6);
    assert.equal(unit.holdSec, Math.round((unit.end - unit.start) * 1e6) / 1e6);
  }
  const reveals = timeline.filter((u) => u.kind === 'reveal' && u.sceneId === 'karaoke-line');
  assert.deepEqual(reveals.map((r) => r.text), ['오늘', '우리는', '새로운', '문장을', '천천히', '읽는다']);
  assert.equal(timeline.find((u) => u.kind === 'line' && u.sceneId === 'number-counter').text, '120,000 readers joined');
  assert.ok(durationSec >= 3);
  const short = buildTimeline(normalizeBrief({ text: ['Hi'] }), { presetId: 'swiss-signal' });
  assert.ok(short.durationSec >= 3);
});

test('every Chrome flag rung on every platform keeps Chrome off the OS keychain', async () => {
  const { chromeFlagLadder } = await load('constants.mjs');
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const rung of chromeFlagLadder(platform)) {
      assert.ok(rung.includes('--use-mock-keychain'), `${platform} ${rung[0]} lacks --use-mock-keychain`);
      assert.ok(rung.includes('--password-store=basic'), `${platform} ${rung[0]} lacks --password-store=basic`);
    }
  }
});

test('a cut lands on its own frame even when the timeline rounded its start up', async () => {
  const { FrameComposer } = await load('frame.mjs');
  const timeline = [
    { id: 'a', sceneId: 'title-slam', shotIndex: 0, kind: 'line', text: 'A', start: 0, end: 1.666667, holdSec: 1.666667, beatSec: 0 },
    { id: 'b', sceneId: 'end-card', shotIndex: 0, kind: 'line', text: 'B', start: 1.666667, end: 5, holdSec: 3.333333, beatSec: 1.666667 },
  ];
  const composer = new FrameComposer({ presetId: 'tidal', timeline, durationSec: 5, brief: {} });
  assert.equal(composer.shotIndexAt(99 / 60), 0);
  assert.equal(composer.shotIndexAt(100 / 60), 1, 'frame 100 is the cut frame (100/60 = 1.6666667 s)');
});
