const ASTRA_MODEL = "gpt-6-astra";
const GPT6_LEAD_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const ASTRA_EFFORTS = GPT6_LEAD_EFFORTS;
const PARENT_MODEL = ASTRA_MODEL;
const PARENT_EFFORT = "xhigh";
const SOL_MODEL = "gpt-6-sol";
const CHILD_MODEL = "gpt-6-luna";
const LEGACY_SOL_MODEL = "gpt-5.6-sol";
const LEGACY_CHILD_MODEL = "gpt-5.6-luna";
const CHILD_EFFORT = "max";
const GPT6_LUNA_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const LEGACY_LUNA_EFFORTS = new Set(["high", "max"]);
const LUNA_EFFORTS = LEGACY_LUNA_EFFORTS;
const LUNA_MODELS = new Set([CHILD_MODEL, LEGACY_CHILD_MODEL]);
const TERRA_MODEL = "gpt-5.6-terra";
const TERRA_EFFORTS = new Set(["high", "xhigh", "max"]);
const LEGACY_SOL_EFFORTS = new Set(["high", "xhigh"]);
const MODEL_EFFORTS = new Map([
  [ASTRA_MODEL, GPT6_LEAD_EFFORTS],
  [SOL_MODEL, GPT6_LEAD_EFFORTS],
  [CHILD_MODEL, GPT6_LUNA_EFFORTS],
  [LEGACY_SOL_MODEL, LEGACY_SOL_EFFORTS],
  [LEGACY_CHILD_MODEL, LEGACY_LUNA_EFFORTS],
  ["gpt-5.6", new Set(["high"])],
  [TERRA_MODEL, TERRA_EFFORTS],
]);
const CHILD_TRANSPORT_KEYS = ["provider", "base_url", "api_mode"];
const { OPENAI_PROVIDER: OPENAI_PROVIDER_ID } = require("./modelConfigBoundary");
const XAI_PROVIDER_ID = "xai";
// Installer choice catalog (plans/references/installer-choice-contract.md, LitHermes row).
// OpenAI rows follow each model's listed effort set, including selectable legacy
// GPT-5.6 routes. xAI rows use the reasoning-capable models of the Hermes 0.19 catalog
// (hermes_cli/models.py `_XAI_STATIC_FALLBACK`), newest first, with the Hermes
// reasoning_effort vocabulary (hermes_cli/config.py delegation.reasoning_effort).
const ROUTE_CATALOG = {
  [OPENAI_PROVIDER_ID]: {
    credentialEnv: null,
    label: "OpenAI OAuth Responses (Astra + Sol + Luna)",
    rows: [
      ...["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) => ({
        effort,
        model: ASTRA_MODEL,
        note: effort === "ultra"
          ? "deepest Astra reasoning"
          : effort === PARENT_EFFORT
            ? "recommended lead"
            : "Astra Responses effort",
      })),
      ...["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) => ({
        effort,
        model: SOL_MODEL,
        note: effort === PARENT_EFFORT ? "coding lead alternative" : "Sol Responses effort",
      })),
      ...["low", "medium", "high", "xhigh", "max"].map((effort) => ({
        effort,
        model: CHILD_MODEL,
        note: effort === CHILD_EFFORT
          ? "balanced (recommended helper)"
          : effort === "high"
            ? "balanced, lighter effort"
            : "Luna Responses effort",
      })),
      ...["high", "xhigh"].map((effort) => ({
        effort,
        model: LEGACY_SOL_MODEL,
        note: "previous-generation Sol lead route",
      })),
      ...["high", "xhigh", "max"].map((effort) => ({
        effort,
        model: TERRA_MODEL,
        note: "previous-generation Terra route",
      })),
      { effort: CHILD_EFFORT, model: LEGACY_CHILD_MODEL, note: "previous-generation balanced helper" },
      { effort: "high", model: LEGACY_CHILD_MODEL, note: "previous-generation lighter helper" },
      { effort: "high", model: "gpt-5.6", note: "general model" },
    ],
    lead: { effort: PARENT_EFFORT, model: PARENT_MODEL },
    helper: { effort: CHILD_EFFORT, model: CHILD_MODEL },
  },
  [XAI_PROVIDER_ID]: {
    credentialEnv: "XAI_API_KEY",
    label: "xAI Grok",
    rows: [
      { effort: "high", model: "grok-build-0.1", note: "newest coding model (recommended lead)" },
      { effort: "high", model: "grok-4.5", note: "flagship reasoning" },
      { effort: "high", model: "grok-4.3", note: "fast reasoning (recommended helper)" },
      { effort: "high", model: "grok-4.20-0309-reasoning", note: "previous reasoning generation" },
    ],
    lead: { effort: "high", model: "grok-build-0.1" },
    helper: { effort: "high", model: "grok-4.3" },
  },
};
const PROVIDER_IDS = Object.keys(ROUTE_CATALOG);
const MANAGED_PROVIDER_MODELS = Object.fromEntries(
  PROVIDER_IDS.map((id) => [id, new Set(ROUTE_CATALOG[id].rows.map((row) => row.model))]),
);
const MODEL_IDS = new Set([
  ...MANAGED_PROVIDER_MODELS[OPENAI_PROVIDER_ID],
  TERRA_MODEL,
]);
const MANAGED_PROVIDERS = new Set(PROVIDER_IDS);
const UNSAFE_ROUTE_CODE = "LITHERMES_UNSAFE_MODEL_ROUTE";
const REVIEWER_ROUTE_NAME = String.fromCharCode(109, 111, 109, 117, 115);

