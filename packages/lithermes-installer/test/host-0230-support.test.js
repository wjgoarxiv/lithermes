const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { planModelConfig } = require("../src/lib/config");
const { inspectHermesHostCapabilities } = require("../src/lib/hermesDiscovery");
const { classifyHostVersion } = require("../src/lib/modelConfigBoundary");
const { ROUTE_CATALOG, managedRequest, missingCredentialWarning } = require("../src/lib/modelRoutePolicy");

// Banner shapes are the ones hermes_cli/banner.py `format_banner_version_label` and
// hermes_cli/version_info.py `_derived_version` print on Hermes 0.23.0: the version may carry a
// `+<commits>.g<sha>[.dirty]` build suffix, and the label may end with a channel and git state.
const REAL_BANNER = "Hermes Agent v0.23.0+1558.g96cac93.dirty (2026.9.24) · stable · local 96cac937180c\n"
  + "Install directory: /Users/someone/.hermes/hermes-agent\nInstall method: git\n";
const ACCEPTED = [
  [REAL_BANNER, "0.23.0"],
  ["Hermes Agent v0.23.0 (2026.9.24) · upstream 96cac937", "0.23.0"],
  ["Hermes Agent v0.23.1+12.g96cac93 (2026.9.30) · upstream 96cac937 · local 5691c9fa (+2 carried commits)", "0.23.1"],
  ["Hermes Agent v0.23.0+3 (2026.9.24) · canary · local 96cac937180c", "0.23.0"],
  ["Hermes Agent v0.23.0+? (2026.9.24) · upstream 96cac937", "0.23.0"],
  ["Hermes Agent v0.23.0+1558.g96cac93 (2026.9.24) · commit-build · 96cac937180c", "0.23.0"],
  ["Hermes Agent v0.23.0 (2026.9.24) · installer", "0.23.0"],
  ["Hermes Agent v0.23.0 (2026.9.24) · upstream 96cac937 · local 5691c9fa (+1 carried commit)", "0.23.0"],
];
const REJECTED = [
  "0.23.0.1",
  "0.23.0-beta.1",
  "Hermes Agent v0.23.0_beta",
  "Hermes Agent v0.23.0 stable",
  "Hermes Agent v0.23.0+1558.g96cac93.dirty stable",
  "Hermes Agent v0.23.0+1558.g96cac93.dirty (2026.9.24) · stable · local",
  "Hermes Agent v0.23.0+1558.g96cac93.dirty (2026.9.24) · stable · local 96cac937180c; rm -rf /",
  "Hermes Agent v0.23.0+g96cac93 (2026.9.24)",
  "Hermes Agent v0.23.0+1558.g96cac93.dirty.x (2026.9.24)",
  "Hermes Agent v0.23.0 (2026.9.24) · up stream 96cac937",
  "Hermes Agent v0.16.9+3.g96cac93 (2026.1.1) · stable",
];

test("the Hermes 0.23.0 release banner is a verified host and 0.23.1 is a supported one beyond the matrix", () => {
  assert.deepEqual(classifyHostVersion(REAL_BANNER), { version: "0.23.0", status: "verified" });
  assert.deepEqual(classifyHostVersion("Hermes Agent v0.23.1+12.g96cac93 (2026.9.30) · stable · local 96cac937180c"), {
    version: "0.23.1", status: "beyond-verified",
  });
});

test("every banner shape the 0.23 host prints yields its release version", () => {
  for (const [banner, version] of ACCEPTED) {
    assert.equal(classifyHostVersion(banner).version, version, banner);
    assert.notEqual(classifyHostVersion(banner).status, "malformed", banner);
  }
});

test("banners outside the host's printed grammar stay rejected", () => {
  for (const banner of REJECTED) {
    const { status } = classifyHostVersion(banner);
    assert.ok(status === "malformed" || status === "too-old", `${banner} -> ${status}`);
  }
});

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { force: true, recursive: true });
});

// Fixture lines are the ones on the 0.23.0 host: tools/delegate_tool_config.py:104-110 (the
// concurrency knob), :482 (the per-key model/provider read), :559 (the delegation effort read,
// now behind `(delegation_cfg or {})`) and :581 (the child model fallback), plus
// hermes_cli/runtime_provider.py:577 (the pool-entry table).
test("the 0.23.0 host layout still exposes concurrency, the delegation route and the Responses runtime", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-capabilities-0230-"));
  tempDirs.push(repo);
  fs.mkdirSync(path.join(repo, "tools"), { recursive: true });
  fs.mkdirSync(path.join(repo, "hermes_cli"), { recursive: true });
  fs.writeFileSync(path.join(repo, "tools", "delegate_tool.py"), "from tools.delegate_tool_config import _get_max_concurrent_children\n");
  fs.writeFileSync(path.join(repo, "tools", "delegate_tool_config.py"), [
    "def _get_max_concurrent_children() -> int:",
    "    result = _knob(",
    "        \"max_concurrent_children\", \"DELEGATION_MAX_CONCURRENT_CHILDREN\", lambda v: max(1, int(v)),",
    "    )",
    "    return result",
    "def _resolve_delegation_credentials(cfg: dict, parent_agent) -> dict:",
    "    values = {k: str(cfg.get(k) or \"\").strip() or None for k in (\"model\", \"provider\", \"base_url\", \"api_key\")}",
    "def _child_reasoning(parent_agent, delegation_cfg, override_reasoning_effort=None):",
    "        delegation_effort = (delegation_cfg or {}).get(\"reasoning_effort\")",
    "def _resolve_child_runtime(parent_agent, delegation_cfg, parent_api_key, *, model):",
    "    effective_model = model or parent_agent.model",
  ].join("\n"));
  const stem = ["co", "dex"].join("");
  fs.writeFileSync(path.join(repo, "hermes_cli", "runtime_provider.py"), [
    "_POOL_ENTRY_SIMPLE_MODES: dict[str, tuple] = {",
    `    "openai-${stem}": ("${stem}_responses", DEFAULT_BASE_URL), "xai-oauth": ("${stem}_responses", DEFAULT_XAI_OAUTH_BASE_URL),`,
    "}",
  ].join("\n"));
  assert.deepEqual(inspectHermesHostCapabilities(repo), {
    concurrencyHard: true, delegationRouteHard: true, runtimeHard: true,
  });
});

