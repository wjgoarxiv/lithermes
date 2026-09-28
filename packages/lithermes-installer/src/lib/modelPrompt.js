const readline = require("node:readline");
const { parseDocument } = require("yaml");
const mark = require("./litMark");
const { PROVIDER_IDS, ROUTE_CATALOG, managedRequest, missingCredentialWarning } = require("./modelRoutePolicy");

// Installer prompts and frame per plans/references/installer-choice-contract.md.
// Numbered zero-based readline menus, default in brackets, no TUI dependency.

function paint(enabled, rgb, text) {
  return enabled ? `\x1b[38;2;${rgb}m${text}\x1b[39m` : text;
}

function renderInstallBanner({ version = "current", color = false, env = process.env, stream = process.stdout } = {}) {
  const rows = mark.lockup(`lithermes v${version}`, mark.banner);
  return mark.render(rows, { env, stream, mode: color ? mark.colorMode({ env, stream }) : "none" }).join("\n");
}

function providerLabel(id) {
  return `${ROUTE_CATALOG[id].label.padEnd(30)} (${id})`;
}

function rowLabel(row) {
  return `${row.model.padEnd(24)} · ${row.effort.padEnd(6)} — ${row.note}`;
}

// readline discards 'line' events that arrive while no question is pending,
// which loses piped answers between menus — so lines are queued here instead.
function createLineReader(rl) {
  const queued = [];
  let waiter = null;
  let closed = false;
  rl.on("line", (line) => {
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve({ line });
    } else {
      queued.push(line);
    }
  });
  rl.on("close", () => {
    closed = true;
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve({ closed: true });
    }
  });
  return () => {
    if (queued.length) return Promise.resolve({ line: queued.shift() });
    if (closed) return Promise.resolve({ closed: true });
    return new Promise((resolve) => { waiter = resolve; });
  };
}

async function menu(nextLine, output, title, items, defaultIndex) {
  const max = items.length - 1;
  output.write(`${title}\n`);
  items.forEach((item, index) => output.write(`   ${index}. ${item}\n`));
  for (;;) {
    output.write(`Select 0-${max} [${defaultIndex}]: `);
    const answer = await nextLine();
    if (answer.closed) return defaultIndex;
    const trimmed = answer.line.trim();
    if (!trimmed) return defaultIndex;
    const index = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    if (Number.isInteger(index) && index >= 0 && index <= max) return index;
    output.write(`Please answer 0-${max}.\n`);
  }
}

function rowIndex(rows, preset) {
  const index = rows.findIndex((row) => row.model === preset.model && row.effort === preset.effort);
  return index === -1 ? 0 : index;
}

function routeFromConfig(text) {
  if (!String(text || "").trim()) return managedRequest();
  try {
    const document = parseDocument(String(text), { strict: true, uniqueKeys: true });
    if (document.errors.length) return managedRequest();
    return managedRequest({
      childEffort: document.getIn(["delegation", "reasoning_effort"]),
      childModel: document.getIn(["delegation", "model"]),
      childProvider: document.getIn(["delegation", "provider"]),
      effort: document.getIn(["agent", "reasoning_effort"]),
      model: document.getIn(["model", "default"]),
      provider: document.getIn(["model", "provider"]),
    });
  } catch {
    return managedRequest();
  }
}

// Provider → lead model+effort → helper provider → helper model+effort.
// Falls back to the shipped default route if the input closes before an answer.
async function runMenus(nextLine, output, preset = managedRequest()) {
  try {
    const providerDefaultIndex = Math.max(0, PROVIDER_IDS.indexOf(preset.provider));
    const providerIndex = await menu(
      nextLine,
      output,
      "Choose the provider for LitHermes agents.",
      PROVIDER_IDS.map(providerLabel),
      providerDefaultIndex,
    );
    const provider = PROVIDER_IDS[providerIndex];
    const leadRows = ROUTE_CATALOG[provider].rows;
    const leadPreset = provider === preset.provider ? preset : ROUTE_CATALOG[provider].lead;
    const leadIndex = await menu(
      nextLine,
      output,
      "Choose the LEAD model (plans and reviews).",
      leadRows.map(rowLabel),
      rowIndex(leadRows, leadPreset),
    );
    const childProviderDefault = provider === preset.provider ? preset.childProvider : provider;
    const childProviderDefaultIndex = Math.max(0, PROVIDER_IDS.indexOf(childProviderDefault));
    const childProviderIndex = await menu(
      nextLine,
      output,
      "Choose the provider for HELPER agents (delegated workers).",
      PROVIDER_IDS.map(providerLabel),
      childProviderDefaultIndex,
    );
    const childProvider = PROVIDER_IDS[childProviderIndex];
    const helperRows = ROUTE_CATALOG[childProvider].rows;
    const helperPreset = provider === preset.provider && childProvider === preset.childProvider
      ? preset
      : ROUTE_CATALOG[childProvider].helper;
    const helperIndex = await menu(
      nextLine,
      output,
      "Choose the HELPER model (delegated workers).",
      helperRows.map(rowLabel),
      rowIndex(helperRows, helperPreset === preset
        ? { model: preset.childModel, effort: preset.childEffort }
        : helperPreset),
    );
    return managedRequest({
      childEffort: helperRows[helperIndex].effort,
      childModel: helperRows[helperIndex].model,
      childProvider,
      effort: leadRows[leadIndex].effort,
      model: leadRows[leadIndex].model,
      provider,
    });
  } catch {
    return managedRequest();
  }
}

async function promptModelRoute({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, terminal: false });
  try {
    return await runMenus(createLineReader(rl), output);
  } finally {
    rl.close();
  }
}

// One readline session covering the menus, the summary card, and the Enter
// confirmation, so a queued keystroke cannot be lost between two interfaces.
async function promptModelRouteSession({ input = process.stdin, output = process.stdout, env = process.env, configPath, preset = managedRequest() } = {}) {
  const rl = readline.createInterface({ input, terminal: false });
  const nextLine = createLineReader(rl);
  try {
    output.write(`Model route: currently ${preset.model} · ${preset.effort}\n`);
    output.write("   0. keep current            (recommended)\n");
    const route = await runMenus(nextLine, output, preset);
    output.write(`${renderModelRouteCard(route, { configPath, env })}\n`);
    const answer = await nextLine();
    return { confirmed: !answer.closed, route };
  } finally {
    rl.close();
  }
}

function renderModelRouteCard(route, { configPath, env = process.env } = {}) {
  const sameProvider = route.childProvider === route.provider;
  const helpers = `${sameProvider ? "" : `${route.childProvider} / `}${route.childModel} · ${route.childEffort}`;
  const warning = missingCredentialWarning(route, env);
  return [
    "╭─ MODEL ROUTE",
    `│ Provider   ${route.provider}`,
    `│ Lead       ${route.model} · ${route.effort}`,
    `│ Helpers    ${helpers}`,
    `│ Writes     ${configPath}  (managed keys only)`,
    ...(warning ? [`│ Warning    ${warning}`] : []),
    "╰─ Enter to continue · Ctrl-C to abort (nothing written yet)",
  ].join("\n");
}

module.exports = {
  missingCredentialWarning,
  promptModelRoute,
  promptModelRouteSession,
  routeFromConfig,
  renderInstallBanner,
  renderModelRouteCard,
};
