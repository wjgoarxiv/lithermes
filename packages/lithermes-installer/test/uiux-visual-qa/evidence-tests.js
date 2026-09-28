const {
  assert, fs, os, parseJsonStdout, path, python, requireFile, rgbaPng, sha256, test,
  visualQaRoot, visualQaRuntime,
} = require("./runtime-helpers");
const { reviewReceipt, tierCompletionRequest, validEvidenceManifest } = require("./fixtures");

test("visualqa.evidence-v1alpha1", () => {
  requireFile(visualQaRuntime, "missing Evidence Manifest validator runtime");
  const valid = python(visualQaRuntime, ["validate-evidence", "--now", "2026-07-24T00:10:00Z", "--json"], {
    input: JSON.stringify(validEvidenceManifest()),
  });
  const output = parseJsonStdout(valid, "Evidence Manifest validation");
  assert.equal(valid.status, 1, "alpha is diagnostic-only and must not exit as completed");
  assert.equal(output.schema_id, "litfamily.evidence-manifest/v1alpha1");
  assert.equal(output.final_verdict, "DIAGNOSTIC_ONLY");
  assert.equal(output.evidence_eligible, false);
  assert.deepEqual(output.diagnostics, ["LEGACY_SCHEMA_V1ALPHA1"]);

  for (const [label, mutate] of [
    ["capture hash mismatch", (manifest) => { manifest.inventory[0].evidence_sha256 = "9".repeat(64); }],
    ["missing mechanical evidence", (manifest) => { manifest.mechanical_results = []; }],
    ["duplicate reviewer hash", (manifest) => { manifest.reviewer_receipt_hashes[1] = manifest.reviewer_receipt_hashes[0]; }],
    ["incomplete cleanup", (manifest) => { manifest.cleanup.process_terminated = false; }],
    ["future capture", (manifest) => { manifest.captures[0].created_at = "2026-07-25T00:00:00Z"; }],
    ["unknown field", (manifest) => { manifest.unapproved = true; }],
  ]) {
    const candidate = validEvidenceManifest();
    mutate(candidate);
    const result = python(
      visualQaRuntime,
      ["validate-evidence", "--now", "2026-07-24T00:10:00Z", "--json"],
      { input: JSON.stringify(candidate) },
    );
    assert.notEqual(result.status, 0, `${label} must not validate as PASS`);
  }

  const stale = validEvidenceManifest({
    captures: validEvidenceManifest().captures.map((capture) => ({
      ...capture,
      created_at: "2026-07-23T00:00:00Z",
    })),
  });
  const rejected = python(visualQaRuntime, ["validate-evidence", "--now", "2026-07-24T00:10:00Z", "--json"], {
    input: JSON.stringify(stale),
  });
  assert.notEqual(rejected.status, 0, "stale capture must never validate as PASS");
  assert.match(rejected.stdout + rejected.stderr, /BLOCKED_EVIDENCE_STALE/);

  for (const tier of ["smoke", "full", "reference-fidelity"]) {
    const completion = python(visualQaRuntime, ["evaluate-tier", "--now", "2026-07-24T00:10:00Z", "--json"], {
      input: JSON.stringify(tierCompletionRequest(tier)),
    });
    const completionOutput = parseJsonStdout(completion, `${tier} finite completion`);
    assert.equal(completion.status, 0, completion.stdout);
    assert.equal(completionOutput.tier, tier);
    if (tier === "smoke") {
      assert.equal(completionOutput.complete, true);
      assert.equal(completionOutput.verdict, "PASS");
    } else {
      assert.equal(completionOutput.complete, false);
      assert.equal(completionOutput.verdict, "BLOCKED");
      assert.ok(completionOutput.reasons.includes("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"));
    }
    assert.deepEqual(completionOutput.finite_limits, {
      maximum_review_rounds: 2,
      maximum_concurrent_reviewers: 2,
      review_timeout_seconds: 600,
      mechanical_timeout_seconds: 30,
    });
  }

  const incompleteSmoke = tierCompletionRequest("smoke");
  incompleteSmoke.accounted_inventory = incompleteSmoke.accounted_inventory.filter(
    (item) => item !== "interaction:critical-submit",
  );
  const incompleteSmokeResult = python(
    visualQaRuntime,
    ["evaluate-tier", "--now", "2026-07-24T00:10:00Z", "--json"],
    { input: JSON.stringify(incompleteSmoke) },
  );
  const incompleteSmokeOutput = parseJsonStdout(incompleteSmokeResult, "incomplete smoke tier");
  assert.equal(incompleteSmokeResult.status, 0, incompleteSmokeResult.stdout);
  assert.equal(incompleteSmokeOutput.complete, false);
  assert.notEqual(incompleteSmokeOutput.verdict, "PASS");
  assert.ok(incompleteSmokeOutput.reasons.includes("SMOKE_CRITICAL_INTERACTION_MISSING"));

  const unresolvedFull = tierCompletionRequest("full");
  unresolvedFull.findings = [
    { finding_id: "low-1", severity: "low", status: "open", evidence_pointer: "capture:primary" },
  ];
  const unresolvedFullResult = python(
    visualQaRuntime,
    ["evaluate-tier", "--now", "2026-07-24T00:10:00Z", "--json"],
    { input: JSON.stringify(unresolvedFull) },
  );
  const unresolvedFullOutput = parseJsonStdout(unresolvedFullResult, "unresolved full tier");
  assert.equal(unresolvedFullResult.status, 0, unresolvedFullResult.stdout);
  assert.equal(unresolvedFullOutput.complete, false);
  assert.notEqual(unresolvedFullOutput.verdict, "PASS");
  assert.ok(unresolvedFullOutput.reasons.includes("FULL_FINDING_UNRESOLVED"));

  const referenceDefect = tierCompletionRequest("reference-fidelity");
  referenceDefect.reference_checks[0].structure_matches = false;
  referenceDefect.reference_checks[0].similarity = 0.9999;
  const referenceDefectResult = python(
    visualQaRuntime,
    ["evaluate-tier", "--now", "2026-07-24T00:10:00Z", "--json"],
    { input: JSON.stringify(referenceDefect) },
  );
  const referenceDefectOutput = parseJsonStdout(referenceDefectResult, "reference-fidelity structural defect");
  assert.equal(referenceDefectResult.status, 0, referenceDefectResult.stdout);
  assert.equal(referenceDefectOutput.complete, false);
  assert.notEqual(referenceDefectOutput.verdict, "PASS");
  assert.equal(referenceDefectOutput.similarity_advisory, true);
  assert.ok(referenceDefectOutput.reasons.includes("REFERENCE_STRUCTURE_DEFECT"));

  const emptyTier = tierCompletionRequest("full");
  emptyTier.required_inventory = [];
  emptyTier.accounted_inventory = [];
  emptyTier.review_receipts = [];
  emptyTier.inspections = [];
  const emptyTierResult = python(
    visualQaRuntime,
    ["evaluate-tier", "--now", "2026-07-24T00:10:00Z", "--json"],
    { input: JSON.stringify(emptyTier) },
  );
  const emptyTierOutput = parseJsonStdout(emptyTierResult, "empty tier request");
  assert.notEqual(emptyTierOutput.verdict, "PASS", "empty tier contract must never PASS");

  const staleTier = tierCompletionRequest("full");
  staleTier.evidence_created_at = "2026-07-23T00:00:00Z";
  const staleTierResult = python(
    visualQaRuntime,
    ["evaluate-tier", "--now", "2026-07-24T00:10:00Z", "--json"],
    { input: JSON.stringify(staleTier) },
  );
  const staleTierOutput = parseJsonStdout(staleTierResult, "derived stale freshness request");
  assert.notEqual(staleTierOutput.verdict, "PASS", "stale tier evidence must never PASS");
  assert.ok(staleTierOutput.reasons.includes("EVIDENCE_NOT_FRESH"));

  const futureTier = tierCompletionRequest("full");
  futureTier.evidence_created_at = "2026-07-25T00:00:00Z";
  const futureTierResult = python(
    visualQaRuntime,
    ["evaluate-tier", "--now", "2026-07-24T00:10:00Z", "--json"],
    { input: JSON.stringify(futureTier) },
  );
  const futureTierOutput = parseJsonStdout(futureTierResult, "future freshness request");
  assert.notEqual(futureTierOutput.verdict, "PASS", "future tier evidence must never PASS");

  for (const [label, mutate, reason] of [
    ["boolean review round", (request) => { request.iteration.review_round = true; }, "FINITE_LIMIT_INVALID"],
    ["boolean freshness age", (request) => { request.evidence_maximum_age_seconds = true; }, "EVIDENCE_NOT_FRESH"],
    ["malformed finding", (request) => { request.findings = [{ status: "resolved" }]; }, "FINDINGS_INVALID"],
    ["malformed exception", (request) => { request.accepted_exceptions = [{}]; }, "EXCEPTIONS_INVALID"],
    ["numeric inspection context", (request) => { request.inspections[0].fresh_context_id = 7; }, "INSPECTION_INCOMPLETE"],
    ["numeric reviewer timeout", (request) => { request.review_receipts[0].timed_out = 1; }, "BLOCKED_REVIEW_TIMEOUT"],
    ["duplicate inventory", (request) => {
      request.required_inventory.push(request.required_inventory[0]);
      request.accounted_inventory.push(request.accounted_inventory[0]);
    }, "TIER_INVENTORY_INVALID"],
  ]) {
    const request = tierCompletionRequest("full");
    mutate(request);
    const result = python(
      visualQaRuntime,
      ["evaluate-tier", "--now", "2026-07-24T00:10:00Z", "--json"],
      { input: JSON.stringify(request) },
    );
    const output = parseJsonStdout(result, label);
    assert.notEqual(output.verdict, "PASS", `${label} must never false-PASS`);
    assert.ok(output.reasons.includes(reason), `${label} missing ${reason}: ${result.stdout}`);
  }

  for (const [label, mutate] of [
    ["boolean reference dimension", (request) => { request.reference_checks[0].target_dimensions[0] = true; }],
    ["boolean reference similarity", (request) => { request.reference_checks[0].similarity = true; }],
    ["duplicate reference id", (request) => { request.reference_checks.push({ ...request.reference_checks[0] }); }],
  ]) {
    const request = tierCompletionRequest("reference-fidelity");
    mutate(request);
    const result = python(
      visualQaRuntime,
      ["evaluate-tier", "--now", "2026-07-24T00:10:00Z", "--json"],
      { input: JSON.stringify(request) },
    );
    const output = parseJsonStdout(result, label);
    assert.notEqual(output.verdict, "PASS", `${label} must never false-PASS`);
    assert.ok(output.reasons.includes("REFERENCE_COMPARISON_INVALID"));
  }

  for (const [label, mutate] of [
    ["boolean capture width", (manifest) => { manifest.captures[0].viewport.width = true; }],
    ["boolean capture age", (manifest) => { manifest.captures[0].maximum_age_seconds = true; }],
    ["boolean capture dpr", (manifest) => { manifest.captures[0].dpr = true; }],
    ["unknown color scheme", (manifest) => { manifest.captures[0].color_scheme = "sepia"; }],
    ["non-RFC3339 capture time", (manifest) => { manifest.captures[0].created_at = "2026-07-24 00:00:00+00:00"; }],
    ["duplicate capture id", (manifest) => { manifest.captures.push({ ...manifest.captures[0] }); }],
    ["duplicate inventory id", (manifest) => { manifest.inventory.push({ ...manifest.inventory[0] }); }],
    ["duplicate mechanical id", (manifest) => { manifest.mechanical_results.push({ ...manifest.mechanical_results[0] }); }],
    ["duplicate font", (manifest) => { manifest.captures[0].font_set.push(manifest.captures[0].font_set[0]); }],
    ["duplicate exception ref", (manifest) => { manifest.exception_references = ["ex-1", "ex-1"]; }],
  ]) {
    const manifest = validEvidenceManifest();
    mutate(manifest);
    const result = python(
      visualQaRuntime,
      ["validate-evidence", "--now", "2026-07-24T00:10:00Z", "--json"],
      { input: JSON.stringify(manifest) },
    );
    assert.notEqual(result.status, 0, `${label} must fail schema-equivalent runtime validation`);
  }
});

