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
const IDLE_AFTER_MS = 10 * 60 * 1000; // At rest this long, the card says so.
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

const WIDE = /[⚡ᄀ-ᅟ⺀-〾ぁ-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;
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

// The stage map of a plain card keeps as many stages as fit, always with the current one.
const plainMap = (model, width) => {
  const draw = (stages, rail) => stages.map((stage, i) => {
    const join = i === 0 ? "" : rail ? (stage.state === "todo" ? " ── " : " ━━ ") : " ";
    return join + (stage.state === "active" ? `[${stage.key}]` : `${stage.key} ${stage.state === "done" ? "✓" : "·"}`);
  }).join("");
  const active = model.stages.filter((stage) => stage.state === "active");
  const text = [draw(model.stages, true), draw(model.stages, false), draw(active, false)].find((row) => textWidth(row) <= width) ?? "";
  return text ? [{ text, bold: false }] : [];
};

const size = (spans) => spans.reduce((sum, part) => sum + textWidth(part.text), 0);
const fit = (spans, width) => {
  const cells = toCells(spans);
  if (cells.length > width) {
    cells.length = width;
    if (cells.at(-1) && textWidth(cells.at(-1).ch) === 2) cells[width - 1] = { ch: " " };
  }
  while (cells.length < width) cells.push({ ch: " " });
  return cells;
};

// No colour: the same words in a plain frame, six rows.
const plainRows = (model, { width, t, now }) => {
  const inner = width - 4;
  const running = t !== null && model.since ? clock(now - model.since) : "";
  const map = fit(plainMap(model, inner - (running ? running.length + 2 : 0)), inner);
  [...running].forEach((ch, i) => { map[inner - running.length + i] = { ch }; });
  const reach = Math.min(TEXT_MAX, inner);
  const line = (label, text) => fit([{ text: label + clip(text, reach - label.length) }], inner);
  const lit = model.total > 0 ? Math.round((model.passed / model.total) * 8) : 0;
  const runs = model.runs.length ? model.runs.map((run) => ` ${run.text}`).join("") : " · no signed runs yet";
  const proof = `proof ${"#".repeat(lit)}${"-".repeat(8 - lit)} ${model.passed}/${model.total} criteria${runs}`;
  const frame = (bottom, left, right) => {
    const cells = Array.from({ length: width }, () => ({ ch: "─" }));
    cells[0].ch = bottom ? "╰" : "╭";
    cells[width - 1].ch = bottom ? "╯" : "╮";
    const put = (spans, from) => toCells([{ text: " " }, ...spans, { text: " " }]).forEach((cell, i) => { cells[from + i] = cell; });
    put(left, 2);
    if (right.length && 2 + size(left) + 2 + size(right) + 2 + 4 <= width) put(right, width - 4 - size(right));
    return cells;
  };
  const state = model.done ? "DONE ✓" : model.working ? "WORK ●" : "YOUR TURN";
  const side = (cells) => [{ ch: "│" }, { ch: " " }, ...cells, { ch: " " }, { ch: "│" }];
  return [
    frame(false, [{ text: "LIT", bold: true }, { text: " · goal", bold: true }], [{ text: state, bold: true }]),
    ...[map, line("goal  ", model.title), fit([{ text: proof }], inner), line("next  ", model.next)].map(side),
    frame(true, [{ text: model.gate ? "gate OPEN ✓" : "gate CLOSED", bold: true }], []),
  ].map(toSpans);
};

const TRACK = "#2a2340";
// A bar of `cells` cells with both ends inside it, so it is as wide round as square. `tone(i)` is null for the track.
const bar = (cells, caps, tone) => Array.from({ length: cells }, (_, i) => {
  const hue = tone(i) ?? TRACK;
  return caps && (i === 0 || i === cells - 1) ? { text: i === 0 ? "\ue0b6" : "\ue0b4", fg: hue } : { text: " ", bg: hue };
});
const gauge = (part, cells, caps, stops) => {
  const lit = part <= 0 ? 0 : Math.max(1, Math.round(Math.min(1, part) * cells));
  return bar(cells, caps, (i) => (i < lit ? ramp(stops, i / (cells - 1)) : null));
};
// Work without a known end is a thin line, not a gauge: two lit cells walk along it while the card
// moves. The glyph never changes, only its colour.
const walk = (cells, t) => Array.from({ length: cells }, (_, i) => ({
  text: "━", fg: t !== null && [0, 1].includes((i - Math.floor(t * 4) % cells + cells) % cells) ? TONES.ok : "#3a3354",
}));

const words = (text, fg, bold = false) => ({ text, fg, ...(bold ? { bold } : {}) });

const FRAME = [PINK, VIOLET, ACCENT];
// What the top edge says: one word and one mark, from the record alone. Third: the frame's own colours
// where the state has some.
const stateOf = (model, now) => {
  const busy = model.lanes.filter((lane) => lane.state === "running").length;
  const stage = model.stages.find((row) => row.state === "active")?.key ?? "work";
  if (model.done) return ["DONE ✓", TONES.ok];
  if (busy) return [`${busy} ${busy === 1 ? "LANE" : "LANES"} ●`, TONES.ok];
  if (model.working) return [`${stage.toUpperCase()} ●`, stage === "review" ? VIOLET : ACCENT];
  if (now - model.seen >= IDLE_AFTER_MS) return ["IDLE ○", DIM];
  if (model.runs.at(-1)?.tone === "bad") return ["RUN FAILED ✗", TONES.bad, [TONES.bad, PINK]];
  if (model.runs.some((run) => run.tone === "warn")) return ["STALE RUN ▲", TONES.warn, [TONES.warn, TONES.bad]];
  if (model.passed === 0 && model.runs.length === 0) return ["READY ○", ACCENT];
  return ["YOUR TURN ◆", TONES.warn, ["#ff8f3c", "#ffd24a"]];
};

const stageMap = (model, width, caps) => {
  const draw = (stages, rail) => stages.flatMap((stage, i) => {
    const walked = stage.state !== "todo";
    const hue = mix("#ff6337", PINK, i / 5);
    const join = i === 0 ? [] : [words(rail ? (walked ? " ━━ " : " ── ") : " ", walked ? hue : "#46505c")];
    const name = stage.key.toUpperCase();
    if (stage.state === "active") return [...join, ...pill(name, [VIOLET, ACCENT], caps)];
    return [...join, words(`${name} ${walked ? "✓" : "·"}`, walked ? hue : DIM)];
  });
  const active = model.stages.filter((stage) => stage.state === "active");
  return [draw(model.stages, true), draw(model.stages, false), draw(active, false)].find((row) => size(row) <= width) ?? [];
};

// Left and right parts of one row; the right part leaves first.
const pair = (left, right, width) => {
  if (!right.length || size(left) + 2 + size(right) > width) return fit(left, width);
  return [...fit(left, width - size(right)), ...toCells(right)];
};

const laneRows = (model, reach, room, t, now, caps) => {
  const { lanes } = model;
  if (!lanes.length || room < 2) return [];
  const ended = lanes.filter((lane) => lane.state !== "running").length;
  const shown = lanes.length <= room - 1 ? lanes : lanes.slice(0, room - 2);
  const barW = 6;
  const nameW = Math.max(8, Math.min(28, reach - 35));
  const out = [[
    words("┬ ", DIM), words(String(lanes.length), WHITE, true), words(lanes.length === 1 ? " lane " : " lanes in parallel ", DIM),
    ...gauge(ended / lanes.length, 8, caps, [TONES.ok, ACCENT]), words(" ", DIM), words(`${ended}/${lanes.length}`, WHITE, true), words(" done", DIM),
  ]];
  shown.forEach((lane, i) => {
    const running = lane.state === "running";
    const tone = running ? TONES.ok : lane.state === "ok" ? ACCENT : TONES.bad;
    const last = i === shown.length - 1 && shown.length === lanes.length;
    const name = clip(lane.name, nameW);
    const time = running && t === null ? "" : ` ${clock((running ? now : lane.ended) - lane.since)}`;
    out.push([
      words(last ? "└─ " : "├─ ", DIM), words(running ? "● " : lane.state === "ok" ? "✓ " : "✗ ", tone),
      words(name + " ".repeat(nameW - textWidth(name) + 1), WHITE, true),
      ...(running ? walk(barW, t) : gauge(lane.state === "ok" ? 1 : 0, barW, caps, [TONES.ok, ACCENT])),
      words(` ${running ? "running" : lane.state === "ok" ? "done" : "stopped"}`, tone), words(time, WHITE),
      ...(lane.calls ? [words(" · ", DIM), words(String(lane.calls), WHITE), words(lane.calls === 1 ? " call" : " calls", DIM)] : []),
    ]);
  });
  if (shown.length < lanes.length) out.push([words(`└─ +${lanes.length - shown.length} more`, DIM)]);
  return out;
};

const skillChips = (model, reach, caps) => {
  const draw = (mark) => {
    const out = [words("skills ", DIM)];
    let all = true;
    for (const name of model.skills) {
      const chip = [...(out.length > 1 ? [words(" ")] : []), ...pill(mark + name, [ACCENT, ACCENT, VIOLET], caps)];
      all = size(out) + size(chip) <= reach;
      if (!all) break;
      out.push(...chip);
    }
    return { out: out.length > 1 ? out : [], all };
  };
  const marked = draw("⚡ ");
  return marked.all ? marked.out : draw("").out;
};

// Full colour: the whole card. Between five and ten rows stand in the frame.
const richRows = (model, { width, t, now, caps, rows }) => {
  const inner = width - 4;
  const edgeAt = inner - SUN_W - 2;
  const at = inner < 90 ? edgeAt : Math.round(inner * 0.66);
  const reach = at >= 50 ? at - 3 : inner;
  const moving = t !== null;
  const busy = model.lanes.filter((lane) => lane.state === "running").length;
  const timer = moving && model.since ? clock(now - model.since) : "";
  const mapRight = [
    ...(busy ? [words("●".repeat(Math.min(busy, 4)), TONES.ok), words(` ${busy} ${busy === 1 ? "lane" : "lanes"}`, DIM)] : []),
    ...(timer ? [words(busy ? ` ${timer}` : timer, DIM)] : []),
  ];
  const map = stageMap(model, inner - (mapRight.length ? size(mapRight) + 2 : 0), caps);
  const tool = model.working && model.tool
    ? [words(`${moving ? "|/-\\"[Math.floor(t * 4) % 4] : "·"} `, ACCENT), words(clip(model.tool.name, 24), WHITE, true),
      ...(moving ? [words(" · ", DIM), words(clock(now - model.tool.since), DIM)] : [])]
    : [];
  const proven = model.total > 0 && model.passed === model.total;
  const task = [
    words("└ ", DIM), words("proof ", DIM), words(String(model.passed), proven ? TONES.ok : WHITE, true), words(`/${model.total} `, DIM),
    ...gauge(model.total ? model.passed / model.total : 0, 8, caps, proven ? [TONES.ok, ACCENT] : [VIOLET, ACCENT]),
  ];
  const nextW = inner - size(task) - 10 - (tool.length ? size(tool) + 2 : 0);
  if (model.next && nextW >= 12) task.push(words(" · ", DIM), words("next ▸ ", ACCENT), words(clip(model.next, nextW), WHITE));
  const dot = model.done ? ["✓ ", TONES.ok] : model.working || busy ? ["● ", TONES.ok] : ["○ ", DIM];
  const goal = [words(dot[0], dot[1]), words(clip(model.title, reach - 2), WHITE, true)];
  const runs = [words("└ ", DIM), ...(model.runs.length ? [words("runs ", DIM)] : []), ...(model.runs.length
    ? model.runs.flatMap((run, i) => [words(i ? " · " : "", DIM), words(run.text, TONES[run.tone])])
    : [words("no signed runs yet", DIM)])];
  const chips = skillChips(model, reach, caps);
  const room = Math.max(0, Math.min(6, rows - 24));
  const body = [pair(map, mapRight, inner), pair(task, tool, inner), fit(goal, inner), fit(runs, inner),
    ...laneRows(model, reach, room, t, now, caps).map((row) => fit(row, inner)), fit(chips, inner)];
  // The sun stands in the last three rows; a row that needs its place keeps it away.
  const scene = body.slice(-3);
  const sun = paintScene(scene, at, t);

  const state = stateOf(model, now);
  const edge = (col, bottom) => {
    const i = Math.floor(col / 4) * 4;
    let hue = ramp(state[2] ?? FRAME, i / width);
    if (bottom && sun) {
      const dx = i - (at + 1.5 + SUN_W / 2);
      const near = Math.max(0, 1 - Math.abs(dx) / 26);
      const ring = 0.5 + 0.5 * Math.sin(Math.abs(dx) * 0.55 - (t ?? 0) * 2.6);
      hue = mix(hue, near > 0.6 ? "#ffd24a" : "#ff8f3c", Math.min(1, near * (0.45 + 0.85 * ring)));
    }
    return model.working || busy || model.done || state[2] ? hue : mix(hue, FAINT, 0.45);
  };
  const frame = (bottom, left, right) => {
    const cells = Array.from({ length: width }, (_, col) => ({ ch: "─", fg: edge(col, bottom) }));
    cells[0].ch = bottom ? "╰" : "╭";
    cells[width - 1].ch = bottom ? "╯" : "╮";
    const put = (spans, from) => toCells([words(" "), ...spans, words(" ")]).forEach((cell, i) => { cells[from + i] = cell; });
    if (left.length) put(left, 2);
    if (right.length && size(left) + size(right) + 10 <= width) put(right, width - 4 - size(right));
    return cells;
  };
  const route = model.route || "goal";
  const heat = model.context === null ? null : model.context >= 85 ? TONES.bad : model.context >= 65 ? TONES.warn : ACCENT;
  const parts = [
    ...(heat ? [[words("ctx ", DIM), words(`${model.context}% `, heat, true), ...gauge(model.context / 100, 8, caps, heat === ACCENT ? [VIOLET, ACCENT] : [heat, heat])]] : []),
    [words("gate ", DIM), words(model.gate ? "OPEN ✓" : "CLOSED", model.gate ? TONES.ok : TONES.bad, true)],
    ...(model.branch ? [[words("⎇ ", DIM), words(clip(model.branch, 28), ACCENT)]] : []),
  ];
  const foot = parts.reduce((out, part) => {
    const next = out.length ? [...out, words(" · ", DIM), ...part] : part;
    return size(next) + 8 <= width ? next : out;
  }, []);
  const side = (cells) => [{ ch: "│", fg: edge(0) }, { ch: " " }, ...cells, { ch: " " }, { ch: "│", fg: edge(width - 1) }];
  return [
    frame(false, [...pill("🔥 LIT", BRAND, caps), words(" · ", DIM), words(route, state[2] ? state[1] : ACCENT, true)], [words(state[0], state[1], true)]),
    ...body.slice(0, -3).concat(scene).map(side),
    frame(true, foot, []),
  ].map(toSpans);
};

// The card's rows of spans, each exactly `width` cells. `t` is the motion's seconds or null at rest,
// `now` the clock the running times are read from, `rows` the terminal's height.
export const cardRows = (model, { width, t = null, now = Date.now(), rich = true, caps = false, rows = 40 }) => (
  rich ? richRows(model, { width, t, now, caps, rows }) : plainRows(model, { width, t, now }));

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
const LANE_STATES = ["running", "ok", "bad"];
const named = (value) => (/^[\w.:/ -]{1,48}$/.test(String(value ?? "")) ? String(value) : "");
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
    route: named(record.route),
    branch: clip(plainText(record.branch), 60),
    context: typeof record.context === "number" && record.context >= 0 ? Math.min(100, Math.round(record.context)) : null,
    tool: working && Array.isArray(record.tool) && named(record.tool[0]) && Number(record.tool[1]) > 0
      ? { name: named(record.tool[0]), since: Number(record.tool[1]) * 1000 } : null,
    skills: (Array.isArray(record.skills) ? record.skills : []).map(named).filter(Boolean).slice(0, 4),
    lanes: (Array.isArray(record.lanes) ? record.lanes : []).slice(0, 12).flatMap((lane) => {
      const name = clip(plainText(lane?.name), 40);
      const live = now - seen < WORK_STALE_MS && isAlive(record.pid);
      const state = LANE_STATES.includes(lane?.state) ? (lane.state === "running" && !live ? "bad" : lane.state) : null;
      const since = Number(lane?.since) * 1000;
      if (!name || !state || !(since > 0)) return [];
      return [{ name, state, since, ended: Math.max(since, Number(lane.ended) * 1000 || since), calls: count(lane.calls) }];
    }),
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

// Whether pills and gauges end in round caps (U+E0B6, U+E0B4). LITHERMES_HUD_GLYPHS wins, then the
// saved choice, then a terminal that draws the caps itself; over SSH the fonts here are not the ones on
// screen; else an icon font installed on this machine, told by file names alone. `round_caps.py`
// answers the same for the classic CLI, and one test runs both through one table.
const ICON_FONT = /(?:nerd[ _-]?font|[a-z0-9]NF[MP]?[ _.-]).*\.(?:ttf|otf|ttc)$/i;
const fontFolders = (env, platform) => {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  if (platform === "darwin") return [path.join(home, "Library", "Fonts"), "/Library/Fonts"];
  if (platform === "win32") {
    return [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"), env.WINDIR && path.join(env.WINDIR, "Fonts")].filter(Boolean);
  }
  return [path.join(path.isAbsolute(env.XDG_DATA_HOME ?? "") ? env.XDG_DATA_HOME : path.join(home, ".local", "share"), "fonts"), path.join(home, ".fonts"), "/usr/local/share/fonts", "/usr/share/fonts"];
};
export const hasIconFont = (env, platform = process.platform, limit = 4000) => {
  let left = limit;
  let level = fontFolders(env, platform);
  for (let depth = 0; depth < 4 && level.length; depth += 1) {
    const below = [];
    for (const folder of level) {
      let entries = [];
      try {
        entries = fs.readdirSync(folder, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (left-- <= 0) return false;
        if (entry.isDirectory()) below.push(path.join(folder, entry.name));
        else if (entry.isFile() && ICON_FONT.test(entry.name)) return true;
      }
    }
    level = below;
  }
  return false;
};
const GLYPH_WORDS = new Map([["auto", "auto"], ["round", "round"], ["nerd", "round"], ["square", "square"], ["basic", "square"]]);
export const glyphSetting = (env) => GLYPH_WORDS.get((env.LITHERMES_HUD_GLYPHS ?? "").trim().toLowerCase()) ?? null;
export const hasRoundCaps = (env, saved = "auto", iconFont = () => hasIconFont(env)) => {
  const glyphs = glyphSetting(env) ?? saved;
  if (glyphs === "round" || glyphs === "square") return glyphs === "round";
  if (env.WT_SESSION || /^(?:vscode|wezterm|ghostty)$/i.test(env.TERM_PROGRAM ?? "")) return true;
  if (env.TERM === "xterm-kitty" || env.KITTY_WINDOW_ID) return true;
  return env.SSH_CONNECTION ? false : iconFont();
};

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
  const held = { watchers: [], settle: null, expire: null, catchUp: null };

  // The font folders are read at most once in this process.
  let font = null;
  const iconFont = () => (font ??= hasIconFont(env));
  const load = () => {
    const session = active ? readJson(active)?.session_id : null;
    const { mode = "on", glyphs } = readJson(path.join(state, "tui-card.json")) ?? {};
    if (typeof session !== "string" || !session || mode === "off") return { model: null, still: false, caps: false };
    return { model: toModel(readJson(path.join(records, recordName(session)))), still: mode === "still", caps: hasRoundCaps(env, glyphs, iconFont) };
  };

  function Card({ model, still, width, rich, caps, rows }) {
    const [, setTick] = React.useState(0);
    const started = React.useRef(0);
    const moving = (model.working || model.lanes.some((lane) => lane.state === "running")) && !still && rich;
    React.useEffect(() => {
      if (!moving) return undefined;
      started.current = Date.now();
      let frames = 0;
      const timer = setInterval(() => {
        frames += 1;
        // Every ten seconds: a gateway that died mid-turn never reports the end of it, and a file
        // watch can drop an event.
        if (frames % 40 === 0) refresh();
        setTick(frames);
      }, FRAME_MS);
      return () => clearInterval(timer);
    }, [moving, model.pid]);
    const t = moving && started.current ? (Date.now() - started.current) / 1000 : null;
    return h(Box, { flexDirection: "column", width },
      ...cardRows(model, { width, t, rich, caps, rows }).map((row, i) => h(Text, { key: i, wrap: "truncate-end" },
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
    render({ state: { model, still, caps }, cols, rows, t }) {
      if (!model || cols < MIN_COLS || rows < MIN_ROWS) return null;
      return h(Card, { model, still, width: Math.min(MAX_WIDTH, cols - 4), rich: isRich(env, t?.color?.text), caps, rows });
    },
  });

  function refresh() {
    const next = load();
    clearTimeout(held.expire);
    if (next.model && !next.model.working) {
      const rest = Date.now() - next.model.seen;
      held.expire = setTimeout(refresh, Math.max(1000, (rest < IDLE_AFTER_MS ? IDLE_AFTER_MS : IDLE_HIDE_MS) - rest + 1000));
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
      clearTimeout(held.catchUp);
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
  // macOS starts a watch late: a record written in the first moments raises no event.
  held.catchUp = setTimeout(refresh, 1000);
  held.catchUp.unref?.();
}
