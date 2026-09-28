const {
  assert, datasetPath, expectedDatasetBytes, expectedDatasetHash, fs, os, path, pluginRoot,
  parseJsonStdout, python, readJson, requireFile, test, uiuxRoot, uiuxRuntime,
} = require("./runtime-helpers");
const { validDesignContract } = require("./fixtures");

function validate(input) {
  return python(uiuxRuntime, ["validate-design-contract", "--json"], { input });
}

function validateContract(contract) {
  return validate(JSON.stringify(contract));
}

function mutated(mutate) {
  const contract = validDesignContract();
  mutate(contract);
  return contract;
}

function betaDesignContract(overrides = {}) {
  return {
    ...validDesignContract(),
    schema_id: "litfamily.design-contract/v1beta1",
    lane: "brownfield",
    tokens: [{ id: "token:action", category: "color", value: "accent-600", usage: "primary action" }],
    component_behaviors: [{
      component_id: "component:field-group",
      state_ids: ["state:apply-loading", "state:apply-error"],
      interaction_ids: ["interaction:submit-application"],
      keyboard_behavior: "Enter submits the focused application",
    }],
    responsive_transformations: [{
      route_id: "route:apply",
      viewport_id: "viewport:compact",
      behavior: "Field groups stack in source order",
    }],
    motion: {
      policy: "functional",
      reduced_motion_behavior: "State changes without translation",
      transitions: [{
        id: "transition:submit",
        interaction_id: "interaction:submit-application",
        duration_ms: 160,
        easing: "ease-out",
      }],
    },
    acceptance_criteria: [{
      id: "criterion:submit",
      observable: "Keyboard submission shows a receipt id",
      verification: "browser",
      required: true,
      inventory_ids: ["component:field-group", "interaction:submit-application", "state:apply-loading"],
    }],
    ...overrides,
  };
}

function beta2DesignContract(overrides = {}) {
  return betaDesignContract({
    schema_id: "litfamily.design-contract/v1beta2",
    ...overrides,
  });
}

test("uiux.characterization-current-registration", () => {
  const init = fs.readFileSync(path.join(pluginRoot, "__init__.py"), "utf8");
  const payload = readJson(path.join(pluginRoot, "payload-version.json"));
  assert.match(init, /"frontend-ui-ux"/);
  assert.match(init, /"visual-qa"/);
  for (const relative of [
    "skills/frontend-ui-ux/SKILL.md",
    "skills/frontend-ui-ux/scripts/import_design_intelligence.py",
    "skills/visual-qa/SKILL.md",
    "skills/visual-qa/scripts/png_runtime.py",
    "skills/visual-qa/scripts/tui_runtime.py",
    "skills/visual-qa/scripts/visual_qa.py",
  ]) {
    assert.ok(payload.files.some((entry) => entry.path === relative), `current payload missing ${relative}`);
  }
});

test("uiux.design-contract-v1alpha1", () => {
  requireFile(uiuxRuntime, "missing Design Contract validator runtime");
  const valid = validateContract(validDesignContract());
  const output = parseJsonStdout(valid, "Design Contract validation");
  assert.equal(valid.status, 1, "alpha is parseable diagnostics, not completion success");
  assert.equal(output.schema, "litfamily.design-contract/v1alpha1");
  assert.equal(output.valid, true);
  assert.deepEqual(output.issues, []);

  // The contract carries no corpus identity: source_hash and per-reference sha256 are
  // the only hashes, and a dataset group is now an unapproved key.
  const contract = validDesignContract();
  assert.equal("dataset" in contract, false, "the Design Contract must stay dataset-free");
  assert.equal(typeof contract.source_hash, "string");
  assert.equal(typeof contract.inventory.references[0].sha256, "string");
  const withDataset = validateContract(mutated((candidate) => {
    candidate.dataset = { schema_version: "litfamily.design-intelligence/v1", sha256: expectedDatasetHash };
  }));
  assert.equal(withDataset.status, 1, withDataset.stdout);
  assert.match(parseJsonStdout(withDataset, "dataset group").issues.join("\n"), /unapproved keys.*dataset/);

  assert.deepEqual(Object.keys(contract).sort(), [
    "accepted_exceptions", "accessibility", "contract_id", "direction", "evidence_policy",
    "intent", "inventory", "localization", "omissions", "performance", "schema_id", "source_hash",
  ]);
});

