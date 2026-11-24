const readline = require("node:readline");
const { parseDocument } = require("yaml");
const mark = require("./litMark");
const synthwave = require("./synthwaveMark");
const { PROVIDER_IDS, ROUTE_CATALOG, managedRequest, missingCredentialWarning } = require("./modelRoutePolicy");

// Installer prompts and frame per plans/references/installer-choice-contract.md.
// Numbered zero-based readline menus, default in brackets, no TUI dependency.

function paint(enabled, rgb, text) {
  return enabled ? `\x1b[38;2;${rgb}m${text}\x1b[39m` : text;
}

// The synthwave mark sized to the terminal, with the version centred under it.
// A pipe, an agent's tool call or a CI log is not a terminal anyone looks at, so
// it gets only the plain line and the version, never rows of art.
function renderInstallBanner({ version = "current", color = false, env = process.env, stream = process.stdout } = {}) {
  const versionLine = `lithermes v${version}`;
  if (!(stream && stream.isTTY) || !mark.utf8Terminal(env)) return [synthwave.FALLBACK_LINE, versionLine].join("\n");
  const cols = synthwave.terminalColumns({ stream, env });
  const rows = synthwave.synthwaveRows({ cols, mode: color ? mark.colorMode({ env, stream }) : "none" });
  return [...rows, synthwave.centred(versionLine, synthwave.markWidth(cols))].join("\n");
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

async function menu(nextLine, output, { title, items, defaultIndex }) {
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

const providerChoices = () => PROVIDER_IDS.map((id) => ({ label: ROUTE_CATALOG[id].label, detail: id, folded: id }));
const rowChoices = (rows) => rows.map((row) => ({ label: `${row.model} · ${row.effort}`, detail: row.note }));

// Provider → lead model+effort → helper provider → helper model+effort, each asked through `ask`,
// which returns an index. Falls back to the shipped default route if the input closes early.
async function runMenus(ask, preset = managedRequest()) {
  try {
    const providerDefaultIndex = Math.max(0, PROVIDER_IDS.indexOf(preset.provider));
    const providerIndex = await ask({
      title: "Choose the provider for LitHermes agents.",
      items: PROVIDER_IDS.map(providerLabel),
      defaultIndex: providerDefaultIndex,
      card: {
        title: "Agent provider",
        note: `Sets which provider serves the LitHermes agents; the route now is ${preset.model} · ${preset.effort}, and Enter keeps what is marked.`,
        choices: providerChoices(),
      },
    });
    const provider = PROVIDER_IDS[providerIndex];
    const leadRows = ROUTE_CATALOG[provider].rows;
    const leadPreset = provider === preset.provider ? preset : ROUTE_CATALOG[provider].lead;
    const leadIndex = await ask({
      title: "Choose the LEAD model (plans and reviews).",
      items: leadRows.map(rowLabel),
      defaultIndex: rowIndex(leadRows, leadPreset),
      card: {
        title: "Lead model",
        note: "Sets the model and reasoning effort that plan and review; Enter keeps what is marked.",
        choices: rowChoices(leadRows),
      },
    });
    const childProviderDefault = provider === preset.provider ? preset.childProvider : provider;
    const childProviderDefaultIndex = Math.max(0, PROVIDER_IDS.indexOf(childProviderDefault));
    const childProviderIndex = await ask({
      title: "Choose the provider for HELPER agents (delegated workers).",
      items: PROVIDER_IDS.map(providerLabel),
      defaultIndex: childProviderDefaultIndex,
      card: {
        title: "Helper provider",
        note: "Sets which provider serves the helper agents, the delegated workers; Enter keeps what is marked.",
        choices: providerChoices(),
      },
    });
    const childProvider = PROVIDER_IDS[childProviderIndex];
    const helperRows = ROUTE_CATALOG[childProvider].rows;
    const helperPreset = provider === preset.provider && childProvider === preset.childProvider
      ? preset
      : ROUTE_CATALOG[childProvider].helper;
    const helperIndex = await ask({
      title: "Choose the HELPER model (delegated workers).",
      items: helperRows.map(rowLabel),
      defaultIndex: rowIndex(helperRows, helperPreset === preset
        ? { model: preset.childModel, effort: preset.childEffort }
        : helperPreset),
      card: {
        title: "Helper model",
        note: "Sets the model and reasoning effort of the delegated workers; Enter keeps what is marked.",
        choices: rowChoices(helperRows),
      },
    });
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
    const nextLine = createLineReader(rl);
    return await runMenus((question) => menu(nextLine, output, question));
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
    const route = await runMenus((question) => menu(nextLine, output, question), preset);
    output.write(`${renderModelRouteCard(route, { configPath, env })}\n`);
    const answer = await nextLine();
    return { confirmed: !answer.closed, route };
  } finally {
    rl.close();
  }
}

// The same questions and the same last look, drawn as cards (cards.js).
async function pickModelRoute({ ui, env = process.env, configPath, preset = managedRequest() }) {
  let closed = false;
  const route = await runMenus(async ({ card, defaultIndex }) => {
    const index = closed ? null : await ui.pick({ ...card, start: defaultIndex });
    closed = index === null;
    return closed ? defaultIndex : index;
  }, preset);
  if (closed) return { confirmed: false, route };
  const warning = missingCredentialWarning(route, env);
  const confirmed = await ui.review({
    title: "Model route",
    note: "Check the route: Enter installs LitHermes with it.",
    rows: [
      { label: "Provider", value: route.provider },
      { label: "Lead", value: `${route.model} · ${route.effort}` },
      { label: "Helpers", value: helpersLabel(route) },
      { label: "Writes", value: `${configPath} (managed keys only)` },
      ...(warning ? [{ label: "Warning", value: warning, tone: "warn" }] : []),
    ],
    button: "Continue",
    stopNote: "(nothing written yet)",
  });
  return { confirmed: confirmed === true, route };
}

function helpersLabel(route) {
  const sameProvider = route.childProvider === route.provider;
  return `${sameProvider ? "" : `${route.childProvider} / `}${route.childModel} · ${route.childEffort}`;
}

function renderModelRouteCard(route, { configPath, env = process.env } = {}) {
  const warning = missingCredentialWarning(route, env);
  return [
    "╭─ MODEL ROUTE",
    `│ Provider   ${route.provider}`,
    `│ Lead       ${route.model} · ${route.effort}`,
    `│ Helpers    ${helpersLabel(route)}`,
    `│ Writes     ${configPath}  (managed keys only)`,
    ...(warning ? [`│ Warning    ${warning}`] : []),
    "╰─ Enter to continue · Ctrl-C to abort (nothing written yet)",
  ].join("\n");
}

module.exports = {
  missingCredentialWarning,
  pickModelRoute,
  promptModelRoute,
  promptModelRouteSession,
  routeFromConfig,
  renderInstallBanner,
  renderModelRouteCard,
};
