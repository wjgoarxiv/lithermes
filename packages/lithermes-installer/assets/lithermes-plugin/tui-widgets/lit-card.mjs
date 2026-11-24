// LitHermes goal card for the Hermes Ink TUI (`hermes --tui`).
//
// The installer copies this file to <Hermes home>/tui-widgets/, where Hermes loads it. It shows the
// lit goal of the session this TUI is on: the stage map, the goal, the proof and the next step, with
// a half-sunk sun over a sea in the cells no text uses. It draws nothing (zero rows) until that
// session has a goal, and it never invents state: every word comes from the small file the LitHermes
// plugin writes at the start and end of a turn and when the goal's own files change (tui_card.py).
//
// While a turn runs the scene moves on one 250 ms timer (the host's floor for widgets). At rest there
// is no timer and the same picture stands still. Two file watches, not polling, bring new state in.
// The scene is drawn on a truecolor terminal with a dark background only; elsewhere the card is plain
// text in a plain frame. `lithermes hud card still` holds it still, `lithermes hud card off` removes it.

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const FRAME_MS = 250;
export const MIN_COLS = 48;
export const MIN_ROWS = 20;
export const MAX_WIDTH = 100;
export const SUN_W = 18;
const IDLE_HIDE_MS = 30 * 60 * 1000; // A card nobody came back to leaves the dock.
const WORK_STALE_MS = 30 * 60 * 1000; // A turn that stopped reporting no longer counts as working.
const MAX_BYTES = 16 * 1024;
const TEXT_MAX = 58;
const KEY = Symbol.for("lithermes.tui-card");

const FAINT = "#30363d";
const DIM = "#8b949e";
const WHITE = "#e6edf3";
const INK = "#0b0f14";
const ACCENT = "#5fd7ff";
const VIOLET = "#b48cff";
const PINK = "#ff2d95";
const TONES = { ok: "#6bdb8f", warn: "#ffaf3c", bad: "#ff5f5f", dim: DIM };
const BRAND = ["#ffa033", "#ff6a55", "#ff3388"];
const SEA = ["#ffdc73", "#ff9a4a", "#ff4f8b", "#b457d6", "#5a46a8"];
const SUN_INK = [["#ffd24a", "#fff0a0"], ["#ff8f3c", "#ffc15a"], ["#ff2d8a", "#ff6b8f"]];
const SUN_DARK = "#1a1030";
const STARS = [[0, -30], [1, -24], [0, -18], [1, -13], [0, -9], [1, -5], [0, 22], [1, 25], [0, 29], [1, 32], [0, 35]];
const STAGE_KEYS = ["plan", "runs", "review", "gate", "handoff"];

// --- text -------------------------------------------------------------------------------------

const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;
export const textWidth = (text) => [...text].reduce((sum, ch) => sum + (WIDE.test(ch) ? 2 : 1), 0);

// Stored text as one plain line: no control, format or combining characters (they have no width of
// their own) and no emoji, whose width terminals disagree on.
export const plainText = (value) => String(value ?? "").normalize("NFC")
  .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\p{M}\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, " ")
  .replace(/\s+/gu, " ").trim();

const clip = (text, cells) => {
  if (textWidth(text) <= cells) return text;
  let out = "";
  for (const ch of text) {
    if (textWidth(out + ch) > cells - 1) break;
    out += ch;
  }
  return `${out}…`;
};

// --- colour -----------------------------------------------------------------------------------

const rgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const brightness = (hex) => rgb(hex).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
const lerp = (a, b, k) => `#${rgb(a).map((from, i) => Math.round(from + (rgb(b)[i] - from) * k).toString(16).padStart(2, "0")).join("")}`;
// Eight steps between two colours, mixed once and kept: a frame mixes nothing twice and equal neighbours merge.
const mixes = new Map();
const mix = (a, b, k) => {
  const step = Math.max(0, Math.min(8, Math.round(k * 8)));
  const key = a + b + step;
  if (!mixes.has(key)) {
    if (mixes.size > 2000) mixes.clear();
    mixes.set(key, lerp(a, b, step / 8));
  }
  return mixes.get(key);
};
const ramp = (stops, k) => {
  const at = Math.min(stops.length - 1.001, Math.max(0, k) * (stops.length - 1));
  return mix(stops[Math.floor(at)], stops[Math.floor(at) + 1], at % 1);
};

