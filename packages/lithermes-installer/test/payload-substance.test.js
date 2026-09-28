const assert = require("node:assert/strict");
const { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const CHECKER = path.join(PACKAGE_ROOT, "tools", "check-payload-substance.js");
const FAMILY_ROOT = process.env.LITHERMES_FAMILY_ROOT;
const FAMILY_LAYOUT = process.env.LITHERMES_FAMILY_LAYOUT;
const FAMILY_AVAILABLE = Boolean(FAMILY_ROOT && FAMILY_LAYOUT && existsSync(FAMILY_ROOT) && existsSync(FAMILY_LAYOUT));

function runChecker(args = []) {
  return spawnSync(process.execPath, [CHECKER, ...args], { cwd: PACKAGE_ROOT, encoding: "utf8" });
}

test("payload substance gate accepts the current packed skill tree", () => {
  const result = runChecker();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PAYLOAD_SUBSTANCE_PASS/);
});

test("packed SKILL.md references resolve against the npm payload", () => {
  const result = runChecker();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PAYLOAD_REFERENCES_PASS: claims=\d+ exemptions=\d+/);
});

test("cross-product payload parity always checks the committed family manifest", () => {
  const result = runChecker();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PAYLOAD_PARITY_PASS: source=manifest fraction=0\.5/);
  assert.match(result.stdout, /PAYLOAD_PARITY_ROW skill=autoresearch median=30 closures=.*p28:30/);
});

test("optional family freshness probe resolves the Hermes skill closures", { skip: !FAMILY_AVAILABLE }, () => {
  const result = runChecker(["--family-root", FAMILY_ROOT, "--family-layout", FAMILY_LAYOUT]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PAYLOAD_PARITY_FRESHNESS_PASS/);
  assert.match(result.stdout, /PAYLOAD_PARITY_ROW skill=autoresearch median=30 closures=.*p28:30/);
  assert.match(result.stdout, /PAYLOAD_PARITY_ROW skill=lit-handoff median=7 closures=.*p28:8/);
});

test("payload substance gate names an unallowlisted hollow skill", () => {
  const root = mkdtempSync(path.join(tmpdir(), "lithermes-substance-hollow-"));
  try {
    const skills = path.join(root, "skills");
    mkdirSync(path.join(skills, "solid"), { recursive: true });
    mkdirSync(path.join(skills, "hollow"), { recursive: true });
    writeFileSync(path.join(skills, "solid", "SKILL.md"), "solid\n");
    writeFileSync(path.join(skills, "hollow", "SKILL.md"), "hollow\n");
    const allowlist = path.join(root, "allowlist.json");
    writeFileSync(allowlist, JSON.stringify({ schema: "litfamily.payload-substance/v1", skills: { solid: "This bounded instruction is complete for its procedural review." } }));
    const pack = path.join(root, "pack.json");
    writeFileSync(pack, JSON.stringify([{ files: [{ path: "assets/lithermes-plugin/skills/solid/SKILL.md" }, { path: "assets/lithermes-plugin/skills/hollow/SKILL.md" }] }]));
    const result = runChecker(["--skill-root", skills, "--allowlist-file", allowlist, "--pack-json", pack]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /PAYLOAD_SUBSTANCE_FAIL/);
    assert.match(`${result.stdout}\n${result.stderr}`, /hollow/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("payload reference gate names the missing token", () => {
  const root = mkdtempSync(path.join(tmpdir(), "lithermes-reference-missing-"));
  try {
    const skills = path.join(root, "skills");
    mkdirSync(path.join(skills, "hollow"), { recursive: true });
    writeFileSync(path.join(skills, "hollow", "SKILL.md"), "This skill claims `references/not-packed.md`.\n");
    const allowlist = path.join(root, "allowlist.json");
    writeFileSync(allowlist, JSON.stringify({ schema: "litfamily.payload-substance/v1", skills: { hollow: "This bounded fixture contains the complete instruction body for its procedural review." } }));
    const pack = path.join(root, "pack.json");
    writeFileSync(pack, JSON.stringify([{ files: [{ path: "assets/lithermes-plugin/skills/hollow/SKILL.md" }] }]));
    const result = runChecker(["--skill-root", skills, "--allowlist-file", allowlist, "--pack-json", pack]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /PAYLOAD_REFERENCE_FAIL skill=hollow token=references\/not-packed\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
