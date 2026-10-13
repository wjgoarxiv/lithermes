const path = require("node:path");
const { spawnSync } = require("node:child_process");
const readline = require("node:readline");
const { installLitHermes, previewModelRoute, previewUninstall, uninstallLitHermes } = require("./lib/install");
const { promptModelRouteSession, renderInstallBanner, routeFromConfig } = require("./lib/modelPrompt");
const { checkLitHermes, doctorLitHermes } = require("./lib/check");
const { createSpinner, renderInstallReceipt, shouldUseSpinner } = require("./lib/spinner");
const { listHud, applyHud, clearHud, previewClearHud, previewHud, promptAccent, resolveHome } = require("./lib/hud");
const { supportsColor, findAccent, skinName } = require("./lib/skins");
const {
  readConfig,
  readBellOnCompleteConfig,
  setBellOnCompleteConfig,
  clearDisplaySkinConfig,
  readDisplaySkinConfig,
  readOutputStyleConfig,
  setDisplaySkinConfig,
  setOutputStyleConfig,
  writeConfig,
} = require("./lib/config");
const {
  runAutomaticUpdate,
  scheduleUpdateCheck,
  shouldAutoUpdate,
} = require("./lib/updateNotifier");

// Every option the CLI understands. A flag is a boolean switch unless it is listed in VALUE_FLAGS.
const VALUE_FLAGS = new Set([
  "hermes-home", "hermes-repo", "provider", "model", "effort", "child-provider", "child-model", "child-effort",
  "hud", "style", "installed-version",
]);

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
  "motion-runtime": {
    usage: "motion-runtime install|status",
    positionals: [1, 1],
    actions: ["install", "status"],
    flags: { "dry-run": "", audio: "", "word-timing": "", ...HOME },
    note: "Typographic-motion engine adapted from mexicat/pdoom-video (MIT, Giacomo Magnanini), commit ca251e3.",
  },
  uninstall: {
    usage: "uninstall",
    positionals: [0, 0],
    flags: { yes: "", "dry-run": "", "rollback-patches": "", offline: "", "no-auto-update": "", ...HOME, "hermes-repo": "PATH" },
  },
  hud: {
    usage: "hud [<accent>|off]",
    positionals: [0, 1],
    flags: { list: "", "dry-run": "", ...HOME },
    note: "(Hermes HUD skin accents)",
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
  const extra = positionals.slice(1);
  const [min, max] = spec.positionals;
  if (extra.length > max) issues.push(`unexpected argument '${extra[max]}'`);
  else if (extra.length < min) issues.push(spec.actions ? `missing action (${spec.actions.join(" or ")})` : "missing argument");
  else if (spec.actions && !spec.actions.includes(extra[0])) issues.push(`unexpected argument '${extra[0]}' (expected ${spec.actions.join(" or ")})`);
  if (issues.length) throw new UsageError(`lithermes ${command}: ${issues.join("; ")}.`);
}

