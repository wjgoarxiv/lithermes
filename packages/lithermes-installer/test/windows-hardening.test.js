// Windows hardening: .cmd shims need a shell or their node entry, PATHEXT decides what a bare
// name means, child exit codes survive, and a cover page that throws stops the render at once.
// Real Windows is not available to these tests; platform, env and file probes are injected.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const packageRoot = path.join(__dirname, "..");
const plugin = path.join(packageRoot, "assets", "lithermes-plugin");
const skills = path.join(plugin, "skills");
const copies = [
  path.join(skills, "lit-pptx", "bin", "hostexec.mjs"),
  path.join(skills, "lit-typographic-motion", "engine", "hostexec.mjs"),
  path.join(skills, "lit-diagram-drawer", "scripts", "hostexec.mjs"),
  path.join(skills, "frontend-ui-ux", "scripts", "hostexec.mjs"),
];
const temps = [];
const tmp = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(dir); return dir; };
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });
const loadMjs = (file) => import(pathToFileURL(file).href);

const NODE_DIR = "C:\\Program Files\\nodejs";
const files = (...list) => (file) => list.includes(file);
const winEnv = (extra = {}) => ({ PATH: `C:\\bin;${NODE_DIR}`, PATHEXT: ".COM;.EXE;.BAT;.CMD", ...extra });

const implementations = [["installer hostExec.js", async () => require("../src/lib/hostExec")]]
  .concat(copies.map((file) => [path.relative(plugin, file), () => loadMjs(file)]));

