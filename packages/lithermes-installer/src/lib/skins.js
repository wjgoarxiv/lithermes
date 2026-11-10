const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { colorMode, skinLogo, microLogo } = require("./litMark");
const { writeFileAtomic } = require("./files");

// LitHermes HUD accents — 10 presets that drive Hermes' native skin engine.
// Each becomes ~/.hermes/skins/lithermes-<accent>.yaml; activated via
// `display.skin` in config.yaml or `/skin lithermes-<accent>` inside Hermes.
//
// A curated 10-accent palette (name + ANSI-256 code + order); `hex` is a
// neon-vivid color of the same hue (Hermes skins use hex, not ANSI codes).
// ⚠️  accent, code, and order are frozen by tests — do NOT reorder.
const HUD_ACCENTS = [
  { accent: "cyan",     code: 81,  hex: "#00F5FF", label: "Cyan",     mood: "neon ice" },
  { accent: "blue",     code: 39,  hex: "#00B4FF", label: "Blue",     mood: "arc flash" },
  { accent: "teal",     code: 49,  hex: "#00FFB2", label: "Teal",     mood: "plasma teal" },
  { accent: "green",    code: 118, hex: "#39FF14", label: "Green",    mood: "laser green" },
  { accent: "lavender", code: 177, hex: "#E040FB", label: "Lavender", mood: "neon violet" },
  { accent: "rose",     code: 198, hex: "#FF0066", label: "Rose",     mood: "hot magenta" },
  { accent: "gold",     code: 220, hex: "#FFE600", label: "Gold",     mood: "volt gold" },
  { accent: "orange",   code: 208, hex: "#FF6200", label: "Orange",   mood: "ember glow" },
  { accent: "slate",    code: 75,  hex: "#33AAFF", label: "Slate",    mood: "cold steel" },
  { accent: "gray",     code: 231, hex: "#F0F0F0", label: "Gray",     mood: "soft white" },
];

// A named theme, separate from the frozen numeric accent choices above.
const IGNITION = { accent: "ignition", code: 209, hex: "#FF6337", label: "Ignition", mood: "keep the work lit" };

const TOKYONIGHT_DAY_PALETTE = Object.freeze({
  background: "#E1E2E7",
  foreground: "#3760BF",
  primary: "#2E7DE9",
  secondary: "#9854F1",
  selection: "#FFFFFF",
  severity: { good: "#4F6933", warn: "#785D35", bad: "#984F00", critical: "#AE3B3B" },
});
const TOKYONIGHT_NIGHT_PALETTE = Object.freeze({
  background: "#1A1B26",
  foreground: "#C0CAF5",
  primary: "#7AA2F7",
  secondary: "#BB9AF7",
  selection: "#292E42",
  severity: { good: "#9ECE6A", warn: "#E0AF68", bad: "#FF9E64", critical: "#F7768E" },
});

// Status-bar severity ink for the LIT accents and Ignition. The accents only
// recolor brand surfaces, so one set per polarity keeps good/warn/bad/critical
// readable apart under every accent.
const LIT_SEVERITY_DARK = Object.freeze({ good: "#5FD38D", warn: "#FFC24B", bad: "#FF8A3D", critical: "#FF4D5E" });
const LIT_SEVERITY_LIGHT = Object.freeze({ good: "#1E7B45", warn: "#8A5A00", bad: "#B4490F", critical: "#B3192B" });

function severityColors(severity) {
  return {
    status_bar_good: severity.good,
    status_bar_warn: severity.warn,
    status_bar_bad: severity.bad,
    status_bar_critical: severity.critical,
  };
}
const TOKYONIGHT_DAY = Object.freeze({
  accent: "tokyonight-day",
  code: null,
  hex: TOKYONIGHT_DAY_PALETTE.primary,
  label: "TokyoNight Day",
  mood: "paper daylight",
  palette: TOKYONIGHT_DAY_PALETTE,
});
const TOKYONIGHT = Object.freeze({
  accent: "tokyonight",
  code: null,
  hex: TOKYONIGHT_NIGHT_PALETTE.primary,
  label: "TokyoNight",
  mood: "midnight blue",
  palette: TOKYONIGHT_NIGHT_PALETTE,
});
const NAMED_THEMES = Object.freeze([TOKYONIGHT_DAY, TOKYONIGHT]);

