# Product direction and user journey

Use this reference when the request adds a product journey or changes who it serves. Record decisions in the task and Design Contract; do not invent a persona exercise for a small visual fix.

Map audiences, tasks, qualities, and constraints to the contract's `intent`.

## Define the operator and critical task

Describe the primary operator by job, device/input, assistive technology where relevant, expertise, usage frequency, and the cost of a wrong decision. Add only secondary audiences that change the design.

State the critical task as verb + object + observable completion condition. Record the current and intended steps, what must remain visible, and competing tasks that must not displace it.

## Set success measures

Choose observable measures before implementation: time to first useful action, completion rate, errors, keyboard completion, and one counter-signal that would indicate a regression. Use task-appropriate numbers rather than adjectives.

## Track material unknowns

For each unknown, record an id, how it will be resolved, and which decision it blocks. A gap blocks only the work that depends on it. Resolve by measurement or a focused question, then update its status; keep assumptions in the internal contract, not in reader-facing copy.

## Walk representative scenarios

For a new or materially changed journey, exercise the task with the relevant constraints: low vision/zoom, keyboard, screen reader, low bandwidth, and a longer or CJK locale. State the input, expected completion, and failure boundary. For a narrow component change, select only the scenarios it can affect.

## Compare choices and checkpoints

When a material product or visual direction remains open, present up to three distinct choices with beneficiaries, tradeoffs, and reversal cost. Do not fabricate alternatives when the request already settles the direction.

Use decision checkpoints only where the choice affects downstream work: operator/task, direction, inventory, and evidence review. Note the selected choice and reason so the implementation and reviewer share the same baseline.

## Handoff

Give the next stage the operator, critical task, success measures, open gaps, chosen direction, inventory, and contract id/hash when one exists. A concise task record is more useful than an unfiltered discussion transcript.
