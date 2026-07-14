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
- Sends SCORM interaction commands to the background coordinator.
- Receives SCORM selection, marker, navigation, and thread events.
- Remains visible on `/mod/scorm/player.php` rather than being suppressed.

### Background frame coordinator

- Continues to elect one deepest visible, content-bearing frame.
- Routes commands from the top controller to the elected frame.
- Routes interaction events from that frame back to the correct top tab.
- Treats a missing or changing elected frame as a recoverable state rather than creating another toolbar.

### Embedded SCORM interaction worker

- Never mounts `moodle-course-review-overlay`.
- Registers frame capabilities and waits for commands.
- Supports marker-mode activation/cancellation, text-selection discovery, anchor creation, marker/highlight restoration, contextual thread display, and scrolling to comment anchors.
- Reports an anchor and context snapshot to the Moodle controller, which opens the existing comment composer and saves through the established API.

## Interaction flow

1. Moodle mounts one toolbar and resolves the course/viewer.
2. Embedded frames register; the coordinator elects the active Rise content frame.
3. The reviewer selects text or clicks **Add comment marker** in the Moodle toolbar.
4. The toolbar sends the action to the elected SCORM frame.
5. The SCORM frame captures the text selection or click and returns a stable anchor plus page identity.
6. The Moodle toolbar opens the comment composer and submits the comment.
7. The SCORM frame receives refreshed visible comments and renders the highlight/marker in context.
8. Clicking a SCORM marker opens its thread beside the marker; course-level lists remain in the single Moodle toolbar.

## Failure handling

- If no SCORM frame is ready, the toolbar keeps one visible controller and shows a concise “SCORM content is still loading” status.
- Marker mode automatically resumes when the elected frame becomes ready, unless the reviewer cancels it.
- If Rise navigates internally and the elected frame changes, the coordinator rebinds without mounting UI.
- Stale frame messages are rejected using the existing tab, frame, generation, and course bindings.

## Compatibility

- Normal Moodle pages keep their current interaction behavior.
- Chrome and Edge use the same Manifest V3 build.
- Existing comments and anchors remain compatible; this changes ownership and messaging, not stored comment data.

## Testing

- Assert that only a top-frame call can mount the toolbar.
- Assert that embedded activation never creates an overlay host.
- Test command routing to the elected frame and event routing back to the top controller.
- Test marker placement, cancellation, text highlighting, comment restoration, and comment-list navigation in a nested SCORM fixture.
- Test late frame registration, Rise internal navigation, frame replacement, extension reload, and missing-frame recovery.
- Retain the existing Moodle, visibility, role, thread, and packaging suites.

## Success criteria

- Exactly one toolbar is visible throughout SCORM loading and navigation.
- **Add comment marker** from that toolbar can place a marker inside Rise content.
- Selected Rise text can be commented on and restored with its yellow highlight.
- Existing SCORM markers and threads open in their original context.
- Reloading the extension or revisiting the activity does not create a duplicate toolbar.
