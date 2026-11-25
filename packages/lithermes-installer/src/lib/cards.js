const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { colorMode, utf8Terminal } = require("./litMark");

// The installer's cards: a list to pick from, a yes/no, a review, install steps and the closing
// summary. They are for a person at a terminal; whatever cardTerminal() turns down keeps the plain
// prompts and receipt. A card is redrawn in place, never wider or taller than the window, and an
// answered one folds to a single line.
const MIN_COLS = 40;
const MIN_ROWS = 12;
const MAX_WIDTH = 100;
const LIST_ROWS = 14;
const SETTLE_MS = 30;
const DIGIT_MS = 1000;
const VALUE_AT = 24; // the column every value starts at: answers, steps, the closing card
const CAP_LEFT = "\ue0b6";
const CAP_RIGHT = "\ue0b4";

// The bright half of a 16-colour terminal, for an ink that names no slot of its own.
const BRIGHT = [[255, 85, 85], [85, 255, 85], [255, 255, 85], [85, 85, 255], [255, 85, 255], [85, 255, 255], [255, 255, 255]];
const distance = (a, b) => a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0);
function ink(hex, basic) {
  const rgb = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const near = BRIGHT.reduce((best, slot, i) => (distance(slot, rgb) < distance(BRIGHT[best], rgb) ? i : best), 0);
  return { rgb, basic: basic ?? 91 + near };
}
const PINK = ink("#ff2d95", 95);
const VIOLET = ink("#b48cff", 94);
const AMBER = ink("#ffd54f", 93); // the gold of this product's chrome mark
const ORANGE = ink("#ff8f3c", 93);
const NIGHT = ink("#0b0f14", 30);
const IVORY = ink("#f2efdf", 97);
const ROW = ink("#34205c", 35);
const GOOD = ink("#50e68c", 92);
const WARN = ink("#ffb02e", 93);
const BAD = ink("#ff5577", 91);

const PRETTY = Object.freeze({
  corners: "╭╮╰╯", across: "─", side: "│", at: "❯", done: "✓", stop: "✗", warn: "!", dot: "·", run: "▸",
  updown: "↑ ↓", leftright: "← →", more: ["↑", "↓"], box: "╭─╮│╰╯", held: "╔═╗║╚╝", swatch: "██",
});
const PLAIN = Object.freeze({
  corners: "++++", across: "-", side: "|", at: ">", done: "ok", stop: "x", warn: "!", dot: "-", run: ">",
  updown: "Up Down", leftright: "Left Right", more: ["^", "v"], box: "+-+|++", held: "#=####", swatch: "##",
});
const SPELLED = { "—": "-", "·": "-", "…": "...", "→": "->", "한국어": "Korean" };

const cardWidth = (cols) => Math.max(24, Math.min(cols - 2, MAX_WIDTH));

/** Cards need two terminals, raw mode, room, and nobody who asked for plain output. */
function cardTerminal({ input, output, env = process.env, flags = {} }) {
  if (flags.yes || flags["dry-run"] || flags.json || flags["no-spinner"]) return false;
  if (!input?.isTTY || !output?.isTTY || typeof input.setRawMode !== "function") return false;
  if ("CI" in env || /^dumb$/i.test(env.TERM || "")) return false;
  return (output.columns || 80) >= MIN_COLS && (output.rows || 24) >= MIN_ROWS;
}

function colorDepth(env, stream) {
  const mode = colorMode({ env, stream });
  return mode === "256" && /^(?:linux|ansi|cygwin|vt\d+|(?:xterm|screen|tmux|rxvt)(?:-(?:16)?color)?)$/i.test(env.TERM || "") ? "16" : mode;
}

const bare = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦\u{1f300}-\u{1faff}]/u;

function cells(text) {
  let total = 0;
  for (const ch of bare(text)) total += /\p{Mn}|‍|️/u.test(ch) ? 0 : WIDE.test(ch) ? 2 : 1;
  return total;
}

const atHome = (text) => String(text).split(`${os.homedir()}${path.sep}`).join(`~${path.sep}`);
const pad = (text, width) => text + " ".repeat(Math.max(0, width - cells(text)));

