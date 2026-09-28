#!/usr/bin/env node
const { main } = require("../src/cli");

main(process.argv.slice(2)).catch((error) => {
  const code = Number.isInteger(error.exitCode) ? error.exitCode : 1;
  console.error(error.message || String(error));
  process.exit(code);
});
