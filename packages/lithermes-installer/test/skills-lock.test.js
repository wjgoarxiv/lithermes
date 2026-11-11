const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const guard = require("./scripts/scan-forbidden-paths.js");
const lockTool = require("../scripts/sync-skills-lock");

const packageRoot = path.resolve(__dirname, "..");
const script = path.join(packageRoot, "scripts", "sync-skills-lock.js");
const { budgetViolations, buildLock, measureSkills, readLock, renderLock } = lockTool;

function tempTree(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-skills-lock-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeSkill(skillsDir, id, skillMdBytes, extra = {}) {
  const root = path.join(skillsDir, id);
  fs.mkdirSync(path.join(root, "references"), { recursive: true });
  fs.writeFileSync(path.join(root, "SKILL.md"), `---\nname: ${id}\n---\n`.padEnd(skillMdBytes, "x"));
  for (const [rel, text] of Object.entries(extra)) fs.writeFileSync(path.join(root, rel), text);
}

function runSync(args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: packageRoot, encoding: "utf8" });
}

test("skills.lock.json is current (run npm run sync:lock after a skill or pack change)", () => {
  const onDisk = fs.readFileSync(lockTool.LOCK_PATH, "utf8");
  const previous = readLock();
  const fresh = buildLock({ pack: guard.packEntries(), previous });
  const stale = Object.keys({ ...fresh.skills, ...previous.skills })
    .filter((id) => JSON.stringify(fresh.skills[id]) !== JSON.stringify(previous.skills[id]))
    .sort();
  const packDrift = fresh.pack.length !== previous.pack.length
    || fresh.pack.some((entry, i) => entry !== previous.pack[i]);
  assert.equal(renderLock(fresh), onDisk, `skills.lock.json is stale: run npm run sync:lock (skills: ${stale.join(", ") || "none"}; pack: ${packDrift ? "changed" : "same"})`);
});

test("every bundled skill has one budget and sits inside it", () => {
  const lock = readLock();
  const measured = measureSkills(lockTool.SKILLS_DIR);
  assert.deepEqual(Object.keys(lock.budgets).sort(), Object.keys(measured).sort());
  assert.deepEqual(budgetViolations(measured, lock.budgets, lock.policy), []);
});

test("the lock policy carries the floors the skill-port tests used to pin, never lower", () => {
  const { policy, budgets } = readLock();
  const carried = {
    debugging: 10000, "lit-code": 30000, refactor: 24000, "lit-burnoff": 18000,
    "review-work": 7000, litgoal: 10000, "lit-brainstorm": 12000, litwork: 10000,
  };
  for (const [id, floor] of Object.entries(carried)) {
    assert.ok(policy.skillMdFloorBytes[id] >= floor, `${id} policy floor dropped below ${floor}`);
    assert.ok(budgets[id].minSkillBytes >= policy.skillMdFloorBytes[id], `${id} budget floor sits under its policy floor`);
  }
  // The 2026-11-11 move of the five content families left both totals above their floors
  // (601718 B of SKILL.md and 85929 words with the nine stubs), so neither floor was lowered.
  assert.ok(policy.totalSkillMdFloorBytes >= 150000);
  assert.ok(policy.corpusWordFloor >= 42789);
  // lazyEntrypoints governed frontend-ui-ux and visual-qa: a 3584 B entrypoint over a
  // references/complete-contract.md of at least 15000 B. Both bodies moved to wjgoarxiv-skills
  // with that reference, so the policy went with them; their stubs carry ordinary budgets.
  assert.equal(policy.lazyEntrypoints, undefined);
  for (const id of ["frontend-ui-ux", "visual-qa"]) {
    assert.ok(budgets[id].maxSkillBytes <= 9000, `${id} stub budget ceiling grew past the stub size`);
  }
});

