#!/usr/bin/env node
// Replacement real-surface QA: the negative gate matrix.
//
// Every row below runs a real command against the real shipped runtime — the Python
// validators under assets/lithermes-plugin/skills/{frontend-ui-ux,visual-qa}/scripts,
// the installer CLI at bin/lithermes.js, and the repository token scanner. Nothing is
// reimplemented and nothing is stubbed.
//
// Row status semantics:
//   PASS    the observed outcome equals the declared expectation
//   FAIL    the observed outcome differs from the declared expectation
//   BLOCKED the row cannot be exercised against the shipped runtime; the exact reason
//           is printed and the row is never counted as a pass
// The process exits non-zero when any row is FAIL or BLOCKED. BLOCKED rows are reported,
// counted separately, never hidden, and keep the release gate closed.
//
// --negative-control corrupts one row's expectation on purpose so the probe must fail.
// --self-check re-runs this file with --negative-control and succeeds only if that run
// exited non-zero, which is the proof that the probe can actually fail.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  compareIsolatedProfiles, design, digestOfFile, encodePng, enterIsolatedProfile, gradientPixels, installer, instant,
  isolatedProfileFingerprint, jsonStdout, packageRoot, pathScanner, scratch, shifted, tokenScanner, visual,
} = require("./lib/surface");
const {
  capabilityRequest, designContract, evidenceManifest, reviewReceipt, tierRequest,
} = require("./lib/documents");

const now = new Date();
const nowText = instant(now);
const workspace = scratch();

function text(value) {
  return `${JSON.stringify(value)}\n`;
}

// The runtime's error envelope carries both a specific code and the PASS/FAIL/BLOCKED
// rank derived from it. Rows that name a code read the code; rows that name a rank read
// the rank.
function codeOf(result) {
  const parsed = jsonStdout(result);
  if (parsed && typeof parsed.error_code === "string") return parsed.error_code;
  if (parsed && typeof parsed.verdict === "string") return parsed.verdict;
  return null;
}

function rankOf(result) {
  const parsed = jsonStdout(result);
  return parsed && typeof parsed.verdict === "string" ? parsed.verdict : null;
}

// --- rows ------------------------------------------------------------------

const installState = { home: null, pinned: null, original: null };

