#!/usr/bin/env node
// Replacement real-surface QA: named-behavior probes.
//
// These three behaviours are the ones the tracked unit suites are the only current
// proof of. Each is re-proved here through a shipped surface — the installer CLI, or
// the installed plugin payload — so the behaviour keeps a runnable owner outside the
// test tree. A behaviour that cannot be reached that way is reported NOT_REPLACEABLE
// with the reason; it is never quietly downgraded to a pass.
const fs = require("node:fs");
const path = require("node:path");

const {
  compareIsolatedProfiles, enterIsolatedProfile, installer, isolatedProfileFingerprint, managedProvider,
  packageRoot, runPython, scratch,
} = require("./lib/surface");

const workspace = scratch();
const boundedProbe = path.join(__dirname, "lib", "bounded_authority_probe.py");
const redactionProbe = path.join(__dirname, "lib", "redaction_probe.py");
const knowledgeProbe = path.join(__dirname, "lib", "knowledge_probe.py");

function verifiedHostHome(label) {
  // The host-source markers the installer reads before it will touch model settings.
  // Writing them into an isolated temp home is the only way to exercise the verified
  // path without a real Hermes checkout; no live profile is involved.
  const home = workspace.make(label);
  const repo = path.join(home, "hermes-agent");
  fs.mkdirSync(path.join(repo, "tools"), { recursive: true });
  fs.mkdirSync(path.join(repo, "hermes_cli"), { recursive: true });
  const stem = managedProvider.slice("openai-".length);
  fs.writeFileSync(path.join(repo, "tools", "delegate_tool.py"), [
    "def _get_max_concurrent_children():",
    '    val = cfg.get("max_concurrent_children")',
    "    return max(1, int(val))",
    'configured_model = str(cfg.get("model") or "").strip() or None',
    'delegation_effort = str(delegation_cfg.get("reasoning_effort") or "").strip()',
    "effective_model = model or parent_agent.model",
  ].join("\n"));
  fs.writeFileSync(path.join(repo, "hermes_cli", "runtime_provider.py"), [
    `if provider == "openai-${stem}":`,
    `    api_mode = "${stem}_responses"`,
  ].join("\n"));
  return home;
}

function fakeHostPath() {
  const dir = workspace.make("host");
  fs.writeFileSync(
    path.join(dir, "hermes"),
    "#!/bin/sh\nprintf 'Hermes Agent v0.17.0\\n'\n",
    { mode: 0o700 },
  );
  return `${dir}${path.delimiter}${process.env.PATH}`;
}

function writeConfig(home, body) {
  fs.writeFileSync(path.join(home, "config.yaml"), body);
}

// Doctor's exit code aggregates payload integrity and route safety. Installing into
// every route home first keeps payload integrity green, so a nonzero exit in these
// cases is attributable to the route verdict and nothing else.
function installedRouteHome(label, env) {
  const home = verifiedHostHome(label);
  const result = installer(
    ["install", "--yes", "--offline", "--no-hud", "--hermes-home", home],
    { env },
  );
  if (result.status !== 0) {
    throw new Error(`isolated install failed (${result.status}):\n${result.stdout}${result.stderr}`);
  }
  return home;
}

function routeSafetyLine(output) {
  return (output.match(/^model route safety: .*$/m) || [""])[0];
}

// --- behaviour 1: model-route safety ---------------------------------------

