# Privacy and local records

LitHermes runs inside your Hermes Agent environment. Its local records are separate from the prompts and tool activity that Hermes may send to your configured model providers, gateways or external services. This document describes the installer and plugin source; it does not promise that a complete Hermes session is offline or covered by one telemetry policy.

## Network activity

Fetching a package through npm contacts the configured registry and follows npm's own configuration and caching behavior. The installer update code can query `registry.npmjs.org` for package version metadata. Eligible interactive install/check/doctor commands and the supported first-turn update path can initiate an automatic update; update transactions can invoke a package installer and record backup/journal/doctor results locally.

`LITHERMES_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER=1` disables the installer's update checks and automatic-update gate. `LITHERMES_NO_AUTO_UPDATE=1` disables automatic installation. The relevant CLI gates also suppress updates for `--offline`, `--json`, `--dry-run`, CI and noninteractive streams. These controls do not make an outer `npm exec` fetch offline, and do not disable Hermes model calls or network-capable tools. Use an already available local CLI for a local `doctor --offline` check.

See [updateNotifier.js](../packages/lithermes-installer/src/lib/updateNotifier.js) for exact eligibility, registry request and transaction behavior. Workflows that fetch sources or use browser/tools follow the permissions and services selected for that task.

The optional Jev skill hint is off by default. Only when you set both `LITHERMES_JEV=1` and your own `TYPESAFE_API_KEY` does the plugin send each eligible prompt to TypeSafe (`api.typesafe.ai`), truncated to 2,000 characters with home paths, email addresses and token-shaped strings redacted, together with the list of LitHermes skill names and descriptions. Anything in the prompt without a token shape is sent as written, such as hostnames, customer names, and passwords not written as `password=...`. In Hermes gateway mode, messages from other participants in a chat reach LitHermes as user turns, so they are eligible prompts too. It sends no files, tool output or history, never writes the key anywhere, and bills your TypeSafe account. Because `TYPESAFE_API_KEY` is exported in the shell that starts Hermes, the agent's own tools can read it; use a key dedicated to this feature, with a low spend limit. Unset `LITHERMES_JEV` to stop it. While it is on, each accepted hint overwrites Hermes home `lithermes/jev-last.json` (mode 0600) with only the skill id, the latency in milliseconds and a timestamp, so `hermes lithermes status` can show it; the opt-in `LITHERMES_JEV_TRACE=1` trace appends a hash of the redacted prompt, ids and timings to `lithermes/jev-trace.jsonl`. Neither file holds prompt text, the key or response text, and neither is written through a symlink. See [jev_hint.py](../packages/lithermes-installer/assets/lithermes-plugin/jev_hint.py).

## Files and retention

| Location | What it can contain |
|---|---|
| Hermes home `plugins/lithermes/` | Installed Python plugin and skill payload |
| Hermes home `config.yaml` | Plugin enablement and managed model/display settings alongside existing host settings |
| Hermes home `lithermes/` | Install manifest, event log, update cache, transaction receipts and backups; with the Jev skill hint on, `jev-last.json` and the opt-in `jev-trace.jsonl` |
| Hermes home `lithermes/retained-python-cache-*/` | Relocated Python cache bytes and a `retention.json` inventory |
| Workspace `.hermes/lithermes/` | Run state, ledgers, goal/evidence records and knowledge claims |
| Workspace `plans/` and task-selected output paths | Plans and artifacts created by the requested workflow |

The installer resolves the home from `--hermes-home`, then `HERMES_HOME`, then `~/.hermes`. See [installation](../packages/lithermes-installer/src/lib/install.js), [runtime paths and event writes](../packages/lithermes-installer/assets/lithermes-plugin/core_runtime.py), and [run records](../packages/lithermes-installer/assets/lithermes-plugin/core_runs.py).

Skill-review state created by earlier versions is inert in the current release. The installer and plugin do not read, rewrite, migrate, or delete those files; their owner may remove them separately.

On a default repeat installation, eligible interpreter-tagged caches associated with unchanged owned Python sources are moved outside the plugin payload into a unique `retained-python-cache-*` backup. These are preserved bytes, not redacted event records: they may contain source constants or paths and should not be attached to reports without review. `retention.json` includes the original plugin path, relative cache paths, hashes and observed directory identities. The installer does not execute, trust or reuse retained bytecode under new source. Successful output reports the backup path, and that install's manifest records `retainedPythonCache`.

Cache backups have no automatic expiry, cleanup or restoration. They survive later installs and uninstall, and can remain after a partial failure; a later manifest need not retain older backup references. The local profile owner decides when to archive or delete them. They are separate from automatic-update snapshots in `lithermes/auto-update/<transaction-id>/backup/`, which may retain plugin files, configuration and other transaction targets. Preserve needed recovery evidence before cleanup. See [migration](./migration.md) for the cache eligibility, destructive `--force` exception and unsafe-path rollback behavior.

Redaction runs on several task/event persistence paths, but pattern-based redaction cannot guarantee removal of every sensitive value. Review diagnostics, plans, artifacts and handoffs before sharing. Local storage does not mean that every stored value stays out of model context: workflow context and accepted knowledge can be included in a Hermes request.

Wikify captures structured events as `review-needed`; accepted records may enter context. Set `LITHERMES_WIKIFY_CAPTURE=0`, or use `hermes lithermes knowledge capture off` in the relevant workspace to stop capture. The opt-out does not erase existing claims or stop other run/event records. [knowledge.py](../packages/lithermes-installer/assets/lithermes-plugin/knowledge.py) defines claims and settings under `.hermes/lithermes/knowledge/`.

Uninstall removes matching managed plugin files and disables the plugin. It does not implement a comprehensive personal-data erasure process: run records, event logs, retained Python caches, update backups, modified files and host settings can remain. Stop active Hermes sessions, review the paths you own, and back up needed work before manually deleting retained records. Follow [migration and removal](./migration.md) for ownership details. Keep secrets and local records out of Git commits and issue attachments.
