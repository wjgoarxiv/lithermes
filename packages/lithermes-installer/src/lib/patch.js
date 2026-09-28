const fs = require("node:fs");
const path = require("node:path");
const { sha256, writeFileAtomic } = require("./files");
const { LitHermesError } = require("./hermesDiscovery");

function patchManifestPath(hermesHome) {
  return path.join(hermesHome, "lithermes", "patch-manifest.json");
}

function nativePluginInjectionAvailable(repo) {
  const file = path.join(repo, "hermes_cli", "plugins.py");
  if (!fs.existsSync(file)) return false;
  const source = fs.readFileSync(file, "utf8");
  return source.includes("def inject_message(")
    && source.includes("session_key")
    && source.includes("allow_gateway_injection");
}

function patchTarget(repo, relative, marker, additions) {
  const file = path.join(repo, relative);
  if (!fs.existsSync(file)) {
    return null;
  }
  const source = fs.readFileSync(file, "utf8");
  if (additions.every((text) => source.includes(text))) {
    return null;
  }
  if (!source.includes(marker)) {
    throw new LitHermesError(`Unsupported Hermes preimage for ${relative}; refusing to patch without a known marker.`, 8);
  }
  const backup = `${file}.lithermes.bak`;
  fs.copyFileSync(file, backup);
  const beforeHash = sha256(file);
  const backupHash = sha256(backup);
  const patched = `${source.replace(/\s*$/, "\n")}\n# LitHermes compatibility patch\n${additions.map((text) => `# ${text}`).join("\n")}\n`;
  writeFileAtomic(file, patched, "utf8");
  return {
    file,
    relative,
    backup,
    beforeHash,
    backupHash,
    patchedHash: sha256(file),
  };
}

function patchCliPayloadDispatch(repo) {
  const relative = "cli.py";
  const file = path.join(repo, relative);
  if (!fs.existsSync(file)) return null;
  const source = fs.readFileSync(file, "utf8");
  if (source.includes("_pending_input.put") && source.includes("agent_message") && source.includes("ast.literal_eval")) {
    return null;
  }

  const marker = [
    "                        result = resolve_plugin_command_result(",
    "                            plugin_handler(user_args)",
    "                        )",
    "                        if result:",
    "                            _cprint(str(result))",
  ].join("\n");
  if (!source.includes(marker)) {
    throw new LitHermesError(`Unsupported Hermes preimage for ${relative}; plugin command dispatch block not recognized.`, 8);
  }

  const replacement = [
    "                        result = resolve_plugin_command_result(",
    "                            plugin_handler(user_args)",
    "                        )",
    "                        if isinstance(result, str) and \"agent_message\" in result:",
    "                            try:",
    "                                parsed = ast.literal_eval(result)",
    "                            except (SyntaxError, ValueError):",
    "                                parsed = None",
    "                            if isinstance(parsed, dict):",
    "                                result = parsed",
    "                        if isinstance(result, dict) and result.get(\"agent_message\"):",
    "                            display = result.get(\"display\") or result.get(\"message\")",
    "                            if display:",
    "                                _cprint(str(display))",
    "                            if hasattr(self, '_pending_input'):",
    "                                self._pending_input.put(str(result[\"agent_message\"]))",
    "                        elif result:",
    "                            _cprint(str(result))",
  ].join("\n");

  const backup = `${file}.lithermes.bak`;
  fs.copyFileSync(file, backup);
  const beforeHash = sha256(file);
  const backupHash = sha256(backup);
  writeFileAtomic(file, source.replace(marker, replacement), "utf8");
  return {
    file,
    relative,
    backup,
    beforeHash,
    backupHash,
    patchedHash: sha256(file),
  };
}

function patchInstalledHermes({ hermesHome, hermesRepo }) {
  if (!hermesRepo || !fs.existsSync(hermesRepo)) {
    throw new LitHermesError("Cannot patch Hermes because --hermes-repo was not found. Pass --hermes-repo PATH or run doctor first.", 8);
  }
  if (nativePluginInjectionAvailable(hermesRepo)) {
    fs.mkdirSync(path.dirname(patchManifestPath(hermesHome)), { recursive: true });
    writeFileAtomic(
      patchManifestPath(hermesHome),
      JSON.stringify({
        patchedAt: new Date().toISOString(),
        nativeDispatch: {
          cli: true,
          gateway: true,
          reason: "Hermes PluginContext.inject_message is available",
        },
        records: [],
      }, null, 2),
      "utf8",
    );
    return {
      changed: [],
      records: [],
      native: true,
      reason: "Hermes PluginContext.inject_message is available",
    };
  }
  const changed = [];
  const records = [];
  const cli = patchCliPayloadDispatch(hermesRepo);
  if (cli) {
    changed.push("cli.py");
    records.push(cli);
  }
  const gateway = patchTarget(hermesRepo, path.join("gateway", "run.py"), "lithermes-patch-target:gateway", [
    'command.replace("_", "-")',
    "_plugin_agent_dispatch_payload",
  ]);
  if (gateway) {
    changed.push("gateway/run.py");
    records.push(gateway);
  }
  const plugins = patchTarget(hermesRepo, path.join("hermes_cli", "plugins.py"), "lithermes-patch-target:plugins", [
    "auto_load",
    "plugins.enabled",
  ]);
  if (plugins) {
    changed.push("hermes_cli/plugins.py");
    records.push(plugins);
  }
  fs.mkdirSync(path.dirname(patchManifestPath(hermesHome)), { recursive: true });
  writeFileAtomic(patchManifestPath(hermesHome), JSON.stringify({ patchedAt: new Date().toISOString(), records }, null, 2), "utf8");
  return { changed, records };
}

function rollbackPatches({ hermesHome }) {
  const manifest = patchManifestPath(hermesHome);
  if (!fs.existsSync(manifest)) {
    return { message: "No LitHermes patches to roll back." };
  }
  const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const restored = [];
  for (const record of [...parsed.records].reverse()) {
    if (!fs.existsSync(record.file) || !fs.existsSync(record.backup)) {
      throw new LitHermesError(`Cannot roll back ${record.relative}; patched file or backup is missing.`, 9);
    }
    if (sha256(record.file) !== record.patchedHash || sha256(record.backup) !== record.backupHash) {
      throw new LitHermesError(`Cannot roll back ${record.relative}; file hash changed after patch.`, 9);
    }
    fs.copyFileSync(record.backup, record.file);
    fs.unlinkSync(record.backup);
    restored.push(record.relative);
  }
  fs.unlinkSync(manifest);
  return { message: `Rolled back LitHermes patches: ${restored.join(", ") || "none"}` };
}

module.exports = {
  nativePluginInjectionAvailable,
  patchCliPayloadDispatch,
  patchInstalledHermes,
  patchManifestPath,
  rollbackPatches,
};
