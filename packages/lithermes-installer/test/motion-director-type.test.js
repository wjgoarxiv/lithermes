// Type-path fixes of the director wave: the treatment's length is honoured,
// nothing internal prints on screen, an agent-chosen preset says so, and a
// brief that still holds example placeholders never renders.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { join } = require("node:path");

const root = join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const load = (name) => import(pathToFileURL(join(root, "engine", name)).href);

async function displayTexts(brief, presetId, shotIndex = 0) {
  const { FrameComposer } = await load("frame.mjs");
  const { buildTimeline, normalizeBrief } = await load("timeline.mjs");
  const b = normalizeBrief(brief);
  const { timeline, durationSec } = buildTimeline(b, { presetId, fps: 60 });
  const composer = new FrameComposer({ fonts: null, strokeFonts: null, presetId, signal: "#39FF6A", timeline, plan: { passRanges: [], events: [] }, durationSec, runSeed: b.seed, software: false, brief: b, accent: null });
  const { display } = composer.sceneAt(0.5, { shotIndex });
  return { texts: display.texts.map((t) => t.text), terminal: display.terminal };
}

test("RC8b: no shot index prints unless the brief asks for one", async () => {
  const brief = { text: ["물결 위의 첫 문장", "두 번째 문장", "마지막 인사"] };
  const plain = await displayTexts(brief, "swiss-signal");
  assert.ok(!plain.texts.some((t) => /\d{2}\s*[—/]\s*\d{2}/.test(t)), plain.texts.join(" | "));
  const indexed = await displayTexts({ ...brief, index: true }, "swiss-signal");
  assert.ok(indexed.texts.some((t) => /01\s*—\s*03/.test(t)), indexed.texts.join(" | "));
});

test("RC8b: the terminal window shows no preset id or stock label, only the film's own name when given", async () => {
  const brief = { text: ["터미널에 불이 켜진다", "기록이 흐른다", "안녕"] };
  const plain = await displayTexts(brief, "terminalcore");
  assert.equal(plain.terminal.title, "");
  assert.doesNotMatch(plain.terminal.status, /terminalcore|\d{2}\/\d{2}/);
  const named = await displayTexts({ ...brief, windowTitle: "밤의 등대 일지" }, "terminalcore");
  assert.equal(named.terminal.title, "밤의 등대 일지");
});

test("RC8e: an agent-chosen preset is labelled agent default, a requested one user-specified", async () => {
  const { pickPreset } = await load("presets.mjs");
  assert.equal(pickPreset({ text: ["x"], style: "tidal" }).reason, "agent default");
  assert.equal(pickPreset({ text: ["x"], style: "tidal" }, { request: "tidal 스타일로 파도 문장 영상 만들어줘" }).reason, "user-specified");
  assert.match(pickPreset({ text: ["A terminal wakes"] }).reason, /^agent default \(/);
  assert.match(pickPreset({ text: ["plain words"] }).reason, /^agent default \(/);
});

test("type path honours durationSec by scaling holds, never under the reading floor", async () => {
  const { buildTimeline, normalizeBrief } = await load("timeline.mjs");
  const { readingFloor } = await load("type.mjs");
  const short = normalizeBrief({ text: ["바람", "조용한 저녁", "안녕"], durationSec: 24 });
  const built = buildTimeline(short, { presetId: "swiss-signal", fps: 60 });
  assert.ok(Math.abs(built.durationSec - 24) <= 0.6 + 1e-9, `lands at ${built.durationSec}`);
  const lines = built.timeline.filter((u) => u.kind === "line");
  for (const line of lines) assert.ok(line.holdSec >= readingFloor(line.text, "line"), line.id);
  const holds = lines.map((l) => l.holdSec);
  assert.ok(Math.min(...holds) > 4, `holds scaled up: ${holds}`);
  const long = normalizeBrief({ text: Array.from({ length: 8 }, (_, i) => `이 문장은 읽는 데 시간이 걸리는 꽤 긴 줄입니다 ${i + 1}`), durationSec: 6 });
  const forced = buildTimeline(long, { presetId: "swiss-signal", fps: 60 });
  assert.ok(forced.durationSec > 6);
  assert.ok(forced.warnings.some((w) => /reading floors force .* longer than the requested 6 s/.test(w)), forced.warnings.join("\n"));
});

test("RC8d: a brief that still holds example placeholders is refused", async () => {
  const { normalizeBrief } = await load("timeline.mjs");
  assert.throws(() => normalizeBrief({ text: ["<line one>", "a real line"] }), /placeholder/);
  assert.throws(() => normalizeBrief({ text: ["a real line"], topic: "<topic words>" }), /placeholder/);
});
