// lit-typographic-motion product surfaces: credit, enrollment, installed route
// context, symlink launch, offline runtime states and the packed install.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { requiredSkills } = require("../src/lib/skillPayload");
const { typeTreatment, writeTreatment } = require("./motion-director-support");

const packageRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
const skillRoot = path.join(pluginRoot, "skills", "lit-typographic-motion");
const bin = path.join(packageRoot, "bin", "lithermes.js");
const temps = [];
const tmp = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(dir); return dir; };
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const MIT_NOTICE_SHA256 = "6734178ad953e5f40585d000c13e4803e670d9e8982b7f6ef0395d47a9eedf30";
const CREDIT = "Typographic-motion engine adapted from mexicat/pdoom-video (MIT, Giacomo Magnanini), commit";

function fakeHost() {
  const dir = tmp("motion-fake-host-");
  fs.writeFileSync(path.join(dir, "hermes"), `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") { process.stdout.write("Hermes Agent v0.21.3\\n"); process.exit(0); }
if (JSON.stringify(args) === JSON.stringify(["plugins", "list", "--json", "--enabled", "--user"])) { process.stdout.write("[]\\n"); process.exit(0); }
if (JSON.stringify(args) === JSON.stringify(["lithermes", "status"])) { process.stdout.write(\`plugin dir: \${process.env.HERMES_HOME}/plugins/lithermes\\n\`); process.exit(0); }
process.exit(9);
`, { mode: 0o700 });
  const repo = tmp("motion-fake-source-");
  fs.mkdirSync(path.join(repo, "tools"), { recursive: true });
  fs.mkdirSync(path.join(repo, "hermes_cli"), { recursive: true });
  const runtime = ["co", "dex"].join("");
  fs.writeFileSync(path.join(repo, "tools", "delegate_tool.py"), "def _get_max_concurrent_children():\n    val = cfg.get(\"max_concurrent_children\")\n    return max(1, int(val))\nconfigured_model = str(cfg.get(\"model\") or \"\").strip() or None\ndelegation_effort = str(delegation_cfg.get(\"reasoning_effort\") or \"\").strip()\neffective_model = model or parent_agent.model\n");
  fs.writeFileSync(path.join(repo, "hermes_cli", "runtime_provider.py"), `if provider == "openai-${runtime}":\n    api_mode = "${runtime}_responses"\n`);
  return { PATH: `${dir}${path.delimiter}${process.env.PATH}`, repo };
}

function installInto(home, binPath = bin, extraEnv = {}) {
  const host = fakeHost();
  return spawnSync(process.execPath, [binPath, "install", "--yes", "--offline", "--no-hud", "--hermes-home", home, "--hermes-repo", host.repo], {
    encoding: "utf8", env: { ...process.env, ...extraEnv, PATH: host.PATH, HOME: home, XDG_CACHE_HOME: path.join(home, "xdg-cache") },
  });
}

