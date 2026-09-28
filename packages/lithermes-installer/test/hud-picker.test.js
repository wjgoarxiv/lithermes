const assert = require("node:assert/strict");
const { test } = require("node:test");
const { PassThrough } = require("node:stream");
const { promptAccent } = require("../src/lib/hud");

async function ask(answer) {
  const input = new PassThrough();
  const output = new PassThrough();
  const pending = promptAccent({ input, output, color: false });
  input.write(answer);
  return pending;
}

test("promptAccent resolves an accent by name", async () => {
  assert.equal((await ask("rose\n"))?.accent, "rose");
});

test("promptAccent resolves an accent by 1-based number", async () => {
  assert.equal((await ask("2\n"))?.accent, "blue");
});

test("promptAccent returns null on empty line (skip)", async () => {
  assert.equal(await ask("\n"), null);
});

test("promptAccent returns null on an unknown accent", async () => {
  assert.equal(await ask("chartreuse\n"), null);
});

test("promptAccent prints the accent list without escapes on a plain TTY", async (t) => {
  const previousTerm = process.env.TERM;
  process.env.TERM = "xterm-256color";
  t.after(() => {
    if (previousTerm === undefined) delete process.env.TERM;
    else process.env.TERM = previousTerm;
  });
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  output.isTTY = true;
  let buf = "";
  output.on("data", (c) => { buf += c.toString(); });
  const pending = promptAccent({ input, output, color: false });
  input.write("cyan\n");
  await pending;
  assert.match(buf, /cyan/);
  assert.match(buf, /rose/);
  assert.doesNotMatch(buf, /\x1b/);
});