function ignitionColorBlock(name, light = false) {
  const ink = light ? "#080D14" : "#F2EFDF";
  const accent = light ? "#080D14" : "#FF6337";
  const colors = Object.fromEntries(ACCENT_COLOR_KEYS.map((key) => [key, accent]));
  Object.assign(colors, {
    ui_accent: light ? "#080D14" : "#D7F75B",
    ui_label: ink,
    banner_dim: ink,
    status_bar_strong: ink,
    status_bar_dim: ink,
    status_bar_text: ink,
    banner_text: ink,
    prompt: ink,
    status_bar_bg: light ? "#F2EFDF" : "#080D14",
    completion_menu_bg: light ? "#F2EFDF" : "#080D14",
    ...severityColors(light ? LIT_SEVERITY_LIGHT : LIT_SEVERITY_DARK),
  });
  return [name + ":", ...Object.entries(colors).map(([key, value]) => `  ${key}: "${value}"`)];
}

function skinName(accent) {
  return `lithermes-${accent}`;
}

function skinsDir(hermesHome) {
  return path.join(hermesHome, "skins");
}

const ACCENT_COLOR_KEYS = [
  "banner_title",
  "banner_accent",
  "banner_border",
  "ui_accent",
  "ui_label",
  "input_rule",
  "response_border",
  "status_bar_strong",
  "session_label",
];

// The light-terminal pair needs a darker ink of the same hue; a fixed scale of
// the accent keeps the derivation deterministic (brief: derived variant).
function darkenHex(hex, factor = 0.55) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const channel = (value) => Math.round(value * factor).toString(16).padStart(2, "0").toUpperCase();
  return `#${rgb.map(channel).join("")}`;
}

function colorBlock(name, hex, severity = LIT_SEVERITY_DARK) {
  return [
    `${name}:`,
    ...ACCENT_COLOR_KEYS.map((key) => `  ${key}: "${hex}"`),
    ...Object.entries(severityColors(severity)).map(([key, value]) => `  ${key}: "${value}"`),
  ];
}

function paletteColorBlock(name, palette) {
  const colors = Object.fromEntries(ACCENT_COLOR_KEYS.map((key) => [key, palette.primary]));
  Object.assign(colors, {
    banner_title: palette.foreground,
    banner_accent: palette.primary,
    banner_border: palette.primary,
    ui_accent: palette.primary,
    ui_label: palette.foreground,
    input_rule: palette.primary,
    response_border: palette.primary,
    status_bar_strong: palette.foreground,
    session_label: palette.foreground,
    banner_dim: palette.foreground,
    status_bar_dim: palette.foreground,
    status_bar_text: palette.foreground,
    banner_text: palette.foreground,
    prompt: palette.foreground,
    status_bar_bg: palette.background,
    completion_menu_bg: palette.background,
    completion_menu_meta_bg: palette.background,
    completion_menu_current_bg: palette.selection,
    completion_menu_meta_current_bg: palette.selection,
    ui_warn: palette.foreground,
    ui_error: palette.foreground,
    ui_ok: palette.foreground,
    ...severityColors(palette.severity),
  });
  return [name + ":", ...Object.entries(colors).map(([key, value]) => `  ${key}: "${value}"`)];
}

const MARK_PALETTE_KEYS = Object.freeze({
  "#FF6337": "primary",
  "#D7F75B": "secondary",
  "#F2EFDF": "foreground",
});

function recolorMarkup(rows, palette) {
  return rows.map((row) => row.replace(/\[#(?:FF6337|D7F75B|F2EFDF)\]/g, (tag) => {
    const oldHex = tag.slice(1, -1);
    return `[${palette[MARK_PALETTE_KEYS[oldHex]]}]`;
  }));
}

