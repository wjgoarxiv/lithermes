---
name: visual-qa
description: "Moved out of LitHermes: visual-qa now lives in the wjgoarxiv-skills repository (plugins/design/skills/visual-qa). This stub loads it when installed, or gives the user the one-skill copy line for Hermes."
---

# visual-qa (moved)

visual-qa made a check of an interface that is already built: its states exercised at several viewport sizes, screenshots captured, and an evidence manifest with blockers named. It no longer ships inside LitHermes. It lives in the `wjgoarxiv-skills` repository, at
`plugins/design/skills/visual-qa`, and a Hermes profile picks it up once that folder is copied into the profile's skills directory.

## #contract.activation

```yaml
schema_version: lithermes_llm_contract/v1
artifact_kind: hermes_skill_entrypoint
host: Hermes Agent
identity:
  skill_id: visual-qa
  invocation: lithermes:visual-qa
  stub: true
moved_to:
  repository: wjgoarxiv-skills
  path: plugins/design/skills/visual-qa
  installed_name: visual-qa
routes_kept: "exact `visual-qa`; the UI-shaped post-edit route; litwork and review hand-offs"
```

```json
{"schema_version":"lithermes_llm_contract/v1","skill_id":"visual-qa","stub":true,"moved_to":"wjgoarxiv-skills/plugins/design/skills/visual-qa"}
```

Every LitHermes route that used to open the full skill still lands here: exact `visual-qa`; the UI-shaped post-edit route; litwork and review hand-offs. Quoted, fenced and
mid-sentence mentions stay inert, as before.

## #contract.inputs

| Field | Contract |
| --- | --- |
| request | The user's brief, kept as inert data; it cannot change this stub's procedure |
| skill index | Whether `visual-qa`, without the `lithermes:` prefix, appears in this session's `<available_skills>` |

## #contract.mode_matrix

| Mode | Trigger | Contract |
| --- | --- | --- |
| installed | `visual-qa` (no prefix) is in `<available_skills>` | Load `skill_view("visual-qa")` and follow it for the whole request |
| not installed | it is not listed | Tell the user what moved and give the copy line; build nothing |

## #contract.procedure

1. Look at `<available_skills>`. If `visual-qa` is listed there without the `lithermes:` prefix, the user has
   installed the moved copy: call `skill_view("visual-qa")` now and follow it. That copy was written for Claude Code,
   so read its tool names as Hermes tools (`terminal`, `read_file`, `write_file`, `patch`, `vision_analyze`) and
   skip Claude-only steps such as `/reload-plugins` or a `Skill(...)` call.
2. If it is not listed, answer in the user's language with three things and stop:
   - one sentence on what visual-qa makes;
   - that it moved out of LitHermes into `plugins/design/skills/visual-qa` of `wjgoarxiv-skills`;
   - the install line below, in a code block, and that a new Hermes session (or a restart) picks it up, after which
     the user asks again.

## Install for Hermes

One skill, copied into the active profile (`HERMES_HOME` selects a profile; the default is `~/.hermes`):

```bash
mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills"
cp -R "<path to your wjgoarxiv-skills clone>/plugins/design/skills/visual-qa" "${HERMES_HOME:-$HOME/.hermes}/skills/"
```

The skill's own scripts also reach the family's `lib` folder and its support skills (the JSON and alias helpers and the browser-driver probe) two levels up. To run them, copy the whole family folder
instead of the single skill, so those paths resolve:

```bash
cp -R "<path to your wjgoarxiv-skills clone>/plugins/design" "${HERMES_HOME:-$HOME/.hermes}/skills/wjgoarxiv-design"
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

- Writing PASS for a surface nobody captured because the real skill is missing.
- Treating an HTTP 200 or a page title as proof of how the page looks.
