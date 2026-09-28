const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { inspectHermesHostCapabilities } = require("../src/lib/hermesDiscovery");

// July/August 2026 regression: the Hermes 0.21.0 host refactored the source files these
// markers are read from (tools/delegate_tool.py split into tools/delegate_tool_config.py;
// hermes_cli/runtime_provider.py moved from an if/elif chain to a data table), so a host
// running 0.21.0 reported "model config: fallback" for capabilities that are genuinely
// present, just expressed differently. These tests pin both layouts.
const runtimeStem = ["co", "dex"].join("");
const openaiProvider = `openai-${runtimeStem}`;
const responsesMode = `${runtimeStem}_responses`;
const tempDirs = [];

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-capabilities-"));
  tempDirs.push(repo);
  fs.mkdirSync(path.join(repo, "tools"), { recursive: true });
  fs.mkdirSync(path.join(repo, "hermes_cli"), { recursive: true });
  return repo;
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { force: true, recursive: true });
});

test("recognizes the 0.17/0.19 layout: markers inlined in tools/delegate_tool.py", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, "tools", "delegate_tool.py"), [
    "def _get_max_concurrent_children():",
    "    val = cfg.get(\"max_concurrent_children\")",
    "    return max(1, int(val))",
    "configured_model = str(cfg.get(\"model\") or \"\").strip() or None",
    "delegation_effort = str(delegation_cfg.get(\"reasoning_effort\") or \"\").strip()",
    "effective_model = model or parent_agent.model",
  ].join("\n"));
  fs.writeFileSync(path.join(repo, "hermes_cli", "runtime_provider.py"), [
    `if provider == "${openaiProvider}":`,
    `    api_mode = "${responsesMode}"`,
  ].join("\n"));
  const capabilities = inspectHermesHostCapabilities(repo);
  assert.deepEqual(capabilities, { concurrencyHard: true, delegationRouteHard: true, runtimeHard: true });
});

// Fixture mirrors the real, read-only 0.21.0 host source at
// a read-only Hermes 0.21.0 host source tree (tools/delegate_tool_config.py:84-93,370;
// hermes_cli/runtime_provider.py:415-428): the concurrency knob moved into a
// _knob()-based helper, the config-level model override moved from a single
// `configured_model` line into a per-key dict comprehension in
// _resolve_delegation_credentials(), and the runtime provider markers moved from an
// if/elif chain into the _POOL_ENTRY_SIMPLE_MODES data table.
test("recognizes the 0.21.0 layout: knobs and routing moved into tools/delegate_tool_config.py", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, "tools", "delegate_tool.py"), [
    "from tools.delegate_tool_config import _get_max_concurrent_children",
    "max_children = _get_max_concurrent_children()",
  ].join("\n"));
  fs.writeFileSync(path.join(repo, "tools", "delegate_tool_config.py"), [
    "def _get_max_concurrent_children() -> int:",
    "    result = _knob(",
    "        \"max_concurrent_children\", \"DELEGATION_MAX_CONCURRENT_CHILDREN\", lambda v: max(1, int(v)),",
    "        _DEFAULT_MAX_CONCURRENT_CHILDREN,",
    "    )",
    "    return result",
    "",
    "def _resolve_delegation_credentials(cfg: dict, parent_agent) -> dict:",
    "    values = {k: str(cfg.get(k) or \"\").strip() or None for k in (\"model\", \"provider\", \"base_url\", \"api_key\")}",
    "    return values",
    "",
    "def _resolve_child_runtime(parent_agent, delegation_cfg, parent_api_key, *, model, **kwargs):",
    "    effective_model = model or parent_agent.model",
    "    delegation_effort = delegation_cfg.get(\"reasoning_effort\")",
    "    return effective_model",
  ].join("\n"));
  fs.writeFileSync(path.join(repo, "hermes_cli", "runtime_provider.py"), [
    "_POOL_ENTRY_SIMPLE_MODES: Dict[str, tuple] = {",
    `    "${openaiProvider}": ("${responsesMode}", DEFAULT_BASE_URL), "xai-oauth": ("${responsesMode}", DEFAULT_XAI_OAUTH_BASE_URL),`,
    "}",
  ].join("\n"));
  const capabilities = inspectHermesHostCapabilities(repo);
  assert.deepEqual(capabilities, { concurrencyHard: true, delegationRouteHard: true, runtimeHard: true });
});

test("a fixture without any known marker stays fully unverified (failure scenario)", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, "tools", "delegate_tool.py"), "# no markers here\n");
  fs.writeFileSync(path.join(repo, "hermes_cli", "runtime_provider.py"), "# no markers here\n");
  const capabilities = inspectHermesHostCapabilities(repo);
  assert.deepEqual(capabilities, { concurrencyHard: false, delegationRouteHard: false, runtimeHard: false });
});

test("a missing repo stays fully unverified", () => {
  assert.deepEqual(inspectHermesHostCapabilities(null), {
    concurrencyHard: false, delegationRouteHard: false, runtimeHard: false,
  });
});