test("uiux.design-contract-v1beta1 validates executable fields and marks alpha legacy", () => {
  const schemaPath = path.join(uiuxRoot, "schemas", "design-contract-v1beta1.schema.json");
  const schema = readJson(schemaPath);
  assert.equal(schema.$id, "litfamily.design-contract/v1beta1");
  for (const field of ["lane", "tokens", "component_behaviors", "responsive_transformations", "motion", "acceptance_criteria"]) {
    assert.ok(schema.required.includes(field), `beta schema must require ${field}`);
  }

  const accepted = validateContract(betaDesignContract());
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.deepEqual(parseJsonStdout(accepted, "beta Design Contract"), {
    diagnostics: [], evidence_eligible: true, issues: [], schema: "litfamily.design-contract/v1beta1", valid: true,
  });

  const dangling = betaDesignContract();
  dangling.component_behaviors[0].component_id = "component:missing";
  const rejected = validateContract(dangling);
  assert.equal(rejected.status, 1);
  assert.match(parseJsonStdout(rejected, "dangling beta contract").issues.join("\n"), /component:missing.*declared component/i);

  const alpha = validateContract(validDesignContract());
  assert.equal(alpha.status, 1, "alpha remains parseable but cannot signal completion success");
  assert.deepEqual(parseJsonStdout(alpha, "legacy alpha contract"), {
    diagnostics: ["LEGACY_SCHEMA_V1ALPHA1"],
    evidence_eligible: false,
    issues: [],
    schema: "litfamily.design-contract/v1alpha1",
    valid: true,
  });
});

