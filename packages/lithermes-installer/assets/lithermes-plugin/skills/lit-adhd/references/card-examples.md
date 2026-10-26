# lit-adhd brief examples

Both examples render the same collector JSON. Gauges, ids, titles and names are copied from it
verbatim; only the connecting words change with the language. The JSON excerpt comes first.

```json
{
  "summary": { "sessions": 3, "waitingOnUser": 1, "active": 1 },
  "sessions": [
    { "id8": "655f39d3", "title": "ADHD lane", "asked": ["build the collector"], "done": { "tools": { "edit_file": 2 }, "commits": [{ "hash": "bdea372", "subject": "feat(adhd): collect cross-session records" }] }, "status": "waiting-on-user", "waitingReason": "asked the user", "progress": { "gauge": "[▉▉▉▉░░░░░░] 10/19", "remaining": ["11. Skill lit-adhd", "12. go continues"] } },
    { "id8": "f06fb727", "title": "pptx lane", "asked": ["fix the deck QA"], "done": { "tools": {}, "commits": [] }, "status": "active", "progress": { "gauge": "[…] running", "remaining": ["unknown"] } },
    { "id8": "2fad84a7", "title": "schematic lane", "asked": ["render the figure"], "done": { "tools": { "bash": 4 }, "commits": [] }, "status": "ended", "progress": { "gauge": "[▉▉▉] 3/3", "remaining": [] } }
  ],
  "roadmap": { "progress": { "gauge": "[▉▉▉▉░░░░░░] 10/20" }, "plans": [{ "plan": "plans/lit-adhd.md", "local": true, "current": "11. Skill lit-adhd", "progress": { "gauge": "[▉▉▉▉░░░░░░] 10/19" } }], "plansOmitted": 0 },
  "startWork": [{ "id8": "f06fb727", "workId": "work-abc", "status": "paused", "pendingBoundary": { "boundary": "b-1" } }],
  "next": { "kind": "approve-boundary", "target": { "workId": "work-abc" }, "say": null },
  "sources": { "herdr": "unknown" }
}
```

## English

> lit-adhd: 3 session(s) · 1 waiting on you · next: approve boundary
>
> == ● waiting on you · 655f39d3 · ADHD lane
> asked: build the collector
> [▉▉▉▉░░░░░░] 10/19 · left: 11. Skill lit-adhd, 12. go continues
> did: edit_file ×2 · bdea372 feat(adhd): collect cross-session records
> next: answer its question
>
> == ▶ active · f06fb727 · pptx lane
> asked: fix the deck QA
> […] running
> next: answer in chat to approve or deny the boundary
>
> -- ended · 1 --
> | id | where | goal | ago | done |
> |---|---|---|---|---|
> | 2fad84a7 | unknown | schematic lane | · | used bash ×4 |
>
> -- roadmap --
> ▶ plans/lit-adhd.md [▉▉▉▉░░░░░░] 10/19 now: 11. Skill lit-adhd
>   ○ later: 12. go continues
> ✓ bdea372 2026-10-25 feat(adhd): collect cross-session records
>
> -- next --
> > approve boundary: work-abc. Answer in chat.
>
> unknown: herdr

## 한국어

> lit-adhd: 세션 3개 · 나를 기다리는 것 1 · 다음: approve boundary
>
> == ● 나를 기다림 · 655f39d3 · ADHD lane
> 요청: build the collector
> [▉▉▉▉░░░░░░] 10/19 · 남은 것: 11. Skill lit-adhd, 12. go continues
> 한 일: edit_file ×2 · bdea372 feat(adhd): collect cross-session records
> 다음: 질문에 답하기
>
> == ▶ 진행 중 · f06fb727 · pptx lane
> 요청: fix the deck QA
> […] running
> 다음: 채팅으로 경계를 승인하거나 거부하기
>
> -- 끝남 · 1 --
> | id | where | goal | ago | done |
> |---|---|---|---|---|
> | 2fad84a7 | unknown | schematic lane | · | used bash ×4 |
>
> -- roadmap --
> ▶ plans/lit-adhd.md [▉▉▉▉░░░░░░] 10/19, 지금: 11. Skill lit-adhd
>   ○ 나중에: 12. go continues
> ✓ bdea372 2026-10-25 feat(adhd): collect cross-session records
>
> -- next --
> > approve boundary: work-abc. 채팅으로 답하세요.
>
> 모름: herdr

## What the examples do not do

- They do not estimate the pptx lane's progress: with no count it reads `[…] running`, copied as is.
- They do not describe work the records do not show: the pptx lane's "did" line names tools and commits only.
- They offer one next step only, and do not start it.
- They never show `?`, `?/?`, `[???]` or `k/?`: an unknown total is the pulse line, and the examples carry none of the four.
