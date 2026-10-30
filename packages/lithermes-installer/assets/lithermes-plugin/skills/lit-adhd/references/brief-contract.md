# lit-adhd brief contract

The brief the model writes from one collector run. Three opener lines, then five parts, in order:
headline, one card per session, roadmap timeline, paused work, one next step. Dense, pretty,
plain words.

## The opener

Three lines before the headline, each from records only:

- `Done so far:` (`지금까지:`) — this worktree's newest commits in the window (two at most), then
  its finished start-work runs (`plans/<f>.md (start-work complete)`) and its plans with every
  row ticked, three items in all. With none: "nothing finished in this window".
- `Doing now:` (`지금:`) — this session's active discipline frame, else its own running
  start-work with the gauge, else the newest active session's goal, else another session's
  running start-work marked `(another session)`. With none: "nothing running".
- `Next:` (`다음:`) — the same one step the box at the end names, with its slash command.

The plain-text render prints the three lines as they are; Hermes shows them as plain text, so no
fence or tag wraps them.

## Forbidden glyphs (A)

Only real gauges and known-facts lines reach the user. The brief, every card, and every status
line show a gauge when both numbers are real, and the pulse line otherwise: an indeterminate
pulse plus the finished count (`[…] 3 steps`), or the bare pulse (`[…] running`) when nothing
is counted. The placeholder shapes `?/?`, `[???]` and `k/?` appear on none of the three
surfaces; a session id with no recorded value reads `unknown`.

## The five parts (B)

1. **Headline.** `N session(s) · M waiting on you · next: <kind>` in the user's language, with the
   next step's slash command when `next.command` names one. The headline is the counts-only
   status line: session counts first, then the local plan and goal gauges, each a real `k/n`
   from the first source that knows it (run progress, then plan checkboxes, then goal
   criteria). No second status line is written.
2. **Cards for live sessions, a table for ended ones.** Each waiting, active or unknown
   session gets a full card: status badge, goal in plain words (the first ask, clipped), the
   real gauge or the known-facts line, `now:` naming the last tool call on active sessions,
   `did:` with tool names and commit hashes, `next:` only when the session waits on
   something. Group under the worktree when sessions span more than one. Ended sessions
   collapse to one table row each (newest first, at most eight): id, worktree folder, goal,
   age in the largest unit under an `ago` header, done as commit count or tools used; more
   ended sessions than fit read `…(+N more ended)`. Hermes records no changed-file list,
   so the table never shows one.
3. **Roadmap timeline.** `✓` landed commits with dates, `▶` the current item of each open plan
   with its gauge, `○` remaining names, then litgoal objectives with gauges. Other worktrees'
   plans carry their worktree name. `plansOmitted` above zero is stated. Only plans changed
   inside the window are listed, this worktree's included: a stale plan is left out. A plan
   with every row ticked is finished work (`finished.plans`, named in the opener), never roadmap.
4. **Paused work.** Each paused bounded-work run with its gauge and an approval offer in words.
   Approval stays with the user: a chat answer approves or denies, and only the bounded-work
   grant settles it. The brief never starts, approves, or denies anything itself.
5. **One next step in a box.** Exactly the `next` record: what it does, then the slash command
   (`/start-work plans/<f>.md`) when `next.command` names one, otherwise "continue in chat".
   When `next` is `wait-lanes`, other lanes are at work (`lanes.count`): the box says to wait
   for them or to answer the one waiting on the user, names no command, and the last line is
   `Do not type \`go\` until they finish.` (`지금은 \`go\`는 입력하지 마세요.`).
   When `next` is `none`, the box shows the suggestion, in this order — a waiting session to
   answer, lanes at work to wait for (same last line), an open plan item, the first open item
   under `## Next` in this worktree's newest HANDOFF file (`HANDOFF.md Next: <item>`; items
   marked ✅, ✓, `[x]`, ~~struck~~, DONE or SHIPPED are skipped), another active session to
   check, another ended one to pick up — and the headline names it; it is shown, never
   recorded. Another worktree's handoff never supplies the step. Never a second candidate,
   never a `go` to type: Hermes has no typed `go` command.

## Surface notes (C, D)

- The Hermes chat surface is not animated and carries no colour, so the psychedelic look does
  not port. The brief is plain text; no colour escape ever enters the collector JSON.
- lit-adhd asks no theme or preset, so the ask-first rule does not apply to this skill. It
  applies to the design skills, which ask with `clarify` before generating anything.

## Closing lines

- Name every `unknown` source once on the last line (`unknown: herdr, git`); while lanes work,
  the no-`go` line follows it as the very last line.
- Say "older sessions were not read" when `budget.exhausted` is true.
- Say "N plans were not read (read budget used up)" when `roadmap.plansSkipped` is above zero.
  Plans are read before session transcripts, so this happens only when the plans themselves
  fill the 8 MiB budget.
- Name the collector failure and stop with `BLOCKED:` when the collector fails; never rebuild
  the brief from memory, from the session store, or from a guess.