test("uiux.design-contract-rule-coverage", () => {
  const emptyDisclosures = mutated((contract) => {
    contract.omissions = [];
    contract.accepted_exceptions = [];
  });
  const accepted = validateContract(emptyDisclosures);
  assert.equal(accepted.status, 1, accepted.stdout + accepted.stderr);

  for (const [label, mutate, expected] of [
    // Cardinality gates.
    ["no routes", (c) => { c.inventory.routes = []; }, /inventory\.routes must list at least 1/],
    ["no primary route", (c) => { c.inventory.routes[0].priority = "secondary"; }, /at least one route as 'primary'/],
    ["no regions", (c) => { c.inventory.regions = []; }, /inventory\.regions must list at least 1/],
    ["no components", (c) => { c.inventory.components = []; }, /inventory\.components must list at least 1/],
    ["no interactions", (c) => { c.inventory.interactions = []; }, /inventory\.interactions must list at least 1/],
    ["no critical interaction", (c) => { c.inventory.interactions[0].criticality = "supporting"; }, /at least one interaction as 'critical'/],
    ["states not an array", (c) => { c.inventory.states = {}; }, /inventory\.states must be an array/],
    ["viewports not an array", (c) => { c.inventory.viewports = {}; }, /inventory\.viewports must be an array/],
    ["references not an array", (c) => { c.inventory.references = {}; }, /inventory\.references must be an array/],

    // Typed id prefixes and the id grammar.
    ["untyped contract id", (c) => { c.contract_id = "public-service-form"; }, /contract_id must match the id grammar/],
    ["wrong contract prefix", (c) => { c.contract_id = "route:apply"; }, /contract_id must carry the 'contract:' type prefix/],
    ["wrong route prefix", (c) => { c.inventory.routes[0].id = "screen:apply"; }, /must carry the 'route:' type prefix/],
    ["wrong region prefix", (c) => { c.inventory.regions[0].id = "route:apply-form"; }, /must carry the 'region:' type prefix/],
    ["wrong component prefix", (c) => { c.inventory.components[0].id = "widget:field-group"; }, /must carry the 'component:' type prefix/],
    ["wrong interaction prefix", (c) => { c.inventory.interactions[0].id = "gesture:submit"; }, /must carry the 'interaction:' type prefix/],
    ["wrong state prefix", (c) => { c.inventory.states[0].id = "phase:loading"; }, /must carry the 'state:' type prefix/],
    ["wrong viewport prefix", (c) => { c.inventory.viewports[0].id = "breakpoint:compact"; }, /must carry the 'viewport:' type prefix/],
    ["wrong reference prefix", (c) => { c.inventory.references[0].id = "asset:paper-form"; }, /must carry the 'reference:' type prefix/],
    ["uppercase id", (c) => { c.inventory.routes[0].id = "route:Apply"; }, /must match the id grammar/],
    ["id with a space", (c) => { c.inventory.routes[0].id = "route:apply form"; }, /must match the id grammar/],

    // Hash grammar.
    ["uppercase source hash", (c) => { c.source_hash = "A".repeat(64); }, /source_hash must be a lowercase 64-character sha256/],
    ["short source hash", (c) => { c.source_hash = "abc"; }, /source_hash must be a lowercase 64-character sha256/],
    ["hash with a trailing newline", (c) => { c.source_hash = `${"a".repeat(64)}\n`; }, /source_hash must be a lowercase 64-character sha256/],
    ["bad reference hash", (c) => { c.inventory.references[0].sha256 = "G".repeat(64); }, /references\[0\]\.sha256 must be a lowercase 64-character sha256/],

    // Referential integrity.
    ["dangling region route", (c) => { c.inventory.regions[0].route_id = "route:missing"; }, /regions\[0\]\.route_id does not resolve to a declared route/],
    ["dangling component region", (c) => { c.inventory.components[0].region_id = "region:missing"; }, /components\[0\]\.region_id does not resolve to a declared region/],
    ["dangling interaction route", (c) => { c.inventory.interactions[0].route_id = "route:missing"; }, /interactions\[0\]\.route_id does not resolve to a declared route/],
    ["dangling state route", (c) => { c.inventory.states[0].route_id = "route:missing"; }, /states\[0\]\.route_id does not resolve to a declared route/],
    ["dangling authenticated surface", (c) => { c.inventory.authenticated_surfaces[0].route_id = "route:missing"; }, /authenticated_surfaces\[0\]\.route_id does not resolve to a declared route/],
    ["repeated authenticated surface", (c) => {
      c.inventory.authenticated_surfaces.push({ route_id: "route:status", safe_test_account: true });
    }, /repeats a surface already declared/],

    // Auth safety coupling.
    ["authenticated route with no surface", (c) => { c.inventory.authenticated_surfaces = []; }, /route:status sets auth_required but no authenticated surface covers it/],
    ["public route with a surface", (c) => { c.inventory.routes[1].auth_required = false; }, /route:status is public but an authenticated surface claims it/],
    ["unsafe test account", (c) => { c.inventory.authenticated_surfaces[0].safe_test_account = false; }, /safe_test_account must be exactly true/],
    ["truthy test account", (c) => { c.inventory.authenticated_surfaces[0].safe_test_account = "yes"; }, /safe_test_account must be exactly true/],

    // Document-wide id uniqueness.
    ["id reused across groups", (c) => { c.omissions[0].id = c.contract_id; }, /ids must be unique across the whole contract/],
    ["id reused inside a group", (c) => { c.inventory.viewports[1].id = c.inventory.viewports[0].id; }, /ids must be unique across the whole contract/],
    ["disclosure id reused", (c) => { c.omissions[0].id = c.accepted_exceptions[0].id; }, /ids must be unique across the whole contract/],

    // Closed enums.
    ["unknown state kind", (c) => { c.inventory.states[0].kind = "pending"; }, /states\[0\]\.kind must be one of/],
    ["unknown input mode", (c) => { c.inventory.interactions[0].input_modes = ["gaze"]; }, /input_modes has unapproved modes/],
    ["unknown viewport category", (c) => { c.inventory.viewports[0].category = "wide"; }, /viewports\[0\]\.category must be one of/],
    ["unknown reference kind", (c) => { c.inventory.references[0].kind = "scraped"; }, /references\[0\]\.kind must be one of/],
    ["unknown token strategy", (c) => { c.direction.token_strategy = "invent"; }, /direction\.token_strategy must be one of/],
    ["unknown evidence channel", (c) => { c.evidence_policy.required_channels = ["vibes"]; }, /required_channels has unapproved channels/],

    // Intent, direction, accessibility, localization, performance, evidence policy.
    ["empty audiences", (c) => { c.intent.audiences = []; }, /intent\.audiences must list at least 1/],
    ["duplicate qualities", (c) => { c.intent.qualities = ["legible", "legible"]; }, /intent\.qualities entries must be unique/],
    ["blank task", (c) => { c.intent.tasks = ["  "]; }, /intent\.tasks\[0\] must be a non-empty string/],
    ["two principles", (c) => { c.direction.principles = ["a", "b"]; }, /direction\.principles must list at least 3/],
    ["eight principles", (c) => { c.direction.principles = ["a", "b", "c", "d", "e", "f", "g", "h"]; }, /direction\.principles must list at most 7/],
    ["downgraded accessibility target", (c) => { c.accessibility.target = "WCAG 2.1 AA"; }, /accessibility\.target must equal 'WCAG 2\.2 AA'/],
    ["accessibility target as a pattern match", (c) => { c.accessibility.target = "WCAG 2.2 AAA"; }, /accessibility\.target must equal 'WCAG 2\.2 AA'/],
    ["non-boolean keyboard flag", (c) => { c.accessibility.keyboard = 1; }, /accessibility\.keyboard must be a JSON boolean/],
    ["string boolean flag", (c) => { c.localization.ime_review = "true"; }, /localization\.ime_review must be a JSON boolean/],
    ["zoom below the floor", (c) => { c.accessibility.zoom_percent = 100; }, /accessibility\.zoom_percent must be an integer in 200\.\.400/],
    ["boolean zoom", (c) => { c.accessibility.zoom_percent = true; }, /accessibility\.zoom_percent must be an integer in 200\.\.400/],
    ["no locales", (c) => { c.localization.locales = []; }, /localization\.locales must list at least 1/],
    ["text expansion over the ceiling", (c) => { c.localization.text_expansion_percent = 301; }, /text_expansion_percent must be an integer in 0\.\.300/],
    ["zero lcp budget", (c) => { c.performance.lcp_ms = 0; }, /performance\.lcp_ms must be an integer in 1\.\.60000/],
    ["cls above 1", (c) => { c.performance.cls = 1.5; }, /performance\.cls must be a number in 0\.\.1/],
    ["boolean cls", (c) => { c.performance.cls = true; }, /performance\.cls must be a number in 0\.\.1/],
    ["unbounded js budget", (c) => { c.performance.initial_js_kb = 1048577; }, /initial_js_kb must be an integer in 0\.\.1048576/],
    ["empty evidence channels", (c) => { c.evidence_policy.required_channels = []; }, /required_channels must list at least 1/],
    ["duplicate evidence channels", (c) => { c.evidence_policy.required_channels = ["tests", "tests"]; }, /required_channels entries must be unique/],

    // Disclosures and timestamps.
    ["omission without an owner", (c) => { delete c.omissions[0].owner; }, /omissions\[0\] is missing \['owner'\]/],
    ["exception without a reason", (c) => { delete c.accepted_exceptions[0].reason; }, /accepted_exceptions\[0\] is missing \['reason'\]/],
    ["prose expiry", (c) => { c.accepted_exceptions[0].expires_at = "tomorrow"; }, /expires_at must be an ISO-8601 UTC instant/],
    ["offset expiry", (c) => { c.accepted_exceptions[0].expires_at = "2026-08-24T00:00:00+00:00"; }, /expires_at must be an ISO-8601 UTC instant/],
    ["microsecond expiry", (c) => { c.accepted_exceptions[0].expires_at = "2026-08-24T00:00:00.123456Z"; }, /expires_at must be an ISO-8601 UTC instant/],
    ["lowercase z expiry", (c) => { c.accepted_exceptions[0].expires_at = "2026-08-24T00:00:00z"; }, /expires_at must round-trip exactly/],
    ["single-digit month expiry", (c) => { c.accepted_exceptions[0].expires_at = "2026-8-24T00:00:00Z"; }, /expires_at must round-trip exactly/],
    ["impossible calendar date", (c) => { c.accepted_exceptions[0].expires_at = "2026-02-30T00:00:00Z"; }, /expires_at must be an ISO-8601 UTC instant/],

    // Root shape.
    ["unknown top-level field", (c) => { c.unapproved = true; }, /contract has unapproved keys \['unapproved'\]/],
    ["missing evidence policy", (c) => { delete c.evidence_policy; }, /contract is missing \['evidence_policy'\]/],
    ["wrong schema id", (c) => { c.schema_id = "litfamily.design-contract/v1"; }, /schema_id must equal 'litfamily\.design-contract\/v1alpha1'/],
  ]) {
    const result = validateContract(mutated(mutate));
    const envelope = parseJsonStdout(result, label);
    assert.equal(result.status, 1, `${label} must exit 1 with a populated envelope:\n${result.stdout}`);
    assert.equal(envelope.valid, false, label);
    assert.ok(envelope.issues.length > 0, `${label} must report at least one issue`);
    assert.match(envelope.issues.join("\n"), expected, `${label} reported: ${envelope.issues.join(" | ")}`);
  }
});

