const path = require("node:path");
const readline = require("node:readline");
const { pathToFileURL } = require("node:url");
const { installLitHermes, previewModelRoute, previewUninstall, uninstallLitHermes } = require("./lib/install");
const { pickModelRoute, promptModelRouteSession, renderInstallBanner, routeFromConfig } = require("./lib/modelPrompt");
const { checkLitHermes, doctorLitHermes } = require("./lib/check");
const { cardTerminal, cardWidth, createCards } = require("./lib/cards");
const { INSTALL_STEPS, createSpinner, receiptSections, renderInstallReceipt, shouldUseSpinner, stepTarget } = require("./lib/spinner");
const { listHud, applyHud, clearHud, previewClearHud, previewHud, hudCaps, hudCard, pickAccent, promptAccent, resolveHome } = require("./lib/hud");
const { CAPS, applyCaps, readSettings, widgetSource } = require("./lib/tuiCard");
const { HELP_LINE, POINTER, agentGuide } = require("./lib/agentGuide");
const { addIconFont, planIconFont } = require("./lib/iconFont");
const { roundEndsLine, rules } = require("./lib/roundEnds");
const { supportsColor, findAccent } = require("./lib/skins");
const {
  readConfig,
  readBellOnCompleteConfig,
  setBellOnCompleteConfig,
  readDisplaySkinConfig,
  readOutputStyleConfig,
  setOutputStyleConfig,
  writeConfig,
} = require("./lib/config");
const { extensionsNoticeLines, leftoverPaths } = require("./lib/sessionNotices");
const { VERBS, extensionsSummary, runExtensions } = require("./lib/extensions");
const {
  runAutomaticUpdate,
  scheduleUpdateCheck,
  shouldAutoUpdate,
} = require("./lib/updateNotifier");

// Every option the CLI understands. A flag is a boolean switch unless it is listed in VALUE_FLAGS.
const VALUE_FLAGS = new Set([
  "hermes-home", "hermes-repo", "provider", "model", "effort", "child-provider", "child-model", "child-effort",
  "hud", "style", "glyphs", "installed-version", "from", "family", "older-than",
]);

const CAPS_USAGE = "auto|round|square";

// What each command accepts, and how help shows it. A command refuses anything not listed here.
const HOME = { "hermes-home": "PATH" };
const COMMAND_SPECS = {
  install: {
    usage: "install",
    positionals: [0, 0],
    flags: {
      yes: "", "dry-run": "", offline: "", json: "", force: "", "reconfigure-model": "",
      provider: "ID", model: "ID", effort: "LEVEL", "child-provider": "ID", "child-model": "ID", "child-effort": "LEVEL",
      spinner: "", "no-spinner": "", hud: "<accent>", "no-hud": "", style: "ID", "no-style": "", bell: "", "no-bell": "",
      round: "", glyphs: CAPS_USAGE, agent: "",
      "patch-installed-hermes": "", "no-patch-installed-hermes": "", "no-auto-update": "", ...HOME, "hermes-repo": "PATH",
    },
  },
  check: {
    usage: "check",
    positionals: [0, 0],
    flags: { offline: "", "gateway-offline": "", json: "", "no-auto-update": "", ...HOME, "hermes-repo": "PATH" },
  },
  doctor: {
    usage: "doctor",
    positionals: [0, 0],
    flags: { offline: "", json: "", "no-auto-update": "", ...HOME, "hermes-repo": "PATH" },
  },
  uninstall: {
    usage: "uninstall",
    positionals: [0, 0],
    flags: { yes: "", "dry-run": "", "rollback-patches": "", offline: "", "no-auto-update": "", ...HOME, "hermes-repo": "PATH" },
  },
  hud: {
    usage: "hud [<accent>|off|card [on|still|off]|caps [round|square|auto]]",
    positionals: [0, 2],
    flags: { list: "", "dry-run": "", ...HOME },
    note: "(Hermes HUD skin accents and the TUI goal card)",
  },
  extensions: {
    usage: "extensions list|check|install|update|remove|prune-backups [<id>...]",
    positionals: [1, Infinity],
    actions: VERBS,
    flags: {
      json: "", from: "PATH", family: "NAME", all: "", yes: "", "dry-run": "", "allow-shadow": "", "older-than": "DAYS", ...HOME,
    },
    note: "(LitFamily extensions in the profile's skills/; writes only with --yes)",
  },
  version: { usage: "version", positionals: [0, 0], flags: {} },
  help: { usage: "help", positionals: [0, 1], flags: {}, hidden: true },
  // Private bridge for the installed plugin's automatic update; deliberately absent from help.
  "__auto-update": { usage: "__auto-update", positionals: [0, 0], flags: { ...HOME, "installed-version": "VERSION" }, hidden: true },
};

