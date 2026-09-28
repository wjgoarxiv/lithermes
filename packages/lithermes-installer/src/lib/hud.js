const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const skins = require("./skins");
const {
  readConfig,
  writeConfig,
  setDisplaySkinConfig,
  clearDisplaySkinConfig,
  readDisplaySkinConfig,
} = require("./config");

function resolveHome(flags = {}) {
  const fromFlag = flags["hermes-home"];
  if (typeof fromFlag === "string" && fromFlag.trim()) return path.resolve(fromFlag);
  const env = (process.env.HERMES_HOME || "").trim();
  if (env) return path.resolve(env);
  return path.join(os.homedir(), ".hermes");
}

// ANSI helpers — all output goes through these so no-color paths stay clean.
const BOLD  = (s, on) => on ? `\x1b[1m${s}\x1b[22m` : s;
const DIM   = (s, on) => on ? `\x1b[2m${s}\x1b[22m` : s;
const FG256 = (code, s, on) => on ? `\x1b[38;5;${code}m${s}\x1b[39m` : s;

function listHud({ color = false, hermesHome = null } = {}) {
  const current = hermesHome ? readDisplaySkinConfig(readConfig(hermesHome)) : null;

  // Header — fire brand mark + neon label when color is on
  const brand = color ? "🔥" : "[fire]";
  const header = color
    ? `${brand} ${BOLD("LitHermes HUD", true)} ${DIM("— neon accents", true)}`
    : `${brand} LitHermes HUD — neon accents`;
  const lines = [header, ""];
  const ignitionActive = current === skins.skinName(skins.IGNITION.accent) ? " *" : "";
  lines.push(`      ${skins.swatch(skins.IGNITION.hex, { color })} ignition  orange / lime / ivory / navy${ignitionActive}`);

  for (const theme of skins.NAMED_THEMES) {
    const sw = skins.swatch(theme.hex, { color });
    const activeMark = current === skins.skinName(theme.accent) ? (color ? " 🔥" : " *") : "";
    const label = color ? BOLD(skins.skinName(theme.accent), true) : skins.skinName(theme.accent);
    lines.push(`      ${sw} ${label}  ${theme.label}${activeMark}`);
  }

  skins.HUD_ACCENTS.forEach((a, i) => {
    const sw = skins.swatch(a.hex, { color, code: a.code });
    const isActive = current === skins.skinName(a.accent);

    // Active indicator: 🔥 in color, * in plain
    const activeMark = isActive ? (color ? " 🔥" : " *") : "";

    // Mood label — dimmed in color mode for a secondary-info feel
    const moodText = a.mood ? `  ${DIM(a.mood, color)}` : "";

    // Accent name — bold + accent color when active, plain bold otherwise
    const accentLabel = color
      ? (isActive
          ? BOLD(FG256(a.code, a.accent.padEnd(9), true), true)
          : BOLD(a.accent.padEnd(9), true))
      : a.accent.padEnd(9);

    const hexLabel = color ? DIM(a.hex, true) : a.hex;

    lines.push(
      `  ${String(i + 1).padStart(2)}. ${sw} ${accentLabel} ${hexLabel}${moodText}${activeMark}`
    );
  });

  lines.push("");
  const applyCmd  = color ? BOLD("lithermes hud <accent>", true) : "lithermes hud <accent>";
  const clearCmd  = color ? BOLD("lithermes hud off", true) : "lithermes hud off";
  const skinCmd   = color ? BOLD("/skin lithermes-<accent>", true) : "/skin lithermes-<accent>";
  lines.push(`Apply:     ${applyCmd}   (e.g. lithermes hud rose, or hud 1)`);
  lines.push(`Clear:     ${clearCmd}`);
  lines.push(`In Hermes: ${skinCmd}  (or set display.skin in config.yaml)`);
  return lines.join("\n");
}

function applyHud(token, flags = {}) {
  const entry = skins.findAccent(token);
  if (!entry) {
    const names = [
      ...skins.HUD_ACCENTS.map((a) => a.accent),
      skins.IGNITION.accent,
      ...skins.NAMED_THEMES.map((a) => skins.skinName(a.accent)),
    ].join(", ");
    const err = new Error(`unknown accent '${token}'. choose one of: ${names}`);
    err.exitCode = 4;
    throw err;
  }
  const home = resolveHome(flags);
  const written = skins.installSkins(home);
  const name = skins.skinName(entry.accent);
  const before = readConfig(home);
  const after = setDisplaySkinConfig(before, name);
  if (after !== before) writeConfig(home, after);
  return [
    `LitHermes HUD set to ${entry.label} (${name}).`,
    `Installed ${written.length} skins -> ${skins.skinsDir(home)}`,
    `config: display.skin: ${name}`,
    `Restart Hermes, or run \`/skin ${name}\` in a session, to apply.`,
  ].join("\n");
}

function clearHud(flags = {}) {
  const home = resolveHome(flags);
  const before = readConfig(home);
  const after = clearDisplaySkinConfig(before);
  if (after !== before) writeConfig(home, after);
  return "LitHermes HUD cleared (display.skin removed). Restart Hermes to revert to the default skin.";
}

// Interactive accent picker used during `lithermes install` on a TTY.
// Returns the chosen accent entry, or null to skip (empty / unknown answer).
function promptAccent({ input = process.stdin, output = process.stdout, color = false } = {}) {
  return new Promise((resolve) => {
    output.write("Choose a Hermes HUD accent:\n");
    output.write("      ignition  orange / lime / ivory / navy\n");
    skins.HUD_ACCENTS.forEach((a, i) => {
      const sw = skins.swatch(a.hex, { color, code: a.code });
      output.write(`  ${String(i + 1).padStart(2)}. ${sw} ${a.accent}\n`);
    });
    const rl = readline.createInterface({ input, output, terminal: color && Boolean(output.isTTY) });
    // Resolve to null if the stream closes without an answer (e.g. piped input
    // that ends without a newline); the question callback resolves first when an
    // answer arrives, so this is a no-op in the normal path.
    rl.on("close", () => resolve(null));
    rl.question("Pick 1-10 or name, including ignition (Enter to skip): ", (answer) => {
      resolve(skins.findAccent(answer)); // resolve BEFORE close so the answer wins
      rl.close();
    });
  });
}

module.exports = { resolveHome, listHud, applyHud, clearHud, promptAccent };
