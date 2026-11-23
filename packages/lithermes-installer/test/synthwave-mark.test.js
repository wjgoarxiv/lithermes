const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const synthwave = require("../src/lib/synthwaveMark");
const data = require("../src/lib/synthwaveRows.json");
const { renderInstallBanner } = require("../src/lib/modelPrompt");

// The digest the family synthwave spec carries; the generated rows must hash to it.
const SPEC_DIGEST = "f063a0cefb969db40c0fc436742240912d895d43c3013d35782320befc0a2b86";
const SIZES = ["B-L", "B-M", "B-S"];
const ESC = /\x1b/;
const strip = (line) => line.replace(/\x1b\[[0-9;]*m/g, "");
const cells = (line) => [...strip(line)].length;
const MODES = ["truecolor", "256", "none", "plain"];

test("generated rows recompute to the spec digest", () => {
  const joined = (table) => SIZES.map((size) => table[size].join("\n")).join("\n--\n");
  const digest = createHash("sha256")
    .update(joined(data.pixelRows))
    .update(JSON.stringify(data.shared))
    .update(joined(data.monoRows))
    .digest("hex");
  assert.equal(digest, data.digest);
  assert.equal(digest, SPEC_DIGEST);
  assert.equal(synthwave.SPEC_DIGEST, SPEC_DIGEST);
});

test("size ladder follows terminal columns, and an unknown width counts as 80", () => {
  for (const [cols, size] of [[20, null], [23, null], [24, "B-S"], [43, "B-S"], [44, "B-M"], [75, "B-M"],
    [76, "B-L"], [80, "B-L"], [200, "B-L"], [undefined, "B-L"], [0, "B-L"], [Number.NaN, "B-L"]]) {
    assert.equal(synthwave.pickSize(cols), size, `cols ${cols}`);
  }
  assert.deepEqual(synthwave.synthwaveRows({ cols: 20, mode: "truecolor" }), ["LIT · hermes agent"]);
  assert.equal(synthwave.terminalColumns({ stream: {}, env: {} }), 80);
  assert.equal(synthwave.terminalColumns({ stream: { columns: 44 }, env: { COLUMNS: "100" } }), 44);
  assert.equal(synthwave.terminalColumns({ stream: {}, env: { COLUMNS: "30" } }), 30);
  for (const [cols, size] of [[24, "B-S"], [44, "B-M"], [76, "B-L"], [80, "B-L"], [200, "B-L"]]) {
    const mono = synthwave.synthwaveRows({ cols, mode: "none" });
    assert.deepEqual(mono.slice(0, -1), data.monoRows[size], `mono rows at ${cols}`);
    assert.equal(mono.at(-1).trim(), "LIT · hermes agent");
    const painted = synthwave.synthwaveRows({ cols, mode: "truecolor" });
    assert.equal(painted.length, data.pixelRows[size].length / 2 + 1, `cell rows at ${cols}`);
  }
});

test("no row is wider than the terminal at any width from 20 to 200", () => {
  const env = { LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
  for (let cols = 20; cols <= 200; cols += 1) {
    for (const mode of MODES) {
      for (const row of synthwave.synthwaveRows({ cols, mode })) {
        assert.ok(cells(row) <= cols, `${mode} at ${cols}: ${cells(row)} cells`);
      }
    }
    const stream = { isTTY: true, columns: cols };
    for (const color of [true, false]) {
      for (const row of renderInstallBanner({ version: "0.0.0", color, env, stream }).split("\n")) {
        assert.ok(cells(row) <= cols, `banner color=${color} at ${cols}`);
      }
    }
  }
});

test("colour paints two pixels per cell and the tagline in a gradient", () => {
  const rows = synthwave.synthwaveRows({ cols: 80, mode: "truecolor" });
  // Row 2 of B-L: upper pixel "m" (white edge) over lower "m" -> a space on a white background.
  assert.match(rows[2], /\x1b\[48;2;255;255;255m \x1b\[0m/);
  // Chrome level b sits on the LitHermes stops, and a star over the sky draws a half block.
  assert.match(rows.join(""), /\x1b\[38;2;\d+;\d+;\d+;48;2;\d+;\d+;\d+m▀/);
  assert.equal(strip(rows.at(-1)).trim(), "LIT · hermes agent");
  assert.match(rows.at(-1), /\x1b\[38;2;139;233;253mL/);
  assert.match(rows.at(-1), /\x1b\[38;2;255;210;63mt/);
  const indexed = synthwave.synthwaveRows({ cols: 80, mode: "256" }).join("\n");
  assert.doesNotMatch(indexed, /[34]8;2;/);
  // #111122 sky scales to cube (0,0,0) = 16; #ffffff to 231.
  assert.match(indexed, /48;5;16m/);
  assert.match(indexed, /48;5;231m/);
});

test("mono and plain output carry zero escape bytes", () => {
  const env = { LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
  for (let cols = 20; cols <= 200; cols += 1) {
    assert.doesNotMatch(synthwave.synthwaveRows({ cols, mode: "none" }).join("\n"), ESC);
    assert.doesNotMatch(synthwave.synthwaveRows({ cols, mode: "plain" }).join("\n"), ESC);
    for (const extra of [{ NO_COLOR: "1" }, { CI: "1" }]) {
      const text = renderInstallBanner({ version: "0.0.0", color: true, env: { ...env, ...extra }, stream: { isTTY: true, columns: cols } });
      assert.doesNotMatch(text, ESC, `cols ${cols}`);
    }
    const piped = renderInstallBanner({ version: "0.0.0", color: true, env, stream: { isTTY: false, columns: cols } });
    assert.doesNotMatch(piped, ESC);
  }
});

test("a pipe gets only the plain line and the version; a terminal keeps the art", () => {
  const env = { LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
  for (const stream of [{ isTTY: false, columns: 80 }, { columns: 80 }, undefined]) {
    for (const extra of [{}, { NO_COLOR: "1" }]) {
      const piped = renderInstallBanner({ version: "0.0.0", color: true, env: { ...env, ...extra }, stream: stream || null });
      assert.equal(piped, "LIT · hermes agent\nlithermes v0.0.0");
      assert.doesNotMatch(piped, /[█▀▄░]/);
      assert.doesNotMatch(piped, ESC);
    }
  }
  const tty = { isTTY: true, columns: 80 };
  const colour = renderInstallBanner({ version: "0.0.0", color: true, env, stream: tty });
  assert.match(colour, /\x1b\[[0-9;]*m▀/);
  const mono = renderInstallBanner({ version: "0.0.0", color: true, env: { ...env, NO_COLOR: "1" }, stream: tty });
  assert.match(mono, /█/);
  assert.match(mono, /░/);
  assert.doesNotMatch(mono, ESC);
});
