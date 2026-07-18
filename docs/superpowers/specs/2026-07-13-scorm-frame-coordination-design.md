# SCORM frame coordination design

## Goal

Make review controls operate inside the actual SCORM/Rise lesson, while showing exactly one review overlay per browser tab. Nested Moodle and SCORM wrapper frames must not create duplicate overlays or capture comments intended for the lesson.

## Selected approach

Use a tab-scoped frame coordinator in the extension background worker. Chrome `webNavigation` supplies the authoritative frame hierarchy, including frames into which the extension cannot yet inject. Authorized content scripts report capabilities for their own frame. The coordinator elects one eligible content-bearing frame as the active review surface.

All frames start dormant. Only the elected frame mounts the review overlay and enables highlighting, marker placement, comment rendering, navigation, and lesson-identity tracking. When a deeper eligible frame appears or navigates, the coordinator deactivates the previous frame before activating the replacement. This removes both the Moodle parent overlay and intermediate SCORM wrapper overlays.

## Components and data flow

### Frame discovery

- Add the Chrome `webNavigation` permission. Navigation events and `getAllFrames` provide frame ID, parent frame ID and URL; these values, not child claims, establish hierarchy.
- An authorized Moodle top frame creates the background-owned tab/course binding. Subframes may obtain that binding but cannot create or alter course scope.
- An authorized content script registers after trusted context is available. The background validates extension ID, tab, frame, sender URL/origin, hierarchy membership, declared host pattern and current permission before accepting it.
- Registration reports deterministic capabilities: body has non-overlay visible text or interactive elements; body dimensions exceed 200 by 150 CSS pixels; the owning iframe chain is displayed and non-zero-sized; and whether the document is primarily a wrapper containing child frames.
- An ancestor reports the origin and visibility of each immediate iframe element. Combined with `webNavigation`, this identifies the first inaccessible descendant origin and supports one permission call to action without trusting its content.
- Sandboxed frames without script access and unsupported `about:`, `blob:` or `srcdoc` descendants are treated as inaccessible candidates. They use the nearest authorized wrapper fallback; `match_origin_as_fallback` is not enabled initially.
- Registrations use renewable leases. Frames heartbeat while visible and re-register after background restart. Minimal coordinator state (course binding, elected frame/generation and permission-denial state) is mirrored in background-only `storage.session`; `getAllFrames` plus registrations rehydrates it.
- Entries expire on navigation, unload, tab removal or lease timeout. The authorized top frame is the only deterministic fallback owner.

### Active-frame election

- A frame is eligible only when it passes the capability and owner-visibility thresholds above and is not classified as a wrapper.
- Prefer the eligible authorized descendant with greatest hierarchy depth. Break sibling ties by largest visible area, then lowest stable frame ID.
- Prefer a content-bearing child over an ancestor or wrapper, even when both share an origin.
- Never activate more than one frame in a tab.
- Debounce election for 250 ms after registration/navigation and require the winner to remain eligible for that interval, avoiding transient loading shells.
- Re-elect when frames load, unload, navigate, change capabilities, lose visibility or fail to renew their lease.
- If no child can be accessed, retain one parent-level fallback surface for the embedded activity rather than displaying multiple controls.

### Activation lifecycle

- The coordinator sends a generation-stamped `deactivate` to the previous winner and waits for a teardown acknowledgement. It activates the new winner only after acknowledged teardown, authoritative frame removal, or authoritative hiding of the old frame. An unreachable but still-present frame blocks replacement until its content-side activation lease expires and it confirms dormancy through re-registration; the coordinator never uses a timeout alone to permit a second overlay.
- Activation mounts the overlay, loads course comments, restores anchors, and starts page/lesson observation.
- Deactivation synchronously cancels marker mode, removes the overlay and annotations, closes popovers, tears down observers/listeners, and acknowledges only after DOM cleanup.
- A generation number prevents late asynchronous work from a previously active frame remounting an obsolete overlay.
- The active content script owns a short activation lease renewed by polling the coordinator. Every renewal includes tab/frame/generation and the background returns validity only after checking its background-owned session state. Missing, invalid or changed renewal synchronously deactivates the content surface. Content scripts never read `storage.session` directly.
- On worker restart, the worker rehydrates session state and responds to renewal/re-registration requests, which wake an MV3 worker. If rehydration fails or the worker cannot validate the elected generation, the content-side lease expires and removes the overlay before a new election can activate another. The top-frame fallback mounts only when explicitly elected, never autonomously.

