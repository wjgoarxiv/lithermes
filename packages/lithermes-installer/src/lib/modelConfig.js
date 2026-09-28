const fs = require("node:fs");
const path = require("node:path");
const { writeFileAtomic } = require("./files");
const { OPENAI_PROVIDER, RESPONSES_MODE, VERIFIED_CONFIG_VERSION, classifyHostVersion,
  exactHostVersion, parseBoundary, sourceHash } = require("./modelConfigBoundary");
const {
  ASTRA_MODEL,
  MANAGED_PROVIDER_MODELS,
  MODEL_IDS,
  applyManagedRoute,
  customChildTransportReason,
  inspectEffectiveRouteSafety,
  inspectLeadRoute,
  inspectManagedRoute,
  inspectOrdinaryWorkerRoute,
  managedRequest,
  unavailableReviewerRoutes,
  unavailableTuiRouteVisibility,
} = require("./modelRoutePolicy");

// The route every "configured" verdict is measured against: explicit installer
// options win; otherwise the document's own route when it is a catalog route;
// otherwise today's shipped default.
function expectedRoute(options = {}, document = null) {
  const explicit = ["provider", "model", "effort", "childProvider", "childModel", "childEffort"]
    .some((key) => options[key] !== undefined && options[key] !== "");
  if (explicit) return managedRequest(options);
  if (document) {
    try {
      return managedRequest({
        childEffort: document.getIn(["delegation", "reasoning_effort"]),
        childModel: document.getIn(["delegation", "model"]),
        childProvider: document.getIn(["delegation", "provider"]),
        effort: document.getIn(["agent", "reasoning_effort"]),
        model: document.getIn(["model", "default"]),
        provider: document.getIn(["model", "provider"]),
      });
    } catch {
      // not a catalog route; measure against the shipped default
    }
  }
  return managedRequest();
}
const SAFE_CONTEXT_LENGTH = 372000;
const SAFE_COMPRESSION_THRESHOLD = 0.9;
const SAFE_AUTO_COMPACTION_LIMIT = SAFE_CONTEXT_LENGTH * SAFE_COMPRESSION_THRESHOLD;
const LEGACY_CONTEXT_MODELS = new Set([
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
]);
const MANAGED_SAMPLING_KEYS = ["temperature", "top_p", "top_logprobs"];

function hasValue(document, path) {
  return document.getIn(path, true) !== undefined;
}

function isManagedAstraRoute(provider, model) {
  return provider === OPENAI_PROVIDER && model === ASTRA_MODEL;
}

function inspectManagedAstraSampling(document, targetRoute = null, targetWrite = false) {
  const parentProvider = targetWrite ? targetRoute?.provider : document.getIn(["model", "provider"]);
  const parentModel = targetWrite ? targetRoute?.model : document.getIn(["model", "default"]);
  const parentAstra = isManagedAstraRoute(parentProvider, parentModel);
  const configuredChildProvider = targetWrite
    ? targetRoute?.childProvider
    : document.getIn(["delegation", "provider"]) || parentProvider;
  const configuredChildModel = targetWrite
    ? targetRoute?.childModel
    : document.getIn(["delegation", "model"]);
  const childModel = configuredChildModel === undefined || configuredChildModel === null || configuredChildModel === ""
    ? parentModel
    : configuredChildModel;
  const childAstra = isManagedAstraRoute(configuredChildProvider, childModel);
  const childTransport = customChildTransportReason(document);
  const sections = [];
  if (parentAstra) sections.push("model", "agent");
  if (childAstra && !childTransport) sections.push("delegation");
  for (const section of sections) {
    for (const key of MANAGED_SAMPLING_KEYS) {
      if (hasValue(document, [section, key])) {
        const route = section === "delegation" ? "global_child" : "parent";
        return {
          status: "blocked",
          code: "LITHERMES_UNSAFE_MODEL_SAMPLING",
          route,
          observedSource: `${section}.${key}`,
          reason: `managed Astra ${route} route contains unsupported sampling field ${section}.${key}; remove it before selecting Astra`,
        };
      }
    }
  }
  return parentAstra || childAstra
    ? {
      status: "safe",
      reason: "managed Astra route has no temperature, top_p, or top_logprobs field",
      observedSource: "managed Astra model/agent/delegation config fields",
    }
    : {
      status: "not_applicable",
      reason: "no effective managed Astra parent or global-child route",
      observedSource: "model.provider/default and delegation provider/model config",
    };
}

