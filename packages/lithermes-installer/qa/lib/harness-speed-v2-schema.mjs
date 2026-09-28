const SCHEMA = "litfamily.harness-speed-v2/lithermes/v1";
const PRODUCT = "lithermes";
const UNAVAILABLE = "UNAVAILABLE";
const HASH = /^[0-9a-f]{64}$/;
const EXPECTED = Object.freeze({
  head: "7024ab6823c33a60a6abcc57075ff48ec4874bf7",
  scenario: "aaef5ba778532013248f0b5c0a9f958468786840595e48cb84851ab88bf2b4be",
  sourceArtifact: "cb4758384c95cb06c18a729aea64912966366babb48d486287a13c39e5b8d7f8",
  status: "556d8a3956b780bc399313194c4ab21fa2b81c7bc24528a33f74a5f00e166108",
});
const PHASES = Object.freeze([
  "plugin_registration", "rules_composition", "B0_no_route", "S1_pre_llm_call",
  "bounded_activation", "S2_continuation", "direct_skill_invocation", "compaction_rules",
]);
const GUARDS = Object.freeze([
  "correctness", "banner", "sentinel", "route", "body", "payload", "direct", "compaction",
]);
const USAGE = Object.freeze([
  "input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens",
]);
const LOADER_PROOF = Object.freeze([
  "kind", "observed", "hook", "skill", "body_sha256", "loaded_sha256",
]);
const FORBIDDEN = new Set([
  "prompt", "response", "transcript", "url", "request_id", "session_id", "thread_id",
  "credential", "authorization", "cookie", "api_key",
]);
const MISLEADING_SUCCESS = new Set(["verdict", "result", "claimedsuccess"]);
function fail(message) {
  throw new TypeError(message);
}
function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
}
function scanForbidden(root) {
  const stack = [root];
  const seen = new WeakSet();
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== "object") continue;
    if (seen.has(value)) fail("cyclic input is forbidden");
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN.has(key.toLowerCase()) || MISLEADING_SUCCESS.has(key.toLowerCase().replace(/[_-]/g, ""))) {
        fail(`forbidden field ${key}`);
      }
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }
}

function hash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) fail(`${label} must be a lowercase SHA-256 hash`);
}

