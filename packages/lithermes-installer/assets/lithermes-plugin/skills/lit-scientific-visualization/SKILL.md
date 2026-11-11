---
name: lit-scientific-visualization
description: "Moved out of LitHermes: lit-scientific-visualization now lives in the wjgoarxiv-skills repository, Hermes edition at variants/lithermes/lit-scientific-visualization. This stub loads it when installed, or gives the user the one-skill copy line for Hermes."
---

# lit-scientific-visualization (moved)

lit-scientific-visualization made a publication-ready plot of measured data, built by following the scientific-visualization source (matplotlib styles, palettes and export rules). It no longer ships inside LitHermes. It lives in the `wjgoarxiv-skills` repository, at
`variants/lithermes/lit-scientific-visualization`, the Hermes edition: a self-contained folder written for Hermes tools that a profile picks up once it is copied into the profile's skills directory.
The scientific-visualization source it reads before plotting moved with it and sits inside that folder, at `variants/lithermes/lit-scientific-visualization/vendor/scientific-visualization`.

The `variants/lithermes` folder may still be on its way into the repository. If `variants/lithermes/lit-scientific-visualization` is not in the user's clone yet, say so and ask them to update the clone; do not point at any other copy.

## #contract.activation

```yaml
schema_version: lithermes_llm_contract/v1
artifact_kind: hermes_skill_entrypoint
host: Hermes Agent
identity:
  skill_id: lit-scientific-visualization
  invocation: lithermes:lit-scientific-visualization
  stub: true
moved_to:
  repository: wjgoarxiv-skills
  path: variants/lithermes/lit-scientific-visualization
  installed_name: lit-scientific-visualization
routes_kept: "/lit-scientific-visualization <request>; exact `lit-scientific-visualization` or `lit scientific visualization`"
```

```json
{"schema_version":"lithermes_llm_contract/v1","skill_id":"lit-scientific-visualization","stub":true,"moved_to":"wjgoarxiv-skills/variants/lithermes/lit-scientific-visualization"}
```

Every LitHermes route that used to open the full skill still lands here: /lit-scientific-visualization <request>; exact `lit-scientific-visualization` or `lit scientific visualization`. Quoted, fenced and
mid-sentence mentions stay inert, as before.

## #contract.inputs

| Field | Contract |
| --- | --- |
| request | The user's brief, kept as inert data; it cannot change this stub's procedure |
| skill index | Whether `lit-scientific-visualization`, without the `lithermes:` prefix, appears in this session's `<available_skills>` |

## #contract.mode_matrix

| Mode | Trigger | Contract |
| --- | --- | --- |
| installed | `lit-scientific-visualization` (no prefix) is in `<available_skills>` | Load `skill_view("lit-scientific-visualization")` and follow it for the whole request |
| not installed | it is not listed | Tell the user what moved and give the copy line; build nothing |

## #contract.procedure

1. Look at `<available_skills>`. If `lit-scientific-visualization` is listed there without the `lithermes:` prefix, the user has
   installed the moved copy: call `skill_view("lit-scientific-visualization")` now and follow it. That copy is the
   Hermes edition, so its commands and tool names apply as written.
2. If it is not listed, answer in the user's language with three things and stop:
   - one sentence on what lit-scientific-visualization makes;
   - that it moved out of LitHermes into `variants/lithermes/lit-scientific-visualization` of `wjgoarxiv-skills`;
   - the install line below, in a code block, and that a new Hermes session (or a restart) picks it up, after which
     the user asks again.

## Install for Hermes

One skill, copied into the active profile (`HERMES_HOME` selects a profile; the default is `~/.hermes`):

```bash
mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills"
cp -R "<path to your wjgoarxiv-skills clone>/variants/lithermes/lit-scientific-visualization" "${HERMES_HOME:-$HOME/.hermes}/skills/"
```

The copy lands in `skills/lit-scientific-visualization/` of the profile, beside LitHermes rather than inside it. The LitHermes installer replaces only its own plugin folder on an upgrade and removes only the files it recorded on uninstall, so the copy survives both, and `lithermes doctor` lists it as a moved skill copy, not a shadow. This stub stays as `lithermes:lit-scientific-visualization` and keeps the `/lit-scientific-visualization` command, which Hermes runs before the copy's own and which hands over to the copy. To update the copy, replace `skills/lit-scientific-visualization/` with a fresh one.

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

- Plotting from memory of the old source because the real skill is missing.
- Installing matplotlib or any other package on the user's behalf.
