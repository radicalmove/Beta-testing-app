# Single SCORM Toolbar Design

## Goal

Show exactly one course-review toolbar on every Moodle page, including SCORM/Rise activities, while preserving the ability to place and open comments inside SCORM content.

## Problem

The extension currently mounts a controller in the top Moodle document and can mount another controller in an embedded SCORM document. A frame-election process tries to decide which controller is visible. SCORM loads through several nested documents and those documents can register at different times, so the visible controller can alternate between the Moodle and SCORM copies or both can appear.

## Decision

The top Moodle document is the only toolbar owner. Embedded documents never render a toolbar. The elected content-bearing SCORM frame is an interaction worker: it finds selectable content, enters marker mode, renders stored highlights and markers, opens contextual threads, and reports actions to the top toolbar.

## Components

### Moodle toolbar controller

- Mounts the single bottom-right toolbar.
- Owns authentication, viewer identity, connection status, course and page comment lists, filters, help, and comment dialogs.
- Uses its own document interaction engine on ordinary Moodle pages and delegates interaction to the elected worker on SCORM/Rise pages.
- Sends typed SCORM interaction commands to the background coordinator.
- Receives SCORM selection, marker, navigation, and thread events.
- Remains visible on `/mod/scorm/player.php` rather than being suppressed.

### Background frame coordinator

- Continues to elect one deepest visible, content-bearing frame.
- Routes commands from the top controller to the elected frame and requires acknowledgements with request correlation.
- Routes interaction events from that frame back to the correct top tab.
- Treats a missing or changing elected frame as a recoverable state rather than creating another toolbar.
- Issues a short-lived, one-use pending-anchor capability after validating an anchor event from the elected worker. The top controller presents this capability when saving an embedded comment, preserving the existing cross-origin security boundary.

### Embedded SCORM interaction worker

- Never mounts `moodle-course-review-overlay`.
- Registers frame capabilities and waits for commands.
- Supports marker-mode activation/cancellation, text-selection discovery, anchor creation, marker/highlight restoration, contextual thread display, and scrolling to comment anchors.
- Reports an anchor and context snapshot to the Moodle controller, which opens the existing comment composer and saves through the established API.

### Comment projections

- The top controller receives course comments for its list and filters, but does not attempt to recover embedded anchors in the Moodle DOM.
- Each document renderer receives only comments whose page identity belongs to that document.
- The elected SCORM worker renders its own markers, highlights, contextual thread popovers, replies, edits, deletion, status changes, and scrolling without mounting the toolbar shell.
- Mutations from an in-frame thread use the existing background API and trigger refreshed list and renderer projections.

## Interaction flow

1. Moodle mounts one toolbar and resolves the course/viewer.
2. Embedded frames register; the coordinator elects the active Rise content frame.
3. The worker reports and temporarily caches a valid text selection before toolbar focus can collapse it. The top button label reflects whether a cached selection is available.
4. The reviewer selects text or clicks **Add comment marker** in the Moodle toolbar.
5. The toolbar sends a correlated selection-comment or marker-mode command to the elected SCORM frame. Marker cancellation is also an explicit command.
6. The SCORM frame consumes the cached selection or captures the click and returns a stable anchor plus exact embedded page identity.
7. The coordinator validates that the event came from the current elected worker and returns a short-lived pending-anchor capability to the top controller.
8. The Moodle toolbar opens the comment composer and submits the comment using that capability. The background validates the capability rather than weakening sender-origin validation.
9. The SCORM frame receives its refreshed per-document comment projection and renders the highlight/marker in context.
10. Clicking a SCORM marker opens its thread beside the marker; course-level lists remain in the single Moodle toolbar.

## Protocol and validation

Commands and events use exact typed envelopes containing a protocol version, command/event type, tab-bound course ID, election generation, worker-instance ID, embedded page identity, request ID, and type-specific payload. The background accepts top-controller commands only from frame 0 and worker events only from the currently elected frame and worker instance. Every command is acknowledged or times out. Unknown fields, stale generations, stale instances, mismatched courses/pages, duplicate request IDs, and events from non-elected frames are rejected.

Embedded comment creation uses a coordinator-issued pending-anchor capability bound to the tab, course, worker instance, generation, exact page identity, and anchor digest. It is single-use and short-lived. The top controller can compose the text, but cannot invent or alter the embedded origin or anchor. Existing top-page comment creation retains its current direct path.

## Page identity and navigation

- The worker preserves the exact existing embedded `page_url` and `pageTitle` derivation so stored comments continue to match without migration.
- Rise hash/title changes clear cached selection and stale rendered markers, announce the new identity, and request a new per-document comment projection.
- Selecting an embedded item from the course list first navigates the top tab to its Moodle SCORM activity when necessary, then asks the elected worker to navigate to the stored Rise identity and scroll to/open the anchor.
- If an old comment lacks enough Rise navigation information, the worker uses the existing anchor recovery rules on the currently loaded embedded page and reports a clear unavailable-context state if recovery fails.

## Failure handling

- If no SCORM frame is ready, the toolbar keeps one visible controller and queues one desired marker/selection intent while showing a concise “SCORM content is still loading” status.
- Marker mode and the current comment projection automatically replay when the elected frame becomes ready or is replaced, unless the reviewer cancels marker mode.
- If Rise navigates internally and the elected frame changes, the coordinator rebinds without mounting UI.
- Stale frame messages are rejected using the existing tab, frame, generation, and course bindings.
- Each registration includes a new worker-instance ID. Authoritative navigation prunes departed frames; same-frame-ID navigation or content-script reload creates a new instance and is reactivated.
- Failed or unacknowledged deactivation times out and removes the stale candidate so election cannot remain stuck.
- Loading has a bounded timeout. A missing/revoked optional host permission produces an actionable **Allow SCORM review access** state; an unsupported or never-registering frame provides a parent-page fallback comment option instead of loading forever.

## Compatibility

- Normal Moodle pages keep their current interaction behavior.
- Chrome and Edge use the same Manifest V3 build.
- Existing comments and anchors remain compatible; this changes ownership and messaging, not stored comment data.

## Testing

- Assert that only a top-frame call can mount the toolbar.
- Assert that embedded activation never creates an overlay host.
- Test command routing to the elected frame and event routing back to the top controller.
- Test marker placement, cancellation, text highlighting, comment restoration, and comment-list navigation in a nested SCORM fixture.
- Test top-list and worker-renderer comment partitioning, embedded list navigation, selection preservation across toolbar focus, and exact page-identity compatibility.
- Test the pending-anchor capability, cross-origin save rejection without it, capability tampering/reuse/expiry, and stale-event rejection.
- Test late frame registration, Rise internal navigation, same-frame navigation, worker-instance replacement, extension reload, failed deactivation, and desired-state replay.
- Test missing, denied, and revoked optional permissions plus unsupported/never-registering frame recovery.
- Retain the existing Moodle, visibility, role, thread, and packaging suites.

## Success criteria

- Exactly one toolbar is visible throughout SCORM loading and navigation.
- **Add comment marker** from that toolbar can place a marker inside Rise content.
- Selected Rise text can be commented on and restored with its yellow highlight.
- Existing SCORM markers and threads open in their original context.
- Reloading the extension or revisiting the activity does not create a duplicate toolbar.