test("budgets catch a placeholder, a trimmed tree, bloat and a policy breach", () => {
  const skill = (md, files, bytes) => ({ skillMd: { bytes: md, sha256: "x" }, files, bytes, sha256: "y" });
  const budgets = { a: { minSkillBytes: 9000, maxSkillBytes: 15000, minFiles: 4, maxFiles: 6, maxBytes: 40000 } };
  const policy = { skillMdFloorBytes: { a: 10000 }, lazyEntrypoints: { skills: ["a"], maxSkillBytes: 14000 } };
  assert.deepEqual(budgetViolations({ a: skill(12000, 5, 30000) }, budgets, policy), []);
  assert.deepEqual(budgetViolations({ a: skill(61, 5, 30000) }, budgets, policy), [
    "a: SKILL.md 61 B < budget 9000 B",
    "a: SKILL.md 61 B < policy floor 10000 B",
  ]);
  assert.deepEqual(budgetViolations({ a: skill(12000, 2, 30000) }, budgets, policy), ["a: 2 files < budget 4"]);
  assert.deepEqual(budgetViolations({ a: skill(14500, 9, 50000) }, budgets, policy), [
    "a: SKILL.md 14500 B > policy ceiling 14000 B",
    "a: 9 files > budget 6",
    "a: 50000 B in all > budget 40000 B",
  ]);
  assert.match(budgetViolations({}, budgets)[0], /budget for a missing skill .*--drop a/);
  assert.match(budgetViolations({ b: skill(1, 1, 1) }, {})[0], /new skill without a budget .*--accept-new b/);
});

test("a sync keeps budgets, seeds and drops only by name, and hashes every file", (t) => {
  const dir = tempTree(t);
  const skillsDir = path.join(dir, "skills");
  writeSkill(skillsDir, "alpha", 4321, { "references/a.md": "alpha ref" });
  writeSkill(skillsDir, "beta", 2000);
  const policy = { skillMdFloorBytes: { alpha: 5000 } };

  assert.throws(() => buildLock({ skillsDir, pack: [], previous: { policy }, acceptNew: ["gamma"] }), /--accept-new gamma: not a new skill/);
  const first = buildLock({ skillsDir, pack: ["b", "a"], previous: { policy }, acceptNew: ["alpha", "beta"] });
  assert.deepEqual(first.pack, ["a", "b"]);
  assert.deepEqual(first.policy, policy);
  assert.equal(first.budgets.alpha.minSkillBytes, 5000, "a policy floor outranks the measured size");
  assert.equal(first.budgets.beta.minSkillBytes, 2000);
  assert.equal(first.budgets.beta.maxSkillBytes, 3000);
  assert.deepEqual(budgetViolations(first.skills, first.budgets, first.policy), [
    "alpha: SKILL.md 4321 B < budget 5000 B",
    "alpha: SKILL.md 4321 B < policy floor 5000 B",
  ]);

  const hand = { ...first.budgets, alpha: { ...first.budgets.alpha, maxSkillBytes: 99999 } };
  const again = buildLock({ skillsDir, pack: first.pack, previous: { ...first, budgets: hand } });
  assert.equal(again.budgets.alpha.maxSkillBytes, 99999, "a hand-raised budget survives a sync");
  assert.equal(renderLock(buildLock({ skillsDir, pack: first.pack, previous: again })), renderLock(again), "sync is deterministic");
  assert.throws(() => buildLock({ skillsDir, pack: [], previous: again, acceptNew: ["beta"] }), /not a new skill/);
  assert.throws(() => buildLock({ skillsDir, pack: [], previous: again, drop: ["beta"] }), /not a missing skill/);

  fs.appendFileSync(path.join(skillsDir, "alpha", "references", "a.md"), " edited");
  const edited = buildLock({ skillsDir, pack: first.pack, previous: again });
  assert.notEqual(edited.skills.alpha.sha256, again.skills.alpha.sha256, "a resource edit moves the skill hash");
  assert.deepEqual(edited.skills.alpha.skillMd, again.skills.alpha.skillMd);

  fs.rmSync(path.join(skillsDir, "beta"), { recursive: true });
  const kept = buildLock({ skillsDir, pack: first.pack, previous: edited });
  assert.ok(kept.budgets.beta, "a gone skill keeps its budget until --drop names it");
  const dropped = buildLock({ skillsDir, pack: first.pack, previous: edited, drop: ["beta"] });
  assert.equal(dropped.budgets.beta, undefined);
});

