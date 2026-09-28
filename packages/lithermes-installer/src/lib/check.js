const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { configHasLitHermes, formatConcurrencyCapability, inspectHermesCapabilities, readConfig, readExternalSkillDirsConfig } = require("./config");
const { detectHermesRuntimeRepo, detectHermesVersion, ensureHermesHome, expandHome, inspectHermesHostCapabilities, LitHermesError } = require("./hermesDiscovery");
const { formatManagedRoute } = require("./modelRoutePolicy");
const { inspectPythonCache } = require("./files");
const { assetRoot, pluginDest } = require("./install");
const {
  formatSkillPayload,
  inspectSkillPayload,
  readPayloadManifest,
  requiredSkills,
  scanPluginSkills,
} = require("./skillPayload");

const requiredCommands = ["lit", "lit-loop", "lit-plan"];

function readBundledManifest(pluginPath) {
  return readPayloadManifest(path.join(pluginPath, "payload-version.json"));
}

function scanPluginCommands(pluginPath) {
  const init = path.join(pluginPath, "__init__.py");
  if (!fs.existsSync(init)) return [];
  const source = fs.readFileSync(init, "utf8");
  return requiredCommands.filter((cmd) => source.includes(`"${cmd}"`) || source.includes(`'${cmd}'`));
}

function nativePluginInjectionAvailable(repo) {
  if (!repo) return false;
  const file = path.join(repo, "hermes_cli", "plugins.py");
  if (!fs.existsSync(file)) return false;
  const source = fs.readFileSync(file, "utf8");
  return source.includes("def inject_message(")
    && source.includes("session_key")
    && source.includes("allow_gateway_injection");
}

function checkGatewaySource(repo) {
  if (!repo) return { ok: true, skipped: true };
  if (nativePluginInjectionAvailable(repo)) {
    return {
      ok: true,
      native: true,
      reason: "Hermes PluginContext.inject_message handles native gateway dispatch",
    };
  }
  const file = path.join(repo, "gateway", "run.py");
  if (!fs.existsSync(file)) return { ok: false, reason: "gateway/run.py missing" };
  const source = fs.readFileSync(file, "utf8");
  return {
    ok: source.includes('command.replace("_", "-")') && source.includes("_plugin_agent_dispatch_payload"),
    reason: "gateway underscore dispatch or structured payload helper missing",
  };
}

function checkCliSource(repo) {
  if (!repo) return { ok: true, skipped: true };
  if (nativePluginInjectionAvailable(repo)) {
    return {
      ok: true,
      native: true,
      reason: "Hermes PluginContext.inject_message handles native CLI turns",
    };
  }
  const file = path.join(repo, "cli.py");
  if (!fs.existsSync(file)) return { ok: false, reason: "cli.py missing" };
  const source = fs.readFileSync(file, "utf8");
  return {
    ok: source.includes("agent_message") && source.includes("_pending_input.put") && source.includes("ast.literal_eval"),
    reason: "CLI plugin structured payload dispatch missing",
  };
}

function checkTuiSource(repo) {
  if (!repo) return { ok: true, skipped: true };
  const file = path.join(repo, "tui_gateway", "server.py");
  if (!fs.existsSync(file)) return { ok: false, reason: "tui_gateway/server.py missing" };
  const source = fs.readFileSync(file, "utf8");
  return {
    ok: source.includes("_plugin_agent_dispatch_payload") && source.includes("command.dispatch") && source.includes('"type": "send"'),
    reason: "TUI plugin structured payload dispatch missing",
  };
}

function formatDispatchStatus(result) {
  if (result.skipped) return "SKIPPED";
  if (result.native) return "PASS (native PluginContext.inject_message)";
  return "PASS";
}

function enabledUserJsonIncludesPlugin(output, pluginName) {
  try {
    const entries = JSON.parse(String(output));
    return Array.isArray(entries) && entries.some((entry) => entry
      && entry.name === pluginName
      && entry.source === "user"
      && entry.status === "enabled");
  } catch {
    return false;
  }
}

function loadedStatusMatchesOrigin(output, expectedPluginPath) {
  const reported = String(output).match(/^plugin dir:\s*(.+?)\s*$/m)?.[1];
  if (!reported) return false;
  try {
    return fs.realpathSync(reported) === fs.realpathSync(expectedPluginPath);
  } catch {
    return false;
  }
}

function isRegularSkillFile(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

// Bounded, non-symlink-following scan for `<HERMES_HOME>/skills/**/<id>/SKILL.md`.
// Real local-skill trees are shallow, so a small depth/entry cap keeps this cheap
// while still catching a collision a couple of category folders deep.
function collectLocalSkillShadows(hermesHome, skillIds, { maxDepth = 3, maxEntries = 2000 } = {}) {
  const remaining = new Set(skillIds);
  const found = new Map();
  let visited = 0;
  function walk(dir, depth) {
    if (!remaining.size || depth > maxDepth || visited >= maxEntries) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!remaining.size || visited >= maxEntries) return;
      visited += 1;
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (remaining.has(entry.name)) {
        const skillFile = path.join(full, "SKILL.md");
        if (isRegularSkillFile(skillFile)) {
          found.set(entry.name, skillFile);
          remaining.delete(entry.name);
          continue;
        }
      }
      walk(full, depth + 1);
    }
  }
  walk(path.join(hermesHome, "skills"), 0);
  return found;
}