function modelRouteSafety() {
  const hostPath = fakeHostPath();
  const env = { PATH: hostPath };
  const cases = [];

  const dryRunHome = workspace.make("route-dry-run");
  const dryRunBefore = fs.readdirSync(dryRunHome);
  const dryRun = installer(
    ["install", "--dry-run", "--offline", "--hermes-home", dryRunHome],
    { env },
  );
  const dryRunNoWrite = dryRun.status === 0
    && JSON.stringify(fs.readdirSync(dryRunHome)) === JSON.stringify(dryRunBefore)
    && !fs.existsSync(path.join(dryRunHome, "config.yaml"))
    && !fs.existsSync(path.join(dryRunHome, "lithermes", "install-manifest.json"))
    && !fs.existsSync(path.join(dryRunHome, "lithermes", "install.lock"))
    && !fs.existsSync(path.join(dryRunHome, "plugins", "lithermes"));
  cases.push({
    name: "dry-run receipt marks requested routes unapplied and unsupported surfaces unavailable",
    expected: "preview+no-write",
    observed: dryRunNoWrite
      && /lead route: requested \(gpt-6-astra, effort xhigh; unapplied\)/.test(dryRun.stdout)
      && /ordinary worker route: requested \(gpt-6-luna, effort max; unapplied\)/.test(dryRun.stdout)
      && /per-subagent model override/i.test(dryRun.stdout)
      && /TUI route visibility: unavailable/i.test(dryRun.stdout)
      ? "preview+no-write"
      : `exit=${dryRun.status} no_write=${dryRunNoWrite}`,
    detail: `install exit=${dryRun.status}; lead/worker unapplied=${/lead route: requested/.test(dryRun.stdout) && /ordinary worker route: requested/.test(dryRun.stdout)}; unsupported reviewer/TUI=${/per-subagent model override/i.test(dryRun.stdout) && /TUI route visibility: unavailable/i.test(dryRun.stdout)}; home entries=${fs.readdirSync(dryRunHome).length}`,
  });

  const malformedHome = workspace.make("route-dry-malformed");
  const malformedFile = path.join(malformedHome, "config.yaml");
  const malformedConfig = "_config_version: 30\nmodel: [unterminated\n";
  fs.writeFileSync(malformedFile, malformedConfig, { mode: 0o600 });
  const malformedDryRun = installer(
    ["install", "--dry-run", "--offline", "--hermes-home", malformedHome],
    { env },
  );
  const malformedNoWrite = malformedDryRun.status === 0
    && fs.readFileSync(malformedFile, "utf8") === malformedConfig
    && !fs.existsSync(path.join(malformedHome, "lithermes", "install-manifest.json"))
    && !fs.existsSync(path.join(malformedHome, "lithermes", "install.lock"))
    && !fs.existsSync(path.join(malformedHome, "plugins", "lithermes"));
  cases.push({
    name: "malformed model input stays a dry-run fallback without overwriting config",
    expected: "fallback+no-write",
    observed: malformedNoWrite && /model config: fallback/.test(malformedDryRun.stdout)
      && /reason: malformed host config/.test(malformedDryRun.stdout)
      ? "fallback+no-write"
      : `exit=${malformedDryRun.status} no_write=${malformedNoWrite}`,
    detail: `install exit=${malformedDryRun.status}; fallback=${/model config: fallback/.test(malformedDryRun.stdout)}; reason=${/reason: malformed host config/.test(malformedDryRun.stdout)}; config bytes preserved=${fs.readFileSync(malformedFile, "utf8") === malformedConfig}`,
  });

  const managed = verifiedHostHome("route-managed");
  const install = installer(
    ["install", "--yes", "--offline", "--no-hud", "--hermes-home", managed],
    { env },
  );
  const installedConfig = fs.readFileSync(path.join(managed, "config.yaml"), "utf8");
  const safeDoctor = installer(["doctor", "--offline", "--hermes-home", managed], { env });
  const leadConfigured = installedConfig.includes("default: gpt-6-astra")
    && installedConfig.includes("agent:\n  reasoning_effort: xhigh");
  const childConfigured = /delegation:\n  provider: [^\n]+\n  model: gpt-6-luna\n  reasoning_effort: max/.test(installedConfig);
  cases.push({
    name: "verified host installs the approved Astra lead and Luna worker routes",
    expected: "safe",
    observed: leadConfigured && childConfigured
      && /model route safety: safe/.test(safeDoctor.stdout) && safeDoctor.status === 0
      ? "safe"
      : `exit=${safeDoctor.status} ${routeSafetyLine(safeDoctor.stdout)}`,
    detail: `install exit=${install.status}; ${routeSafetyLine(safeDoctor.stdout)}; doctor exit=${safeDoctor.status}; config pins lead=${leadConfigured} child=${childConfigured}`,
  });

  const terra = installedRouteHome("route-terra-max", env);
  writeConfig(terra, [
    "_config_version: 30",
    "model:",
    `  provider: ${managedProvider}`,
    "  default: gpt-5.6-terra",
    "agent:",
    "  reasoning_effort: max",
    "plugins:",
    "  enabled:",
    "    - lithermes",
    "",
  ].join("\n"));
  const terraDoctor = installer(["doctor", "--offline", "--hermes-home", terra], { env });
  cases.push({
    name: "preserved TERRA max parent route is safe without enabling the managed child route",
    expected: "safe",
    observed: terraDoctor.status === 0 && /model route safety: safe/.test(terraDoctor.stdout)
      ? "safe"
      : `exit=${terraDoctor.status} ${routeSafetyLine(terraDoctor.stdout)}`,
    detail: `doctor exit=${terraDoctor.status}; ${routeSafetyLine(terraDoctor.stdout)}`,
  });

  const terraInherited = installedRouteHome("route-terra-inherited-under-effort", env);
  writeConfig(terraInherited, [
    "_config_version: 30",
    "model:",
    `  provider: ${managedProvider}`,
    "  default: gpt-5.6-terra",
    "agent:",
    "  reasoning_effort: max",
    "delegation:",
    "  reasoning_effort: medium",
    "plugins:",
    "  enabled:",
    "    - lithermes",
    "",
  ].join("\n"));
  const terraInheritedDoctor = installer(["doctor", "--offline", "--hermes-home", terraInherited], { env });
  cases.push({
    name: "inherited TERRA child route below high effort is blocked",
    expected: "blocked+exit1",
    observed: terraInheritedDoctor.status === 1
      && /global_child TERRA effort is below high or missing/.test(terraInheritedDoctor.stdout)
      ? "blocked+exit1"
      : `exit=${terraInheritedDoctor.status} ${routeSafetyLine(terraInheritedDoctor.stdout)}`,
    detail: `doctor exit=${terraInheritedDoctor.status}; ${routeSafetyLine(terraInheritedDoctor.stdout)}`,
  });

  const luna = installedRouteHome("route-luna-under-effort", env);
  writeConfig(luna, [
    "_config_version: 30",
    "model:",
    `  provider: ${managedProvider}`,
    "  default: gpt-5.6-luna",
    "agent:",
    "  reasoning_effort: medium",
    "delegation:",
    "  model: gpt-5.6-luna",
    "  reasoning_effort: max",
    "",
  ].join("\n"));
  const lunaDoctor = installer(["doctor", "--offline", "--hermes-home", luna], { env });
  cases.push({
    name: "Luna parent below the approved effort floor is blocked and exits nonzero",
    expected: "blocked+exit1",
    observed: lunaDoctor.status === 1 && /model route safety: blocked \(LITHERMES_UNSAFE_MODEL_ROUTE/.test(lunaDoctor.stdout)
      ? "blocked+exit1"
      : `exit=${lunaDoctor.status} ${routeSafetyLine(lunaDoctor.stdout)}`,
    detail: `doctor exit=${lunaDoctor.status}; ${routeSafetyLine(lunaDoctor.stdout)}`,
  });

  const underEffort = installedRouteHome("route-effort", env);
  writeConfig(underEffort, [
    "_config_version: 30",
    "model:",
    `  provider: ${managedProvider}`,
    "  default: gpt-5.6-sol",
    "agent:",
    "  reasoning_effort: high",
    "delegation:",
    "  model: gpt-5.6-luna",
    "  reasoning_effort: medium",
    "",
  ].join("\n"));
  const effortDoctor = installer(["doctor", "--offline", "--hermes-home", underEffort], { env });
  cases.push({
    name: "global child Luna below high effort is blocked and exits nonzero",
    expected: "blocked+exit1",
    observed: effortDoctor.status === 1 && /model route safety: blocked \(LITHERMES_UNSAFE_MODEL_ROUTE/.test(effortDoctor.stdout)
      ? "blocked+exit1"
      : `exit=${effortDoctor.status} ${routeSafetyLine(effortDoctor.stdout)}`,
    detail: `doctor exit=${effortDoctor.status}; ${routeSafetyLine(effortDoctor.stdout)}`,
  });

  const custom = installedRouteHome("route-custom", env);
  writeConfig(custom, [
    "_config_version: 30",
    "model:",
    "  provider: custom-provider",
    "  default: local-model",
    "agent:",
    "  reasoning_effort: low",
    "",
  ].join("\n"));
  const customDoctor = installer(["doctor", "--offline", "--hermes-home", custom], { env });
  cases.push({
    name: "custom provider stays outside the managed policy instead of being judged",
    expected: "not_applicable",
    observed: /model route safety: not_applicable/.test(customDoctor.stdout) && customDoctor.status === 0
      ? "not_applicable"
      : `exit=${customDoctor.status} ${routeSafetyLine(customDoctor.stdout)}`,
    detail: `doctor exit=${customDoctor.status}; ${routeSafetyLine(customDoctor.stdout)}`,
  });

  const unverified = workspace.make("route-unverified");
  const unverifiedInstall = installer(
    ["install", "--yes", "--offline", "--no-hud", "--hermes-home", unverified],
    { env },
  );
  const unverifiedConfig = fs.existsSync(path.join(unverified, "config.yaml"))
    ? fs.readFileSync(path.join(unverified, "config.yaml"), "utf8")
    : "";
  const untouched = !/gpt-5\.6|reasoning_effort|max_concurrent_children/.test(unverifiedConfig);
  cases.push({
    name: "unverified host source cannot trigger a model mutation",
    expected: "fallback+no-write",
    observed: unverifiedInstall.status === 0
      && /model config: fallback/.test(unverifiedInstall.stdout)
      && untouched
      ? "fallback+no-write"
      : `exit=${unverifiedInstall.status} wrote_model_keys=${!untouched}`,
    detail: `install exit=${unverifiedInstall.status}; ${(unverifiedInstall.stdout.match(/^model config: .*$/m) || [""])[0]}; model keys written=${!untouched}`,
  });

  return {
    behaviour: "MODEL-ROUTE SAFETY",
    surface: "bin/lithermes.js install and doctor against isolated Hermes homes",
    cases,
  };
}

// --- behaviours 2 and 3: installed plugin payload --------------------------

function installedPlugin() {
  const home = workspace.make("payload");
  const result = installer(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  if (result.status !== 0) {
    throw new Error(`isolated install failed (${result.status}):\n${result.stdout}${result.stderr}`);
  }
  return path.join(home, "plugins", "lithermes");
}

function pythonCases(script, pluginPath, behaviour, surface) {
  const result = runPython(script, [pluginPath], { cwd: packageRoot });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    return {
      behaviour,
      surface,
      cases: [{
        name: "probe execution",
        expected: "JSON result",
        observed: "PROBE_ERROR",
        detail: `exit=${result.status}\n${result.stdout}${result.stderr}`.trim(),
      }],
    };
  }
  return { behaviour, surface, cases: parsed.cases, profileBoundary: parsed.profile_boundary || null };
}

// --- runner ----------------------------------------------------------------

function pad(value, width) {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function main() {
  const isolatedProfileBefore = isolatedProfileFingerprint();
  process.stdout.write("LitHermes replacement real-surface QA — named-behaviour probes\n");
  process.stdout.write(`${"-".repeat(100)}\n`);

  const pluginPath = installedPlugin();
  const groups = [
    modelRouteSafety(),
    pythonCases(
      boundedProbe,
      pluginPath,
      "BOUNDED-AUTHORITY LIFECYCLE",
      "installed plugin core module (init/bind/record bounded work)",
    ),
    pythonCases(
      redactionProbe,
      pluginPath,
      "PROMPT-INJECTION / SECRET REDACTION",
      "installed plugin package registered against a minimal host adapter",
    ),
    pythonCases(
      knowledgeProbe,
      pluginPath,
      "WIKIFY KNOWLEDGE ADVERSARIAL",
      "installed plugin knowledge authority with isolated temporary workspaces",
    ),
  ];

  let failed = 0;
  for (const group of groups) {
    process.stdout.write(`\n${group.behaviour}\n  surface: ${group.surface}\n`);
    const nameWidth = Math.max(...group.cases.map((entry) => entry.name.length));
    for (const entry of group.cases) {
      const status = entry.observed === entry.expected ? "PASS" : "FAIL";
      if (status === "FAIL") failed += 1;
      process.stdout.write(
        `  - ${pad(entry.name, nameWidth)}  expected=${entry.expected}  observed=${entry.observed}  ${status}\n`,
      );
      process.stdout.write(`      ${entry.detail}\n`);
    }
    if (group.profileBoundary) process.stdout.write(`  profile boundary: ${group.profileBoundary}\n`);
  }

  const total = groups.reduce((count, group) => count + group.cases.length, 0);
  process.stdout.write(`${"-".repeat(100)}\n`);
  process.stdout.write(`summary: behaviours=${groups.length} cases=${total} pass=${total - failed} fail=${failed}\n`);

  const isolatedProfile = compareIsolatedProfiles(isolatedProfileBefore, isolatedProfileFingerprint());
  const receipt = workspace.removeAll();
  process.stdout.write("cleanup receipt:\n");
  for (const entry of receipt) process.stdout.write(`  removed=${entry.removed} ${entry.path}\n`);
  process.stdout.write(`  temporary roots created=${receipt.length} remaining=${receipt.filter((entry) => !entry.removed).length}\n`);
  process.stdout.write(`  isolated profile check: ${isolatedProfile.detail}\n`);
  process.stdout.write("  live/operator Hermes profile: not mutated by design (not measured by isolated fingerprint)\n");

  return failed === 0 && isolatedProfile.unchanged ? 0 : 1;
}

if (require.main === module) {
  let code = 1;
  const isolatedProfile = enterIsolatedProfile(workspace);
  try {
    code = main();
  } finally {
    isolatedProfile.restore();
    workspace.removeAll();
  }
  process.exitCode = code;
}
