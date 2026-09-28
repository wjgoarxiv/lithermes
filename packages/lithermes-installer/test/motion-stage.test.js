// Stage path: static pre-flight, serving, the virtual clock, capture sizes and
// determinism. Chrome tests need a pre-warmed cache named by
// LITHERMES_MOTION_TEST_XDG (as for motion-render); they skip without one.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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
const env = (extra = {}) => ({ ...process.env, XDG_CACHE_HOME: XDG, HOME: tmp("stage-home-"), ...extra });

// A stage run dir from a fixture (or from inline files), with a treatment.
function stageDir(fixture, treatmentOptions = {}, files = {}) {
  const out = tmp("stage-out-");
  if (fixture) fs.cpSync(path.join(fixtures, fixture, "stage"), path.join(out, "stage"), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(out, "stage", rel)), { recursive: true });
    fs.writeFileSync(path.join(out, "stage", rel), body);
  }
  writeTreatment(out, stageTreatment(treatmentOptions));
  return out;
}
const stage = (out, args = [], extraEnv = {}) => spawnSync(process.execPath, [motion, "stage", "--out", out, ...args], { encoding: "utf8", env: env(extraEnv), timeout: 900000 });
const page = (body, script = "", size = [1920, 1080]) => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/lit/fonts.css">
<style>html,body{margin:0;width:100vw;height:100vh;overflow:hidden;background:#123}</style></head><body>${body}
<script src="/lit/stage-kit.js"></script><script>${script}
LitStage.define({ width: ${size[0]}, height: ${size[1]}, fps: 60, duration: 4, render(t) { document.body.style.background = LitStage.mix('#123456', '#345678', t / 4); } });</script></body></html>`;

function png(width, height, { animated = false } = {}) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr)];
  if (animated) parts.push(chunk("acTL", Buffer.from([0, 0, 0, 2, 0, 0, 0, 0])));
  parts.push(chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

test("stage flags: the software rung, the stage set and the keychain flags, never headless-shell-only switches", async () => {
  const { stageFlags } = await load("stage.mjs");
  const flags = stageFlags({ width: 1080, height: 1920 });
  for (const flag of ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--run-all-compositor-stages-before-draw", "--disable-checker-imaging",
    "--disable-new-content-rendering-timeout", "--disable-threaded-animation", "--disable-threaded-scrolling", "--disable-image-animation-resync",
    "--disable-lcd-text", "--force-color-profile=srgb", "--hide-scrollbars", "--mute-audio", "--force-device-scale-factor=1", "--window-size=1080,1920",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-pings", "--metrics-recording-only",
    "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE lit.stage", "--use-mock-keychain", "--password-store=basic"]) {
    assert.ok(flags.includes(flag), `missing ${flag}`);
  }
  assert.ok(!flags.some((f) => /deterministic-mode|use-angle=metal|enable-gpu-rasterization/.test(f)), flags.join(" "));
});

test("stage kit: motion primitives only, under the 60 KB cap, no dependencies", () => {
  const kit = fs.readFileSync(path.join(skillRoot, "engine", "stage-kit.js"), "utf8");
  assert.ok(Buffer.byteLength(kit) <= 60 * 1024, `kit is ${Buffer.byteLength(kit)} bytes`);
  assert.doesNotMatch(kit, /\bimport\b|\brequire\(|https?:\/\//);
  for (const name of ["ease", "bezier", "spring", "kf", "at", "stagger", "seq", "rand", "splitText", "drawPath", "morph", "clipInset", "clipCircle", "maskWipe", "mix", "text", "define"]) {
    assert.match(kit, new RegExp(`\\b${name}\\b`), name);
  }
  assert.match(kit, /Intl\.Segmenter/);
  assert.match(kit, /multi-subpath morphs are not supported/);
});

test("static pre-flight: forbidden elements, flipbooks, animated rasters and escaping symlinks are exit-17 findings", async () => {
  const { scanStage } = await load("stage.mjs");
  const out = stageDir(null, {}, {
    "index.html": page('<video src="x.mp4"></video>', "document.body.appendChild(document.createElement('iframe'));"),
    "moving.png": png(8, 8, { animated: true }),
    ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.png`, png(64, 32)])),
  });
  fs.symlinkSync(path.join(out, "treatment.json"), path.join(out, "stage", "leak.json"));
  const found = scanStage(path.join(out, "stage"));
  const text = found.contract.join("\n");
  assert.match(text, /<video> is forbidden/);
  assert.match(text, /createElement\("iframe"\)/);
  assert.match(text, /moving\.png is an animated PNG/);
  assert.match(text, /10 rasters of the same size 64x32 read as a flipbook/);
  assert.match(text, /leak\.json is a symlink that leaves the stage dir/);
  assert.equal(found.network.length, 0);
});