// A label that does not fit keeps both ends: model names differ at the front, their efforts at the back.
function clip(text, width, dots) {
  if (cells(text) <= width) return text;
  const tail = [...text].slice(-9).join("");
  let head = "";
  for (const ch of text) {
    if (cells(head + ch + dots + tail) > width) break;
    head += ch;
  }
  return head + dots + tail;
}

/** Word wrap by terminal cells. A word longer than a line, such as a path, continues on the next one. */
function wrap(text, width) {
  const rows = [""];
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    const last = rows[rows.length - 1];
    if (last && cells(last) + 1 + cells(word) <= width) {
      rows[rows.length - 1] = `${last} ${word}`;
      continue;
    }
    if (last) rows.push("");
    while (cells(word) > width) {
      let head = "";
      for (const ch of word) {
        if (cells(head + ch) > width) break;
        head += ch;
      }
      rows[rows.length - 1] = head;
      rows.push("");
      word = word.slice(head.length);
    }
    rows[rows.length - 1] = word;
  }
  return rows;
}

const CUBE = [0, 95, 135, 175, 215, 255];
const cubeStep = (value) => CUBE.reduce((best, level, i) => (Math.abs(level - value) < Math.abs(CUBE[best] - value) ? i : best), 0);

function between(stops, t) {
  const along = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(along));
  return {
    rgb: stops[i].rgb.map((value, k) => Math.round(value + (stops[i + 1].rgb[k] - value) * (along - i))),
    basic: stops[Math.round(along)].basic,
  };
}

function code(color, layer, depth) {
  if (depth === "16") return String(color.basic + (layer === 48 ? 10 : 0));
  if (depth === "truecolor") return `${layer};2;${color.rgb.join(";")}`;
  const [r, g, b] = color.rgb.map(cubeStep);
  return `${layer};5;${16 + 36 * r + 6 * g + b}`;
}

/**
 * `total` is how many questions this run will ask, for the step pill. `proc` and `settleMs` exist
 * for tests. A question returns null when the input ends (Ctrl+D, a closed terminal), as the plain
 * prompts do; Ctrl+C interrupts the process unless the question says it only skips. `caps` asks for
 * the round form, decided once for the run; without truecolor or UTF-8 every card is square.
 */