test("credit: NOTICE is the verbatim MIT text and the one-line credit is on the help surfaces", () => {
  assert.equal(sha(path.join(skillRoot, "engine", "NOTICE")), MIT_NOTICE_SHA256);
  const help = spawnSync(process.execPath, [bin, "help"], { encoding: "utf8" });
  assert.match(help.stdout + help.stderr, new RegExp(CREDIT.replace(/[()]/g, "\\$&")));
  const motionHelp = spawnSync(process.execPath, [path.join(skillRoot, "bin", "motion.mjs"), "--help"], { encoding: "utf8" });
  assert.equal(motionHelp.status, 0);
  assert.match(motionHelp.stdout, new RegExp(CREDIT.replace(/[()]/g, "\\$&")));
  assert.match(fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8"), /mexicat\/pdoom-video \(MIT, Giacomo Magnanini\), commit `ca251e3`/);
});

test("credit: THIRD_PARTY_NOTICES names a licence path for every font the presets can load", async () => {
  const { FONT_FILES } = await import(path.join(skillRoot, "engine", "frame.mjs"));
  const notices = fs.readFileSync(path.join(skillRoot, "engine", "THIRD_PARTY_NOTICES"), "utf8");
  const pins = JSON.parse(fs.readFileSync(path.join(skillRoot, "runtime", "fonts.json"), "utf8")).entries;
  for (const file of Object.values(FONT_FILES)) {
    const name = file.replace(/^lit-pptx:/, "").split("/").pop();
    const block = notices.split("font: ").find((part) => part.includes(name));
    assert.ok(block, `${name} missing from THIRD_PARTY_NOTICES`);
    assert.match(block, /licence: /);
  }
  for (const pin of pins.filter((p) => p.path.startsWith("fonts/"))) assert.ok(notices.includes(pin.path), `${pin.path} not listed`);
  for (const licence of pins.filter((p) => p.path.startsWith("licenses/"))) assert.ok(notices.includes(licence.path), `${licence.path} not referenced`);
  assert.ok(fs.existsSync(path.join(pluginRoot, "skills", "lit-pptx", "fonts", "PRETENDARD-OFL.txt")));
  assert.ok(fs.existsSync(path.join(skillRoot, "runtime", "licenses", "EMS-OFL.txt")));
  assert.match(fs.readFileSync(path.join(skillRoot, "runtime", "licenses", "CREDITS"), "utf8"), /EMS Tech[\s\S]*Kimberly Geswein/);
});

test("enrollment: registry, installer payload, pins, listings and counts all name the skill", () => {
  const init = fs.readFileSync(path.join(pluginRoot, "__init__.py"), "utf8");
  assert.match(init, /\("lit-typographic-motion", "/);
  assert.match(init, /"lit-typographic-motion",\n\s+\*core\.KOREAN_PROSE_COMMANDS/);
  assert.ok(requiredSkills.includes("lit-typographic-motion"));
  const payload = JSON.parse(fs.readFileSync(path.join(pluginRoot, "payload-version.json"), "utf8"));
  const pinned = new Set(payload.files.map((f) => f.path));
  const shipped = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== "__pycache__") walk(p); } else if (!e.name.endsWith(".pyc")) shipped.push(path.relative(pluginRoot, p).split(path.sep).join("/")); } };
  walk(skillRoot);
  for (const rel of shipped) assert.ok(pinned.has(rel), `${rel} is not pinned in payload-version.json`);
  for (const rel of ["core_routing.py", "core_contexts.py", "core_contract.py", "diagnostics.py"]) assert.match(fs.readFileSync(path.join(pluginRoot, rel), "utf8"), /lit-typographic-motion|installed_motion_commands/);
  const parity = JSON.parse(fs.readFileSync(path.join(packageRoot, "tools", "payload-substance-parity.json"), "utf8"));
  assert.ok(JSON.stringify(parity).includes("lit-typographic-motion"));
  for (const doc of ["README.md", "README_Ko-KR.md"]) assert.match(fs.readFileSync(path.join(packageRoot, doc), "utf8"), /`lit-typographic-motion`/);
  assert.match(fs.readFileSync(path.join(pluginRoot, "README.md"), "utf8"), /`lithermes:lit-typographic-motion`/);
});

test("corpus guard: a lean entrypoint with dense references that every section reaches", () => {
  const entry = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  assert.ok(Buffer.byteLength(entry) <= 3584, `SKILL.md is ${Buffer.byteLength(entry)} bytes`);
  const refs = ["treatment.md", "stage.md", "style-bibles.md", "engine-contract.md", "type-craft.md", "craft-loop.md", "runtime.md"];
  for (const ref of refs) {
    assert.match(entry, new RegExp(`references/${ref.replace(".", "\\.")}`), `SKILL.md never points to ${ref}`);
    const text = fs.readFileSync(path.join(skillRoot, "references", ref), "utf8");
    assert.ok(text.split(/\s+/).length >= 600, `${ref} is a placeholder (${text.split(/\s+/).length} words)`);
  }
  const all = refs.map((ref) => fs.readFileSync(path.join(skillRoot, "references", ref), "utf8")).join("\n");
  for (const required of ["swiss-signal", "terminalcore", "tidal", "MO-C-03", "withheld", "--stills-only", "look --out", "vision_analyze", "complete --out", "copiedExample", "LitStage.define", "BLOCKED_NO_CHROME", "motion-runtime install", "어절", "glyph", "title-safe", "Tier 3", "--audio"]) {
    assert.ok(all.includes(required), `references miss ${required}`);
  }
  assert.doesNotMatch(entry + all, /\bS10\b|A\/B/, "the skill never teaches to the evaluation (MO-C-24)");
  for (const heading of ["## #contract.activation", "## #contract.inputs", "## #contract.mode_matrix", "## #contract.procedure", "## #contract.outputs", "## #contract.evidence", "## #contract.hard_stops", "## #contract.anti_patterns"]) assert.ok(entry.includes(heading));
});

