const { colorMode } = require("./litMark");

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const installStages = {
  "Preparing Hermes config": {
    number: "01",
    purpose: "Inspect host compatibility and build a safe config plan",
    target: "config.yaml",
    title: "CONFIG PLAN",
  },
  "Inspecting existing plugin": {
    number: "02",
    purpose: "Verify existing files are manifest-owned before replacement",
    target: "plugins/lithermes",
    title: "OWNERSHIP",
  },
  "Copying LitHermes payload": {
    number: "03",
    purpose: "Install the bundled Hermes hooks, commands, skills, and tools",
    target: "plugins/lithermes",
    title: "PLUGIN PAYLOAD",
  },
  "Writing Hermes config": {
    number: "04",
    purpose: "Apply only the verified model and plugin enrollment plan",
    target: "config.yaml",
    title: "HERMES CONFIG",
  },
  "Installing HUD skins": {
    number: "05",
    purpose: "Install optional LitHermes terminal accent presets",
    target: "skins",
    title: "HUD SKINS",
  },
  "Recording install manifest": {
    number: "06",
    purpose: "Record file ownership and the exact installed package version",
    target: "lithermes/install-manifest.json",
    title: "INSTALL MANIFEST",
  },
  "Checking Hermes compatibility patches": {
    number: "07",
    purpose: "Apply requested host compatibility patches with rollback metadata",
    target: "Hermes runtime source",
    title: "COMPATIBILITY",
  },
};

function shouldUseSpinner({ stream = process.stderr, env = process.env, flags = {} } = {}) {
  if (flags.json || flags["dry-run"] || flags["no-spinner"]) return false;
  if (flags.spinner) return true;
  if (env.LITHERMES_FORCE_SPINNER === "1") return true;
  return colorMode({ stream, env }) !== "none";
}

// Progress and receipts follow the same terminal policy as the wordmark.
function makePalette(enabled) {
  const wrap = (open, close) => (s) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s);
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    green: wrap(32, 39),
    red: wrap(31, 39),
    cyan: wrap(36, 39),
  };
}

function displayTarget(root, relative) {
  if (relative === "Hermes runtime source") return relative;
  return `${root.replace(/\/$/, "")}/${relative}`;
}

function panelLine(label, value) {
  return `│ ${label.padEnd(13)} ${value}`;
}

function renderInstallReceipt(message, { env = process.env, stream = process.stdout } = {}) {
  const c = makePalette(colorMode({ env, stream }) !== "none");
  const lines = message.split("\n");
  const packageLine = lines[0] || "LitHermes installed";
  const details = lines.slice(1);
  const rows = [panelLine("Status", c.green("Ready for Hermes")), panelLine("Package", packageLine)];
  for (const line of details) {
    if (line.startsWith("Restart ")) {
      rows.push(panelLine("Next", line));
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      rows.push(panelLine("Detail", line));
      continue;
    }
    const label = line.slice(0, separator);
    rows.push(panelLine(`${label[0].toUpperCase()}${label.slice(1)}`, line.slice(separator + 1).trim()));
  }
  return ["", c.bold("╭─ INSTALL RECEIPT"), ...rows, "╰─ LitHermes is installed; restart Hermes to load the new plugin"].join("\n");
}

// Step-aware install renderer. Each onProgress phase becomes a live spinner line
// that is finalized in place with its own ✓ (or ✗ on failure), producing an
// ordered checklist. Plain terminals retain the stages without cursor controls.
function createSpinner({ stream = process.stderr, text = "Installing LitHermes", env = process.env, target = "~/.hermes", version = "current" } = {}) {
  const animated = colorMode({ env, stream }) !== "none";
  const c = makePalette(animated);
  const control = (code) => animated ? `\x1b[${code}` : "";
  let frameIndex = 0;
  let timer = null;
  let active = false;
  let currentLabel = null;
  let stepStart = 0;

  function elapsed() {
    if (!stepStart) return "";
    const secs = (Date.now() - stepStart) / 1000;
    return c.dim(` (${secs.toFixed(1)}s)`);
  }

  function paintActive() {
    const frame = c.cyan(frames[frameIndex % frames.length]);
    frameIndex += 1;
    stream.write(`\r${frame} ${currentLabel}${elapsed()}\x1b[K`);
  }

  function clearTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // Finalize the active step line in place with a status glyph, then newline so
  // it persists above the next step.
  function finalizeCurrent(glyph) {
    if (currentLabel === null) return;
    clearTimer();
    stream.write(`${animated ? "\r" : ""}${glyph} ${currentLabel}${elapsed()}${control("K")}\n`);
    currentLabel = null;
  }

  function startStep(label) {
    const stage = installStages[label];
    if (stage) {
      stream.write(`${c.bold(stage.number)} · ${c.cyan(stage.title)}\n`);
      stream.write(`     ${stage.purpose}\n`);
      stream.write(`     ${c.dim("target")}  ${displayTarget(target, stage.target)}\n`);
    }
    currentLabel = label;
    stepStart = Date.now();
    if (animated) {
      paintActive();
      timer = setInterval(paintActive, 80);
      if (timer && typeof timer.unref === "function") timer.unref();
    }
  }

  return {
    start() {
      if (active) return;
      active = true;
      stream.write(control("?25l"));
      stream.write(`${c.bold("╭─ PREPARING INSTALL")}\n`);
      stream.write(`${panelLine("Package", `LitHermes ${version}`)}\n`);
      stream.write(`${panelLine("Target", target)}\n`);
      stream.write(`${panelLine("Safety", "Config writes follow ownership and host-capability checks")}\n`);
      stream.write(`╰─ ${text}\n\n`);
    },
    update(nextText) {
      if (!active) return;
      finalizeCurrent(c.green("✓"));
      startStep(nextText);
    },
    succeed(message = "LitHermes install ready") {
      if (!active) return;
      finalizeCurrent(c.green("✓"));
      clearTimer();
      active = false;
      stream.write(`${c.green("✓")} ${message}\n${control("?25h")}`);
    },
    fail(message = "LitHermes install failed") {
      if (!active) return;
      finalizeCurrent(c.red("✕"));
      clearTimer();
      active = false;
      stream.write(`${c.red("╭─ INSTALL STOPPED")}\n`);
      stream.write(`${panelLine("Status", "LitHermes install failed")}\n`);
      stream.write(`${panelLine("Reason", message)}\n`);
      stream.write(`${panelLine("Safety", "No later install stages were run")}\n`);
      stream.write(`${panelLine("Next", "Resolve the reason above, then rerun `lithermes install --yes`")}\n`);
      stream.write(`╰─ Exit without reporting success\n${control("?25h")}`);
    },
  };
}

module.exports = { createSpinner, renderInstallReceipt, shouldUseSpinner };
