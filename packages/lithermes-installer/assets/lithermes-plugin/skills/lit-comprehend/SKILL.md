---
name: lit-comprehend
description: "Build a self-contained explainer artifact so a human can reason about completed work, not just know what happened."
---

# lithermes:lit-comprehend

Produce a single self-contained HTML explainer artifact so the reader can
**reason about** what was built or changed — not merely know that it happened.
The artifact lives outside the repository at
`~/.lithermes/lit-comprehend/YYYY-MM-DD-<slug>.html` and is never git-added.

This skill is distinct from `lit-recap`: recap answers "what happened" (status,
chronology); lit-comprehend builds the document a person needs to propose the
next change. The bottleneck after a long session is understanding, not
correctness.

```yaml
schema_version: lithermes_llm_contract/v1
artifact_kind: hermes_skill_entrypoint
plugin: lithermes
host: Hermes Agent
identity:
  skill_id: frontmatter.name
  invocation: "lithermes:<frontmatter.name>"
surfaces:
  manifest: plugin.yaml
  python_entrypoints: ["__init__.py:register", "core_routing.py bare/lit-prefixed token"]
  hooks: [pre_llm_call]
state:
  output_root: ~/.lithermes/lit-comprehend/
  payload_manifest: payload-version.json
```

```json
{
  "schema_version": "lithermes_llm_contract/v1",
  "input_contract": {
    "required": ["user_intent", "current_workspace", "frontmatter.name"],
    "optional": ["commit_range", "subsystem_path", "question", "litgoal_state"],
    "redaction": "redact secrets before durable logs or child-context handoff"
  }
}
```

| Mode | Trigger | Contract | Hard stop |
|---|---|---|---|
| direct skill | explicit `lithermes:<frontmatter.name>` load | Apply this schema first, then the detailed body below. | If the request does not match the frontmatter scope, route to the correct LitHermes skill or ask. |
| route injection | bare `lit-comprehend`, `comprehend`, or `lit comprehend` at message start | Obey the outer `core_routing.py` route contract first, then this skill contract. | Never activate on natural-language explanation requests. |
| worker lane | a Hermes `delegate_task` child receives this skill in its context | Return bounded findings/evidence to the parent; the parent owns synthesis and final claims. | Do not invent background workers, named agents, or non-Hermes orchestration. |

## #contract.activation

Named tokens only. Exact `lit-comprehend`, `comprehend`, or `lit comprehend` at
message start. The Hermes `$lit-comprehend` or `$comprehend` token, if the host
supports it, also activates.

**Never auto-activate on**: `explain`, `설명해줘`, `이해가 안 돼`, `what did you
do`, `recap`, `comprehension`, `incomprehensible`, or any natural-language phrase
requesting an explanation. False activation turns a one-line answer request into
a full artifact build.

## #contract.inputs

Scope selection — exactly one of:
- **Session** (default): bounded by the durable litgoal state or the current
  session's work. State what was excluded.
- **Commit range / branch / PR**: `lit-comprehend HEAD~5..HEAD`,
  `comprehend feature/auth`.
- **Path / subsystem**: `lit-comprehend src/lib/`.
- **Question**: `comprehend "why does the router split here?"`.

Uncommitted work counts. State the chosen scope explicitly.

## #contract.mode_matrix

| Surface | Behavior |
|---|---|
| bare `lit-comprehend` | Build explainer for session scope |
| bare `comprehend` | Same — short alias for `lit-comprehend` |
| `lit-comprehend <range>` | Build explainer for the specified diff/path/question |
| `comprehend <range>` | Same, via the short alias |
| `lit comprehend <range>` | Same, via the `lit` prefix route |

## #contract.execution_gate

Before building the artifact, decide whether the scope needs user confirmation.

**Execute immediately** when the invocation names its target explicitly:
- A path: `lit-comprehend src/hooks/`
- A git range, branch, or PR: `comprehend HEAD~5..HEAD`, `comprehend feature/auth`

**Confirm first** when the agent must infer the target set:
- No arguments: bare `lit-comprehend` or `comprehend`
- Prose question: `comprehend "why does the router split here?"`

The confirmation step is cheap — derive it from `git status`, `git diff --stat`,
and the litgoal ledger timestamps. Do NOT read the full tree at this stage.
Present on one screen:

- **대상**: the file/commit set and its countable size (N files / +M lines;
  if bounded by a ledger timestamp, state the boundary)
- **제외**: what was deliberately omitted (e.g. files dirty before the session)
- **예상**: approximate shape (number of themes, quiz question count, "수 분 소요")
- **If the request looks answerable in one or two sentences**, propose that
  cheaper alternative explicitly before offering to build the full artifact

Then wait for the user's approval before proceeding.

Do not claim the artifact exists before it is actually written. Do not read the
full diff during the gate — that happens in step 1 after approval.

## #contract.procedure

### 1. Read before explaining

- The real diff (`git diff`, `git log`), not a summary.
- The CURRENT contents of every file you will quote — open it and read.
- Durable litgoal state (`goals.json`, `ledger.jsonl`) if present.
- Consult relevant durable records when they help explain the change. Keep the
  detailed verification trail in the internal journal; surface a missing record
  only when it materially changes what the reader should understand or do.

### 2. Delta anchoring

Explain against what the reader ALREADY knew — their objective, the brief, the
ledger's first timestamp. Not a tutorial from zero. This is the single most
important idea in the artifact.

