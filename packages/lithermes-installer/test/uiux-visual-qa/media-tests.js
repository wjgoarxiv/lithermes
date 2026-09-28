const {
  assert, fs, os, parseJsonStdout, path, pngChunk, python, requireFile, rgbaPng, test,
  visualQaRuntime, zlib,
} = require("./runtime-helpers");

test("visualqa.png-resource-bounds", (t) => {
  requireFile(visualQaRuntime, "missing bounded PNG inspector");
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-visualqa-png.")));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const truncated = path.join(tempRoot, "truncated-valid.png");
  const validPng = rgbaPng(1, 1);
  fs.writeFileSync(truncated, validPng.subarray(0, validPng.length - 5));
  const truncatedResult = python(visualQaRuntime, ["inspect-png", truncated, "--json"]);
  assert.equal(truncatedResult.signal, null, `truncated PNG inspection terminated by ${truncatedResult.signal}`);
  assert.equal(
    truncatedResult.error,
    undefined,
    `truncated PNG inspection failed to spawn: ${truncatedResult.error?.message}`,
  );
  assert.notEqual(truncatedResult.status, 0, "truncated otherwise-valid PNG must fail closed");
  assert.match(truncatedResult.stdout + truncatedResult.stderr, /PNG_TRUNCATED/);
  assert.doesNotMatch(
    truncatedResult.stdout + truncatedResult.stderr,
    /similarity/i,
    "truncated PNG must not receive a similarity result",
  );

  const corrupt = path.join(tempRoot, "corrupt-crc.png");
  fs.writeFileSync(corrupt, rgbaPng(1, 1, { corruptIhdrCrc: true }));
  const corruptResult = python(visualQaRuntime, ["inspect-png", corrupt, "--json"]);
  assert.notEqual(corruptResult.status, 0, "corrupt PNG CRC must fail closed");
  assert.match(corruptResult.stdout + corruptResult.stderr, /CRC/i);

  const oversized = path.join(tempRoot, "oversized.png");
  const oversizedHeader = Buffer.alloc(13);
  oversizedHeader.writeUInt32BE(16385, 0);
  oversizedHeader.writeUInt32BE(1, 4);
  oversizedHeader[8] = 8;
  oversizedHeader[9] = 6;
  fs.writeFileSync(
    oversized,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", oversizedHeader),
      pngChunk("IDAT", zlib.deflateSync(Buffer.from([0]))),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
  const oversizedResult = python(visualQaRuntime, ["inspect-png", oversized, "--json"]);
  assert.notEqual(oversizedResult.status, 0, "PNG width above 16,384 must be rejected before decode");
  assert.match(oversizedResult.stdout + oversizedResult.stderr, /dimension|16384|resource/i);

  const pixels = Buffer.from([
    255, 0, 0, 0,
    0, 255, 0, 8,
    0, 0, 255, 255,
    255, 255, 255, 128,
  ]);
  for (let filterType = 0; filterType <= 4; filterType++) {
    const filtered = path.join(tempRoot, `filter-${filterType}.png`);
    fs.writeFileSync(filtered, rgbaPng(2, 2, { filterType, pixels }));
    const inspected = python(visualQaRuntime, ["inspect-png", filtered, "--json"]);
    const inspectedOutput = parseJsonStdout(inspected, `PNG filter ${filterType}`);
    assert.equal(inspected.status, 0, inspected.stdout);
    assert.equal(inspectedOutput.decoded, true);
    assert.equal(inspectedOutput.alpha.transparent, 1);
    assert.equal(inspectedOutput.alpha.nearly_transparent, 1);
    assert.equal(inspectedOutput.filter_counts[String(filterType)], 2);
  }

  const brokenOrder = path.join(tempRoot, "nonconsecutive-idat.png");
  fs.writeFileSync(brokenOrder, rgbaPng(1, 1, { splitIdat: true, breakIdatOrder: true }));
  const brokenOrderResult = python(visualQaRuntime, ["inspect-png", brokenOrder, "--json"]);
  assert.notEqual(brokenOrderResult.status, 0, "non-consecutive IDAT chunks must fail closed");
  assert.match(brokenOrderResult.stdout + brokenOrderResult.stderr, /PNG_CHUNK_ORDER_INVALID/);

  const duplicateHeader = path.join(tempRoot, "duplicate-ihdr.png");
  const base = rgbaPng(1, 1);
  const ihdrChunkLength = 25;
  fs.writeFileSync(
    duplicateHeader,
    Buffer.concat([base.subarray(0, 8 + ihdrChunkLength), base.subarray(8)]),
  );
  const duplicateHeaderResult = python(visualQaRuntime, ["inspect-png", duplicateHeader, "--json"]);
  assert.notEqual(duplicateHeaderResult.status, 0, "duplicate IHDR must fail closed");
  assert.match(duplicateHeaderResult.stdout + duplicateHeaderResult.stderr, /PNG_CHUNK_ORDER_INVALID/);

  const reference = path.join(tempRoot, "reference.png");
  const changed = path.join(tempRoot, "changed.png");
  const mismatch = path.join(tempRoot, "mismatch.png");
  fs.writeFileSync(reference, rgbaPng(2, 2, { pixels }));
  const changedPixels = Buffer.from(pixels);
  changedPixels[3] = 255;
  fs.writeFileSync(changed, rgbaPng(2, 2, { pixels: changedPixels }));
  fs.writeFileSync(mismatch, rgbaPng(1, 1));
  const compared = python(visualQaRuntime, ["compare-png", reference, changed, "--json"]);
  const comparedOutput = parseJsonStdout(compared, "bounded PNG comparison");
  assert.equal(compared.status, 0, compared.stdout);
  assert.ok(comparedOutput.similarity < 1 && comparedOutput.similarity >= 0);
  assert.equal(comparedOutput.alpha_damage_pixels, 1);
  const dimensionMismatch = python(visualQaRuntime, ["compare-png", reference, mismatch, "--json"]);
  assert.notEqual(dimensionMismatch.status, 0, "dimension mismatch must fail closed");
  assert.doesNotMatch(
    dimensionMismatch.stdout + dimensionMismatch.stderr,
    /"similarity":/,
    "dimension mismatch must not receive normal similarity",
  );
});

test("visualqa.tui-unicode-osc", () => {
  requireFile(visualQaRuntime, "missing Unicode/OSC-safe TUI inspector");
  const capture = [
    "\u001b]8;;https://example.invalid/\u0007링크\u001b]8;;\u0007",
    "┌──────┐",
    "│한👩‍💻글│",
    "└─────┘",
  ].join("\n");
  const result = python(visualQaRuntime, ["check-tui", "--cols", "8", "--ambiguous-width", "2", "--json"], {
    input: capture,
  });
  const output = parseJsonStdout(result, "Unicode/OSC-safe TUI inspection");
  assert.equal(result.status, 0, result.stdout);
  assert.equal(output.osc_inert, true);
  assert.equal(output.contains_control_sequences, false);
  assert.ok(output.graphemes.some((entry) => entry.text === "👩‍💻" && entry.width === 2));
  assert.equal(output.border_topology_valid, false);
  assert.ok(output.findings.some((finding) => /border/i.test(finding.code || finding.message)));
  assert.doesNotMatch(result.stdout, /\u001b|\u0007/);

  const validBox = [
    "┌────────┐",
    "│한👩‍💻e\u0301   │",
    "├────────┤",
    "│정상    │",
    "└────────┘",
  ].join("\n");
  const validResult = python(
    visualQaRuntime,
    ["check-tui", "--cols", "10", "--ambiguous-width", "2", "--json"],
    { input: validBox },
  );
  const validOutput = parseJsonStdout(validResult, "valid CJK/emoji topology");
  assert.equal(validResult.status, 0, validResult.stdout);
  assert.equal(validOutput.border_topology_valid, true);
  assert.equal(validOutput.verdict, "PASS");
  assert.ok(validOutput.graphemes.some((entry) => entry.text === "e\u0301" && entry.width === 1));

  const verticalGap = [
    "┌────┐",
    "│한글│",
    "     │",
    "└────┘",
  ].join("\n");
  const gapResult = python(
    visualQaRuntime,
    ["check-tui", "--cols", "6", "--ambiguous-width", "2", "--json"],
    { input: verticalGap },
  );
  const gapOutput = parseJsonStdout(gapResult, "vertical continuity defect");
  assert.equal(gapOutput.border_topology_valid, false);
  assert.ok(gapOutput.findings.some((finding) => finding.code === "TUI_BORDER_TOPOLOGY_INVALID"));

  const unterminatedOsc = "\u001b]8;;https://example.invalid/never-terminated";
  const controlResult = python(
    visualQaRuntime,
    ["check-tui", "--cols", "80", "--ambiguous-width", "1", "--json"],
    { input: unterminatedOsc },
  );
  const controlOutput = parseJsonStdout(controlResult, "unterminated OSC");
  assert.notEqual(controlOutput.verdict, "PASS");
  assert.equal(controlOutput.contains_control_sequences, false);
  assert.doesNotMatch(controlResult.stdout, /\u001b/);
});

test("visualqa.tui-input-and-output-are-bounded", () => {
  const oversized = python(
    visualQaRuntime,
    ["check-tui", "--cols", "80", "--ambiguous-width", "1", "--json"],
    { input: "x".repeat(1024 * 1024 + 1) },
  );
  assert.notEqual(oversized.status, 0, "TUI input above one MiB must fail closed");
  assert.match(oversized.stdout + oversized.stderr, /INPUT_TOO_LARGE/);
  assert.ok(oversized.stdout.length < 4096, "oversized input must not create oversized output");

  const bounded = python(
    visualQaRuntime,
    ["check-tui", "--cols", "80", "--ambiguous-width", "1", "--json"],
    { input: "x".repeat(20000) },
  );
  const output = parseJsonStdout(bounded, "bounded TUI inventory");
  assert.equal(bounded.status, 0, bounded.stdout);
  assert.equal(output.grapheme_count, 20000);
  assert.equal(output.graphemes.length, 4096);
  assert.equal(output.graphemes_truncated, true);
  assert.ok(bounded.stdout.length < 300000, "TUI JSON inventory must remain bounded");
});
