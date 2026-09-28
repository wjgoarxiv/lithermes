const {
  assert, fs, importerRuntime, parseJsonStdout, path, pluginRoot, python, readJson,
  requireFile, scenarioDriver, scenarioFixtures, sha256, spawnSync, test, uiuxRoot,
} = require("./runtime-helpers");

test("uiux.import-source-contract", () => {
  requireFile(importerRuntime, "missing 34-source import checker");
  const manifestPath = path.join(uiuxRoot, "resources", "import-manifest.json");
  requireFile(manifestPath, "missing source import manifest");
  const manifest = readJson(manifestPath);
  assert.equal(manifest.schema_version, "litfamily.source-import-manifest/v1");
  assert.equal(manifest.sources.length, 34);
  assert.equal(new Set(manifest.sources.map((source) => source.path)).size, 34);
  assert.equal(sha256(manifestPath), "9adf471d95aaf17e7866e1c7674cb1a101daae9abdab87c71c96a60f2a58e6fa");

  const missingSource = python(importerRuntime, [
    "--source-root",
    path.join(scenarioFixtures, "missing-source-root"),
    "--check",
    "--expect-records",
    "2277",
    "--max-bytes",
    "4194304",
  ]);
  assert.notEqual(missingSource.status, 0, "missing pinned source root must fail closed");
  assert.doesNotMatch(missingSource.stdout, /SOURCE_CONTRACT_PASS/);

  const runtimeFiles = [
    path.join(pluginRoot, "uiux_runtime_common.py"),
    ...fs.readdirSync(path.dirname(importerRuntime))
      .filter((name) => name.endsWith(".py"))
      .map((name) => path.join(path.dirname(importerRuntime), name)),
    ...fs.readdirSync(path.join(pluginRoot, "skills", "visual-qa", "scripts"))
      .filter((name) => name.endsWith(".py"))
      .map((name) => path.join(pluginRoot, "skills", "visual-qa", "scripts", name)),
  ];
  const syntaxProbe = spawnSync(
    "python3",
    [
      "-c",
      [
        "import ast, pathlib, sys",
        "files = [pathlib.Path(item) for item in sys.argv[1:]]",
        "[ast.parse(file.read_text(), filename=str(file), feature_version=(3, 9)) for file in files]",
      ].join("; "),
      ...runtimeFiles,
    ],
    { encoding: "utf8" },
  );
  assert.equal(syntaxProbe.status, 0, `installed runtime is not Python 3.9 syntax compatible:\n${syntaxProbe.stderr}`);
});

test("integration.eight-scenario-driver", () => {
  requireFile(scenarioDriver, "missing deterministic eight-scenario driver");
  requireFile(path.join(scenarioFixtures, "scenarios.json"), "missing scenario fixtures");
  requireFile(path.join(scenarioFixtures, "expected-results.json"), "missing expected scenario results");
  const result = python(
    scenarioDriver,
    [
      "--installed-root",
      pluginRoot,
      "--fixtures",
      scenarioFixtures,
      "--scenario",
      "all",
      "--json",
    ],
  );
  const output = parseJsonStdout(result, "eight-scenario driver");
  assert.equal(result.status, 0, result.stdout);
  assert.equal(output.results.length, 8);
  assert.equal(new Set(output.results.map((entry) => entry.scenario_id)).size, 8);
  assert.equal(output.seeded_critical_high_detected, 8);
  assert.equal(output.false_pass_count, 0);
  assert.ok(output.results.every((entry) => entry.verdict !== "PASS"));
  const missing = output.results.find((entry) => entry.scenario_id === "missing-capture-auth-review");
  assert.deepEqual(missing.blocked_codes, [
    "BLOCKED_RENDERER_UNAVAILABLE",
    "BLOCKED_AUTH_UNAVAILABLE",
    "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
  ]);
  const terminal = output.results.find((entry) => entry.scenario_id === "cjk-terminal-dashboard");
  assert.equal(terminal.osc_inert, true);
  assert.ok(terminal.finding_codes.includes("TUI_BORDER_TOPOLOGY_INVALID"));
});
