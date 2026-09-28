#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const realSurface = require(path.join(packageRoot, "qa", "lib", "surface.js"));
const repoRoot = path.resolve(packageRoot, "..", "..");
const candidatePluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
const fixturePath = path.join(packageRoot, "qa", "fixtures", "litfamily-harness-speed-v1.json");
const probePath = path.join(packageRoot, "qa", "lib", "harness_speed_probe.py");
const archivePrefix = "packages/lithermes-installer/assets/lithermes-plugin";

function rejectBytecode(source) {
  const parts = source.split(path.sep);
  return !parts.includes("__pycache__") && !/\.py[co]$/.test(source);
}

function extractBaseline(root) {
  const archive = spawnSync("git", ["archive", "--format=tar", "HEAD", archivePrefix], {
    cwd: repoRoot,
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (archive.error || archive.status !== 0) {
    throw new Error(`baseline archive failed: ${archive.stderr?.toString("utf8") || archive.error}`);
  }
  const tarPath = path.join(root, "baseline.tar");
  fs.writeFileSync(tarPath, archive.stdout);
  const extracted = path.join(root, "baseline");
  fs.mkdirSync(extracted);
  const untar = spawnSync("tar", ["-xf", tarPath, "-C", extracted], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (untar.error || untar.status !== 0) {
    throw new Error(`baseline extraction failed: ${untar.stderr || untar.error}`);
  }
  return path.join(extracted, archivePrefix);
}

function copyCandidate(root) {
  const target = path.join(root, "candidate", "lithermes-plugin");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(candidatePluginRoot, target, { recursive: true, filter: rejectBytecode });
  return target;
}

function hashTree(root) {
  const hash = crypto.createHash("sha256");
  function visit(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .filter((entry) => entry.name !== "__pycache__" && !/\.py[co]$/.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      hash.update(relative);
      hash.update("\0");
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isSymbolicLink()) {
        hash.update(fs.readlinkSync(absolute));
      } else {
        hash.update(fs.readFileSync(absolute));
      }
      hash.update("\0");
    }
  }
  visit(root);
  return hash.digest("hex");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function headCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  if (result.error || result.status !== 0 || !/^[a-f0-9]{40}$/.test(result.stdout.trim())) {
    throw new Error(`unable to identify clean HEAD: ${result.stderr || result.error}`);
  }
  return result.stdout.trim();
}

function runProbe(pluginRoot, samples, isolatedRoot) {
  const home = path.join(isolatedRoot, "home");
  const hermesHome = path.join(isolatedRoot, "hermes-home");
  fs.mkdirSync(home);
  fs.mkdirSync(hermesHome);
  const controlled = {
    HOME: home,
    HERMES_HOME: hermesHome,
    CI: "1",
    NO_UPDATE_NOTIFIER: "1",
    LITHERMES_NO_UPDATE_CHECK: "1",
    LITHERMES_NO_AUTO_UPDATE: "1",
  };
  const saved = Object.fromEntries(
    Object.keys(controlled).map((name) => [
      name, { present: Object.hasOwn(process.env, name), value: process.env[name] },
    ]),
  );
  Object.assign(process.env, controlled);
  let probe;
  try {
    probe = realSurface.runPython(
      probePath, [pluginRoot, fixturePath, String(samples)], { cwd: isolatedRoot },
    );
  } finally {
    for (const [name, previous] of Object.entries(saved)) {
      if (previous.present) process.env[name] = previous.value;
      else delete process.env[name];
    }
  }
  if (probe.error || probe.status !== 0) {
    throw new Error(`local speed probe failed: ${probe.stderr || probe.error}`);
  }
  try {
    return JSON.parse(probe.stdout);
  } catch (error) {
    throw new Error(`local speed probe returned malformed JSON: ${error.message}`);
  }
}

export function runLocalArm({ arm, samples = 30 }) {
  if (arm !== "baseline" && arm !== "candidate") {
    throw new TypeError("arm must be baseline or candidate");
  }
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 200) {
    throw new TypeError("samples must be an integer from 1 through 200");
  }

  const workspace = realSurface.scratch();
  const scratch = workspace.make(`local-${arm}`);
  let report;
  try {
    const copyRoot = arm === "baseline" ? extractBaseline(scratch) : copyCandidate(scratch);
    const artifactSha256 = hashTree(copyRoot);
    const isolatedRoot = path.join(scratch, "isolated-runtime");
    fs.mkdirSync(isolatedRoot);
    const probe = runProbe(copyRoot, samples, isolatedRoot);
    const identity = {
      head_commit: headCommit(),
      artifact_sha256: artifactSha256,
      scenario_sha256: sha256File(fixturePath),
    };
    report = {
      schema: "litfamily.harness-speed-local/v1",
      scenario_id: probe.scenario_id,
      product: "lithermes",
      arm,
      measurement_status: probe.measurement_status,
      valid: probe.valid,
      verdict: probe.verdict,
      source: arm === "baseline" ? "clean_HEAD" : "current_dirty_candidate",
      artifact_sha256: artifactSha256,
      identity,
      clock: probe.clock,
      surface: { ...probe.surface, runner_seam: "qa/lib/surface.js::runPython" },
      phases: probe.phases,
      correctness: probe.correctness,
      adversarial: probe.adversarial,
      provider_calls: probe.provider_calls,
      provider_completions: probe.provider_completions,
      numeric_usage: {
        input_tokens: "UNAVAILABLE",
        cache_read_tokens: "UNAVAILABLE",
        cache_write_tokens: "UNAVAILABLE",
        output_tokens: "UNAVAILABLE",
      },
      cleanup: {
        temp_copies_remaining: 0,
        ...probe.cleanup,
      },
    };
  } finally {
    const cleanup = workspace.removeAll();
    if (!cleanup.every((entry) => entry.removed)) {
      throw new Error("temporary local-speed copy cleanup failed");
    }
  }
  return report;
}

function parseArgs(argv) {
  let arm = "candidate";
  let samples = 30;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--arm") arm = argv[++index];
    else if (argv[index] === "--samples") samples = Number(argv[++index]);
    else throw new TypeError(`unknown argument ${argv[index]}`);
  }
  return { arm, samples };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const report = runLocalArm(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