test("static pre-flight: absolute, protocol-relative and hint-link URLs are exit-19 findings; SVG namespaces are not", async () => {
  const { scanStage } = await load("stage.mjs");
  const out = stageDir(null, {}, {
    "index.html": page('<link rel="preconnect" href="/x"><svg xmlns="http://www.w3.org/2000/svg"></svg><img src="//cdn.example.org/a.png">', "fetch('https://example.com/data.json');"),
  });
  const found = scanStage(path.join(out, "stage"));
  const text = found.network.join("\n");
  assert.match(text, /absolute URL https:\/\/example\.com\/data\.json/);
  assert.match(text, /protocol-relative URL \/\/cdn\.example\.org/);
  assert.match(text, /preconnect link/);
  assert.doesNotMatch(text, /w3\.org/);
});

test("serving: a request path never leaves the stage dir", async () => {
  const { stageFile } = await load("stage.mjs");
  const out = stageDir("clock");
  const root = fs.realpathSync(path.join(out, "stage"));
  fs.symlinkSync(path.join(out, "treatment.json"), path.join(root, "leak.json"));
  assert.equal(stageFile(root, "/index.html").status, 200);
  assert.equal(stageFile(root, "/").status, 200);
  assert.equal(stageFile(root, "/../treatment.json").status, 403);
  assert.equal(stageFile(root, "/%2e%2e/treatment.json").status, 403);
  assert.equal(stageFile(root, "/leak.json").status, 403);
  assert.equal(stageFile(root, "/missing.png").status, 404);
  fs.writeFileSync(path.join(root, "notes.txt"), "not a served type");
  assert.equal(stageFile(root, "/notes.txt").status, 404);
});

chromeTest("GREEN: a clock-only 16:9 page renders, passes the gate and replays byte for byte", async () => {
  const out = stageDir("clock");
  const run = stage(out, ["--round", "2"]);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const report = fs.readFileSync(path.join(out, "gate-report.txt"), "utf8");
  assert.match(report, /QA gate: PASS/);
  assert.match(report, /MO-C-09: PASS — decoded RGBA SHA-256 match in a fresh sequential replay at frames 0,/);
  assert.match(report, /MO-C-10: PASS — 1920x1080 for 16:9/);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
  assert.ok(manifest.determinism.checks.length >= 8 && manifest.determinism.checks.length <= 16, manifest.determinism.checks.length);
  assert.ok(manifest.frameTimeMs.p50 > 0 && manifest.frameTimeMs.p95 >= manifest.frameTimeMs.p50);
  for (const flag of ["--use-mock-keychain", "--password-store=basic", "--use-angle=swiftshader"]) assert.ok(manifest.chromeFlags.includes(flag), flag);
  for (const name of ["film.mp4", "poster.png", "reduced-motion.png", "stills/stills.json", "sheet/contact.png"]) assert.ok(fs.existsSync(path.join(out, name)), name);
});

chromeTest("GREEN: blur, backdrop-filter, blend modes, shadows, SVG blur, canvas shadowBlur and a WebGL shader replay identically", async () => {
  const out = stageDir("effects");
  const run = stage(out, ["--round", "2"]);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.match(fs.readFileSync(path.join(out, "gate-report.txt"), "utf8"), /MO-C-09: PASS/);
});

chromeTest("GREEN: a hard gradient stop under a moving element replays identically (the replay captures every frame, as the master does)", async () => {
  const out = stageDir("gradient-stop");
  const run = stage(out, ["--round", "2"]);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.match(fs.readFileSync(path.join(out, "gate-report.txt"), "utf8"), /MO-C-09: PASS/);
});

chromeTest("RED: a page that paints performance.timeOrigin, or crypto randomness, exits 18 naming the frame and region", async () => {
  for (const fixture of ["red-wallclock", "red-random"]) {
    const out = stageDir(fixture);
    const run = stage(out, ["--round", "2"]);
    assert.equal(run.status, 18, `${fixture}: ${run.stderr}`);
    assert.match(run.stderr, /STAGE_NONDETERMINISTIC: frame \d+ differs in a fresh replay \(first differing region x \d+-\d+, y \d+-\d+\)/);
  }
});

