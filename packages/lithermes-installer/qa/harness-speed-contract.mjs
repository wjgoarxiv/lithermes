#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { makeProviderFreeSurfaceCohort } from "./lib/harness-speed-surface.mjs";
import {
  HarnessSpeedContractError,
  validateCohort,
  validateScenario,
} from "./lib/harness-speed-schema.mjs";
import { computeVerdict } from "./lib/harness-speed-verdict.mjs";

function parseJsonFile(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new HarnessSpeedContractError("MALFORMED_JSON", `${label} JSON is malformed`);
    }
    throw error;
  }
}

export function loadScenario(filePath) {
  const scenario = parseJsonFile(filePath, "scenario");
  validateScenario(scenario);
  return scenario;
}

export function evaluateCohort(scenario, cohort) {
  return computeVerdict(validateCohort(scenario, cohort));
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  if (!args[index + 1] || args[index + 1].startsWith("--")) {
    throw new HarnessSpeedContractError("CLI_ARGUMENT", `${name} requires a path`);
  }
  return args[index + 1];
}

export function runCli(args) {
  const scenarioPath = option(args, "--scenario");
  if (!scenarioPath) throw new HarnessSpeedContractError("CLI_ARGUMENT", "--scenario is required");
  const scenario = loadScenario(scenarioPath);
  const surfaceMode = args.includes("--provider-free-surface");
  const cohortPath = option(args, "--cohort");
  if (surfaceMode === Boolean(cohortPath)) {
    throw new HarnessSpeedContractError("CLI_ARGUMENT", "choose exactly one of --cohort or --provider-free-surface");
  }
  const cohort = surfaceMode
    ? makeProviderFreeSurfaceCohort(scenario)
    : parseJsonFile(cohortPath, "cohort");
  const aggregate = evaluateCohort(scenario, cohort);
  return surfaceMode
    ? {
        ...aggregate,
        surface: {
          mode: "provider-free-synthetic",
          fixture_records: scenario.records.length,
          simulated_cohort_records: cohort.records.length,
          provider_calls: 0,
          temporary_profiles: 0,
          processes_remaining: 0,
          raw_records_retained: false,
        },
      }
    : aggregate;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const result = runCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.verdict !== "PASS") process.exitCode = 1;
  } catch (error) {
    const known = error instanceof HarnessSpeedContractError;
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error_code: known ? error.code : "INTERNAL_ERROR",
      message: known ? error.message : "internal harness-speed validator error",
    })}\n`);
    process.exitCode = known ? 1 : 2;
  }
}