function fallback(reason, classification = { class: "malformed_unknown", originalDispatchId: null }, extra = {}) {
  return {
    action: "fallback",
    backupAllowed: false,
    capabilities: unavailableCapabilities(reason),
    classification,
    fallbackCommand: "hermes model",
    reason,
    text: null,
    ...extra,
  };
}

function capability(status, reason, observedSource, extra = {}) {
  return { status, reason, observedSource, ...extra };
}

function unavailableCapabilities(reason) {
  const observedSource = "Hermes host/config validation";
  return {
    autoCompaction: capability("unavailable", reason, observedSource),
    concurrency: capability("unavailable", reason, observedSource),
    delegationRoute: capability("unavailable", reason, observedSource),
    leadRoute: capability("unavailable", reason, observedSource),
    modelSafety: capability("unavailable", reason, observedSource),
    ordinaryWorkerRoute: capability("unavailable", reason, observedSource),
    recursion: capability("unavailable", reason, observedSource),
    reviewerRoutes: capability("unavailable", reason, observedSource),
    runtime: capability("unavailable", reason, observedSource),
    tuiRouteVisibility: capability("unavailable", reason, observedSource),
  };
}

function formatConcurrencyCapability(concurrency) {
  if (concurrency.status !== "hard") return `${concurrency.status} (${concurrency.reason})`;
  if (concurrency.sharedAsyncCap) {
    return `hard (per batch ${concurrency.limit}; background cap ${concurrency.backgroundCap}; potential children ${concurrency.potentialChildCeiling})`;
  }
  return `hard (per batch ${concurrency.limit}; async batches ${concurrency.asyncBatchLimit}; potential children ${concurrency.potentialChildCeiling})`;
}

function safeOriginalDispatchId(dispatch) {
  if (typeof dispatch !== "string" || !/^[A-Za-z0-9._:/-]{1,128}$/.test(dispatch)) return null;
  return dispatch;
}

function classificationFromDocument(document, fresh) {
  if (fresh) return { class: "fresh", originalDispatchId: null };
  const provider = document.getIn(["model", "provider"]);
  const dispatch = document.getIn(["model", "default"]);
  const originalDispatchId = safeOriginalDispatchId(dispatch);
  if (dispatch === undefined && provider === undefined) {
    return { class: "unconfigured", originalDispatchId };
  }
  if (typeof dispatch !== "string" || (provider !== undefined && typeof provider !== "string")) {
    return { class: "malformed_unknown", originalDispatchId };
  }
  const safety = inspectEffectiveRouteSafety(document, OPENAI_PROVIDER);
  if (safety.status === "blocked") {
    return { class: safety.classificationClass, originalDispatchId };
  }
  if (provider === OPENAI_PROVIDER && (dispatch === "gpt-5.4" || dispatch === "gpt-5.5")) {
    return { class: "managed_legacy", originalDispatchId };
  }
  if (provider === OPENAI_PROVIDER && MODEL_IDS.has(dispatch)) {
    return { class: "existing_managed", originalDispatchId };
  }
  if (MANAGED_PROVIDER_MODELS[provider]?.has(dispatch)) {
    return { class: "existing_managed", originalDispatchId };
  }
  if (/^gpt-5\.6(?:$|-)/.test(dispatch)) {
    return { class: "other_gpt56", originalDispatchId };
  }
  return { class: "custom", originalDispatchId };
}

