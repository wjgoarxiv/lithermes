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
    [/\bdocument\s*\.(?!createElement\('style'\)|head\.append\(style\))/, "document access"],
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
  assert.match(source, /ctx\.onDispose\(\(\) => style\.remove\(\)\)/);
  assert.match(source, /prefers-reduced-motion: reduce/);
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
    "document.createElement('div')",
    "document.head.append(script)",
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
  { key: "resume", label: "Resume", state: "done", detail: "resumed from an earlier session (handoff 14:02)", tone: "", items: [] },
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
    "export const host = { state: { cwd: 'cwd' }, notify: (input) => { globalThis.__litNotes.push(input); return input.id } };\n" +
      "export const useValue = () => '/Users/me/project';\n" +
      "export const useQuery = () => ({ data: globalThis.__litPayload });\n",
  );
  write("node_modules/react/package.json", '{"name":"react","type":"module","exports":{"./jsx-runtime":"./jsx-runtime.js"}}');
  write("node_modules/react/jsx-runtime.js", "export const jsx = (type, props, key) => ({ type, props, key });\nexport const jsxs = jsx;\n");
  fs.copyFileSync(path.join(pluginRoot, "desktop", "plugin.js"), path.join(dir, "plugin.js"));
  const head = [];
  const disposers = [];
  globalThis.__litNotes = [];
  globalThis.document = {
    createElement: (tag) => ({ tag, attrs: {}, setAttribute(name, value) { this.attrs[name] = value }, remove() { head.splice(head.indexOf(this), 1) } }),
    head: { append: (node) => head.push(node) },
  };
  t.after(() => { delete globalThis.document; delete globalThis.__litNotes });
  const plugin = (await import(pathToFileURL(path.join(dir, "plugin.js")).href)).default;
  const registered = [];
  plugin.register({ rest: () => null, register: (entry) => registered.push(entry), onDispose: (fn) => disposers.push(fn) });
  registered.head = head;
  registered.dispose = () => disposers.forEach((fn) => fn());
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
    if (node.props && node.props["data-stage"]) out.push(node);
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
  assert.ok(byText("saved 14:02") && byText("resumed from an earlier session (handoff 14:02)") && byText("2 criteria"));
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
  assert.ok(leaves(empty.tree).map((leaf) => leaf.text).includes("No active lit goal"));
  const chip = expand((await renderPane(t, goalPayload())).registered.find((entry) => entry.id === "gate-chip").render());
  assert.ok(leaves(chip).map((leaf) => leaf.text).includes("lit gate: closed"));
});

const RECEIPTS_FIXTURE = [
  {
    id: "R007", exit: 0, command: "pytest -q", at: new Date(Date.now() - 5 * 60000).toISOString(), stale: true,
    cited_by: ["C001"], stale_reason: "report/export.py changed after the run",
  },
  { id: "R004", exit: 0, command: "pytest -q", at: new Date(Date.now() - 20 * 60000).toISOString(), stale: false, cited_by: ["C002"] },
  { id: "R003", exit: 2, command: "pytest -q", at: new Date(Date.now() - 2 * 3600000).toISOString(), stale: false, cited_by: [] },
];