test("visualqa.evidence-v1beta1 binds material PNGs beneath an authorized root", (t) => {
  const schemaPath = path.join(visualQaRoot, "schemas", "evidence-manifest-v1beta1.schema.json");
  requireFile(schemaPath, "missing beta Evidence Manifest schema");
  assert.equal(JSON.parse(fs.readFileSync(schemaPath, "utf8")).$id, "litfamily.evidence-manifest/v1beta1");

  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-beta-evidence.")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "captures"));
  const capturePath = path.join(root, "captures", "application.png");
  const captureBytes = rgbaPng(2, 2);
  fs.writeFileSync(capturePath, captureBytes);

  const manifest = validEvidenceManifest();
  manifest.schema_id = "litfamily.evidence-manifest/v1beta1";
  manifest.tier = "smoke";
  manifest.captures[0].capture_sha256 = sha256(capturePath);
  manifest.captures[0].viewport = { width: 2, height: 2 };
  manifest.inventory[0].evidence_path = "captures/application.png";
  manifest.inventory[0].evidence_sha256 = manifest.captures[0].capture_sha256;
  manifest.reviewer_receipt_hashes = [];
  const declaredCaptureTime = new Date(manifest.captures[0].created_at);
  fs.utimesSync(capturePath, declaredCaptureTime, declaredCaptureTime);

  const run = (value, rootPath = root) => python(
    visualQaRuntime,
    ["validate-evidence", "--now", "2026-07-24T00:10:00Z", "--evidence-root", rootPath, "--json"],
    { input: JSON.stringify(value) },
  );
  const publicCliBlocked = run(manifest);
  assert.notEqual(publicCliBlocked.status, 0, "public JSON input cannot self-attest capture provenance");
  assert.match(
    publicCliBlocked.stdout + publicCliBlocked.stderr,
    /BLOCKED_CAPTURE_PROVENANCE_UNAVAILABLE/,
  );

  const archivedPath = path.join(root, "captures", "archived-application.png");
  fs.copyFileSync(capturePath, archivedPath);
  fs.utimesSync(archivedPath, new Date("2025-01-01T00:00:00Z"), new Date("2025-01-01T00:00:00Z"));
  fs.copyFileSync(archivedPath, capturePath);
  fs.utimesSync(capturePath, declaredCaptureTime, declaredCaptureTime);
  const copiedAndTouched = run(manifest);
  assert.notEqual(copiedAndTouched.status, 0, "copying old bytes and touching mtime cannot establish capture age");
  assert.match(
    copiedAndTouched.stdout + copiedAndTouched.stderr,
    /BLOCKED_CAPTURE_PROVENANCE_UNAVAILABLE/,
  );

  const staleMetadataTime = new Date("2026-07-23T00:00:00Z");
  fs.utimesSync(capturePath, staleMetadataTime, staleMetadataTime);
  const selfAttestedFresh = run(manifest);
  assert.notEqual(selfAttestedFresh.status, 0, "manifest freshness cannot substitute for host provenance");
  assert.match(
    selfAttestedFresh.stdout + selfAttestedFresh.stderr,
    /BLOCKED_CAPTURE_PROVENANCE_UNAVAILABLE/,
  );
  fs.utimesSync(capturePath, declaredCaptureTime, declaredCaptureTime);

  for (const [label, mutate] of [
    ["missing capture", (value) => { value.inventory[0].evidence_path = "captures/missing.png"; }],
    ["root escape", (value) => { value.inventory[0].evidence_path = "../outside.png"; }],
    ["stale capture", (value) => { value.captures[0].created_at = "2026-07-23T00:00:00Z"; }],
  ]) {
    const candidate = structuredClone(manifest);
    mutate(candidate);
    const rejected = run(candidate);
    assert.notEqual(rejected.status, 0, `${label} must not PASS`);
  }

  const textPath = path.join(root, "captures", "application.txt");
  fs.writeFileSync(textPath, "not a png");
  const nonImage = structuredClone(manifest);
  nonImage.inventory[0].evidence_path = "captures/application.txt";
  nonImage.inventory[0].evidence_sha256 = sha256(textPath);
  nonImage.captures[0].capture_sha256 = nonImage.inventory[0].evidence_sha256;
  assert.notEqual(run(nonImage).status, 0, "a hash-matched non-PNG must not PASS");

  const selfAttested = structuredClone(manifest);
  selfAttested.tier = "full";
  selfAttested.reviewer_receipt_hashes = ["4".repeat(64), "5".repeat(64)];
  const blocked = run(selfAttested);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stdout + blocked.stderr, /BLOCKED_CAPTURE_PROVENANCE_UNAVAILABLE/);

  const referenceSelfAttested = structuredClone(selfAttested);
  referenceSelfAttested.tier = "reference-fidelity";
  const referenceBlocked = run(referenceSelfAttested);
  assert.notEqual(referenceBlocked.status, 0);
  assert.match(referenceBlocked.stdout + referenceBlocked.stderr, /BLOCKED_CAPTURE_PROVENANCE_UNAVAILABLE/);

  const realParent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "lithermes-evidence-parent."));
  t.after(() => fs.rmSync(realParent, { recursive: true, force: true }));
  const realNestedRoot = path.join(realParent, "root");
  fs.mkdirSync(path.join(realNestedRoot, "captures"), { recursive: true });
  fs.writeFileSync(path.join(realNestedRoot, "captures", "application.png"), captureBytes);
  const symlinkParent = `${realParent}-link`;
  fs.symlinkSync(realParent, symlinkParent);
  t.after(() => fs.rmSync(symlinkParent, { force: true }));
  const ancestorLinked = run(manifest, path.join(symlinkParent, "root"));
  assert.notEqual(ancestorLinked.status, 0, "a symlink ancestor of the evidence root must be rejected");
  assert.match(ancestorLinked.stdout + ancestorLinked.stderr, /EVIDENCE_ARTIFACT_ROOT_INVALID/);

  const intermediateTarget = path.join(root, "real-captures");
  fs.mkdirSync(intermediateTarget);
  fs.writeFileSync(path.join(intermediateTarget, "application.png"), captureBytes);
  const intermediateRoot = path.join(root, "intermediate-root");
  fs.mkdirSync(intermediateRoot);
  fs.symlinkSync(intermediateTarget, path.join(intermediateRoot, "captures"));
  assert.notEqual(run(manifest, intermediateRoot).status, 0, "a symlink intermediate must be rejected");

  const finalRoot = path.join(root, "final-root");
  fs.mkdirSync(path.join(finalRoot, "captures"), { recursive: true });
  fs.symlinkSync(capturePath, path.join(finalRoot, "captures", "application.png"));
  assert.notEqual(run(manifest, finalRoot).status, 0, "a symlink final artifact must be rejected");

  const oversizedRoot = path.join(root, "oversized-root");
  fs.mkdirSync(path.join(oversizedRoot, "captures"), { recursive: true });
  const oversizedPath = path.join(oversizedRoot, "captures", "application.png");
  const descriptor = fs.openSync(oversizedPath, "w");
  fs.ftruncateSync(descriptor, 25 * 1024 * 1024 + 1);
  fs.closeSync(descriptor);
  const oversized = run(manifest, oversizedRoot);
  assert.notEqual(oversized.status, 0, "an oversized artifact must fail before allocation");
  assert.match(oversized.stdout + oversized.stderr, /EVIDENCE_ARTIFACT_RESOURCE_BOUND/);
});

