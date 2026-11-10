const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");
const guard = require("./scripts/scan-forbidden-paths.js");

const packageRoot = path.resolve(__dirname, "..");
const cli = path.join(packageRoot, "bin", "lithermes.js");
const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
const shipped = [
  "dashboard/manifest.json",
  "dashboard/plugin_api.py",
  "desktop/plugin.js",
];
const allowedImports = new Set(["@hermes/plugin-sdk", "react", "react/jsx-runtime"]);

// Rules the Hermes catalog applies to a desktop half: SDK-only imports, no code
// evaluation, no markup or host-bridge poking, theme variables for colour, and
// a readable (not minified) file.
function desktopViolations(source) {
  const found = [];
  for (const match of source.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)) {
    if (!allowedImports.has(match[1])) found.push(`import of ${match[1]}`);
  }
  const forbidden = [
    [/\beval\s*\(/, "eval"],
    [/\bnew\s+Function\b/, "new Function"],
    [/\bimport\s*\(/, "dynamic import"],
    [/<\s*script\b/i, "script tag"],
    [/\bhermesDesktop\b/, "window.hermesDesktop"],
    [/\bdocument\s*\./, "document access"],
    [/\bwindow\s*\./, "window access"],
    [/\binnerHTML\b|\bdangerouslySetInnerHTML\b/, "markup injection"],
    [/#[0-9a-fA-F]{3,8}\b/, "hard-coded hex colour"],
    [/\brgba?\s*\(|\bhsla?\s*\(/, "hard-coded colour function"],
    [/<\/?[A-Za-z][^>]*>/, "JSX or markup"],
  ];
  const code = source.replace(/^\s*\/\/.*$/gm, "");
  for (const [pattern, label] of forbidden) if (pattern.test(code)) found.push(label);
  if (source.split("\n").some((line) => line.length > 200)) found.push("minified line");
  return found;
}

test("dashboard and desktop files are listed in the npm tarball, without bytecode", () => {
  const entries = guard.packEntries();
  for (const file of shipped) {
    assert.ok(entries.includes(`assets/lithermes-plugin/${file}`), `${file} missing from pack listing`);
  }
  const bytecode = entries.filter((entry) => /\.pyc$|__pycache__/.test(entry));
  assert.deepEqual(bytecode, []);
});

test("an offline install copies dashboard and desktop byte for byte and records them", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-dashboard-desktop."));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const install = spawnSync(
    process.execPath,
    [cli, "install", "--yes", "--offline", "--no-hud", "--hermes-home", home],
    { cwd: packageRoot, encoding: "utf8", env: { ...process.env, CI: "1", NO_UPDATE_NOTIFIER: "1" }, timeout: 60000 },
  );
  assert.equal(install.status, 0, install.stdout + install.stderr);
  const installed = path.join(home, "plugins", "lithermes");
  const receipt = JSON.parse(fs.readFileSync(path.join(home, "lithermes", "install-manifest.json"), "utf8"));
  for (const file of shipped) {
    assert.deepEqual(
      fs.readFileSync(path.join(installed, file)),
      fs.readFileSync(path.join(pluginRoot, file)),
      `${file} differs after install`,
    );
    assert.ok(receipt.files.some((entry) => entry.path === file), `${file} missing from the install receipt`);
  }
});

test("the dashboard manifest names the backend module that ships beside it", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "dashboard", "manifest.json"), "utf8"));
  assert.deepEqual(manifest, { name: "lithermes", api: "plugin_api.py" });
  assert.ok(fs.existsSync(path.join(pluginRoot, "dashboard", manifest.api)));
});