// Full per-accent skin per plans/references/lithermes-skin-brief.md. Every key
// is one Hermes 0.19 skin_engine.py reads: colors feeds the classic CLI
// get_color path, dark_colors/light_colors are the TUI polarity pair, and
// spinner wings must be [left, right] pairs (get_spinner_wings drops single
// glyphs, so the brief's flat wing list is shipped as two pairs).
// Hermes picks one face at random for each thinking step and each tool call,
// so the four frames read as a flame moving through "lit" across a turn.
const FLAME_FACES = '["(🔥 lit)", "( 🔥lit)", "(lit🔥 )", "(lit 🔥)"]';
const SPINNER_LINES = Object.freeze([
  `  waiting_faces: ${FLAME_FACES}`,
  `  thinking_faces: ${FLAME_FACES}`,
  "  thinking_verbs: [igniting, lit-looping, planning, verifying, gathering evidence, checking criteria, reviewing]",
]);
// Spinner blocks earlier releases wrote, newest first. A preset whose spinner
// block still matches one of them byte for byte gets the flame faces on the
// next install; everything else in the file, and any edited spinner, stays.
const SHIPPED_SPINNERS = Object.freeze([
  Object.freeze([
    '  waiting_faces: ["(lit)", "(◜)", "(◝)", "(◞)", "(◟)"]',
    '  thinking_faces: ["(lit)", "(✦)", "(◇)", "(⌁)"]',
    "  thinking_verbs: [lit-looping, planning, verifying, gathering evidence, checking criteria, reviewing]",
  ]),
  Object.freeze([
    '  waiting_faces: ["🔥", "🔥", "🔥", "🔥"]',
    "  thinking_verbs: [igniting, forging, burning, tempering]",
  ]),
]);
const spinnerBlock = (lines) => ["spinner:", ...lines, "  wings:"].join("\n");

// LIT identity for the first screen (Hermes 0.23 skin_engine keys). Hermes swaps
// `tool_prefix` for the stock "┊" on every tool row, reads `tool_emojis` per tool
// name, draws `banner_hero` in place of the caduceus in the welcome panel's left
// column (about 30 columns), and prints branding.help_header above /help. The
// hero is the MICRO mark plus the five steps lit runs, so a first-time user reads
// what the word does before typing it. Orange marks the work, lime the proof.
const TOOL_PREFIX = "▌";
const TOOL_EMOJIS = Object.freeze({
  goal_status: "📍",
  goal_set: "🎯",
  goal_add_criterion: "📋",
  goal_evidence: "🧾",
  goal_criterion_status: "✅",
  goal_steer: "🧭",
  goal_status_set: "🚦",
  goal_checkpoint: "📌",
  goal_complete: "🔥",
  lithermes_work_progress: "🔁",
  lithermes_knowledge_capture: "📚",
});
const HELP_HEADER = "(🔥 lit) Available Commands · type lit <task>";
const HERO_STEPS = Object.freeze([
  ["#FF6337", "plan   ", "criteria first"],
  ["#FF6337", "run    ", "every run signed"],
  ["#D7F75B", "review ", "blockers named"],
  ["#D7F75B", "gate   ", "proof, then done"],
  ["#D7F75B", "handoff", "resume anywhere"],
]);

// One colour span per row, closed with `[/]`: the Ink TUI's hero parser
// (ui-tui banner.ts parseRichMarkup) puts every span and every unmarked run on
// its own line, so a row with two spans would print as two rows there. The
// steps keep the LIT orange (work) and lime (proof); `ink` is the accent for
// the frame and the call to action. Named themes recolour the LIT inks.
function heroRows(entry) {
  const theme = entry.palette;
  const ink = theme ? "#F2EFDF" : entry === IGNITION ? "#D7F75B" : entry.hex;
  const plain = (row) => row.replace(/\[[^\]]*\]/g, "");
  const rule = `[${ink}]${"─".repeat(26)}[/]`;
  const rows = [
    ...microLogo().map((row, i) => `[${i < 2 ? "#FF6337" : "#F2EFDF"}]  ${plain(row).trimEnd()}[/]`),
    "",
    "[#FF6337]LIT · keep the work lit[/]",
    rule,
    ...HERO_STEPS.map(([dot, name, line]) => `[${dot}]◆ ${name} ${line}[/]`),
    rule,
    `[${ink}]type lit <your task>[/]`,
  ];
  return theme ? recolorMarkup(rows, theme) : rows;
}

function mixHex(from, to, t) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const channel = (i) => Math.round(a[i] + (b[i] - a[i]) * t).toString(16).padStart(2, "0").toUpperCase();
  return `#${[0, 1, 2].map(channel).join("")}`;
}

// The standard mark with one colour span per row, for the same Ink TUI reason
// as the hero: a per-glyph row would print one glyph per line there. The rows
// run orange -> cream -> lime from top to bottom, the mark's own three inks.
function logoRows(entry) {
  const ink = (hex) => (entry.palette ? entry.palette[MARK_PALETTE_KEYS[hex]] : hex);
  const [top, middle, bottom] = ["#FF6337", "#F2EFDF", "#D7F75B"].map(ink);
  const rows = skinLogo().map((row) => row.replace(/\[[^\]]*\]/g, ""));
  const turn = Math.floor((rows.length - 1) / 2);
  return rows.map((row, i) => {
    if (!row.trim()) return "";
    const colour = i <= turn
      ? mixHex(top, middle, turn ? i / turn : 1)
      : mixHex(middle, bottom, (i - turn) / (rows.length - 1 - turn));
    return `[${colour}]${row}[/]`;
  });
}

