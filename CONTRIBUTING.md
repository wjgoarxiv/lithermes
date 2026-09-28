# Contributing to LitHermes

LitHermes is a Node.js installer for a Python plugin loaded by Hermes Agent. Keep changes native to those two surfaces and independently usable in this repository. The npm package root is `packages/lithermes-installer/`; there is no root `package.json`.

For a bug, include a small reproduction, expected and observed behavior, Node/Python/Hermes versions, platform, and the command's exit status. Remove credentials, private prompts, paths, and project content from attachments. Follow [SECURITY.md](./SECURITY.md) for vulnerabilities and [SUPPORT.md](./SUPPORT.md) for usage questions.

## Development and validation

Use Node.js 18+ and a Python environment suitable for the Hermes installation under test. Install the Node dependencies with `npm --prefix packages/lithermes-installer ci`. CI uses Node 20, Python 3.12, PyYAML and jsonschema; scientific or host-specific optional checks may need additional dependencies. Report skips and their reason.

Make the smallest coherent change and reproduce a behavior defect with a focused regression before fixing it. From the repository root, the native gates are:

```sh
npm --prefix packages/lithermes-installer test
npm --prefix packages/lithermes-installer run test:python
npm --prefix packages/lithermes-installer run check:version
node packages/lithermes-installer/test/scripts/scan-forbidden-tokens.js --tracked
node packages/lithermes-installer/test/scripts/scan-forbidden-tokens.js --package-root
npm --prefix packages/lithermes-installer run pack:dry
```

Run Python tests through the npm runner: it resolves the interpreter Hermes uses. A bare unittest invocation can report environment failures that do not represent that runtime. For installer changes, also verify the packed CLI in disposable `HOME`, `HERMES_HOME`, temporary-directory and npm-cache locations. Use `--hermes-home PATH`; `--home` is not supported. Clean up test profiles and child processes, and distinguish synthetic adapters from an authenticated Hermes session.

After editing the plugin payload, run `node packages/lithermes-installer/scripts/sync-plugin.js --in-place` last. Review the generated hash changes; discard a timestamp-only change when the source hash is unchanged. Do not edit archived or vendored reference corpora to silence a guard. Keep local plans, evidence and runtime state out of commits and package contents.

## Pull requests

Explain the user-visible problem, resulting behavior, validation and any remaining limitation. Preserve native plugin IDs, ownership receipts, configuration and executable aliases when changing package references. Keep release versions unchanged unless the release owner explicitly approved them. CI validates changes; publication remains a separate manual workflow with its own guards.

The project uses the [MIT License](./LICENSE), with the existing copyright holder `wjgoarxiv`. Contributions should be compatible with that license and retain required third-party notices. Participation follows the [Code of Conduct](./CODE_OF_CONDUCT.md).