for (const [label, load] of implementations) {
  test(`${label}: a bare name on Windows resolves through PATHEXT and never to an extensionless shim`, async () => {
    const { whichSync } = await load();
    const exists = files("C:\\bin\\ffmpeg", "C:\\bin\\npm", `${NODE_DIR}\\ffmpeg.exe`, `${NODE_DIR}\\npm.cmd`);
    assert.equal(whichSync("ffmpeg", { platform: "win32", env: winEnv(), exists }), `${NODE_DIR}\\ffmpeg.exe`);
    assert.equal(whichSync("npm", { platform: "win32", env: winEnv(), exists }), `${NODE_DIR}\\npm.cmd`);
    assert.equal(whichSync("ffmpeg.exe", { platform: "win32", env: winEnv(), exists }), `${NODE_DIR}\\ffmpeg.exe`);
    assert.equal(whichSync("gifski", { platform: "win32", env: winEnv(), exists }), null);
  });

  test(`${label}: PATH entries that carry CRLF or quotes still resolve`, async () => {
    const { whichSync } = await load();
    const env = winEnv({ PATH: `"C:\\Tools"\r;C:\\bin\r\n` });
    assert.equal(whichSync("ffmpeg", { platform: "win32", env, exists: files("C:\\Tools\\ffmpeg.exe") }), "C:\\Tools\\ffmpeg.exe");
    assert.equal(whichSync("ffmpeg", { platform: "win32", env: { Path: "C:\\bin" }, exists: files("C:\\bin\\ffmpeg.exe") }), "C:\\bin\\ffmpeg.exe");
  });

  test(`${label}: POSIX lookup uses the bare name and the colon separator`, async () => {
    const { whichSync, prepareSpawn } = await load();
    assert.equal(whichSync("ffmpeg", { platform: "linux", env: { PATH: "/a:/usr/bin" }, exists: files("/usr/bin/ffmpeg") }), "/usr/bin/ffmpeg");
    const call = prepareSpawn("npm", ["ci"], { cwd: "/x" }, { platform: "darwin" });
    assert.deepEqual(call, { command: "npm", args: ["ci"], options: { cwd: "/x" } });
  });

  test(`${label}: npm.cmd runs through node and npm-cli.js when the entry file exists, with no shell`, async () => {
    const { prepareSpawn } = await load();
    const cli = `${NODE_DIR}\\node_modules\\npm\\bin\\npm-cli.js`;
    const call = prepareSpawn("npm", ["ci", "--prefix", "C:\\Users\\Jane Doe\\stage"], { stdio: "inherit" }, {
      platform: "win32", env: winEnv(), execPath: `${NODE_DIR}\\node.exe`, exists: files(`${NODE_DIR}\\npm.cmd`, cli),
    });
    assert.equal(call.command, `${NODE_DIR}\\node.exe`);
    assert.deepEqual(call.args, [cli, "ci", "--prefix", "C:\\Users\\Jane Doe\\stage"]);
    assert.equal(call.options.shell, undefined);
  });

  test(`${label}: npm_execpath names the npx entry beside it`, async () => {
    const { prepareSpawn } = await load();
    const cli = "D:\\npm\\bin\\npx-cli.js";
    const call = prepareSpawn("npx", ["--yes"], {}, {
      platform: "win32", env: winEnv({ npm_execpath: "D:\\npm\\bin\\npm-cli.js" }), execPath: "C:\\node.exe", exists: files(`${NODE_DIR}\\npx.cmd`, cli),
    });
    assert.deepEqual([call.command, call.args], ["C:\\node.exe", [cli, "--yes"]]);
  });

  test(`${label}: any other .cmd gets a shell and a quoted command line`, async () => {
    const { prepareSpawn } = await load();
    const shim = "C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\\agent-browser.cmd";
    const call = prepareSpawn("agent-browser", ["--session", "a b", "open", "http://x.test/?q=1&r=2"], { encoding: "utf8" }, {
      platform: "win32", env: winEnv({ PATH: "C:\\Users\\Jane Doe\\AppData\\Roaming\\npm" }), exists: files(shim),
    });
    assert.equal(call.options.shell, true);
    assert.equal(call.options.encoding, "utf8");
    assert.deepEqual(call.args, []);
    assert.equal(call.command, `"${shim}" --session "a b" open "http://x.test/?q=1&r=2"`);
  });

  test(`${label}: an absolute .cmd path is used as given and an .exe is spawned directly`, async () => {
    const { prepareSpawn } = await load();
    const cmd = prepareSpawn("C:\\tools\\drv.cmd", ["--version"], {}, { platform: "win32", env: winEnv(), exists: files("C:\\tools\\drv.cmd") });
    assert.equal(cmd.options.shell, true);
    assert.equal(cmd.command, "C:\\tools\\drv.cmd --version");
    const exe = prepareSpawn("ffmpeg", ["-version"], { a: 1 }, { platform: "win32", env: winEnv(), exists: files(`${NODE_DIR}\\ffmpeg.exe`) });
    assert.deepEqual(exe, { command: `${NODE_DIR}\\ffmpeg.exe`, args: ["-version"], options: { a: 1 } });
  });

  test(`${label}: arguments that could rewrite a Windows shell line are refused, not escaped`, async () => {
    const { prepareSpawn, quoteCmdArg } = await load();
    for (const bad of ['a"b', "50%PATH%", "x\r\ny", "x\0"]) assert.throws(() => quoteCmdArg(bad), /refusing an argument/);
    assert.equal(quoteCmdArg("C:\\dir with space\\"), '"C:\\dir with space\\\\"');
    assert.equal(quoteCmdArg(""), '""');
    const shim = { platform: "win32", env: winEnv(), exists: files(`${NODE_DIR}\\t.cmd`) };
    assert.throws(() => prepareSpawn("t", ['b"&calc'], {}, shim), /refusing an argument/);
    assert.equal(prepareSpawn("t", ["a&calc"], {}, shim).command, `"${NODE_DIR}\\t.cmd" "a&calc"`);
  });

  test(`${label}: spawnTool hands the prepared call to the injected spawnSync`, async () => {
    const { spawnTool } = await load();
    const seen = [];
    const result = spawnTool("npm", ["ci"], { cwd: "." }, {
      platform: "win32", env: winEnv(), exists: files(`${NODE_DIR}\\npm.cmd`), spawnSync: (...call) => { seen.push(call); return { status: 0 }; },
    });
    assert.equal(result.status, 0);
    assert.equal(seen[0][2].shell, true);
    assert.match(seen[0][0], /npm\.cmd/);
  });

  test(`${label}: a failure names the spawn error, the exit status and the last stderr line without CR`, async () => {
    const { describeSpawnFailure } = await load();
    const einval = describeSpawnFailure("npm ci", { error: Object.assign(new Error("spawnSync npm.cmd EINVAL"), { code: "EINVAL" }), status: null });
    assert.match(einval, /^npm ci could not run: EINVAL spawnSync npm\.cmd EINVAL/);
    const exited = describeSpawnFailure("npm ci", { status: 3, stderr: "npm ERR! first\r\nnpm ERR! E404 not found\r\n\r\n" });
    assert.equal(exited, "npm ci exited 3: npm ERR! E404 not found");
    assert.equal(describeSpawnFailure("x", { signal: "SIGTERM", stderr: "" }), "x stopped by SIGTERM");
  });
}

