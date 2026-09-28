const assert = require("node:assert/strict");
const { test } = require("node:test");
const { supportsColor } = require("../src/lib/skins");
const {
  createSpinner,
  renderInstallReceipt,
  shouldUseSpinner,
} = require("../src/lib/spinner");

function captureStream() {
  let output = "";
  return {
    isTTY: true,
    read: () => output,
    write(chunk) {
      output += chunk;
    },
  };
}

test("TTY install progress explains numbered stages and targets", () => {
  // Given: an interactive terminal renderer with color disabled for stable evidence.
  const stream = captureStream();
  const spinner = createSpinner({
    env: { NO_COLOR: "1", TERM: "xterm-256color" },
    stream,
    target: "/tmp/hermes-home",
    version: "0.8.26",
  });

  // When: the installer advances through two real Hermes-native phases.
  spinner.start();
  spinner.update("Preparing Hermes config");
  spinner.update("Inspecting existing plugin");
  spinner.succeed();

  // Then: the terminal keeps a numbered, explanatory record of both phases.
  const output = stream.read();
  assert.match(output, /PREPARING INSTALL/);
  assert.match(output, /Package\s+LitHermes 0\.8\.26/);
  assert.match(output, /Target\s+\/tmp\/hermes-home/);
  assert.match(output, /01 · CONFIG PLAN/);
  assert.match(output, /Inspect host compatibility and build a safe config plan/);
  assert.match(output, /target\s+\/tmp\/hermes-home\/config\.yaml/);
  assert.match(output, /02 · OWNERSHIP/);
  assert.match(output, /manifest-owned/);
  assert.doesNotMatch(output, /\x1b/);
});

test("TTY install receipt summarizes outcome without changing the plain message", () => {
  // Given: the existing semantic install result.
  const message = [
    "Installed LitHermes 0.8.26",
    "plugin: /tmp/hermes-home/plugins/lithermes",
    "model config: updated",
    "concurrency: hard (per batch 20)",
    "Restart any running Hermes gateway to load new plugins.",
  ].join("\n");

  // When: the TTY-only presentation renders its final receipt.
  const receipt = renderInstallReceipt(message, { env: { NO_COLOR: "1" } });

  // Then: the same facts are grouped into an understandable completion panel.
  assert.match(receipt, /INSTALL RECEIPT/);
  assert.match(receipt, /Status\s+Ready for Hermes/);
  assert.match(receipt, /Package\s+Installed LitHermes 0\.8\.26/);
  assert.match(receipt, /Plugin\s+\/tmp\/hermes-home\/plugins\/lithermes/);
  assert.match(receipt, /Model config\s+updated/);
  assert.match(receipt, /Next\s+Restart any running Hermes gateway/);
  assert.doesNotMatch(receipt, /\x1b\[/);
  assert.equal(message.startsWith("Installed LitHermes"), true);
});

test("CI and NO_COLOR keep automatic install output non-interactive", () => {
  // Given/When/Then: automation environments never receive an automatic spinner.
  assert.equal(shouldUseSpinner({ env: { CI: "1" }, stream: { isTTY: true } }), false);
  assert.equal(shouldUseSpinner({ env: { NO_COLOR: "1" }, stream: { isTTY: true } }), false);
});

for (const [name, extra] of [["empty CI", { CI: "" }], ["empty NO_COLOR", { NO_COLOR: "" }],
  ["dumb terminal", { TERM: "dumb" }], ["non-UTF-8 locale", { LC_ALL: "C" }]]) {
  test(`${name} keeps install progress, receipts and HUD output free of escapes`, () => {
    const env = { TERM: "xterm-256color", LC_ALL: "en_US.UTF-8", COLORTERM: "truecolor", ...extra };
    const stream = captureStream();
    assert.equal(supportsColor({ env, stream }), false);
    assert.equal(shouldUseSpinner({ env, stream }), false);
    for (const outcome of ["succeed", "fail"]) {
      const spinner = createSpinner({ env, stream });
      spinner.start();
      spinner.update("Preparing Hermes config");
      spinner[outcome]("finished");
    }
    assert.match(stream.read(), /CONFIG PLAN/);
    assert.match(stream.read(), /INSTALL STOPPED/);
    assert.doesNotMatch(stream.read(), /\x1b/);
    assert.doesNotMatch(renderInstallReceipt("Installed LitHermes", { env, stream }), /\x1b/);
  });
}

test("JSON disables even explicitly requested install progress", () => {
  assert.equal(shouldUseSpinner({ flags: { json: true, spinner: true }, stream: captureStream(),
    env: { TERM: "xterm-256color", LC_ALL: "en_US.UTF-8" } }), false);
});

test("TTY install failure leaves an actionable stopped receipt", () => {
  // Given: an active interactive install.
  const stream = captureStream();
  const spinner = createSpinner({
    env: { TERM: "xterm-256color", LC_ALL: "en_US.UTF-8" },
    stream,
    target: "/tmp/hermes-home",
    version: "0.8.26",
  });
  spinner.start();
  spinner.update("Inspecting existing plugin");

  // When: ownership validation fails.
  spinner.fail("Existing plugin is not manifest-owned.");

  // Then: the cursor is restored and the reason plus rerun guidance remain visible.
  const output = stream.read();
  assert.match(output, /INSTALL STOPPED/);
  assert.match(output, /Reason\s+Existing plugin is not manifest-owned\./);
  assert.match(output, /Next\s+Resolve the reason above, then rerun/);
  assert.match(output, /\x1b\[\?25h/);
});