chromeTest("clock: a CSS transition started at 2 s is on the virtual clock at 2.1 s, and a finished.then chain continues", async () => {
  const { openStage, fontRoutes } = await load("stage.mjs");
  const { runtimeRequire, findCache } = await load("../bin/runtime.mjs");
  const out = stageDir(null, {}, {
    "index.html": `<!doctype html><html><head><style>html,body{margin:0;width:100vw;height:100vh;overflow:hidden;background:#000}
#box{position:absolute;left:0;top:0;width:200px;height:200px;background:rgb(0,0,0);transition:background-color 1s linear}
#box.on{background:rgb(250,0,0)} #a{position:absolute;left:400px;top:0;width:100px;height:100px;background:#fff;opacity:0}
#b{position:absolute;left:600px;top:0;width:100px;height:100px;background:#0f0}</style></head>
<body><div id="box"></div><div id="a"></div><div id="b"></div><script src="/lit/stage-kit.js"></script><script>
const box = document.getElementById('box');
document.getElementById('a').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: 'forwards' }).finished.then(() => {
  document.getElementById('b').animate([{ transform: 'translateY(0px)' }, { transform: 'translateY(400px)' }], { duration: 1000, fill: 'forwards' });
});
LitStage.define({ width: 1920, height: 1080, fps: 60, duration: 4, render(t) { if (t >= 2) box.classList.add('on'); } });
</script></body></html>`,
  });
  const envCache = { ...process.env, XDG_CACHE_HOME: XDG };
  const runtime = runtimeRequire(envCache);
  const cache = findCache(envCache);
  const { PNG } = runtime("pngjs");
  const fonts = fontRoutes(cache);
  const s = await openStage({ runtime, stageDir: path.join(out, "stage"), profileRoot: path.join(out, ".run", "t"), width: 1920, height: 1080, seed: 1, fontCss: fonts.css, fontFiles: fonts.routes });
  try {
    await s.load();
    await s.prepare([]);
    const pixel = async (x, y) => { const img = PNG.sync.read(await s.capture()); const i = (y * 1920 + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
    for (let f = 0; f <= 126; f++) await s.step(f / 60, f === 126);
    const [r] = await pixel(100, 100);
    assert.ok(Math.abs(r - 25) <= 4, `transition red at 2.1 s is ${r}, expected about 25 (10 % of 250)`);
    for (let f = 127; f <= 150; f++) await s.step(f / 60, f === 150);
    const green = await pixel(650, 450);
    assert.equal(green[1], 255, `the finished.then animation moved #b down by 2.5 s (got ${green})`);
  } finally {
    await s.close();
  }
});

chromeTest("9:16: a kit film renders at 1080x1920 with the portrait flash grid", async () => {
  const out = stageDir("portrait", { format: "9:16" });
  const run = stage(out, ["--round", "2"]);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const probe = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path.join(out, "film.mp4")], { encoding: "utf8" }).stdout).streams[0];
  assert.deepEqual([probe.width, probe.height], [1080, 1920]);
  const report = fs.readFileSync(path.join(out, "gate-report.txt"), "utf8");
  assert.match(report, /MO-C-03: PASS — .*180x320 cells, 60x107 window/);
  assert.match(report, /MO-C-10: PASS — 1080x1920 for 9:16/);
  const contact = fs.readFileSync(path.join(out, "sheet", "contact.png"));
  assert.ok(contact.readUInt32BE(20) > 0, "contact sheet written");
});

chromeTest("exit 17: a runtime media API, a wrong capture size and a stills-only flipbook each stop the stage", async () => {
  const api = stageDir(null, {}, { "index.html": page("", "try { new AudioContext(); } catch (e) {}") });
  const a = stage(api, ["--stills-only"]);
  assert.equal(a.status, 17, a.stderr);
  assert.match(a.stderr, /STAGE_CONTRACT_ERROR: AudioContext/);
  const size = stageDir(null, { format: "9:16" }, { "index.html": page("") });
  const b = stage(size, ["--stills-only"]);
  assert.equal(b.status, 17, b.stderr);
  assert.match(b.stderr, /LitStage\.define says 1920x1080 but the treatment's 9:16 format is 1080x1920/);
  const flip = stageDir(null, {}, { "index.html": page(""), ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`frames/f${i}.png`, png(32, 32)])) });
  const c = stage(flip, ["--stills-only"]);
  assert.equal(c.status, 17, c.stderr);
  assert.match(c.stderr, /flipbook/);
});

