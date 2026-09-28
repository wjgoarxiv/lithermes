const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

class LitHermesError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function defaultHermesHome(flags = {}) {
  return path.resolve(expandHome(flags["hermes-home"] || process.env.HERMES_HOME || "~/.hermes"));
}

function assertPluginParent(hermesHome) {
  const parent = path.join(hermesHome, "plugins");
  const stat = fs.lstatSync(parent, { throwIfNoEntry: false });
  if (stat && !stat.isDirectory()) {
    throw new LitHermesError(`Refusing to modify plugins through a symlink or non-directory at ${parent}.`, 5);
  }
}

// The selected home may be an explicit alias; its managed state child may not.
// A captured identity also rejects replacement directories at later checkpoints.
function assertManagedDirectory(parent, expected) {
  const stat = fs.lstatSync(parent, { throwIfNoEntry: false }) || null;
  if ((stat && !stat.isDirectory()) || (expected !== undefined
    && (Boolean(stat) !== Boolean(expected) || (stat && (stat.dev !== expected.dev || stat.ino !== expected.ino))))) {
    throw new LitHermesError(`Refusing unsafe or replaced LitHermes state directory at ${parent}.`, 5);
  }
  return stat;
}

function assertStateParent(hermesHome, expected) {
  return assertManagedDirectory(path.join(hermesHome, "lithermes"), expected);
}

function defaultHermesRepo(flags = {}, hermesHome = defaultHermesHome(flags)) {
  if (flags["hermes-repo"]) return path.resolve(expandHome(flags["hermes-repo"]));
  const candidate = path.join(hermesHome, "hermes-agent");
  return fs.existsSync(candidate) ? candidate : null;
}

function detectHermesRuntimeRepo() {
  const executable = (process.env.PATH || "").split(path.delimiter)
    .map((entry) => path.join(entry, "hermes"))
    .find((entry) => fs.existsSync(entry));
  if (!executable) return null;
  try {
    const firstLine = fs.readFileSync(executable, "utf8").split(/\r?\n/, 1)[0];
    const interpreter = firstLine.startsWith("#!") ? firstLine.slice(2).trim() : "";
    const runtimeRepo = path.dirname(path.dirname(path.dirname(interpreter)));
    return fs.existsSync(path.join(runtimeRepo, "hermes_cli")) ? runtimeRepo : null;
  } catch {
    return null;
  }
}

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

// Hermes 0.21.0 split tools/delegate_tool.py: the concurrency knob and delegation-route
// helpers moved into tools/delegate_tool_config.py, and hermes_cli/runtime_provider.py
// moved from an if/elif chain to a _POOL_ENTRY_SIMPLE_MODES data table. Both layouts are
// checked so a 0.21.0 host is not misreported as lacking capabilities it genuinely has.
function inspectHermesHostCapabilities(hermesRepo) {
  const unavailable = { concurrencyHard: false, delegationRouteHard: false, runtimeHard: false };
  if (!hermesRepo) return unavailable;
  try {
    const legacyDelegation = readIfExists(path.join(hermesRepo, "tools", "delegate_tool.py"));
    const configDelegation = readIfExists(path.join(hermesRepo, "tools", "delegate_tool_config.py"));
    if (!legacyDelegation && !configDelegation) return unavailable;
    const delegation = `${legacyDelegation}\n${configDelegation}`;
    const runtime = fs.readFileSync(path.join(hermesRepo, "hermes_cli", "runtime_provider.py"), "utf8");
    const runtimeStem = ["co", "dex"].join("");
    return {
      concurrencyHard: delegation.includes("_get_max_concurrent_children")
        && ((delegation.includes('cfg.get("max_concurrent_children")') && delegation.includes("max(1, int(val))"))
          || (delegation.includes('"max_concurrent_children", "DELEGATION_MAX_CONCURRENT_CHILDREN"')
            && delegation.includes("max(1, int(v))"))),
      // The config-level model override moved from a single `configured_model` line
      // (0.17/0.19) into a per-key dict comprehension in _resolve_delegation_credentials
      // (0.21.0); both read the same cfg.get("model") value.
      delegationRouteHard: delegation.includes('delegation_cfg.get("reasoning_effort")')
        && delegation.includes("effective_model = model or parent_agent.model")
        && (delegation.includes('configured_model = str(cfg.get("model")')
          || delegation.includes('str(cfg.get(k) or "").strip() or None for k in ("model"')),
      runtimeHard: (runtime.includes(`provider == "openai-${runtimeStem}"`)
          && runtime.includes(`api_mode = "${runtimeStem}_responses"`))
        || runtime.includes(`"openai-${runtimeStem}": ("${runtimeStem}_responses"`),
    };
  } catch {
    return unavailable;
  }
}

function ensureHermesHome(flags = {}, { forInstall = false } = {}) {
  const hermesHome = defaultHermesHome(flags);
  if (!fs.existsSync(hermesHome)) {
    if (forInstall) {
      fs.mkdirSync(hermesHome, { recursive: true });
    } else {
      throw new LitHermesError(`Hermes installation not found at ${hermesHome}. Pass --hermes-home PATH to select it.`, 2);
    }
  }
  return {
    hermesHome,
    hermesRepo: defaultHermesRepo(flags, hermesHome),
  };
}

function detectHermesVersion() {
  const result = spawnSync("hermes", ["--version"], { encoding: "utf8", timeout: 15000 });
  return result.status === 0 ? (result.stdout || result.stderr || "") : "";
}

module.exports = {
  assertPluginParent,
  assertStateParent,
  assertManagedDirectory,
  LitHermesError,
  defaultHermesHome,
  defaultHermesRepo,
  detectHermesRuntimeRepo,
  detectHermesVersion,
  ensureHermesHome,
  expandHome,
  inspectHermesHostCapabilities,
};