const COMMAND_ALIASES = { "--version": "version", "-v": "version", "--help": "help", "-h": "help" };

class UsageError extends Error {
  constructor(message) {
    super(`${message}\nRun \`lithermes help\` for the options each command accepts.`);
    this.exitCode = 2;
  }
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  const problems = [];
  let helpRequested = false;
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (positionals.length === 0 && COMMAND_ALIASES[item]) {
      positionals.push(COMMAND_ALIASES[item]);
      continue;
    }
    if (item === "--help" || item === "-h") {
      helpRequested = true;
      continue;
    }
    if (!item.startsWith("-") || item === "-") {
      positionals.push(item);
      continue;
    }
    if (!item.startsWith("--")) {
      problems.push(`unknown option '${item}'`);
      continue;
    }
    const equals = item.indexOf("=");
    const key = equals === -1 ? item.slice(2) : item.slice(2, equals);
    const inline = equals === -1 ? undefined : item.slice(equals + 1);
    if (VALUE_FLAGS.has(key)) {
      const value = inline ?? argv[i + 1];
      if (value === undefined || value === "" || (inline === undefined && value.startsWith("-"))) {
        problems.push(`option '--${key}' needs a value`);
        continue;
      }
      flags[key] = value;
      if (inline === undefined) i += 1;
      continue;
    }
    if (inline === undefined || inline === "true") flags[key] = true;
    else if (inline !== "false") problems.push(`option '--${key}' expects true or false, not '${inline}'`);
  }
  return { command: positionals[0] || "help", flags, positionals, problems, helpRequested };
}

// Refuse before anything runs: unknown options, options another command owns, and stray words.
function validateArgs({ command, flags, positionals, problems }) {
  const spec = COMMAND_SPECS[command];
  if (!spec) throw new UsageError(`lithermes: unknown command '${command}'.`);
  const issues = [...problems];
  for (const key of Object.keys(flags)) {
    if (!Object.prototype.hasOwnProperty.call(spec.flags, key)) issues.push(`unknown option '--${key}'`);
  }
  if (flags.glyphs !== undefined && !CAPS.includes(flags.glyphs)) issues.push(`option '--glyphs' expects auto, round or square, not '${flags.glyphs}'`);
  const extra = positionals.slice(1);
  const [min, max] = spec.positionals;
  if (extra.length > max) issues.push(`unexpected argument '${extra[max]}'`);
  else if (extra.length < min) issues.push(spec.actions ? `missing action (${spec.actions.join(" or ")})` : "missing argument");
  else if (spec.actions && !spec.actions.includes(extra[0])) issues.push(`unexpected argument '${extra[0]}' (expected ${spec.actions.join(" or ")})`);
  if (issues.length) throw new UsageError(`lithermes ${command}: ${issues.join("; ")}.`);
}

