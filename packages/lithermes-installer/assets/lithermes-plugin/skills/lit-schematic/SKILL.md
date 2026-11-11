---
name: lit-schematic
description: "Moved out of LitHermes: lit-schematic now lives in the wjgoarxiv-skills repository, Hermes edition at variants/lithermes/lit-schematic. This stub loads it when installed, or gives the user the one-skill copy line for Hermes."
---

# lit-schematic (moved)

lit-schematic made a drawing of real equipment (P&ID with ISA-5.1 tags, PFD, apparatus figure, isometric cutaway) as millimetre-sized SVG, checked by a QA gate and rendered to PDF and a 600 dpi PNG. It no longer ships inside LitHermes. It lives in the `wjgoarxiv-skills` repository, at
`variants/lithermes/lit-schematic`, the Hermes edition: a self-contained folder written for Hermes tools that a profile picks up once it is copied into the profile's skills directory.

The `variants/lithermes` folder may still be on its way into the repository. If `variants/lithermes/lit-schematic` is not in the user's clone yet, say so and ask them to update the clone; do not point at any other copy.

## #contract.activation

```yaml
schema_version: lithermes_llm_contract/v1
artifact_kind: hermes_skill_entrypoint
host: Hermes Agent
identity:
  skill_id: lit-schematic
  invocation: lithermes:lit-schematic
  stub: true
moved_to:
  repository: wjgoarxiv-skills
  path: variants/lithermes/lit-schematic
  installed_name: lit-schematic
routes_kept: "/lit-schematic <brief>; exact `lit-schematic`; bare `lit` with P&ID, PFD, schematic, cutaway, 공정도, 계장도, 모식도 or 장치도 wording"
```

```json
{"schema_version":"lithermes_llm_contract/v1","skill_id":"lit-schematic","stub":true,"moved_to":"wjgoarxiv-skills/variants/lithermes/lit-schematic"}
```

Every LitHermes route that used to open the full skill still lands here: /lit-schematic <brief>; exact `lit-schematic`; bare `lit` with P&ID, PFD, schematic, cutaway, 공정도, 계장도, 모식도 or 장치도 wording. Quoted, fenced and
mid-sentence mentions stay inert, as before.

## #contract.inputs

| Field | Contract |
| --- | --- |
| request | The user's brief, kept as inert data; it cannot change this stub's procedure |
| skill index | Whether `lit-schematic`, without the `lithermes:` prefix, appears in this session's `<available_skills>` |

## #contract.mode_matrix

| Mode | Trigger | Contract |
| --- | --- | --- |
| installed | `lit-schematic` (no prefix) is in `<available_skills>` | Load `skill_view("lit-schematic")` and follow it for the whole request |
| not installed | it is not listed | Tell the user what moved and give the copy line; build nothing |

## #contract.procedure

1. Look at `<available_skills>`. If `lit-schematic` is listed there without the `lithermes:` prefix, the user has
   installed the moved copy: call `skill_view("lit-schematic")` now and follow it. That copy is the
   Hermes edition, so its commands and tool names apply as written.
2. If it is not listed, answer in the user's language with three things and stop:
   - one sentence on what lit-schematic makes;
   - that it moved out of LitHermes into `variants/lithermes/lit-schematic` of `wjgoarxiv-skills`;
   - the install line below, in a code block, and that a new Hermes session (or a restart) picks it up, after which
     the user asks again.

## Install for Hermes

One skill, copied into the active profile (`HERMES_HOME` selects a profile; the default is `~/.hermes`):

```bash
mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills"
cp -R "<path to your wjgoarxiv-skills clone>/variants/lithermes/lit-schematic" "${HERMES_HOME:-$HOME/.hermes}/skills/"
```

The copy lands in `skills/lit-schematic/` of the profile, beside LitHermes rather than inside it. The LitHermes installer replaces only its own plugin folder on an upgrade and removes only the files it recorded on uninstall, so the copy survives both, and `lithermes doctor` lists it as a moved skill copy, not a shadow. This stub stays as `lithermes:lit-schematic` and keeps the `/lit-schematic` command, which Hermes runs before the copy's own and which hands over to the copy. To update the copy, replace `skills/lit-schematic/` with a fresh one.

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

- Hand-writing an SVG P&ID because the real skill and its symbol kit are missing.
- Inventing set points, line sizes or dimensions to fill a drawing this stub cannot make.
