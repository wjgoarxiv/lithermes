Capture playbook: per-channel evidence, invalidation, and blocked outcomes

A capture is evidence only when another context can regenerate it from the fields written beside it.
Name the channel, surface, and tool before you look at the artifact.

## Outcome ranking

Label the outcome before writing the receipt; a wrong label is worse than none.

- An absent capability is **BLOCKED**. A capability that ran and rejected the work is **FAIL**.
- When both apply, BLOCKED outranks FAIL: an unreviewable surface is not a judged one.
- Reviewer verdicts `REVISE` and `FAIL` are review results, never blocked codes.
- Every BLOCKED receipt names surface, reason, attempts, and cleanup.

## Blocked vocabulary

Derive every code below with `visual_qa.py`; never hand-write a code.

- `BLOCKED_RENDERER_UNAVAILABLE`, `BLOCKED_AUTH_UNAVAILABLE`, `BLOCKED_TEST_ACCOUNT_UNSAFE`,
  `BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE`, `BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED` —
  `evaluate-capabilities`; full/reference always emits the review blocker until a host
  provenance adapter exists.
- `BLOCKED_CAPTURE_PROVENANCE_UNAVAILABLE` — beta material evidence reached the
  public JSON/CLI route without a typed in-process host capture receipt. File mtime,
  including a fresh mtime after copy/touch, never proves capture age.
- `BLOCKED_CAPTURE_PROVENANCE_UNVERIFIED` — a supplied host receipt does not match
  capture id, artifact descriptor identity/hash, source hash/revision, or declared time.
- `BLOCKED_EVIDENCE_STALE`, `BLOCKED_EVIDENCE_FUTURE` — a verified host receipt's
  `captured_at` sits outside `captured_at` .. `captured_at + maximum_age_seconds`
  against `--now`.
- `BLOCKED_CLEANUP_INCOMPLETE` — `validate-evidence`, when the cleanup receipt is not `complete` with its
  three flags true.
- `BLOCKED_REVIEW_TIMEOUT` — `validate-reviews`, on `timed_out` or an over-window receipt.
- `renderer_ownership` is a caller-supplied diagnostic: set it true only when the
  render target's PID, port, and command were all proven to belong to this run. The
  validator emits `BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED` when it is false.

## Web surfaces

Capture the rendered document, not your model of it.

- **Capture:** one settled PNG per route, state, theme, and width, each with viewport, device pixel ratio,
  locale, reduced motion, colour scheme, and source digest.
- **Invalid when:** the artifact predates the last source edit, the width changed after capture, a
  scrollbar moved the layout width, or fonts were still loading.
- **Blocked as:** `BLOCKED_RENDERER_UNAVAILABLE` when the host exposes no callable browser renderer;
  `BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED` when a target exists but is not provably yours.

## Terminal and TUI surfaces

Capture text twice: plain proves content, escaped proves control bytes.

- **Capture:** `tmux capture-pane -p` and `tmux capture-pane -e -p`, plus the real column count, rows,
  locale, terminal font, and the ambiguous-width setting used.
- **Invalid when:** the column count was assumed rather than read, the pane resized mid-capture, or a
  pager reflowed the output.
- **Blocked as:** `BLOCKED_RENDERER_UNAVAILABLE` when no attachable renderer session exists; name the multiplexer
  and the attempt instead of pasting a hand-typed layout.

## Reference-fidelity targets

The target governs appearance only. Keep it as a digested file, not a description.

- **Capture:** every target frame at native dimensions plus your rendering at that size, with the target
  digest, its dimensions, and the regions it does not cover.
- **Invalid when:** dimensions differ between target and actual, the target was rescaled, or an annotated
  overview was summarised into prose instead of kept.
- **Blocked as:** `BLOCKED_RENDERER_UNAVAILABLE` when the target cannot be rendered; a missing region is a
  FAIL, not a blocked channel.

## Motion and transient states

Motion needs three frames; one frame cannot show that anything moved.

- **Capture:** rest, mid-transition, and settled frames per trigger — hover, focus, press, load, scroll —
  with declared duration, easing, and whether reduced motion was honoured.
- **Invalid when:** only the settled frame exists, the mid frame was taken after settling, or a moving
  frame was compared against a settled target.
- **Blocked as:** `BLOCKED_RENDERER_UNAVAILABLE` when no frame can be held mid-transition.

## Responsive width sweeps

Sweep the frozen width list. A sample proves nothing about widths you skipped.

- **Capture:** every declared width at both themes, narrowest and widest included, with per-width horizontal
  overflow in pixels and the breakpoint that fired.
- **Invalid when:** widths were interpolated, the window never actually resized, or the sweep stopped at
  the first passing width.
- **Blocked as:** `BLOCKED_RENDERER_UNAVAILABLE` naming the unreachable widths; reached widths still
  report PASS or FAIL on their own.

## Accessibility channels

Each channel is separate evidence; a screenshot proves none.

- **Capture:** keyboard traversal order, focus-indicator frames, computed contrast values, accessible name
  and role per control, and 200-400% zoom renderings, each tagged with its criterion identifier and
  `PASS`, `FAIL`, or `NOT_APPLICABLE`.
- **Invalid when:** contrast was eyeballed, focus inferred from CSS instead of observed, or a criterion
  marked not applicable with no reason.
- **Blocked as:** `BLOCKED_RENDERER_UNAVAILABLE` for that one channel; a channel that ran and failed is a
  FAIL.

## CJK and IME text

CJK text breaks where Latin text does not. Capture real Korean, Japanese, or Chinese strings.

- **Capture:** the narrowest width per locale, the longest real label, and composition mid-input with
  the pre-edit string visible, plus the resolved font fallback chain.
- **Invalid when:** placeholder Latin text stood in for CJK, the fallback font differed from production, or
  the pre-edit buffer was committed before capture.
- **Blocked as:** `BLOCKED_RENDERER_UNAVAILABLE` when no IME can be driven; clipped descenders, tofu
  glyphs, orphan single-character lines, and wide-cell column drift are FAIL.

## Authentication-limited surfaces

Never manufacture access. Account safety outranks sweep coverage.

- **Capture:** post-login states only through an account the user declared safe to test, recording
  `auth_owner`, `process_owner`, and the teardown that closed it.
- **Invalid when:** a user-owned profile, cookie jar, token, or storage was copied into evidence, or the
  account could mutate production data.
- **Blocked as:** `BLOCKED_AUTH_UNAVAILABLE` with no usable credential path;
  `BLOCKED_TEST_ACCOUNT_UNSAFE` when a credential exists but the account is unsafe to exercise.

## Failure patterns

Reject:

- A capture with no producing tool, digest, or time beside it.
- A sample presented as the full width, state, or locale inventory.
- A review that rejected the work filed under a blocked code.
- A blocked receipt with no attempt list or cleanup line.