function helpText() {
  const lines = [HELP_LINE, "", "lithermes commands:"];
  for (const spec of Object.values(COMMAND_SPECS)) {
    if (spec.hidden) continue;
    const options = Object.entries(spec.flags).map(([key, value]) => `[--${key}${value ? ` ${value}` : ""}]`);
    const rows = [];
    let row = `  ${spec.usage}`;
    for (const option of options) {
      if (row.length + option.length + 1 > 100) {
        rows.push(row);
        row = `${" ".repeat(spec.usage.length + 2)} ${option}`;
      } else row += ` ${option}`;
    }
    rows.push(spec.note && row.length + spec.note.length < 100 && !spec.note.includes("MIT") ? `${row}   ${spec.note}` : row);
    if (spec.note && spec.note.includes("MIT")) rows.push(`  ${spec.note}`);
    lines.push(...rows);
  }
  lines.push("  --dry-run (or --dry-run=true) shows what a command would change and changes nothing; --dry-run=false runs it normally.");
  return lines.join("\n");
}

function packageVersion() {
  const pkg = require(path.join(__dirname, "..", "package.json"));
  // Print the command/brand name (the bin), not the npm package name — the
  // command is `lithermes` even though the npm package is named `@litfamily/lithermes`.
  const brand = Object.keys(pkg.bin || {})[0] || pkg.name;
  return `${brand} ${pkg.version}`;
}

function printCommandBanner(command, flags, runtime = {}) {
  // Keep machine-oriented routes byte-stable: their stdout is consumed as a
  // version line or JSON receipt rather than a human-facing command report.
  if (flags.json || command === "version" || command === "__auto-update") return;
  const env = runtime.env || process.env;
  const streams = runtime.streams || { stdout: process.stdout };
  const output = streams.stdout || process.stdout;
  const input = streams.stdin || process.stdin;
  const version = require(path.join(__dirname, "..", "package.json")).version;
  const rows = renderInstallBanner({
    version, env, stream: output,
    over: command === "install" && cardTerminal({ input, output, env, flags }) ? cardWidth(output.columns || 80) : 0,
    color: !flags.yes && !flags["dry-run"] && supportsColor({ stream: output, env }),
  }).split("\n");
  const person = (runtime.isInteractive ?? Boolean(input.isTTY && output.isTTY)) && !("CI" in env);
  // Under the first line of the plain banner; a drawn mark stays whole.
  if (!person && (command === "install" || command === "help")) rows.splice(rows.length === 2 ? 1 : rows.length, 0, POINTER);
  output.write(`${rows.join("\n")}\n`);
}

function scheduleUpdateSafely(command, flags, runtime = {}) {
  try {
    const pkg = require(path.join(__dirname, "..", "package.json"));
    const schedule = runtime.scheduleUpdateCheck || scheduleUpdateCheck;
    schedule({ command, flags, currentVersion: pkg.version });
  } catch {
    // Update advice must never change command output or exit behavior.
  }
}