test("visualqa.blocked-capabilities", () => {
  requireFile(visualQaRuntime, "missing blocked-capability evaluator");
  const request = {
    tier: "full",
    capabilities: {
      capture: false,
      auth: false,
      safe_test_account: false,
      independent_review: false,
      renderer_ownership: false,
    },
  };
  const result = python(visualQaRuntime, ["evaluate-capabilities", "--json"], {
    input: JSON.stringify(request),
  });
  const output = parseJsonStdout(result, "blocked-capability evaluation");
  assert.equal(result.status, 0, result.stdout);
  assert.equal(output.verdict, "BLOCKED");
  assert.deepEqual(
    output.blocked_codes,
    [
      "BLOCKED_RENDERER_UNAVAILABLE",
      "BLOCKED_AUTH_UNAVAILABLE",
      "BLOCKED_TEST_ACCOUNT_UNSAFE",
      "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
      "BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED",
    ],
  );
  assert.notEqual(output.verdict, "PASS");
});

test("visualqa public full and reference routes require host-owned review provenance", () => {
  for (const tier of ["full", "reference-fidelity"]) {
    const capabilities = python(visualQaRuntime, ["evaluate-capabilities", "--json"], {
      input: JSON.stringify({
        tier,
        capabilities: {
          capture: true,
          auth: true,
          safe_test_account: true,
          independent_review: true,
          renderer_ownership: true,
        },
      }),
    });
    const capabilityOutput = parseJsonStdout(capabilities, `${tier} capability provenance`);
    assert.equal(capabilityOutput.verdict, "BLOCKED");
    assert.deepEqual(capabilityOutput.blocked_codes, ["BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"]);

    const completion = python(visualQaRuntime, ["evaluate-tier", "--now", "2026-07-24T00:10:00Z", "--json"], {
      input: JSON.stringify(tierCompletionRequest(tier)),
    });
    const completionOutput = parseJsonStdout(completion, `${tier} tier provenance`);
    assert.equal(completionOutput.verdict, "BLOCKED");
    assert.equal(completionOutput.complete, false);
    assert.ok(completionOutput.reasons.includes("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"));
  }
});