// --- the scene --------------------------------------------------------------------------------

// The dome in eighth-blocks, a thin dark slit over the second row and a thicker one over the third.
const SUN_CELLS = [0, 1, 2].map((r) => Array.from({ length: SUN_W }, (_, x) => {
  const d = (x - (SUN_W - 1) / 2) / (SUN_W / 2);
  const fill = Math.max(0, Math.min(8, Math.round(Math.sqrt(1 - d * d) * 24) - (2 - r) * 8));
  if (fill === 0) return null;
  if (fill < 8) return { ch: "▁▂▃▄▅▆▇"[fill - 1] };
  return r === 0 ? { ch: "█" } : { ch: r === 1 ? "▇" : "▆", bg: SUN_DARK };
}));

const seaCell = (dx, s) => {
  const far = Math.abs(dx);
  const wave = Math.sin(far * 0.62 - s * 2.3) + 0.8 * Math.sin(dx * 0.31 + s * 1.1) + 0.6 * Math.sin(dx * 1.37 - s * 0.7);
  const level = wave * 0.62 + 1.05 - far / 34;
  if (level < 0.22) return null;
  return {
    ch: level > 1.0 ? "~" : level > 0.55 ? "-" : ".",
    fg: mix(FAINT, ramp(SEA, far / 52), Math.min(1, 0.18 + level * 0.55)),
    ...(level > 1.5 ? { bold: true } : {}),
  };
};

// One entry per cell; a wide character's second cell is null.
const toCells = (spans) => spans.flatMap(({ text, ...style }) => [...text].flatMap((ch) => (
  textWidth(ch) === 2 ? [{ ...style, ch }, null] : [{ ...style, ch }])));
const toSpans = (cells) => cells.filter(Boolean).reduce((out, { ch, fg, bg, bold }) => {
  const last = out.at(-1);
  // A space shows no ink, so it joins whatever stands before it on the same fill.
  if (last && last.bg === bg && (ch === " " || (last.fg === fg && Boolean(last.bold) === Boolean(bold)))) last.text += ch;
  else out.push({ text: ch, fg, bg, bold });
  return out;
}, []);

const free = (cell) => Boolean(cell) && cell.ch === " " && !cell.bg;
const clear = (grid, x, reach) => {
  for (let n = -reach; n <= reach; n += 1) if (grid[x + n] !== undefined && !free(grid[x + n])) return false;
  return true;
};

// Paints three rows of cells in place; `at` is the sun's first column and `t` the seconds the motion
// has run (null at rest). Returns whether the sun found room: without it nothing is painted.
export const paintScene = (grids, at, t) => {
  const s = t ?? 0;
  const roomy = at >= 2 && grids.every((grid) => grid.length >= at + SUN_W + 2 && grid.slice(at - 2, at + SUN_W + 2).every(free));
  if (!roomy) return false;
  const text = grids.map((grid) => [...grid]);
  for (const [r, dx] of STARS) {
    const x = at + dx;
    if (x < 0 || x >= grids[r].length || !clear(text[r], x, 3)) continue;
    const twinkle = 0.5 + 0.5 * Math.sin(s * 1.7 + dx * 2.1);
    grids[r][x] = { ch: twinkle > 0.85 ? "*" : twinkle > 0.45 ? "+" : ".", fg: mix(FAINT, dx % 2 ? "#a99bff" : "#ff9ad5", 0.35 + 0.65 * twinkle) };
  }
  const dash = t === null ? 9 : s % 9;
  if (dash < 1.1) {
    const head = Math.round(at + SUN_W + 22 - (dash / 1.1) * 34);
    ["*", "-", "-", "."].forEach((ch, i) => {
      const x = head + i;
      if (x >= 0 && x < grids[0].length && clear(text[0], x, 3)) grids[0][x] = { ch, fg: mix("#fff4e0", "#b457d6", i / 3), bold: i === 0 };
    });
  }
  const mid = at + SUN_W / 2 - 0.5;
  for (let x = 0; x < grids[2].length; x += 1) {
    const cell = clear(text[2], x, 3) ? seaCell(x - mid, s) : null;
    if (cell) grids[2][x] = cell;
  }
  SUN_CELLS.forEach((line, r) => line.forEach((cell, x) => {
    if (!cell) return;
    const heat = t === null ? 0.25 : 0.5 + 0.5 * Math.sin(s * 2.1 + r * 1.5 + 0.55 * Math.sin(x * 0.8 + s * 1.6));
    grids[r][at + x] = { ...cell, fg: mix(SUN_INK[r][0], SUN_INK[r][1], heat) };
  }));
  return true;
};

