const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const cli = path.join(packageRoot, "bin", "lithermes.js");
const source = path.join(packageRoot, "assets", "lithermes-plugin", "tui-widgets", "lit-card.mjs");
const load = () => import(pathToFileURL(source).href);
const NOW = 1_900_000_000_000;
const STAGES = [["plan", "done"], ["runs", "done"], ["review", "active"], ["gate", "todo"], ["handoff", "todo"], ["resume", "todo"]];
const record = (over = {}) => ({
  v: 1, pid: process.pid, at: NOW / 1000, since: NOW / 1000 - 17, working: true, title: "Fix the quarterly export so totals match",
  status: "active", passed: 2, total: 3, gate: false, next: "C003 has no scenario evidence yet", stages: STAGES,
  runs: [["R004 ✓", "ok"], ["R006 ✗ exit 1", "bad"]], ...over,
});
const text = (row) => row.map((span) => span.text).join("");
const paint = (rows) => rows.map((row) => row.map((span) => JSON.stringify([span.text, span.fg, span.bg])).join("")).join("\n");
const SUN = /[▁▂▃▄▅▆▇]/u;
const hexes = (rows) => rows.flat().filter((span) => span.fg || span.bg).length;

test("every row is exactly the card's width, at every size and with wide text", async () => {
  const card = await load();
  for (const title of ["short", "분기 내보내기 합계가 맞도록 고치고 보고서까지 다시 만들기", "x".repeat(200), "a🔥b é \u001b[31mred​"]) {
    for (let width = card.MIN_COLS - 4; width <= card.MAX_WIDTH; width += 1) {
      for (const rich of [true, false]) {
        const model = card.toModel(record({ title, runs: [["R001 ⚠ stale", "warn"], ["R002 superseded", "dim"], ["R003 ✗ exit 127", "bad"]] }), NOW);
        const rows = card.cardRows(model, { width, t: 2.5, now: NOW, rich, caps: width % 2 === 0 });
        assert.equal(rows.length, 6);
        for (const row of rows) assert.equal(card.textWidth(text(row)), width, `${width} ${title}: ${text(row)}`);
      }
    }
  }
});

test("the scene stands only in cells no text uses: stars and sea three cells clear of words, the sun two", async () => {
  const card = await load();
  for (const next of ["one", "a longer next step that names a file and a run", "y".repeat(58)]) {
    const model = card.toModel(record({ next }), NOW);
    for (let width = 44; width <= 100; width += 1) {
      const plain = card.cardRows(model, { width, t: 4, now: NOW, rich: false }).map(text);
      for (const t of [null, 0, 0.5, 1, 4, 9.3]) {
        const rows = card.cardRows(model, { width, t, now: NOW, rich: true }).map(text);
        for (const r of [2, 4]) {
          const words = plain[r].trimEnd().replace(/ *│$/, "");
          assert.ok(rows[r].startsWith(words), `${width}: ${rows[r]}`);
          const rest = rows[r].slice(words.length);
          if (rest.slice(0, -1).trim()) assert.match(rest, /^ {3}|^ {2}[▁-█]/u, `${width}: ${rows[r]}`);
        }
      }
    }
  }
  const grids = [0, 1, 2].map(() => Array.from({ length: 90 }, () => ({ ch: " " })));
  grids[1][62] = { ch: "x" };
  assert.equal(card.paintScene(grids, 55, 1), false, "one taken cell keeps the sun away");
  assert.equal(grids.flat().filter((cell) => cell.ch !== " ").length, 1, "and then nothing is painted");
});