test("uiux.design-contract-untrusted-input-exits-2", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-design-contract."));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const canonical = JSON.stringify(validDesignContract());

  for (const [label, input, expected] of [
    ["duplicate top-level key", canonical.replace('"contract_id"', '"source_hash":"' + "b".repeat(64) + '","contract_id"'), /duplicate object key: source_hash/],
    ["duplicate nested key", canonical.replace('"path":"/apply"', '"path":"/apply","path":"/other"'), /duplicate object key: path/],
    ["NUL byte", `${canonical}${"\u0000"}`, /NUL byte/],
    ["raw control character in a string", canonical.replace('"/apply"', `"/ap${"\u0001"}ply"`), /raw control character/],
    ["trailing data", `${canonical}{}`, /trailing data/],
    ["malformed JSON", '{"schema_id":', /truncated JSON value/],
    ["empty input", "", /truncated JSON value/],
  ]) {
    const result = validate(input);
    assert.equal(result.status, 2, `${label} must exit 2:\n${result.stdout}${result.stderr}`);
    assert.doesNotMatch(result.stdout, /\S/, `${label} must keep stdout empty when the input is untrusted`);
    assert.match(result.stderr, expected, `${label} stderr was: ${result.stderr}`);
  }

  // A key repeated at a different depth is legal: the scan uses a fresh key set per
  // object, so "id" inside a route and inside a region never collide.
  const sameKeyDifferentDepth = validate(canonical);
  assert.equal(sameKeyDifferentDepth.status, 1, sameKeyDifferentDepth.stdout + sameKeyDifferentDepth.stderr);

  const oversize = validate(`${" ".repeat(1024 * 1024)}${canonical}`);
  assert.equal(oversize.status, 2, oversize.stdout + oversize.stderr);
  assert.match(oversize.stderr, /exceeds the 1048576-byte cap/);

  const nonUtf8 = python(uiuxRuntime, ["validate-design-contract", "--json"], {
    input: Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d]).toString("latin1"),
  });
  assert.equal(nonUtf8.status, 2, nonUtf8.stdout + nonUtf8.stderr);

  const directory = python(uiuxRuntime, ["validate-design-contract", "--contract", fixtureRoot]);
  assert.equal(directory.status, 2, directory.stdout + directory.stderr);
  assert.match(directory.stderr, /not a regular file/);

  const symlink = path.join(fixtureRoot, "contract-link.json");
  const target = path.join(fixtureRoot, "contract.json");
  fs.writeFileSync(target, canonical, "utf8");
  fs.symlinkSync(target, symlink);
  const linked = python(uiuxRuntime, ["validate-design-contract", "--contract", symlink]);
  assert.equal(linked.status, 2, linked.stdout + linked.stderr);
  assert.match(linked.stderr, /not a regular file/);

  const fromFile = python(uiuxRuntime, ["validate-design-contract", "--contract", target]);
  assert.equal(fromFile.status, 1, fromFile.stdout + fromFile.stderr);
});