function inspectEffectiveRouteSafety(document, expectedProvider) {
  const transportReason = customChildTransportReason(document);
  const parentProvider = document.getIn(["model", "provider"]);
  const parentModel = document.getIn(["model", "default"]);
  const parentEffort = document.getIn(["agent", "reasoning_effort"]);
  const childModel = document.getIn(["delegation", "model"]);
  const childEffort = document.getIn(["delegation", "reasoning_effort"]);
  const routes = [
    {
      effort: parentEffort,
      model: parentModel,
      provider: parentProvider,
      route: "parent",
    },
    {
      effort: childEffort === undefined || childEffort === null || childEffort === "" ? parentEffort : childEffort,
      model: childModel === undefined || childModel === null || childModel === "" ? parentModel : childModel,
      provider: document.getIn(["delegation", "provider"]) || parentProvider,
      route: "global_child",
    },
  ];
  const managedRoutes = routes.filter((route) => route.provider === expectedProvider);
  for (const route of managedRoutes) {
    if (transportReason && route.route === "global_child") continue;
    const modelEfforts = MODEL_EFFORTS.get(route.model);
    if (modelEfforts && !modelEfforts.has(route.effort)) {
      const isAstra = route.model === ASTRA_MODEL;
      const isLuna = LUNA_MODELS.has(route.model);
      const isLegacyLunaXhigh = route.model === LEGACY_CHILD_MODEL && route.effort === "xhigh";
      return {
        classificationClass: isAstra
          ? "astra_effort_unsupported"
          : isLegacyLunaXhigh
            ? "conflicting_luna_xhigh"
            : isLuna
              ? "luna_effort_below_high"
              : route.model === TERRA_MODEL
                ? "terra_effort_below_high"
                : "model_effort_unsupported",
        code: UNSAFE_ROUTE_CODE,
        observedSource: `${route.route} model, effort, and provider config`,
        reason: isAstra
          ? `${route.route} Astra effort is unsupported or missing; choose one of: ${[...modelEfforts].join(", ")}`
          : isLegacyLunaXhigh
            ? `${route.route} Luna xhigh is a forbidden pair (legacy Luna runs at high or max)`
            : isLuna
              ? `${route.route} Luna effort is unsupported; choose one of: ${[...modelEfforts].join(", ")}`
              : route.model === TERRA_MODEL
                ? `${route.route} TERRA effort is below high or missing`
                : `${route.route} ${route.model} effort is unsupported or missing; choose one of: ${[...modelEfforts].join(", ")}`,
        route: route.route,
        status: "blocked",
      };
    }
  }
  if (transportReason) {
    return {
      observedSource: "global delegation transport config",
      reason: `${transportReason}; managed child route remains unapplied`,
      status: "not_applicable",
    };
  }
  if (!managedRoutes.length) {
    return {
      observedSource: "model and global delegation provider config",
      reason: "custom provider remains outside the managed OpenAI route policy",
      status: "not_applicable",
    };
  }
  return {
    observedSource: "parent and global delegation model policy",
    reason: "no effective model and effort pair outside the model catalog is configured",
    status: "safe",
  };
}

function catalogFor(provider, role) {
  const catalog = ROUTE_CATALOG[provider];
  if (!catalog) {
    throw new Error(`unknown provider '${provider}' for the ${role} route; choose one of: ${PROVIDER_IDS.join(", ")}`);
  }
  return catalog;
}

