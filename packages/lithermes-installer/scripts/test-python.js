#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageRoot = path.resolve(__dirname, "..");
const pythonDir = path.join(packageRoot, "test", "python");

function hermesInterpreter(env = process.env) {
  for (const entry of (env.PATH || "").split(path.delimiter)) {
    const hermes = path.join(entry, "hermes");
    if (!fs.existsSync(hermes)) continue;
    const firstLine = fs.readFileSync(hermes, "utf8").split(/\r?\n/, 1)[0];
    if (!firstLine.startsWith("#!/")) return null;
    const candidate = firstLine.slice(2).trim();
    return candidate.includes(" ") ? null : candidate;
  }
  return null;
}

function importable(candidate, name, env) {
  const result = spawnSync(
    candidate,
    ["-c", `import importlib; importlib.import_module(${JSON.stringify(name)})`],
    { encoding: "utf8", env },
  );
  return !result.error && result.status === 0;
}

function probeInterpreter(candidate, env = process.env) {
  const version = spawnSync(candidate, ["--version"], { encoding: "utf8", env });
  if (version.error || version.status !== 0) return null;
  return {
    python: candidate,
    hasJsonschema: importable(candidate, "jsonschema", env),
    hasYaml: importable(candidate, "yaml", env),
    scienceImports: {
      matplotlib: importable(candidate, "matplotlib", env),
      numpy: importable(candidate, "numpy", env),
    },
  };
}

function resolvePython(options = {}) {
  const env = options.env || process.env;
  const explicit = Boolean(env.LITHERMES_PYTHON);
  const candidates = explicit
    ? [env.LITHERMES_PYTHON]
    : (options.candidates || [hermesInterpreter(env), "python3", "python"]).filter(Boolean);
  let fallback = null;
  for (const candidate of [...new Set(candidates)]) {
    const probe = probeInterpreter(candidate, env);
    if (!probe) continue;
    fallback ||= probe;
    if (probe.hasYaml && probe.hasJsonschema) return { ...probe, explicit };
  }
  return fallback
    ? { ...fallback, explicit }
    : {
      python: explicit ? env.LITHERMES_PYTHON : null,
      hasJsonschema: false,
      hasYaml: false,
      scienceImports: { matplotlib: false, numpy: false },
      explicit,
    };
}

function runPythonTests(options = {}) {
  const env = options.env || process.env;
  const resolved = resolvePython({ ...options, env });
  if (!resolved.python) {
    return {
      python: null,
      hasJsonschema: false,
      hasYaml: false,
      scienceImports: resolved.scienceImports,
      isolated: false,
      sandbox: "",
      status: null,
      output: "No Python interpreter is available.",
    };
  }
  if (!resolved.hasYaml || !resolved.hasJsonschema) {
    const missing = [
      ...(!resolved.hasYaml ? ["PyYAML"] : []),
      ...(!resolved.hasJsonschema ? ["jsonschema"] : []),
    ];
    return {
      python: resolved.python,
      hasJsonschema: resolved.hasJsonschema,
      hasYaml: resolved.hasYaml,
      scienceImports: resolved.scienceImports,
      isolated: false,
      sandbox: "",
      status: 1,
      output: resolved.explicit
        ? `LITHERMES_PYTHON is authoritative, but '${resolved.python}' cannot import required dependencies: ${missing.join(", ")}.`
        : "No Python with required PyYAML and jsonschema imports was found. Install both dependencies or set LITHERMES_PYTHON explicitly.",
    };
  }

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-python-gate-"));
  const home = path.join(sandbox, "home");
  const hermesHome = path.join(sandbox, "hermes-home");
  const workspace = path.join(sandbox, "workspace");
  const tmp = path.join(sandbox, "tmp");
  for (const directory of [home, hermesHome, workspace, tmp]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  let result;
  try {
    result = spawnSync(
      resolved.python,
      ["-m", "unittest", "discover", "-s", pythonDir, "-p", "test_*.py", "-v"],
      {
        encoding: "utf8",
        cwd: workspace,
        env: {
          ...env,
          HOME: home,
          USERPROFILE: home,
          HERMES_HOME: hermesHome,
          XDG_CACHE_HOME: path.join(home, ".cache"),
          XDG_CONFIG_HOME: path.join(home, ".config"),
          TMPDIR: tmp,
          PYTHONPATH: "",
          PYTHONNOUSERSITE: "1",
          PYTHONDONTWRITEBYTECODE: "1",
        },
      },
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  return {
    python: resolved.python,
    hasJsonschema: true,
    hasYaml: true,
    scienceImports: resolved.scienceImports,
    isolated: true,
    sandbox,
    status: result.status,
    output: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

function main() {
  const result = runPythonTests();
  process.stdout.write(
    `[python-gate] interpreter=${result.python || "unavailable"} ` +
      `pyyaml=${result.hasYaml ? "yes" : "no"} ` +
      `jsonschema=${result.hasJsonschema ? "yes" : "no"} isolated=${result.isolated ? "yes" : "no"}\n`,
  );
  if (result.output) process.stdout.write(result.output);
  process.exitCode = result.status ?? 1;
}

if (require.main === module) main();

module.exports = { probeInterpreter, resolvePython, runPythonTests };