function classifyModelConfig(text, options = {}) {
  const boundary = parseBoundary(text, options);
  if (boundary.error) {
    const safety = boundary.document
      ? inspectEffectiveRouteSafety(boundary.document, OPENAI_PROVIDER)
      : null;
    if (safety?.status === "blocked") {
      return classificationFromDocument(boundary.document, boundary.fresh);
    }
    return { class: "malformed_unknown", originalDispatchId: null };
  }
  return classificationFromDocument(boundary.document, boundary.fresh);
}

function inspectHermesCapabilities(text, options = {}) {
  const boundary = parseBoundary(text, options);
  if (boundary.error) {
    const capabilities = unavailableCapabilities(boundary.error);
    const safety = boundary.document
      ? inspectEffectiveRouteSafety(boundary.document, OPENAI_PROVIDER)
      : null;
    if (safety?.status === "blocked") capabilities.modelSafety = safety;
    return capabilities;
  }
  const concurrency = boundary.document.getIn(["delegation", "max_concurrent_children"]);
  const asyncBatches = boundary.document.getIn(["delegation", "max_async_children"]);
  const configVersion = boundary.document.get("_config_version");
  const sharedAsyncCap = configVersion >= 33;
  const spawnDepth = boundary.document.getIn(["delegation", "max_spawn_depth"]);
  const orchestratorEnabled = boundary.document.getIn(["delegation", "orchestrator_enabled"]);
  const effectiveAsyncBatches = sharedAsyncCap ? 1 : Number.isInteger(asyncBatches) ? asyncBatches : 3;
  const effectiveSpawnDepth = Number.isInteger(spawnDepth) ? spawnDepth : 1;
  const flatDelegation = effectiveSpawnDepth === 1 || orchestratorEnabled === false;
  const contextLength = boundary.document.getIn(["model", "context_length"]);
  const compressionThreshold = boundary.document.getIn(["compression", "threshold"]);
  const provider = boundary.document.getIn(["model", "provider"]);
  const model = boundary.document.getIn(["model", "default"]);
  let route;
  try {
    route = expectedRoute(options, boundary.document);
  } catch {
    // Keep doctor/reporting total for a parsed but unsupported existing route.
    // The route safety verdict below carries the typed fail-closed result.
    route = managedRequest();
  }
  const routeSafety = inspectEffectiveRouteSafety(boundary.document, OPENAI_PROVIDER);
  const samplingSafety = inspectManagedAstraSampling(boundary.document);
  return {
    autoCompaction: contextLength === SAFE_CONTEXT_LENGTH && compressionThreshold === SAFE_COMPRESSION_THRESHOLD
      ? {
        status: "hard",
        reason: `effective auto-compaction target is ${SAFE_AUTO_COMPACTION_LIMIT} tokens`,
        observedSource: "model.context_length plus compression.threshold",
        limit: SAFE_AUTO_COMPACTION_LIMIT,
      }
      : {
        status: "unavailable",
        reason: "Hermes 0.17.0 exposes ratio-only compression; no exact 650K trigger schema",
        observedSource: "Hermes compression.threshold ratio-only schema",
      },
    concurrency: concurrency === 20
      ? {
        status: "hard",
        reason: sharedAsyncCap
          ? "effective concurrency and background work share the configured cap of 20"
          : "effective synchronous concurrency is configured to 20",
        observedSource: "delegation.max_concurrent_children",
        limit: 20,
        scope: "per-batch",
        ...(sharedAsyncCap
          ? { sharedAsyncCap: true, backgroundCap: 20, potentialChildCeiling: 20 }
          : { asyncBatchLimit: effectiveAsyncBatches, potentialChildCeiling: 20 * effectiveAsyncBatches }),
      }
      : {
        status: "unavailable",
        reason: `effective synchronous concurrency is ${Number.isInteger(concurrency) ? concurrency : "not configured"}, not 20`,
        observedSource: "delegation.max_concurrent_children",
      },
    delegationRoute: inspectManagedRoute(boundary.document, OPENAI_PROVIDER, route),
    leadRoute: inspectLeadRoute(boundary.document, OPENAI_PROVIDER, route),
    modelSafety: samplingSafety.status === "blocked" ? samplingSafety : routeSafety,
    ordinaryWorkerRoute: inspectOrdinaryWorkerRoute(boundary.document, OPENAI_PROVIDER, route),
    recursion: flatDelegation
      ? {
        status: "hard",
        reason: effectiveSpawnDepth === 1
          ? "flat delegation blocks grandchildren at depth 1"
          : "orchestrator kill switch blocks grandchildren despite a higher configured depth",
        observedSource: "delegation.max_spawn_depth plus delegation.orchestrator_enabled",
        limit: effectiveSpawnDepth,
        flatBy: effectiveSpawnDepth === 1 ? "depth" : "orchestrator-kill-switch",
      }
      : {
        status: "unavailable",
        reason: `nested delegation is enabled at max_spawn_depth ${effectiveSpawnDepth}`,
        observedSource: "delegation.max_spawn_depth plus delegation.orchestrator_enabled",
        limit: effectiveSpawnDepth,
      },
    reviewerRoutes: unavailableReviewerRoutes(),
    runtime: provider === OPENAI_PROVIDER && typeof model === "string"
      ? {
        status: "hard",
        reason: "effective provider uses the verified OpenAI OAuth Responses route",
        observedSource: "model.provider plus Hermes runtime provider markers",
        provider: OPENAI_PROVIDER,
        apiMode: RESPONSES_MODE,
      }
      : {
        status: "unavailable",
        reason: "effective model provider is not the verified OpenAI OAuth Responses route",
        observedSource: "model.provider plus Hermes runtime provider markers",
      },
    tuiRouteVisibility: unavailableTuiRouteVisibility(),
  };
}