// Hermes resolves a bare skill name (not the `lithermes:<name>` explicit-load form)
// against `skills.external_dirs` and local `<HERMES_HOME>/skills`; a same-named entry
// there is picked instead of the LitHermes plugin copy. This is advisory: it never
// changes doctor's pass/fail status, only surfaces the collision.
function detectSkillShadows({ configText, hermesHome, skillIds = requiredSkills }) {
  const externalDirs = readExternalSkillDirsConfig(configText)
    .map((dir) => path.resolve(expandHome(dir)));
  const localShadows = collectLocalSkillShadows(hermesHome, skillIds);
  const warnings = [];
  for (const id of skillIds) {
    const externalDir = externalDirs.find((dir) => isRegularSkillFile(path.join(dir, id, "SKILL.md")));
    if (externalDir) {
      warnings.push({ id, path: path.join(externalDir, id, "SKILL.md"), source: "skills.external_dirs" });
      continue;
    }
    const localPath = localShadows.get(id);
    if (localPath) warnings.push({ id, path: localPath, source: "local skills" });
  }
  return warnings;
}

function formatSkillShadowWarning(shadow) {
  return `WARNING: skill "${shadow.id}" bare name resolves to ${shadow.path} (${shadow.source}); `
    + `use lithermes:${shadow.id} to load LitHermes's copy, or remove/rename the other copy.`;
}

function checkLitHermes(flags = {}) {
  const { hermesHome, hermesRepo } = ensureHermesHome(flags);
  const pluginPath = pluginDest(hermesHome);
  const commands = scanPluginCommands(pluginPath);
  const configOk = configHasLitHermes(readConfig(hermesHome));
  const missing = requiredCommands.filter((cmd) => !commands.includes(cmd));
  if (missing.length || !configOk) {
    throw new LitHermesError(`LitHermes check FAIL\nmissing: ${missing.join(", ") || "none"}\nconfig enabled: ${configOk}`, 6);
  }
  const lines = [`LitHermes check PASS`, `commands: ${commands.join(", ")}`];
  if (flags["gateway-offline"]) {
    const gateway = checkGatewaySource(hermesRepo);
    if (!gateway.ok && !gateway.skipped) throw new LitHermesError(`gateway check FAIL: ${gateway.reason}`, 7);
    const status = gateway.skipped
      ? "SKIPPED (no Hermes repo provided)"
      : formatDispatchStatus(gateway);
    lines.push(`gateway /lit_loop ${status}`);
    lines.push(`gateway /lit_plan ${status}`);
  }
  return { message: lines.join("\n") };
}

// MO-A-44: the motion runtime's five probes (Chrome, ffmpeg and preview rung,
// WebGL2 renderer, software-GL warning, pre-warm state) on every doctor run.
// They report; they never change the doctor's pass/fail.
function motionProbeLines(pluginPath, hermesHome) {
  const installed = path.join(pluginPath, "skills", "lit-typographic-motion", "bin", "runtime.mjs");
  const bundled = path.join(assetRoot, "skills", "lit-typographic-motion", "bin", "runtime.mjs");
  const script = fs.existsSync(installed) ? installed : bundled;
  const result = spawnSync(process.execPath, [script, "status"], {
    encoding: "utf8", timeout: 60000, env: { ...process.env, HERMES_HOME: hermesHome },
  });
  const lines = String(result.stdout || "").split("\n").filter(Boolean);
  if (result.status === 0 && lines.length === 5) return lines.map((line) => `motion ${line}`);
  const reason = (result.stderr || result.error?.message || "no output").split("\n")[0];
  return [
    "motion Chrome: unknown (status failed)", "motion ffmpeg: unknown (status failed)",
    "motion WebGL2 renderer: unknown (status failed)", "motion software GL: unknown (status failed)",
    `motion pre-warm: status failed (${reason}); run \`lithermes motion-runtime status\``,
  ];
}