// --- the card ---------------------------------------------------------------------------------

const clock = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
const pill = (text, stops, caps) => {
  const chars = [...text];
  const at = (i) => ramp(stops, chars.length < 2 ? 0 : i / (chars.length - 1));
  const body = chars.map((ch, i) => ({ text: ch, fg: INK, bg: at(i), bold: true }));
  return caps
    ? [{ text: "", fg: at(0) }, ...body, { text: "", fg: at(chars.length - 1) }]
    : [{ text: " ", bg: at(0) }, ...body, { text: " ", bg: at(chars.length - 1) }];
};

// The stage map keeps as many stages as fit, always with the current one.
const mapRow = (model, width, rich, caps) => {
  const now = model.stages.findIndex((stage) => stage.state === "active");
  const draw = (stages, rail) => stages.flatMap((stage, i) => {
    const join = i === 0 ? [] : [{ text: rail ? (stage.state === "todo" ? " ── " : " ━━ ") : " ", fg: rich ? "#46505c" : undefined }];
    if (stage.state === "active") return [...join, ...(rich ? pill(stage.key, [VIOLET, ACCENT], caps) : [{ text: `[${stage.key}]`, bold: true }])];
    if (stage.state === "done") return [...join, { text: `${stage.key} ✓`, fg: rich ? mix("#ff6337", PINK, i / 5) : undefined }];
    return [...join, { text: `${stage.key} ·`, fg: rich ? DIM : undefined }];
  });
  const size = (spans) => spans.reduce((sum, part) => sum + textWidth(part.text), 0);
  for (const row of [draw(model.stages, true), draw(model.stages, false), draw(model.stages.filter((_, i) => i === now), false)]) {
    if (size(row) <= width) return row;
  }
  return [];
};

const proofRow = (model, rich, caps) => {
  const label = { text: "proof ", fg: rich ? DIM : undefined };
  const count = { text: `${model.passed}/${model.total} criteria`, fg: rich ? (model.total > 0 && model.passed === model.total ? TONES.ok : WHITE) : undefined };
  const lit = model.total > 0 ? Math.round((model.passed / model.total) * 8) : 0;
  const tone = (i) => (i < lit ? mix(VIOLET, ACCENT, i / 7) : "#2a2340");
  const bar = !rich
    ? [{ text: `${"#".repeat(lit)}${"-".repeat(8 - lit)}` }]
    : Array.from({ length: 8 }, (_, i) => (caps && (i === 0 || i === 7)
      ? { text: i === 0 ? "" : "", fg: tone(i) }
      : { text: " ", bg: tone(i) }));
  const runs = model.runs.length === 0
    ? [{ text: " · no signed runs yet", fg: rich ? DIM : undefined }]
    : model.runs.map((run) => ({ text: ` ${run.text}`, fg: rich ? TONES[run.tone] : undefined }));
  return [label, ...bar, { text: " " }, count, ...runs];
};