function identityBranding() {
  return [`  help_header: "${HELP_HEADER}"`];
}

function identityTail(entry) {
  return [
    `tool_prefix: "${TOOL_PREFIX}"`,
    "tool_emojis:",
    ...Object.entries(TOOL_EMOJIS).map(([tool, glyph]) => `  ${tool}: "${glyph}"`),
    "banner_hero: |2",
    ...heroRows(entry).map((row) => `  ${row}`),
  ];
}

function renderSkinYaml(entry, { spinner = SPINNER_LINES, identity = true } = {}) {
  const h = entry.hex;
  const theme = entry.palette;
  const colorBlocks = theme
    ? [
      ...paletteColorBlock("colors", theme),
      ...paletteColorBlock("dark_colors", TOKYONIGHT_NIGHT_PALETTE),
      ...paletteColorBlock("light_colors", TOKYONIGHT_DAY_PALETTE),
    ]
    : [
      ...(entry === IGNITION ? ignitionColorBlock("colors") : colorBlock("colors", h)),
      ...(entry === IGNITION ? ignitionColorBlock("dark_colors") : colorBlock("dark_colors", h)),
      ...(entry === IGNITION ? ignitionColorBlock("light_colors", true) : colorBlock("light_colors", darkenHex(h), LIT_SEVERITY_LIGHT)),
    ];
  const welcomeRows = theme ? recolorMarkup(microLogo(), theme) : microLogo();
  const legacyLogo = theme ? recolorMarkup(skinLogo(), theme) : skinLogo();
  return [
    `name: ${skinName(entry.accent)}`,
    `description: LitHermes ${entry.label} accent HUD`,
    ...colorBlocks,
    "spinner:",
    ...spinner,
    "  wings:",
    '    - ["◜", "◝"]',
    '    - ["◞", "◟"]',
    "branding:",
    "  agent_name: LitHermes",
    "  response_label: lit",
    '  prompt_symbol: "🔥 ›"',
    ...(entry === IGNITION || theme
      ? ["  welcome: |", ...welcomeRows.map((row) => `    ${row}`), "    LitHermes", "    LIT ready"]
      : ["  welcome: LIT ready"]),
    "  goodbye: stay lit",
    ...(identity ? identityBranding() : []),
    "banner_logo: |2",
    ...(identity ? logoRows(entry) : legacyLogo).map((row) => `  ${row}`),
    ...(identity ? identityTail(entry) : []),
    "",
  ].join("\n");
}

