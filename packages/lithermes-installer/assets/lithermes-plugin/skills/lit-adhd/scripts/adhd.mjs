#!/usr/bin/env node
// adhd.mjs: the lit-adhd collector for a shell where no installed bin is on PATH.
// It runs the same code the skill procedure calls, with the same flags:
//
//   node <skill-root>/scripts/adhd.mjs [--json] [--here] [--since 7d] [--max 12] [--session <id>] [--width N]
//
// Read-only apart from the collector's one next-step record under .hermes/lithermes/adhd/.

import { runAdhdCli } from './lib/collect.mjs';

process.exitCode = runAdhdCli(process.argv.slice(2), process.cwd());
