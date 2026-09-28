const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const mark = require("../src/lib/litMark");
const dataPath = path.join(__dirname, "../assets/lithermes-plugin/lit_mark_rows.json");
const cells = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const stripAnsi = (line) => line.replace(/\x1b\[[0-9;]*m/g, "");

for (const [size, width, height] of [["standard", 22, 10], ["banner", 44, 20], ["micro", 16, 5]]) {
  test(`${size} has canonical dimensions and only mark glyphs`, () => {
    const rows = mark[size];
    assert.equal(rows.length, height);
    for (const row of rows) {
      assert.equal([...row].length, width);
      assert.match(row, /^[█▀▄▌▐▖▗▘▝▙▛▜▟▚▞ ]+$/u);
    }
    assert.deepEqual(rows, cells[size].map((row) => row.text));
  });
}

test("all geometry and cell colors match the selected Ignition B source", () => {
  assert.equal(createHash("sha256").update(fs.readFileSync(dataPath)).digest("hex"),
    "e7f3e2be168bedc5c15836d105ffed570f3bfd8745522502293de8718f503aec");
});

test("lockup preserves the mark envelope and native product column", () => {
  const rows = mark.lockup("lithermes");
  assert.equal(rows.length, 10);
  assert.equal(rows[5].slice(30), "lithermes");
  rows.forEach((row, i) => assert.equal(row.slice(0, 22), mark.standard[i]));
  for (const name of ["custom-agent", "Hermes 2.0 · local", "lithermes v2.3.4"]) {
    const locked = mark.lockup(name, mark.banner);
    assert.equal(locked[10].slice(52), name);
    for (const mode of ["256", "truecolor"]) {
      assert.deepEqual(mark.colorize(locked, { mode }).map(stripAnsi), locked);
      assert.ok(mark.colorize(locked, { mode })[10].endsWith(name));
    }
  }
  assert.throws(() => mark.lockup("bad\nname"), /product/);
});

test("flat foreground colors preserve every selected cell without extrusion or background", () => {
  const palette = { "#FF6337": ["255;99;55", 203], "#D7F75B": ["215;247;91", 191], "#F2EFDF": ["242;239;223", 230] };
  for (const size of ["standard", "banner", "micro"]) {
    const rows = mark[size];
    assert.deepEqual(mark.colorize(rows, { mode: "none" }), rows);
    assert.doesNotMatch(mark.colorize(rows, { mode: "none" }).join("\n"), /\x1b/);
    for (const mode of ["256", "truecolor"]) {
      const colored = mark.colorize(rows, { mode });
      assert.deepEqual(colored.map(stripAnsi), rows);
      cells[size].forEach((row, index) => {
        const expected = [...row.text].map((ch, column) => {
          const hex = row.colors[column];
          if (ch === " ") assert.equal(hex, null);
          if (!hex) return ch;
          assert.ok(palette[hex]);
          const code = mode === "256" ? `38;5;${palette[hex][1]}` : `38;2;${palette[hex][0]}`;
          return `\x1b[${code}m${ch}\x1b[0m`;
        }).join("");
        assert.equal(colored[index], expected);
      });
      assert.doesNotMatch(colored.join("\n"), /▓|\x1b\[(?:48;|4[0-7]m)/u);
    }
  }
  assert.throws(() => mark.colorize(mark.standard, { mode: "invalid" }), /mode/);
  assert.deepEqual(mark.colorize(mark.standard, { mode: "truecolor", shadow: "#123456" }), mark.colorize(mark.standard, { mode: "truecolor" }));
});

test("terminal policy suppresses color for NO_COLOR, CI, JSON and pipes", () => {
  const stream = { isTTY: true };
  const env = { LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
  assert.equal(mark.colorMode({ stream, env }), "truecolor");
  assert.equal(mark.colorMode({ stream, env: { LANG: env.LANG, TERM: env.TERM } }), "256");
  for (const extra of [{ NO_COLOR: "" }, { CI: "true" }, { CI: "" }]) {
    assert.equal(mark.colorMode({ stream, env: { ...env, ...extra } }), "none");
    assert.deepEqual(mark.render(mark.banner, { stream, env: { ...env, ...extra } }), mark.banner);
  }
  assert.equal(mark.colorMode({ stream, env, json: true }), "none");
  assert.equal(mark.colorMode({ stream: { isTTY: false }, env }), "none");
  for (const fallback of [{ LANG: "C" }, { LANG: env.LANG, LC_ALL: "POSIX" }, { LANG: env.LANG, TERM: "dumb" }]) {
    assert.deepEqual(mark.render(mark.banner, { stream, env: fallback }), ["LIT"]);
  }
});

test("installer banner uses Ignition cells and preserves its plain terminal policy", () => {
  const { renderInstallBanner } = require("../src/lib/modelPrompt");
  const stream = { isTTY: true };
  const env = { LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
  const version = require("../package.json").version;
  const rows = mark.lockup(`lithermes v${version}`, mark.banner);
  assert.equal(renderInstallBanner({ version, color: true, env, stream }),
    mark.colorize(rows, { mode: "truecolor" }).join("\n"));
  for (const extra of [{ NO_COLOR: "" }, { CI: "" }, { CI: "1" }]) {
    assert.equal(renderInstallBanner({ version, color: true, env: { ...env, ...extra }, stream }), rows.join("\n"));
  }
  assert.equal(renderInstallBanner({ version, color: true, env: { TERM: "dumb" }, stream }), "LIT");
});