test("motion is colour for shape glyphs and ASCII for the rest; rest is the same picture twice", async () => {
  const card = await load();
  const model = card.toModel(record(), NOW);
  const frame = (t) => card.cardRows(model, { width: 100, t, now: NOW });
  const frames = Array.from({ length: 48 }, (_, i) => frame(i / 4));
  assert.ok(new Set(frames.map(paint)).size > 40, "frames differ");
  const shapes = frames.map((rows) => rows.map((row) => [...text(row)].map((ch) => (ch.charCodeAt(0) > 126 ? ch : " ")).join("")).join("\n"));
  assert.equal(new Set(shapes).size, 1, "no shape glyph ever changes");
  assert.equal(paint(frame(null)), paint(card.cardRows(model, { width: 100, t: null, now: NOW + 5000 })), "the resting picture does not depend on the clock");
  assert.match(frame(null).map(text).join("\n"), SUN);
  assert.match(card.cardRows(model, { width: 76, t: 1, now: NOW }).map(text).join("\n"), SUN, "an 80-column terminal has room beside short rows");
  assert.doesNotMatch(card.cardRows(model, { width: 60, t: 1, now: NOW }).map(text).join("\n"), SUN);
});

test("no scene, no colour and no round cap without a dark truecolor terminal", async () => {
  const card = await load();
  const env = { COLORTERM: "truecolor", TERM: "xterm-256color", LANG: "en_US.UTF-8" };
  assert.equal(card.isRich(env, "#e6edf3"), true);
  assert.equal(card.isRich({ ...env, NO_COLOR: "" }, "#e6edf3"), false);
  assert.equal(card.isRich({ ...env, COLORTERM: "" }, "#e6edf3"), false);
  assert.equal(card.isRich({ ...env, LANG: "C" }, "#e6edf3"), false);
  assert.equal(card.isRich({ ...env, TERM: "dumb" }, "#e6edf3"), false);
  assert.equal(card.isRich(env, "#1a1a1a"), false, "a light theme has dark text");
  for (const [name, value] of [["HERMES_TUI_LIGHT", "1"], ["HERMES_TUI_THEME", "light"], ["HERMES_TUI_BACKGROUND", "#fdf6e3"], ["COLORFGBG", "0;15"]]) {
    assert.equal(card.isRich({ ...env, [name]: value }, "#e6edf3"), false, name);
  }
  assert.equal(card.isRich({ ...env, COLORFGBG: "15;0" }, "#e6edf3"), true);
  const model = card.toModel(record(), NOW);
  const plain = card.cardRows(model, { width: 100, t: 3, now: NOW, rich: false });
  assert.equal(hexes(plain), 0);
  assert.doesNotMatch(plain.map(text).join("\n"), SUN);
  const round = /[]/u;
  assert.equal(card.hasRoundCaps(env), false);
  assert.equal(card.hasRoundCaps({ ...env, WT_SESSION: "1" }), true);
  assert.equal(card.hasRoundCaps({ ...env, TERM_PROGRAM: "vscode" }), true);
  const square = card.cardRows(model, { width: 100, t: null, now: NOW });
  const rounded = card.cardRows(model, { width: 100, t: null, now: NOW, caps: true });
  assert.doesNotMatch(square.map(text).join(""), round);
  assert.match(rounded.map(text).join(""), round);
});

test("a finished goal has no sun; the frame says what the record says", async () => {
  const card = await load();
  const show = (over) => card.cardRows(card.toModel(record(over), NOW), { width: 100, t: null, now: NOW }).map(text).join("\n");
  assert.match(show({}), /WORK ●/);
  assert.match(show({ working: false }), /YOUR TURN/);
  const done = show({ working: false, status: "complete", gate: true, passed: 3 });
  assert.match(done, /DONE ✓/);
  assert.match(done, /gate OPEN/);
  assert.doesNotMatch(done, SUN);
});

test("a record that cannot be true shows nothing or no work", async () => {
  const card = await load();
  assert.equal(card.toModel(null, NOW), null);
  assert.equal(card.toModel(record({ v: 2 }), NOW), null);
  assert.equal(card.toModel(record({ title: "" }), NOW), null);
  assert.equal(card.toModel(record(), NOW, () => false).working, false, "the writer's process is gone");
  assert.equal(card.toModel(record(), NOW + 31 * 60_000), null, "a turn that stopped reporting half an hour ago");
  assert.equal(card.toModel(record({ working: false }), NOW + 31 * 60_000), null, "a card nobody came back to");
  const hostile = card.toModel(record({ title: "t\u001b]0;x\u0007\n‮abc", runs: [["R1\u001b[2J", "ok"], ["R2", "nope"]], stages: [["plan", "weird"]] }), NOW);
  assert.doesNotMatch(JSON.stringify(hostile), /\\u001b|\\u0007|‮/u);
  assert.equal(hostile.runs.length, 1);
  assert.deepEqual(hostile.stages, []);
});