function createCards({ input, output, env = process.env, total = 1, caps = false, proc = process, settleMs = SETTLE_MS, now = Date.now }) {
  const depth = colorDepth(env, output);
  const ascii = !utf8Terminal(env);
  const round = caps && depth === "truecolor" && !ascii;
  const g = ascii ? PLAIN : PRETTY;
  let edge = AMBER;
  let asked = 0;
  let beforeStop = () => {};

  // ── paint ────────────────────────────────────────────────────────────────
  const say = (text) => (ascii ? String(text).replace(/[—·…→]|한국어/g, (found) => SPELLED[found]) : String(text));
  function style(text, { fg, bg, bold, dim } = {}) {
    const codes = [bold && "1", dim && "2", fg && code(fg, 38, depth), bg && code(bg, 48, depth)].filter(Boolean);
    return depth === "none" || !text || !codes.length ? text : `\x1b[${codes.join(";")}m${text}\x1b[0m`;
  }
  const bold = (text) => style(say(text), { bold: true });
  const quiet = (text) => style(say(text), { dim: true });
  // A gradient over `span` cells, of which `text` starts at `from`; equal neighbours share one escape.
  function shade(text, stops, look, from = 0, span = cells(text)) {
    if (depth === "none") return text;
    let out = "";
    let run = "";
    let step = null;
    const flush = () => { out += run ? style(run, look(between(stops, step / 24))) : ""; run = ""; };
    [...text].forEach((ch, i) => {
      const here = Math.round(((from + i) / Math.max(1, span - 1)) * 24);
      if (here !== step) flush();
      step = here;
      run += ch;
    });
    flush();
    return out;
  }
  const onPaper = (stops) => (text) => shade(text, stops, (bg) => ({ fg: NIGHT, bg, bold: true }));
  // Text on a filled gradient; the round caps stand where the square form has its padding.
  const filled = (text, stops) => (round
    ? style(CAP_LEFT, { fg: stops[0] }) + onPaper(stops)(text) + style(CAP_RIGHT, { fg: stops[stops.length - 1] })
    : onPaper(stops)(` ${text} `));
  const pill = (text) => (depth === "none" ? `[${text}]` : filled(text, [ORANGE, PINK]));

  // ── layout ───────────────────────────────────────────────────────────────
  const cols = () => output.columns || 80;
  const lines = () => output.rows || 24;
  const width = () => cardWidth(cols());
  const inner = () => width() - 4;

  function frame(tag, title, body, stops = [PINK, VIOLET, edge]) {
    const wide = width();
    const [tl, tr, bl, br] = g.corners;
    const line = (text, from) => shade(text, stops, (fg) => ({ fg }), from, wide);
    const badge = pill(tag);
    const inEdge = cells(badge) + cells(say(title)) + 9 <= wide;
    const named = ` ${badge} ${inEdge ? `${quiet(g.dot)} ${bold(title)} ` : ""}`;
    const used = 2 + cells(named);
    const rows = [...(inEdge ? [] : wrap(say(title), inner()).map(bold)), ...body];
    return [
      line(tl + g.across, 0) + named + line(g.across.repeat(wide - used - 1) + tr, used),
      ...rows.map((row) => `${line(g.side, 0)} ${pad(row, wide - 4)} ${line(g.side, wide - 1)}`),
      line(bl + g.across.repeat(wide - 2) + br, 0),
    ].map((row) => ` ${row}`);
  }

  // Sections of rows, with air between and around them while the window has room for it.
  function spaced(tag, title, sections, stops) {
    const groups = sections.filter((rows) => rows.length);
    const join = (gap) => groups.flatMap((rows, i) => (i && gap ? ["", ...rows] : rows));
    const layouts = [
      () => ["", ...frame(tag, title, ["", ...join(true)], stops)],
      () => frame(tag, title, ["", ...join(true)], stops),
      () => frame(tag, title, join(false), stops),
    ];
    for (const layout of layouts) {
      const rows = layout();
      if (rows.length < lines()) return rows;
    }
    return layouts[2]();
  }

  // Key hints, as many on a row as fit; one hint is never split.
  function hints(parts) {
    const rows = [];
    for (const part of parts) {
      const joined = rows.length ? `${rows[rows.length - 1]}   ${part}` : part;
      if (rows.length && cells(joined) <= inner()) rows[rows.length - 1] = joined;
      else rows.push(part);
    }
    return rows.map(quiet);
  }

  function folded(mark, color, title, value) {
    const lead = ` ${style(mark, { fg: color, bold: true })} `;
    const name = `${pad(say(title), VALUE_AT - cells(lead) - 1)} `;
    if (cells(lead + name + say(value)) < cols()) return lead + name + bold(value);
    const room = cols() - cells(lead) - 1;
    const rows = cells(`${title} ${say(value)}`) <= room ? [`${say(title)} ${bold(value)}`] : [say(title), ...wrap(say(value), room).map(bold)];
    return rows.map((row, i) => (i ? " ".repeat(cells(lead)) : lead) + row).join("\r\n");
  }

  // ── drawing in place ─────────────────────────────────────────────────────
  let shown = [];
  const up = (count) => (count > 0 ? `\x1b[${count}A` : "");
  function draw(rows) {
    const next = rows.slice(-Math.max(1, lines() - 1));
    const same = next.length === shown.length;
    let out = up(shown.length) + (same ? "" : "\r\x1b[J");
    next.forEach((row, i) => { out += same && shown[i] === row ? "\r\n" : `\r${row}\x1b[K\r\n`; });
    shown = next;
    output.write(out);
  }
  // After a resize the old rows may wrap: clear what they take up now, then draw again.
  function redraw(rows) {
    const taken = shown.reduce((sum, row) => sum + Math.max(1, Math.ceil(cells(row) / cols())), 0);
    output.write(`${up(Math.min(taken, lines() - 1))}\r\x1b[J`);
    shown = [];
    draw(rows);
  }
  // The first folded row keeps the blank row its card stood under; the rest follow without one.
  let folds = 0;
  function replace(row) {
    output.write(`${up(shown.length)}\r\x1b[J${folds++ ? "" : "\r\n"}${row}\r\n`);
    shown = [];
  }

  // ── the terminal's own state ─────────────────────────────────────────────
  let raw = false;
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const takeKeys = () => { raw = true; input.setRawMode(true); output.write("\x1b[?25l"); };
  const giveKeys = () => {
    if (!raw) return;
    raw = false;
    output.write("\x1b[?25h");
    input.setRawMode(false);
  };
  function release() {
    giveKeys();
    input.pause();
    proc.removeListener("exit", giveKeys);
    for (const name of signals) proc.removeListener(name, onSignal);
  }
  function onSignal(name) {
    release();
    proc.kill(proc.pid, name);
  }
  // Raw mode keeps the terminal from sending the signal itself, so it goes to the whole job, as the
  // terminal would have sent it: a launcher such as npx has to stop too.
  const signalJob = (name) => proc.kill(proc.platform === "win32" ? proc.pid : 0, name);
  function acquire() {
    takeKeys();
    input.resume();
    proc.on("exit", giveKeys);
    for (const name of signals) proc.on(name, onSignal);
  }

  // What was typed before a card came up was not an answer to it; only Ctrl+C counts.
  function settle() {
    return new Promise((resolve) => {
      let stopped = false;
      const onData = (chunk) => { stopped = stopped || String(chunk).includes("\x03"); };
      input.on("data", onData);
      setTimeout(() => { input.removeListener("data", onData); resolve(stopped); }, settleMs);
    });
  }

  // Draws view() and feeds it keys until key() returns { value }; folds to fold(value), or to `left`
  // when the question is skipped or the input ends.
  async function ask({ title, view, key, fold, left = "skipped", ctrlCSkips = false }) {
    acquire();
    const off = [];
    const listen = (target, event, handler) => { target.on(event, handler); off.push(() => target.removeListener(event, handler)); };
    try {
      const outcome = await new Promise((settled, reject) => {
        let answered = false;
        const resolve = (result) => { answered = true; settled(result); };
        const interrupt = () => resolve(ctrlCSkips ? { value: null } : { stop: true });
        const onKey = (text, pressed = {}) => {
          if (answered) return undefined;
          if (pressed.ctrl && pressed.name === "c") return interrupt();
          if (pressed.ctrl && pressed.name === "d") return resolve({ value: null });
          if (pressed.ctrl && pressed.name === "z" && proc.platform !== "win32") return suspend();
          if (pressed.ctrl || pressed.meta) return undefined;
          const answer = key({ text, name: pressed.name, enter: pressed.name === "return" || pressed.name === "enter" });
          if (answer) return resolve(answer);
          return draw(view());
        };
        const suspend = () => {
          const resume = () => { takeKeys(); shown = []; draw(view()); };
          giveKeys();
          proc.once("SIGCONT", resume);
          off.push(() => proc.removeListener("SIGCONT", resume));
          signalJob("SIGTSTP");
        };
        settle().then((stopped) => {
          if (stopped) return interrupt();
          readline.emitKeypressEvents(input);
          listen(input, "keypress", onKey);
          listen(input, "end", () => resolve({ value: null }));
          listen(output, "resize", () => redraw(view()));
          return draw(view());
        }).catch(reject);
      });
      for (const undo of off) undo();
      if (outcome.stop) {
        replace(folded(g.stop, BAD, title, "stopped"));
        release();
        beforeStop();
        proc.exitCode = 130;
        signalJob("SIGINT");
        return await new Promise(() => {}); // the signal ends the process
      }
      replace(outcome.value === null ? folded(g.dot, VIOLET, title, left) : folded(g.done, GOOD, title, fold(outcome.value)));
      return outcome.value;
    } finally {
      for (const undo of off) undo();
      release();
    }
  }

  const nextTag = () => `LIT ${asked += 1}/${total}`;
  const stopHint = (ctrlCSkips) => `Ctrl+C ${ctrlCSkips ? "skip" : "stop"}`;

  /**
   * One choice from a list, numbered as the plain prompt numbers it. `choices` are { label, detail,
   * color }; returns the index. `follow` lends the card's border the highlighted choice's colour.
   */
  async function pick({ title, note, choices, start = 0, first = 0, ctrlCSkips = false, follow = false }) {
    const tag = nextTag();
    const keys = choices.map((choice, i) => String(i + first));
    const home = edge;
    let at = start;
    let typed = { text: "", when: -Infinity };
    const paint = () => { if (follow) edge = choices[at].color || home; };
    let page = LIST_ROWS;

    function view() {
      const room = inner() - 2; // a gutter on either side, where the lit row has its caps
      const keyWidth = Math.max(...keys.map(cells));
      const swatch = ({ color }) => (depth === "none" || !choices.some((choice) => choice.color) ? ""
        : `${color ? style(round ? CAP_LEFT + CAP_RIGHT : g.swatch, { fg: color }) : " ".repeat(g.swatch.length)} `);
      const lead = 2 + keyWidth + 1;
      const labelRoom = room - lead - cells(swatch(choices[0])) - 3;
      const clipped = choices.some(({ label }) => cells(say(label)) > labelRoom);
      const labels = choices.map((choice) => swatch(choice) + clip(say(choice.label), labelRoom, say("…")));
      const labelWidth = Math.max(...labels.map(cells));
      const detailWidth = Math.max(0, ...choices.map(({ detail = "" }) => cells(say(detail))));
      const plainMark = depth === "none" ? "(default)" : "default";
      const markText = lead + labelWidth + 2 + plainMark.length <= room ? plainMark : "*";
      const inline = !clipped && lead + labelWidth + 2 + detailWidth + 2 + markText.length <= room;
      const rows = choices.map((choice, i) => {
        const on = i === at;
        const detail = !inline || !detailWidth ? "" : `  ${pad(on ? say(choice.detail || "") : quiet(choice.detail || ""), detailWidth)}`;
        const mark = i === start ? `  ${style(markText, on ? { bold: true } : { fg: PINK, bold: true })}` : "";
        const row = `${on ? g.at : " "} ${keys[i].padStart(keyWidth)} ${pad(labels[i], labelWidth)}${detail}${mark}`;
        if (!on || depth === "none") return ` ${row}`;
        const bar = `\x1b[${code(IVORY, 38, depth)};${code(ROW, 48, depth)}m`;
        const lit = `${bar}${pad(row, room).replace(/\x1b\[0m/g, `\x1b[0m${bar}`)}`;
        return round
          ? `${style(CAP_LEFT, { fg: ROW })}${lit}\x1b[0m${style(CAP_RIGHT, { fg: ROW })}`
          : `${bar} ${lit} \x1b[0m`;
      });
      const noteRows = wrap(say(note), inner());
      // Where a detail has no room beside its row, the highlighted one is spelled out under the list.
      const under = inline ? [] : choices.map(({ label, detail = "" }) => {
        const text = clipped ? `${label} ${detail}` : detail;
        return text ? wrap(say(text), inner()) : [];
      });
      const underHeight = Math.max(0, ...under.map((rowsOf) => rowsOf.length));
      const detailRows = inline || !underHeight ? [] : [...under[at], ...Array(underHeight - under[at].length).fill("")].map(quiet);
      const tail = (count) => hints([
        ...(count < rows.length ? [`${at + 1}/${rows.length} ${g.more[0]}${g.more[1]}`] : [`${g.updown} move`]),
        `${keys[0]}-${keys[keys.length - 1]} jump`, "Enter choose", stopHint(ctrlCSkips),
      ]);
      const fixed = frame(tag, title, [...noteRows, ...detailRows, ...tail(0)]).length;
      const count = Math.max(1, Math.min(rows.length, LIST_ROWS, lines() - 1 - fixed));
      page = count;
      const top = Math.max(0, Math.min(at - Math.floor(count / 2), rows.length - count));
      return spaced(tag, title, [noteRows, rows.slice(top, top + count), detailRows, tail(count)]);
    }

    function jump(digit) {
      const joined = typed.text + digit;
      const text = now() - typed.when < DIGIT_MS && keys.includes(joined) ? joined : digit;
      typed = { text, when: now() };
      const found = keys.indexOf(text);
      if (found >= 0) at = found;
    }

    paint();
    const index = await ask({
      title,
      view,
      ctrlCSkips,
      fold: (value) => choices[value].folded || choices[value].label,
      key({ text, name, enter }) {
        const last = choices.length - 1;
        if (enter) return { value: at };
        if (name === "up" || name === "k") at = at ? at - 1 : last;
        else if (name === "down" || name === "j") at = at < last ? at + 1 : 0;
        else if (name === "pageup") at = Math.max(0, at - page);
        else if (name === "pagedown") at = Math.min(last, at + page);
        else if (name === "home") at = 0;
        else if (name === "end") at = last;
        else if (/^\d$/.test(text || "")) jump(text);
        paint();
        return null;
      },
    });
    if (index === null) edge = home;
    return index;
  }

  // One button of three rows, or of one. The lit one is a filled chip in a gradient outline.
  function button(label, on, tall) {
    const size = cells(label) + 4;
    const chip = on && depth !== "none" ? filled(label, [PINK, VIOLET]) : ` ${label} `;
    if (!tall) return [on && depth === "none" ? `[${label}]` : on ? chip : quiet(chip)];
    const [tl, across, tr, side, bl, br] = on && (depth === "none" || ascii) ? g.held : g.box;
    const outline = [tl + across.repeat(size) + tr, side, bl + across.repeat(size) + br];
    const trim = (text, from = 0) => (!on ? quiet(text) : depth === "none" ? bold(text) : shade(text, [PINK, VIOLET], (fg) => ({ fg }), from, size + 2));
    return [trim(outline[0]), `${trim(side)} ${chip} ${trim(side, size + 1)}`, trim(outline[2])];
  }
  const compact = () => inner() < 44;
  const faceOf = (word, on) => pad(`${on ? g.at : " "} ${word}`, compact() ? 13 : 15);

  /** Yes or no on two buttons. `start` is the default, and says so on its button and in the title. */
  async function confirm({ title, note, start = false }) {
    const tag = nextTag();
    let yes = start;

    function buttons(tall) {
      const faces = [[true, "Yes"], [false, "No"]].map(([value, word]) => {
        const marked = value === start ? (compact() ? " default" : " (default)") : "";
        return button(faceOf(`${word}${marked}`, value === yes), value === yes, tall);
      });
      return faces[0].map((left, i) => `${left}  ${faces[1][i]}`);
    }

    function view() {
      const name = `${title} ${start ? "[Y/n]" : "[y/N]"}`;
      const noteRows = wrap(say(note), inner());
      const hintRows = hints(["y / n answer", `${g.leftright} switch`, `Enter = ${yes ? "Yes" : "No"}`, stopHint(false)]);
      const tall = buttons(true);
      const roomy = spaced(tag, name, [noteRows, tall, hintRows]);
      return cells(tall[0]) <= inner() && roomy.length < lines() ? roomy : spaced(tag, name, [noteRows, buttons(false), hintRows]);
    }

    return ask({
      title,
      view,
      fold: (value) => (value ? "yes" : "no"),
      key({ text, name, enter }) {
        if (enter) return { value: yes };
        if (/^[yn]$/i.test(text || "")) return { value: /y/i.test(text) };
        if (["left", "right", "tab"].includes(name)) yes = !yes;
        return null;
      },
    });
  }

  // Rows of { label, value, tone }: tone "good", "warn", "bad" or "note". A value wraps, it is never
  // cut; a long label pushes its own value right.
  function table(rows) {
    const room = inner();
    const marks = { good: [g.done, GOOD], warn: [g.warn, WARN], bad: [g.stop, BAD], note: [g.dot, VIOLET] };
    const gutter = cells(g.done) + 1;
    const stacked = room < 56;
    return rows.flatMap(({ label, value, tone = "note" }) => {
      const [sign, color] = marks[tone];
      const loud = tone === "warn" || tone === "bad" ? (row) => style(row, { bold: true }) : (row) => row;
      const lead = label ? pad(style(sign, { fg: color, bold: true }), gutter) : " ".repeat(gutter);
      const at = stacked ? gutter : Math.max(VALUE_AT - 3, gutter + cells(say(label)) + 1);
      const text = wrap(say(atHome(value)), room - at).map(loud);
      if (stacked) return [...(label ? [lead + bold(label)] : []), ...text.map((row) => " ".repeat(gutter) + row)];
      return text.map((row, i) => (i ? " ".repeat(at) + row : pad(lead + bold(label), at) + row));
    });
  }

  /** A last look before anything is written; only Enter goes on. Returns true, or null on Ctrl+D. */
  function review({ title, note, rows, word, stopNote }) {
    const tag = nextTag();
    const hintRows = () => hints([`Enter = ${word}`, `Ctrl+C stop, ${stopNote}`]);
    const go = (tall) => button(faceOf(word, true), true, tall);
    const layout = (tall, shownRows) => spaced(tag, title, [wrap(say(note), inner()), shownRows, go(tall), hintRows()]);
    const fits = () => layout(false, table(rows)).length < lines();
    // Every row has to be readable before the answer: what a short window cannot hold is printed above the card.
    const above = !fits();
    if (above) output.write(`\n${frame("LIT", title, table(rows)).join("\n")}\n`);
    return ask({
      title,
      left: "not confirmed",
      fold: () => "confirmed",
      key: ({ enter }) => (enter ? { value: true } : null),
      view() {
        const shownRows = above ? [] : table(rows);
        const roomy = layout(true, shownRows);
        return cells(go(true)[0]) <= inner() && roomy.length < lines() ? roomy : layout(false, shownRows);
      },
    });
  }

  /**
   * Install steps on one card; `about(name)` is the step's own text, shown where every row has room.
   * The work is synchronous, so the cursor and Ctrl+C stay the terminal's.
   */
  function steps({ title, names: known, about = () => "" }) {
    const names = [...known];
    let at = -1;
    let failed = false;
    const view = () => {
      const gutter = cells(g.done) + 1;
      const nameWidth = Math.max(VALUE_AT - 3 - gutter, Math.max(...names.map(cells)) + 2);
      const rows = names.map((name, i) => {
        const [sign, color] = i < at ? [g.done, GOOD] : i > at ? [g.dot, VIOLET] : failed ? [g.stop, BAD] : [g.run, edge];
        const mark = pad(style(sign, { fg: color, bold: i <= at }), gutter);
        const text = say(about(name));
        const beside = text && gutter + nameWidth + cells(text) <= inner() ? quiet(text) : "";
        return mark + (beside ? pad(i > at ? quiet(name) : bold(name), nameWidth) + beside : i > at ? quiet(name) : bold(name));
      });
      return ["", ...frame("LIT", title, ["", ...rows], failed ? [BAD, BAD] : undefined)].slice(0, lines() - 1);
    };
    draw(view());
    return {
      reach(name) {
        if (!names.includes(name)) names.push(name);
        at = names.indexOf(name);
        draw(view());
      },
      stage: () => names[at] || "",
      finish: () => replace(folded(g.done, GOOD, "Install steps", `${names.length} of ${names.length} checked`)),
      fail() { failed = true; draw(view()); shown = []; },
    };
  }

  /** The closing card: sections of { head, rows }. */
  function summary({ title, sections, bad = false }) {
    const full = sections.filter(({ rows }) => rows.length);
    const body = full.flatMap(({ head, rows }) => ["", style(head, { fg: PINK, bold: true }), ...table(rows)]);
    output.write(`\n${frame("LIT", title, body, bad ? [BAD, BAD] : undefined).join("\n")}\n`);
  }

  // The extensions notice, with its prose wrapped to this window; a command line stays in one piece to copy.
  function notice(text) {
    const rows = [];
    let prose = [];
    const flush = () => {
      if (prose.length) rows.push(...wrap(say(prose.join(" ")), width() - 2).map((row) => `   ${row}`));
      prose = [];
    };
    for (const line of text.split("\n").filter(Boolean)) {
      if (/^ {2}\S/.test(line)) prose.push(line.trim());
      else {
        flush();
        rows.push(/^\s/.test(line) ? ` ${line}` : ` ${bold(line)}`);
      }
    }
    flush();
    output.write(`\n${rows.join("\n")}\n`);
  }

  return {
    pick, confirm, review, steps, summary,
    note: (text) => output.write(`\n${wrap(say(atHome(text)), width()).map((row) => ` ${quiet(row)}`).join("\n")}\n`),
    notice,
    onStop: (action) => { beforeStop = action; },
  };
}

module.exports = { cardTerminal, cardWidth, cells, createCards, ink, wrap };