function ensureInstall() {
  if (installState.home) return installState;
  const home = workspace.make("install");
  const result = installer(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  if (result.status !== 0) {
    throw new Error(`isolated install failed (${result.status}):\n${result.stdout}${result.stderr}`);
  }
  installState.home = home;
  installState.pinned = path.join(
    home, "plugins", "lithermes", "skills", "visual-qa", "references", "capture-playbook.md",
  );
  installState.original = fs.readFileSync(installState.pinned);
  return installState;
}

function doctor() {
  return installer(["doctor", "--offline", "--hermes-home", installState.home]);
}

const rows = [
  {
    name: "valid design contract",
    expect: "PASS",
    run() {
      const file = path.join(workspace.make("contract"), "contract.json");
      fs.writeFileSync(file, text(designContract()));
      const result = design(["validate-design-contract", "--contract", file]);
      const parsed = jsonStdout(result);
      const ok = result.status === 0 && parsed && parsed.valid === true;
      return {
        observed: ok ? "PASS" : "FAIL",
        detail: `exit=${result.status} valid=${parsed ? parsed.valid : "n/a"} issues=${parsed ? parsed.issues.length : "n/a"}`,
      };
    },
  },
  {
    name: "malformed / duplicate-key contract",
    expect: "FAIL",
    run() {
      const dir = workspace.make("contract-bad");
      const duplicate = path.join(dir, "duplicate.json");
      // json.loads silently keeps the last value for a repeated key, so the duplicate has
      // to reach the runtime as raw text rather than as a re-serialised object.
      const body = JSON.stringify(designContract());
      fs.writeFileSync(duplicate, `${body.slice(0, body.length - 1)},"contract_id":"contract:shadow"}\n`);
      const first = design(["validate-design-contract", "--contract", duplicate]);

      const broken = designContract();
      broken.inventory.regions[0].route_id = "route:does-not-exist";
      broken.accessibility.target = "WCAG 2.1 A";
      const rulePath = path.join(dir, "rule-violation.json");
      fs.writeFileSync(rulePath, text(broken));
      const second = design(["validate-design-contract", "--contract", rulePath]);
      const parsed = jsonStdout(second);

      const rejected = first.status === 2 && /duplicate object key/.test(first.stderr);
      const invalid = second.status === 1 && parsed && parsed.valid === false && parsed.issues.length > 0;
      return {
        observed: rejected && invalid ? "FAIL" : "PASS",
        detail: `duplicate-key exit=${first.status} stderr=${first.stderr.trim()}; rule-violation exit=${second.status} issues=${parsed ? parsed.issues.length : "n/a"}`,
      };
    },
  },
  {
    name: "public evidence lacks host provenance",
    expect: "BLOCKED_CAPTURE_PROVENANCE_UNAVAILABLE",
    run() {
      const root = fs.realpathSync(workspace.make("evidence-valid"));
      const captures = path.join(root, "captures");
      fs.mkdirSync(captures);
      const capturePath = path.join(captures, "apply.png");
      fs.writeFileSync(capturePath, encodePng(320, 640, gradientPixels(320, 640)));
      const manifest = evidenceManifest(now, {
        captureDigest: digestOfFile(capturePath),
        tier: "smoke",
      });
      const capturedAt = new Date(manifest.captures[0].created_at);
      fs.utimesSync(capturePath, capturedAt, capturedAt);
      const result = visual(["validate-evidence", "--now", nowText, "--evidence-root", root], {
        input: text(manifest),
      });
      const parsed = jsonStdout(result) || {};
      return {
        observed: codeOf(result) || "PASS",
        detail: `exit=${result.status} verdict=${parsed.verdict} error_code=${parsed.error_code}`,
      };
    },
  },
  {
    name: "missing capture",
    expect: "FAIL",
    run() {
      // The inventory row claims a capture whose bytes were never captured, so its digest
      // resolves to nothing in the captures array.
      const manifest = evidenceManifest(now, { inventoryDigest: "9".repeat(64) });
      const result = visual(["validate-evidence", "--now", nowText], { input: text(manifest) });
      const parsed = jsonStdout(result) || {};
      return {
        observed: rankOf(result) || "PASS",
        detail: `exit=${result.status} error_code=${parsed.error_code} detail=${parsed.detail}`,
      };
    },
  },
  {
    name: "stale evidence",
    expect: "BLOCKED_EVIDENCE_STALE",
    run() {
      // created_at is now-60s with a 3600s window, so now+7200s is outside it.
      const result = visual(["validate-evidence", "--now", shifted(now, 7200)], {
        input: text(evidenceManifest(now)),
      });
      const parsed = jsonStdout(result) || {};
      return {
        observed: codeOf(result) || "PASS",
        detail: `exit=${result.status} verdict=${parsed.verdict} capture=${parsed.detail}`,
      };
    },
  },
  {
    name: "future-dated evidence",
    expect: "BLOCKED_EVIDENCE_FUTURE",
    run() {
      const result = visual(["validate-evidence", "--now", shifted(now, -3600)], {
        input: text(evidenceManifest(now)),
      });
      const parsed = jsonStdout(result) || {};
      return {
        observed: codeOf(result) || "PASS",
        detail: `exit=${result.status} verdict=${parsed.verdict} capture=${parsed.detail}`,
      };
    },
  },
  {
    name: "auth unavailable",
    expect: "BLOCKED_AUTH_UNAVAILABLE",
    run() {
      const result = visual(["evaluate-capabilities"], {
        input: text(capabilityRequest({ auth: false })),
      });
      const parsed = jsonStdout(result) || {};
      const codes = parsed.blocked_codes || [];
      return {
        observed: codes.length === 1 ? codes[0] : `${parsed.verdict}:${codes.join(",")}`,
        detail: `exit=${result.status} verdict=${parsed.verdict} codes=[${codes.join(", ")}]`,
      };
    },
  },
  {
    name: "renderer ownership unverified",
    expect: "BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED",
    run() {
      const result = visual(["evaluate-capabilities"], {
        input: text(capabilityRequest({ renderer_ownership: false })),
      });
      const parsed = jsonStdout(result) || {};
      const codes = parsed.blocked_codes || [];
      return {
        observed: codes.length === 1 ? codes[0] : `${parsed.verdict}:${codes.join(",")}`,
        detail: `exit=${result.status} verdict=${parsed.verdict} codes=[${codes.join(", ")}]`,
      };
    },
  },
  {
    name: "capture bytes changed after manifest",
    expect: "FAIL",
    run() {
      const dir = workspace.make("capture");
      const file = path.join(dir, "apply.png");
      const reference = path.join(dir, "apply-reference.png");
      const original = encodePng(8, 4, gradientPixels(8, 4));
      fs.writeFileSync(file, original);
      fs.writeFileSync(reference, original);
      const manifestDigest = digestOfFile(file);

      // Re-render the same surface with one changed pixel and leave it at the same path.
      fs.writeFileSync(file, encodePng(8, 4, gradientPixels(8, 4, 17)));
      const onDiskDigest = digestOfFile(file);
      if (onDiskDigest === manifestDigest) throw new Error("capture mutation did not change the bytes");

      // The manifest still pins the digest recorded at capture time; the inventory row now
      // carries what the file actually hashes to.
      const manifest = evidenceManifest(now, {
        captureDigest: manifestDigest,
        inventoryDigest: onDiskDigest,
      });
      const evidence = visual(["validate-evidence", "--now", nowText], { input: text(manifest) });
      const compare = visual(["compare-png", reference, file]);
      const compared = jsonStdout(compare) || {};
      const parsed = jsonStdout(evidence) || {};
      return {
        observed: rankOf(evidence) || "PASS",
        detail: `validate-evidence exit=${evidence.status} error_code=${parsed.error_code}; compare-png verdict=${compared.verdict} similarity=${compared.similarity}`,
      };
    },
  },
  {
    name: "incomplete cleanup",
    expect: "BLOCKED_CLEANUP_INCOMPLETE",
    run() {
      const manifest = evidenceManifest(now);
      manifest.cleanup.state = "partial";
      manifest.cleanup.transient_paths_removed = false;
      const result = visual(["validate-evidence", "--now", nowText], { input: text(manifest) });
      const parsed = jsonStdout(result) || {};
      return {
        observed: codeOf(result) || "PASS",
        detail: `exit=${result.status} verdict=${parsed.verdict} detail=${parsed.detail}`,
      };
    },
  },
  {
    name: "same-context self-review",
    expect: "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
    run() {
      // Two receipts written from one context are not two independent reviews. The tier
      // gate is the surface that turns that into a completion verdict.
      const receipts = [
        reviewReceipt(now, { reviewId: "probe-review-a", contextId: "probe-single-context" }),
        reviewReceipt(now, { reviewId: "probe-review-b", contextId: "probe-single-context" }),
      ];
      const result = visual(["evaluate-tier", "--now", nowText], {
        input: text(tierRequest(now, { receipts })),
      });
      const parsed = jsonStdout(result) || {};
      const reasons = parsed.reasons || [];
      const named = reasons.includes("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE");
      return {
        observed: parsed.verdict === "BLOCKED" && named
          ? "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"
          : `${parsed.verdict}:${reasons.join(",")}`,
        detail: `exit=${result.status} complete=${parsed.complete} reasons=[${reasons.join(", ")}]`,
      };
    },
  },
  {
    name: "reviewer unavailable",
    expect: "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
    run() {
      const result = visual(["validate-reviews"], {
        input: text({
          receipts: [reviewReceipt(now, { reviewId: "probe-only", contextId: "probe-only-context" })],
        }),
      });
      const parsed = jsonStdout(result) || {};
      const codes = parsed.blocked_codes || [];
      return {
        observed: parsed.verdict === "BLOCKED" && codes.length === 1 ? codes[0] : `${parsed.verdict}:${codes.join(",")}`,
        detail: `exit=${result.status} verdict=${parsed.verdict} independent=${parsed.independent} codes=[${codes.join(", ")}]`,
      };
    },
  },
  {
    name: "unsafe test account",
    expect: "BLOCKED_TEST_ACCOUNT_UNSAFE",
    run() {
      const result = visual(["evaluate-capabilities"], {
        input: text(capabilityRequest({ safe_test_account: false })),
      });
      const parsed = jsonStdout(result) || {};
      const codes = parsed.blocked_codes || [];
      return {
        observed: codes.length === 1 ? codes[0] : `${parsed.verdict}:${codes.join(",")}`,
        detail: `exit=${result.status} verdict=${parsed.verdict} codes=[${codes.join(", ")}]`,
      };
    },
  },
  {
    name: "bounded PNG / TUI / CJK cases",
    expect: "PASS",
    run() {
      const dir = workspace.make("bounded");
      const file = path.join(dir, "bounded.png");
      fs.writeFileSync(file, encodePng(8, 4, gradientPixels(8, 4)));
      const png = visual(["inspect-png", file]);
      const pngJson = jsonStdout(png) || {};

      // A Korean label inside a box frame: every wide cluster must consume two grid cells
      // or the border no longer closes and the width no longer fits the declared columns.
      const frame = [
        `┌${"─".repeat(11)}┐`,
        "│ 한국어 UI │",
        `└${"─".repeat(11)}┘`,
        "",
      ].join("\n");
      const tui = visual(["check-tui", "--cols", "13"], { input: frame });
      const tuiJson = jsonStdout(tui) || {};

      const pngOk = png.status === 0 && pngJson.verdict === "PASS"
        && pngJson.width === 8 && pngJson.height === 4 && pngJson.crc_valid === true;
      const widths = tuiJson.line_widths || [];
      const tuiOk = tui.status === 0 && tuiJson.verdict === "PASS"
        && tuiJson.border_topology_valid === true
        && widths.length === 3 && widths.every((width) => width === 13);
      return {
        observed: pngOk && tuiOk ? "PASS" : "FAIL",
        detail: `inspect-png exit=${png.status} verdict=${pngJson.verdict} ${pngJson.width}x${pngJson.height} chunks=${pngJson.chunk_count}; check-tui exit=${tui.status} verdict=${tuiJson.verdict} widths=[${widths.join(", ")}] graphemes=${tuiJson.grapheme_count} findings=${(tuiJson.findings || []).length}`,
      };
    },
  },
  {
    name: "tampered installed resource",
    expect: "FAIL",
    run() {
      ensureInstall();
      const baseline = doctor();
      if (baseline.status !== 0 || !/installed skill payload: PASS/.test(baseline.stdout)) {
        return {
          observed: "PASS",
          detail: `baseline doctor was not clean before tampering: exit=${baseline.status}\n${baseline.stdout}`,
        };
      }
      fs.writeFileSync(
        installState.pinned,
        Buffer.concat([installState.original, Buffer.from("\ntampered by the real-surface probe\n")]),
      );
      const tampered = doctor();
      const line = (tampered.stdout.match(/^installed skill payload: .*$/m) || [""])[0];
      const failed = tampered.status === 1
        && /installed skill payload: FAIL/.test(tampered.stdout)
        && /capture-playbook\.md hash mismatch/.test(tampered.stdout);
      return {
        observed: failed ? "FAIL" : "PASS",
        detail: `baseline exit=0; tampered exit=${tampered.status}; ${line}`,
      };
    },
  },
  {
    name: "restored installed resource",
    expect: "PASS",
    run() {
      ensureInstall();
      fs.writeFileSync(installState.pinned, installState.original);
      const restored = doctor();
      const line = (restored.stdout.match(/^installed skill payload: .*$/m) || [""])[0];
      const ok = restored.status === 0 && /installed skill payload: PASS/.test(restored.stdout);
      return {
        observed: ok ? "PASS" : "FAIL",
        detail: `restored exit=${restored.status}; ${line}; restored sha256=${digestOfFile(installState.pinned).slice(0, 16)}...`,
      };
    },
  },
  {
    name: "forbidden brand tokens in packed files",
    expect: "0",
    // Content scan. Separate from the path-shape row above; neither substitutes
    // for the other, and conflating them is what produced the mislabelled row.
    run() {
      const result = spawnSync(process.execPath, [tokenScanner, "--package-root"], {
        cwd: packageRoot,
        encoding: "utf8",
        timeout: 120000,
      });
      const hits = (result.stderr || "").split("\n").filter((line) => line.trim()).length;
      return {
        observed: result.status === 0 ? String(hits) : String(hits || "unknown"),
        detail: `exit=${result.status} hits=${hits}${hits ? `\n${result.stderr.trim()}` : ""}`,
      };
    },
  },
  {
    name: "forbidden package paths",
    expect: "0",
    // Measures PATH SHAPES in the published tarball. This row used to run the
    // brand-token scanner, which has no notion of path shapes — it asserted a
    // property nothing checked. scan-forbidden-paths.js is the real guard and
    // carries a negative control in test/pack-paths.test.js.
    run() {
      const result = spawnSync(process.execPath, [pathScanner], {
        cwd: packageRoot,
        encoding: "utf8",
        timeout: 180000,
      });
      const lines = (result.stderr || "")
        .split("\n")
        .filter((line) => line.startsWith("forbidden package path:") || line.startsWith("stale ALLOWED entry"));
      return {
        observed: result.status === 0 ? "0" : String(lines.length || "unknown"),
        detail: `exit=${result.status} hits=${lines.length}${lines.length ? `\n${lines.join("\n")}` : ""}`,
      };
    },
  },
];

// --- runner ----------------------------------------------------------------

function pad(value, width) {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function exitCodeForSummary({ failed, blocked, profileUnchanged }) {
  return failed === 0 && blocked === 0 && profileUnchanged ? 0 : 1;
}

function main(argv) {
  if (argv.includes("--self-check")) return selfCheck();

  const isolatedProfileBefore = isolatedProfileFingerprint();

  const negativeControl = argv.includes("--negative-control");
  const nameWidth = Math.max(...rows.map((row) => row.name.length));
  const expectWidth = Math.max(...rows.map((row) => row.expect.length)) + 2;

  process.stdout.write("LitHermes replacement real-surface QA — negative gate matrix\n");
  process.stdout.write(`reference instant: ${nowText}\n`);
  if (negativeControl) {
    process.stdout.write(
      "NEGATIVE CONTROL: row 1 expectation is deliberately corrupted to FAIL; this run must not exit 0\n",
    );
  }
  process.stdout.write(`${"-".repeat(100)}\n`);

  let failed = 0;
  let blocked = 0;
  let passed = 0;
  const notes = [];

  rows.forEach((row, index) => {
    const expected = negativeControl && index === 0 ? "FAIL" : row.expect;
    let observed;
    let detail;
    try {
      const result = row.run();
      observed = result.observed;
      detail = result.detail;
    } catch (error) {
      observed = "PROBE_ERROR";
      detail = error instanceof Error ? error.message : String(error);
    }
    let status;
    if (row.blocked) {
      status = "BLOCKED";
      blocked += 1;
      notes.push(`row ${index + 1} (${row.name}) BLOCKED: ${row.blocked}`);
    } else if (observed === expected) {
      status = "PASS";
      passed += 1;
    } else {
      status = "FAIL";
      failed += 1;
    }
    process.stdout.write(
      `${String(index + 1).padStart(2, "0")}. ${pad(row.name, nameWidth)}  expected=${pad(expected, expectWidth)} observed=${pad(String(observed), expectWidth)} ${status}\n`,
    );
    process.stdout.write(`    ${detail}\n`);
  });

  process.stdout.write(`${"-".repeat(100)}\n`);
  for (const note of notes) process.stdout.write(`${note}\n`);
  process.stdout.write(
    `summary: rows=${rows.length} pass=${passed} blocked=${blocked} mismatch=${failed}\n`,
  );

  const isolatedProfile = compareIsolatedProfiles(isolatedProfileBefore, isolatedProfileFingerprint());
  const receipt = workspace.removeAll();
  process.stdout.write("cleanup receipt:\n");
  for (const entry of receipt) {
    process.stdout.write(`  removed=${entry.removed} ${entry.path}\n`);
  }
  process.stdout.write(`  temporary roots created=${receipt.length} remaining=${receipt.filter((entry) => !entry.removed).length}\n`);
  process.stdout.write(`  isolated profile check: ${isolatedProfile.detail}\n`);
  process.stdout.write("  live/operator Hermes profile: not mutated by design (not measured by isolated fingerprint)\n");

  return exitCodeForSummary({ failed, blocked, profileUnchanged: isolatedProfile.unchanged });
}

function selfCheck() {
  const child = spawnSync(process.execPath, [__filename, "--negative-control"], {
    cwd: packageRoot,
    encoding: "utf8",
    timeout: 600000,
  });
  process.stdout.write(child.stdout || "");
  process.stderr.write(child.stderr || "");
  process.stdout.write(`${"=".repeat(100)}\n`);
  const summary = (child.stdout || "").match(/summary: rows=\d+ pass=\d+ blocked=\d+ mismatch=(\d+)/);
  if (child.status === 0 || !summary || Number(summary[1]) < 1) {
    process.stdout.write("SELF-CHECK FAIL: the corrupted-expectation run exited 0, so the probe cannot detect a wrong outcome\n");
    return 1;
  }
  process.stdout.write(`SELF-CHECK PASS: the corrupted-expectation run exited ${child.status}, proving the probe fails when an outcome differs from its expectation\n`);
  return 0;
}

if (require.main === module) {
  let code = 1;
  const isolatedProfile = enterIsolatedProfile(workspace);
  try {
    code = main(process.argv.slice(2));
  } finally {
    isolatedProfile.restore();
    workspace.removeAll();
  }
  process.exitCode = code;
}

module.exports = { exitCodeForSummary, rows };
