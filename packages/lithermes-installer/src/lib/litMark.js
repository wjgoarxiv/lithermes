// Approved Ignition B geometry and per-cell colors are local to this package.
const data = require("../../assets/lithermes-plugin/lit_mark_rows.json");
const standard = Object.freeze(data.standard.map((row) => row.text));
const banner = Object.freeze(data.banner.map((row) => row.text));
const micro = Object.freeze(data.micro.map((row) => row.text));
const GLYPHS = new Set("█▓▀▄▌▐▖▗▘▝▙▛▜▟▚▞");
const INDEXED = Object.freeze({ "#FF6337": 203, "#D7F75B": 191, "#F2EFDF": 230 });

function lockup(productName, rows = standard) {
  if (typeof productName !== "string" || !/^[a-zA-Z0-9 .·_-]+$/.test(productName)) {
    throw new TypeError("product name must be a plain single line");
  }
  // Preserve the native eight-space gap after the full mark envelope.
  const column = Math.max(...rows.map((row) => row.length)) + 8;
  const middle = Math.floor(rows.length / 2);
  return rows.map((row, i) => i === middle ? row.padEnd(column) + productName : row);
}

function cellsFor(rows) {
  return Object.values(data).find((cells) => cells.length === rows.length
    && cells.every((cell, i) => rows[i].startsWith(cell.text)));
}

function colorize(rows, { mode = "none" } = {}) {
  if (!["none", "256", "truecolor"].includes(mode)) throw new TypeError("invalid color mode");
  if (mode === "none") return [...rows];
  const cells = cellsFor(rows);
  return rows.map((row, i) => [...row].map((ch, column) => {
    if (!GLYPHS.has(ch)) return ch;
    const hex = cells ? cells[i].colors[column] : "#F2EFDF";
    if (!hex) return ch;
    const ink = mode === "256" ? `38;5;${INDEXED[hex]}`
      : `38;2;${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(";")}`;
    return `\x1b[${ink}m${ch}\x1b[0m`;
  }).join(""));
}

function utf8Terminal(env = process.env) {
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return env.TERM !== "dumb" && (!locale || /utf-?8/i.test(locale));
}

function colorMode({ stream = process.stdout, env = process.env, json = false } = {}) {
  if (json || "NO_COLOR" in env || "CI" in env || !stream?.isTTY || !utf8Terminal(env)) return "none";
  return /truecolor|24bit/i.test(env.COLORTERM || "") || /direct/i.test(env.TERM || "") ? "truecolor" : "256";
}

function render(rows, options = {}) {
  if (!utf8Terminal(options.env)) return ["LIT"];
  const detected = colorMode(options);
  return colorize(rows, { ...options, mode: detected === "none" ? "none" : options.mode || detected });
}

// Hermes' native branding surfaces consume Rich markup, not raw ANSI escapes.
function richLogo(rows) {
  return rows.map((row) => [...row.text].map((ch, column) =>
    row.colors[column] ? `[${row.colors[column]}]${ch}[/]` : ch).join(""));
}

function skinLogo() {
  return richLogo(data.standard);
}

function microLogo() {
  return richLogo(data.micro);
}

module.exports = { standard, banner, micro, lockup, colorize, colorMode, utf8Terminal, render, skinLogo, microLogo };
