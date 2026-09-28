// Sound on both paths: the generated bed (deterministic, BS.1770 loudness in
// product code, cues only where a beat asks), the always-mux rule for supplied
// and authored tracks, and the sound gate on the decoded muxed stream.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { stageTreatment, typeTreatment, writeTreatment } = require("./motion-director-support");

const skillRoot = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const motion = path.join(skillRoot, "bin", "motion.mjs");
const load = () => import(pathToFileURL(path.join(skillRoot, "engine", "sound.mjs")).href);
const temps = [];
const tmp = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(dir); return dir; };
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const XDG = process.env.LITHERMES_MOTION_TEST_XDG;
const chromeSkip = !fs.existsSync(CHROME) ? "no Chrome" : !XDG || !fs.existsSync(path.join(XDG, "lithermes", "motion")) ? "LITHERMES_MOTION_TEST_XDG does not name a pre-warmed motion cache" : !hasFfmpeg ? "no ffmpeg" : false;

function generatedTreatment(palette = "soft-mallet") {
  const t = stageTreatment({ durationSec: 12, sound: { mode: "generated", plan: "pulse under a pad, a hit on the second cut", palette } });
  t.beats[1].sound = "a soft hit on the cut";
  t.beats[2].sound = "a closing cadence";
  return t;
}

function wav(file, seconds, hz = 330, amplitude = 0.3) {
  const n = Math.round(seconds * 48000);
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(48000, 24); buf.writeUInt32LE(192000, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const v = Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * hz * i) / 48000)); buf.writeInt16LE(v, 44 + i * 4); buf.writeInt16LE(v, 46 + i * 4); }
  fs.writeFileSync(file, buf);
  return file;
}

function silentVideo(file, seconds) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=0x203040:s=320x180:r=60:d=${seconds}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return file;
}

const probe = (file) => JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "json", file], { encoding: "utf8" }).stdout).streams;

test("BS.1770: a -20 dBFS 997 Hz sine in both channels measures -20 LUFS", async () => {
  const { integratedLoudness } = await load();
  const n = 48000 * 5;
  const ch = Float64Array.from({ length: n }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 997 * i) / 48000));
  const lufs = integratedLoudness([ch, ch]);
  assert.ok(Math.abs(lufs - -20) < 0.1, `measured ${lufs}`);
  assert.equal(integratedLoudness([new Float64Array(n), new Float64Array(n)]), -Infinity);
});

test("generated bed: exact length, -16 LUFS +-2, peak <= -2 dBFS, same SHA-256 twice, palettes differ", async () => {
  const { buildBed } = await load();
  const hashes = new Set();
  for (const palette of ["soft-mallet", "warm-keys", "glass-pulse", "low-strings"]) {
    const out = tmp("bed-");
    const cuts = [4, 8];
    const a = buildBed({ out, treatment: generatedTreatment(palette), fps: 60, totalFrames: 720, cuts });
    const first = sha(a.file);
    const b = buildBed({ out, treatment: generatedTreatment(palette), fps: 60, totalFrames: 720, cuts });
    assert.equal(sha(b.file), first, `${palette} bed is not deterministic`);
    assert.equal(a.samples, Math.round((720 * 48000) / 60));
    const bytes = fs.readFileSync(a.file);
    assert.equal(bytes.readUInt32LE(40), a.samples * 4, "exact sample count in the data chunk");
    assert.equal(bytes.readUInt32LE(24), 48000);
    assert.equal(bytes.readUInt16LE(22), 2);
    assert.ok(Math.abs(a.loudnessLufs - -16) <= 2, `${palette} ${a.loudnessLufs} LUFS`);
    assert.ok(a.peakDbfs <= -2, `${palette} peak ${a.peakDbfs}`);
    hashes.add(first);
    const cues = JSON.parse(fs.readFileSync(path.join(out, "sound-cues.json"), "utf8"));
    assert.deepEqual(cues.cues.filter((c) => c.cue === "hit").map((c) => c.beat), [1], "a hit only where a beat asks");
    assert.deepEqual(cues.cues.filter((c) => c.cue === "chord").map((c) => c.time), [0, 4, 8], "chords change on the cuts");
    for (const cue of cues.cues) assert.ok(Number.isFinite(cue.delta), "every cue carries its delta");
  }
  assert.equal(hashes.size, 4);
});