test("visualqa.review-independence", () => {
  requireFile(visualQaRuntime, "missing Review Receipt independence validator");
  const duplicateContext = {
    receipts: [reviewReceipt("review-a", "shared-context"), reviewReceipt("review-b", "shared-context")],
  };
  const blocked = python(visualQaRuntime, ["validate-reviews", "--json"], {
    input: JSON.stringify(duplicateContext),
  });
  const blockedOutput = parseJsonStdout(blocked, "duplicate-context review validation");
  assert.equal(blocked.status, 0, blocked.stdout);
  assert.equal(blockedOutput.verdict, "BLOCKED");
  assert.deepEqual(blockedOutput.blocked_codes, ["BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"]);

  const independent = {
    receipts: [reviewReceipt("review-a", "fresh-a"), reviewReceipt("review-b", "fresh-b")],
  };
  const accepted = python(visualQaRuntime, ["validate-reviews", "--json"], {
    input: JSON.stringify(independent),
  });
  const acceptedOutput = parseJsonStdout(accepted, "self-attested review validation");
  assert.equal(accepted.status, 0, accepted.stdout);
  assert.equal(acceptedOutput.verdict, "BLOCKED");
  assert.equal(acceptedOutput.independent, false);
  assert.deepEqual(acceptedOutput.blocked_codes, ["BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"]);
  assert.equal(acceptedOutput.max_review_rounds, 2);

  for (const [label, mutate, expectedCode] of [
    [
      "immutable input mismatch",
      (receipts) => { receipts[1].input_hashes = ["8".repeat(64), "3".repeat(64)]; },
      "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
    ],
    [
      "cancelled reviewer",
      (receipts) => { receipts[1].cancelled = true; },
      "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
    ],
    [
      "timed out reviewer",
      (receipts) => { receipts[1].timed_out = true; },
      "BLOCKED_REVIEW_TIMEOUT",
    ],
    [
      "unusable receipt verdict",
      (receipts) => { receipts[1].verdict = "MAYBE"; },
      "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
    ],
  ]) {
    const receipts = [reviewReceipt("review-a", "fresh-a"), reviewReceipt("review-b", "fresh-b")];
    mutate(receipts);
    const result = python(visualQaRuntime, ["validate-reviews", "--json"], {
      input: JSON.stringify({ receipts }),
    });
    const candidate = parseJsonStdout(result, label);
    assert.notEqual(candidate.verdict, "PASS", `${label} must never validate as independent PASS`);
    assert.ok(candidate.blocked_codes.includes(expectedCode));
  }

  // A reviewer that ran and rejected the work is a review FAIL, never a blocked capability.
  for (const [label, receiptVerdict, failureCode] of [
    ["rejecting reviewer", "FAIL", "REVIEW_VERDICT_FAIL"],
    ["revising reviewer", "REVISE", "REVIEW_VERDICT_REVISE"],
  ]) {
    const receipts = [reviewReceipt("review-a", "fresh-a"), reviewReceipt("review-b", "fresh-b")];
    receipts[1].verdict = receiptVerdict;
    const result = python(visualQaRuntime, ["validate-reviews", "--json"], {
      input: JSON.stringify({ receipts }),
    });
    const candidate = parseJsonStdout(result, label);
    assert.equal(candidate.verdict, "BLOCKED", `${label} remains blocked without host provenance`);
    assert.deepEqual(candidate.blocked_codes, ["BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"]);
    assert.deepEqual(candidate.failure_codes, [failureCode]);
    assert.equal(candidate.independent, false, `${label} has no host-owned provenance`);

    // BLOCKED outranks FAIL when a capability is also missing.
    receipts[0].cancelled = true;
    const outranked = python(visualQaRuntime, ["validate-reviews", "--json"], {
      input: JSON.stringify({ receipts }),
    });
    const outrankedOutput = parseJsonStdout(outranked, `${label} plus cancelled reviewer`);
    assert.equal(outrankedOutput.verdict, "BLOCKED");
    assert.ok(outrankedOutput.blocked_codes.includes("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"));
    assert.deepEqual(outrankedOutput.failure_codes, [failureCode]);
    assert.equal(outrankedOutput.independent, false);
  }

  // A malformed peer receipt blocks independence but must not erase a real rejection.
  for (const malformedIndex of [0, 1]) {
    const receipts = [reviewReceipt("review-a", "fresh-a"), reviewReceipt("review-b", "fresh-b")];
    receipts[1 - malformedIndex].verdict = "FAIL";
    receipts[malformedIndex].unexpected = true;
    const result = python(visualQaRuntime, ["validate-reviews", "--json"], {
      input: JSON.stringify({ receipts }),
    });
    const output = parseJsonStdout(result, `malformed review ${malformedIndex} plus rejection`);
    assert.equal(output.verdict, "BLOCKED");
    assert.deepEqual(output.blocked_codes, ["BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"]);
    assert.deepEqual(output.failure_codes, ["REVIEW_VERDICT_FAIL"]);
    assert.equal(output.independent, false);
  }

  // A review FAIL must still block tier completion instead of passing through silently.
  const rejectedTier = tierCompletionRequest("full");
  rejectedTier.review_receipts[1].verdict = "FAIL";
  const rejectedTierResult = python(
    visualQaRuntime,
    ["evaluate-tier", "--now", "2026-07-24T00:10:00Z", "--json"],
    { input: JSON.stringify(rejectedTier) },
  );
  const rejectedTierOutput = parseJsonStdout(rejectedTierResult, "tier with a rejecting reviewer");
  assert.equal(rejectedTierOutput.verdict, "BLOCKED");
  assert.ok(rejectedTierOutput.reasons.includes("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"));
  assert.ok(rejectedTierOutput.reasons.includes("REVIEW_VERDICT_FAIL"));

  const blockedAndRejectedTier = tierCompletionRequest("full");
  blockedAndRejectedTier.review_receipts[0].cancelled = true;
  blockedAndRejectedTier.review_receipts[1].verdict = "FAIL";
  const blockedAndRejectedResult = python(
    visualQaRuntime,
    ["evaluate-tier", "--now", "2026-07-24T00:10:00Z", "--json"],
    { input: JSON.stringify(blockedAndRejectedTier) },
  );
  const blockedAndRejectedOutput = parseJsonStdout(
    blockedAndRejectedResult,
    "tier with blocked and rejecting reviews",
  );
  assert.equal(blockedAndRejectedOutput.verdict, "BLOCKED");
  assert.ok(blockedAndRejectedOutput.reasons.includes("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"));
  assert.ok(blockedAndRejectedOutput.reasons.includes("REVIEW_VERDICT_FAIL"));
});