test("no clock or unseeded randomness reaches any visual code path", () => {
  for (const file of ["util.mjs", "type.mjs", "stroke.mjs", "timeline.mjs", "presets.mjs", "scenes.mjs", "frame.mjs", "flash.mjs"]) {
    const text = fs.readFileSync(path.join(skillRoot, "engine", file), "utf8");
    assert.doesNotMatch(text, /Math\.random|Date\.now|performance\.now|new Date/, file);
  }
  const page = fs.readFileSync(path.join(skillRoot, "engine", "page.js"), "utf8");
  assert.doesNotMatch(page, /Math\.random|Date\.now|new Date/);
  const timing = page.split("\n").filter((line) => line.includes("performance.now"));
  assert.ok(timing.every((line) => /began|renderMs/.test(line)), "performance.now may only time the frame for perf mode");
  assert.equal((page.match(/toSRGB\(/g) || []).length, 2, "sRGB is defined once and applied once, in the final pass");
});

test("every CLI launches through a symlinked directory and prints its own banner", () => {
  const dir = tmp("motion-link-");
  const link = path.join(dir, "linked-skill");
  fs.symlinkSync(skillRoot, link);
  for (const [script, banner] of [["bin/motion.mjs", /LitHermes lit-typographic-motion/], ["bin/runtime.mjs", /LitHermes motion-runtime usage/]]) {
    const run = spawnSync(process.execPath, [path.join(link, script), "--help"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, banner, `${script} exited ${run.status} with no banner through a symlink`);
  }
  const complete = spawnSync(process.execPath, [path.join(link, "bin", "motion.mjs"), "complete", "--out", dir], { encoding: "utf8" });
  assert.equal(complete.status, 1);
  assert.match(complete.stdout, /NOT COMPLETE/);
  const py = spawnSync("python3", ["-c", `import runpy,sys; sys.argv=['audio.py']; ns=runpy.run_path(${JSON.stringify(path.join(link, "bin", "audio.py"))}, run_name='not_main'); print('main' in ns)`], { encoding: "utf8" });
  assert.match(py.stdout + py.stderr, /True|No module named 'librosa'/);
});

test("runtime: status on an empty cache names what is missing and the fix", () => {
  const home = tmp("motion-empty-");
  const run = spawnSync(process.execPath, [path.join(skillRoot, "bin", "runtime.mjs"), "status"], { encoding: "utf8", env: { ...process.env, HOME: home, XDG_CACHE_HOME: path.join(home, "cache"), HERMES_HOME: path.join(home, "hh") } });
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split("\n");
  assert.equal(lines.length, 5, run.stdout);
  assert.match(lines[0], /^Chrome: /);
  assert.match(lines[1], /^ffmpeg: /);
  assert.match(lines[2], /^WebGL2 renderer: /);
  assert.match(lines[3], /^software GL: /);
  assert.match(lines[4], /^pre-warm: NOT READY - missing node dependencies[\s\S]*missing fonts\/licences: fonts\/Galmuri9\.ttf[\s\S]*fix: lithermes motion-runtime install/);
});

function brief(dir, extra = {}) {
  const file = path.join(dir, "brief.json");
  fs.writeFileSync(file, JSON.stringify({ text: ["A quiet harbor at night", "등불이 하나씩 켜진다"], ...extra }));
  return file;
}

test("runtime: an unwarmed cache exits 14 and a corrupt font exits 15, before any render", () => {
  const home = tmp("motion-exit-");
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: path.join(home, "cache"), HERMES_HOME: path.join(home, "hh") };
  writeTreatment(path.join(home, "out"), typeTreatment());
  writeTreatment(path.join(home, "out2"), typeTreatment());
  const cold = spawnSync(process.execPath, [path.join(skillRoot, "bin", "motion.mjs"), "run", "--brief", brief(home), "--out", path.join(home, "out")], { encoding: "utf8", env });
  assert.equal(cold.status, 14, cold.stderr);
  assert.match(cold.stderr, /BLOCKED_DEPS_NOT_PREWARMED[\s\S]*lithermes motion-runtime install/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "out", "run-state.json"), "utf8")).exitCode, 14);
  const lock = fs.readFileSync(path.join(skillRoot, "runtime", "package-lock.json"));
  const pins = fs.readFileSync(path.join(skillRoot, "runtime", "fonts.json"));
  const digest = crypto.createHash("sha256").update(lock).update(pins).digest("hex").slice(0, 16);
  const cache = path.join(home, "cache", "lithermes", "motion", digest);
  fs.mkdirSync(path.join(cache, "node", "node_modules", "playwright-core"), { recursive: true });
  fs.writeFileSync(path.join(cache, "node", "node_modules", "playwright-core", "package.json"), "{}");
  fs.writeFileSync(path.join(cache, "READY"), `${digest}\n`);
  fs.mkdirSync(path.join(cache, "assets", "fonts"), { recursive: true });
  fs.writeFileSync(path.join(cache, "assets", "fonts", "VT323-Regular.ttf"), "not the pinned bytes");
  const corrupt = spawnSync(process.execPath, [path.join(skillRoot, "bin", "motion.mjs"), "run", "--brief", brief(home), "--out", path.join(home, "out2")], { encoding: "utf8", env });
  assert.equal(corrupt.status, 15, corrupt.stderr);
  assert.match(corrupt.stderr, /BLOCKED_FONT_FETCH[\s\S]*sha256 mismatch fonts\/VT323-Regular\.ttf/);
});