test("generated bed: BS.1770 in product code agrees with ffmpeg ebur128 within 0.5 LU", { skip: !hasFfmpeg && "no ffmpeg" }, async () => {
  const { buildBed } = await load();
  const out = tmp("bed-ebu-");
  const bed = buildBed({ out, treatment: generatedTreatment("glass-pulse"), fps: 60, totalFrames: 900, cuts: [5, 10] });
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", bed.file, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const measured = Number(r.stderr.match(/I:\s+(-?[\d.]+) LUFS/g).at(-1).match(/-?[\d.]+/)[0]);
  assert.ok(Math.abs(measured - bed.loudnessLufs) <= 0.5, `product ${bed.loudnessLufs} vs ffmpeg ${measured}`);
});

test("mux: a short supplied track is padded to the film, never shortening it", { skip: !hasFfmpeg && "no ffmpeg" }, async () => {
  const { produceSound } = await load();
  const out = tmp("mux-");
  const video = silentVideo(path.join(out, "video.mp4"), 4);
  wav(path.join(out, "voice.wav"), 1);
  const t = stageTreatment({ durationSec: 4, sound: { mode: "supplied", plan: "the user's own recording", file: "voice.wav" } });
  const result = await produceSound({ out, treatment: t, fps: 60, totalFrames: 240, cuts: [], video, output: path.join(out, "film.mp4") });
  const streams = probe(path.join(out, "film.mp4"));
  const audio = streams.find((s) => s.codec_type === "audio"), vid = streams.find((s) => s.codec_type === "video");
  assert.ok(audio, "audio stream present");
  assert.ok(Math.abs(Number(audio.duration) - 4) <= 0.1, `audio ${audio.duration}`);
  assert.ok(Math.abs(Number(vid.duration) - 4) <= 0.05, `video ${vid.duration}`);
  assert.equal(result.rules.find((r) => r.id === "sound-duration").status, "PASS");
  assert.equal(result.rules.find((r) => r.id === "sound-silence").status, "WARN", "2 s of padding inside the first 3 s is reported, not hidden");
});

test("mux: a planned track that cannot be muxed, or a film without its stream, exits 20", { skip: !hasFfmpeg && "no ffmpeg" }, async () => {
  const { produceSound, soundGate } = await load();
  const out = tmp("mux-bad-");
  const video = silentVideo(path.join(out, "video.mp4"), 4);
  fs.writeFileSync(path.join(out, "broken.wav"), "not a wav file");
  const t = stageTreatment({ durationSec: 4, sound: { mode: "supplied", plan: "x", file: "broken.wav" } });
  await assert.rejects(() => produceSound({ out, treatment: t, fps: 60, totalFrames: 240, cuts: [], video, output: path.join(out, "film.mp4") }), (e) => e.exitCode === 20 && /SOUND_INVALID/.test(e.message));
  assert.throws(() => soundGate({ file: video, mode: "generated" }), (e) => e.exitCode === 20 && /no audio stream/.test(e.message));
});