function planModelConfig(text, options = {}) {
  const route = managedRequest(options);
  const request = {
    ...route,
    hostCapabilities: { ...options.hostCapabilities },
    hostVersion: exactHostVersion(options.hostVersion),
    reconfigure: Boolean(options.reconfigure),
  };
  const boundary = parseBoundary(text, options);
  if (boundary.error && /^malformed model route/.test(boundary.error)) {
    return fallback(boundary.error);
  }
  const safety = boundary.document
    ? inspectEffectiveRouteSafety(boundary.document, OPENAI_PROVIDER)
    : null;
  if (safety?.status === "blocked") {
    return {
      action: "stop",
      backupAllowed: false,
      capabilities: inspectHermesCapabilities(text, options),
      classification: classificationFromDocument(boundary.document, boundary.fresh),
      reason: safety.reason,
      request,
      sourceHash: sourceHash(String(text || "")),
      stop: { code: safety.code, route: safety.route },
      text: boundary.error || safety.redact ? null : String(text || ""),
    };
  }
  if (boundary.error) {
    return fallback(
      boundary.error,
      undefined,
      boundary.credentialKey ? { credentialKey: boundary.credentialKey } : {},
    );
  }
  const classification = classificationFromDocument(boundary.document, boundary.fresh);
  if (classification.class === "malformed_unknown") {
    return fallback("unknown model config schema", classification);
  }
  if (classification.class === "other_gpt56"
    && boundary.document.getIn(["model", "provider"]) === OPENAI_PROVIDER) {
    return fallback("unknown model route", classification);
  }
  const shouldWrite = boundary.fresh || classification.class === "unconfigured" || Boolean(options.reconfigure);
  const samplingSafety = inspectManagedAstraSampling(boundary.document, route, shouldWrite);
  if (samplingSafety.status === "blocked") {
    return {
      action: "stop",
      backupAllowed: false,
      capabilities: inspectHermesCapabilities(text, options),
      classification,
      reason: samplingSafety.reason,
      request,
      sourceHash: sourceHash(String(text || "")),
      stop: { code: samplingSafety.code, route: samplingSafety.route },
      text: String(text || ""),
    };
  }
  const transportReason = customChildTransportReason(boundary.document);
  if (shouldWrite && transportReason) {
    return {
      action: "preserve",
      backupAllowed: false,
      capabilities: inspectHermesCapabilities(text, options),
      classification,
      reason: `${transportReason}; managed child route remains unapplied`,
      request,
      sourceHash: sourceHash(String(text || "")),
      text: String(text || ""),
    };
  }
  if (!shouldWrite) {
    return {
      action: "preserve",
      backupAllowed: false,
      capabilities: inspectHermesCapabilities(text, options),
      classification,
      reason: "existing model settings preserved; pass --reconfigure-model to opt in",
      request,
      sourceHash: sourceHash(String(text || "")),
      text: String(text || ""),
    };
  }
  const document = boundary.document;
  applyManagedRoute(document, route);
  // The verified context/compression defaults apply only to explicit GPT-5.6
  // model resets. GPT-6 model routes have no published evidence for these limits.
  if (options.reconfigure && LEGACY_CONTEXT_MODELS.has(route.model)) {
    document.setIn(["model", "context_length"], SAFE_CONTEXT_LENGTH);
    document.setIn(["compression", "threshold"], SAFE_COMPRESSION_THRESHOLD);
  }
  document.setIn(["delegation", "max_concurrent_children"], 20);
  document.setIn(["delegation", "max_spawn_depth"], 1);
  document.setIn(["delegation", "orchestrator_enabled"], false);
  const plannedText = document.toString({ lineWidth: 0 });
  const beyondVerifiedReasons = [];
  if (classifyHostVersion(options.hostVersion).status === "beyond-verified") {
    beyondVerifiedReasons.push(`Hermes ${request.hostVersion} is beyond the verified matrix; source and runtime markers verified, model schema written`);
  }
  const configVersion = document.get("_config_version");
  if (configVersion > VERIFIED_CONFIG_VERSION) {
    beyondVerifiedReasons.push(`config schema ${configVersion} is beyond the verified ceiling ${VERIFIED_CONFIG_VERSION}`);
  }
  return {
    action: "write",
    backupAllowed: true,
    capabilities: inspectHermesCapabilities(plannedText, { ...options, ...route }),
    classification,
    reason: beyondVerifiedReasons.length
      ? beyondVerifiedReasons.join("; ")
      : `verified Hermes ${request.hostVersion} model schema`,
    request,
    sourceHash: sourceHash(String(text || "")),
    text: plannedText,
  };
}

