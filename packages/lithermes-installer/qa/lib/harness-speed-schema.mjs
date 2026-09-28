import {
  failContract as fail,
  harnessSpeedScenarioId,
  validateScenario,
} from "./harness-speed-scenario.mjs";

const COHORT_SCHEMA = "litfamily.harness-speed/v1";
const PRODUCT = "lithermes";
const ARMS = ["baseline", "candidate", "control"];
const PHASES = ["B0", "S1", "S2"];
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const FORBIDDEN_FIELDS = new Set([
  "prompt", "response", "transcript", "url", "request_id", "thread_id",
  "session_id", "credential", "authorization", "cookie", "api_key",
]);
const REQUIRED_FIELDS = [
  "schema", "scenario_id", "product", "arm", "block", "order", "sequence",
  "phase", "prompt_bytes", "prompt_sha256", "response_bytes", "response_sha256",
  "sentinel_match", "route_observed", "output_policy_match", "correct",
  "failure_code", "timed_out", "start_offset_ms", "first_content_offset_ms",
  "final_receipt_offset_ms", "exit_offset_ms", "input_tokens", "cache_read_tokens",
  "cache_write_tokens", "output_tokens",
];
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_COUNTER", `${label} must be a nonnegative safe integer`);
}

function assertCounter(value, label) {
  if (value === "UNAVAILABLE") return;
  assertSafeInteger(value, label);
}

function assertOffset(value, label, unavailable = false) {
  if (unavailable && value === "UNAVAILABLE") return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail("INVALID_TIME", `${label} must be finite and nonnegative${unavailable ? " or UNAVAILABLE" : ""}`);
  }
}

function scanForbiddenFields(root) {
  const stack = [root];
  const seen = new WeakSet();
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== "object") continue;
    if (seen.has(value)) fail("MALFORMED_INPUT", "cyclic cohort input is forbidden");
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.has(key.toLowerCase())) fail("PRIVACY_FIELD", `forbidden field ${key}`);
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }
}

function validateRecord(record, phaseMap) {
  if (!isObject(record)) fail("MALFORMED_RECORD", "cohort record must be an object");
  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(record, field)) fail("MISSING_FIELD", `missing required field ${field}`);
  }
  if (record.schema !== COHORT_SCHEMA || record.scenario_id !== harnessSpeedScenarioId || record.product !== PRODUCT) {
    fail("RECORD_IDENTITY", `record ${record.sequence ?? "unknown"} identity mismatch`);
  }
  if (!ARMS.includes(record.arm)) fail("INVALID_ARM", `record ${record.sequence} arm mismatch`);
  if (!PHASES.includes(record.phase)) fail("INVALID_PHASE", `record ${record.sequence} phase mismatch`);
  for (const [value, label, ceiling] of [
    [record.block, "block", 6], [record.order, "order", 3], [record.sequence, "sequence", 54],
  ]) {
    assertSafeInteger(value, label);
    if (value < 1 || value > ceiling) fail("INVALID_INDEX", `${label} is outside its exact range`);
  }
  const phase = phaseMap.get(record.phase);
  if (record.prompt_bytes !== phase.prompt_bytes || record.prompt_sha256 !== phase.prompt_sha256) {
    fail("PROMPT_IDENTITY", `record ${record.sequence} prompt identity mismatch`);
  }
  assertSafeInteger(record.response_bytes, "response_bytes");
  if (record.response_bytes !== phase.sentinel_bytes || record.response_sha256 !== phase.sentinel_sha256) {
    fail("RESPONSE_IDENTITY", `record ${record.sequence} response identity mismatch`);
  }
  for (const field of ["sentinel_match", "route_observed", "output_policy_match", "correct", "timed_out"]) {
    if (typeof record[field] !== "boolean") fail("INVALID_BOOLEAN", `record ${record.sequence} ${field} must be boolean`);
  }
  if (record.failure_code !== null &&
    (typeof record.failure_code !== "string" || !FAILURE_CODE.test(record.failure_code))) {
    fail("INVALID_FAILURE_CODE", "failure_code must be null or a bounded uppercase identifier");
  }
  const successfulSignals = record.sentinel_match && record.route_observed &&
    record.output_policy_match && record.timed_out === false;
  if (!successfulSignals && record.failure_code === null) {
    fail("MISSING_FAILURE_CODE", "unsuccessful row requires a bounded uppercase failure_code");
  }
  const correct = successfulSignals && record.failure_code === null;
  if (record.correct !== correct) fail("CORRECTNESS_MISMATCH", `record ${record.sequence} correctness fields disagree`);
  assertOffset(record.start_offset_ms, "start_offset_ms");
  assertOffset(record.first_content_offset_ms, "first_content_offset_ms", true);
  assertOffset(record.final_receipt_offset_ms, "final_receipt_offset_ms");
  assertOffset(record.exit_offset_ms, "exit_offset_ms");
  const firstOk = record.first_content_offset_ms === "UNAVAILABLE" ||
    (record.start_offset_ms <= record.first_content_offset_ms && record.first_content_offset_ms <= record.final_receipt_offset_ms);
  if (!firstOk || record.start_offset_ms > record.final_receipt_offset_ms || record.final_receipt_offset_ms > record.exit_offset_ms) {
    fail("NON_MONOTONIC_TIME", `record ${record.sequence} offsets are not monotonic`);
  }
  for (const field of ["input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens"]) {
    assertCounter(record[field], field);
  }
  if (typeof record.input_tokens === "number" && typeof record.cache_read_tokens === "number" &&
    record.cache_read_tokens > record.input_tokens) {
    fail("INCOMPATIBLE_COUNTERS", `record ${record.sequence} cache_read_tokens exceeds input_tokens`);
  }
}

