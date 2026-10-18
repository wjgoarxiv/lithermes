const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const packageRoot = path.join(__dirname, "..");
const payloadRoot = path.join(packageRoot, "assets", "lithermes-plugin");

// The per-turn routes send the model to skill_view("lithermes:<skill>") instead of
// inlining the skill body. A pointer is only as good as the file behind it, so
// every skill a route names must ship in the npm tarball.
test("every skill a pre_llm_call route defers to ships in the package", () => {
  const sources = fs
    .readdirSync(payloadRoot)
    .filter((name) => name.endsWith(".py"))
    .map((name) => fs.readFileSync(path.join(payloadRoot, name), "utf8"))
    .join("\n");
  const named = new Set(
    [...sources.matchAll(/skill_view\(\\?"lithermes:([a-z0-9-]+)\\?"\)/g)].map((match) => match[1]),
  );
  for (const literal of [...sources.matchAll(/skill_view_reference\(\s*"([a-z0-9-]+)"/g)]) {
    named.add(literal[1]);
  }
  for (const required of ["litwork", "lit-code", "lit-plan", "litresearch"]) {
    assert.ok(named.has(required), `no route defers to lithermes:${required}`);
  }

  const packed = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const files = new Set(JSON.parse(packed.stdout).flatMap((entry) => entry.files || []).map((entry) => entry.path));
  for (const skill of named) {
    assert.ok(
      files.has(`assets/lithermes-plugin/skills/${skill}/SKILL.md`),
      `lithermes:${skill} is a deferred pointer target but its SKILL.md is not packed`,
    );
  }
});