async function runLifecycleUpdateSafely(command, flags, runtime = {}) {
  try {
    const pkg = require(path.join(__dirname, "..", "package.json"));
    const hermesHome = resolveHome(flags);
    const gate = runtime.shouldAutoUpdate || shouldAutoUpdate;
    const eligible = gate({
      trigger: "cli",
      command,
      flags,
      env: runtime.env || process.env,
      streams: runtime.streams || { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
      hermesHome,
      existsSync: runtime.existsSync,
      isNodeRuntime: runtime.isNodeRuntime,
      isInteractive: runtime.isInteractive,
    });
    if (!eligible) return { status: "skipped", reason: "ineligible" };
    const update = runtime.runAutomaticUpdate || runAutomaticUpdate;
    return await update({
      currentVersion: pkg.version,
      hermesHome,
      env: runtime.env || process.env,
      now: runtime.now,
      fetchLatestVersionFn: runtime.fetchLatestVersionFn,
      spawnSync: runtime.spawnSync,
      doctor: runtime.doctor,
      timeoutMs: runtime.timeoutMs,
    });
  } catch {
    // An update failure is fail-open for the requested management command. The
    // transaction function itself records a redacted receipt when it got far
    // enough to mutate a profile.
    return { status: "failed", reason: "automatic-update-error" };
  }
}

// Interactive model-route selection (installer choice contract). Runs only on
// a real TTY without --yes, and presents the current route as the defaults for
// both fresh and already-configured homes. Returns "chosen" when the prompts
// ran and the user confirmed via the summary card, "aborted" on a refused card,
// and null when the prompts do not apply. Consent is granted ONLY by that
// explicit Enter: fallback and unsafe-stop previews leave the --yes gate
// untouched.
async function maybePromptModelRoute(flags, runtime = {}, cards = null) {
  if (flags.yes || flags["dry-run"] || flags.json) return null;
  const env = runtime.env || process.env;
  const streams = runtime.streams || { stdin: process.stdin, stdout: process.stdout };
  const input = streams.stdin || process.stdin;
  const output = streams.stdout || process.stdout;
  const interactive = runtime.isInteractive ?? Boolean(input.isTTY && output.isTTY);
  if (!interactive || "CI" in env) return null;
  let preview;
  try {
    preview = previewModelRoute(flags);
  } catch {
    return null;
  }
  if (preview.action !== "write" && preview.action !== "preserve") return null;
  const currentRoute = routeFromConfig(readConfig(resolveHome(flags)));
  if (cards) cards.note(`Installs into ${resolveHome(flags)}. Nothing is written before you confirm the model route.`);
  const { confirmed, route } = cards
    ? await pickModelRoute({ ui: cards, configPath: preview.configPath, env, preset: currentRoute })
    : await promptModelRouteSession({
      configPath: preview.configPath,
      env,
      input,
      output,
      preset: currentRoute,
    });
  if (!confirmed) return "aborted";
  const routeChanged = ["provider", "model", "effort", "childProvider", "childModel", "childEffort"]
    .some((key) => route[key] !== currentRoute[key]);
  if (preview.action === "preserve" && routeChanged) flags["reconfigure-model"] = true;
  flags.provider = route.provider;
  flags.model = route.model;
  flags.effort = route.effort;
  flags["child-provider"] = route.childProvider;
  flags["child-model"] = route.childModel;
  flags["child-effort"] = route.childEffort;
  flags.yes = true;
  return "chosen";
}

const STYLE_MENU = [
  { id: "asd-ste100",    label: "ASD-STE100 (English)" },
  { id: "asd-ste100-ko", label: "ASD-STE100 (한국어)" },
  { id: "eli5",          label: "ELI5 (English)" },
  { id: "eli5-ko",       label: "ELI5 (한국어)" },
];

const logLine = (label, text) => console.log(text);

async function maybePickOutputStyle(flags, { prompt = false, cards = null, report = logLine } = {}) {
  if (flags["dry-run"]) return;
  const home = resolveHome(flags);
  const current = readOutputStyleConfig(readConfig(home));
  let chosen = null;
  if (typeof flags.style === "string" && flags.style.trim()) {
    const styleId = flags.style.trim();
    if (!STYLE_MENU.some((s) => s.id === styleId)) {
      console.error(`Output style: unknown id '${styleId}'; skipping (valid: ${STYLE_MENU.map((s) => s.id).join(", ")}).`);
      return;
    }
    chosen = styleId;
  } else if (flags["no-style"] || !prompt) {
    return;
  } else if (cards) {
    const index = await cards.pick({
      title: "Output style",
      note: "Sets how Hermes words its replies; None keeps the style you use now.",
      choices: [
        { label: "None / keep current", detail: current ? `now ${current}` : "", folded: "kept as it is" },
        ...STYLE_MENU.map(({ id, label }) => ({ label, detail: id })),
      ],
      ctrlCSkips: supportsColor(),
    });
    chosen = index ? STYLE_MENU[index - 1].id : null;
  } else {
    chosen = await (new Promise((resolve) => {
      process.stdout.write("Choose an output style:\n");
      process.stdout.write(`   0. None / keep current${current ? ` (${current})` : ""}\n`);
      STYLE_MENU.forEach((s, i) => process.stdout.write(`   ${i + 1}. ${s.label}\n`));
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: supportsColor() });
      rl.on("close", () => resolve(null));
      rl.question("Pick 0-4 (Enter to skip): ", (answer) => {
        const trimmed = answer.trim();
        const num = parseInt(trimmed, 10);
        if (!trimmed || trimmed === "0" || Number.isNaN(num)) { resolve(null); }
        else if (num >= 1 && num <= STYLE_MENU.length) { resolve(STYLE_MENU[num - 1].id); }
        else { resolve(null); }
        rl.close();
      });
    }));
  }
  if (chosen) {
    const before = readConfig(home);
    const after = setOutputStyleConfig(before, chosen);
    if (after !== before) writeConfig(home, after);
    report("Output style", `Output style set to '${chosen}'.`);
  }
}

