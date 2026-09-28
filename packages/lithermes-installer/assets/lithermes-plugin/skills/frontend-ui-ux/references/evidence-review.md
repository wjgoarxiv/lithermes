# Independent evidence review

A builder brings assumptions into review. Have a fresh context inspect the built revision against the same Design Contract and evidence. The builder cannot issue its own independent verdict.

Declare review and cleanup needs under `evidence_policy`.

## Walk the task and meaningful states

For each primary task, check whether the intended control is visible, understandable, and produces observable progress. Cover relevant classes: intended path; first-run or empty; longest/smallest content and narrow viewport; failure and recovery; interruption or duplicate action; permissions; and supported locales.

Apply the contract's accessibility and behavior requirements. Use inclusive-interface.md for the detailed channel checklist; do not repeat it in the final artifact or surface copy.

## Optional narrative check

When the task has an implied narrative or progression, reviewers may ask whether it has the intended semantic feel. This is advisory discussion, not schema fields; it does not assign a rendered verdict. visual-qa owns rendered evidence and verdicts.

## Record findings reproducibly

Internal observation records should identify capture, route/state, viewport, theme, locale, reduced-motion setting, source revision, hash, action, result, expected behavior, and the contract rule or criterion. Redact credentials, private URLs, and personal data before handoff.

Give each finding an id, severity (critical/high/medium/low), status, and cold-start reproduction steps with exact input. State what happened, what should have happened, and which rule failed. A finding without reproduction is not actionable.

Severity follows user impact: critical prevents task completion; high forces a workaround; medium adds effort; low is cosmetic. Do not lower severity to avoid the cost of a fix.

## Handoff and verdict

The internal review package contains the contract hash, source revision, captures for the declared inventory and relevant themes/viewports, observations, findings, cleanup status, and independent reviewer receipt. Use the repository's evidence schemas when enabled; do not invent parallel fields.

- **PASS:** two independent review receipts are complete; no unresolved critical or high finding; remaining exceptions are recorded and accepted by an owner.
- **REVISE:** actionable fixes remain; update and recapture affected surfaces.
- **FAIL:** behavior prevents task completion or contradicts an explicit contract requirement.
- **BLOCKED:** required evidence cannot be obtained; record the missing surface, reason, attempts, and cleanup.

Do not imply a rendered PASS from a clean static scan. Keep manifests, hashes, certainty labels, and audit ledgers in internal evidence. The user-facing result should state the verdict and material risk plainly; do not require those labels in the interface or ordinary deliverable.
