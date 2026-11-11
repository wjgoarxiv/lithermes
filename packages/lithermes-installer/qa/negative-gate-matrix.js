#!/usr/bin/env node
// Replacement real-surface QA: the negative gate matrix.
//
// Every row below runs a real command against the real shipped runtime — the installer
// CLI at bin/lithermes.js and the repository token and path scanners. Nothing is
// reimplemented and nothing is stubbed. The design-contract and visual-evidence rows
// left with frontend-ui-ux and visual-qa, which moved to wjgoarxiv-skills.
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
  compareIsolatedProfiles, digestOfFile, enterIsolatedProfile, installer, instant,
  isolatedProfileFingerprint, packageRoot, pathScanner, scratch, tokenScanner,
} = require("./lib/surface");

const now = new Date();
const nowText = instant(now);
const workspace = scratch();

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
    home, "plugins", "lithermes", "skills", "autoconference", "references", "conference-protocol.md",
  );
  installState.original = fs.readFileSync(installState.pinned);
  return installState;
}

function doctor() {
  return installer(["doctor", "--offline", "--hermes-home", installState.home]);
}

const rows = [
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
        && /conference-protocol\.md hash mismatch/.test(tampered.stdout);
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
      "NEGATIVE CONTROL: row 1 expectation is deliberately inverted; this run must not exit 0\n",
    );
  }
  process.stdout.write(`${"-".repeat(100)}\n`);

  let failed = 0;
  let blocked = 0;
  let passed = 0;
  const notes = [];

  rows.forEach((row, index) => {
    const expected = negativeControl && index === 0 ? (row.expect === "FAIL" ? "PASS" : "FAIL") : row.expect;
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