### Permissions

- Existing Moodle and previously granted SCORM origins work without prompting.
- If the navigation hierarchy contains a visible descendant whose origin matches a manifest-declared optional host pattern but is not granted, show only one top-frame call to action: **Enable reviewing inside this activity**.
- Explain the action in user terms, without mentioning frames or cross-origin restrictions.
- The click handler directly calls Chrome's permission API so the request retains its user gesture. The origin is derived from authoritative navigation data, validated against declared optional patterns, and deduplicated against concurrent requests.
- After permission is granted, register the persistent dynamic content script and use `chrome.scripting.executeScript` for the matching already-loaded frame IDs, then rerun election. If the frame blocks injection, offer a plain-language activity reload action.
- If permission is declined, keep the single parent-level fallback so reviewing remains possible, with reduced anchoring capability.
- Persist denial per course activity and origin in `storage.session`; do not prompt again automatically. A manual **Try enabling again** action may retry. Permission removal deactivates that origin and returns to the single fallback.

### Rise lesson identity

- Represent lesson identity separately from `page_url` as `{ packageKey, publicationKey, routeKey, headingKey }`. `packageKey` is the Moodle SCORM activity identity plus content origin. `publicationKey` hashes the canonical launch resource together with available Rise build metadata and the stable script/style asset URL set. A changed fingerprint creates a new publication namespace and prevents automatic restoration of old anchors; if a reliable fingerprint cannot be obtained after a package update, the activity is marked as needing anchor remapping rather than guessing. `routeKey` is the canonical internal path/hash (decoded, normalized separators, volatile query values removed); `headingKey` is normalized primary heading text plus its ordinal among duplicate headings.
- The canonical lesson identity is the tuple `(publicationKey, routeKey, headingKey)`, not the first nonempty field. A stable change to either route or heading changes identity; this covers Rise lessons that reuse one route while swapping headings. Retain the last confirmed identity through transient blank/loading states and switch only after the full candidate tuple remains stable for 250 ms.
- A mutation/navigation observer refreshes the identity when a multi-lesson Rise package changes lesson without changing Moodle's outer URL.
- Existing comment anchors remain scoped to the derived lesson identity, while the course-wide comment list remains available.
- Opening a course-list comment sends the stored lesson identity to the elected Rise frame. It navigates to the stored internal route when available, waits for the stable matching identity, restores the DOM anchor, then scrolls and opens the thread. A missing route falls back to heading/ordinal search and reports when exact context cannot be recovered.

## Error handling

- Loading and rapidly replaced frames stay dormant until election stabilises.
- Stale or unauthorized frame messages are rejected.
- Loss of the active frame triggers immediate re-election.
- Permission denial is non-fatal and does not repeatedly prompt the reviewer.
- Coordinator failure falls back to one wrapper overlay, never multiple overlays.
- Late, reordered or malicious announcements cannot change the bound course, frame hierarchy or current generation.

## Testing