test("uiux.design-contract-canonical-form", () => {
  const contract = betaDesignContract();
  const canonical = python(uiuxRuntime, ["canonical-design-contract"], {
    input: JSON.stringify(contract),
  });
  assert.equal(canonical.status, 0, canonical.stdout + canonical.stderr);
  assert.equal(canonical.stdout.endsWith("\n"), true, "canonical text must end with a newline");
  assert.equal(canonical.stdout.slice(0, -1).includes("\n"), false, "canonical text must be one line");

  const body = canonical.stdout.slice(0, -1);
  assert.deepEqual(Object.keys(JSON.parse(body)), Object.keys(contract).sort());
  assert.deepEqual(
    JSON.parse(body).inventory.routes.map((route) => route.id),
    contract.inventory.routes.map((route) => route.id),
    "array order must survive canonicalisation",
  );

  // Key order in the input cannot change the canonical bytes, which is what makes the
  // digest stable; the trailing newline is part of that digest.
  const reordered = Object.fromEntries(Object.keys(contract).reverse().map((key) => [key, contract[key]]));
  const again = python(uiuxRuntime, ["canonical-design-contract"], { input: JSON.stringify(reordered) });
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(again.stdout, canonical.stdout);

  const invalid = python(uiuxRuntime, ["canonical-design-contract"], {
    input: JSON.stringify(mutated((candidate) => { candidate.source_hash = "nope"; })),
  });
  assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
  assert.doesNotMatch(invalid.stdout, /\S/, "an invalid contract must not yield canonical text");
  assert.match(invalid.stderr, /canonical text withheld/);

  const alpha = python(uiuxRuntime, ["canonical-design-contract"], {
    input: JSON.stringify(validDesignContract()),
  });
  assert.equal(alpha.status, 1, "alpha cannot exit-success from a completion-oriented route");
  assert.doesNotMatch(alpha.stdout, /\S/);
  assert.match(alpha.stderr, /v1alpha1.*diagnostic/i);
});

