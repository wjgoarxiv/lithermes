# Migrating the npm package name

This source prepares the change from `lithermes-ai` to `@litfamily/lithermes`. The scoped package is an **unpublished candidate**; see [package.json](../packages/lithermes-installer/package.json) for the current source version. The commands below describe the intended published entry point after a separate release; they are not proof that npm currently serves it. For local candidate verification, use the reviewed tarball through an isolated npm install and its `lithermes` executable.

The npm package identity changes. Both executable aliases, `lithermes` and `lithermes-ai`, remain. The Hermes plugin ID remains `lithermes`, with payload in `<Hermes home>/plugins/lithermes/`, ownership receipt in `<Hermes home>/lithermes/install-manifest.json`, host settings in `config.yaml`, and workspace records in `.hermes/lithermes/`. Do not rename these directories to the npm scope or remove the old receipt before migration.

## Before replacing an installation

Stop active Hermes sessions and back up the complete plugin directory, its install receipt, `config.yaml`, and any local records you need. Keep that backup outside the installed plugin directory. Select the same Hermes home used by the existing installation with `--hermes-home PATH` or `HERMES_HOME`; `--home` is unsupported.

The installer validates the prior manifest, checks recorded file hashes, and checks the installed directory inventory. Default replacement refuses missing or modified recorded files, foreign files or directories, symlinks, other nonregular paths, and a preexisting plugin directory without a matching manifest. Standard Python import caches have the narrow retention path described below; an arbitrary `.pyc` file is not exempt from ownership checks. Resolve the reported ownership mismatch before retrying.

**`--force` is destructive:** the explicit override permits whole-tree replacement, discarding modifications and unrecorded additions within the plugin directory, and bypasses Python cache retention. Do not use it as a routine migration step. Back up your changes outside the plugin directory and decide how to preserve them first. A symlink, dangling symlink or non-directory at `<Hermes home>/plugins` or `<Hermes home>/lithermes` still refuses install and uninstall, even with `--force`; select or repair the intended profile rather than bypassing that boundary. The ownership checks and override are defined in [install.js](../packages/lithermes-installer/src/lib/install.js) and [hermesDiscovery.js](../packages/lithermes-installer/src/lib/hermesDiscovery.js).

## Python caches during repeat installation

A normal Python import can create `__pycache__/module.<interpreter-tag>.pyc`, optionally with an optimization tag. Default installation permits retention only when every entry in that cache directory is a regular file with this naming form and maps to an unchanged, manifest-owned sibling `.py` source. Unrelated entries, nested directories, symlinks, missing or changed sources, and empty unrecorded cache directories refuse replacement.

Before replacing the payload, the installer rechecks the source and cache inventory, then atomically moves each eligible cache directory into a unique `<Hermes home>/lithermes/retained-python-cache-*` directory. Relative cache paths are preserved. Its `retention.json` records the original plugin path, cache paths, hashes and observed directory identities. The backup parent must be a real directory, and an existing backup target is not overwritten. Cache bytes are retained as opaque data: the installer does not execute them, validate them as trusted Python code, or reuse them under the replacement source.

Successful installation prints `Retained Python cache backup: PATH` and records that operation's path as `retainedPythonCache` in the install manifest. Later installs and uninstall leave these backups in place; there is no automatic expiry, pruning or restoration. Keep the reported path because a later install can replace the manifest without carrying forward older backup references. You own the decision to archive or delete retained backups after reviewing them.

If retention or a later installation step fails, a reported backup can contain already-moved caches while other caches remain in the old payload. Preserve both locations and inspect `retention.json` alongside the error before retrying. Retention is not a full-profile backup or an automatic rollback. Do not copy retained bytecode into the replacement payload; let Python regenerate caches from the installed source. A failure after payload replacement still requires checking the installed state.

## Intended scoped command sequence

After the scoped release is available, inspect changes, install, and verify using the explicit package and preserved executable:

```sh
npm exec --yes --package @litfamily/lithermes@latest -- lithermes install --dry-run --hermes-home PATH
npm exec --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style --no-auto-update --hermes-home PATH
npm exec --yes --package @litfamily/lithermes@latest -- lithermes doctor --offline --hermes-home PATH
```

Replace `PATH` with the intended Hermes home. The first `--yes` approves npm execution; the install command's second `--yes` authorizes profile changes. Pin an exact reviewed package version when reproducibility matters. An old installed updater is not an automatic bridge to the new npm name: explicitly select the new package for migration.

An existing configured model route is preserved unless reconfiguration is requested; plugin enablement and related managed settings may still require a config write. Review the preview and resulting config instead of assuming the entire file must be identical. Omit `--reconfigure-model` to retain the route. Compatibility patches may be applied when a Hermes source checkout is discovered; use `--no-patch-installed-hermes` when that is outside the intended change. Restart Hermes after a successful installation and check a native `/lit` request. CLI diagnostics alone do not prove an authenticated model or gateway session.

Repeat installation uses the same ownership check and tree replacement. Backups and modified-file review remain necessary even when the version is unchanged.

## Removal and recovery

```sh
npm exec --yes --package @litfamily/lithermes@latest -- lithermes uninstall --yes --hermes-home PATH
```

Uninstall validates receipt paths and deletes recorded regular files only when their bytes still match the receipt and their parent paths are directories rather than symlinks. It does not follow symlinked files or directories to remove their targets. Modified files, unrecorded additions and symlinks remain. An invalid receipt refuses file removal.

After normal removal, uninstall disables LitHermes in the config and removes the receipt; it does not delete the whole Hermes home or workspace records. Review any leftovers before deleting them yourself. A later install into a leftover directory without its receipt will refuse replacement by default.

If compatibility patches were installed, add `--rollback-patches` to request their guarded rollback. Preserve the original backup for recovery; do not treat reinstalling with `--force` as a backup restore. See [privacy notes](./privacy.md) for retained logs, claims and transaction backups, and [support](../SUPPORT.md) if migration stops.

Automatic updates maintain a separate snapshot under `<Hermes home>/lithermes/auto-update/<transaction-id>/backup/`, with journal and receipt files in the product state directory. Install, uninstall and update paths validate the product state directory before locks, manifest reads, cache work or child execution. They recheck its observed device/inode identity at mutation and recovery checkpoints. State JSON reads refuse symlinks and require a matching regular file descriptor. Automatic updates also guard the transaction directories and check the plugin parent before taking the snapshot and before restoring plugin files. If that parent becomes unsafe during rollback, restoration refuses to follow it and the updater reports the profile state as unknown. Preserve the transaction backup and logs, resolve the unsafe path, and use the already available `lithermes doctor --offline --hermes-home PATH` before continuing. An unknown-state report is not a successful recovery.

If a state or transaction directory is moved or replaced mid-operation, cleanup refuses to follow its replacement. Locks and backups can remain in the original directory. The updater returns the transaction path and observed state directory identity; `receiptWritten: false` means it could not confirm the receipt at the advertised path. Preserve the original directory and match its identity before inspecting or recovering those files; a now-symlinked advertised path is not a recovery destination. An interrupted install can leave earlier completed steps in place and must be inspected before retrying. These are type and identity checks at defined checkpoints, not descriptor-pinned protection against arbitrary concurrent filesystem changes. An explicitly selected Hermes-home alias remains supported; its managed child directories must be real directories.
