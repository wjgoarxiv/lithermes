import { createHash } from "node:crypto";

export const harnessSpeedScenarioId = "litfamily-speed-lit-activation-v1";

const SCENARIO_SCHEMA = "litfamily.harness-speed-scenario/v1";
const EXPECTED_PHASES = [
  {
    id: "B0", measured: false, prompt_bytes: 69,
    prompt_sha256: "a5f634868cc6e20375f60803dcbe850eeb3d2709d6bb2c0efee204b9b5534904",
    sentinel_bytes: 15,
    sentinel_sha256: "7652e386a8825b8459833ec8aa7d19fa6a55bf82652f63f45cc4ae29bcfee17b",
  },
  {
    id: "S1", measured: true, prompt_bytes: 73,
    prompt_sha256: "a52e0ec9444cc2195c1c8dbb638862251f1f07df0512c505d06b43d44d4a4e78",
    sentinel_bytes: 15,
    sentinel_sha256: "8a655cd5ccd93b2727d641b5ca444e0f72bc09016115b7b6b16aa29e8457414a",
  },
  {
    id: "S2", measured: true, prompt_bytes: 99,
    prompt_sha256: "7b6712f5542798968a74a56241689f40475d50851d5a4d80f877d9a2589983a0",
    sentinel_bytes: 15,
    sentinel_sha256: "482d6b2f6dc3a90d5feb4aef7615f715ef2ffbceea5e5ffde90f070175c22dc8",
  },
];

export class HarnessSpeedContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HarnessSpeedContractError";
    this.code = code;
  }
}

export function failContract(code, message) {
  throw new HarnessSpeedContractError(code, message);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function validateScenario(scenario) {
  if (scenario === null || typeof scenario !== "object" || Array.isArray(scenario)) {
    failContract("MALFORMED_SCENARIO", "scenario must be an object");
  }
  if (scenario.schema !== SCENARIO_SCHEMA || scenario.scenario_id !== harnessSpeedScenarioId) {
    failContract("SCENARIO_IDENTITY", "scenario identity mismatch");
  }
  if (scenario.encoding !== "UTF-8" || scenario.prompt_trailing_newline !== false) {
    failContract("SCENARIO_ENCODING", "scenario encoding contract mismatch");
  }
  if (!Array.isArray(scenario.records) || scenario.records.length !== EXPECTED_PHASES.length) {
    failContract("SCENARIO_SHAPE", "scenario must contain exact B0, S1, and S2 records");
  }
  const phaseMap = new Map();
  scenario.records.forEach((phase, index) => {
    const expected = EXPECTED_PHASES[index];
    if (phase === null || typeof phase !== "object" || Array.isArray(phase) ||
      phase.id !== expected.id || phase.measured !== expected.measured) {
      failContract("SCENARIO_PHASE", `scenario phase ${index + 1} mismatch`);
    }
    if (typeof phase.prompt !== "string" || typeof phase.sentinel !== "string") {
      failContract("SCENARIO_TEXT", `scenario phase ${phase.id} text is missing`);
    }
    const promptBytes = Buffer.byteLength(phase.prompt, "utf8");
    const sentinelBytes = Buffer.byteLength(phase.sentinel, "utf8");
    if (promptBytes !== expected.prompt_bytes || phase.prompt_bytes !== expected.prompt_bytes ||
      sha256(phase.prompt) !== expected.prompt_sha256 || phase.prompt_sha256 !== expected.prompt_sha256 ||
      sentinelBytes !== expected.sentinel_bytes || phase.sentinel_bytes !== expected.sentinel_bytes ||
      sha256(phase.sentinel) !== expected.sentinel_sha256 || phase.sentinel_sha256 !== expected.sentinel_sha256) {
      failContract("SCENARIO_TEXT", `scenario phase ${phase.id} byte or hash mismatch`);
    }
    phaseMap.set(phase.id, phase);
  });
  return phaseMap;
}
