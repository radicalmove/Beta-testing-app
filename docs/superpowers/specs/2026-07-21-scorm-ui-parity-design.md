# SCORM UI Parity Design

## Goal

Make comment creation and anchored-thread behaviour inside Rise/SCORM match the established Moodle-page experience without changing the review workflow or server API.

## Approved behaviour

- The embedded comment composer uses the same Poppins-first typography as the Moodle composer.
- Marker placement uses the same teal comment-bubble cursor in Moodle and SCORM.
- Starting embedded marker placement changes the top toolbar action to the red **Cancel marker** state. Cancelling, placing a marker, losing the worker, or changing embedded page restores **Add comment marker**.
- A marker and its open thread remain attached to their anchor while scrolling. Once the anchor leaves the embedded viewport, both leave the viewport instead of sticking to its top edge; they reappear when the anchor returns.

## Architecture

Keep the elected SCORM worker responsible for embedded selection, marker placement, and anchor rendering. Add a small explicit interaction-state signal from the interaction controller to the parent overlay so the single visible toolbar reflects the worker's active intent. Share the comment cursor definition between normal and embedded placement, and correct renderer visibility rather than adding SCORM-specific fixed positioning.

## Failure handling

The parent toolbar must fail closed to its inactive state if the embedded worker disappears, rejects a command, changes identity, or completes capture. No interaction state may survive navigation to a different embedded page.

## Testing

- Controller tests prove embedded marker intent enters and exits active state.
- Overlay/content integration tests prove the button label, pressed state, and cancellation state remain synchronized.
- SCORM-worker tests prove the shared cursor is installed and restored.
- Renderer tests simulate nested scrolling and prove offscreen markers/popovers disappear and return.
- Composer style tests prove embedded controls retain the Poppins-first font stack.

