const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { cardTerminal, cells, createCards, ink, wrap } = require("../src/lib/cards");
const { pickAccent } = require("../src/lib/hud");
const { pickModelRoute } = require("../src/lib/modelPrompt");
const { ROUTE_CATALOG, managedRequest } = require("../src/lib/modelRoutePolicy");
const { receiptSections } = require("../src/lib/spinner");

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const RIGHT = "\x1b[C";
const LEFT = "\x1b[D";
const ENTER = "\r";
const CTRL_C = "\x03";
const CTRL_D = "\x04";
const TRUECOLOR = { TERM: "xterm-256color", COLORTERM: "truecolor", LANG: "en_US.UTF-8" };
const strip = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

// A terminal in memory: what is written, the raw-mode switches, and the rows now on screen.
function terminal({ cols = 80, rows = 40, env = TRUECOLOR, total = 1, caps = false } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const modes = [];
  Object.assign(input, { isTTY: true, setRawMode: (on) => modes.push(on) });
  Object.assign(output, { isTTY: true, columns: cols, rows });
  let written = "";
  let screen = [];
  let row = 0;
  output.on("data", (chunk) => {
    const text = String(chunk);
    written += text;
    for (const part of text.match(/\x1b\[\d*[AJK]|\r|\n|(?:(?!\x1b\[\d*[AJK])[^\r\n])+/g) || []) {
      const lift = /^\x1b\[(\d+)A$/.exec(part);
      if (lift) row = Math.max(0, row - Number(lift[1]));
      else if (part === "\x1b[J") screen = screen.slice(0, row);
      else if (part === "\n") row += 1;
      else if (part !== "\r" && part !== "\x1b[K" && strip(part)) screen[row] = part;
    }
  });
  const proc = Object.assign(new EventEmitter(), { pid: 4242, platform: "linux", killed: [] });
  proc.kill = (...args) => proc.killed.push(args);
  const clock = { ms: 0 };
  const ui = createCards({ input, output, env, total, caps, proc, settleMs: 0, now: () => clock.ms });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 8));
  return {
    ui, input, output, modes, proc, clock,
    written: () => written,
    screen: () => Array.from(screen, (line) => line || ""),
    text: () => Array.from(screen, (line) => strip(line || "")).join("\n"),
    async press(...keys) { await tick(); for (const key of keys) { input.write(key); await tick(); } },
    resize(columns, height) { Object.assign(output, { columns, rows: height }); output.emit("resize"); },
    idle() {
      assert.equal(modes.at(-1), false, "raw mode is off");
      assert.ok(written.lastIndexOf("\x1b[?25h") > written.lastIndexOf("\x1b[?25l"), "the cursor shows");
      assert.equal(input.listenerCount("keypress"), 0);
      assert.equal(proc.listenerCount("SIGINT") + proc.listenerCount("exit") + proc.listenerCount("SIGCONT"), 0);
    },
  };
}

const THREE = [{ label: "one", detail: "first" }, { label: "two", detail: "second" }, { label: "three", detail: "third" }];
const pickThree = (t, extra = {}) => t.ui.pick({ title: "Pick", note: "What it does.", choices: THREE, start: 1, ...extra });

test("cards need two terminals, raw mode, room, and no request for plain output", () => {
  const tty = { isTTY: true, columns: 80, rows: 24 };
  const keys = { isTTY: true, setRawMode() {} };
  const on = { input: keys, output: tty, env: { TERM: "xterm-256color" }, flags: {} };
  assert.equal(cardTerminal(on), true);
  assert.equal(cardTerminal({ ...on, env: { ...on.env, NO_COLOR: "1" } }), true);
  for (const [name, change] of Object.entries({
    "piped input": { input: { setRawMode() {} } },
    "piped output": { output: {} },
    "no raw mode": { input: { isTTY: true } },
    CI: { env: { CI: "" } },
    "a dumb terminal": { env: { TERM: "dumb" } },
    narrow: { output: { ...tty, columns: 39 } },
    short: { output: { ...tty, rows: 11 } },
    "--yes": { flags: { yes: true } },
    "--json": { flags: { json: true } },
    "--dry-run": { flags: { "dry-run": true } },
    "--no-spinner": { flags: { "no-spinner": true } },
  })) assert.equal(cardTerminal({ ...on, ...change }), false, name);
});

test("Enter takes the marked default, and the card folds to one line", async () => {
  const t = terminal();
  const answer = pickThree(t);
  await t.press();
  assert.match(t.text(), /╭─ {2}LIT 1\/1 {2}· Pick ─/);
  assert.match(t.text(), /❯ 1 two +second +default/);
  await t.press(ENTER);
  assert.equal(await answer, 1);
  assert.equal(t.text().trim(), "✓ Pick                 two");
  t.idle();
});

test("a folded answer stays inside a narrow window", async () => {
  const t = terminal({ cols: 40 });
  const answer = t.ui.pick({ title: "Helper model", note: "n", choices: [{ label: "grok-4.20-0309-reasoning · medium" }] });
  await t.press(ENTER);
  await answer;
  assert.deepEqual(t.text().split("\n"), ["", " ✓ Helper model", "   grok-4.20-0309-reasoning · medium"]);
});

test("arrows, j and k move and wrap round, digits jump, and none of them answers", async () => {
  for (const [keys, expected] of [
    [[DOWN, ENTER], 2], [[DOWN, DOWN, ENTER], 0], [[UP, UP, ENTER], 2], [["j", ENTER], 2], [["k", ENTER], 0],
    [["0", ENTER], 0], [["9", ENTER], 1], [["\x1b[H", ENTER], 0], [["\x1b[F", ENTER], 2], [["x", "y", "n", " ", ENTER], 1],
  ]) {
    const t = terminal();
    const answer = pickThree(t);
    await t.press(...keys);
    assert.equal(await answer, expected, JSON.stringify(keys));
  }
});

test("Esc answers nothing", async () => {
  const t = terminal();
  const answer = pickThree(t);
  await t.press("\x1b");
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.match(t.text(), /❯ 1 two/);
  await t.press(ENTER);
  assert.equal(await answer, 1);
});

test("two digits reach a two-digit choice", async () => {
  const t = terminal();
  const choices = Array.from({ length: 14 }, (_, i) => ({ label: `row ${i}` }));
  const answer = t.ui.pick({ title: "Long", note: "n", choices });
  await t.press("1", "0", ENTER);
  assert.equal(await answer, 10);

  const slow = terminal();
  const apart = slow.ui.pick({ title: "Long", note: "n", choices });
  await slow.press("1");
  slow.clock.ms = 5000;
  await slow.press("0", ENTER);
  assert.equal(await apart, 0, "digits far apart are two jumps");
});

test("Ctrl+D ends the question like the closed prompt did; a closed terminal does too", async () => {
  for (const end of [(t) => t.press(CTRL_D), (t) => t.press().then(() => t.input.end())]) {
    const t = terminal();
    const answer = pickThree(t);
    await end(t);
    assert.equal(await answer, null);
    assert.match(t.text(), /· Pick +skipped/);
    t.idle();
  }
});

test("Ctrl+C interrupts the whole job, or only skips where the plain prompt only skipped", async () => {
  const stop = terminal();
  let said = false;
  stop.ui.onStop(() => { said = true; });
  pickThree(stop);
  await stop.press(CTRL_C);
  assert.deepEqual(stop.proc.killed, [[0, "SIGINT"]]);
  assert.equal(said, true);
  assert.match(stop.text(), /✗ Pick +stopped/);
  stop.idle();

  const skip = terminal();
  const answer = pickThree(skip, { ctrlCSkips: true });
  await skip.press();
  assert.match(skip.text(), /Ctrl\+C skip/);
  await skip.press(CTRL_C);
  assert.equal(await answer, null);
  assert.deepEqual(skip.proc.killed, []);
  skip.idle();
});

test("keys typed before the card came up answer nothing, except Ctrl+C", async () => {
  const early = terminal();
  early.input.write(`${DOWN}${ENTER}`);
  const answer = pickThree(early);
  await early.press(ENTER);
  assert.equal(await answer, 1);

  const stopped = terminal();
  stopped.input.write(CTRL_C);
  pickThree(stopped);
  await stopped.press();
  assert.deepEqual(stopped.proc.killed, [[0, "SIGINT"]]);
});

test("Ctrl+Z hands the terminal back and the card returns on resume", async () => {
  const t = terminal();
  const answer = pickThree(t);
  await t.press("\x1a");
  assert.deepEqual(t.proc.killed, [[0, "SIGTSTP"]]);
  assert.equal(t.modes.at(-1), false);
  t.proc.emit("SIGCONT");
  assert.equal(t.modes.at(-1), true);
  await t.press(ENTER);
  assert.equal(await answer, 1);
  t.idle();
});

test("a signal from outside restores the terminal before the process goes", async () => {
  const t = terminal();
  pickThree(t);
  await t.press();
  t.proc.emit("SIGTERM", "SIGTERM");
  assert.deepEqual(t.proc.killed, [[4242, "SIGTERM"]]);
  assert.equal(t.modes.at(-1), false);
  assert.ok(t.written().endsWith("\x1b[?25h"));
});

test("yes/no: y and n answer at once, the sides and tab toggle, Enter takes the highlight", async () => {
  for (const [start, keys, expected] of [
    [false, [ENTER], false], [true, [ENTER], true], [false, ["y"], true], [true, ["N"], false],
    [false, [LEFT, ENTER], true], [false, [RIGHT, "\t", ENTER], false], [false, [DOWN, "q", ENTER], false],
  ]) {
    const t = terminal();
    const answer = t.ui.confirm({ title: "Bell", note: "Rings.", start });
    await t.press();
    assert.match(t.text(), start ? /Bell \[Y\/n\]/ : /Bell \[y\/N\]/);
    assert.match(t.text(), start ? /❯ Yes \(default\)/ : /❯ No \(default\)/);
    await t.press(...keys);
    assert.equal(await answer, expected, JSON.stringify(keys));
    t.idle();
  }
});

test("the review goes on only with Enter", async () => {
  const t = terminal();
  const answer = t.ui.review({ title: "Route", note: "Check.", rows: [{ label: "Lead", value: "m" }], word: "Continue", stopNote: "nothing written yet" });
  await t.press("y", "n", " ", DOWN);
  assert.match(t.text(), /│ {2}❯ Continue {7}│[^]*Enter = Continue {3}Ctrl\+C stop, nothing written yet/);
  await t.press(ENTER);
  assert.equal(await answer, true);
});

test("a window too short for the review still shows every row of it", async () => {
  const t = terminal({ cols: 40, rows: 14 });
  const rows = ["Provider", "Lead", "Helpers", "Writes", "Warning"].map((label, i) => ({ label, value: `value-${i} ${"word ".repeat(12)}` }));
  const answer = t.ui.review({ title: "Route", note: "Check.", rows, word: "Continue", stopNote: "nothing written yet" });
  await t.press();
  for (let i = 0; i < 5; i += 1) assert.match(strip(t.written()), new RegExp(`value-${i}`));
  await t.press(ENTER);
  assert.equal(await answer, true);
});

test("every card fits the window, whatever its size, and keeps its key hint", async () => {
  const models = ROUTE_CATALOG[managedRequest().provider].rows.map((row) => ({ label: `${row.model} · ${row.effort}`, detail: row.note }));
  for (const cols of [40, 60, 80, 100, 120]) {
    for (const rows of [12, 16, 24, 60]) {
      for (const [name, open] of Object.entries({
        provider: (ui) => pickModelRoute({ ui, env: {}, configPath: "/h/config.yaml" }),
        helper: (ui) => ui.pick({ title: "Helper model", note: "Sets it.", choices: ROUTE_CATALOG.xai.rows.map((row) => ({ label: `${row.model} · ${row.effort}`, detail: row.note })) }),
        list: (ui) => ui.pick({ title: "Lead model", note: "Sets the model and reasoning effort that plan and review; Enter keeps what is marked.", choices: models, start: 26 }),
        accents: (ui) => pickAccent({ ui }),
        yesno: (ui) => ui.confirm({ title: "Finish bell", note: "Rings the terminal bell when a Hermes turn finishes; No leaves that setting alone." }),
      })) {
        const t = terminal({ cols, rows });
        const answer = open(t.ui);
        await t.press(DOWN);
        const label = `${name} at ${cols}x${rows}`;
        assert.ok(t.screen().length < rows, `${label}: ${t.screen().length} rows`);
        assert.ok(t.screen().every((line) => cells(line) < cols), label);
        assert.match(t.text(), /Ctrl\+C/, label);
        assert.match(t.text(), /❯/, label);
        assert.match(t.text(), /╰─+╯\s*$/, label);
        await t.press(CTRL_D);
        await answer;
      }
    }
  }
});

test("a label too wide for the window is cut in the middle, and the highlighted one is spelled out", async () => {
  const t = terminal({ cols: 40, rows: 30 });
  const answer = t.ui.pick({ title: "Helper model", note: "n", choices: [
    { label: "grok-4.20-0309-reasoning · medium", detail: "Grok reasoning effort" }, { label: "grok-4.20-0309-reasoning · high", detail: "previous" },
  ] });
  await t.press();
  assert.match(t.text(), /❯ 0 grok-4\.20[^ ]*….*· medium/);
  assert.match(t.text(), /1 grok-4\.20[^ ]*….*· high/);
  assert.match(t.text().replace(/ *│\n *│ */g, " "), /grok-4\.20-0309-reasoning · medium Grok reasoning effort/);
  await t.press(ENTER);
  assert.equal(await answer, 0);
});

test("a list longer than the window follows the highlight and says where it is", async () => {
  const t = terminal({ rows: 18 });
  const choices = Array.from({ length: 41 }, (_, i) => ({ label: `model-${i}` }));
  const answer = t.ui.pick({ title: "Lead model", note: "n", choices, start: 26 });
  await t.press();
  assert.match(t.text(), /❯ 26 model-26/);
  assert.match(t.text(), /27\/41/);
  await t.press("\x1b[6~");
  assert.doesNotMatch(t.text(), /❯ 26/);
  await t.press("4", "0");
  assert.match(t.text(), /❯ 40 model-40/);
  await t.press(ENTER);
  assert.equal(await answer, 40);
});

test("a resize redraws the card for the new window", async () => {
  const t = terminal({ cols: 110 });
  const answer = pickThree(t);
  await t.press();
  t.resize(44, 20);
  await t.press();
  assert.ok(cells(t.screen().find((line) => line.includes("╭"))) < 44);
  const before = t.written().length;
  t.resize(44, 6);
  await t.press();
  const small = strip(t.written().slice(before)).split("\n");
  assert.ok(small.length <= 6, "a window shrunk under the card shows the card's end");
  assert.match(small.join("\n"), /Ctrl\+C/);
  await t.press(ENTER);
  assert.equal(await answer, 1);
});

test("no colour, ASCII and fewer colours keep the same card", async () => {
  const render = async (env) => {
    const t = terminal({ env });
    const answer = t.ui.confirm({ title: "Bell", note: "Rings — once.", start: false });
    await t.press();
    const shown = { text: t.text(), raw: t.written() };
    await t.press(CTRL_D);
    await answer;
    return shown;
  };
  const plain = await render({ ...TRUECOLOR, NO_COLOR: "1" });
  assert.doesNotMatch(plain.raw, /\x1b\[[0-9;]*m/);
  assert.match(plain.text, /\[LIT 1\/1\] · Bell \[y\/N\]/);
  assert.match(plain.text, /╔═+╗[^]*❯ No \(default\)/);
  const ascii = await render({ TERM: "xterm-256color", LC_ALL: "C" });
  assert.doesNotMatch(ascii.text, /[^\x00-\x7f]/);
  assert.match(ascii.text, /> No \(default\)/);
  assert.match((await render({ TERM: "xterm-256color", LANG: "en_US.UTF-8" })).raw, /\x1b\[[0-9;]*38;5;\d/);
  const accents = terminal({ env: { TERM: "linux", LANG: "en_US.UTF-8" } });
  const left = pickAccent({ ui: accents.ui });
  await accents.press("6", CTRL_D);
  await left;
  assert.doesNotMatch(accents.written(), /NaN/);
  const sixteen = (await render({ TERM: "linux", LANG: "en_US.UTF-8" })).raw;
  assert.doesNotMatch(sixteen, /[34]8;[25];/);
  assert.match(sixteen, /\x1b\[(?:1;)?9\d/);
});

test("wrap cuts a long path across lines and never drops a character", () => {
  const text = "plugin /a/very/long/path/that/does/not/fit/on/one/line 한국어 끝";
  const rows = wrap(text, 12);
  assert.ok(rows.every((row) => cells(row) <= 12));
  assert.equal(rows.join("").replace(/ /g, ""), text.replace(/ /g, ""));
  assert.equal(cells("한국어"), 6);
});

test("the accent card keeps the skin on Enter and reaches every name the prompt takes", async () => {
  for (const [keys, expected] of [
    [[ENTER], null], [["1", ENTER], "cyan"], [["6", ENTER], "rose"], [["1", "0", ENTER], "gray"],
    [["1", "1", ENTER], "ignition"], [["1", "2", ENTER], "tokyonight-day"], [["1", "3", ENTER], "tokyonight"], [[CTRL_D], null],
  ]) {
    const t = terminal();
    const answer = pickAccent({ ui: t.ui, current: "lithermes-rose" });
    await t.press();
    assert.match(t.text(), /❯ +0 +keep current +stay with lithermes-rose +default/);
    await t.press(...keys);
    assert.equal((await answer)?.accent ?? null, expected);
  }
});

test("the model cards walk the same four questions and the same last look", async () => {
  const t = terminal({ total: 5 });
  const answer = pickModelRoute({ ui: t.ui, env: {}, configPath: "/h/config.yaml" });
  await t.press("1", ENTER);
  await t.press();
  assert.match(t.text(), /LIT 2\/5 {2}· Lead model/);
  await t.press(ENTER, ENTER, ENTER);
  await t.press();
  assert.match(t.text(), /LIT 5\/5 {2}· Model route/);
  for (const row of [/Provider +xai/, /Lead +grok-build-0\.1 · high/, /Helpers +grok-4\.3 · high/, /Writes +\/h\/config\.yaml \(managed keys only\)/, /Warning +XAI_API_KEY is not set/]) assert.match(t.text(), row);
  await t.press(ENTER);
  assert.deepEqual(await answer, { confirmed: true, route: managedRequest({ provider: "xai" }) });

  const left = terminal({ total: 5 });
  const none = pickModelRoute({ ui: left.ui, env: {}, configPath: "/h/config.yaml" });
  await left.press(CTRL_D);
  assert.equal((await none).confirmed, false);
  assert.doesNotMatch(strip(left.written()), /LIT 2\/5/, "nothing more is asked once the input ended");
});

test("the closing card keeps every line of the receipt and puts warnings first", () => {
  const message = [
    "Installed LitHermes 0.0.1", "plugin: /h/plugins/lithermes", "model config: updated", "model write: aborted (drift)",
    "patches: skipped (no repo)", "warning: XAI_API_KEY is not set", "TUI card: FOREIGN (left alone)", "reviewer route: unavailable (x)",
    "Retained Python cache backup: /h/b", "a line without a colon", "Restart any running Hermes gateway to load new plugins.",
  ].join("\n");
  const card = receiptSections(message, [{ label: "HUD accent", text: "LitHermes HUD set to Rose.\nconfig: display.skin: x\nRestart Hermes, or run `/skin x`." }]);
  assert.equal(card.title, "LitHermes 0.0.1 is installed");
  assert.deepEqual(card.sections.map(({ head }) => head), ["Installed", "Settings", "Next"]);
  const [installed, settings, next] = card.sections;
  assert.deepEqual(installed.rows.map(({ label, tone }) => [label, tone]), [["Model write", "warn"], ["Patches", "warn"], ["Warning", "warn"], ["TUI card", "warn"],
    ["Plugin", "good"], ["Model config", "good"], ["Retained Python cache backup", "good"]]);
  assert.deepEqual(settings.rows.map(({ label, tone }) => [label, tone]), [["Reviewer route", "note"], ["Detail", "note"], ["HUD accent", "note"], ["", "note"]]);
  assert.deepEqual(settings.rows.slice(2).map(({ value }) => value), ["LitHermes HUD set to Rose.", "config: display.skin: x"]);
  assert.equal(receiptSections("LitHermes installed").title, "LitHermes installed");
  assert.deepEqual(next.rows.map(({ label }) => label), ["Gateway", "HUD accent"]);
});

test("the steps card marks what is done, adds a step it did not know, and shows where it stopped", () => {
  const t = terminal();
  const steps = t.ui.steps({ title: "Installing", names: ["one", "two"] });
  steps.reach("two");
  assert.match(t.text(), /✓ one[^]*▸ two/);
  steps.reach("extra");
  steps.finish();
  assert.match(t.text(), /✓ Install steps +3 of 3 checked/);
  const broken = terminal();
  const failed = broken.ui.steps({ title: "Installing", names: ["one", "two"] });
  failed.reach("one");
  failed.fail();
  assert.match(broken.text(), /✗ one[^]*· two/);
});

// Every card, opened for a look; `text` is the screen and `close` ends the question.
const CARDS = {
  list: (ui) => ui.pick({ title: "Output style", note: "Sets how Hermes words its replies.", choices: THREE }),
  accents: (ui) => pickAccent({ ui, current: "lithermes-rose" }),
  yesno: (ui) => ui.confirm({ title: "Finish bell", note: "Rings the terminal bell when a Hermes turn finishes; No leaves that setting alone." }),
  review: (ui) => ui.review({ title: "Model route", note: "Check the route.", rows: [{ label: "Provider", value: "xai" }, { label: "Writes", value: "/h/config.yaml" }], word: "Continue", stopNote: "nothing written yet" }),
  steps: (ui) => { ui.steps({ title: "Installing LitHermes 1", names: ["Copying payload", "Writing config"], about: (name) => `target of ${name}` }).reach("Writing config"); },
  closing: (ui) => ui.summary({ title: "LitHermes 1 is installed", sections: [{ head: "Installed", rows: [{ label: "Plugin", value: "/h/plugins", tone: "good" }, { label: "Warning", value: "w ".repeat(60), tone: "warn" }] }, { head: "Next", rows: [{ label: "Gateway", value: "Restart" }] }] }),
  stopped: (ui) => ui.summary({ title: "INSTALL STOPPED", bad: true, sections: [{ head: "Failed", rows: [{ label: "Reason", value: "r", tone: "bad" }] }] }),
};
async function look(open, options) {
  const t = terminal(options);
  const answer = open(t.ui);
  await t.press(DOWN);
  const shown = { screen: t.screen().filter((line) => line), raw: t.written(), text: t.text() };
  await t.press(CTRL_D);
  await answer;
  return shown;
}
const CAPS = /[\ue0b6\ue0b4]/u;

test("round is round everywhere, square is square everywhere, and both hold the same text in the same columns", async () => {
  for (const [name, open] of Object.entries(CARDS)) {
    for (const cols of [40, 60, 80, 100, 120]) {
      const rows = 60;
      const round = await look(open, { cols, rows, caps: true });
      const square = await look(open, { cols, rows });
      const label = `${name} at ${cols}`;
      assert.doesNotMatch(square.raw, CAPS, label);
      assert.match(round.raw, CAPS, label);
      assert.equal(round.text.replace(/[\ue0b6\ue0b4]/gu, " "), square.text.replace(/██/g, "  "), label);
      assert.doesNotMatch(round.text, /[░▒▓▯▌▐▀▄]|\[[#█]/u, label);
      for (const line of round.screen) {
        const fills = [...line.matchAll(/\x1b\[(?:[\d;]*;)?48;2;[\d;]*m/g)].length;
        const caps = [...strip(line)].filter((ch) => CAPS.test(ch)).length;
        assert.equal(caps % 2, 0, label);
        if (fills) assert.ok(caps >= 2, `${label}: ${strip(line)}`);
      }
      for (const shown of [round, square]) {
        const frame = shown.screen.filter((line) => /[╭│╰]/u.test(line));
        for (const line of frame) {
          assert.equal(cells(line), Math.min(cols - 2, 100) + 1, `${label}: ${strip(line)}`);
          assert.match(strip(line), /^ [╭│╰].*[╮│╯]$/u, label);
        }
      }
    }
  }
  for (const env of [{ ...TRUECOLOR, NO_COLOR: "1" }, { ...TRUECOLOR, COLORTERM: "" }, { TERM: "linux", LANG: "en_US.UTF-8" }, { ...TRUECOLOR, LANG: "C" }]) {
    for (const [name, open] of Object.entries(CARDS)) assert.doesNotMatch((await look(open, { env, caps: true })).raw, CAPS, name);
  }
});

test("values stand in one column, and one blank row stands between blocks", async () => {
  const t = terminal({ cols: 100, total: 2 });
  t.ui.note("Installs into /h/.hermes. Nothing is written before you confirm.");
  const first = CARDS.list(t.ui);
  await t.press();
  assert.match(t.text(), /^\n Installs into [^\n]*\n\n ╭─/);
  await t.press(ENTER);
  await first;
  const second = CARDS.yesno(t.ui);
  await t.press();
  assert.match(t.text(), /confirm\.\n\n ✓ Output style {9}one\n\n ╭─/);
  await t.press("n");
  await second;
  CARDS.closing(t.ui);
  t.ui.notice("LitFamily extensions\n  prose of it\n    a command");
  const rows = t.text().split("\n");
  assert.doesNotMatch(t.text(), /\n\n\n/, "never two blank rows");
  for (const value of ["one", "no", "/h/plugins", "Restart"]) assert.ok(rows.some((row) => row.slice(24).startsWith(value) && row[23] === " "), value);
  assert.match(t.text(), /╯\n\n LitFamily extensions\n   prose of it\n     a command/);
});

test("the mark is centred over the cards and leaves the window room for the first one", () => {
  const { renderInstallBanner } = require("../src/lib/modelPrompt");
  const { cardWidth } = require("../src/lib/cards");
  const rowsFor = (columns, rows) => strip(renderInstallBanner({ version: "1.2.3", color: true, env: TRUECOLOR, stream: { isTTY: true, columns, rows }, over: cardWidth(columns) })).split("\n");
  for (const columns of [40, 60, 80, 100, 160]) {
    const heights = [16, 30, 40, 60].map((rows) => rowsFor(columns, rows));
    assert.ok(heights.every((shown, i) => !i || shown.length >= heights[i - 1].length));
    assert.ok(heights[0].length <= 16 && heights[1].length <= 16, String(heights[1].length));
    for (const shown of heights) {
      const version = shown.at(-1);
      const centre = version.length - "lithermes v1.2.3".length / 2;
      assert.ok(Math.abs(centre - (1 + cardWidth(columns) / 2)) <= 1.5, `${columns}: ${centre}`);
      assert.ok(shown.every((row) => cells(row) <= columns));
    }
  }
  const stream = { isTTY: true, columns: 100, rows: 20 };
  assert.equal(renderInstallBanner({ env: TRUECOLOR, stream }), renderInstallBanner({ env: TRUECOLOR, stream: { ...stream, rows: 80 } }), "without cards the window's height changes nothing");
});

test("an ink names an accent's own colour", () => {
  assert.deepEqual(ink("#FF0066").rgb, [255, 0, 102]);
});

// ── the real installer on a pseudo-terminal ─────────────────────────────────

const bin = path.join(__dirname, "..", "bin", "lithermes.js");
const python = process.platform !== "win32" && spawnSync("python3", ["-c", "import pty"]).status === 0;
const runtimeStem = ["co", "dex"].join("");

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-cards-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text, mode) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text, { mode });
  };
  write("bin/hermes", "#!/bin/sh\necho 'Hermes Agent v0.19.0'\n", 0o700);
  write("repo/tools/delegate_tool.py", [
    "def _get_max_concurrent_children():", '    val = cfg.get("max_concurrent_children")', "    return max(1, int(val))",
    'configured_model = str(cfg.get("model") or "").strip() or None',
    'delegation_effort = str(delegation_cfg.get("reasoning_effort") or "").strip()', "effective_model = model or parent_agent.model",
  ].join("\n"));
  write("repo/hermes_cli/runtime_provider.py", `if provider == "openai-${runtimeStem}":\n    api_mode = "${runtimeStem}_responses"\n`);
  return root;
}

function onPty(root, steps, { env = {}, cols = 80, rows = 30, args = [] } = {}) {
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  const result = spawnSync("python3", [path.join(__dirname, "fixtures", "installer-pty.py"), process.execPath, bin, "install", "--offline",
    "--no-auto-update", "--hermes-home", path.join(home, ".hermes"), "--hermes-repo", path.join(root, "repo"), ...args], {
    input: JSON.stringify({ rows, cols, steps }),
    encoding: "utf8",
    env: {
      PATH: `${path.join(root, "bin")}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin`,
      HOME: home, XDG_CACHE_HOME: path.join(home, ".cache"), NO_UPDATE_NOTIFIER: "1", ...TRUECOLOR, ...env,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const run = JSON.parse(result.stdout);
  const config = path.join(home, ".hermes", "config.yaml");
  return { ...run, text: strip(run.output), config: fs.existsSync(config) ? fs.readFileSync(config, "utf8") : null };
}

const ROUTE = [1, 2, 3, 4, 5].map((n) => [`LIT ${n}/8`, ENTER]);

test("the real installer asks its eight questions as cards and writes what was picked", { skip: !python && "needs python3 pty" }, (t) => {
  const run = onPty(sandbox(t), [["LIT 1/8", `${DOWN}${ENTER}`], ...ROUTE.slice(1), ["LIT 6/8", `6${ENTER}`], ["LIT 7/8", `4${ENTER}`], ["LIT 8/8", "y"]]);
  assert.equal(run.status, 0, run.text.slice(-2000));
  assert.equal(run.typed, 8);
  assert.equal(run.cooked, true);
  assert.match(run.config, /provider: xai/);
  assert.match(run.config, /default: grok-build-0\.1/);
  assert.match(run.config, /skin: lithermes-rose/);
  assert.match(run.config, /outputStyle: eli5-ko/);
  assert.match(run.config, /bell_on_complete: true/);
  assert.match(run.text, /LIT {2}· LitHermes \d\S* is installed/);
  assert.match(run.text, /! Warning +XAI_API_KEY is not set/);
  assert.match(run.text, /Restart any running Hermes gateway/);
  assert.doesNotMatch(run.text, /Select 0-|Pick 0-4|Pick 1-10|INSTALL RECEIPT/);
});

test("Enter all the way writes what Enter wrote at the plain prompts", { skip: !python && "needs python3 pty" }, (t) => {
  const cards = onPty(sandbox(t), [...ROUTE, ["LIT 6/8", ENTER], ["LIT 7/8", ENTER], ["LIT 8/8", ENTER]], { env: { NO_COLOR: "1" } });
  const plain = onPty(sandbox(t), [
    ...Array(4).fill(["Select 0-", "\n"]), ["Enter to continue", "\n"], ["Pick 1-10", "\n"], ["Pick 0-4", "\n"], ["[y/N]", "\n"],
  ], { env: { TERM: "dumb" } });
  assert.equal(cards.status, 0, cards.text.slice(-2000));
  assert.equal(plain.status, 0, plain.text.slice(-2000));
  assert.doesNotMatch(plain.output, /\x1b|LIT 1\/8/);
  assert.equal(cards.config, plain.config);
});

test("before the review is confirmed Ctrl+C ends with SIGINT, Ctrl+D aborts, and nothing is written", { skip: !python && "needs python3 pty" }, (t) => {
  for (const at of [0, 4]) {
    const stopped = onPty(sandbox(t), [...ROUTE.slice(0, at), [`LIT ${at + 1}/8`, CTRL_C]]);
    assert.equal(stopped.status, 130, stopped.text.slice(-500));
    assert.equal(stopped.cooked, true);
    assert.equal(stopped.config, null);
    const left = onPty(sandbox(t), [...ROUTE.slice(0, at), [`LIT ${at + 1}/8`, CTRL_D]]);
    assert.equal(left.status, 0);
    assert.match(left.text, /Install aborted; nothing was written\./);
    assert.equal(left.config, null);
  }
});

test("Ctrl+C at the last question still shows what was installed", { skip: !python && "needs python3 pty" }, (t) => {
  const run = onPty(sandbox(t), [...ROUTE, ["LIT 6/8", CTRL_C], ["LIT 7/8", CTRL_C], ["LIT 8/8", CTRL_C]]);
  assert.equal(run.status, 130);
  assert.match(run.text, /· HUD accent +skipped[^]*· Output style +skipped[^]*✗ Finish bell +stopped[^]*LitHermes \d\S* is installed/);
  assert.doesNotMatch(run.config, /bell_on_complete|skin:|outputStyle/);
});

test("flags that answer a question take it off the count", { skip: !python && "needs python3 pty" }, (t) => {
  const run = onPty(sandbox(t), ROUTE.map(([text, keys]) => [text.replace("/8", "/5"), keys]), { args: ["--no-hud", "--style", "eli5", "--no-bell"], cols: 40, rows: 20 });
  assert.equal(run.status, 0, run.text.slice(-2000));
  assert.equal(run.typed, 5);
  assert.match(run.config, /outputStyle: eli5/);
});

test("a failed install stops the card in red, says why, and keeps the exit code", { skip: !python && "needs python3 pty" }, (t) => {
  const root = sandbox(t);
  const plugin = path.join(root, "home", ".hermes", "plugins", "lithermes");
  fs.mkdirSync(plugin, { recursive: true });
  fs.writeFileSync(path.join(plugin, "plugin.yaml"), "name: mine\n");
  const run = onPty(root, ROUTE);
  assert.equal(run.status, 5);
  assert.match(run.text, /✗ Inspecting existing plugin[^]*INSTALL STOPPED[^]*Stage +Inspecting existing plugin[^]*Reason +Existing LitHermes plugin[^]*No later install stages were run/);
  assert.equal(fs.readFileSync(path.join(plugin, "plugin.yaml"), "utf8"), "name: mine\n");
});
