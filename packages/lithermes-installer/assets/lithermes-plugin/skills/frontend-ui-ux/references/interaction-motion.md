# Interaction states and feedback

Design the states people reach after acting, not just the default state. Use this reference for component behavior and feedback. Use [motion-guide.md](motion-guide.md) for page reveals, scroll choreography, and animated media.

## State inventory

List states for every interactive component in its Design Contract entry:

- Common: default, hover where supported, focus-visible, active, disabled, loading, empty, error, success.
- Add relevant states such as selected, indeterminate, dragging, drop target, stale, or open.
- A disabled control explains why, or the form accepts the action and validates on submit.

Do not create a visual state with no behavior, or behavior with no visible or announced result.

## Feedback by consequence

- Instant and reversible: update in place; no confirmation or toast.
- Slow and reversible: acknowledge within 100 ms and show progress on the control or affected region.
- Cheap and irreversible: complete the action, then offer undo for at least 10 seconds.
- Expensive and irreversible: identify what will be lost and require confirmation tied to the object.

Keep feedback near the action. A full-page spinner is wrong for work confined to one region.

## Validation and focus

- Show format requirements before entry. Validate on blur; validate the form on submit. After a field error, revalidate that field as it changes.
- Never silently reject a character. Preserve entered values on failed submit and focus the first invalid field.
- Do not validate or rerender during IME composition; resume after `compositionend`.
- Opening a dialog moves focus inside; Escape closes it; Tab stays within it. On dismissal, return focus to the opener or its nearest surviving ancestor.
- A route change moves focus to the new heading or main region. Never leave focus on a removed control or use positive `tabindex`.

Record the focus target before, during, and after the interaction, plus any announcement made to assistive technology.

## Gestures and keyboard paths

A gesture can accelerate a task but cannot be its only route. Pair swipe with a visible button, drag reorder with a keyboard move, and any multipoint gesture with a single-pointer alternative. A hover affordance also needs a tap or focus equivalent. Explain long-press where it is used.

## Motion in interaction states

Keep action feedback quick and interruptible. Use the `ui` curve and 180 ms default from [motion-guide.md](motion-guide.md); specify another value only when the state needs more time to read. Motion must answer one question: origin, state change, continuity, or progress.

Under `prefers-reduced-motion`, remove parallax and transforms, keep the state change, and use a brief opacity change or an immediate swap. Stop looping motion and leave manual controls available. Never hide content behind a reveal that the preference removes.

For each interaction, review the trigger, state path, terminal state, acknowledgement, timeout, failure and recovery, undo window, focus path, reduced-motion result, and coarse-pointer behavior when it differs.

## Reject

- Only default and hover states are styled.
- A gesture has no visible, keyboard, or single-pointer equivalent.
- Validation interrupts IME composition or discards form input.
- Focus stays on a dismissed or removed element.
- Motion draws attention without explaining a state, origin, continuity, or progress.
- Reduced motion also removes the meaning or result of the interaction.