// A HUD accent is set by --hud or by an answer to the question; --yes picks none.
async function maybePickHudAccent(flags, runtime = {}, { promptForAccent = false, cards = null, report = logLine } = {}) {
  if (flags["dry-run"]) return;
  let entry = null;
  if (typeof flags.hud === "string" && flags.hud.trim()) {
    entry = findAccent(flags.hud);
    if (!entry) {
      console.error(`HUD: unknown accent '${flags.hud}'; skipping (run \`lithermes hud --list\`).`);
      return;
    }
  } else if (flags["no-hud"]) {
    return;
  } else if (promptForAccent) {
    const streams = runtime.streams || { stdin: process.stdin, stdout: process.stdout };
    const color = supportsColor({ stream: streams.stdout || process.stdout, env: runtime.env || process.env });
    const chosen = cards
      ? await pickAccent({ ui: cards, current: readDisplaySkinConfig(readConfig(resolveHome(flags))), ctrlCSkips: color })
      : await promptAccent({
        input: streams.stdin || process.stdin,
        output: streams.stdout || process.stdout,
        color,
      });
    if (chosen) {
      report("HUD accent", applyHud(chosen.accent, flags));
    }
    return;
  }
  if (entry) report("HUD accent", applyHud(entry.accent, flags));
}

// Hermes rings the terminal bell (plus a desktop notice) at the end of a turn
// when display.bell_on_complete is true; its default is off. The installer sets
// it only on --bell or a "y" to the interactive question, never changes a value
// the user already chose, and leaves config.yaml alone when the edit is not
// clean or the file changed while the question was open.
async function maybeOfferBell(flags, runtime = {}, { prompt = false, cards = null, report = logLine } = {}) {
  if (flags["dry-run"] || flags["no-bell"]) return;
  const say = flags.json ? console.error : (text) => report("Finish bell", text);
  const home = resolveHome(flags);
  const before = readConfig(home);
  const current = readBellOnCompleteConfig(before);
  const byHand = "set display.bell_on_complete: true by hand in config.yaml to hear a bell when a turn finishes.";
  if (current === undefined) {
    if (flags.bell) console.error(`Finish bell: config.yaml does not parse; left unchanged. ${byHand}`);
    return;
  }
  if (current !== null) {
    if (flags.bell) say(`Finish bell: kept your display.bell_on_complete: ${current}.`);
    return;
  }
  let wanted = Boolean(flags.bell);
  if (!wanted && prompt) {
    const env = runtime.env || process.env;
    const streams = runtime.streams || { stdin: process.stdin, stdout: process.stdout };
    const input = streams.stdin || process.stdin;
    const output = streams.stdout || process.stdout;
    const interactive = runtime.isInteractive ?? Boolean(input.isTTY && output.isTTY);
    if (!interactive || "CI" in env) return;
    wanted = cards ? await cards.confirm({
      title: "Finish bell",
      note: "Rings the terminal bell when a Hermes turn finishes; No leaves that setting alone.",
    }) : await new Promise((resolve) => {
      const rl = readline.createInterface({ input, output, terminal: false });
      rl.on("close", () => resolve(false));
      rl.question("Ring the terminal bell when a Hermes turn finishes? [y/N] ", (answer) => {
        resolve(/^\s*y(es)?\s*$/i.test(answer));
        rl.close();
      });
    });
  }
  if (!wanted) return;
  const after = setBellOnCompleteConfig(before);
  if (after === null) {
    console.error(`Finish bell: config.yaml has a shape the installer will not edit; left unchanged. ${byHand}`);
    return;
  }
  if (readConfig(home) !== before) {
    console.error(`Finish bell: config.yaml changed while asking; left unchanged. ${byHand}`);
    return;
  }
  writeConfig(home, after);
  say("Finish bell on: Hermes rings the terminal when a turn finishes (display.bell_on_complete).");
}

