import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hashFiles = ["reference-a-skill-sha256.txt", "krehel-skills-sha256.txt"];
const forbidden = hashFiles.flatMap((name) => {
  const source = fs.readFileSync(path.join(packageRoot, "test/fixtures", name), "utf8");
  const rows = source.trim().split(/\r?\n/).map((line) => {
    const match = line.match(/^([a-f0-9]{64})\s\s(.+)$/);
    assert.ok(match, `invalid forbidden hash row in ${name}`);
    return { sha256: match[1], source: `${name}:${match[2]}` };
  });
  assert.ok(rows.length >= 50, `${name} unexpectedly incomplete`);
  return rows;
});
const byHash = new Map(forbidden.map(({ sha256, source }) => [sha256, source]));

test("forbidden source hashes are absent from the shipped package tree", () => {
  assert.equal(byHash.size, forbidden.length, "hash table must not repeat an entry");
  assert.ok(forbidden.length > 100, "hash table unexpectedly incomplete");
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: packageRoot, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  assert.equal(packed.status, 0, packed.stderr);
  const files = JSON.parse(packed.stdout)[0].files.map(({ path: relative }) => relative)
    .filter((relative) => relative.startsWith("assets/lithermes-plugin/skills/frontend-ui-ux/"))
    .map((relative) => path.join(packageRoot, relative));
  assert.ok(files.length > 20, "packed frontend skill inventory is incomplete");
  const collisions = files.flatMap((file) => {
    const sha256 = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const source = byHash.get(sha256);
    return source ? [{ file: path.relative(packageRoot, file), source, sha256 }] : [];
  });
  assert.deepEqual(collisions, []);
});
