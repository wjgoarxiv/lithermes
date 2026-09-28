// Real-renderer checks. They need Chrome and a pre-warmed motion cache; the
// suite never fetches one. Point LITHERMES_MOTION_TEST_XDG at an
// XDG_CACHE_HOME that holds a warm cache (`lithermes motion-runtime install`).
// When either is missing every test here skips with the reason printed.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const skillRoot = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const motion = path.join(skillRoot, "bin", "motion.mjs");
const temps = [];
const tmp = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(dir); return dir; };
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const XDG = process.env.LITHERMES_MOTION_TEST_XDG || "";
const skipReason = !fs.existsSync(CHROME) ? `Chrome not found at ${CHROME}`
  : !XDG || !fs.existsSync(path.join(XDG, "lithermes", "motion")) ? "LITHERMES_MOTION_TEST_XDG does not name a pre-warmed motion cache"
    : null;
if (skipReason) console.log(`# motion-render tests skipped: ${skipReason}`);
// Every type-path render needs a treatment first; these engine checks use the
// shared type-led one.
const { typeTreatment, writeTreatment } = require("./motion-director-support");
const motionSpawn = (args, options) => {
  const at = args.indexOf("--out");
  if (at >= 0 && ["run", "stills", "sheet", "video", "perf"].includes(args[0])) writeTreatment(args[at + 1], typeTreatment(undefined, { durationSec: 4 }));
  return spawnSync(process.execPath, [motion, ...args], options);
};
const env = (extra = {}) => ({ ...process.env, XDG_CACHE_HOME: XDG, HOME: tmp("motion-home-"), ...extra });

function brief(dir, body) {
  const file = path.join(dir, "brief.json");
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}
function hashFrame(briefFile, frame, extra = [], envExtra = {}) {
  const out = tmp("motion-hash-");
  const run = motionSpawn(["hash-frame", "--brief", briefFile, "--out", out, "--frame", String(frame), ...extra], { encoding: "utf8", env: env(envExtra), timeout: 300000 });
  assert.equal(run.status, 0, run.stderr);
  const line = run.stdout.split("\n").find((l) => l.startsWith("MOTION_FRAME "));
  assert.ok(line, run.stdout + run.stderr);
  return JSON.parse(line.slice("MOTION_FRAME ".length));
}

const counterBrief = { text: ["Counting the lamps", "3,400 lamps tonight", "다시 만나요"], style: "swiss-signal" };
const terminalBrief = { text: ["terminal wake up", "로그 확인 완료", "done"], style: "terminalcore" };

test("MO-C-09: two independent processes on the SwiftShader rung give equal rgbaSha256", { skip: skipReason || false, timeout: 900000 }, () => {
  const file = brief(tmp("motion-det-"), counterBrief);
  const a = hashFrame(file, 100, ["--force-software", "--samples", "1"]);
  const b = hashFrame(file, 100, ["--force-software", "--samples", "1"]);
  assert.match(a.renderer, /SwiftShader/i);
  assert.equal(a.rgbaSha256, b.rgbaSha256);
});

test("MO-A-25: a cold seek equals the sequential frame for a stateful counter and for CRT persistence", { skip: skipReason || false, timeout: 900000 }, () => {
  const counter = brief(tmp("motion-seek-"), counterBrief);
  const seekFrame = 150;
  const seek = hashFrame(counter, seekFrame, ["--samples", "4"]);
  const sequential = hashFrame(counter, seekFrame, ["--samples", "4", "--from", "0"]);
  assert.equal(seek.rgbaSha256, sequential.rgbaSha256, "counter: seeked frame differs from the sequential one");
  const term = brief(tmp("motion-seek-crt-"), terminalBrief);
  const a = hashFrame(term, 40, ["--samples", "4"]);
  const b = hashFrame(term, 40, ["--samples", "4", "--from", "0"]);
  assert.equal(a.rgbaSha256, b.rgbaSha256, "CRT persistence: seeked frame differs from the sequential one");
});