// Every skin file earlier releases wrote, as sha256 of its exact bytes (the
// first skins, the spinner rename, and the shape before the identity keys). A file that still matches one is a
// pristine shipped file, so the identity keys may be added to it; any other
// byte (an edited colour, a user comment) keeps the file exactly as it is.
const SHIPPED_SKIN_SHA256 = Object.freeze({
  "cyan": Object.freeze([
    "f572ab49a1c8dda9ac8afb588e8f9b06e7a4a9187efa9432f601e247f6b043dc",
    "631adfd4cf325ec6e3174f8a483be09eea47f79365c900363b8a30743889790b",
    "886c7b99a55d1420ad4d16b77561034e73cf8b7d203ca2209fead9b22b8792e9",
  ]),
  "blue": Object.freeze([
    "b945bbe200b09b02ca9da0f44ccd4106230ba121220b96fe207425fe0ccdbcfd",
    "dad76a9f5f17a81ef23d7c944d81529d12e1f91038044011f26b0af38844d9b9",
    "56852bbc3b55acd14d276d57373afbafcd3420b1893648a7df7e7d1857247887",
  ]),
  "teal": Object.freeze([
    "6fa88e43838883a2cb2324a96475cb1fb8ee69927710e1f01db6cf7423a545d8",
    "8db71da7d7dbeb8253303fcf25100c5824881b5b64dbf694696d23240052a53e",
    "8deeca66d5447b8388099f6e6ed3b3876e14cec5010d4190d97bc492f15c8e02",
  ]),
  "green": Object.freeze([
    "68bd6264c7479349d2ae9a44b8ab1a82d13f77c864d3128f9dc807f81c5bb389",
    "c870117d34ee9789708836d305dc96cef0f7992810bc9fe3dd7a43c84d1676e2",
    "ebf735d3d1739c7b7af6facefddd99e64b7b0ab7a9e7884e627445e54b7da0d6",
  ]),
  "lavender": Object.freeze([
    "31d9042c1c3dbaa320f9bb5ae720337e28f0e5eb6c1b00515117da543eba93da",
    "d3e80a0ce91eaac83a12485303a42bbd710041fc12e897c7960ad53811e4a23f",
    "d41cdc829f7b659eb0a963c8a47e3de29f0197ed15b29495895cd405238e78c2",
  ]),
  "rose": Object.freeze([
    "6ffed3e45a4fa09008896cc05445d9d905f4e7d54fae53c671fa5170b493a656",
    "e4cd8d59cd5d9428e0001bdc5588d4a3d33026888766f6d7c945c7a6956f0e03",
    "3b0395247ca8c28cb3e3bfff4b0572d94eec56ca8785fce834cd39f63d71c366",
  ]),
  "gold": Object.freeze([
    "dbbdddb1d5828c209fc09f9f27150c802b57208ac4aca0725212440c21314548",
    "0189b8c3cfc5fea89f6061cf432bafbd7159efbbbbaa5876374538a9d592c523",
    "3ee7ef13a78d17ebd77e4c489c3cc2e70b8d6e5d62740df192fda7aa6fca5963",
  ]),
  "orange": Object.freeze([
    "769983e5fd7a41c49feb8e1fab6026423b2c47858c4f95e049ee67496221e589",
    "d8579b5417df2b6e26859f11be8a4c0f287aedd0fd37ac8f666efa2dc539469e",
    "0d03e38a7f835feaded6ea4315809cddd82afa1836cb42911dcea0b3ad5bae2f",
  ]),
  "slate": Object.freeze([
    "7fd25a50d11863c72af8ae1c4f0a969b71346726417b3b9a0e175b9747aac3de",
    "8c62c12e54c17068dd5371d87d66ea9ec2b204de7280f81592bfba0b765fff93",
    "68e3c25a6e3771f5572fb7735afc7676302abdde9d2fe9a19f225d4ae968ae97",
  ]),
  "gray": Object.freeze([
    "cbac11a0dd88858c6e7bc8ba54b0da624f8bc73daa79ee29ddd19403a6a1e607",
    "696795f8b569988cbf20fa0f15a0cde2b485cdcbb4e503b7b12d8a0b122c999a",
    "40c78df51043a546f068be6c882b4a81ffc1bf91deb09150a5f8d40631a371f9",
  ]),
  "ignition": Object.freeze([
    "143452d7e5c2502379102089ce6a4630ce1fa825e334e7e479374208db8d9b7b",
    "3282c9d9416ec4d2678b3d8bcdc2f20f6709ba25611328d90666f04a5d87ce06",
    "0c1ae240a7b38d64448f92496b8e79a1ab0c6c2e8686b7f60716cc274d2be62d",
  ]),
  "tokyonight-day": Object.freeze([
    "3cee630bc9e50ef5e3671eab8cf94a099256f67d9429f75901002b6b75ecbe33",
    "73959e82dbb290924471606543830af5a1de9ee0cae9cb9d0d964c10f9997492",
    "1d03670dbd1652ed6cd84874bf7726f7bc4a0fe76abdd2b3a0727a3b7ec08314",
  ]),
  "tokyonight": Object.freeze([
    "77e0cdfedb7ff8e4ddd25da4254d2aa7a25c7128a754c29e0678dbf6b7ac946a",
    "7b28474b0b1b5eedd9058439e0462494b5f339e69a01f9a26010997a69a67ab2",
    "ae0a2961d12bd9434757010b9d385659b0e822241ea03c9d354b2007515801ac",
  ]),
});

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

function isShippedSkin(text, entry) {
  return (SHIPPED_SKIN_SHA256[entry.accent] || []).includes(sha256(text));
}

