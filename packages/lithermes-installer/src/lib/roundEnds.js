const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { configHasLitHermes, readConfig } = require("./config");
const { readSettings, widgetSource } = require("./tuiCard");

// The rules are the TUI card's own, so this line and every surface agree.
const rules = () => import(pathToFileURL(widgetSource).href);

// The two surfaces are the goal card of `hermes --tui` and the classic CLI's HUD card. Both come with
// the plugin, and the second has no switch of its own.
function surfaceOn(home) {
  return fs.existsSync(path.join(home, "plugins", "lithermes")) && configHasLitHermes(readConfig(home));
}

// Why this terminal shows a plain card, as [reason, fix]. Only a terminal's own environment can say so.
function plainTerminal(env) {
  if ("NO_COLOR" in env) return ["NO_COLOR is set here", "start Hermes without it"];
  if (env.TERM === "dumb") return ["TERM=dumb", "start Hermes in a full-colour terminal"];
  if (!/truecolor|24bit/i.test(env.COLORTERM || "") && !/direct/i.test(env.TERM || "")) return ["this terminal reports fewer colours", "start Hermes in a full-colour terminal"];
  if (!/^(?:|.*utf-?8.*)$/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || "")) return ["this locale is not UTF-8", "set LANG to a UTF-8 locale"];
  return ["this terminal reports a light ground", "use a dark ground"];
}

/** The one line that closes an install, an update and a doctor run. `fontWhy` says why `--round` added no font. */
async function roundEndsLine({ home, env = process.env, stream = process.stdout, platform = process.platform, fontWhy = null, hasIconFont = null }) {
  const widget = await rules();
  const square = (reason, fix) => `ROUND_ENDS: square (${reason.replace(/;/g, ",")}; ${fix})`;
  if (!surfaceOn(home)) return square("no surface enabled", "run the install");
  const asked = widget.glyphSetting(env);
  const saved = readSettings(home).glyphs;
  const choice = asked || saved || "auto";
  const word = `LITHERMES_HUD_GLYPHS is ${(env.LITHERMES_HUD_GLYPHS || "").trim().toLowerCase()}`;
  const check = (why) => `ROUND_ENDS: check (${why}; show your user " LIT " and rerun the install `
    + "with --glyphs round if both ends are round, or --glyphs square if they are boxes)";
  if (choice === "square") {
    return asked
      ? square(word, "unset it")
      : square("the choice is square", "rerun the install with --glyphs auto");
  }
  if (stream.isTTY && !widget.isRich(env)) return square(...plainTerminal(env));
  // Only a saved round is the user's own word; the environment speaks for this shell alone.
  if (choice === "round") return saved === "round" ? "ROUND_ENDS: shown" : check(`${word} in this shell, and no round choice is saved`);
  const auto = { ...env, LITHERMES_HUD_GLYPHS: "auto" };
  if (widget.hasRoundCaps(auto, "auto", () => false)) return `ROUND_ENDS: ready${stream.isTTY ? "" : " in a dark full-colour terminal"}`;
  if (!widget.hasRoundCaps(auto, "auto", () => true)) return square("SSH, so the fonts here are not the ones on screen", "rerun the install with --glyphs round if your user sees round ends");
  if ((hasIconFont || widget.hasIconFont)(env)) {
    return check("an icon font is here, and this terminal is not known to draw the ends itself");
  }
  if (fontWhy) return square(`font not installed: ${fontWhy}`, "rerun the install with --round");
  if (platform === "win32") return square("Windows console", "start Hermes in Windows Terminal");
  return square("no icon font", "rerun the install with --round");
}

module.exports = { roundEndsLine, rules };