function doctorLitHermes(flags = {}) {
  const bundledBytecodeEntries = inspectPythonCache(assetRoot);
  const { hermesHome, hermesRepo } = ensureHermesHome(flags);
  const pluginPath = pluginDest(hermesHome);
  const commands = scanPluginCommands(pluginPath);
  const configText = readConfig(hermesHome);
  const configOk = configHasLitHermes(configText);
  const cli = checkCliSource(hermesRepo);
  const tui = checkTuiSource(hermesRepo);
  const gateway = checkGatewaySource(hermesRepo);
  const bundledCommands = scanPluginCommands(assetRoot);
  const bundledPass = requiredCommands.every((cmd) => bundledCommands.includes(cmd));
  const bundledSkillPayload = inspectSkillPayload(assetRoot, readBundledManifest(assetRoot), true);
  const installedSkillPayload = inspectSkillPayload(
    pluginPath,
    readBundledManifest(pluginPath),
    true,
  );
  const installedPass = requiredCommands.every((cmd) => commands.includes(cmd));
  let loaded = { status: "PARTIAL", reason: "offline mode did not query hermes plugins list" };
  if (!flags.offline) {
    const env = { ...process.env, HERMES_HOME: hermesHome };
    const result = spawnSync("hermes", ["plugins", "list", "--json", "--enabled", "--user"], {
      encoding: "utf8",
      env,
      timeout: 15000,
    });
    const enabledUser = result.status === 0
      && !String(result.stderr || "").trim()
      && enabledUserJsonIncludesPlugin(result.stdout, "lithermes");
    const command = enabledUser
      ? spawnSync("hermes", ["lithermes", "status"], { encoding: "utf8", env, timeout: 15000 })
      : null;
    const provenLoaded = enabledUser
      && command.status === 0
      && !String(command.stderr || "").trim()
      && loadedStatusMatchesOrigin(command.stdout, pluginPath);
    loaded = provenLoaded
      ? { status: "PASS", reason: "enabled user JSON and loaded status origin verified" }
      : { status: "PARTIAL", reason: "enabled discovery and loaded command did not both verify" };
  }
  const capabilities = inspectHermesCapabilities(configText, {
    hostCapabilities: inspectHermesHostCapabilities(hermesRepo || detectHermesRuntimeRepo()),
    hostVersion: detectHermesVersion(),
  });
  const auto = capabilities.autoCompaction;
  const concurrency = capabilities.concurrency;
  const delegationRoute = capabilities.delegationRoute;
	const modelSafety = capabilities.modelSafety;
	const recursion = capabilities.recursion;
	const unsafeRecursion = recursion.status === "unavailable" && recursion.reason.startsWith("nested delegation");
	const unsafeModelRoute = modelSafety.status === "blocked";
  const runtime = capabilities.runtime;
  const skillShadows = detectSkillShadows({ configText, hermesHome });
  const lines = [
    `plugin discovery: ${installedPass && configOk ? "PASS" : "PATCH_AVAILABLE"}`,
    `bundled source: ${bundledPass ? "PASS" : "FAIL"}`,
    bundledBytecodeEntries
      ? `bundled bytecode cache: PRESENT (${bundledBytecodeEntries} generated ${bundledBytecodeEntries === 1 ? "entry" : "entries"}; left unchanged)`
      : "bundled bytecode cache: CLEAN (read-only inspection)",
    `bundled skill payload: ${formatSkillPayload(bundledSkillPayload)}`,
    `installed skill payload: ${formatSkillPayload(installedSkillPayload)}`,
    `installed payload: ${installedPass ? "PASS" : "FAIL"}`,
    `enabled config: ${configOk ? "PASS" : "PARTIAL"}`,
    `loaded plugin: ${loaded.status} (${loaded.reason})`,
    `skill shadow check: ${skillShadows.length ? "WARNING" : "PASS"}`,
    ...skillShadows.map(formatSkillShadowWarning),
    `auto-compaction: ${auto.status}${auto.reason ? ` (${auto.reason})` : ""}`,
		`concurrency: ${formatConcurrencyCapability(concurrency)}`,
		`recursion: ${recursion.status}${recursion.status === "hard" ? recursion.flatBy === "depth" ? ` (depth ${recursion.limit}, flat)` : ` (configured depth ${recursion.limit}, flat via orchestrator kill switch)` : ` (${recursion.reason})`}`,
    `model route safety: ${modelSafety.status}${modelSafety.code ? ` (${modelSafety.code}; ${modelSafety.reason})` : ` (${modelSafety.reason})`}`,
    `runtime: ${runtime.status}${runtime.status === "hard" ? ` (${runtime.provider} ${runtime.apiMode})` : ` (${runtime.reason})`}`,
    `global child route: ${formatManagedRoute(delegationRoute)}`,
    `cli payload dispatch: ${cli.ok ? formatDispatchStatus(cli) : "PATCH_AVAILABLE"}`,
    `tui payload dispatch: ${tui.ok ? formatDispatchStatus(tui) : "PATCH_AVAILABLE"}`,
    `gateway underscore dispatch: ${gateway.ok ? formatDispatchStatus(gateway) : "PATCH_AVAILABLE"}`,
    ...motionProbeLines(pluginPath, hermesHome),
  ];
	return {
		message: lines.join("\n"),
		ok: !unsafeRecursion
			&& !unsafeModelRoute
			&& bundledSkillPayload.ok
			&& installedSkillPayload.ok,
	};
}

module.exports = {
  checkCliSource,
  checkGatewaySource,
  checkLitHermes,
  checkTuiSource,
  detectSkillShadows,
  doctorLitHermes,
  enabledUserJsonIncludesPlugin,
  loadedStatusMatchesOrigin,
  requiredCommands,
  requiredSkills,
  nativePluginInjectionAvailable,
  scanPluginCommands,
  scanPluginSkills,
};
