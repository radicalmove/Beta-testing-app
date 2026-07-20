# Marker cancellation and comments-panel state

## Goal

Cancelling marker placement must return the review toolbar and Comments panel to exactly the usable state they had before marker mode began, without losing the rendered course comment list.

## Root cause

Marker mode currently writes its instruction directly into `[data-panel-content]`. That element also owns the rendered filters and comment rows. Cancelling clears the marker interaction but leaves the replacement instruction behind, so reopening Comments shows stale marker guidance instead of the comment list.

## Design

- Marker instructions are a separate temporary panel child identified by a dedicated data attribute and live region semantics.
- If the Comments panel is already expanded, entering marker mode keeps `[data-panel-content]` fully visible and places a compact temporary instruction banner above the existing filters and comment list.
- If the Comments panel was collapsed, entering marker mode opens only the compact instruction state; the comment list remains rendered but hidden until the reviewer explicitly opens Comments or marker mode ends.
- The overlay records whether the Comments panel was expanded immediately before marker mode began.
- Every marker-mode exit path uses one cleanup operation: clicking Cancel marker, pressing Escape, placing a marker, restarting marker mode, or destroying the overlay.
- Cleanup removes the temporary instruction, clears cursor/candidate outlines/listeners, and restores the panel's pre-marker expanded state without changing the saved per-course preference.
- Comment refreshes that occur during marker mode update the existing list without changing its intended visibility.
- A missing or already-removed temporary instruction is harmless, making repeated cleanup idempotent.

## Focus behaviour

- The existing yellow focus ring remains because it is required for keyboard accessibility.
- Passive restoration of a course's saved expanded panel state must not move focus to Comments or another toolbar control.
- Focus may still be returned after an explicit user action such as cancelling marker mode, closing a dialog, changing course through a control, or an authentication action.

## Testing

Regression tests must demonstrate:

1. Entering marker mode from an expanded Comments panel preserves and keeps the original comment-list DOM visible beneath a separate instruction banner.
2. Entering marker mode from a collapsed panel shows only the instruction state and returns to collapsed on cancellation.
3. Clicking Cancel marker restores the original list and its prior expanded/collapsed panel state.
4. Escape performs the same restoration.
5. Successful marker placement and overlay destruction remove the temporary instruction cleanly.
6. A comment-list refresh during marker mode remains available without collapsing an already-open list.
7. Mounting with a saved open panel restores it without automatically focusing Comments.
8. Existing keyboard focus outlines and explicit focus-restoration paths remain intact.
