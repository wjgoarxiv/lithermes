#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { evaluateV2Cohort } from "./lib/harness-speed-v2-contract.mjs";

export function runV2Cli(args, input = null) {
  if (!args.includes("--provider-free")) throw new TypeError("--provider-free is required");
  if (!args.includes("--receipt-stdin")) throw new TypeError("--receipt-stdin is required");
  if (args.length !== 2) throw new TypeError("unsupported CLI argument");
  let receipt;
  try {
    receipt = JSON.parse(input === null ? readFileSync(0, "utf8") : input);
  } catch (error) {
    if (error instanceof SyntaxError) throw new TypeError("receipt JSON is malformed");
    throw error;
  }
  const result = evaluateV2Cohort(receipt);
  return {
    ...result,
    surface: {
      mode: "provider-free-contract-validation",
      provider_calls: 0,
      provider_completions: 0,
      network_actions: 0,
      auth_actions: 0,
      raw_records_retained: false,
    },
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const result = runV2Cli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.verdict !== "PASS") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error_code: "V2_CONTRACT_REJECTED",
      message: error instanceof Error ? error.message : "unknown contract failure",
    })}\n`);
    process.exitCode = 1;
  }
}
