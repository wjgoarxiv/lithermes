# Support

Start with the [operating guide](./docs/guide.md), [migration guide](./docs/migration.md), and [privacy notes](./docs/privacy.md). For usage questions or reproducible bugs, use this repository's issue tracker where you have access. Documentation links and the scoped npm candidate do not establish public availability. Support is best effort, with no guaranteed response time.

An effective report includes:

- LitHermes version or source commit, Node/Python/Hermes versions, and operating system.
- Exact command or native `/lit` route, expected behavior, observed result, and exit status.
- Whether the failure used the CLI or gateway, a disposable profile or an existing installation, and a packed artifact or source checkout.
- A small sanitized reproduction and relevant diagnostics; identify any skipped or unavailable host checks.

With the local CLI already available, `lithermes doctor --offline --hermes-home PATH` checks the selected profile without an update lookup. Replace `PATH` with your Hermes home; do not use `--home`. Review output before sharing it, especially absolute paths and configuration details. Never attach an entire profile or raw conversation as a default troubleshooting step.

Use [SECURITY.md](./SECURITY.md) for suspected vulnerabilities. Report Hermes host or external-provider problems to the responsible project once the reproduction identifies that boundary; include enough context to show how LitHermes was involved.