function resolveRow(provider, role, model, effort) {
  const catalog = catalogFor(provider, role);
  const preset = role === "lead" ? catalog.lead : catalog.helper;
  if (model === "" || effort === "") {
    throw new Error(`${role} model/effort flags require a value; omit the flag to use the default route`);
  }
  const hasModel = model !== undefined;
  const hasEffort = effort !== undefined;
  const resolvedModel = hasModel ? String(model) : preset.model;
  if (resolvedModel === LEGACY_CHILD_MODEL && hasEffort && effort === "xhigh") {
    throw new Error(`${role} route ${resolvedModel} xhigh is a forbidden pair; legacy Luna runs at high or max`);
  }
  const rowsForModel = catalog.rows.filter((row) => row.model === resolvedModel);
  if (!rowsForModel.length) {
    const known = PROVIDER_IDS.some((id) => ROUTE_CATALOG[id].rows.some((row) => row.model === resolvedModel));
    throw new Error(known
      ? `${role} model ${resolvedModel} is not offered for provider ${provider}`
      : `unknown model '${resolvedModel}' for the ${role} route; choose one of: ${catalog.rows.map((row) => row.model).join(", ")}`);
  }
  // An explicitly selected model keeps that model's cataloged preset effort
  // when no effort flag is supplied. This matters for Astra: its recommended
  // lead row is xhigh, while its catalog is intentionally listed low-first.
  const modelDefault = rowsForModel.find((row) => row.effort === preset.effort)?.effort ?? rowsForModel[0].effort;
  const resolvedEffort = hasEffort ? String(effort) : (hasModel ? modelDefault : preset.effort);
  if (!rowsForModel.some((row) => row.effort === resolvedEffort)) {
    throw new Error(`${role} effort ${resolvedEffort} is not offered for ${resolvedModel}; choose one of: ${rowsForModel.map((row) => row.effort).join(", ")}`);
  }
  return { effort: resolvedEffort, model: resolvedModel };
}

// Resolves installer flags (or prompt answers) to one managed route. Omitted
// fields fall back to today's shipped route: openai Astra xhigh lead + Luna max child.
function managedRequest(options = {}) {
  const provider = options.provider === undefined || options.provider === "" ? OPENAI_PROVIDER_ID : String(options.provider);
  const childProvider = options.childProvider === undefined || options.childProvider === ""
    ? provider
    : String(options.childProvider);
  const lead = resolveRow(provider, "lead", options.model, options.effort);
  const child = resolveRow(childProvider, "child", options.childModel, options.childEffort);
  return {
    childEffort: child.effort,
    childModel: child.model,
    childProvider,
    effort: lead.effort,
    model: lead.model,
    provider,
  };
}

function applyManagedRoute(document, route = managedRequest()) {
  document.setIn(["model", "provider"], route.provider);
  document.setIn(["model", "default"], route.model);
  document.setIn(["agent", "reasoning_effort"], route.effort);
  document.setIn(["delegation", "provider"], route.childProvider);
  document.setIn(["delegation", "model"], route.childModel);
  document.setIn(["delegation", "reasoning_effort"], route.childEffort);
}

function customChildTransportReason(document) {
  const configuredKeys = CHILD_TRANSPORT_KEYS.filter((key) => {
    const value = document.getIn(["delegation", key]);
    if (value === undefined || value === null || value === "") return false;
    return !(key === "provider" && MANAGED_PROVIDERS.has(value));
  });
  return configuredKeys.length
    ? `custom global child transport fields are preserved (${configuredKeys.join(", ")})`
    : null;
}

function inspectManagedRoute(document, expectedProvider, route = managedRequest()) {
  const transportReason = customChildTransportReason(document);
  if (transportReason) {
    return {
      status: "unavailable",
      reason: transportReason,
      observedSource: "global delegation transport config",
    };
  }
  const parentProvider = document.getIn(["model", "provider"]);
  const parentModel = document.getIn(["model", "default"]);
  const parentEffort = document.getIn(["agent", "reasoning_effort"]);
  const childModel = document.getIn(["delegation", "model"]);
  const childEffort = document.getIn(["delegation", "reasoning_effort"]);
  const childProvider = document.getIn(["delegation", "provider"]) || parentProvider;
  const configured = parentProvider === route.provider
    && parentModel === route.model
    && parentEffort === route.effort
    && childProvider === route.childProvider
    && childModel === route.childModel
    && childEffort === route.childEffort;
  const legacyConfigured = parentProvider === expectedProvider
    && parentModel === LEGACY_CHILD_MODEL
    && parentEffort === "max"
    && childModel === LEGACY_CHILD_MODEL
    && LEGACY_LUNA_EFFORTS.has(childEffort);
  if (!configured && !legacyConfigured) {
    return {
      status: "unavailable",
      reason: `exact lead ${route.model} ${route.effort} and global child ${route.childModel} ${route.childEffort} route is not configured`,
      observedSource: "model, agent, and global delegation config",
    };
  }
  return {
    status: "configured",
    reason: "global child route is configured; execution receipt required before claiming it ran",
    observedSource: "model, agent, and global delegation config",
    childEffort,
    childModel,
    childProvider,
    executionProof: "unavailable",
    parentEffort,
    parentModel,
    providerIsInherited: childProvider === parentProvider,
  };
}