// --glyphs and --round, then the line that closes the run. Nothing here can fail an install that went through.
async function settleRoundEnds(flags, runtime = {}, report = logLine) {
  const home = resolveHome(flags);
  const env = runtime.env || process.env;
  const { hasIconFont } = await rules();
  if (flags["dry-run"]) {
    if (flags.glyphs) report("Rounded ends", `round ends: would save ${flags.glyphs}`);
    if (flags.round) report("Icon font", planIconFont({ env, hasIconFont }));
    return null;
  }
  if (flags.glyphs) {
    try {
      report("Rounded ends", applyCaps(flags.glyphs, home));
    } catch (error) {
      console.error(`Round caps: not saved (${error.message}).`);
    }
  }
  let fontWhy = null;
  if (flags.round) {
    const font = await addIconFont({ home, env, hasIconFont, pins: runtime.iconFontPins });
    fontWhy = font.why;
    report("Icon font", font.line);
  }
  return roundEndsLine({ home, env, stream: runtime.streams?.stdout || process.stdout, fontWhy });
}

// The cards for this run, or null where the plain prompts stay. The step pill counts the questions
// the flags and the config leave open: five for the model route, then skin, reply style and bell.
async function installCards(flags, runtime = {}) {
  const env = runtime.env || process.env;
  const streams = runtime.streams || { stdin: process.stdin, stdout: process.stdout };
  const input = streams.stdin || process.stdin;
  const output = streams.stdout || process.stdout;
  if (!cardTerminal({ input, output, env, flags })) return null;
  const named = (key) => typeof flags[key] === "string" && Boolean(flags[key].trim());
  const asks = [
    !named("hud") && !flags["no-hud"],
    !named("style") && !flags["no-style"],
    !flags.bell && !flags["no-bell"] && readBellOnCompleteConfig(readConfig(resolveHome(flags))) === null,
  ];
  // Round or square is the TUI card's own answer, so every surface agrees; asked once for the run.
  const { hasRoundCaps, isRich } = await import(pathToFileURL(widgetSource).href);
  const caps = isRich(env) && hasRoundCaps(env, flags.glyphs || readSettings(resolveHome(flags)).glyphs || "auto");
  return createCards({ input, output, env, caps, hint: POINTER, total: 5 + asks.filter(Boolean).length });
}

