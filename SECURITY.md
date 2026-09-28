# Security

Report suspected vulnerabilities privately before sharing exploit details. Use GitHub's **Report a vulnerability** option in this repository's Security tab if it is available. If it is unavailable, use a private maintainer channel you already know, or open a minimal issue asking how to establish one without disclosing the vulnerability. No security mailbox or response-time guarantee is currently designated here.

Include the affected version or commit, impacted installer/plugin surface, prerequisites, a minimal reproduction using synthetic data, expected boundary and observed impact. Do not include tokens, credentials, real conversations, private project files or a live user's Hermes profile. Coordinate disclosure with the maintainer through the private channel.

Relevant boundaries include package validation, installer ownership and removal, config writes, compatibility patch rollback, prompt/tool input handling, redaction and durable state. Hermes itself, model providers and external tools also have their own security boundaries; describe which component you observed rather than assuming the plugin controls all of them.

Security work targets the current maintained source. Historical releases have no separate backport commitment. `@litfamily/lithermes` is an unpublished candidate name in this source; candidate documentation does not establish a published security fix. Consult release notes and the exact installed version before deciding a fix is present.

See [privacy and local records](./docs/privacy.md) before collecting diagnostics. If a real secret was exposed, revoke it through its provider and remove it from any report; editing a public comment alone does not invalidate the secret.