### 3. Conceptual order, not file order

Group changes into 3-6 named themes ordered so each theme is comprehensible
from what came before. Place each code excerpt where the reader has a reason to
care about it. Never walk file-by-file.

### 4. Intuition before mechanism

- Toy data reused across the whole document.
- 2-3 reusable diagram families: pipeline, before/after, state/timeline,
  simplified UI. Built from HTML/CSS, never ASCII art.

### 5. Micro-world

A small interactive widget — faithful miniature, slider, step-through, or
old/new toggle — so the reader can feel the behavior. Always labelled as a
simplified model. Omit for purely structural changes.

### 6. Reader-facing qualifications and sources

Write the explainer for the person who needs to understand the change. Do not
add a dedicated honesty ledger, evidence table, confidence badge, or source
label to each claim. Keep command output, verification status, missing records,
and the detailed reasoning trail in the internal journal. If uncertainty or a
limitation changes the conclusion or a useful next action, state it once in the
chat reply in plain language. In the artifact, use relevant citations naturally
where they help a reader check a source; do not require a citation for every
sentence or claim.

### 7. Quiz

5 questions (3 for a small change). Every option gets feedback explaining why.
No positional tell (vary the correct-answer slot). No length tell (keep option
lengths even). The quiz is a speed regulator, not a grade.

### 8. Code attribution

Every code excerpt in the artifact must carry a `data-src` attribute naming the
file it came from:

```html
<pre data-src="src/lib/router.ts:88-104">
export function matchRoute(path: string) { ... }
</pre>
```

The path is repo-relative; an optional `:startLine-endLine` anchor narrows the
cite. This is not decoration — it is what lets the verifier open that file and
confirm the quoted lines actually exist. Without it, the explainer's strongest
anti-fabrication check (the phantom-quote guard) silently grades nothing, and
the artifact becomes a plausible story about code that may not exist.

The verifier will FAIL if any `<pre>` code block lacks the `data-src` attribute.
If a code change walkthrough has no code excerpts, the verifier issues a warning.

### 9. Build the artifact

One self-contained HTML file. All CSS/JS inlined, no external resources (no
CDN, no fetch, no remote images). Written to
`~/.lithermes/lit-comprehend/YYYY-MM-DD-<slug>.html`. Never inside the repo
worktree. Never git-added.

Use the bundled scaffold at `assets/explainer-scaffold.html` as the structural
template. Populate the canonical sections.

### 10. Run the verifier

Run `scripts/verify-explainer.py <artifact-path> --repo <worktree>` from the
installed skill root. The verifier exits nonzero on failure. The skill must not
claim completion until the verifier passes. Keep its full transcript in the
internal run record; report the result briefly unless the user asks for detail.
Fix any reported defects and re-run.

## #contract.outputs

### Canonical sections

Use these Korean headers in this order as the explainer's useful structure:

1. **한눈에** — one-paragraph orientation
2. **이미 알고 있던 것** — the reader's starting position (delta anchor)
3. **직관** — essence of each theme; toy data, diagrams
4. **바뀐 것** — literate walkthrough in conceptual order
5. **직접 만져보기** — micro-world widget (omit for structural-only changes)
6. **퀴즈** — interactive quiz
7. **다음** — concrete next entry points

Do not add a fixed source/evidence or verification-status section. Keep useful
citation links in ordinary prose or a conventional references list when the
chosen format calls for one. Reader-facing explanations do not need exhaustive
claim-by-claim proof; retain that detail in the internal research journal.

### Language

Korean prose by default. `--en` switches the body to English but headers stay
Korean. `--md` produces a Markdown fallback (no interactive quiz or micro-world).
Technical tokens (file paths, commands, identifiers, versions, error strings)
stay verbatim in every language mode.

### Proportion

- **Small change** (one theme): one diagram, no micro-world, 3 quiz questions.
- **Overnight / multi-subsystem**: add a map section, state what was compressed.

## #contract.output_channels

```yaml
artifact_genre: client_deliverable
limitations_channel: reply
```

## #contract.evidence

- Every code quote carries a `data-src` attribute naming the quoted file.
- The verifier checks that quoted lines actually exist in the cited file.
- Keep command transcripts, test results, and status ledgers in internal records.
- Add source citations in the artifact when they help check a material factual
  statement; do not turn them into per-claim labels or a verification table.

## #contract.hard_stops

- Never claim the verifier passed unless it ran and returned success. Keep the
  full transcript in the internal run record.
- Never place the artifact inside the repository worktree.
- Never use external resources (CDN scripts, remote images, fetch calls).
- Never fabricate code quotes — read the file first, quote what exists.
- Never present the micro-world as the real code. Label it as a simplified model.
- Preserve meaningful caveats and real sources for factual claims; do not invent
  support or hide a limitation that changes the reader's decision.
- Never build the artifact without passing the execution gate first.

## #contract.anti_patterns

- File-by-file walkthrough instead of conceptual grouping.
- Tutorial from zero instead of delta-anchored explanation.
- ASCII art instead of HTML/CSS diagrams.
- Quiz with all correct answers in the same position.
- Quiz with the correct answer always being the longest option.
- Collapsed/hidden code blocks (the verifier rejects them).
- Claiming completion before the verifier passes.
- Skipping the execution gate when the scope was inferred, not stated.