function helpText() {
  const lines = ["lithermes commands:"];
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

function motionRuntime(action, flags = {}) {
  const script = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion", "bin", "runtime.mjs");
  const result = spawnSync(process.execPath, [script, action, ...(flags.audio ? ["--audio"] : []), ...(flags["word-timing"] ? ["--word-timing"] : [])], {
    encoding: "utf8", timeout: action === "install" ? 300000 : 45000,
    env: { ...process.env, HERMES_HOME: resolveHome(flags) },
  });
  return {
    status: result.status,
    output: (result.stdout || result.stderr || result.error?.message || "motion runtime did not return a result").trim(),
  };
}

// Dry run of `motion-runtime install`: the runtime module only reads its pins and the cache here.
async function motionRuntimePlan(flags = {}) {
  const { pathToFileURL } = require("node:url");
  const script = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion", "bin", "runtime.mjs");
  const runtime = await import(pathToFileURL(script).href);
  const env = { ...process.env, HERMES_HOME: resolveHome(flags) };
  const ready = runtime.findCache(env);
  const fonts = runtime.fontState(env);
  const lines = ["DRY RUN: would install the motion runtime", `cache: ${ready || runtime.cacheRoots(env)[0]}`];
  if (flags["word-timing"]) lines.push(`word-timing: would be refused (fail-closed): ${runtime.wordTimingPlan().reason}`);
  else if (ready && fonts.ok) lines.push("node packages and fonts: already READY; nothing to install");
  else lines.push(`would run npm ci for the pinned node packages and fetch ${runtime.FONT_PINS.length} pinned fonts`);
  if (flags.audio && !flags["word-timing"]) {
    lines.push(runtime.audioState(env).state === "ready"
      ? "audio venv: already READY"
      : "would create the audio venv and pip-install the hash-pinned requirements.lock");
  }
  lines.push("Nothing was downloaded or written.");
  return lines.join("\n");
}

function printCommandBanner(command, flags, runtime = {}) {
  // Keep machine-oriented routes byte-stable: their stdout is consumed as a
  // version line or JSON receipt rather than a human-facing command report.
  if (flags.json || command === "version" || command === "__auto-update") return;
  const env = runtime.env || process.env;
  const streams = runtime.streams || { stdout: process.stdout };
  const output = streams.stdout || process.stdout;
  const version = require(path.join(__dirname, "..", "package.json")).version;
  output.write(`${renderInstallBanner({
    version, env, stream: output,
    color: !flags.yes && !flags["dry-run"] && supportsColor({ stream: output, env }),
  })}\n`);
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
async function maybePromptModelRoute(flags, runtime = {}) {
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
  const { confirmed, route } = await promptModelRouteSession({
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

async function maybePickOutputStyle(flags) {
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
  } else if (flags["no-style"]) {
    return;
  } else if (process.stdin.isTTY && process.stdout.isTTY && !("CI" in process.env)) {
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
  } else {
    return;
  }
  if (chosen) {
    const before = readConfig(home);
    const after = setOutputStyleConfig(before, chosen);
    if (after !== before) writeConfig(home, after);
    console.log(`Output style set to '${chosen}'.`);
  }
}

// Keep explicit HUD choices manual. On the prompted install path the accent
// picker runs; the --yes path auto-applies the named Ignition skin on
// a fresh interactive color-capable install.
async function maybePickHudAccent(flags, runtime = {}, { promptForAccent = false } = {}) {
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
    const chosen = await promptAccent({
      input: streams.stdin || process.stdin,
      output: streams.stdout || process.stdout,
      color: supportsColor({ stream: streams.stdout || process.stdout, env: runtime.env || process.env }),
    });
    if (chosen) {
      console.log(applyHud(chosen.accent, flags));
    }
    return;
  } else {
    const env = runtime.env || process.env;
    const streams = runtime.streams || { stdin: process.stdin, stdout: process.stdout };
    const input = streams.stdin || process.stdin;
    const output = streams.stdout || process.stdout;
    const interactive = runtime.isInteractive ?? Boolean(input.isTTY && output.isTTY);
    const color = supportsColor({ stream: output, env });
    if (!interactive || env.CI || !color) return;

    const home = resolveHome(flags);
    const before = readConfig(home);
    const normalized = `${before.replace(/\r\n/g, "\n").replace(/\n*$/, "")}\n`;
    if (readDisplaySkinConfig(before) || clearDisplaySkinConfig(normalized) !== normalized) return;

    entry = findAccent("ignition");
    const name = skinName(entry.accent);
    const after = setDisplaySkinConfig(before, name);
    if (after !== before) writeConfig(home, after);
    console.log(`LitHermes HUD set to ${entry.label} (${name}).`);
    return;
  }
  if (entry) console.log(applyHud(entry.accent, flags));
}

// Hermes rings the terminal bell (plus a desktop notice) at the end of a turn
// when display.bell_on_complete is true; its default is off. The installer sets
// it only on --bell or a "y" to the interactive question, never changes a value
// the user already chose, and leaves config.yaml alone when the edit is not
// clean or the file changed while the question was open.
async function maybeOfferBell(flags, runtime = {}, { prompt = false } = {}) {
  if (flags["dry-run"] || flags["no-bell"]) return;
  const say = flags.json ? console.error : console.log;
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
    wanted = await new Promise((resolve) => {
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

async function main(argv, runtime = {}) {
  const parsed = parseArgs(argv);
  const { command, flags, positionals } = parsed;
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
    if (flags.list || !accent) {
      console.log(listHud({ color: supportsColor(), hermesHome: resolveHome(flags) }));
      return;
    }
    if (accent === "off" || accent === "clear" || accent === "none") {
      console.log(flags["dry-run"] ? previewClearHud(flags) : clearHud(flags));
      return;
    }
    try {
      console.log(flags["dry-run"] ? previewHud(accent, flags) : applyHud(accent, flags));
    } catch (error) {
      console.error(error.message);
      process.exitCode = error.exitCode || 1;
    }
    return;
  }
  if (command === "motion-runtime") {
    const action = positionals[1];
    if (action === "install" && flags["dry-run"]) {
      console.log(await motionRuntimePlan(flags));
      return;
    }
    const result = motionRuntime(action, flags);
    console.log(result.output);
    if (result.status !== 0) process.exitCode = result.status || 1;
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
    return;
  }
  if (command === "install") {
    const prompted = await maybePromptModelRoute(flags, runtime);
    if (prompted === "aborted") {
      console.log("Install aborted; nothing was written.");
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
      if (!flags['dry-run']) {
        // The motion pre-warm never fails the install; it leaves one receipt line.
        let receipt;
        if (flags.offline) receipt = "Motion runtime: pre-warm skipped (--offline); run `lithermes motion-runtime install` before rendering a film.";
        else {
          const warm = motionRuntime('install', flags);
          receipt = warm.status === 0
            ? `Motion runtime: ${warm.output.split('\n')[0]}`
            : `Motion runtime: pre-warm incomplete (${warm.output.split('\n').filter(Boolean).at(-1)}); run \`lithermes motion-runtime install\` before rendering a film.`;
        }
        (flags.json ? console.error : console.log)(receipt);
      }
    } catch (error) {
      if (spinner) spinner.fail(error instanceof Error ? error.message : "Unexpected install error.");
      throw error;
    }
    await maybePickHudAccent(flags, runtime, { promptForAccent: prompted === "chosen" });
    await maybePickOutputStyle(flags);
    await maybeOfferBell(flags, runtime, { prompt: prompted === "chosen" });
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
		if (result.ok === false) process.exitCode = 1;
    if (result.ok !== false) scheduleUpdateSafely(command, flags, runtime);
    return;
  }
  console.log(helpText());
}

module.exports = { COMMAND_SPECS, helpText, main, maybeOfferBell, parseArgs, validateArgs };
