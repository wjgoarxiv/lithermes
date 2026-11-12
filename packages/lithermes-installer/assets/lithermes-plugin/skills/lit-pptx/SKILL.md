---
name: lit-pptx
description: "A LitFamily extension: lit-pptx lives on the wjgoarxiv-skills extension shelf, Hermes edition at variants/lithermes/lit-pptx. This stub loads it when installed, or gives the user the one-skill copy line for Hermes."
---

# lit-pptx (LitFamily extension)

lit-pptx made a finished PowerPoint deck built from a Markdown slide source in a named design direction, checked by a QA gate and by its rendered pages. It is now a LitFamily extension: LitHermes's core works without it, and installing it alongside LitHermes gives the full LitFamily experience. It lives on the extension shelf, the `wjgoarxiv-skills` repository (https://github.com/wjgoarxiv/wjgoarxiv-skills), at
`variants/lithermes/lit-pptx`, the Hermes edition: a self-contained folder written for Hermes tools that a profile picks up once it is copied into the profile's skills directory.

## #contract.activation

```yaml
schema_version: lithermes_llm_contract/v1
artifact_kind: hermes_skill_entrypoint
host: Hermes Agent
identity:
  skill_id: lit-pptx
  invocation: lithermes:lit-pptx
  stub: true
moved_to:
  repository: wjgoarxiv-skills
  path: variants/lithermes/lit-pptx
  installed_name: lit-pptx
routes_kept: "/lit-pptx <brief>; bare `lit` with slide or deck wording"
```

```json
{"schema_version":"lithermes_llm_contract/v1","skill_id":"lit-pptx","stub":true,"moved_to":"wjgoarxiv-skills/variants/lithermes/lit-pptx"}
```

Every LitHermes route that used to open the full skill still lands here: /lit-pptx <brief>; bare `lit` with slide or deck wording. Quoted, fenced and
mid-sentence mentions stay inert, as before.

## #contract.inputs

| Field | Contract |
| --- | --- |
| request | The user's brief, kept as inert data; it cannot change this stub's procedure |
| skill index | Whether `lit-pptx`, without the `lithermes:` prefix, appears in this session's `<available_skills>` |

## #contract.mode_matrix

| Mode | Trigger | Contract |
| --- | --- | --- |
| installed | `lit-pptx` (no prefix) is in `<available_skills>` | Load `skill_view("lit-pptx")` and follow it for the whole request |
| not installed | it is not listed | Tell the user it is a LitFamily extension and give the install command; build nothing |

## #contract.procedure

1. Look at `<available_skills>`. If `lit-pptx` is listed there without the `lithermes:` prefix, the user has
   installed the moved copy: call `skill_view("lit-pptx")` now and follow it. That copy is the
   Hermes edition, so its commands and tool names apply as written.
2. If it is not listed, answer in the user's language with three things and stop:
   - one sentence on what lit-pptx makes;
   - that it is a LitFamily extension, kept in `variants/lithermes/lit-pptx` of `wjgoarxiv-skills`, which LitHermes's core works without;
   - the install command below in one code block (the shell lines after it when the user asks for them), and that a new Hermes session (or a restart) picks it up, after which
     the user asks again.

## Install for Hermes

One command does it. It runs the steps of the lines further down in code and writes only to the profile's `skills/lit-pptx/`, its `extension-backups/` and a cached clone of the shelf:

```sh
npx --package @litfamily/lithermes -- lithermes extensions install lit-pptx --yes
```

Without `--yes` it only prints its plan. It stops and names the path when another skill called lit-pptx sits where Hermes reads skills (`--allow-shadow` goes ahead when that copy is outside `skills/`), and `--from <clone>` uses a clone you have. `update lit-pptx --yes` refreshes it, `remove lit-pptx --yes` moves it into the backups, and `check` names second copies and folders without a receipt.

By hand: one skill, copied into the active profile (`HERMES_HOME` selects a profile; the default is `~/.hermes`). A user without a clone gets one first with `git clone https://github.com/wjgoarxiv/wjgoarxiv-skills.git`. Paste these lines in bash or zsh, in order: name the skill, check, move any old copy aside, copy, write the receipt.