test("visualqa.blocked-vocabulary-floor", () => {
  // Only an absent capability maps to a BLOCKED code, and the emitted verdict says so.
  for (const [label, mutate, expectedCode] of [
    [
      "future capture",
      (manifest) => { manifest.captures[0].created_at = "2026-07-25T00:00:00Z"; },
      "BLOCKED_EVIDENCE_FUTURE",
    ],
    [
      "stale capture",
      (manifest) => { manifest.captures[0].created_at = "2026-07-23T00:00:00Z"; },
      "BLOCKED_EVIDENCE_STALE",
    ],
    [
      "incomplete cleanup",
      (manifest) => { manifest.cleanup.transient_paths_removed = false; },
      "BLOCKED_CLEANUP_INCOMPLETE",
    ],
  ]) {
    const manifest = validEvidenceManifest();
    mutate(manifest);
    const result = python(
      visualQaRuntime,
      ["validate-evidence", "--now", "2026-07-24T00:10:00Z", "--json"],
      { input: JSON.stringify(manifest) },
    );
    assert.notEqual(result.status, 0, `${label} must never validate as PASS`);
    const output = parseJsonStdout(result, label);
    assert.equal(output.error_code, expectedCode);
    assert.equal(output.verdict, "BLOCKED", `${label} must rank BLOCKED above FAIL`);
  }

  // A genuine schema defect is not a missing capability.
  const malformed = validEvidenceManifest();
  malformed.captures[0].color_scheme = "sepia";
  const malformedResult = python(
    visualQaRuntime,
    ["validate-evidence", "--now", "2026-07-24T00:10:00Z", "--json"],
    { input: JSON.stringify(malformed) },
  );
  const malformedOutput = parseJsonStdout(malformedResult, "malformed capture");
  assert.equal(malformedOutput.error_code, "EVIDENCE_INVALID");
  assert.equal(malformedOutput.verdict, "FAIL");
});

test("visualqa.strict-schema-regressions", () => {
  // The Design Contract root is an exact 12-key document, so each schema pins its own
  // approved root count instead of sharing one floor.
  const schemas = [
    [require("../../assets/lithermes-plugin/skills/frontend-ui-ux/schemas/design-contract-v1alpha1.schema.json"), 12],
    [require("../../assets/lithermes-plugin/skills/visual-qa/schemas/evidence-manifest-v1alpha1.schema.json"), 13],
    [require("../../assets/lithermes-plugin/skills/visual-qa/schemas/review-receipt-v1alpha1.schema.json"), 14],
  ];
  for (const [schema, requiredRootKeys] of schemas) {
    assert.equal(schema.additionalProperties, false, `${schema.$id} must reject unknown fields`);
    assert.equal(schema.required.length, requiredRootKeys, `${schema.$id} changed its approved root keys`);
    assert.equal(new Set(schema.required).size, requiredRootKeys, `${schema.$id} repeats a required key`);
    assert.deepEqual(
      schema.required.filter((key) => !(key in schema.properties)),
      [],
      `${schema.$id} requires a key it never describes`,
    );
    assert.ok(Object.keys(schema.$defs || {}).length >= 2, `${schema.$id} lacks nested exact contracts`);
  }
});
