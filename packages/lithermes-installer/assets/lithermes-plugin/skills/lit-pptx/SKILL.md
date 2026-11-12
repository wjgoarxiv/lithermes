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
| not installed | it is not listed | Tell the user it is a LitFamily extension and give the copy line; build nothing |

## #contract.procedure

1. Look at `<available_skills>`. If `lit-pptx` is listed there without the `lithermes:` prefix, the user has
   installed the moved copy: call `skill_view("lit-pptx")` now and follow it. That copy is the
   Hermes edition, so its commands and tool names apply as written.
2. If it is not listed, answer in the user's language with three things and stop:
   - one sentence on what lit-pptx makes;
   - that it is a LitFamily extension, kept in `variants/lithermes/lit-pptx` of `wjgoarxiv-skills`, which LitHermes's core works without;
   - the install line below, in a code block, and that a new Hermes session (or a restart) picks it up, after which
     the user asks again.

## Install for Hermes

One skill, copied into the active profile (`HERMES_HOME` selects a profile; the default is `~/.hermes`). A user without a clone gets one first with `git clone https://github.com/wjgoarxiv/wjgoarxiv-skills.git`:

```bash
mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills"
cp -R "<path to your wjgoarxiv-skills clone>/variants/lithermes/lit-pptx" "${HERMES_HOME:-$HOME/.hermes}/skills/"
```

The copy lands in `skills/lit-pptx/` of the profile, beside LitHermes rather than inside it. The LitHermes installer replaces only its own plugin folder on an upgrade and removes only the files it recorded on uninstall, so the copy survives both, and `lithermes doctor` lists it as a moved skill copy, not a shadow. This stub stays as `lithermes:lit-pptx` and keeps the `/lit-pptx` command, which Hermes runs before the copy's own and which hands over to the copy. To update the copy, replace `skills/lit-pptx/` with a fresh one.

## #contract.outputs

Installed: the moved skill's own outputs. Not installed: one short reply with the copy line and no file.

## #contract.output_channels

```yaml
artifact_genre: no_artifact
limitations_channel: reply
```

## #contract.evidence

`test/moved-skill-stubs.test.js` and `test/python/test_moved_skill_stubs.py` check this stub, its install line and
that every route and command still reaches it without the old body's instructions.

## #contract.hard_stops

- Never run the copy line yourself: it changes the user's Hermes profile. The user runs it.
- Never produce the deliverable from memory, from another skill or with a tool this stub does not ship.

## #contract.anti_patterns

- Writing a .pptx by hand with python-pptx or raw OOXML because the real skill is missing.
- Quoting the old tonality list or QA steps from memory as if this stub still held them.