// The confirmed install with cards: the steps, the questions left, then one card with what was done.
async function installWithCards(flags, runtime, cards) {
  const { version } = require(path.join(__dirname, "..", "package.json"));
  const steps = cards.steps({ title: `Installing LitHermes ${version}`, names: INSTALL_STEPS, about: stepTarget });
  let result;
  try {
    result = installLitHermes({ ...flags, onProgress: steps.reach });
  } catch (error) {
    steps.fail();
    cards.summary({
      title: "INSTALL STOPPED",
      bad: true,
      sections: [{ head: "LitHermes install failed", rows: [
        ...(steps.stage() ? [{ label: "Stage", value: steps.stage(), tone: "bad" }] : []),
        { label: "Reason", value: error instanceof Error ? error.message : "Unexpected install error.", tone: "bad" },
        { label: "Safety", value: "No later install stages were run" },
        { label: "Next", value: "Resolve the reason above, then rerun `lithermes install --yes`" },
      ] }],
    });
    throw error;
  }
  steps.finish();
  const answers = [];
  let ends = null;
  const close = () => {
    cards.summary(receiptSections(result.message, answers, ends));
    if (result.notice) cards.notice(result.notice);
  };
  cards.onStop(close);
  const report = (label, text) => answers.push({ label, text });
  try {
    ends = await settleRoundEnds(flags, runtime, report);
    await maybePickHudAccent(flags, runtime, { promptForAccent: true, cards, report });
    await maybePickOutputStyle(flags, { prompt: true, cards, report });
    await maybeOfferBell(flags, runtime, { prompt: true, cards, report });
  } finally {
    close();
  }
}

