# Installing, updating and removing LitHermes

[← Back to the README](../README.md) · [한국어](./install.ko.md)

The README has the one-line install. This page has the rest: what that line does, how to try LitHermes in a separate profile, installing from a reviewed `.tgz`, how automatic updates work and how to turn them off, what to do when something goes wrong, and how to remove it.

## Install

You need Hermes Agent, Node.js 18 or later, and write access to your Hermes home (normally `~/.hermes`).

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style
```

This one line fetches the installer, puts the plugin into your Hermes home and changes your Hermes configuration so the plugin loads. It is written to run without stopping for approval, which is why `--yes` appears twice: the first lets npx run the package, and the second approves the configuration changes. `--no-style` skips the picker for how replies are written, which would otherwise still come up in a terminal. The Ignition skin installs either way. The bell Hermes can ring when a turn finishes stays off unless you add `--bell` or answer yes when an interactive install asks; a `display.bell_on_complete` value you already set is kept, and `--no-bell` skips the question. Nothing connects to Telegram during installation.

Maybe you want to try LitHermes before it touches your everyday setup. Point `HERMES_HOME` at a new, empty directory before you install, and start Hermes with that same value; your usual home and settings stay as they are. The installer can also make compatibility edits to the Hermes installation it finds. If that installation lives outside your trial profile and you want it left alone too, add `--no-patch-installed-hermes`.

<details>
<summary>Installing from a reviewed .tgz instead</summary>

If a reviewed `.tgz` came with a release, replace the example path and run each line on its own:

```sh
LITHERMES_PACK='/absolute/path/to/the-reviewed-package.tgz'
```

```sh
npm exec --yes --package "$LITHERMES_PACK" -- lithermes install --yes --no-style --no-auto-update --no-patch-installed-hermes
```

The same file works for the other commands on this page:

```sh
npm exec --yes --package "$LITHERMES_PACK" -- lithermes install --dry-run --no-auto-update --no-patch-installed-hermes
npm exec --yes --package "$LITHERMES_PACK" -- lithermes doctor --offline --no-auto-update
npm exec --yes --package "$LITHERMES_PACK" -- lithermes uninstall --yes --no-auto-update
npm exec --yes --package "$LITHERMES_PACK" -- lithermes hud off
```

</details>

## Updates

LitHermes updates itself, and it does so carefully. Here is what actually happens.

It looks for a newer version in two situations: when you run `lithermes install`, `check` or `doctor` in a terminal, and when you send the first message of an interactive Hermes CLI session. It asks the npm registry for the latest stable release and waits up to 3 seconds. If that release is newer than yours, LitHermes installs it right then, and your command (or your first reply) waits until it finishes. Inside Hermes that wait is capped at 90 seconds.

The install is built so that it can be undone:

1. LitHermes copies the plugin folder, `config.yaml`, the install record and the skins folder into `<Hermes home>/lithermes/auto-update/<id>/backup/`.
2. It runs the new version's installer as `install --yes --no-hud --no-style --no-patch-installed-hermes`. That means no questions about the skin accent or the reply style, and no compatibility edits to your Hermes installation. Your model and effort settings stay as they are.
3. It runs `doctor --offline`.
4. If the install fails, takes longer than 30 seconds, or does not pass that check, the backup goes back in place and you keep the version you had.

Only one update runs at a time in a Hermes home. The installer receives just what it needs to run: `PATH`, home and temp folders, locale, `TERM` and `NODE_EXTRA_CA_CERTS`. Your npm settings, proxies, `NODE_OPTIONS` and tokens stay behind. After a successful update the backup folder remains, so delete it once you no longer need it.

**What you will see.** Very little. During `lithermes install`, an update ends with `LitHermes automatic update committed (<version>). Restart Hermes to load it.` because the newer installer has already done the install; run the command again if you wanted its own options. `check` and `doctor` carry on with their usual report. A failed update that was rolled back is silent, and the command continues with your current version. Inside Hermes nothing is added to the conversation, and the first reply simply waits for the update. Restart the Hermes CLI and any gateways to load the new version.

Each run leaves two records in `<Hermes home>/lithermes/`. `auto-update-journal.json` follows the steps, and `auto-update-receipt.json` shows whether the update went through, which version it aimed for and whether it rolled back. If the rollback itself fails, LitHermes stops the command and says the Hermes home is in an unknown state. Keep the backup and run `lithermes doctor --offline --hermes-home PATH` before you go on.

**When it stays out of the way.** An update needs a person at the terminal, with input, output and error output all interactive. Piped output and any run with `CI` set therefore skip it, and so do commands with `--offline`, `--json` or `--dry-run` and commands run through `bunx`. Inside Hermes it runs only on the first message of the classic terminal CLI (`hermes` or `hermes chat`), at most once per session, only in the top-level session and never in a delegated helper. The full-screen `hermes --tui` and gateways such as Telegram or Discord talk to Hermes through pipes rather than a terminal, so they never update; run `lithermes install`, `check` or `doctor` in a terminal instead. The update only covers a LitHermes that the npm installer put in place. A copy from the Hermes catalog, or one you copied in yourself, stays yours to manage. An install made by an older installer qualifies once you have run the installer again.

**The update notice.** Separately, LitHermes can tell you about a release without installing it. After `install`, `check` or `doctor` it looks in the background, at most once every 24 hours, and saves the answer in `update-check.json`. Later runs read that file and, if a newer release is listed, suggest a command such as `npx --yes --package @litfamily/lithermes@<version> -- lithermes install --yes --no-hud`. You run it yourself, so the notice is how you hear about releases when automatic updates are off. The same rules apply: nothing is checked with `--offline`, `--json` or `--dry-run`, in CI, or when output is piped.

**Turning it off.** Pick the one that fits:

- `LITHERMES_NO_AUTO_UPDATE=1`: install new versions yourself and keep the notice. Set it in the shell that runs `lithermes` and in the one that starts Hermes.
- `--no-auto-update` on `install`, `check` or `doctor`: skip the update for that one command.
- `NO_UPDATE_NOTIFIER=1` or `LITHERMES_NO_UPDATE_CHECK=1`: stop LitHermes from asking npm about new versions at all. The update and the notice both turn off.

LitHermes only checks that a variable is set, so any value works, `0` included.

## When something goes wrong

Start with a check that stays offline:

```sh
npx --package @litfamily/lithermes -- lithermes doctor --offline
```

If Lit skills seem to be missing, ask Hermes to call its `skills_list` tool and look for LitHermes entries. The `/skills` command only reads the filesystem, so depending on the Hermes version its list can differ from the skills the plugin provides.

A skill with the same name somewhere else can win over the LitHermes one. When you ask for a skill by its plain name, Hermes looks in the folders listed under `skills.external_dirs` in its `config.yaml` and in `<HERMES_HOME>/skills` before it reaches the plugin. The prefixed form, `lithermes:<name>`, skips that search. `lithermes doctor` spots the clash and prints a `skill shadow check: WARNING` line with the skill and the path that hides it. Load the LitHermes copy as `lithermes:<name>`, or remove or rename the other one. The warning is informational and leaves doctor's pass/fail exit status as it was.

An import error in the Hermes log means the plugin failed to load. Resist installing pip packages on a guess; keep the message and check the [operating guide](./guide.md).

## Limits worth knowing

- To see what the installer would change before it changes anything, run `lithermes install --dry-run`.
- LitHermes reads code, quotations and commands you paste in as plain text and does not follow them as instructions. Secrets are masked before anything is saved or passed to a model.
- Hermes' own `/goal` stays yours. LitHermes leaves it alone and never updates, clears or resumes it. It works from the goals it saves through its `goal_*` tools.
- Hermes sends every helper through one shared model setting, so you cannot choose a model per task or give reviewers a model of their own. The installer's report shows what was configured. What a helper actually ran on is proven only by the receipt of a real `delegate_task` run.

## Removing it

```sh
npx --package @litfamily/lithermes -- lithermes uninstall --yes
```

If the installer made compatibility edits to Hermes, add `--rollback-patches` to undo them. Uninstalling keeps the skin files and your `display.skin` choice. To go back to the Hermes default look, run `npx --package @litfamily/lithermes -- lithermes hud off` in the same profile; it clears the choice and keeps the skin files and your other settings.