test("egress: a refused listen takes the CDP pull and returns the same bytes", { skip: skipReason || false, timeout: 900000 }, () => {
  const file = brief(tmp("motion-egress-"), counterBrief);
  const socket = hashFrame(file, 30, ["--samples", "1"]);
  const pulled = hashFrame(file, 30, ["--samples", "1"], { LITHERMES_MOTION_FAULT_LISTEN: "EPERM" });
  assert.equal(socket.egress, "websocket");
  assert.equal(pulled.egress, "cdp-pull");
  assert.equal(pulled.rgbaSha256, socket.rgbaSha256);
});

test("BLOCKED: no Chrome exits 10 and a Chrome without WebGL2 exits 11, each naming its real cause", { skip: skipReason || false, timeout: 900000 }, () => {
  const dir = tmp("motion-blocked-");
  const file = brief(dir, counterBrief);
  const none = motionSpawn(["stills", "--brief", file, "--out", path.join(dir, "o1")], { encoding: "utf8", env: env({ CHROME_PATH: path.join(dir, "no-chrome") }) });
  assert.equal(none.status, 10, none.stderr);
  assert.match(none.stderr, /BLOCKED_NO_CHROME: Chrome\/Chromium not found/);
  const wrapper = path.join(dir, "chrome-no-webgl");
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${JSON.stringify(CHROME)} "$@" --disable-webgl --disable-webgl2 --disable-3d-apis\n`, { mode: 0o755 });
  const noGl = motionSpawn(["stills", "--brief", file, "--out", path.join(dir, "o2")], { encoding: "utf8", env: env({ CHROME_PATH: wrapper }), timeout: 300000 });
  assert.equal(noGl.status, 11, noGl.stderr);
  assert.match(noGl.stderr, /BLOCKED_NO_WEBGL2/);
  assert.doesNotMatch(noGl.stderr, /not found/);
});

test("BLOCKED: without ffmpeg, video exits 12 while stills and the sheet still exit 0", { skip: skipReason || false, timeout: 900000 }, () => {
  const dir = tmp("motion-noff-");
  const file = brief(dir, counterBrief);
  const noFfmpeg = env({ PATH: "/usr/bin:/bin" });
  const video = motionSpawn(["video", "--brief", file, "--out", path.join(dir, "v")], { encoding: "utf8", env: noFfmpeg });
  assert.equal(video.status, 12, video.stderr);
  assert.match(video.stderr, /BLOCKED_NO_FFMPEG_FOR_VIDEO/);
  const stills = motionSpawn(["stills", "--brief", file, "--out", path.join(dir, "s")], { encoding: "utf8", env: noFfmpeg, timeout: 300000 });
  assert.equal(stills.status, 0, stills.stderr);
  assert.ok(fs.readdirSync(path.join(dir, "s", "stills")).length >= 3);
  const sheet = motionSpawn(["sheet", "--cuts", "--brief", file, "--out", path.join(dir, "h")], { encoding: "utf8", env: noFfmpeg, timeout: 300000 });
  assert.equal(sheet.status, 0, sheet.stderr);
  assert.ok(fs.existsSync(path.join(dir, "h", "sheet", "cuts.png")));
  const run = motionSpawn(["run", "--brief", file, "--out", path.join(dir, "r")], { encoding: "utf8", env: noFfmpeg, timeout: 300000 });
  assert.equal(run.status, 12, run.stderr);
  assert.ok(fs.existsSync(path.join(dir, "r", "sheet", "cuts.png")), "run degrades to stills and the sheet");
});

test("terminalcore: one window label across cuts, a reachable preview rung, and hard cuts that never mix two shots", { skip: skipReason || false, timeout: 900000 }, () => {
  const dir = tmp("motion-term-");
  const cutBrief = { text: ["night shift log", "서버 점검 완료", "uptime 99.9%"], scenes: ["title-slam", "karaoke-line", "number-counter"], style: "terminalcore", windowTitle: "night shift log" };
  const run = motionSpawn(["run", "--brief", brief(dir, cutBrief), "--out", path.join(dir, "o")], { encoding: "utf8", env: env(), timeout: 600000 });
  assert.ok([0, 13].includes(run.status), run.stderr);
  assert.ok(fs.existsSync(path.join(dir, "o", "preview.webp")) || fs.existsSync(path.join(dir, "o", "preview.gif")), "no preview rung was reachable");
  const boxes = fs.readFileSync(path.join(dir, "o", "render.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).flatMap((r) => r.textBoxes || []);
  const labels = new Set(boxes.filter((b) => b.elementId === "term:label").map((b) => b.text));
  assert.equal(labels.size, 1, `the label changes at a cut and CRT persistence ghosts it: ${[...labels].join(", ")}`);
  const smallest = Math.min(...boxes.map((b) => b.fontSizePx));
  // CRT and dither noise can push the 960-px rung past 3 MB, so the 720-px rung must stay reachable.
  assert.ok(smallest * (720 / 1920) >= 10, `smallest glyph ${smallest} px falls under 10 px at the 720 preview rung`);
  const report = fs.readFileSync(path.join(dir, "o", "gate-report.txt"), "utf8");
  assert.doesNotMatch(report, /MO-C-06 .*FAIL/, "type contrast fails (a cut frame averaging the old shot's text over the new one reads as a ghost)");
});

test("the tests' own Chrome launches carry the keychain flags (no OS keychain prompt)", { skip: skipReason || false, timeout: 900000 }, () => {
  const dir = tmp("motion-keychain-");
  const run = motionSpawn(["stills", "--brief", brief(dir, counterBrief), "--out", path.join(dir, "o")], { encoding: "utf8", env: env(), timeout: 300000 });
  assert.equal(run.status, 0, run.stderr);
  const flags = JSON.parse(fs.readFileSync(path.join(dir, "o", "manifest.json"), "utf8")).chromeFlags;
  assert.ok(flags.includes("--use-mock-keychain"), flags.join(" "));
  assert.ok(flags.includes("--password-store=basic"), flags.join(" "));
});

test("MO-A-43: a render leaves the product cache byte-for-byte unchanged", { skip: skipReason || false, timeout: 900000 }, () => {
  const listing = () => {
    const rows = [];
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) rows.push(`${path.relative(XDG, p)} ${fs.statSync(p).size} ${fs.statSync(p).mtimeMs}`); } };
    walk(path.join(XDG, "lithermes", "motion"));
    return crypto.createHash("sha256").update(rows.sort().join("\n")).digest("hex");
  };
  const before = listing();
  const dir = tmp("motion-ro-");
  const run = motionSpawn(["stills", "--brief", brief(dir, counterBrief), "--out", path.join(dir, "o")], { encoding: "utf8", env: env(), timeout: 300000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(listing(), before);
});

test("audio: a warm --audio venv snaps cuts to the file's beats; without one the film uses text timing and says so", { skip: skipReason || false, timeout: 900000 }, async () => {
  const dir = tmp("motion-audio-");
  const wav = path.join(dir, "clicks.wav");
  const made = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=9",
    "-af", "volume='if(lt(mod(t,0.5),0.04),1,0)':eval=frame", wav], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const file = brief(dir, { text: ["Harbor at dusk", "물결 소리를 듣는다", "see you"], style: "swiss-signal", audio: "clicks.wav" });
  const run = motionSpawn(["run", "--stills-only", "--brief", file, "--out", path.join(dir, "o")], { encoding: "utf8", env: env(), timeout: 600000 });
  assert.equal(run.status, 0, run.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "o", "manifest.json"), "utf8"));
  const { audioState } = await import(path.join(skillRoot, "bin", "runtime.mjs"));
  if (audioState({ ...process.env, XDG_CACHE_HOME: XDG }).state === "ready") {
    assert.equal(manifest.audioTier, "librosa-beat-grid");
    assert.ok(Array.isArray(manifest.beatGrid) && manifest.beatGrid.length >= 8, "no beat grid recorded");
    for (const unit of manifest.timeline.filter((u) => u.kind === "line" && u.start > 0)) {
      assert.ok(manifest.beatGrid.some((b) => Math.abs(b - unit.beatSec) < 1e-6) || unit.beatSec > manifest.beatGrid.at(-1), `${unit.id} not on a detected beat`);
    }
    assert.ok(fs.existsSync(path.join(dir, "o", "audio-grid.json")), "the beat grid is a run artifact in the output dir");
  } else {
    assert.equal(manifest.audioTier, "text-reading-time");
    assert.ok(manifest.warnings.some((w) => /audio analysis not prewarmed: run lithermes motion-runtime install --audio/.test(w)), manifest.warnings.join("\n"));
  }
});
