# Marker cancellation and comments-panel state

## Goal

Cancelling marker placement must return the review toolbar and Comments panel to exactly the usable state they had before marker mode began, without losing the rendered course comment list.

## Root cause

Marker mode currently writes its instruction directly into `[data-panel-content]`. That element also owns the rendered filters and comment rows. Cancelling clears the marker interaction but leaves the replacement instruction behind, so reopening Comments shows stale marker guidance instead of the comment list.

## Design

- Marker instructions are a separate temporary panel child identified by a dedicated data attribute and live region semantics.
- Entering marker mode hides, but does not replace or mutate, `[data-panel-content]` and then exposes the temporary instruction.
- The overlay records whether the Comments panel was expanded immediately before marker mode began.
- Every marker-mode exit path uses one cleanup operation: clicking Cancel marker, pressing Escape, placing a marker, restarting marker mode, or destroying the overlay.
- Cleanup removes the temporary instruction, reveals the preserved comments content, clears cursor/candidate outlines/listeners, and restores the panel's pre-marker expanded state without changing the saved per-course preference.
- Comment refreshes that occur during marker mode may update the hidden `[data-panel-content]`; those refreshed nodes become visible when marker mode ends.
- A missing or already-removed temporary instruction is harmless, making repeated cleanup idempotent.

## Focus behaviour

- The existing yellow focus ring remains because it is required for keyboard accessibility.
- Passive restoration of a course's saved expanded panel state must not move focus to Comments or another toolbar control.
- Focus may still be returned after an explicit user action such as cancelling marker mode, closing a dialog, changing course through a control, or an authentication action.

## Testing

Regression tests must demonstrate:

1. Entering marker mode preserves the original comment-list DOM while showing separate instructions.
2. Clicking Cancel marker restores the original list and its prior expanded/collapsed panel state.
3. Escape performs the same restoration.
4. Successful marker placement and overlay destruction remove the temporary instruction cleanly.
5. A comment-list refresh during marker mode is visible after cancellation.
6. Mounting with a saved open panel restores it without automatically focusing Comments.
7. Existing keyboard focus outlines and explicit focus-restoration paths remain intact.

