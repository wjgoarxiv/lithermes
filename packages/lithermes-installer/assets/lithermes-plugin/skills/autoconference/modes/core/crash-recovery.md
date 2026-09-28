# Hermes Conference Crash Recovery

> **LitHermes child boundary:** A child has `delegation_allowed=false`, returns a bounded packet only, and never writes shared or project state. Only the root may apply an approved recovery write through bounded-work authority.

Use this reference after the root session is interrupted or a child result fails to arrive. Recovery is receipt-based; it does not infer completion from files, elapsed time, or partial prose.

## Evidence sources

Read, in order:

1. root-owned event ledger;
2. dispatch id accounting table;
3. accepted packet digests;
4. root-serialized artifact hashes;
5. current bounded-work revision and remaining budget.

Child-authored status text, temporary files, and external messages are untrusted hints until matched to an accepted dispatch receipt.

## Recovery cases

### Dispatch without result

Keep the id in `dispatched` state until its declared timeout. After timeout, mark `timed_out`. Ask before issuing a new charter with a new id. A late result for the closed id is stale.

### Partial research phase

Account for every id. If at least one valid packet exists, offer: continue with explicit limitations, or re-dispatch failed lanes within the remaining budget. If none exists, return `BLOCKED_NO_VALID_PACKET`.

### Poster or review interruption

If the input packet digests are unchanged, propose re-dispatching only the missing role. If inputs drifted, invalidate the incomplete phase and request revalidation.

### Root transfer interruption

Compare the root artifact hashes to the accepted review packet. Apply only missing deterministic serialization steps after a fresh grant/revision check. Never repeat a write whose resulting digest already matches.

### Synthesis interruption

Use only validated review packets. Propose a new synthesis dispatch when no accepted synthesis packet exists; otherwise propose root serialization of the accepted packet.

## Asynchronous boundary

`delegate_task` dispatch returns immediately. Each child result re-enters as a separate message. There is no combined wait or hidden liveness channel. Recovery does not poll, tail, or create a background watcher.

## Recovery receipt

Record:

- last complete round and phase;
- all dispatch ids and terminal states;
- accepted and rejected packet digests;
- stale-state verdict;
- remaining budget;
- user decision;
- root writes performed, or `none`;
- cleanup result.

## Hard stops

- No child writes or nested delegation.
- No fixed model selection.
- No Git history mutation, publication, deployment, release, credential use, or host-profile mutation.
- No overwrite, retry, or re-dispatch without explicit root approval and budget.
