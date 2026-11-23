// Synthwave LIT mark for the installer's human-facing command header (install,
// check, doctor, help, hud, extensions), drawn only when stdout is a terminal.
// The mark never enters model-visible text, skin files, slash-command output or
// gateway replies. The status badge is separate: lit_mark.lit_pill draws it in
// the HUD card head on a truecolor classic CLI, so it does reach that display.
// synthwaveRows.json is generated from the family synthwave spec; do not hand-edit it.
const data = require("./synthwaveRows.json");

const HOST_LABEL = "hermes agent";
const FALLBACK_LINE = `LIT · ${HOST_LABEL}`;
// LitHermes chrome: warm cream at the top of each letter, amber at the base.
const CHROME_STOPS = Object.freeze(["#fff8e1", "#ffd54f", "#f59e0b", "#ffffff", "#ffcc80", "#b45309"]);
const TAGLINE_STOPS = Object.freeze(["#8be9fd", "#ff2d95", "#ffd23f"]);
const EDGE = "#ffffff";
const SIZES = Object.freeze([
  Object.freeze({ name: "B-L", minCols: 76 }),
  Object.freeze({ name: "B-M", minCols: 44 }),
  Object.freeze({ name: "B-S", minCols: 24 }),
]);

const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));

function sample(stops, t) {
  const last = stops.length - 1;
  const segment = Math.min(last - 1, Math.floor(t * last));
  const fraction = t * last - segment;
  const from = rgb(stops[segment]);
  const to = rgb(stops[segment + 1]);
  return from.map((value, i) => Math.round(value + (to[i] - value) * fraction));
}

function pixel(symbol) {
  if (symbol === " ") return null;
  if (symbol >= "a" && symbol <= "l") return sample(CHROME_STOPS, (symbol.charCodeAt(0) - 97) / 11);
  if (symbol === "m") return rgb(EDGE);
  return data.shared[symbol] ? rgb(data.shared[symbol]) : null;
}

const same = (a, b) => a === b || (a && b && a.every((value, i) => value === b[i]));
// xterm 256-colour cube: 16 + 36r + 6g + b, each channel scaled to 0..5.
const cube = (colour) => {
  const [r, g, b] = colour.map((value) => Math.round((value / 255) * 5));
  return 16 + 36 * r + 6 * g + b;
};
const sgr = (colour, layer, mode) => `${layer}${mode === "truecolor" ? `;2;${colour.join(";")}` : `;5;${cube(colour)}`}`;

function cell(glyph, fg, bg, mode) {
  const codes = [fg && sgr(fg, 38, mode), bg && sgr(bg, 48, mode)].filter(Boolean);
  return codes.length ? `\x1b[${codes.join(";")}m${glyph}\x1b[0m` : glyph;
}

/** Largest size whose width fits `cols`, or null when even B-S does not. Unknown width counts as 80. */
function pickSize(cols) {
  const width = Number.isFinite(cols) && cols > 0 ? cols : 80;
  const size = SIZES.find((entry) => width >= entry.minCols);
  return size ? size.name : null;
}

function terminalColumns({ stream = process.stdout, env = process.env } = {}) {
  const fromStream = Number(stream && stream.columns);
  if (Number.isFinite(fromStream) && fromStream > 0) return fromStream;
  const fromEnv = Number(env && env.COLUMNS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 80;
}

// Two pixels per cell: ▀ with fg = upper and bg = lower, a space on bg when both
// match, and ▄ with fg = lower when the upper pixel is the terminal background.
function paintedRows(size, mode) {
  const rows = data.pixelRows[size];
  const out = [];
  for (let y = 0; y < rows.length; y += 2) {
    let line = "";
    for (let x = 0; x < rows[y].length; x += 1) {
      const upper = pixel(rows[y][x]);
      const lower = pixel(rows[y + 1][x]);
      if (same(upper, lower)) line += upper ? cell(" ", null, upper, mode) : " ";
      else if (!upper) line += cell("▄", lower, null, mode);
      else line += cell("▀", upper, lower, mode);
    }
    out.push(line);
  }
  return out;
}

function centred(text, width) {
  return `${" ".repeat(Math.max(0, Math.floor((width - [...text].length) / 2)))}${text}`;
}

function taglineRow(width, mode) {
  const glyphs = [...FALLBACK_LINE];
  if (mode === "none") return centred(FALLBACK_LINE, width);
  const pad = " ".repeat(Math.max(0, Math.floor((width - glyphs.length) / 2)));
  const last = glyphs.length - 1;
  return `${pad}${glyphs.map((glyph, i) => (glyph === " " ? glyph
    : cell(glyph, sample(TAGLINE_STOPS, last ? i / last : 0), null, mode))).join("")}`;
}

/**
 * The mark for a terminal `cols` wide. mode "truecolor" or "256" paints the
 * pixel map; "none" prints the monochrome scene; a terminal narrower than B-S
 * (or mode "plain") gets the one plain line.
 */
function synthwaveRows({ cols, mode = "none" } = {}) {
  const size = pickSize(cols);
  if (mode === "plain" || size === null) return [FALLBACK_LINE];
  const painted = mode === "truecolor" || mode === "256";
  const width = data.pixelRows[size][0].length;
  const art = painted ? paintedRows(size, mode) : [...data.monoRows[size]];
  return [...art, taglineRow(width, painted ? mode : "none")];
}

/** Width in terminal cells of the mark at `cols`, for centring a line under it. */
function markWidth(cols) {
  const size = pickSize(cols);
  return size ? data.pixelRows[size][0].length : FALLBACK_LINE.length;
}

module.exports = {
  CHROME_STOPS,
  FALLBACK_LINE,
  HOST_LABEL,
  SIZES,
  SPEC_DIGEST: data.digest,
  centred,
  markWidth,
  pickSize,
  synthwaveRows,
  terminalColumns,
};