test("desktop/plugin.js is plain SDK-only ESM that registers the pane and the gate chip", () => {
  const source = fs.readFileSync(path.join(pluginRoot, "desktop", "plugin.js"), "utf8");
  assert.deepEqual(desktopViolations(source), []);
  assert.ok(source.split("\n").length > 40, "payload looks minified or stubbed");
  assert.match(source, /export default \{\s*id: 'lithermes'/);
  assert.match(source, /area: 'panes'[\s\S]*placement: 'right'/);
  assert.match(source, /area: 'statusBar\.right'/);
  assert.match(source, /ctx\.rest\('\/goal\?cwd='/);
  assert.match(source, /host\.state\.cwd/);
  assert.match(source, /refetchInterval: POLL_MS/);
  assert.match(source, /const POLL_MS = 5000/);
  assert.match(source, /No active lit goal/);
  assert.match(source, /'lit gate: '/);
  assert.match(source, /var\(--ui-/);
  assert.match(source, /Timeline/);
  assert.match(source, /var\(--ui-yellow/);
  assert.match(source, /var\(--ui-red/);
  assert.match(source, /as reported by the session/);
});

test("the desktop rule check goes red on planted violations (negative control)", () => {
  const planted = [
    "import fs from 'node:fs'",
    "const x = eval('1')",
    "const f = new Function('return 1')",
    "const m = await import('./other.js')",
    "const s = '<script src=x></script>'",
    "window.hermesDesktop.api()",
    "document.body.append(x)",
    "node.innerHTML = value",
    "const c = '#ff0000'",
    "const c = 'rgb(1,2,3)'",
    "const el = <Pane />",
    "x".repeat(250),
  ];
  for (const line of planted) {
    assert.ok(desktopViolations(line).length > 0, `not caught: ${line.slice(0, 40)}`);
  }
});

const STAGES_FIXTURE = [
  { key: "plan", label: "Plan", state: "done", detail: "2 criteria", tone: "", items: [] },
  {
    key: "runs", label: "Runs", state: "active", detail: "R004 \u2713  R007 \u26a0 stale", tone: "warn",
    items: [{ text: "R004 \u2713", tone: "" }, { text: "R007 \u26a0 stale", tone: "warn" }],
  },
  {
    key: "review", label: "Review", state: "todo", detail: "1 blocker: test removed", tone: "danger",
    items: [{ text: "test removed", tone: "danger" }],
  },
  { key: "gate", label: "Gate", state: "todo", detail: "CLOSED \u2014 2 reasons", tone: "danger", items: [] },
  { key: "handoff", label: "Handoff", state: "done", detail: "saved 14:02", tone: "", items: [] },
  { key: "resume", label: "Resume", state: "done", detail: "from session 3f1a\u2026", tone: "", items: [] },
];

function goalPayload(overrides = {}) {
  return {
    goal: { id: "G001", title: "Fix the export", objective: "fix it", status: "active" },
    criteria: [{ id: "C001", text: "rows kept", status: "pending" }],
    evidence: [],
    gate: { open: false, reasons: ["C001 is stale"], source: "session", evaluated_at: "2026-11-09T05:00:00+00:00" },
    stages: STAGES_FIXTURE,
    ...overrides,
  };
}

// Loads desktop/plugin.js unmodified next to stub copies of the two modules it may import.
async function loadPlugin(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-desktop-render."));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (relative, body) => {
    fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    fs.writeFileSync(path.join(dir, relative), body);
  };
  write("package.json", '{"type":"module"}');
  write("node_modules/@hermes/plugin-sdk/package.json", '{"name":"@hermes/plugin-sdk","type":"module","exports":"./index.js"}');
  write(
    "node_modules/@hermes/plugin-sdk/index.js",
    "export const host = { state: { cwd: 'cwd' } };\n" +
      "export const useValue = () => '/Users/me/project';\n" +
      "export const useQuery = () => ({ data: globalThis.__litPayload });\n",
  );
  write("node_modules/react/package.json", '{"name":"react","type":"module","exports":{"./jsx-runtime":"./jsx-runtime.js"}}');
  write("node_modules/react/jsx-runtime.js", "export const jsx = (type, props, key) => ({ type, props, key });\nexport const jsxs = jsx;\n");
  fs.copyFileSync(path.join(pluginRoot, "desktop", "plugin.js"), path.join(dir, "plugin.js"));
  const plugin = (await import(pathToFileURL(path.join(dir, "plugin.js")).href)).default;
  const registered = [];
  plugin.register({ rest: () => null, register: (entry) => registered.push(entry) });
  return registered;
}

function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function") return expand(node.type(node.props));
  return { ...node, props: { ...node.props, children: expand(node.props.children) } };
}

function leaves(node, out = []) {
  if (Array.isArray(node)) node.forEach((child) => leaves(child, out));
  else if (node && typeof node === "object") {
    const children = node.props && node.props.children;
    if (typeof children === "string") out.push({ text: children, color: node.props.style && node.props.style.color });
    else leaves(children, out);
  }
  return out;
}

function dots(node, out = []) {
  if (Array.isArray(node)) node.forEach((child) => dots(child, out));
  else if (node && typeof node === "object") {
    if (node.props && node.props.style && node.props.style.borderRadius === "9999px") out.push(node);
    dots(node.props && node.props.children, out);
  }
  return out;
}

async function renderPane(t, payload) {
  const registered = await loadPlugin(t);
  globalThis.__litPayload = payload;
  t.after(() => delete globalThis.__litPayload);
  return { registered, tree: expand(registered.find((entry) => entry.id === "goal-pane").render()) };
}

test("the pane renders six timeline stages with stale and blocker lines in distinct theme colours", async (t) => {
  const { tree } = await renderPane(t, goalPayload());
  const found = leaves(tree);
  const labels = found.map((leaf) => leaf.text).filter((label) => STAGES_FIXTURE.some((stage) => stage.label === label));
  assert.deepEqual(labels, ["Plan", "Runs", "Review", "Gate", "Handoff", "Resume"]);
  assert.equal(dots(tree).length, 6);
  const byText = (needle) => found.find((leaf) => leaf.text === needle);
  assert.ok(byText("saved 14:02") && byText("from session 3f1a\u2026") && byText("2 criteria"));
  assert.match(byText("R007 \u26a0 stale").color, /^var\(--ui-yellow/);
  assert.match(byText("test removed").color, /^var\(--ui-red/);
  assert.match(byText("CLOSED \u2014 2 reasons").color, /^var\(--ui-red/);
  assert.notEqual(byText("R007 \u26a0 stale").color, byText("test removed").color);
  assert.notEqual(byText("R004 \u2713").color, byText("R007 \u26a0 stale").color);
  assert.ok(byText("gate, runs and blockers: as reported by the session"));
  const colours = found.map((leaf) => leaf.color).filter(Boolean);
  assert.ok(colours.every((value) => value.startsWith("var(--ui-")), `non-theme colour: ${colours}`);
});

test("the pane still renders for a route without stages, with no goal, and keeps the gate chip", async (t) => {
  const older = await renderPane(t, goalPayload({ stages: undefined, gate: { open: true, reasons: [] } }));
  const olderText = leaves(older.tree).map((leaf) => leaf.text);
  assert.ok(olderText.includes("Fix the export") && !olderText.includes("Timeline"));
  assert.equal(dots(older.tree).length, 0);
  const empty = await renderPane(t, { goal: null, criteria: [], evidence: [], gate: { open: false, reasons: [] }, stages: [] });
  assert.deepEqual(leaves(empty.tree).map((leaf) => leaf.text), ["No active lit goal"]);
  const chip = expand((await renderPane(t, goalPayload())).registered.find((entry) => entry.id === "gate-chip").render());
  assert.equal(chip.props.children, "lit gate: closed");
});