// --- the widget in a stand-in host -------------------------------------------------------------

function makeHost(t, { mode = null, value = record({ at: Date.now() / 1000, since: Date.now() / 1000 }), env = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-tui-card."));
  const active = path.join(home, "active.json");
  fs.mkdirSync(path.join(home, "lithermes", "tui-card"), { recursive: true });
  fs.writeFileSync(active, JSON.stringify({ session_id: "s-1" }));
  if (mode) fs.writeFileSync(path.join(home, "lithermes", "tui-card.json"), JSON.stringify({ mode }));
  const saved = { ...process.env };
  Object.assign(process.env, { HERMES_HOME: home, HERMES_TUI_ACTIVE_SESSION_FILE: active, COLORTERM: "truecolor", TERM: "xterm-256color", LANG: "en_US.UTF-8" });
  delete process.env.NO_COLOR;
  delete process.env.LC_ALL;
  delete process.env.LC_CTYPE;
  Object.assign(process.env, env);
  const timers = new Set();
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  globalThis.setInterval = (fn, ms) => { const id = { fn, ms }; timers.add(id); return id; };
  globalThis.clearInterval = (id) => timers.delete(id);
  const host = { home, active, timers, app: null, state: undefined, opened: 0, cleanup: null, reads: 0 };
  let effect = null;
  let deps = null;
  const sdk = {
    Box: "box", Text: "text", h: (type, props, ...children) => ({ type, props, children }),
    React: {
      useState: () => [0, () => { host.ticks = (host.ticks || 0) + 1; }],
      useRef: (value2) => (host.ref ??= { current: value2 }),
      useEffect: (fn, next) => { effect = fn; deps = next; },
    },
    defineWidgetApp: (app) => { host.app = app; return app; },
    openWidget: (app, state) => { host.opened += 1; host.state = state; },
    updateWidget: (app, fn) => { if (host.state !== undefined) host.state = fn(host.state); },
  };
  let last = null;
  // Renders like React would: mounts the card, runs its effect when the dependencies changed.
  host.render = (cols = 100, rows = 40, color = "#e6edf3") => {
    const node = host.app.render({ state: host.state, cols, rows, t: { color: { text: color } } });
    if (!node) { host.cleanup?.(); host.cleanup = null; last = null; return null; }
    const tree = node.type(node.props);
    if (!last || deps.some((value2, i) => value2 !== last[i])) { host.cleanup?.(); host.cleanup = effect() || null; last = deps; }
    return tree;
  };
  host.write = async (next) => {
    const card = await load();
    fs.writeFileSync(path.join(home, "lithermes", "tui-card", card.recordName("s-1")), JSON.stringify(next));
  };
  host.start = async () => {
    if (value) await host.write(value);
    (await load()).default(sdk);
  };
  host.until = async (check) => {
    for (let i = 0; i < 100 && !check(); i += 1) await new Promise((done) => setTimeout(done, 50));
    assert.ok(check(), "state arrived");
  };
  t.after(() => {
    globalThis[Symbol.for("lithermes.tui-card")]?.close();
    delete globalThis[Symbol.for("lithermes.tui-card")];
    host.cleanup?.();
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    fs.rmSync(home, { recursive: true, force: true });
  });
  return host;
}

test("working runs one 250 ms timer; rest, still, no colour and a small window run none", async (t) => {
  const host = makeHost(t);
  await host.start();
  assert.equal(host.opened, 1);
  assert.ok(host.render());
  assert.deepEqual([...host.timers].map((timer) => timer.ms), [250]);
  host.render();
  assert.equal(host.timers.size, 1, "a re-render starts no second timer");
  const readFile = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = (...args) => { reads += 1; return readFile(...args); };
  for (let i = 0; i < 30; i += 1) { [...host.timers][0].fn(); host.render(); }
  fs.readFileSync = readFile;
  assert.equal(reads, 0, "no file is read per frame");
  assert.equal(host.render(40), null, "too narrow: zero rows");
  assert.equal(host.timers.size, 0);
  assert.equal(host.render(100, 18), null, "too short: zero rows");
  host.render();
  assert.equal(host.timers.size, 1);
  host.render(100, 40, "#1a1a1a");
  assert.equal(host.timers.size, 0, "a light theme holds still");
});

test("the end of the turn, another session and the settings reach the card without polling", async (t) => {
  const host = makeHost(t);
  await host.start();
  host.render();
  await host.write(record({ at: Date.now() / 1000, working: false }));
  await host.until(() => host.state.model?.working === false);
  const tree = host.render();
  assert.equal(host.timers.size, 0, "idle costs no frames");
  assert.match(JSON.stringify(tree), /YOUR TURN/);
  fs.writeFileSync(host.active, JSON.stringify({ session_id: "s-2" }));
  await host.until(() => host.state.model === null);
  assert.equal(host.render(), null, "a session without a goal has no card");
  fs.writeFileSync(host.active, JSON.stringify({ session_id: "s-1" }));
  await host.until(() => host.state.model !== null);
  fs.writeFileSync(path.join(host.home, "lithermes", "tui-card.json"), JSON.stringify({ mode: "off" }));
  await host.until(() => host.state.model === null);
});

test("a lost file event does not leave the card at work", async (t) => {
  t.mock.method(fs, "watch", () => ({ on() {}, close() {} })); // no event ever reaches the card
  const host = makeHost(t);
  await host.start();
  host.render();
  await host.write(record({ at: Date.now() / 1000, working: false }));
  const [timer] = host.timers;
  for (let i = 0; i < 40; i += 1) timer.fn();
  assert.equal(host.state.model.working, false, "the ten-second look found the end of the turn");
  await host.write(record({ at: Date.now() / 1000, title: "later" }));
  await host.until(() => host.state.model?.title === "later");
});

test("still keeps the picture and drops the timer; no record means zero rows", async (t) => {
  const still = makeHost(t, { mode: "still" });
  await still.start();
  assert.match(JSON.stringify(still.render()), SUN);
  assert.equal(still.timers.size, 0);
  assert.doesNotMatch(JSON.stringify(still.render()), /"0:\d\d"/, "no clock that would stand still");
});

test("no record, no session id and a dismissed card stay out of the dock", async (t) => {
  const host = makeHost(t, { value: null });
  await host.start();
  assert.equal(host.render(), null);
  host.state = undefined; // the user typed /lit-card: the host dropped it
  await host.start();
  assert.equal(host.opened, 1, "a hot reload does not bring it back");
});

// --- installer ---------------------------------------------------------------------------------

function run(home, ...args) {
  return spawnSync(process.execPath, [cli, ...args, "--hermes-home", home], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, HERMES_HOME: home, NO_COLOR: "1", CI: "1", LITHERMES_NO_AUTO_UPDATE: "1", LITHERMES_NO_UPDATE_CHECK: "1" },
  });
}
function installed(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-tui-card-install."));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const result = run(home, "install", "--yes", "--offline", "--no-patch-installed-hermes");
  assert.equal(result.status, 0, result.stderr);
  return { home, widget: path.join(home, "tui-widgets", "lit-card.mjs"), settings: path.join(home, "lithermes", "tui-card.json"), result };
}