export function validateCohort(scenario, cohort) {
  const phaseMap = validateScenario(scenario);
  if (!isObject(cohort)) fail("MALFORMED_INPUT", "cohort must be an object");
  scanForbiddenFields(cohort);
  if (cohort.schema !== COHORT_SCHEMA) fail("COHORT_SCHEMA", "cohort schema mismatch");
  if (cohort.scenario_id !== harnessSpeedScenarioId) fail("COHORT_SCENARIO", "cohort scenario_id mismatch");
  if (cohort.product !== PRODUCT) fail("COHORT_PRODUCT", "cohort product mismatch");
  if (!Array.isArray(cohort.records) || cohort.records.length !== 54) {
    fail("COHORT_SIZE", "cohort must contain exactly 54 records");
  }
  const sequences = new Set();
  const turns = new Set();
  for (const record of cohort.records) {
    validateRecord(record, phaseMap);
    const expectedSequence = (record.block - 1) * 9 + (record.order - 1) * 3 + PHASES.indexOf(record.phase) + 1;
    if (record.sequence !== expectedSequence) fail("EXECUTION_ORDER", "sequence does not match block, order, and phase");
    const turn = `${record.block}:${record.arm}:${record.phase}`;
    if (turns.has(turn)) fail("DUPLICATE_TURN", `duplicate turn ${record.block}:${record.arm}:${record.phase}`);
    if (sequences.has(record.sequence)) fail("DUPLICATE_SEQUENCE", `duplicate sequence ${record.sequence}`);
    turns.add(turn);
    sequences.add(record.sequence);
  }
  const permutations = new Set();
  for (let block = 1; block <= 6; block += 1) {
    const ordered = ARMS.map((arm) => {
      const session = cohort.records.filter((record) => record.block === block && record.arm === arm);
      if (session.length !== 3 || new Set(session.map((record) => record.order)).size !== 1) {
        fail("SESSION_SHAPE", `block ${block} arm ${arm} must contain ordered B0, S1, and S2`);
      }
      return [session[0].order, arm];
    }).sort((left, right) => left[0] - right[0]);
    if (ordered.map(([order]) => order).join(",") !== "1,2,3") fail("ARM_ORDER", `block ${block} arm slots mismatch`);
    permutations.add(ordered.map(([, arm]) => arm).join(","));
  }
  if (permutations.size !== 6) fail("ARM_PERMUTATIONS", "six blocks must use every arm permutation exactly once");
  return cohort.records.slice().sort((left, right) => left.sequence - right.sequence);
}

export const harnessSpeedConstants = Object.freeze({
  arms: ARMS, cohortSchema: COHORT_SCHEMA, phases: PHASES, product: PRODUCT,
  scenarioId: harnessSpeedScenarioId,
});

export { HarnessSpeedContractError, validateScenario } from "./harness-speed-scenario.mjs";