function inspectLeadRoute(document, expectedProvider, route = managedRequest()) {
  const configured = document.getIn(["model", "provider"]) === route.provider
    && document.getIn(["model", "default"]) === route.model
    && document.getIn(["agent", "reasoning_effort"]) === route.effort;
  return configured
    ? {
      status: "configured",
      reason: `lead route is configured for the chosen ${route.provider} ${route.model} ${route.effort} surface`,
      observedSource: "model.provider, model.default, and agent.reasoning_effort",
      effort: route.effort,
      model: route.model,
      provider: route.provider,
    }
    : {
      status: "unavailable",
      reason: `chosen lead ${route.model} ${route.effort} route is not configured`,
      observedSource: "model.provider, model.default, and agent.reasoning_effort",
    };
}

function inspectOrdinaryWorkerRoute(document, expectedProvider, route = managedRequest()) {
  const transportReason = customChildTransportReason(document);
  if (transportReason) {
    return {
      status: "unavailable",
      reason: `${transportReason}; managed child route remains unapplied`,
      observedSource: "global delegation transport config",
    };
  }
  const childProvider = document.getIn(["delegation", "provider"]) || document.getIn(["model", "provider"]);
  const configured = childProvider === route.childProvider
    && document.getIn(["delegation", "model"]) === route.childModel
    && document.getIn(["delegation", "reasoning_effort"]) === route.childEffort;
  return configured
    ? {
      status: "configured",
      reason: "ordinary workers use the chosen global child route",
      observedSource: "delegation.provider (or model.provider) and global delegation model/effort config",
      effort: route.childEffort,
      model: route.childModel,
      provider: route.childProvider,
    }
    : {
      status: "unavailable",
      reason: `chosen global child ${route.childModel} ${route.childEffort} route is not configured`,
      observedSource: "model.provider and global delegation model/effort config",
    };
}

// A provider whose credential variable is absent still gets written (Task 6
// brief, decision 2); callers print this warning naming the variable to set.
function missingCredentialWarning(route, env = process.env) {
  const missing = [];
  for (const provider of [route.provider, route.childProvider]) {
    const variable = ROUTE_CATALOG[provider]?.credentialEnv;
    if (variable && !env[variable] && !missing.includes(variable)) missing.push(variable);
  }
  if (!missing.length) return null;
  return `${missing.join(", ")} is not set; export it before starting Hermes (config is still written)`;
}

function unavailableReviewerRoutes() {
  return {
    status: "unavailable",
    reason: `Hermes exposes no per-subagent model override for ${REVIEWER_ROUTE_NAME} or litwork-reviewer`,
    observedSource: "Hermes delegate_task and global delegation config",
  };
}

function unavailableReviewerRouteName() {
  return REVIEWER_ROUTE_NAME;
}

function unavailableTuiRouteVisibility() {
  return {
    status: "unavailable",
    reason: "Hermes exposes no per-subagent model override or TUI route visibility surface",
    observedSource: "Hermes TUI and delegation surfaces",
  };
}

function formatManagedRoute(route) {
  return route.status === "configured"
    ? `configured (${route.childModel}, effort ${route.childEffort}, provider ${route.providerIsInherited ? "inherited" : route.childProvider}; execution receipt required)`
    : `${route.status} (${route.reason})`;
}

module.exports = {
  ASTRA_EFFORTS,
  ASTRA_MODEL,
  CHILD_MODEL,
  GPT6_LEAD_EFFORTS,
  GPT6_LUNA_EFFORTS,
  LEGACY_LUNA_EFFORTS,
  LEGACY_CHILD_MODEL,
  LEGACY_SOL_MODEL,
  LUNA_EFFORTS,
  LUNA_MODELS,
  MANAGED_PROVIDER_MODELS,
  MODEL_IDS,
  OPENAI_PROVIDER_ID,
  SOL_MODEL,
  PROVIDER_IDS,
  ROUTE_CATALOG,
  XAI_PROVIDER_ID,
  applyManagedRoute,
  customChildTransportReason,
  formatManagedRoute,
  inspectEffectiveRouteSafety,
  inspectLeadRoute,
  inspectManagedRoute,
  inspectOrdinaryWorkerRoute,
  managedRequest,
  missingCredentialWarning,
  unavailableReviewerRoutes,
  unavailableReviewerRouteName,
  unavailableTuiRouteVisibility,
};