test("install, doctor and uninstall own the widget by its bytes", (t) => {
  const { home, widget, settings, result } = installed(t);
  assert.match(result.stdout, /TUI card: PASS \(on\)/);
  assert.deepEqual(fs.readFileSync(widget), fs.readFileSync(source));
  assert.match(run(home, "doctor", "--offline").stdout, /TUI card: PASS \(on\)/);
  fs.writeFileSync(widget, "// older release\n");
  fs.writeFileSync(settings, JSON.stringify({ mode: "on", sha256: require("node:crypto").createHash("sha256").update("// older release\n").digest("hex") }));
  assert.match(run(home, "doctor", "--offline").stdout, /TUI card: OUTDATED/);
  assert.equal(run(home, "install", "--yes", "--offline", "--no-patch-installed-hermes").status, 0);
  assert.deepEqual(fs.readFileSync(widget), fs.readFileSync(source), "a recorded older file is refreshed");
  fs.mkdirSync(path.join(home, "lithermes", "tui-card"), { recursive: true });
  fs.writeFileSync(path.join(home, "lithermes", "tui-card", `${"a".repeat(32)}.json`), "{}");
  assert.match(run(home, "uninstall", "--dry-run").stdout, /TUI card: would remove/);
  assert.ok(fs.existsSync(widget));
  assert.equal(run(home, "uninstall", "--yes").status, 0);
  for (const gone of [path.dirname(widget), settings, path.join(home, "lithermes", "tui-card")]) assert.equal(fs.existsSync(gone), false, gone);
});