test("runtime: word timing is opt-in, states pins and size first, and fails closed", () => {
  const home = tmp("motion-words-");
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: path.join(home, "cache") };
  const install = spawnSync(process.execPath, [path.join(skillRoot, "bin", "runtime.mjs"), "install", "--word-timing"], { encoding: "utf8", env });
  assert.equal(install.status, 14);
  const lines = install.stderr.split("\n");
  const size = lines.findIndex((l) => /download size: 0 bytes/.test(l));
  const refuse = lines.findIndex((l) => /refused \(fail-closed\)/.test(l));
  assert.ok(size >= 0 && refuse > size, install.stderr);
  assert.match(install.stderr, /korean-alignment: NOT PINNED/);
  assert.equal(fs.existsSync(path.join(home, "cache")), false, "nothing may be downloaded or created");
  writeTreatment(path.join(home, "out"), typeTreatment());
  const render = spawnSync(process.execPath, [path.join(skillRoot, "bin", "motion.mjs"), "run", "--brief", brief(home), "--out", path.join(home, "out"), "--word-timing"], { encoding: "utf8", env });
  assert.equal(render.status, 14);
  assert.match(render.stderr, /lithermes motion-runtime install --word-timing/);
});

test("runtime: font fetch accepts only the pinned sha256 from a local mirror", async () => {
  const { fetchPinned } = await import(path.join(skillRoot, "bin", "runtime.mjs"));
  const mirror = tmp("motion-mirror-");
  fs.mkdirSync(path.join(mirror, "fonts"));
  fs.writeFileSync(path.join(mirror, "fonts", "demo.ttf"), "pinned bytes");
  const good = { path: "fonts/demo.ttf", url: "https://example.invalid/demo.ttf", sha256: crypto.createHash("sha256").update("pinned bytes").digest("hex") };
  const out = tmp("motion-fetched-");
  await fetchPinned(good, path.join(out, "demo.ttf"), { mirror: `file://${mirror}` });
  assert.equal(fs.readFileSync(path.join(out, "demo.ttf"), "utf8"), "pinned bytes");
  await assert.rejects(() => fetchPinned({ ...good, sha256: "0".repeat(64) }, path.join(out, "bad.ttf"), { mirror: `file://${mirror}` }), /sha256 mismatch/);
  assert.equal(fs.existsSync(path.join(out, "bad.ttf")), false);
});

