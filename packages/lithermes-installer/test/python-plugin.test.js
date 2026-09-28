const { readDocumentation } = require("./documentation-reader");
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolvePython, runPythonTests } = require("../scripts/test-python.js");

function assertPythonSuitePassed(result) {
  assert.equal(result.status, 0, `python plugin tests failed:\n${result.output}`);
  const summary = result.output.match(
    /(?:^|\r?\n)Ran ([1-9]\d*) tests? in \d+(?:\.\d+)?s\r?\n\r?\nOK(?: \(skipped=(\d+)\))?\r?\n?$/,
  );
  assert.ok(summary, "python plugin tests must emit a complete terminal unittest success summary");
  const total = Number(summary[1]);
  const skipped = summary[2] === undefined ? 0 : Number(summary[2]);
  const verboseSkips = (result.output.match(/^.* \.\.\. skipped .+$/gm) || []).length;
  assert.equal(skipped, verboseSkips, "unittest summary must account for every reported skip");
  assert.ok(total > skipped, "python plugin suite must execute at least one non-skipped test");
}

test("python plugin runtime tests pass", (t) => {
  const result = runPythonTests();
  if (!result.python) {
    t.skip("python3 not available — skipping plugin runtime tests");
    return;
  }
  assert.equal(result.hasYaml, true, "repository Python gate requires PyYAML");
  assert.equal(result.hasJsonschema, true, "repository Python gate requires jsonschema");
  assert.equal(result.isolated, true, "Python gate must isolate HOME, HERMES_HOME, and cwd");
  assert.equal(fs.existsSync(result.sandbox), false, "Python gate must remove its sandbox");
  assertPythonSuitePassed(result);
});

test("package exposes the isolated Python gate as the repository-authoritative command", () => {
  const packageRoot = path.resolve(__dirname, "..");
  const pkg = require(path.join(packageRoot, "package.json"));
  assert.equal(pkg.scripts["test:python"], "node scripts/test-python.js");
  assert.match(
    readDocumentation(path.join(packageRoot, "README.md")),
    /npm run test:python[\s\S]{0,900}isolated HOME[\s\S]{0,100}HERMES_HOME/,
  );
});

test("Python selection is strict and the wrapper rejects a real failing subprocess", (t) => {
  if (process.platform === "win32") {
    t.skip("executable fixture uses a POSIX shebang");
    return;
  }
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-python-selection."));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const writeFixture = (
    name,
    hasJsonschema,
    suiteStatus = 0,
    suiteOutput =
      "test_optional_one ... skipped 'optional'\n" +
      "test_optional_two ... skipped 'optional'\n\n" +
      "----------------------------------------------------------------------\n" +
      "Ran 533 tests in 0.001s\n\nOK (skipped=2)\n",
  ) => {
    const fixture = path.join(fixtureRoot, name);
    fs.writeFileSync(fixture, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("Python 3.12.0"); process.exit(0); }
if (args[0] === "-c") {
  const probe = args[1] || "";
  if (probe.includes("jsonschema")) process.exit(${hasJsonschema ? 0 : 1});
  process.exit(probe.includes("matplotlib") || probe.includes("numpy") ? 1 : 0);
}
if (args[0] === "-m" && args[1] === "unittest") {
  process.stderr.write(${JSON.stringify(suiteOutput)});
  process.exit(${suiteStatus});
}
process.exit(2);
`);
    fs.chmodSync(fixture, 0o755);
    return fixture;
  };
  const yamlOnly = writeFixture("python-yaml-only", false);
  const complete = writeFixture("python-complete", true);
  const baseEnv = { ...process.env, PATH: `${fixtureRoot}${path.delimiter}${process.env.PATH || ""}` };
  delete baseEnv.LITHERMES_PYTHON;

  const resolved = resolvePython({ env: baseEnv, candidates: [yamlOnly, complete] });
  assert.equal(resolved.python, complete, "YAML-only candidate must be skipped for a complete interpreter");
  assert.equal(resolved.hasJsonschema, true);

  const ambient = runPythonTests({ env: baseEnv, candidates: [yamlOnly, complete] });
  assert.equal(ambient.python, complete);
  assert.equal(ambient.hasYaml, true);
  assert.equal(ambient.hasJsonschema, true);
  assert.deepEqual(ambient.scienceImports, { matplotlib: false, numpy: false });
  assert.equal(ambient.status, 0, ambient.output);
  assert.match(ambient.output, /OK \(skipped=2\)/);
  assertPythonSuitePassed(ambient);

  const explicit = runPythonTests({
    env: { ...baseEnv, LITHERMES_PYTHON: yamlOnly },
  });
  assert.equal(explicit.status, 1);
  assert.equal(explicit.isolated, false);
  assert.match(explicit.output, /LITHERMES_PYTHON.*authoritative/i);
  assert.match(explicit.output, /jsonschema/i);

  const explicitComplete = runPythonTests({
    env: { ...baseEnv, LITHERMES_PYTHON: complete },
  });
  assert.equal(explicitComplete.status, 0, explicitComplete.output);
  assert.match(explicitComplete.output, /OK \(skipped=2\)/);

  const failing = writeFixture(
    "python-failing",
    true,
    1,
    "test_real_failure ... FAIL\n\n----------------------------------------------------------------------\nRan 1 test in 0.001s\n\nFAILED (failures=1)\n",
  );
  const failed = runPythonTests({
    env: { ...baseEnv, LITHERMES_PYTHON: failing },
  });
  assert.equal(failed.status, 1);
  assert.equal(fs.existsSync(failed.sandbox), false, "failed Python gate must remove its sandbox");
  assert.throws(() => assertPythonSuitePassed(failed), /python plugin tests failed/);
});

test("the release checklist distinguishes pinned CI bootstrap from local import-based Python selection", () => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  for (const relative of ["RELEASE_CHECKLIST.md"]) {
    const text = fs.readFileSync(path.join(repoRoot, relative), "utf8");
    assert.match(
      text,
      /CI\/publish bootstrap[\s\S]{0,220}PyYAML==6\.0\.3[\s\S]{0,100}jsonschema==4\.26\.0/i,
      `${relative} must scope exact pins to CI/publish bootstrap`,
    );
    assert.match(
      text,
      /scripts\/test-python\.js[\s\S]{0,300}(?:import successfully|성공적으로 import)/i,
      `${relative} must describe local import-based interpreter selection`,
    );
    assert.match(text, /does not enforce|강제하지/i, `${relative} must deny local exact-version enforcement`);
    assert.match(text, /matplotlib[\s\S]{0,180}(?:optional|skip|선택|생략|비필수)/i, `${relative} must keep science dependencies optional`);
  }
});

test("scientific capability and execution guards use actual import probes, never find_spec", () => {
  const packageRoot = path.resolve(__dirname, "..");
  const adapter = fs.readFileSync(path.join(packageRoot, "assets", "lithermes-plugin", "scientific_visualization.py"), "utf8");
  const execution = fs.readFileSync(path.join(packageRoot, "test", "python", "test_scientific_visualization_execution.py"), "utf8");
  assert.doesNotMatch(adapter, /find_spec/);
  assert.match(adapter, /import_module/);
  assert.doesNotMatch(execution, /find_spec/);
  assert.match(execution, /import_module/);
});