test("the four payload copies of hostexec.mjs are byte-identical", () => {
  const hashes = new Set(copies.map((file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")));
  assert.equal(hashes.size, 1);
});

test("venvPython picks Scripts\\python.exe on Windows and bin/python elsewhere", async () => {
  const { venvPython } = await loadMjs(copies[0]);
  assert.equal(venvPython("C:\\cache\\python", "win32"), "C:\\cache\\python\\Scripts\\python.exe");
  assert.equal(venvPython("/cache/python", "linux"), "/cache/python/bin/python");
});

test("the cover encoder lookup finds ffmpeg-family tools through PATHEXT and never spawns where(1)", async () => {
  const { which } = await loadMjs(path.join(skills, "lit-typographic-motion", "engine", "cover-webp.mjs"));
  const exists = files("C:\\libwebp\\bin\\img2webp.exe", "C:\\libwebp\\bin\\img2webp");
  assert.equal(which("img2webp", { PATH: "C:\\libwebp\\bin\r\n", PATHEXT: ".EXE" }, { platform: "win32", exists }), "C:\\libwebp\\bin\\img2webp.exe");
  assert.equal(which("dwebp", { PATH: "C:\\libwebp\\bin" }, { platform: "win32", exists }), null);
  assert.doesNotMatch(fs.readFileSync(path.join(skills, "lit-typographic-motion", "engine", "cover-webp.mjs"), "utf8"), /'where'/);
});

test("Chrome is found in the Windows install folders", async () => {
  const { chromeExecutable } = await loadMjs(path.join(skills, "lit-typographic-motion", "engine", "browser.mjs"));
  const env = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\J\\AppData\\Local" };
  const chrome = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
  assert.equal(chromeExecutable(env, { platform: "win32", exists: files(chrome) }), chrome);
  assert.equal(chromeExecutable(env, { platform: "win32", exists: files() }), null);
  assert.equal(chromeExecutable({ ...env, CHROME_PATH: "D:\\c.exe" }, { platform: "win32", exists: files("D:\\c.exe") }), "D:\\c.exe");
});

test("the automatic update reports why npx could not run", () => {
  const { runAutomaticUpdate } = require("../src/lib/updateNotifier");
  const home = tmp("lh-win-home-");
  fs.mkdirSync(path.join(home, "lithermes"), { recursive: true });
  fs.mkdirSync(path.join(home, "plugins", "lithermes"), { recursive: true });
  const result = runAutomaticUpdate({
    currentVersion: "1.0.0", latestVersion: "1.0.1", hermesHome: home, env: { PATH: process.env.PATH },
    spawnSync: () => ({ status: null, error: Object.assign(new Error("spawnSync npx.cmd EINVAL"), { code: "EINVAL" }), stderr: "" }),
  });
  assert.equal(result.status, "failed");
  assert.match(result.reason, /npm installer could not run: EINVAL/);
});

test("the update environment keeps the Windows variables npx cannot start without", () => {
  const { runAutomaticUpdate } = require("../src/lib/updateNotifier");
  const home = tmp("lh-win-env-");
  fs.mkdirSync(path.join(home, "lithermes"), { recursive: true });
  fs.mkdirSync(path.join(home, "plugins", "lithermes"), { recursive: true });
  let seen;
  runAutomaticUpdate({
    currentVersion: "1.0.0", latestVersion: "1.0.1", hermesHome: home,
    env: { PATH: "x", SystemRoot: "C:\\Windows", PATHEXT: ".EXE;.CMD", ComSpec: "C:\\Windows\\system32\\cmd.exe", NPM_TOKEN: "secret" },
    spawnSync: (_c, _a, options) => { seen = options.env; return { status: 1, stderr: "boom\r\n" }; },
  });
  assert.equal(seen.SystemRoot, "C:\\Windows");
  assert.equal(seen.PATHEXT, ".EXE;.CMD");
  assert.equal(seen.NPM_TOKEN, undefined);
});

// office.mjs: the tool's own exit code is the command's exit code (a gate that fails must not read as success).
function warmOfficeCache() {
  const runtime = path.join(skills, "lit-pptx", "runtime");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(runtime, "package-lock.json"))).update(fs.readFileSync(path.join(runtime, "requirements.lock"))).digest("hex").slice(0, 16);
  const xdg = tmp("lh-office-xdg-");
  const cache = path.join(xdg, "lithermes", "office", digest);
  for (const name of ["pptxgenjs", "sharp"]) fs.mkdirSync(path.join(cache, "node", "node_modules", name), { recursive: true });
  fs.mkdirSync(path.join(cache, "python", "bin"), { recursive: true });
  fs.writeFileSync(path.join(cache, "READY"), `${digest}\n`);
  return { xdg, python: path.join(cache, "python", "bin", "python") };
}

test("office.mjs returns the exit code of the tool it ran", { skip: process.platform === "win32" }, () => {
  const { xdg, python } = warmOfficeCache();
  fs.writeFileSync(python, "#!/bin/sh\necho '{\"pass\": false}'\nexit 3\n", { mode: 0o755 });
  const run = spawnSync(process.execPath, [path.join(skills, "lit-pptx", "bin", "office.mjs"), "gate", "missing.docx"], {
    encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: xdg }, timeout: 60000,
  });
  assert.equal(run.status, 3);
  assert.match(run.stdout, /"pass": false/);
});

