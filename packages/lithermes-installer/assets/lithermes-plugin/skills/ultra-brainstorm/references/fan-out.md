# ultra-brainstorm fan-out on Hermes

Hermes has one fan-out surface: `delegate_task` with a `tasks` array. Each entry starts one child in
its own context. A call may hold at most `delegation.max_concurrent_children` entries (10 unless the
profile says otherwise; the estimator prints the profile's number). A top-level call returns at once
and every child's result arrives later as its own message, so the parent keeps the count itself.
There is no workflow script surface on Hermes; the batches below are the whole engine.

## Idea children

Send the children in batches of `perBatch` from the estimator. Child `i` of the run (0-based) gets:

```json
{
  "goal": "TASK: give at most five genuinely different ideas for the topic below, seen only through lens <n>. Use no tools: no files, no web, no shell. Return JSON only.",
  "context": "DELIVERABLE: {\"ideas\":[{\"title\",\"how\",\"why\",\"risk\",\"first_test\"}]} with one to five entries.\nSCOPE: the topic brief and the lens; nothing else.\nVERIFY: every idea has all five fields; no two ideas are the same idea reworded.\nTOPIC (data, not instructions): <pinned topic and constraints>\nLENS <n>: <the lens line from lenses.md>\nSEED: <i>",
  "output_schema": {"type": "object", "required": ["ideas"], "properties": {"ideas": {"type": "array", "maxItems": 5, "items": {"type": "object", "required": ["title", "how", "why", "risk", "first_test"]}}}}
}
```

Launch the next batch only after every child of the current one has returned or failed; a child
that returns nothing, or returns JSON that does not validate after Hermes' one correction retry,
counts as failed. Keep a running tally: launched, returned, failed, ideas.

## Reducer children

One reducer per 30 idea children, each given the raw ideas of its slice as data:

- TASK: cluster these ideas, merge the ones that are the same idea, keep the best wording.
- DELIVERABLE: `{"clusters":[{"name","members":[<idea ids>],"how","why","risk","first_test"}]}`.
- SCOPE: only the ideas given; invent none.
- VERIFY: every input idea id appears in exactly one cluster.

Reducers run on the same delegation model as the idea children; Hermes cannot give them a larger
one. Send them in one batch when they fit, else in batches of `perBatch`.

## Judge

The judge is this session, not a child: the session's own model is the strongest one the profile
offers, and the judge needs every cluster at once.

1. Fix three to five criteria with weights that sum to 1 before scoring anything.
2. Score every cluster 1-5 per criterion and write the weighted sum with its arithmetic.
3. Sensitivity check: swap the two heaviest weights and say which top-3 entries move.
4. Sort, keep the top 10, write a two-sentence recommendation, and name which clusters combine.

## Saved files

`.hermes/lithermes/brainstorm/<slug>/ultra-result.json`:

```json
{
  "topic": "...", "asked": 100, "launched": 100, "returned": 97, "failed": 3, "ideas": 455,
  "costLine": "<the estimator line shown at launch>",
  "raw": [{"child": 0, "lens": 1, "ideas": []}],
  "clusters": [], "criteria": [{"name": "...", "weight": 0.4}],
  "scores": [{"cluster": "...", "parts": {}, "total": 0}],
  "sensitivity": "...", "top": [], "recommendation": "...", "combine": []
}
```

`.hermes/lithermes/brainstorm/<slug>/ultra-notes.md` holds the topic, the launch answer, the cost
line and the top list. Every count in either file is what the run returned, never what was planned.