test("remove, sync, re-add smaller is refused rather than reseeded", (t) => {
  const dir = tempTree(t);
  const skillsDir = path.join(dir, "skills");
  writeSkill(skillsDir, "core", 20000);
  const lock = buildLock({ skillsDir, pack: [], acceptNew: ["core"] });
  fs.rmSync(path.join(skillsDir, "core"), { recursive: true });
  const afterRemove = buildLock({ skillsDir, pack: [], previous: lock });
  assert.deepEqual(budgetViolations(afterRemove.skills, afterRemove.budgets), [
    "core: budget for a missing skill (npm run sync:lock -- --drop core)",
  ]);
  writeSkill(skillsDir, "core", 300);
  const readded = buildLock({ skillsDir, pack: [], previous: afterRemove });
  assert.equal(readded.budgets.core.minSkillBytes, 20000, "the old floor still stands");
  assert.deepEqual(budgetViolations(readded.skills, readded.budgets), ["core: SKILL.md 300 B < budget 20000 B"]);
});

test("inside Git only tracked files are measured, so a stray file never moves the lock", (t) => {
  const dir = tempTree(t);
  const skillsDir = path.join(dir, "skills");
  writeSkill(skillsDir, "core", 1200, { "references/r.md": "kept" });
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  assert.equal(git("init", "-q").status, 0);
  assert.equal(git("add", "skills").status, 0);
  const before = measureSkills(skillsDir);
  fs.writeFileSync(path.join(skillsDir, "core", ".DS_Store"), "junk");
  fs.writeFileSync(path.join(skillsDir, "core", "references", "stray-note.md"), "not tracked");
  fs.mkdirSync(path.join(skillsDir, "core", "__pycache__"));
  fs.writeFileSync(path.join(skillsDir, "core", "__pycache__", "x.cpython-311.pyc"), "bytecode");
  assert.deepEqual(measureSkills(skillsDir), before);
  assert.deepEqual(
    lockTool.untrackedPackEntries(["skills/core/SKILL.md", "skills/core/references/stray-note.md"], dir),
    ["skills/core/references/stray-note.md"],
    "a packed file Git does not track is reported, so the lock never starts shipping it silently",
  );
  fs.rmSync(path.join(skillsDir, "core", "references", "r.md"));
  assert.equal(measureSkills(skillsDir).core.files, 1, "a tracked file deleted on disk counts as gone");
});

test("the CLI refuses to write on a violation, --check never writes, and the scripts are wired", (t) => {
  const dir = tempTree(t);
  const skillsDir = path.join(dir, "skills");
  const lockPath = path.join(dir, "skills.lock.json");
  writeSkill(skillsDir, "core", 5000);
  const seeded = runSync(["--lock", lockPath, "--skills", skillsDir, "--no-pack", "--accept-new", "core"]);
  assert.equal(seeded.status, 0, seeded.stdout + seeded.stderr);
  assert.match(seeded.stdout, /seeded budget: core \(SKILL\.md 5000-8000 B/);
  const written = fs.readFileSync(lockPath, "utf8");
  assert.match(runSync(["--lock", lockPath, "--skills", skillsDir, "--no-pack"]).stdout, /already current/);

  writeSkill(skillsDir, "core", 100);
  const refused = runSync(["--lock", lockPath, "--skills", skillsDir, "--no-pack"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /not written: 1 budget violation\(s\)\ncore: SKILL\.md 100 B < budget 5000 B/);
  assert.equal(fs.readFileSync(lockPath, "utf8"), written);

  writeSkill(skillsDir, "core", 5100);
  const check = runSync(["--lock", lockPath, "--skills", skillsDir, "--no-pack", "--check"]);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /stale: run npm run sync:lock/);
  assert.equal(fs.readFileSync(lockPath, "utf8"), written);
  assert.equal(runSync(["--lock", lockPath, "--skills", skillsDir, "--no-pack", "--drop", "core"]).status, 2);

  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(pkg.scripts["sync:lock"], "node scripts/sync-skills-lock.js");
  assert.equal(pkg.scripts["check:lock"], "node scripts/sync-skills-lock.js --check");
  const packed = guard.packEntries();
  assert.equal(packed.includes("skills.lock.json"), false, "the lock is repository data, not package payload");
  assert.equal(packed.includes("scripts/sync-skills-lock.js"), false);
});