test("a foreign, edited or symlinked widget is never replaced or removed", (t) => {
  const { home, widget } = installed(t);
  fs.appendFileSync(widget, "// my edit\n");
  const mine = fs.readFileSync(widget, "utf8");
  assert.match(run(home, "install", "--yes", "--offline", "--no-patch-installed-hermes").stdout, /TUI card: FOREIGN/);
  assert.match(run(home, "hud", "card", "off").stdout, /left alone/);
  assert.match(run(home, "uninstall", "--yes").stdout, /Uninstalled/);
  assert.equal(fs.readFileSync(widget, "utf8"), mine);

  const other = installed(t);
  const target = path.join(other.home, "target.mjs");
  fs.writeFileSync(target, fs.readFileSync(source));
  fs.rmSync(other.widget);
  fs.symlinkSync(target, other.widget);
  assert.match(run(other.home, "install", "--yes", "--offline", "--no-patch-installed-hermes").stdout, /TUI card: FOREIGN/);
  run(other.home, "uninstall", "--yes");
  assert.ok(fs.lstatSync(other.widget).isSymbolicLink());
  assert.ok(fs.existsSync(target));

  const linked = installed(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-tui-card-out."));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.rmSync(path.dirname(linked.widget), { recursive: true });
  fs.symlinkSync(outside, path.dirname(linked.widget));
  assert.equal(run(linked.home, "install", "--yes", "--offline", "--no-patch-installed-hermes").status, 0);
  assert.deepEqual(fs.readdirSync(outside), [], "nothing is written through a symlinked folder");
});

test("hud card saves the choice and a later install honours it", (t) => {
  const { home, widget, settings } = installed(t);
  assert.match(run(home, "hud", "card").stdout, /TUI card: PASS \(on\)/);
  assert.match(run(home, "hud", "card", "off", "--dry-run").stdout, /Nothing was changed/);
  assert.ok(fs.existsSync(widget));
  assert.match(run(home, "hud", "card", "off").stdout, /TUI card off/);
  assert.equal(fs.existsSync(widget), false);
  assert.equal(run(home, "install", "--yes", "--offline", "--no-patch-installed-hermes").status, 0);
  assert.equal(fs.existsSync(widget), false, "off survives an upgrade");
  assert.match(run(home, "doctor", "--offline").stdout, /TUI card: OFF/);
  assert.match(run(home, "hud", "card", "still").stdout, /TUI card still/);
  assert.ok(fs.existsSync(widget));
  assert.equal(JSON.parse(fs.readFileSync(settings, "utf8")).mode, "still");
  run(home, "uninstall", "--yes");
  assert.equal(JSON.parse(fs.readFileSync(settings, "utf8")).mode, "still", "a choice outlives an uninstall");
  assert.equal(run(home, "hud", "card", "loud").status, 4);
  assert.equal(run(home, "hud", "rose", "extra").status, 2);
});
