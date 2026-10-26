// Reading floor: a copy line that reads settled for the whole beat passes even
// when its last visible tick slides (the push handoff moves the box into a new
// position bucket). The span is the line's, not the bucket's.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const skillRoot = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const load = (name) => import(pathToFileURL(path.join(skillRoot, "engine", name)).href);

const LINES = [
  "still water, small sea",
  "the crab changes its house",
  "anemone closes its hand",
  "see you when the water returns",
];
const norm = (s) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

// Visible tick ranges (10 fps) per beat: enter ramp, settled run, push-out tail.
const VISIBLE = [
  { line: 0, from: 24, to: 114, box: [154, 470, 1535, 609] },
  { line: 1, from: 150, to: 234, box: [154, 453, 774, 627] },
  { line: 2, from: 264, to: 342, box: [154, 865, 1047, 948] },
  { line: 3, from: 372, to: 474, box: [154, 895, 1269, 978] },
];
const TAIL = { line: 2, frame: 348, box: [0, 865, 857, 948] };

function fakeStage() {
  let t = 0;
  const runFor = (line, f, box) => ({
    id: `line-${line}`, text: LINES[line], norm: norm(LINES[line]), decor: false,
    opacity: 1, rects: [box], box,
    fontSizePx: 76, weight: 700,
    bucket: `${Math.round((box[0] + box[2]) / 200)}:${Math.round((box[1] + box[3]) / 200)}`,
  });
  return {
    blocked: [], contract: [],
    async load() { return { film: { width: 1920, height: 1080, fps: 60, duration: 8 }, faces: [], errors: [] }; },
    async prepare() { return { faces: [], errors: [] }; },
    async step(next) { t = next; return { violations: [], errors: [], webglNull: false }; },
    async capture() { return Buffer.from([0]); },
    async close() {},
    cdp: {
      async send(method) {
        if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
        if (method === "DOM.querySelector") return { nodeId: 0 };
        if (method === "DOM.querySelectorAll") return { nodeIds: [] };
        if (method === "CSS.getPlatformFontsForNode") return { fonts: [] };
        return {};
      },
    },
    page: {
      async evaluate(fn) {
        const src = String(fn);
        if (src.includes("__litQa.runs")) {
          const f = Math.round(t * 60);
          const runs = [];
          for (const v of VISIBLE) {
            if (f < v.from || f > v.to) continue;
            runs.push(runFor(v.line, f, v.box));
          }
          if (f === TAIL.frame) runs.push(runFor(TAIL.line, f, TAIL.box));
          return { runs, canvasTextCalls: 0 };
        }
        return {};
      },
    },
  };
}

test("reading floor: a push-out tail does not fail a line that read settled all beat", async () => {
  const { runTextQa } = await load("stage-qa.mjs");
  const W = 1920, H = 1080;
  const beats = [0, 1, 2, 3].map((index) => {
    const first = index * 120, last = first + 119;
    return { index, first, last, mid: Math.round((first + last) / 2) };
  });
  const treatment = {
    path: "stage", format: "16:9", request: "a rock-pool film", idea: "one pool",
    durationSec: 8, copy: { lines: LINES },
    beats: beats.map((b) => ({ t0: b.first / 60, t1: (b.last + 1) / 60, layout: "stage", transition: "cut" })),
  };
  const blank = { data: Buffer.alloc(W * H * 4), width: W, height: H };
  const session = {
    size: [W, H], fps: 60, treatment, beats, totalFrames: 480,
    PNG: { sync: { read: () => blank } }, open: async () => fakeStage(),
  };
  const qa = await runTextQa(session);
  const byId = Object.fromEntries(qa.rules.map((r) => [r.id, r]));
  assert.equal(byId["copy-found"].status, "PASS", JSON.stringify(byId["copy-found"]));
  assert.equal(byId["text-reading-floor"].status, "PASS", JSON.stringify(byId["text-reading-floor"]));
});
