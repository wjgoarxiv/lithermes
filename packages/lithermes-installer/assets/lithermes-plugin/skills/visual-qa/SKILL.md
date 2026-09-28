---
name: visual-qa
description: Hermes-native visual evidence gate.
---

## #contract.activation

```yaml
schema_version: lithermes_llm_contract/v1
skill_id: visual-qa
surface: Hermes-native skill and UI-shaped context hook
```

```json
{"schema_version":"lithermes_llm_contract/v1","skill_id":"visual-qa"}
```

## #contract.inputs

Require a beta contract, material PNG root, hashes, freshness, cleanup, and host provenance when required. Alpha cannot PASS.

## #contract.mode_matrix

| Mode | Trigger | Contract |
| --- | --- | --- |
| smoke | Critical surface | Material beta evidence; zero review hashes/receipts |
| full | Complete inventory | Block without host-owned review provenance |
| blocked | Capability absent | Emit exact `BLOCKED_*`; never downgrade |

## #contract.procedure

Probe host capture. Validate opened bytes, hashes, freshness, inventory, timeout/cancel, and cleanup. Track per-child re-entry receipts as diagnostics; no combined wait. The parent tracks and merges each accounted receipt.

## #contract.outputs

Return evidence or exact blockers: `BLOCKED_RENDERER_UNAVAILABLE`, `BLOCKED_AUTH_UNAVAILABLE`, `BLOCKED_CAPTURE_PROVENANCE_UNAVAILABLE`, `BLOCKED_EVIDENCE_STALE`, `BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED`, `BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE`. Beta always needs `--evidence-root`, hash-matched regular PNGs, and a typed host-owned capture receipt unavailable to public JSON input. Alpha is diagnostic-only; full/reference-fidelity also block without review provenance.

## #contract.evidence

Canonical `litfamily.design-contract/v1beta2`; valid `litfamily.design-contract/v1beta1` is evidence-eligible compatibility input; `litfamily.evidence-manifest/v1beta1` is a separate schema. See `references/complete-contract.md`.

## #contract.hard_stops

No install, profile sharing, auth persistence, cross-repo daemon, or host-config mutation. Self-review cannot PASS.

## #contract.anti_patterns

Reject prose PASS, stale images, HTTP-as-render proof, and incomplete cleanup.