test("uiux.design-contract-v1beta2-is-canonical-compatible", () => {
  const contract = beta2DesignContract({
    taste: { variance: 7, motion: 4, density: 6 },
  });
  const canonical = python(uiuxRuntime, ["canonical-design-contract"], {
    input: JSON.stringify(contract),
  });
  assert.equal(canonical.status, 0, canonical.stdout + canonical.stderr);
  assert.equal(JSON.parse(canonical.stdout).schema_id, "litfamily.design-contract/v1beta2");

  const beta1 = python(uiuxRuntime, ["canonical-design-contract"], {
    input: JSON.stringify(betaDesignContract()),
  });
  assert.equal(beta1.status, 0, beta1.stdout + beta1.stderr);
});

test("uiux.design-contract-schema-mirrors-the-runtime", () => {
  const schema = readJson(path.join(uiuxRoot, "schemas", "design-contract-v1alpha1.schema.json"));
  assert.equal(schema.$id, "litfamily.design-contract/v1alpha1");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required.slice().sort(), Object.keys(validDesignContract()).sort());
  assert.equal(schema.required.length, 12);
  assert.equal("dataset" in schema.properties, false, "the schema must stay dataset-free");
  assert.equal(schema.properties.omissions.minItems, undefined);
  assert.equal(schema.properties.accepted_exceptions.minItems, undefined);
  assert.equal(schema.$defs.nonemptyStrings.uniqueItems, true);
  assert.equal(schema.$defs.state.properties.kind.enum.length, 8);
  assert.ok(schema.$defs.state.properties.kind.enum.includes("ready"));
  assert.equal(schema.$defs.authenticatedSurface.properties.safe_test_account.const, true);
  assert.deepEqual(schema.$defs.inventory.required, [
    "routes", "regions", "components", "interactions", "states", "viewports",
    "references", "authenticated_surfaces",
  ]);

  // Every object level closes itself, so an unapproved key can never ride along.
  const openObjects = [];
  (function walk(node, pointer) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${pointer}/${index}`));
      return;
    }
    if (node.type === "object" && node.additionalProperties !== false) openObjects.push(pointer);
    for (const [key, value] of Object.entries(node)) walk(value, `${pointer}/${key}`);
  })(schema, "#");
  assert.deepEqual(openObjects, [], `these object levels accept unapproved keys: ${openObjects.join(", ")}`);
});

test("uiux.package-assets", () => {
  const required = [
    path.join(uiuxRoot, "SKILL.md"),
    datasetPath,
    path.join(uiuxRoot, "resources", "LICENSE"),
    path.join(uiuxRoot, "resources", "PROVENANCE.json"),
    path.join(uiuxRoot, "resources", "import-manifest.json"),
    path.join(uiuxRoot, "resources", "THIRD-PARTY-NOTICE.txt"),
    path.join(uiuxRoot, "schemas", "design-contract-v1alpha1.schema.json"),
    uiuxRuntime,
  ];
  for (const file of required) requireFile(file, "missing UI/UX package companion");

  const provenance = readJson(path.join(uiuxRoot, "resources", "PROVENANCE.json"));
  assert.equal(provenance.canonical_dataset.record_count, 2277);
  assert.equal(provenance.canonical_dataset.byte_count, expectedDatasetBytes);
  assert.equal(provenance.canonical_dataset.sha256, expectedDatasetHash);
  assert.equal(provenance.source.commit, "1307d97a72e6c1cda572cb65471ae5ce82995218");
  assert.equal(provenance.source.license_sha256, "738f69dfa83db5c347c678fb9d90e560877059f0de93a327c39001bff92dc014");
  const importManifest = readJson(path.join(uiuxRoot, "resources", "import-manifest.json"));
  assert.equal(importManifest.sources.length, 34);
  assert.equal(new Set(importManifest.sources.map((entry) => entry.path)).size, 34);

  const payload = readJson(path.join(pluginRoot, "payload-version.json"));
  for (const file of required.slice(1)) {
    const relative = path.relative(pluginRoot, file).replaceAll(path.sep, "/");
    assert.ok(payload.files.some((entry) => entry.path === relative), `payload-version missing ${relative}`);
  }
});