test("runtime: an absent or drifted --audio venv degrades to text timing, never repaired", async () => {
  const home = tmp("motion-audio-");
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: path.join(home, "cache") };
  const { audioState, audioDir, cacheRoots } = await import(path.join(skillRoot, "bin", "runtime.mjs"));
  assert.equal(audioState(env).state, "absent");
  const dir = audioDir(cacheRoots(env)[0]);
  fs.mkdirSync(path.join(dir, "venv", "bin"), { recursive: true });
  const python = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
  fs.symlinkSync(python, path.join(dir, "venv", "bin", "python"));
  fs.writeFileSync(path.join(dir, "AUDIO_READY"), "x\n");
  const drifted = audioState(env);
  assert.equal(drifted.state, "mismatched");
  assert.match(drifted.detail, /pins drifted|librosa/);
});

test("installer: an offline install succeeds and leaves one motion receipt line", () => {
  const home = tmp("motion-install-");
  const result = installInto(home);
  assert.equal(result.status, 0, result.stderr);
  const receipts = result.stdout.split("\n").filter((line) => line.startsWith("Motion runtime:"));
  assert.equal(receipts.length, 1, result.stdout);
  assert.match(receipts[0], /pre-warm skipped \(--offline\); run `lithermes motion-runtime install`/);
  const installed = path.join(home, "plugins", "lithermes", "skills", "lit-typographic-motion");
  for (const rel of ["SKILL.md", "bin/motion.mjs", "bin/runtime.mjs", "engine/NOTICE", "engine/page.js", "runtime/package-lock.json", "runtime/fonts.json"]) assert.ok(fs.existsSync(path.join(installed, rel)), rel);
});

test("installer: a failing pre-warm never fails the install", () => {
  const home = tmp("motion-install-fail-");
  const host = fakeHost();
  const result = spawnSync(process.execPath, [bin, "install", "--yes", "--no-hud", "--no-auto-update", "--hermes-home", home, "--hermes-repo", host.repo], {
    encoding: "utf8", env: { ...process.env, PATH: host.PATH, HOME: home, XDG_CACHE_HOME: path.join(home, "xdg"), LITHERMES_MOTION_NPM: "/usr/bin/false" },
  });
  assert.equal(result.status, 0, result.stderr);
  const receipt = result.stdout.split("\n").find((line) => line.startsWith("Motion runtime:"));
  assert.match(receipt, /pre-warm incomplete \(.*\); run `lithermes motion-runtime install`/);
});