async function main(argv, runtime = {}) {
  const parsed = parseArgs(argv);
  const { command, flags, positionals } = parsed;
  if (flags.agent && (command === "install" || command === "help")) {
    process.stdout.write(`${agentGuide()}\n`);
    return;
  }
  if (parsed.helpRequested) {
    console.log(helpText());
    return;
  }
  validateArgs(parsed);
  printCommandBanner(command, flags, runtime);
  if (command === "version") {
    console.log(packageVersion());
    return;
  }
  if (command === "hud") {
    const accent = positionals[1];
    if (positionals[2] !== undefined && accent !== "card" && accent !== "caps") throw new UsageError(`lithermes hud: unexpected argument '${positionals[2]}'.`);
    if (flags.list || !accent) {
      console.log(listHud({ color: supportsColor(), hermesHome: resolveHome(flags) }));
      return;
    }
    if (accent === "off" || accent === "clear" || accent === "none") {
      console.log(flags["dry-run"] ? previewClearHud(flags) : clearHud(flags));
      return;
    }
    try {
      if (accent === "card") console.log(hudCard(positionals[2], flags));
      else if (accent === "caps") console.log(hudCaps(positionals[2], flags));
      else console.log(flags["dry-run"] ? previewHud(accent, flags) : applyHud(accent, flags));
    } catch (error) {
      console.error(error.message);
      process.exitCode = error.exitCode || 1;
    }
    return;
  }
  if (command === "extensions") {
    const result = runExtensions(positionals[1], positionals.slice(2), flags, runtime);
    console.log(result.message);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const lifecycle = await runLifecycleUpdateSafely(command, flags, runtime);
  if (lifecycle.status === "failed" && (lifecycle.state === "unknown" || lifecycle.rollback?.status === "failed")) {
    console.error("LitHermes automatic update left the Hermes home in an unknown state; run `lithermes doctor --offline --hermes-home PATH` before continuing.");
    process.exitCode = 1;
    return;
  }
  // An old `install` command must not immediately overwrite a newer payload
  // just installed by the barrier. The user can rerun the now-current command
  // if they explicitly need its local flags.
  if (command === "install" && lifecycle.status === "updated") {
    console.log(`LitHermes automatic update committed (${lifecycle.targetVersion}). Restart Hermes to load it.`);
    if (!flags.json) {
      const hermesHome = resolveHome(flags);
      const needsAction = extensionsSummary({ "hermes-home": hermesHome }).count;
      console.log(extensionsNoticeLines({ upgradedFrom: lifecycle.currentVersion, leftovers: leftoverPaths(hermesHome), needsAction }).join("\n"));
    }
    console.log(await settleRoundEnds(flags, runtime));
    return;
  }
  if (command === "install") {
    const cards = await installCards(flags, runtime);
    const prompted = await maybePromptModelRoute(flags, runtime, cards);
    if (prompted === "aborted") {
      console.log("Install aborted; nothing was written.");
      return;
    }
    if (cards && prompted === "chosen") {
      await installWithCards(flags, runtime, cards);
      scheduleUpdateSafely(command, flags, runtime);
      return;
    }
    const spinner = shouldUseSpinner({ flags }) ? createSpinner({
      target: resolveHome(flags),
      version: require(path.join(__dirname, "..", "package.json")).version,
    }) : null;
    try {
      if (spinner) spinner.start();
      const result = installLitHermes({
        ...flags,
        onProgress: spinner ? (message) => spinner.update(message) : undefined,
      });
      if (spinner) spinner.succeed("Installing LitHermes complete");
      console.log(spinner ? renderInstallReceipt(result.message) : result.message);
      if (result.notice && !flags.json) console.log(result.notice);
    } catch (error) {
      if (spinner) spinner.fail(error instanceof Error ? error.message : "Unexpected install error.");
      throw error;
    }
    await maybePickHudAccent(flags, runtime, { promptForAccent: prompted === "chosen" });
    await maybePickOutputStyle(flags, { prompt: prompted === "chosen" });
    await maybeOfferBell(flags, runtime, { prompt: prompted === "chosen" });
    const ends = await settleRoundEnds(flags, runtime);
    if (ends) console.log(ends);
    scheduleUpdateSafely(command, flags, runtime);
    return;
  }
  if (command === "uninstall") {
    const result = flags["dry-run"] ? previewUninstall(flags) : uninstallLitHermes(flags);
    console.log(result.message);
    return;
  }
  // Private bridge used by the installed Python pre_llm_call lifecycle hook.
  // The hook resolves an exact registry version and invokes this command from
  // that exact package. The transaction wrapper then runs the guarded install
  // child and performs the same backup/doctor/rollback protocol as the native
  // interactive CLI barrier. It is deliberately absent from help output.
  if (command === "__auto-update") {
    const pkg = require(path.join(__dirname, "..", "package.json"));
    let lifecycle;
    try {
      const update = runtime.runAutomaticUpdate || runAutomaticUpdate;
      lifecycle = await update({
        currentVersion: flags["installed-version"] || pkg.version,
        latestVersion: pkg.version,
        hermesHome: resolveHome(flags),
        env: runtime.env || process.env,
        now: runtime.now,
        spawnSync: runtime.spawnSync,
        doctor: runtime.doctor,
        timeoutMs: runtime.timeoutMs,
      });
    } catch {
      lifecycle = { status: "failed", reason: "automatic-update-error" };
    }
    if (lifecycle.status === "failed") {
      process.exitCode = 1;
      const suffix = lifecycle.state === "unknown" ? " Hermes home state is unknown; run `lithermes doctor --offline --hermes-home PATH`." : "";
      console.error(`LitHermes automatic update failed: ${lifecycle.reason}.${suffix}`);
    } else if (lifecycle.status === "updated") {
      console.log(`LitHermes automatic update committed (${lifecycle.targetVersion}).`);
    }
    return;
  }
  if (command === "check") {
    const result = checkLitHermes(flags);
    console.log(result.message);
    scheduleUpdateSafely(command, flags, runtime);
    return;
  }
  if (command === "doctor") {
    const result = doctorLitHermes(flags);
    console.log(result.message);
    console.log(await roundEndsLine({ home: resolveHome(flags), env: runtime.env, stream: runtime.streams?.stdout }));
		if (result.ok === false) process.exitCode = 1;
    if (result.ok !== false) scheduleUpdateSafely(command, flags, runtime);
    return;
  }
  console.log(helpText());
}

module.exports = { COMMAND_SPECS, STYLE_MENU, helpText, main, maybeOfferBell, parseArgs, validateArgs };
