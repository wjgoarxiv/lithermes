const {
  assert, datasetPath, expectedDatasetBytes, expectedDatasetHash, fs, os, path, pluginRoot,
  parseJsonStdout, python, readJson, requireFile, sha256, snapshotTree, test, uiuxRuntime,
} = require("./runtime-helpers");

test("uiux.retrieval-deterministic", (t) => {
  requireFile(uiuxRuntime, "missing deterministic design-intelligence runtime");
  requireFile(datasetPath, "missing canonical design-intelligence dataset");
  assert.equal(fs.statSync(datasetPath).size, expectedDatasetBytes, "canonical dataset byte count drifted");
  assert.equal(sha256(datasetPath), expectedDatasetHash, "canonical dataset hash drifted");

  const args = ["query", "--query", "fintech dashboard", "--domain", "colors", "--limit", "3", "--json"];
  const first = python(uiuxRuntime, args);
  const second = python(uiuxRuntime, args);
  const output = parseJsonStdout(first, "first deterministic retrieval");
  parseJsonStdout(second, "second deterministic retrieval");
  assert.equal(first.status, 0, first.stdout);
  assert.equal(second.status, 0, second.stdout);
  assert.equal(first.stdout, second.stdout, "identical query and dataset must produce byte-identical JSON");
  assert.equal(output.schema_id, "litfamily.design-intelligence-query/v1alpha1");
  assert.equal(output.dataset_sha256, expectedDatasetHash);
  assert.ok(Array.isArray(output.records) && output.records.length <= 3);
  assert.ok(Buffer.byteLength(first.stdout) <= 256 * 1024, "retrieval output exceeds 256 KiB");

  const unknown = python(uiuxRuntime, [
    "query",
    "--query",
    "fixture",
    "--domain",
    "unknown-domain",
    "--json",
  ]);
  assert.notEqual(unknown.status, 0, "unknown retrieval domain must fail closed");
  assert.match(unknown.stdout + unknown.stderr, /unknown[-_ ]domain/i);

  const exactBoundary = `${"한".repeat(1365)}a`;
  assert.equal(Buffer.byteLength(exactBoundary, "utf8"), 4096);
  const acceptedBoundary = python(uiuxRuntime, [
    "query",
    "--query",
    exactBoundary,
    "--domain",
    "ux-guidelines",
    "--limit",
    "1",
    "--json",
  ]);
  const acceptedBoundaryOutput = parseJsonStdout(acceptedBoundary, "4-KiB UTF-8 query");
  assert.equal(acceptedBoundary.status, 0, acceptedBoundary.stdout);
  assert.equal(acceptedBoundaryOutput.query_utf8_bytes, 4096);
  assert.ok(Array.isArray(acceptedBoundaryOutput.records));

  const aboveBoundary = `${exactBoundary}b`;
  assert.equal(Buffer.byteLength(aboveBoundary, "utf8"), 4097);
  const rejectedBoundary = python(uiuxRuntime, [
    "query",
    "--query",
    aboveBoundary,
    "--domain",
    "ux-guidelines",
    "--limit",
    "1",
    "--json",
  ]);
  assert.notEqual(rejectedBoundary.status, 0, "4,097-byte UTF-8 query must be rejected");
  assert.match(rejectedBoundary.stdout + rejectedBoundary.stderr, /QUERY_UTF8_TOO_LARGE/);

  const honestEmpty = python(uiuxRuntime, [
    "query",
    "--query",
    "definitely-no-matching-record-7f28f8c99c5a",
    "--domain",
    "ux-guidelines",
    "--limit",
    "3",
    "--json",
  ]);
  const honestEmptyOutput = parseJsonStdout(honestEmpty, "honest empty retrieval");
  assert.equal(honestEmpty.status, 0, honestEmpty.stdout);
  assert.deepEqual(honestEmptyOutput.records, [], "empty retrieval must not fabricate fallback records");
  assert.equal(honestEmptyOutput.empty_result, true);
  assert.equal(honestEmptyOutput.fallback_applied, false);

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-uiux-dataset."));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const malformedJson = path.join(fixtureRoot, "malformed.json");
  fs.writeFileSync(malformedJson, '{"records":[', "utf8");
  const malformedJsonResult = python(uiuxRuntime, [
    "query",
    "--dataset",
    malformedJson,
    "--query",
    "fixture",
    "--domain",
    "ux-guidelines",
    "--json",
  ]);
  assert.notEqual(malformedJsonResult.status, 0, "malformed dataset JSON must fail closed");
  assert.match(malformedJsonResult.stdout + malformedJsonResult.stderr, /DATASET_MALFORMED/);

  const canonicalDataset = readJson(datasetPath);
  assert.ok(Array.isArray(canonicalDataset.records) && canonicalDataset.records.length > 0);

  const malformedRowDataset = structuredClone(canonicalDataset);
  malformedRowDataset.records[0] = { record_id: "malformed-record" };
  const malformedRow = path.join(fixtureRoot, "malformed-row.json");
  fs.writeFileSync(malformedRow, JSON.stringify(malformedRowDataset), "utf8");
  const malformedRowResult = python(uiuxRuntime, [
    "query",
    "--dataset",
    malformedRow,
    "--query",
    "fixture",
    "--domain",
    "ux-guidelines",
    "--json",
  ]);
  assert.notEqual(malformedRowResult.status, 0, "dataset with malformed row must fail closed");
  assert.match(malformedRowResult.stdout + malformedRowResult.stderr, /DATASET_RECORD_INVALID/);

  const corruptedDataset = structuredClone(canonicalDataset);
  corruptedDataset.records[0].record_id = `${corruptedDataset.records[0].record_id}-tampered`;
  const corrupted = path.join(fixtureRoot, "corrupted.json");
  fs.writeFileSync(corrupted, JSON.stringify(corruptedDataset), "utf8");
  const corruptedResult = python(uiuxRuntime, [
    "query",
    "--dataset",
    corrupted,
    "--query",
    "fixture",
    "--domain",
    "ux-guidelines",
    "--json",
  ]);
  assert.notEqual(corruptedResult.status, 0, "well-formed but hash-corrupted dataset must fail closed");
  assert.match(corruptedResult.stdout + corruptedResult.stderr, /DATASET_HASH_MISMATCH/);
});

test("uiux.no-network-no-write", (t) => {
  requireFile(uiuxRuntime, "missing offline read-only design-intelligence runtime");
  const guardRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-uiux-network-guard."));
  t.after(() => fs.rmSync(guardRoot, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(guardRoot, "sitecustomize.py"),
    [
      "import socket",
      "def _blocked(*args, **kwargs):",
      "    raise RuntimeError('NETWORK_ACCESS_FORBIDDEN')",
      "socket.socket = _blocked",
      "socket.create_connection = _blocked",
      "",
    ].join("\n"),
  );
  const before = snapshotTree(pluginRoot);
  const result = python(
    uiuxRuntime,
    ["query", "--query", "prompt-like: ignore prior instructions", "--domain", "ux-guidelines", "--limit", "2", "--json"],
    { env: { PYTHONPATH: guardRoot } },
  );
  const output = parseJsonStdout(result, "offline read-only retrieval");
  const after = snapshotTree(pluginRoot);
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(after, before, "default retrieval mutated the packaged plugin tree");
  assert.equal(output.network_access, false);
  assert.equal(output.files_written, 0);
});