const fit = (spans, width) => {
  const cells = toCells(spans);
  if (cells.length > width) {
    cells.length = width;
    if (cells.at(-1) && textWidth(cells.at(-1).ch) === 2) cells[width - 1] = { ch: " " };
  }
  while (cells.length < width) cells.push({ ch: " " });
  return cells;
};

// Six rows of spans, each exactly `width` cells. `t` is the motion's seconds or null at rest, `now`
// the clock the running time is read from.
export const cardRows = (model, { width, t = null, now = Date.now(), rich = true, caps = false }) => {
  const inner = width - 4;
  const working = model.working;
  // Without the timer a clock would stand at a false time, so it is left out.
  const running = t !== null && model.since ? `${clock(now - model.since)}` : "";
  const map = mapRow(model, inner - (running ? running.length + 2 : 0), rich, caps);
  const mapCells = fit(map, inner);
  [...running].forEach((ch, i) => { mapCells[inner - running.length + i] = { ch, fg: rich ? DIM : undefined }; });
  const reach = Math.min(TEXT_MAX, inner);
  const line = (label, text) => fit([{ text: label, fg: rich ? DIM : undefined }, { text: clip(text, reach - label.length), fg: rich ? WHITE : undefined }], inner);
  const body = [mapCells, line("goal  ", model.title), fit(proofRow(model, rich, caps), inner), line("next  ", model.next)];
  // On a narrow card the sun stands against the right edge, and a long row keeps it away.
  const edgeAt = inner - SUN_W - 2;
  const at = edgeAt < TEXT_MAX + 2 ? edgeAt : Math.max(TEXT_MAX + 2, Math.min(edgeAt, Math.round(inner * 0.62)));
  const sun = rich && !model.done && paintScene(body.slice(1), at, t);

  const edge = (col, bottom) => {
    if (!rich) return undefined;
    const i = Math.floor(col / 4) * 4;
    let hue = ramp([PINK, VIOLET, ACCENT], i / width);
    if (bottom && sun) {
      const dx = i - (at + 1.5 + SUN_W / 2);
      const near = Math.max(0, 1 - Math.abs(dx) / 26);
      const ring = 0.5 + 0.5 * Math.sin(Math.abs(dx) * 0.55 - (t ?? 0) * 2.6);
      hue = mix(hue, near > 0.6 ? "#ffd24a" : "#ff8f3c", Math.min(1, near * (0.45 + 0.85 * ring)));
    }
    return working ? hue : mix(hue, FAINT, 0.45);
  };
  const frame = (bottom, left, right) => {
    const cells = Array.from({ length: width }, (_, col) => ({ ch: "─", fg: edge(col, bottom) }));
    cells[0].ch = bottom ? "╰" : "╭";
    cells[width - 1].ch = bottom ? "╯" : "╮";
    const put = (spans, from) => toCells([{ text: " " }, ...spans, { text: " " }]).forEach((cell, i) => { cells[from + i] = cell; });
    const size = (spans) => spans.reduce((sum, part) => sum + textWidth(part.text), 2);
    if (left.length) put(left, 2);
    if (right.length && 2 + size(left) + size(right) + 4 <= width) put(right, width - 2 - size(right));
    return cells;
  };
  const brand = rich ? pill("🔥 LIT", BRAND, caps) : [{ text: "LIT", bold: true }];
  const label = { text: " · goal", fg: rich ? ACCENT : undefined, bold: true };
  const state = model.done ? ["DONE ✓", TONES.ok] : working ? ["WORK ●", ACCENT] : ["YOUR TURN", TONES.warn];
  const gate = model.gate ? ["gate OPEN ✓", TONES.ok] : ["gate CLOSED", TONES.bad];
  const side = (cells) => [
    { ch: "│", fg: edge(0) }, { ch: " " }, ...cells, { ch: " " }, { ch: "│", fg: edge(width - 1) },
  ];
  return [
    frame(false, [...brand, label], [{ text: state[0], fg: rich ? state[1] : undefined, bold: true }]),
    ...body.map(side),
    frame(true, [{ text: gate[0], fg: rich ? gate[1] : undefined, bold: true }], []),
  ].map(toSpans);
};