function revalidateModelConfigPlan(hermesHome, plan) {
  const file = path.join(hermesHome, "config.yaml");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (plan.sourceHash === sourceHash(current)) return { current, ok: true };
  const refreshed = planModelConfig(current, plan.request || {});
  return {
    classification: refreshed.classification,
    current,
    ok: false,
    reason: `host config changed before write; ${refreshed.reason || refreshed.classification.class}`,
  };
}

function applyModelConfigPlan(hermesHome, plan) {
  if (plan.action !== "write") return { backupPath: null, written: false };
  const validation = revalidateModelConfigPlan(hermesHome, plan);
  if (!validation.ok) {
    return { backupPath: null, drifted: true, reason: validation.reason, written: false };
  }
  const file = path.join(hermesHome, "config.yaml");
  const before = validation.current;
  const backupPath = before ? `${file}.lithermes-model.bak` : null;
  fs.mkdirSync(hermesHome, { recursive: true });
  if (backupPath) {
    writeFileAtomic(backupPath, before, "utf8");
    fs.chmodSync(backupPath, 0o600);
  }
  writeFileAtomic(file, plan.text, "utf8");
  fs.chmodSync(file, 0o600);
  return { backupPath, sourceHash: sourceHash(before), written: true };
}

module.exports = {
  applyModelConfigPlan,
  classifyModelConfig,
  formatConcurrencyCapability,
  inspectHermesCapabilities,
  planModelConfig,
  revalidateModelConfigPlan,
};