function identity(value, arm) {
  object(value, `${arm} identity`);
  const expectedSource = arm === "baseline" ? "T01_FROZEN_REPAIRED" : "V2_CANDIDATE";
  if (value.source !== expectedSource) fail(`${arm} source must be ${expectedSource}`);
  if (value.head_commit !== EXPECTED.head) fail(`${arm} HEAD must match the T01 frozen HEAD`);
  hash(value.artifact_sha256, `${arm} artifact hash`);
  hash(value.status_sha256, `${arm} status hash`);
  hash(value.fixture_sha256, `${arm} fixture hash`);
  if (value.fixture_sha256 !== EXPECTED.scenario) fail(`${arm} fixture hash must match the frozen scenario`);
  if (arm === "baseline") {
    hash(value.source_artifact_sha256, "baseline source artifact hash");
    if (value.source_artifact_sha256 !== EXPECTED.sourceArtifact) {
      fail("baseline source artifact must match the T01 frozen manifest");
    }
    if (value.status_sha256 !== EXPECTED.status) fail("baseline status must match the T01 frozen status");
  } else {
    hash(value.base_source_artifact_sha256, "candidate base source artifact hash");
    hash(value.source_artifact_sha256, "candidate source artifact hash");
    if (value.base_source_artifact_sha256 !== EXPECTED.sourceArtifact) {
      fail("candidate base source artifact must match the T01 frozen manifest");
    }
    if (value.source_artifact_sha256 === EXPECTED.sourceArtifact) {
      fail("candidate source artifact must differ from the T01 frozen source artifact");
    }
  }
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive safe integer`);
}

function validateLever(lever) {
  object(lever, "lever");
  if (lever.kind === "latency") {
    if (!PHASES.includes(lever.selected_phase)) fail("latency lever selected_phase is invalid");
  } else if (lever.kind === "context") {
    positiveInteger(lever.baseline_bytes, "baseline context bytes");
    positiveInteger(lever.candidate_bytes, "candidate context bytes");
    object(lever.loader_proof, "loader proof");
    if (lever.loader_proof.kind !== "HERMES_HOST_NATIVE_PRE_REQUEST" ||
      lever.loader_proof.observed !== true || lever.loader_proof.hook !== "pre_llm_call" ||
      lever.loader_proof.skill !== "lithermes:lit-code") {
      fail("context removal requires observed deterministic Hermes pre-request loader proof");
    }
    if (Object.keys(lever.loader_proof).length !== LOADER_PROOF.length ||
      LOADER_PROOF.some((key) => !Object.hasOwn(lever.loader_proof, key))) {
      fail("loader proof fields must be exact and retain no raw body");
    }
    hash(lever.loader_proof.body_sha256, "loader body hash");
    hash(lever.loader_proof.loaded_sha256, "loader loaded body hash");
    if (lever.loader_proof.loaded_sha256 !== lever.loader_proof.body_sha256) {
      fail("observed Hermes pre_llm_call loaded body hash must equal body_sha256");
    }
  } else {
    fail("lever kind must be latency or context");
  }
}

function validateRecord(record) {
  object(record, "record");
  for (const [value, label, ceiling] of [
    [record.block, "block", 6], [record.order, "order", 2], [record.sample, "sample", 5],
  ]) {
    positiveInteger(value, label);
    if (value > ceiling) fail("record index is outside the V2 bounds");
  }
  if (!PHASES.includes(record.phase)) fail("record phase is invalid");
  if (record.arm !== "baseline" && record.arm !== "candidate") fail("record arm is invalid");
  if (typeof record.duration_ms !== "number" || !Number.isFinite(record.duration_ms) || record.duration_ms <= 0) {
    fail("duration_ms must be finite and positive");
  }
  object(record.guards, "record guards");
  if (Object.keys(record.guards).length !== GUARDS.length) fail("record guards must be exact");
  for (const guard of GUARDS) {
    if (typeof record.guards[guard] !== "boolean") fail(`guard ${guard} must be boolean`);
  }
  if (record.provider_calls !== 0 || record.provider_completions !== 0) {
    fail("provider calls and completions must be zero");
  }
  object(record.provider_usage, "provider usage");
  if (Object.keys(record.provider_usage).length !== USAGE.length) fail("provider usage fields must be exact");
  for (const field of USAGE) {
    if (record.provider_usage[field] !== UNAVAILABLE) fail(`provider usage ${field} must be UNAVAILABLE`);
  }
}

function expectedPosition(index) {
  const phaseIndex = index % PHASES.length;
  const turnIndex = Math.floor(index / PHASES.length);
  const block = Math.floor(turnIndex / 10) + 1;
  const withinBlock = turnIndex % 10;
  const order = Math.floor(withinBlock / 5) + 1;
  const sample = (withinBlock % 5) + 1;
  const arm = block % 2 === 1
    ? ["baseline", "candidate"][order - 1]
    : ["candidate", "baseline"][order - 1];
  return { arm, block, order, phase: PHASES[phaseIndex], sample };
}

function validateRecords(records) {
  const expectedCount = 6 * 2 * 5 * PHASES.length;
  if (!Array.isArray(records) || records.length !== expectedCount) {
    fail("six alternating blocks require five samples per arm per phase");
  }
  const keys = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    validateRecord(record);
    const expected = expectedPosition(index);
    if (record.block !== expected.block || record.order !== expected.order ||
      record.arm !== expected.arm || record.sample !== expected.sample || record.phase !== expected.phase) {
      fail("records must preserve exact serial execution order with alternating AB/BA blocks");
    }
    const key = `${record.block}:${record.arm}:${record.sample}:${record.phase}`;
    if (keys.has(key)) fail(`duplicate sample ${key}`);
    keys.add(key);
  }
  if (keys.size !== expectedCount) fail("five samples per arm per phase are required");
}

export function validateV2Cohort(cohort) {
  object(cohort, "cohort");
  scanForbidden(cohort);
  if (cohort.schema !== SCHEMA || cohort.product !== PRODUCT) fail("V2 cohort identity mismatch");
  if (!Array.isArray(cohort.phases) || cohort.phases.length !== PHASES.length ||
    cohort.phases.some((phase, index) => phase !== PHASES[index])) {
    fail("phases must match the exact LitHermes V2 phase order");
  }
  identity(cohort.baseline, "baseline");
  identity(cohort.candidate, "candidate");
  if (cohort.candidate.artifact_sha256 === cohort.baseline.artifact_sha256) {
    fail("candidate artifact must differ from the baseline built artifact");
  }
  if (cohort.candidate.status_sha256 === cohort.baseline.status_sha256) {
    fail("candidate status must differ from the T01 frozen baseline status");
  }
  validateLever(cohort.lever);
  validateRecords(cohort.records);
}

export const v2Constants = Object.freeze({
  expected: EXPECTED, guards: GUARDS, phases: PHASES, product: PRODUCT,
  schema: SCHEMA, unavailable: UNAVAILABLE, usage: USAGE,
});