test("office.mjs says why a tool could not start", { skip: process.platform === "win32" }, () => {
  const { xdg, python } = warmOfficeCache();
  fs.writeFileSync(python, "not executable", { mode: 0o644 });
  const run = spawnSync(process.execPath, [path.join(skills, "lit-pptx", "bin", "office.mjs"), "gate", "missing.docx"], {
    encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: xdg }, timeout: 60000,
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /could not run: EACCES/);
});

// Fail fast: a cover page that throws before it is ready must stop the render at once, not after 60 s.
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const XDG = process.env.LITHERMES_MOTION_TEST_XDG;
const renderSkip = !fs.existsSync(CHROME) ? `Chrome not found at ${CHROME}`
  : !XDG || !fs.existsSync(path.join(XDG, "lithermes", "motion")) ? "LITHERMES_MOTION_TEST_XDG does not name a pre-warmed motion cache" : null;

test("a cover page that throws a contract error stops the render in well under 60 s", { skip: renderSkip || false, timeout: 120000 }, async () => {
  const motion = path.join(skills, "lit-typographic-motion");
  const runtime = await loadMjs(path.join(motion, "bin", "runtime.mjs"));
  const { openCover } = await loadMjs(path.join(motion, "engine", "cover-capture.mjs"));
  const env = { ...process.env, XDG_CACHE_HOME: XDG, HOME: tmp("lh-fast-home-") };
  const coverDir = tmp("lh-fast-cover-");
  fs.writeFileSync(path.join(coverDir, "index.html"), "<!doctype html><script>throw new Error('ART.lights has no entry for the hero bay 7');</script>");
  const started = Date.now();
  await assert.rejects(
    openCover({ runtime: runtime.runtimeRequire(env), coverDir, fonts: { css: "", routes: new Map() }, width: 600, height: 300, scale: 1, profileRoot: tmp("lh-fast-chrome-"), env }),
    (error) => {
      assert.match(error.message, /STAGE_CONTRACT_ERROR: .*first page error: ART\.lights has no entry for the hero bay 7/u);
      assert.notEqual(error.exitCode, 0);
      return true;
    },
  );
  assert.ok(Date.now() - started < 40000, `took ${Date.now() - started} ms`);
});