test("sound CLI: builds the bed and cues from the treatment alone", () => {
  const out = tmp("sound-cli-");
  writeTreatment(out, generatedTreatment("warm-keys"));
  const run = spawnSync(process.execPath, [motion, "sound", "--out", out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /warm-keys, [A-G][#b]? (major|minor), [\d.]+ BPM; -1[5-7](\.\d+)? LUFS/);
  assert.ok(fs.existsSync(path.join(out, "sound", "bed.wav")) && fs.existsSync(path.join(out, "sound-cues.json")));
});

// A warm cache without the librosa venv: node deps and fonts linked, audio absent.
function cacheWithoutAudio() {
  const src = fs.readdirSync(path.join(XDG, "lithermes", "motion")).map((d) => path.join(XDG, "lithermes", "motion", d)).find((d) => fs.existsSync(path.join(d, "READY")));
  const xdg = tmp("xdg-noaudio-");
  const dst = path.join(xdg, "lithermes", "motion", path.basename(src));
  fs.mkdirSync(dst, { recursive: true });
  for (const name of ["node", "assets"]) fs.symlinkSync(path.join(src, name), path.join(dst, name));
  fs.copyFileSync(path.join(src, "READY"), path.join(dst, "READY"));
  return xdg;
}

test("type path: a supplied WAV is muxed even when the librosa tier is absent", { skip: chromeSkip, timeout: 900000 }, () => {
  const out = tmp("type-audio-");
  const t = typeTreatment(undefined, { durationSec: 4 });
  t.sound = { mode: "supplied", plan: "the user's recording under the lines", file: "voice.wav" };
  writeTreatment(out, t);
  wav(path.join(out, "voice.wav"), 2.5);
  fs.writeFileSync(path.join(out, "brief.json"), JSON.stringify({ text: t.copy.lines, audio: "voice.wav" }));
  const xdg = cacheWithoutAudio();
  const run = spawnSync(process.execPath, [motion, "run", "--out", out, "--round", "2"], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: xdg, HOME: tmp("home-") }, timeout: 900000 });
  assert.ok([0, 13].includes(run.status), run.stderr);
  const streams = probe(path.join(out, fs.existsSync(path.join(out, "film.mp4")) ? "film.mp4" : "withheld/film.mp4"));
  const audio = streams.find((s) => s.codec_type === "audio"), vid = streams.find((s) => s.codec_type === "video");
  assert.ok(audio, "the supplied track was dropped");
  assert.ok(Math.abs(Number(audio.duration) - Number(vid.duration)) <= 0.1, `audio ${audio.duration} vs video ${vid.duration}`);
});

test("type path: the generated bed is the default and is muxed", { skip: chromeSkip, timeout: 900000 }, () => {
  const out = tmp("type-bed-");
  writeTreatment(out, typeTreatment(undefined, { durationSec: 4 }));
  const run = spawnSync(process.execPath, [motion, "run", "--out", out, "--round", "2"], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: XDG, HOME: tmp("home-") }, timeout: 900000 });
  assert.ok([0, 13].includes(run.status), run.stderr);
  const report = fs.readFileSync(path.join(out, "gate-report.txt"), "utf8");
  assert.match(report, /sound: generated sound bed \(warm-keys/);
  assert.match(report, /sound-stream PASS/);
  assert.ok(fs.existsSync(path.join(out, "sound-cues.json")));
});

test("stage path: a generated bed is built, muxed and gated", { skip: chromeSkip, timeout: 900000 }, () => {
  const out = tmp("stage-bed-");
  fs.cpSync(path.join(__dirname, "fixtures", "motion-stage", "clock", "stage"), path.join(out, "stage"), { recursive: true });
  writeTreatment(out, stageTreatment({ durationSec: 4, sound: { mode: "generated", plan: "a pad that turns with the beam", palette: "low-strings" } }));
  const run = spawnSync(process.execPath, [motion, "stage", "--out", out, "--round", "2"], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: XDG, HOME: tmp("home-") }, timeout: 900000 });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const report = fs.readFileSync(path.join(out, "gate-report.txt"), "utf8");
  for (const id of ["sound-stream", "sound-duration", "sound-peak", "sound-silence"]) assert.match(report, new RegExp(`${id}: PASS`));
  assert.match(report, /sound: generated sound bed \(low-strings/);
});
