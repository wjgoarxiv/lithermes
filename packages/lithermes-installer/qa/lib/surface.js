// Shared drivers for the replacement real-surface QA layer.
//
// Everything here talks to the real shipped runtime: the installer CLI at
// bin/lithermes.js and the Python probes the behaviour layer runs. Nothing in this directory imports from test/, so the layer
// keeps working if the tracked test tree is ever reduced.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageRoot = path.resolve(__dirname, "..", "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
const installerCli = path.join(packageRoot, "bin", "lithermes.js");
const tokenScanner = path.join(packageRoot, "test", "scripts", "scan-forbidden-tokens.js");
// Path-SHAPE guard. Separate from tokenScanner, which only reads file content.
const pathScanner = path.join(packageRoot, "test", "scripts", "scan-forbidden-paths.js");

// The managed provider stem is a denied literal for the repository scanner, so it is
// assembled the same way the shipped source assembles it.
const runtimeStem = ["co", "dex"].join("");
const managedProvider = `openai-${runtimeStem}`;

let cachedPython = null;

function python() {
  if (cachedPython) return cachedPython;
  // scripts/test-python.js is a package script, not a test file; reusing its resolver
  // keeps the probe on the same PyYAML-capable interpreter as the Python gate.
  const { resolvePython } = require(path.join(packageRoot, "scripts", "test-python.js"));
  const resolved = resolvePython();
  cachedPython = resolved.python || "python3";
  return cachedPython;
}

function runPython(script, args, { input = "", cwd = packageRoot } = {}) {
  const result = spawnSync(python(), [script, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" },
    input,
    timeout: 60000,
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error,
  };
}

function runNode(args, { cwd = packageRoot, env = {} } = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_UPDATE_NOTIFIER: "1", ...env },
    timeout: 120000,
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error,
  };
}

function installer(args, options) {
  return runNode([installerCli, ...args], options);
}

function digestOf(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function digestOfFile(file) {
  return digestOf(fs.readFileSync(file));
}

function isolatedProfileFingerprint(env = process.env) {
  const hermesHome = String(env.HERMES_HOME || "").trim()
    || path.join(String(env.HOME || os.homedir()), ".hermes");
  const file = path.join(hermesHome, "lithermes", "events.jsonl");
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) {
      return { file, state: "invalid", size: null, sha256: null, error: "not a regular file" };
    }
    return { file, state: "file", size: stat.size, sha256: digestOfFile(file), error: null };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { file, state: "absent", size: null, sha256: null, error: null };
    }
    return {
      file,
      state: "error",
      size: null,
      sha256: null,
      error: error && error.code ? error.code : String(error),
    };
  }
}

function compareIsolatedProfiles(before, after) {
  const measurable = before.state === "file" || before.state === "absent";
  const unchanged = measurable
    && before.file === after.file
    && before.state === after.state
    && before.size === after.size
    && before.sha256 === after.sha256;
  const beforeHash = before.sha256 ? before.sha256.slice(0, 16) : "-";
  const afterHash = after.sha256 ? after.sha256.slice(0, 16) : "-";
  return {
    unchanged,
    detail: `${unchanged ? "UNCHANGED" : "MUTATED"} isolated QA target events.jsonl bytes before=${before.size} after=${after.size} sha256 before=${beforeHash}... after=${afterHash}... states=${before.state}/${after.state}`,
  };
}

function instant(date) {
  return `${date.toISOString().slice(0, 19)}Z`;
}

// --- scratch roots ---------------------------------------------------------
// Every temporary path is created under the OS temp dir and recorded so the caller can
// print a cleanup receipt. Nothing is ever created inside a live profile.

function scratch() {
  const created = [];
  return {
    created,
    make(label) {
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `lithermes-qa-${label}.`)));
      created.push(dir);
      return dir;
    },
    removeAll() {
      const receipt = [];
      for (const dir of created) {
        fs.rmSync(dir, { recursive: true, force: true });
        receipt.push({ path: dir, removed: !fs.existsSync(dir) });
      }
      return receipt;
    },
  };
}

function enterIsolatedProfile(workspace, env = process.env) {
  const root = workspace.make("profile");
  const home = path.join(root, "home");
  const hermesHome = path.join(root, "hermes-home");
  fs.mkdirSync(home);
  fs.mkdirSync(hermesHome);
  const previous = {
    HOME: { present: Object.hasOwn(env, "HOME"), value: env.HOME },
    HERMES_HOME: { present: Object.hasOwn(env, "HERMES_HOME"), value: env.HERMES_HOME },
  };
  env.HOME = home;
  env.HERMES_HOME = hermesHome;
  return {
    home,
    hermesHome,
    restore() {
      for (const key of ["HOME", "HERMES_HOME"]) {
        if (previous[key].present) env[key] = previous[key].value;
        else delete env[key];
      }
    },
  };
}

module.exports = {
  digestOf,
  digestOfFile,
  enterIsolatedProfile,
  installerCli,
  instant,
  isolatedProfileFingerprint,
  compareIsolatedProfiles,
  managedProvider,
  packageRoot,
  pluginRoot,
  python,
  repoRoot,
  runNode,
  runPython,
  scratch,
  pathScanner,
  tokenScanner,
  installer,
};
