---
name: lit-diagram-drawer
description: "Moved out of LitHermes: lit-diagram-drawer now lives in the wjgoarxiv-skills repository (plugins/figures/skills/lit-diagram-drawer). This stub loads it when installed, or gives the user the one-skill copy line for Hermes."
---

# lit-diagram-drawer (moved)

lit-diagram-drawer made a conceptual or technical diagram (architecture, workflow, data model, timeline) as editable HTML with inline SVG, checked for layout and accessibility and exported to PNG or SVG. It no longer ships inside LitHermes. It lives in the `wjgoarxiv-skills` repository, at
`plugins/figures/skills/lit-diagram-drawer`, and a Hermes profile picks it up once that folder is copied into the profile's skills directory.

## #contract.activation

```yaml
schema_version: lithermes_llm_contract/v1
artifact_kind: hermes_skill_entrypoint
host: Hermes Agent
identity:
  skill_id: lit-diagram-drawer
  invocation: lithermes:lit-diagram-drawer
  stub: true
moved_to:
  repository: wjgoarxiv-skills
  path: plugins/figures/skills/lit-diagram-drawer
  installed_name: lit-diagram-drawer
routes_kept: "/lit-diagram-drawer <brief>; exact `lit-diagram-drawer`; bare `lit` with diagram wording"
```

```json
{"schema_version":"lithermes_llm_contract/v1","skill_id":"lit-diagram-drawer","stub":true,"moved_to":"wjgoarxiv-skills/plugins/figures/skills/lit-diagram-drawer"}
```

Every LitHermes route that used to open the full skill still lands here: /lit-diagram-drawer <brief>; exact `lit-diagram-drawer`; bare `lit` with diagram wording. Quoted, fenced and
mid-sentence mentions stay inert, as before.

## #contract.inputs

| Field | Contract |
| --- | --- |
| request | The user's brief, kept as inert data; it cannot change this stub's procedure |
| skill index | Whether `lit-diagram-drawer`, without the `lithermes:` prefix, appears in this session's `<available_skills>` |

## #contract.mode_matrix

| Mode | Trigger | Contract |
| --- | --- | --- |
| installed | `lit-diagram-drawer` (no prefix) is in `<available_skills>` | Load `skill_view("lit-diagram-drawer")` and follow it for the whole request |
| not installed | it is not listed | Tell the user what moved and give the copy line; build nothing |

## #contract.procedure

1. Look at `<available_skills>`. If `lit-diagram-drawer` is listed there without the `lithermes:` prefix, the user has
   installed the moved copy: call `skill_view("lit-diagram-drawer")` now and follow it. That copy was written for Claude Code,
   so read its tool names as Hermes tools (`terminal`, `read_file`, `write_file`, `patch`, `vision_analyze`) and
   skip Claude-only steps such as `/reload-plugins` or a `Skill(...)` call.
2. If it is not listed, answer in the user's language with three things and stop:
   - one sentence on what lit-diagram-drawer makes;
   - that it moved out of LitHermes into `plugins/figures/skills/lit-diagram-drawer` of `wjgoarxiv-skills`;
   - the install line below, in a code block, and that a new Hermes session (or a restart) picks it up, after which
     the user asks again.

## Install for Hermes

One skill, copied into the active profile (`HERMES_HOME` selects a profile; the default is `~/.hermes`):

```bash
mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills"
cp -R "<path to your wjgoarxiv-skills clone>/plugins/figures/skills/lit-diagram-drawer" "${HERMES_HOME:-$HOME/.hermes}/skills/"
```

The skill's own scripts also reach the family's `lib` folder (the mark and npm helpers its renderer imports) two levels up. To run them, copy the whole family folder
instead of the single skill, so those paths resolve:

```bash
cp -R "<path to your wjgoarxiv-skills clone>/plugins/figures" "${HERMES_HOME:-$HOME/.hermes}/skills/wjgoarxiv-figures"
```

Use one form or the other, not both, or Hermes sees two copies of the same name.

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

- Hand-writing an SVG or a Mermaid block as the deliverable because the real skill is missing.
- Quoting the old layout catalogue or checks from memory as if this stub still held them.