// --- state ------------------------------------------------------------------------------------

const readJson = (file) => {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
const count = (value) => (Number.isInteger(value) && value >= 0 && value <= 999 ? value : 0);

export const recordName = (session) => `${createHash("sha256").update(session, "utf8").digest("hex").slice(0, 32)}.json`;

// The session's record as the card's model, or null when there is nothing true to show.
export const toModel = (record, now = Date.now(), isAlive = alive) => {
  if (!record || record.v !== 1 || !Array.isArray(record.stages) || !Number.isInteger(record.pid)) return null;
  const title = clip(plainText(record.title), 120);
  const seen = Number(record.at) * 1000;
  if (!title || !Number.isFinite(seen)) return null;
  const working = record.working === true && now - seen < WORK_STALE_MS && isAlive(record.pid);
  if (!working && now - seen >= IDLE_HIDE_MS) return null;
  const stages = STAGE_KEYS.flatMap((key) => {
    const state = record.stages.find((row) => Array.isArray(row) && row[0] === key)?.[1];
    return ["done", "active", "todo"].includes(state) ? [{ key, state }] : [];
  });
  const runs = (Array.isArray(record.runs) ? record.runs : []).slice(0, 3).flatMap((run) => (
    Array.isArray(run) && TONES[run[1]] ? [{ text: clip(plainText(run[0]), 20), tone: run[1] }] : []));
  return {
    title, stages, runs, working, seen, pid: record.pid,
    since: Number(record.since) > 0 ? Number(record.since) * 1000 : null,
    done: record.status === "complete",
    passed: count(record.passed), total: count(record.total), gate: record.gate === true,
    next: clip(plainText(record.next), 120),
  };
};

// The environment's word on the background, in the order Hermes reads it; null when it says nothing.
const saysLight = (env) => {
  const flag = (env.HERMES_TUI_LIGHT ?? "").trim().toLowerCase();
  if (/^(1|true|yes|on)$/.test(flag)) return true;
  if (/^(0|false|no|off)$/.test(flag)) return false;
  const theme = (env.HERMES_TUI_THEME ?? "").trim().toLowerCase();
  if (theme === "light" || theme === "dark") return theme === "light";
  const hint = /^#?([0-9a-f]{6})$/i.exec((env.HERMES_TUI_BACKGROUND ?? "").trim());
  if (hint) return brightness(`#${hint[1]}`) >= 128;
  const last = (env.COLORFGBG ?? "").trim().split(";").at(-1);
  return /^\d+$/.test(last) ? last === "7" || last === "15" : null;
};

// Colour depth and background. A light background by the environment or by the theme Hermes chose
// (its text is dark then) keeps the scene away.
export const isRich = (env, textColor) => {
  if ("NO_COLOR" in env || env.TERM === "dumb") return false;
  if (!/truecolor|24bit/i.test(env.COLORTERM ?? "") && !/direct/i.test(env.TERM ?? "")) return false;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  if (locale && !/utf-?8/i.test(locale)) return false;
  if (saysLight(env)) return false;
  return !/^#[0-9a-f]{6}$/i.test(textColor ?? "") || brightness(textColor) >= 128;
};
export const hasRoundCaps = (env) => Boolean(env.WT_SESSION) || env.TERM_PROGRAM === "vscode";

// --- the widget -------------------------------------------------------------------------------

export default function register(sdk) {
  const { Box, React, Text, defineWidgetApp, h, openWidget, updateWidget } = sdk;
  const env = process.env;
  const state = path.join(env.HERMES_HOME?.trim() || path.join(os.homedir(), ".hermes"), "lithermes");
  const records = path.join(state, "tui-card");
  const active = env.HERMES_TUI_ACTIVE_SESSION_FILE;

  // A hot reload runs this again: the earlier copy's watches and timers end here.
  globalThis[KEY]?.close();
  const reopened = Boolean(globalThis[KEY]);
  const held = { watchers: [], settle: null, expire: null };

  const load = () => {
    const session = active ? readJson(active)?.session_id : null;
    const mode = readJson(path.join(state, "tui-card.json"))?.mode ?? "on";
    if (typeof session !== "string" || !session || mode === "off") return { model: null, still: false };
    return { model: toModel(readJson(path.join(records, recordName(session)))), still: mode === "still" };
  };

  function Card({ model, still, width, rich, caps }) {
    const [, setTick] = React.useState(0);
    const started = React.useRef(0);
    const moving = model.working && !still && rich;
    React.useEffect(() => {
      if (!moving) return undefined;
      started.current = Date.now();
      let frames = 0;
      const timer = setInterval(() => {
        frames += 1;
        // Every ten seconds: a gateway that died mid-turn never reports the end of it.
        if (frames % 40 === 0 && !alive(model.pid)) refresh();
        else setTick(frames);
      }, FRAME_MS);
      return () => clearInterval(timer);
    }, [moving, model.pid]);
    const t = moving && started.current ? (Date.now() - started.current) / 1000 : null;
    return h(Box, { flexDirection: "column", width },
      ...cardRows(model, { width, t, rich, caps }).map((row, i) => h(Text, { key: i, wrap: "truncate-end" },
        ...row.map(({ text, fg, bg, bold }, j) => h(Text, {
          key: j, ...(fg ? { color: fg } : {}), ...(bg ? { backgroundColor: bg } : {}), ...(bold ? { bold: true } : {}),
        }, text)))));
  }

  const app = defineWidgetApp({
    id: "lit-card",
    help: "LitHermes goal card: stage, proof and next step (toggle)",
    mode: "ambient",
    zone: "dock-bottom",
    usage: "usage: /lit-card",
    init: load,
    reduce: (current, { ch, key }) => (key.escape || ch === "q" ? null : current),
    render({ state: { model, still }, cols, rows, t }) {
      if (!model || cols < MIN_COLS || rows < MIN_ROWS) return null;
      return h(Card, { model, still, width: Math.min(MAX_WIDTH, cols - 4), rich: isRich(env, t?.color?.text), caps: hasRoundCaps(env) });
    },
  });

  function refresh() {
    const next = load();
    clearTimeout(held.expire);
    if (next.model && !next.model.working) {
      held.expire = setTimeout(refresh, Math.max(1000, next.model.seen + IDLE_HIDE_MS - Date.now() + 1000));
      held.expire.unref?.();
    }
    updateWidget(app, () => next);
  }
  const settle = () => {
    clearTimeout(held.settle);
    held.settle = setTimeout(refresh, 100);
    held.settle.unref?.();
  };
  const watch = (target, name = null) => {
    try {
      const watcher = fs.watch(target, { persistent: false }, (_, file) => { if (!name || !file || file === name) settle(); });
      watcher.on("error", () => watcher.close());
      held.watchers.push(watcher);
    } catch {
      // A folder that cannot be watched only means the card keeps its last state.
    }
  };
  globalThis[KEY] = {
    close() {
      held.watchers.splice(0).forEach((watcher) => watcher.close());
      clearTimeout(held.settle);
      clearTimeout(held.expire);
    },
  };

  try {
    fs.mkdirSync(records, { recursive: true, mode: 0o700 });
  } catch {
    // Read-only home: nothing can be written there, so there is nothing to show.
  }
  watch(records);
  watch(state, "tui-card.json");
  if (active) watch(active);

  // Docked once, at zero rows until there is something to show. A reload does not bring back a card
  // the user put away with /lit-card: updateWidget runs its function only while the card is docked.
  let docked = !reopened;
  updateWidget(app, (current) => { docked = true; return current; });
  if (docked) openWidget(app, load());
  refresh();
}