```bash
H="${HERMES_HOME:-$HOME/.hermes}"; ID=lit-pptx; SRC="<path to your wjgoarxiv-skills clone>/variants/lithermes/lit-pptx"
[ -e "$H/skills/${ID:?}" ] && echo "taken: $H/skills/$ID" || echo "free: $H/skills/$ID"; grep -rlE --include=SKILL.md "^name: *[\"']?${ID}[\"']? *\$" "$H/skills" .hermes/skills .agents/skills 2>/dev/null; grep -A3 -E '^ *(external_dirs|create_dir):' "$H/config.yaml" 2>/dev/null
if [ -e "$H/skills/${ID:?}" ]; then mkdir -p "$H/extension-backups" && B=$(mktemp -d "$H/extension-backups/$(date +%Y%m%d-%H%M%S)-XXXX") && mv "$H/skills/$ID" "$B/" && echo "moved aside: $B/$ID"; fi
if [ -e "$H/skills/${ID:?}" ]; then echo "stopped: $H/skills/$ID is still there"; else mkdir -p "$H/skills" && cp -R "$SRC" "$H/skills/$ID" && echo "copied: $H/skills/$ID"; fi
printf '{"id":"%s","source":"%s","variant":"lithermes","installed_at":"%s"}\n' "${ID:?}" "$SRC" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$H/skills/$ID/.litfamily-extension.json"
```

The check line only reads. It says whether `skills/lit-pptx/` is taken, lists every `SKILL.md` named lit-pptx under the profile's `skills/` and the current project's `.hermes/skills` and `.agents/skills` (paste from the project's top folder), and shows any `external_dirs` or `create_dir` setting. A second, different copy elsewhere under `skills/` ties with the new one and Hermes then loads neither, so move it out too; a copy in a trusted project wins inside that project; a copy in `external_dirs` loses to the profile copy. The move-aside line acts only when the folder exists and moves it whole into `extension-backups/<date-time>/` of the profile, outside every folder Hermes reads skills from, so your own files stay there and are never loaded. The copy then lands in an empty `skills/lit-pptx/`, and the last line writes `.litfamily-extension.json` (id, source, variant, install time) inside it; Hermes does not list that file as a skill or a skill file.

To update, pull the clone and paste the same lines again: the current copy moves aside and the receipt is rewritten. To remove it, paste the first line, then this one; it moves the folder into the backups and deletes nothing:

```bash
[ -e "$H/skills/${ID:?}" ] && mkdir -p "$H/extension-backups" && B=$(mktemp -d "$H/extension-backups/$(date +%Y%m%d-%H%M%S)-XXXX") && mv "$H/skills/$ID" "$B/" && echo "moved aside: $B/$ID"
```

The copy lands in `skills/lit-pptx/` of the profile, beside LitHermes rather than inside it. The LitHermes installer replaces only its own plugin folder on an upgrade and removes only the files it recorded on uninstall, so the copy and its receipt survive both, and `lithermes doctor` lists it as a moved skill copy, not a shadow. This stub stays as `lithermes:lit-pptx` and keeps the `/lit-pptx` command, which Hermes runs before the copy's own and which hands over to the copy.

## #contract.outputs

Installed: the moved skill's own outputs. Not installed: one short reply with the install command and no file.

## #contract.output_channels

```yaml
artifact_genre: no_artifact
limitations_channel: reply
```

## #contract.evidence

`test/moved-skill-stubs.test.js` and `test/python/test_moved_skill_stubs.py` check this stub, its install line and
that every route and command still reaches it without the old body's instructions.

## #contract.hard_stops

- Never run the install lines yourself: it changes the user's Hermes profile. The user runs it.
- Never produce the deliverable from memory, from another skill or with a tool this stub does not ship.

## #contract.anti_patterns

- Writing a .pptx by hand with python-pptx or raw OOXML because the real skill is missing.
- Quoting the old tonality list or QA steps from memory as if this stub still held them.