test("a delegation route that never reads reasoning_effort stays unverified", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-capabilities-0230-"));
  tempDirs.push(repo);
  fs.mkdirSync(path.join(repo, "tools"), { recursive: true });
  fs.mkdirSync(path.join(repo, "hermes_cli"), { recursive: true });
  fs.writeFileSync(path.join(repo, "tools", "delegate_tool_config.py"), [
    "def _get_max_concurrent_children() -> int:",
    "    return _knob(\"max_concurrent_children\", \"DELEGATION_MAX_CONCURRENT_CHILDREN\", lambda v: max(1, int(v)))",
    "    values = {k: str(cfg.get(k) or \"\").strip() or None for k in (\"model\", \"provider\")}",
    "    effective_model = model or parent_agent.model",
  ].join("\n"));
  fs.writeFileSync(path.join(repo, "hermes_cli", "runtime_provider.py"), "# nothing\n");
  assert.equal(inspectHermesHostCapabilities(repo).delegationRouteHard, false);
});

test("a fresh install against the 0.23.0 banner plans the managed route and compaction defaults", () => {
  const plan = planModelConfig("", {
    hostCapabilities: { concurrencyHard: true, delegationRouteHard: true, runtimeHard: true },
    hostVersion: REAL_BANNER,
  });
  assert.equal(plan.action, "write");
  assert.equal(plan.reason, "verified Hermes 0.23.0 model schema");
  assert.notEqual(plan.capabilities.leadRoute.status, "unavailable");
  assert.notEqual(plan.capabilities.delegationRoute.status, "unavailable");
});

test("--provider xai-oauth selects the OAuth catalog with the xai models and no API-key warning", () => {
  const route = managedRequest({ provider: "xai-oauth" });
  assert.equal(route.provider, "xai-oauth");
  assert.equal(route.childProvider, "xai-oauth");
  assert.equal(route.model, ROUTE_CATALOG.xai.lead.model);
  assert.equal(route.childModel, ROUTE_CATALOG.xai.helper.model);
  assert.deepEqual(
    [...new Set(ROUTE_CATALOG["xai-oauth"].rows.map((row) => row.model))],
    [...new Set(ROUTE_CATALOG.xai.rows.map((row) => row.model))],
  );
  assert.equal(ROUTE_CATALOG["xai-oauth"].credentialEnv, null);
  assert.equal(missingCredentialWarning(route, {}), null);
});

test("the host's own spellings of xai-oauth resolve to the host's provider id", () => {
  for (const alias of ["xai-oauth", "x-ai-oauth", "grok-oauth", "xai-grok-oauth", "GROK-OAuth"]) {
    assert.equal(managedRequest({ provider: alias }).provider, "xai-oauth", alias);
    assert.equal(managedRequest({ childProvider: alias }).childProvider, "xai-oauth", alias);
  }
  assert.equal(managedRequest({ provider: "xai" }).provider, "xai");
  assert.throws(() => managedRequest({ provider: "xai-oauth-2" }), /unknown provider/i);
});

test("the unknown-provider message lists xai-oauth", () => {
  assert.throws(() => managedRequest({ provider: "anthropic" }), /openai-[a-z]+, xai, xai-oauth/);
});

// Hermes 0.23 puts a two-line sh wrapper on PATH (`exec <repo>/.hermes/bin/hermes "$@"`), so the
// repo cannot be read from a python shebang; without it every capability marker stays unverified.
test("the runtime repo is found behind the 0.23 sh launcher as well as behind a python shebang", () => {
  const { detectHermesRuntimeRepo } = require("../src/lib/hermesDiscovery");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-launcher-"));
  tempDirs.push(root);
  const repo = path.join(root, "hermes-agent");
  fs.mkdirSync(path.join(repo, "hermes_cli"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".hermes", "bin"), { recursive: true });
  fs.mkdirSync(path.join(repo, "venv", "bin"), { recursive: true });
  const launcherDir = path.join(root, "bin");
  fs.mkdirSync(launcherDir);
  const previous = process.env.PATH;
  try {
    process.env.PATH = launcherDir;
    fs.writeFileSync(path.join(launcherDir, "hermes"), `#!/bin/sh\nexec ${path.join(repo, ".hermes", "bin", "hermes")} "$@"\n`);
    assert.equal(detectHermesRuntimeRepo(), repo);
    fs.writeFileSync(path.join(launcherDir, "hermes"), `#!${path.join(repo, "venv", "bin", "python")}\nprint(1)\n`);
    assert.equal(detectHermesRuntimeRepo(), repo);
    fs.writeFileSync(path.join(launcherDir, "hermes"), "#!/bin/sh\nexec /usr/bin/true \"$@\"\n");
    assert.equal(detectHermesRuntimeRepo(), null);
  } finally {
    process.env.PATH = previous;
  }
});