// Called only on a file that is byte for byte one an earlier release shipped:
// adds help_header at the end of the branding block and the three identity keys
// after the last line, and redraws the banner_logo rows one span per row. Every
// other line stays byte for byte.
function addIdentityKeys(text, entry) {
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  const start = lines.indexOf("branding:");
  if (start === -1 || /^tool_prefix:|^tool_emojis:|^banner_hero:/m.test(text)) return text;
  let end = start + 1;
  while (end < lines.length && /^\s/.test(lines[end])) end += 1;
  const branding = lines.slice(start + 1, end).some((line) => line.startsWith("  help_header:")) ? [] : identityBranding();
  const merged = [...lines.slice(0, end), ...branding, ...lines.slice(end)];
  const logo = merged.indexOf("banner_logo: |2");
  if (logo !== -1) {
    let last = logo + 1;
    while (last < merged.length && (merged[last] === "" || /^\s/.test(merged[last]))) last += 1;
    merged.splice(logo + 1, last - logo - 1, ...logoRows(entry).map((row) => `  ${row}`));
  }
  return [...merged, ...identityTail(entry), ""].join("\n");
}

function findAccent(token) {
  const raw = String(token == null ? "" : token).trim().toLowerCase();
  if (!raw) return null;
  const bare = raw.startsWith("lithermes-") ? raw.slice("lithermes-".length) : raw;
  if (bare === IGNITION.accent) return IGNITION;
  const named = NAMED_THEMES.find((entry) => entry.accent === bare);
  if (named) return named;
  const byName = HUD_ACCENTS.find((a) => a.accent === bare);
  if (byName) return byName;
  if (/^\d+$/.test(raw)) {
    const idx = Number(raw) - 1;
    if (idx >= 0 && idx < HUD_ACCENTS.length) return HUD_ACCENTS[idx];
  }
  return null;
}

function installSkins(hermesHome) {
  const dir = skinsDir(hermesHome);
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const entry of [...HUD_ACCENTS, IGNITION, ...NAMED_THEMES]) {
    const file = path.join(dir, `${skinName(entry.accent)}.yaml`);
    // Existing names may belong to the user, including edited shipped presets.
    // Exclusive creation also preserves a file or symlink created concurrently.
    try {
      fs.writeFileSync(file, renderSkinYaml(entry), { encoding: "utf8", flag: "wx", mode: 0o600 });
      written.push(file);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (upgradeShippedSkin(file, entry)) written.push(file);
    }
  }
  return written;
}

function readRegularSkin(file) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.size > 64 * 1024) return null;
  return fs.readFileSync(file, "utf8");
}

// A shipped spinner block is moved to the flame faces, and a file whose bytes are a
// shipped release (before or after that move) also gets the identity keys.
function upgradeShippedSkin(file, entry) {
  const text = readRegularSkin(file);
  if (text == null) return false;
  const pristine = isShippedSkin(text, entry);
  const spun = upgradeShippedSpinner(file);
  const current = spun ? fs.readFileSync(file, "utf8") : text;
  if (!pristine && !isShippedSkin(current, entry)) return spun;
  const merged = addIdentityKeys(current, entry);
  if (merged === current) return spun;
  writeFileAtomic(file, merged, "utf8");
  return true;
}

function upgradeShippedSpinner(file) {
  const text = readRegularSkin(file);
  if (text == null) return false;
  const shipped = SHIPPED_SPINNERS.map(spinnerBlock).find((block) => text.split(block).length === 2);
  if (!shipped) return false;
  writeFileAtomic(file, text.replace(shipped, spinnerBlock(SPINNER_LINES)), "utf8");
  return true;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function supportsColor({ stream = process.stdout, env = process.env } = {}) {
  return colorMode({ stream, env }) !== "none";
}

// Accent swatch (●●) used to preview an accent in the picker list. Prefers the
// exact ANSI-256 `code` in bold+bright for a neon-glow feel; falls back to
// 24-bit truecolor from hex. No-color path returns a plain asterisk.
function swatch(hex, { color = true, code = null } = {}) {
  if (!color) return "*";
  // Bold (\x1b[1m) + ANSI-256 fg + double dot for width/glow feel + reset
  if (code != null) return `\x1b[1m\x1b[38;5;${code}m●●\x1b[0m`;
  const rgb = hexToRgb(hex);
  if (!rgb) return "*";
  return `\x1b[1m\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m●●\x1b[0m`;
}

module.exports = {
  HUD_ACCENTS,
  IGNITION,
  TOKYONIGHT_DAY,
  TOKYONIGHT,
  NAMED_THEMES,
  darkenHex,
  skinName,
  skinsDir,
  renderSkinYaml,
  SHIPPED_SPINNERS,
  SHIPPED_SKIN_SHA256,
  addIdentityKeys,
  TOOL_EMOJIS,
  findAccent,
  installSkins,
  hexToRgb,
  supportsColor,
  swatch,
};
