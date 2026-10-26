const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const skillRoot = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const load = (name) => import(pathToFileURL(path.join(skillRoot, "engine", name)).href);
const temps = [];
const tmp = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(dir); return dir; };
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

test("addToStills: records the board in the stills set", async () => {
  const { addToStills } = await load("board.mjs");
  const out = tmp("board-");
  fs.mkdirSync(path.join(out, "stills"), { recursive: true });
  fs.writeFileSync(path.join(out, "stills", "stills.json"), JSON.stringify({ schema: "lithermes.stills/v1", files: [{ file: "stills/beat-01.png", sha256: "x" }] }));
  fs.writeFileSync(path.join(out, "stills", "board.png"), "board");
  const digest = addToStills(out, { file: "stills/board.png", kind: "board", frames: [0, 1] }, { sha256 });
  const set = JSON.parse(fs.readFileSync(path.join(out, "stills", "stills.json"), "utf8"));
  const board = set.files.find((f) => f.file === "stills/board.png");
  assert.ok(board, "the board joins the set");
  assert.equal(board.kind, "board");
  assert.equal(board.sha256, sha256(Buffer.from("board")));
  assert.equal(digest, sha256(fs.readFileSync(path.join(out, "stills", "stills.json"))));
});

test("addToStills: refuses a board that was never written", async () => {
  const { addToStills } = await load("board.mjs");
  const out = tmp("board-missing-");
  fs.mkdirSync(path.join(out, "stills"), { recursive: true });
  fs.writeFileSync(path.join(out, "stills", "stills.json"), JSON.stringify({ files: [] }));
  assert.throws(() => addToStills(out, { file: "stills/board.png", kind: "board" }, { sha256 }), /was not written/);
});