- Unit-test frame registration, hierarchy construction, election, replacement, expiry, and exactly-one-active invariants.
- Test same-origin nesting, cross-origin nesting, intermediate wrappers, delayed Rise loading, frame navigation, and frame removal.
- Test permission granted, denied, and previously granted flows.
- Test that deactivated frames remove overlays, markers, highlights, listeners, and active marker mode.
- Test multi-lesson Rise navigation where the Moodle URL remains unchanged, including push/replace state, hash and history navigation, duplicate titles, delayed headings and route-only/heading-only identity.
- Test service-worker suspension/restart, lease recovery, reordered/lost activation messages, late async completion, rapid sibling replacement, BFCache/prerender, tab close and permission revocation.
- Test invalid announcements and assert the exactly-one-active invariant during every transition, not only after settling.
- Browser-test CRJU150 to confirm one overlay, marker placement and text highlighting inside Rise, correct lesson identity, comment restoration, and no parent-frame interaction leak.

## Success criteria

- Only one review overlay is visible in the tab.
- Marker placement and text highlighting work on the actual Rise lesson.
- The reviewer is not asked technical questions about frames or domains.
- A Chrome permission prompt appears only when technically required for a previously unapproved SCORM origin.
- Comments in multi-lesson packages reopen in the correct lesson and context.

## Visible controller positioning addendum

The elected Rise frame remains the functional owner of the review UI because its marker selection, text ranges, dialogs, and annotations must execute in that document. It presents the only visible toolbar. The Moodle top-frame toolbar is hidden whenever the coordinator reports an active embedded frame.

To prevent a full-height SCORM iframe from treating the lesson's document bottom as the browser bottom, authorized frame scripts propagate a presentation-only visible-viewport rectangle from the Moodle top frame through each nested iframe. Rectangles use each document's layout-viewport CSS-pixel coordinate space. A child first sends a generation-bound hello containing its layout viewport dimensions. The direct parent maps `event.source` to the immediate iframe element, intersects the received visible rectangle with that iframe's rendered content box, and converts the intersection into child layout-viewport coordinates.

The transform subtracts the rendered border/content-box origin and divides by the rendered scale: scale is rendered content-box width/height divided by the child's reported layout viewport width/height. The elected child converts the final viewport rectangle to document coordinates by adding its current scroll offsets, then positions the toolbar absolutely at the rectangle's lower-right edge. Axis-aligned CSS scale/zoom is supported. Rotated, skewed, collapsed, or non-invertible iframe transforms are treated as unavailable rather than guessed.

Every frame coalesces geometry work with `requestAnimationFrame`. It listens to capture-phase scroll events, window and `visualViewport` scroll/resize, and observes immediate iframe sizes, toolbar size, and relevant layout mutations. While the embedded surface is active, a low-frequency geometry check catches iframe movement that produces neither resize nor mutation notification. Teardown removes every listener, observer, timer, and queued animation frame.

Viewport messages carry no course, user, comment, or authorization data. They use a versioned envelope containing type, elected generation, and a coordinator-issued random presentation nonce. A child accepts only the current generation/nonce from `window.parent`; a parent accepts hello/ready messages only when `event.source` matches an immediate iframe and targets replies to the known `event.origin`. Opaque origins are unsupported initially rather than using unrestricted `*`. Stale and reordered messages are ignored.

Exactly-one-visible is an acknowledged presentation handoff. The elected child mounts functionally but keeps its toolbar hidden until it receives a valid rectangle and reports presentation-ready. Only then does the Moodle toolbar hide and the child toolbar reveal. If a valid rectangle has previously been received, the child retains the last rectangle during transient update loss. If no valid rectangle exists, or the active generation/transform becomes invalid, the child toolbar stays hidden and the Moodle toolbar remains visible with a recovery state. The reverse handoff hides the child first and acknowledges before revealing Moodle. Marker/highlight positions and comment popovers remain attached to their Rise content and are unaffected by toolbar positioning.

Tests cover one visible toolbar, iframe borders, axis-aligned CSS scaling/zoom, same-origin and cross-origin nesting, partial clipping, outer and nested scrolling in both directions, child scroll offsets, `visualViewport`, toolbar height changes, iframe layout shifts, frame removal, rotated/skewed fallback, stale/reordered envelopes, direct-parent/origin checks, and exactly-one-visible handoff/fallback at every transition.
