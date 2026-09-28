# Phase 2 + 3 — Hypothesis Formation & Parallel Investigation

One hypothesis is a hunch. Three hypotheses is a decision. Investigation is how you turn the decision into runtime evidence.

---

## Phase 2 — Hypothesis Formation (Minimum Three)

### Why three, not one

A single hypothesis creates confirmation bias: you'll read runtime state looking for evidence that confirms it and unconsciously discount contradictions. Three hypotheses force you to design queries that *distinguish* between them, which is the only way runtime evidence becomes decisive.

### Generate across orthogonal axes

If your three hypotheses are all variations of "the handler has a bug", you don't actually have three hypotheses. Span the space:

| Axis | Example framing |
|---|---|
| **User-code logic** | "The handler early-returns because condition X is unexpectedly true" |
| **Library/SDK behavior** | "The third-party client swallows the error and returns a stub" |
| **Environment/config** | "The env var is read at module-load time before it gets populated, so it's empty" |
| **Async/timing** | "The promise rejects (or goroutine panics) after the response is already sent" |
| **Silent side-effect** | "An earlier turn mutated shared state that the current turn inherits" |
| **Observability gap** | "The error is raised but suppressed before logging; it only exists as an unawaited rejection / ignored signal" |
| **Binary-level** (when applicable) | "The function we think is running is actually jumped over by a patched thunk / a different version loaded" |
| **Build-vs-runtime** | "The code we're reading is not the code that's running — stale build, wrong symlink, cached wheel, or dist/ ahead of src/" |

### For each hypothesis, write in the journal

1. **Claim** — one sentence.
2. **Distinguishing evidence** — the exact value or state that confirms or refutes it, AND where to read it (file:line, log source, breakpoint location, memory address).
3. **If true, the fix is** — two words. Forces you to think through fix cost before committing to the hunt.

### Collapse rule

If two hypotheses have identical distinguishing evidence, they aren't actually different — collapse them and find a real alternative. If you can't come up with a third distinct hypothesis, you don't understand the system well enough yet. Go read a little more code before investigating.

---

## Phase 3 — Parallel Investigation

In Hermes the **only** way to fan out is the native **`delegate_task`** tool: call it
once with a batch of child tasks. They run in parallel, top-level dispatch returns
immediately, and each result re-enters separately. The parent tracks and merges the
per-child receipts; it does not block on a combined return. There is no `team_*` registry, no named-agent spec, no
`subagent_type`, and no per-child model selection — each investigation role is just a
child task whose `goal`/`context` inlines that role's mandate. Fan out whenever you have
≥3 hypotheses and any of them would take >10 minutes to investigate single-threaded.

**Assignment rule**: one hypothesis → one child task. Give each hypothesis to the role
whose evidence source is most likely to confirm or refute it, and inline the full
hypothesis list in every child's `context` so each knows what the others are testing.
Children investigate and report evidence only — they do **not** edit source code, and any
instrumentation statement (`breakpoint()`, `debugger;`, `dbg!`, etc.) is added by you, the
orchestrator, after a child requests it.

Dispatch the batch in a single `delegate_task` call. Roles to inline as child mandates:

```
delegate_task(tasks=[
  {
    role: "leaf",
    goal: "Runtime State Inspector for hypothesis <n>",
    context: "Attach to the live process, hit breakpoints, read program state (variables, heap, goroutines, stack, registers depending on runtime), and report observed values verbatim. Never guess — if you don't see the value, say so. Return file:line / address references with captured values. Never edit source code; never run git commands. If you need an instrumentation statement added, say so in your report and stop. [Inline: bug summary + which hypothesis you own + the full hypothesis list.]"
  },
  {
    role: "leaf",
    goal: "Log Archaeologist for hypothesis <n>",
    context: "Grep server logs, stderr streams, SDK-internal debug output (DEBUG env, RUST_LOG, GODEBUG, PYTHONASYNCIODEBUG), and correlate timestamps. Produce a timeline of events with latencies. Flag anything that looks like a silent catch, a swallowed rejection, a panic recovered-and-ignored, or a success response that hides failure signals (HTTP 200 with empty body, stopReason=error, exit 0 with error-in-stdout). Never edit source code. [Inline the hypothesis context.]"
  },
  {
    role: "leaf",
    goal: "Reproduction Engineer for hypothesis <n>",
    context: "Build the smallest reliable repro — a curl command, a vitest/pytest/go test, a tmux script, a Playwright script for browser bugs, a pwntools script for binary targets. It must reproduce on first try and be copy-pasteable. Document exact input, expected output, observed output. Save repro artifacts under /tmp/ and name them in your report so the orchestrator can journal them. If the bug is browser-based you MUST use Playwright CLI — do not simulate with curl. [Inline the hypothesis context.]"
  },
  {
    role: "leaf",
    goal: "Trace Correlator",
    context: "Take the findings the other children returned and cross-link them. Build a causal chain from symptom to suspected cause. Identify missing evidence. Propose the next single most-decisive runtime query. Never edit source code; only reason across already-captured evidence. If hypotheses diverge sharply after correlation, flag it loudly — that is the signal for the verification triple. [Inline the captured evidence.]"
  }
])
```

**Orchestrator responsibilities** (you keep these — children never do them):
- Maintain the journal; children return evidence, you record it.
- Approve and apply any source-code edits (including `debugger;` / `breakpoint()` / `dbg!`).
- Synthesize child reports into updated hypothesis statuses.

Hermes re-enters each hypothesis result as a separate message. The parent records and merges
per-child re-entry receipts until every hypothesis is accounted for; there is no combined wait. When fewer hypotheses are in play, dispatch a smaller batch — same rule:
one hypothesis per child. The independent verification triple is **not** part of this
batch; it runs separately in Phase 4 (see `04-oracle-triple.md`).

After dispatching, end your response. Update each hypothesis when its corresponding report
re-enters, and synthesize only after the parent tracker closes the batch.

---

## Evidence capture discipline (both paths)

For every piece of runtime state captured, record in the journal:

```markdown
### <ISO timestamp> — <what you looked at>
- Source: <file:line | log source | curl command | breakpoint address>
- Value: `<verbatim>`
- Interpretation: <one line — why this matters>
- Refutes/Confirms: H<n>
```

**Verbatim values only. No paraphrasing.**

- `messages.length=0` is evidence.
- "messages seemed empty" is not evidence — it's a memory of an observation, and memory of observations is where debug sessions go to die.

If you find yourself about to paraphrase, stop, go back, and copy the raw value.

---

## Round completion

A "round" is complete when every hypothesis has either confirming or refuting evidence — or when you have exhausted the evidence sources available without a decisive result. If the round ends inconclusively, that counts as a failed round for the counter in the journal. See `04-oracle-triple.md` for what to do at 2 consecutive failed rounds.