test("installed route context names the installed motion CLI once, which resolves and runs", () => {
  const home = tmp("motion-context-");
  assert.equal(installInto(home).status, 0);
  const installedPlugin = path.join(home, "plugins", "lithermes");
  const script = `
import importlib.util, json, os, sys, tempfile
plugin = sys.argv[1]
spec = importlib.util.spec_from_file_location("lithermes_installed", os.path.join(plugin, "__init__.py"), submodule_search_locations=[plugin])
mod = importlib.util.module_from_spec(spec); sys.modules["lithermes_installed"] = mod; spec.loader.exec_module(mod)
os.chdir(tempfile.mkdtemp())
out = mod._pre_llm_call(user_message="바닷가 음악회 오프닝 타이틀 영상 만들어줘 lit", session_id="motion-installed", platform="cli")
print(json.dumps(out))
`;
  const run = spawnSync("python3", ["-c", script, installedPlugin], { encoding: "utf8", env: { ...process.env, HOME: home, HERMES_HOME: home, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(run.status, 0, run.stderr);
  const context = JSON.parse(run.stdout.trim().split("\n").at(-1)).context;
  assert.match(context, /mode="lit-typographic-motion"/);
  const cli = context.split("\n").filter((line) => line.startsWith("Motion CLI: M=node "));
  assert.equal(cli.length, 1, context);
  const scriptPath = cli[0].slice("Motion CLI: M=node ".length).replace(/^'|'$/g, "");
  assert.ok(path.isAbsolute(scriptPath), cli[0]);
  const real = fs.realpathSync(scriptPath);
  assert.ok(real.startsWith(fs.realpathSync(path.join(installedPlugin, "skills", "lit-typographic-motion")) + path.sep), `${real} is not under the installed skill`);
  assert.match(context, /^Subcommands: \$M stage\|run\|sound\|look\|gate\|complete --out DIR$/m);
  const help = spawnSync(process.execPath, [real, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /LitHermes lit-typographic-motion/);
});

test("pack: the tarball ships the engine, lockfiles, notices and licences, and stays under 12 MiB", () => {
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: packageRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(packed.status, 0, packed.stderr);
  const info = JSON.parse(packed.stdout)[0];
  const files = new Set(info.files.map((f) => f.path));
  const prefix = "assets/lithermes-plugin/skills/lit-typographic-motion/";
  for (const rel of ["SKILL.md", "bin/motion.mjs", "bin/runtime.mjs", "bin/audio.py", "engine/NOTICE", "engine/THIRD_PARTY_NOTICES", "engine/page.js", "engine/gate.mjs", "engine/flash.mjs", "runtime/package-lock.json", "runtime/requirements.lock", "runtime/fonts.json", "runtime/word-timing.json", "runtime/licenses/EMS-OFL.txt", "runtime/licenses/CREDITS",
    "references/treatment.md", "references/stage.md", "engine/treatment.mjs", "engine/director.mjs", "engine/stage.mjs", "engine/stage-init.js", "engine/stage-kit.js", "engine/stage-worker.mjs", "engine/stage-gate.mjs", "engine/stage-qa.mjs", "engine/stills.mjs", "engine/sound.mjs", "engine/look.mjs"]) {
    assert.ok(files.has(prefix + rel), `${rel} missing from the pack`);
  }
  assert.equal([...files].some((f) => f.startsWith(prefix) && /\.(?:ttf|otf|svg|woff2?)$/i.test(f)), false, "LitHermes bundles no motion font (MO-A-47)");
  assert.ok(files.has("assets/lithermes-plugin/motion_receipts.py"), "the look-receipt hook ships with the plugin");
  assert.equal([...files].some((f) => /fixtures\/motion-stage|motion-director-support|test\//.test(f)), false, "no stage fixture or test helper ships");
  assert.ok(info.size <= 12 * 1024 * 1024, `pack is ${info.size} bytes`);
  const text = fs.readFileSync(path.join(packageRoot, prefix, "engine", "NOTICE"), "utf8");
  assert.match(text, /ca251e3dddda422b364385eb484b5a3593a0990d/);
  const lock = fs.readFileSync(path.join(packageRoot, prefix, "runtime", "requirements.lock"), "utf8");
  assert.doesNotMatch(lock, /^(?:aubio|essentia|madmom)==/m, "GPL/AGPL analysers and non-commercial weights are never pinned");
});

test("lithermes doctor prints the five motion probes on every run", () => {
  const home = tmp("motion-doctor-");
  assert.equal(installInto(home).status, 0);
  const host = fakeHost();
  const doctor = spawnSync(process.execPath, [bin, "doctor", "--offline", "--hermes-home", home, "--hermes-repo", host.repo], {
    encoding: "utf8", env: { ...process.env, PATH: host.PATH, HOME: home, XDG_CACHE_HOME: path.join(home, "xdg-cache") },
  });
  const lines = doctor.stdout.split("\n");
  for (const probe of ["motion Chrome: ", "motion ffmpeg: ", "motion WebGL2 renderer: ", "motion software GL: ", "motion pre-warm: "]) {
    assert.ok(lines.some((line) => line.startsWith(probe)), `doctor lacks "${probe}"\n${doctor.stdout}`);
  }
  assert.match(lines.find((line) => line.startsWith("motion pre-warm: ")), /NOT READY[\s\S]*fix: lithermes motion-runtime install/);
});