chromeTest("exit 19: a runtime request outside the synthetic origin and a WebSocket each fail the run", async () => {
  const fetchOut = stageDir(null, {}, { "index.html": page("", "fetch(['https:', '', 'example.com', 'data.json'].join('/')).catch(() => {});") });
  const a = stage(fetchOut, ["--stills-only"]);
  assert.equal(a.status, 19, a.stderr);
  assert.match(a.stderr, /STAGE_NETWORK_REQUEST: the page requested https:\/\/example\.com\/data\.json/);
  const socket = stageDir(null, {}, { "index.html": page("", "try { new WebSocket(['ws:', '', 'lit.stage', 'x'].join('/')); } catch (e) {}") });
  const b = stage(socket, ["--stills-only"]);
  assert.equal(b.status, 19, b.stderr);
  assert.match(b.stderr, /WebSocket/);
});

chromeTest("stills-only: every frame is stepped, only the stills are captured, and nothing is encoded", async () => {
  const out = stageDir("clock");
  const started = Date.now();
  const run = stage(out, ["--stills-only"]);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(Date.now() - started < 20000, `stills-only took ${Date.now() - started} ms`);
  assert.equal(fs.existsSync(path.join(out, "film.mp4")), false);
  const set = JSON.parse(fs.readFileSync(path.join(out, "stills", "stills.json"), "utf8"));
  assert.deepEqual(set.files.map((f) => f.kind).sort(), ["beat-mid", "beat-mid", "beat-mid", "contact", "poster", "strip", "strip"]);
  assert.match(set.manifestSha256, /^[0-9a-f]{64}$/);
});

const reportRow = (out, id) => (fs.readFileSync(path.join(out, "gate-report.txt"), "utf8").match(new RegExp(`^${id}: (PASS|WARN|FAIL) — (.*)$`, "m")) || [])[1];

chromeTest("text QA FAILs: low-contrast copy, copy outside title-safe, and copy shorter than its reading floor", async () => {
  const out = stageDir("qa-fails");
  const run = stage(out, ["--round", "2"]);
  assert.equal(run.status, 13, run.stderr + run.stdout);
  assert.equal(reportRow(out, "text-contrast"), "FAIL");
  assert.equal(reportRow(out, "text-title-safe"), "FAIL");
  assert.equal(reportRow(out, "text-reading-floor"), "FAIL");
  const report = fs.readFileSync(path.join(out, "gate-report.txt"), "utf8");
  assert.match(report, /text-contrast: FAIL — "등대의 밤" [\d.]+:1/);
  assert.match(report, /text-title-safe: FAIL — "빛이 돈다"/);
  assert.match(report, /text-reading-floor: FAIL — "새벽" on screen 0\.\d s, needs 1 s/);
});

chromeTest("text QA: decor is exempt from safe and floor, decor carrying copy fails, and meta labels, canvas text and moved state WARN", async () => {
  const out = stageDir("qa-warns");
  const run = stage(out, ["--round", "2"]);
  assert.equal(run.status, 13, run.stderr + run.stdout);
  assert.equal(reportRow(out, "text-title-safe"), "PASS", "the decor tag sits outside title-safe and is exempt");
  assert.equal(reportRow(out, "text-reading-floor"), "PASS");
  assert.equal(reportRow(out, "decor-copy"), "FAIL");
  assert.equal(reportRow(out, "meta-label"), "WARN");
  assert.equal(reportRow(out, "canvas-text"), "WARN");
  assert.equal(reportRow(out, "qa-samples"), "WARN");
  const report = fs.readFileSync(path.join(out, "gate-report.txt"), "utf8");
  assert.match(report, /meta-label: WARN — on screen: .*"treatment\.json"/);
  assert.match(report, /failed rules: decor-copy$/m, "decor contrast is a WARN, never a FAIL");
});

chromeTest("text QA: a copy line that never reaches the screen exits 17 quoting it", async () => {
  const out = stageDir("qa-missing", { lines: ["등대의 밤", "빛이 돈다", "새벽"] });
  const run = stage(out, ["--round", "2"]);
  assert.equal(run.status, 17, run.stderr);
  assert.match(run.stderr, /STAGE_CONTRACT_ERROR: copy line not on screen: "새벽"/);
});