test("pane v2 injects one stylesheet of keyframes in theme colours and removes it on dispose", async (t) => {
  const registered = await loadPlugin(t);
  assert.equal(registered.head.length, 1);
  const css = registered.head[0].textContent;
  for (const frame of ["lithermes-in", "lithermes-pulse", "lithermes-flip", "lithermes-sweep"]) {
    assert.match(css, new RegExp(`@keyframes ${frame}\\b`));
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
  registered.dispose();
  assert.equal(registered.head.length, 0);
});

test("pane v2 shows a progress ring, the gate pill, the urgent reason and signed receipts", async (t) => {
  const payload = goalPayload({
    criteria: [
      { id: "C001", text: "rows kept", status: "pass" },
      { id: "C002", text: "totals match", status: "pass" },
      { id: "C003", text: "pdf renders", status: "pending" },
    ],
    gate: {
      open: false, source: "session", evaluated_at: "2026-11-09T05:00:00+00:00",
      reasons: ["C001 evidence R007 is stale: report/export.py changed after the run (re-run the tests)", "C003 status is 'pending' (need 'pass')"],
    },
    receipts: RECEIPTS_FIXTURE,
  });
  const { tree } = await renderPane(t, payload);
  const found = leaves(tree).map((leaf) => leaf.text);
  assert.ok(found.includes("2/3") && found.includes("proven"), "ring counts criteria passed over total");
  assert.ok(found.includes("GATE CLOSED"));
  assert.ok(found.some((line) => line.startsWith("⚠ C001 evidence R007 is stale")));
  assert.ok(found.includes("Receipts") && found.includes("R007") && found.includes("R004") && found.includes("R003"));
  assert.ok(found.includes("report/export.py changed after the run (re-run it)"));
  assert.ok(found.includes("cited by C002") && found.includes("not cited"));
  assert.ok(found.includes("5m ago") && found.includes("20m ago") && found.includes("2h ago"));
  assert.ok(found.includes("exit 2") && found.filter((line) => line === "signed").length === 3);
  assert.ok(found.includes("C003 status is 'pending' (need 'pass')"), "non-urgent reasons stay under why");
  const json = JSON.stringify(tree);
  assert.match(json, /"aria-label":"2 of 3 criteria proven"/);
  assert.match(json, /lithermes-pulse/);
});

test("the empty pane teaches lit in one look: what to type and what will appear", async (t) => {
  const { tree } = await renderPane(t, { goal: null, criteria: [], evidence: [], gate: { open: false, reasons: [] }, stages: [], receipts: [] });
  const found = leaves(tree).map((leaf) => leaf.text);
  assert.ok(found.includes("lit") && found.includes("fix the failing export test"));
  for (const tile of ["1 Plan", "2 Runs", "3 Gate", "4 Handoff"]) assert.ok(found.includes(tile), tile);
  for (const stage of ["Plan", "Runs", "Review", "Gate", "Handoff", "Resume"]) assert.ok(found.includes(stage), stage);
  assert.ok(found.some((line) => line.includes("a session in project sets a lit goal")));
});

test("a gate flip replays the pill but raises no Desktop notification of its own", async (t) => {
  // post_message from the plugin's hook already toasts each gate change in Desktop; a
  // host.notify here would be a second toast for the same change.
  assert.doesNotMatch(fs.readFileSync(path.join(pluginRoot, "desktop", "plugin.js"), "utf8"), /\.notify\s*\(/);
  const { registered } = await renderPane(t, goalPayload({ gate: { open: false, reasons: ["C001 status is 'pending' (need 'pass')"] } }));
  const pane = registered.find((entry) => entry.id === "goal-pane");
  const chip = registered.find((entry) => entry.id === "gate-chip");
  const show = (payload) => {
    globalThis.__litPayload = payload;
    return [JSON.stringify(expand(pane.render())), JSON.stringify(expand(chip.render()))];
  };
  const [closedPane] = show(goalPayload({ gate: { open: false, reasons: ["C001 status is 'pending' (need 'pass')"] } }));
  const [openPane, openChip] = show(goalPayload({ criteria: [{ id: "C001", text: "rows kept", status: "pass" }], gate: { open: true, reasons: [] } }));
  assert.match(closedPane, /GATE CLOSED/);
  assert.match(openPane, /GATE OPEN/);
  assert.match(openPane, /lithermes-flip/);
  assert.match(openChip, /lit gate: open/);
  assert.equal(globalThis.__litNotes.length, 0);
});

test("an open gate shows an old stale run as superseded, not as a warning", async (t) => {
  const payload = goalPayload({
    criteria: [{ id: "C001", text: "rows kept", status: "pass" }],
    gate: { open: true, reasons: [] },
    receipts: [
      { id: "R004", exit: 0, command: "pytest -q", at: new Date().toISOString(), stale: false, cited_by: ["C001"] },
      { id: "R002", exit: 0, command: "pytest -q", at: new Date().toISOString(), stale: true, cited_by: ["C001"], stale_reason: "app.py changed after the run" },
    ],
  });
  const { tree } = await renderPane(t, payload);
  const found = leaves(tree).map((leaf) => leaf.text);
  assert.ok(found.includes("exit 0 · superseded"));
  assert.ok(!found.some((line) => line.includes("(re-run it)")));
});
