#!/usr/bin/env node
// Cover recipe QA for lit-typographic-motion (not part of `npm test`: it needs headless Chrome,
// img2webp, dwebp and a pre-warmed motion cache, and takes minutes). Every shipped recipe is
// rendered as a full cover round through the real CLI and its decoded gate row is compared with
// recipes/<name>/expected.json: median d and the moving share within +-15 %, seamLocal inside
// TARGET, at most 2 MiB, and the strict verdict PASS+TARGET. Every shipped negative and every
// regression a recipe declares (`regressions` in its expected.json) declares `mustFail` ("G2.floor",
// "G1.target"): it counts as caught only when the render completed and gated the decoded file, every
// declared gate failed at its tier, and no undeclared FLOOR gate among G1-G4 failed. A crash, a
// missing declaration, a stale page patch or a failure on the wrong gate is a QA failure with its
// reason, never a caught defect. `--negatives` runs only the negatives and the declared regressions;
// `--feather 150` runs only the declared painted-light `feather-150` regression. `--write-rows`
// records the measured rows instead of comparing them. The motion cache comes from
// LITHERMES_MOTION_TEST_XDG or the usual cache roots. Exit 1 when any row is FAIL.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const packageRoot = path.join(__dirname, "..");
const skillRoot = path.join(packageRoot, "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const motion = path.join(skillRoot, "bin", "motion.mjs");
const painting = path.join(packageRoot, "..", "..", "docs", "assets", "recipes", "painted-light-base.png");
const RECIPES = ["painted-light", "weight-tide", "orbit-loop"];
const NEGATIVES = ["title-slam", "card-scenes", "still-glow", "reset-sweep"];
// engine/constants.mjs EXIT.OK and EXIT.GATE_FAIL_QA; a test pins both.
const EXIT_OK = 0;
const EXIT_GATE_FAIL_QA = 13;
const FLOOR_GATES = ["G1", "G2", "G3", "G4"];
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const within = (value, expected, share = 0.15) => Math.abs(value - expected) <= share * Math.abs(expected);

/**
 * Verdict of one negative or regression: { ok, why }. It is proven only when the render completed and
 * gated the decoded file (exit 0 or 13 with its gate set), every declared gate failed at its tier,
 * and no undeclared FLOOR gate among G1-G4 failed.
 */
function judgeCase(mustFail, { status, gates }) {
  if (!Array.isArray(mustFail) || !mustFail.length) return { ok: false, why: "it declares no gate it must fail (mustFail)" };
  if (!gates || ![EXIT_OK, EXIT_GATE_FAIL_QA].includes(status)) return { ok: false, why: `the render did not complete and gate the decoded file (exit ${status})` };
  for (const id of mustFail) {
    const [gate, tier] = id.split(".");
    if (!gates[gate]) return { ok: false, why: `${gate} was not measured` };
    if ((tier === "target" ? gates[gate].target : gates[gate].pass) !== false) return { ok: false, why: `${id} did not fail` };
  }
  const extra = FLOOR_GATES.filter((g) => gates[g]?.pass === false && !mustFail.includes(`${g}.floor`));
  if (extra.length) return { ok: false, why: `it also fails ${extra.map((g) => `${g}.floor`).join(", ")}, which it does not declare` };
  return { ok: true, why: `fails ${mustFail.join(", ")} as declared` };
}

function coverRun(ctx, slug, recipe, treatment, { assets = null, edit = null } = {}) {
  const out = path.join(ctx.work, slug);
  fs.mkdirSync(path.join(out, "cover"), { recursive: true });
  let page = fs.readFileSync(path.join(skillRoot, "recipes", recipe, "index.html"), "utf8");
  if (edit) page = edit(page);
  fs.writeFileSync(path.join(out, "cover", "index.html"), page);
  fs.writeFileSync(path.join(out, "treatment.json"), `${JSON.stringify(treatment, null, 2)}\n`);
  if (assets) {
    fs.mkdirSync(path.join(out, "cover", "assets"), { recursive: true });
    fs.copyFileSync(painting, path.join(out, "cover", "assets", "base.png"));
    const hash = sha(path.join(out, "cover", "assets", "base.png"));
    fs.writeFileSync(path.join(out, "assets.json"), `${JSON.stringify({ assets: assets.map((a) => ({ ...a, sha256: hash })) }, null, 2)}\n`);
  }
  const run = spawnSync("nice", ["-n", "10", process.execPath, motion, "cover", "--out", out, "--round", "1"], { encoding: "utf8", env: ctx.env, timeout: 1800000 });
  const manifest = fs.existsSync(path.join(out, "manifest.json")) ? readJson(path.join(out, "manifest.json")) : null;
  return { run, manifest, out };
}

const rowOf = (m) => ({ medianD: m.gate.medianD, movingFrac: m.gate.movingFrac, longestStillSec: m.gate.longestStillSec, spike: m.gate.spike, seamLocal: m.gate.seamLocal, bytes: m.bytes });
const fmt = (r) => `median d ${r.medianD.toFixed(5)} | moving ${r.movingFrac.toFixed(3)} | still ${r.longestStillSec.toFixed(3)} s | spike ${r.spike.toFixed(2)} | seam ${r.seamLocal.toFixed(2)} | ${r.bytes} B`;
const lastLine = (run) => (run.stderr || run.stdout || "").trim().split("\n").pop();
const failing = (gates) => Object.entries(gates ?? {}).flatMap(([id, g]) => (g.pass === false ? [`${id}.floor`] : g.target === false ? [`${id}.target`] : []));

async function main() {
  const args = process.argv.slice(2);
  const writeRows = args.includes("--write-rows");
  const negativesOnly = args.includes("--negatives");
  const feather = args.includes("--feather") ? Number(args[args.indexOf("--feather") + 1]) : null;
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
  const ctx = {
    env: { ...process.env, ...(process.env.LITHERMES_MOTION_TEST_XDG ? { XDG_CACHE_HOME: process.env.LITHERMES_MOTION_TEST_XDG } : {}) },
    work: fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-cover-qa-")),
  };
  try {
    return await run(ctx, { writeRows, negativesOnly, feather, only });
  } finally {
    fs.rmSync(ctx.work, { recursive: true, force: true });
  }
}

async function run(ctx, { writeRows, negativesOnly, feather, only }) {
  const { COVER } = await import(pathToFileURL(path.join(skillRoot, "engine", "constants.mjs")).href);
  const { renderQuick } = await import(pathToFileURL(path.join(skillRoot, "engine", "cover.mjs")).href);
  const { coverGate } = await import(pathToFileURL(path.join(skillRoot, "engine", "cover-gate.mjs")).href);
  const rows = [];
  const record = (name, status, detail) => { rows.push({ name, status }); console.log(`${status.padEnd(5)} ${name.padEnd(36)} ${detail}`); };
  const picked = (list) => list.filter((n) => !only || only.includes(n));
  const wanted = (list) => (feather || negativesOnly ? [] : picked(list));
  if (!feather && !negativesOnly && !fs.existsSync(painting)) console.log(`BLOCKED painted-light needs ${painting}`);
  for (const name of wanted(RECIPES)) {
    const file = path.join(skillRoot, "recipes", name, "expected.json");
    const expected = readJson(file);
    const { run: proc, manifest } = coverRun(ctx, name, name, expected.treatment, { assets: expected.assets || null });
    if (!manifest || manifest.path !== "cover") { record(name, "FAIL", `no cover render (exit ${proc.status}): ${(proc.stderr || proc.stdout).trim().split("\n").slice(-2).join(" / ")}`); continue; }
    const row = rowOf(manifest);
    if (writeRows) {
      fs.writeFileSync(file, `${JSON.stringify({ ...expected, row, settings: { size: manifest.size, fps: manifest.fps, frames: manifest.frames, encode: manifest.encode }, verdict: manifest.gate.verdict }, null, 2)}\n`);
      record(name, proc.status === 0 ? "PASS" : "FAIL", `${manifest.gate.verdict} (row written) ${fmt(row)}`);
      continue;
    }
    const misses = [];
    if (manifest.gate.verdict !== "PASS+TARGET" || proc.status !== 0) misses.push(`verdict ${manifest.gate.verdict} (${manifest.gate.missed.join(", ")})`);
    if (!expected.row) misses.push("expected.json has no row");
    else {
      if (!within(row.medianD, expected.row.medianD)) misses.push(`median d ${row.medianD} vs ${expected.row.medianD}`);
      if (!within(row.movingFrac, expected.row.movingFrac)) misses.push(`moving ${row.movingFrac} vs ${expected.row.movingFrac}`);
    }
    if (row.seamLocal < COVER.target.seamLo || row.seamLocal > COVER.target.seamHi) misses.push(`seamLocal ${row.seamLocal} outside TARGET`);
    if (row.bytes > COVER.targetBytes) misses.push(`${row.bytes} bytes over 2 MiB`);
    record(name, misses.length ? "FAIL" : "PASS", misses.length ? `${misses.join("; ")} | ${fmt(row)}` : fmt(row));
  }

  const cases = [];
  if (feather) cases.push({ recipe: "painted-light", id: `feather-${feather}` });
  else for (const recipe of picked(RECIPES)) for (const id of Object.keys(readJson(path.join(skillRoot, "recipes", recipe, "expected.json")).regressions ?? {})) cases.push({ recipe, id });
  for (const { recipe, id } of cases) {
    const label = `regression ${recipe} ${id}`;
    const expected = readJson(path.join(skillRoot, "recipes", recipe, "expected.json"));
    const reg = expected.regressions?.[id];
    if (!reg) { record(label, "FAIL", `not proven: ${recipe}/expected.json declares no regression ${id}`); continue; }
    const html = fs.readFileSync(path.join(skillRoot, "recipes", recipe, "index.html"), "utf8");
    if (!html.includes(reg.patch.find)) { record(label, "FAIL", `not proven: the page no longer contains "${reg.patch.find}"`); continue; }
    const { run: proc, manifest, out } = coverRun(ctx, `${recipe}-${id}`, recipe, expected.treatment, { assets: expected.assets || null, edit: (page) => page.replace(reg.patch.find, reg.patch.replace) });
    let gates = null;
    if (manifest?.file) {
      try { gates = coverGate(path.join(out, manifest.file), { fps: manifest.fps, env: ctx.env }).gates; } catch { gates = null; }
    }
    const v = judgeCase(reg.mustFail, { status: proc.status, gates });
    record(label, v.ok ? "PASS" : "FAIL", `${v.ok ? "" : "not proven: "}${v.why} (declared ${(reg.mustFail ?? []).join(",") || "none"})${gates ? `; failing ${failing(gates).join(",") || "none"}; ${manifest.bytes} B; exit ${proc.status}` : `: ${lastLine(proc)}`}`);
  }

  for (const name of feather ? [] : picked(NEGATIVES)) {
    const file = path.join(skillRoot, "recipes", "negatives", name, "expected.json");
    const expected = readJson(file);
    const dir = path.join(ctx.work, `negative-${name}`);
    fs.mkdirSync(dir, { recursive: true });
    let gate = null;
    let status = 1;
    let crash = "";
    try {
      gate = await renderQuick({ coverDir: path.join(skillRoot, "recipes", "negatives", name), treatment: expected.treatment, workDir: dir, env: ctx.env });
      status = gate.pass ? EXIT_OK : EXIT_GATE_FAIL_QA;
    } catch (error) {
      status = error.exitCode ?? 1;
      crash = String(error.message).split("\n")[0];
    }
    const label = `negative ${name}`;
    if (!gate) { record(label, "FAIL", `not proven: ${judgeCase(expected.mustFail, { status, gates: null }).why}: ${crash}`); continue; }
    if (writeRows) {
      const observed = { medianD: gate.medianD, movingFrac: gate.movingFrac, longestStillSec: gate.longestStillSec, spike: gate.spike, seamLocal: gate.seamLocal, bytes: gate.bytes, failed: Object.entries(gate.gates).filter(([, g]) => g.pass === false).map(([id]) => id).sort() };
      fs.writeFileSync(file, `${JSON.stringify({ ...expected, observed }, null, 2)}\n`);
    }
    const v = judgeCase(expected.mustFail, { status, gates: gate.gates });
    record(label, v.ok ? "PASS" : "FAIL", `${v.ok ? "" : "not proven: "}${v.why} (declared ${(expected.mustFail ?? []).join(",") || "none"}); failing ${failing(gate.gates).join(",") || "none"} | ${fmt(gate)}`);
  }
  const bad = rows.filter((r) => r.status !== "PASS");
  console.log(`${rows.length - bad.length}/${rows.length} rows PASS`);
  return bad.length ? 1 : 0;
}

module.exports = { judgeCase, EXIT_OK, EXIT_GATE_FAIL_QA };

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
