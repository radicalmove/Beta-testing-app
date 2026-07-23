# Rise interaction context design

## Problem

Rise tabs and process blocks keep multiple pieces of content in the page while
showing only the currently selected tab or process step. The review extension
currently saves the Rise lesson route and the comment anchor, but not the
interactive state that made the anchor visible.

This causes two related failures:

- a tab comment can appear to refer to whichever tab is currently selected,
  rather than the tab on which it was created;
- a process comment created on a later step cannot be recovered after Rise
  returns to its default step, so navigation stops at the lesson and reports
  that the original content could not be found.

The extension must restore the relevant Rise interaction before attempting
anchor recovery or scrolling.

## Chosen approach

Each new comment created inside a supported Rise interaction will save a small,
structured interaction context alongside its existing page location and
anchor. The context will identify:

- the supported interaction kind (`tabs` or `process`);
- the enclosing interaction block;
- the selected tab or process step;
- a human-readable label for the selected item;
- an ordinal and item count when Rise exposes them.

This will be stored in a dedicated nullable SQLAlchemy JSON field named
`interaction_context`, rather than overloading `dom_selector`. Its canonical
JSON encoding must not exceed 4096 bytes. The API and extension will both
require the exact versioned shape below, reject additional keys, and apply the
listed string and number bounds:

```json
{
  "version": 1,
  "kind": "tabs",
  "container": {
    "block_id": "bounded Rise data-block-id or null",
    "ordinal": 2,
    "fingerprint": "normalised accessible block label"
  },
  "item": {
    "ordinal": 1,
    "count": 2,
    "label": "Unwritten (uncodified)",
    "control_key": "bounded aria-controls value or null"
  }
}
```

```json
{
  "version": 1,
  "kind": "process",
  "container": {
    "block_id": "bounded Rise data-block-id or null",
    "ordinal": 1,
    "fingerprint": "normalised accessible carousel label"
  },
  "item": {
    "ordinal": 3,
    "count": 5,
    "label": "Criminal justice agencies",
    "control_key": "Go to slide 3"
  }
}
```

`version` must equal `1`; `kind` must be `tabs` or `process`;
`container.ordinal` is a one-based integer from 1 through 100; and
`item.ordinal` and `item.count` are one-based integers from 1 through 100 with
`item.ordinal` not exceeding `item.count`. `block_id` and `control_key` are
nullable strings of at most 200 characters.
`fingerprint` and `label` are required normalised non-empty strings of at most
300 characters. Normalisation trims, collapses Unicode whitespace, and compares
case-insensitively without otherwise rewriting the content. These are the only
permitted keys.

Example display labels are:

- `Tab: Unwritten (uncodified)`
- `Step 3 of 5: Criminal justice agencies`

## Capturing interaction context

When a marker or highlighted-text comment is created, the SCORM worker will
inspect the comment target's nearest supported Rise interaction.

For a process block, the worker will locate the containing carousel, the
target's `.carousel-slide`, and the corresponding
`.carousel-controls-item-btn`. It will record the slide ordinal and derive the
label from the slide's visible heading, falling back to Rise's accessible
position text.

For a tabs block, the worker will locate the containing tab set, the target's
active tab panel, and the tab control that owns that panel. It will record the
tab's accessible or visible label and ordinal.

The container fingerprint is derived deterministically from the first available
non-empty source in this order: the interaction container's computed accessible
name, its `aria-label`, then the nearest preceding heading within the same Rise
block. If none produces a valid bounded fingerprint, capture omits interaction
context and the comment retains ordinary anchor behaviour; it does not invent a
fingerprint from arbitrary surrounding text.

The saved locator will describe only a control within the same identified
interaction block. It will not contain executable code or authorize arbitrary
page clicks.

Marker capture derives the context from the clicked target. Highlight capture
derives and caches the context from the selected `Range` while the selection is
still live, alongside the existing cached quote anchor. Selection collapse,
page-identity change, or a newer selection invalidates both together, so a
later save cannot combine text from one panel with interaction state from
another.

Comments outside a supported interaction continue to save and navigate exactly
as they do now.

## Restoring interaction state

Comment navigation will use this order:

1. Load the correct Moodle activity and Rise lesson route using the existing
   cross-page navigation flow.
2. Wait until the identified Rise interaction and its controls have rendered.
3. Find the saved interaction item within that interaction block and activate
   its exact supported control.
4. Wait until the corresponding panel or slide is visible and active.
5. Recover the saved anchor, open its comment context, and scroll it into view.

Container resolution follows one strict path. If `block_id` is present, it must
resolve to exactly one supported interaction of the saved kind and its
normalised fingerprint must match. If `block_id` is absent, the saved ordinal
must identify a supported interaction of that kind and its fingerprint must
match. A missing, duplicate, or mismatched container fails safely.

Within that container, the saved item ordinal must exist, the current item count
must equal the saved count, and the normalised current label must equal the
saved label. For tabs, a non-null `control_key` must also match the tab
control/panel ownership relationship. For process blocks, `control_key` must
equal the matching carousel control's accessible `Go to slide N` identity.
Only after every applicable check passes may the worker activate that exact
control. There is no label-only search, cross-container fallback, or ordinal
fallback after a mismatch. Reordered or edited interactions therefore use the
manual-location fallback instead of risking activation of the wrong item.

Retries remain generation-bound and bounded by the existing pending-navigation
lifetime. A delayed Rise render therefore cannot cause an early failed attempt
to consume the navigation request.

## Existing comments

Older comments have no saved interaction context and will retain their current
behaviour. There will be no backfill or hidden-panel discovery path. This keeps
the change predictable and avoids guessing when the same quoted text appears in
more than one tab or process step.

## Comment list presentation

When a comment has interaction context, its tab or step label will appear as a
secondary line beneath the existing lesson heading and comment excerpt. The
label is descriptive only; selecting the comment still runs the full navigation
and restoration flow.

The added line must wrap cleanly within the current panel and must not change
the comment's open/resolved controls or ordering.

## Safety and failure handling

The worker will activate controls only when all of the following are true:

- the context version and interaction kind are recognised;
- the interaction container is uniquely resolved;
- the target is an exact supported Rise tab or carousel control inside that
  container;
- the control's relationship to the requested panel or slide is verified.

Missing, duplicated, stale, or malformed context will never trigger a generic
selector click. The worker will preserve the existing manual-location fallback.

Navigation cancellation, a newer comment selection, worker replacement, or
leaving the target page invalidates the pending attempt so a late retry cannot
change an unrelated Rise interaction.

## Data and protocol changes

The server page-location model, request/response schemas, and migration will add
the nullable JSON `interaction_context` field with the exact schema and
canonical 4096-byte limit above. Both create and response validation enforce
the same schema.

Worker-captured interaction context is part of
`SCORM_ANCHOR_CAPTURED`, `EmbeddedAnchorBinding`, the binding's canonical
digest, the one-use claimed payload, and the server create request. The
top-frame content controller receives only the capability and may neither
supply nor modify the context. Claiming the capability returns the context that
was originally captured and cryptographically bound to the page identity,
worker generation, and anchor.

The field will remain nullable so existing records and non-Rise comments require
no backfill. API clients that do not send it retain current behaviour.

## Testing

Automated coverage will prove that:

- creating a comment in each of two Rise tabs saves the correct tab label and
  control relationship;
- selecting either comment activates its saved tab before anchor recovery and
  scrolling;
- creating a comment on process step 3 saves the step identity and label;
- selecting that comment from process step 1 activates step 3, recovers the
  anchor, and scrolls to it;
- delayed interaction rendering is retried rather than treated as an immediate
  unresolved anchor;
- duplicate labels in separate interaction blocks cannot activate the wrong
  block;
- interaction context altered after capability issue cannot be claimed or
  persisted;
- highlighted-text capture retains the interaction state from the original
  selected Range and clears it with stale selection state;
- reordered, relabelled, recounted, duplicated, or otherwise mismatched
  interactions fail safely without activating a control;
- malformed or stale context cannot click an arbitrary element;
- existing comments without interaction context retain their current behaviour;
- ordinary Rise content, other SCORM content, and non-SCORM Moodle navigation
  remain unchanged.

Before release, the extension tests, server tests and migration checks, type
check, production build, packaged manifest, release checksums, and
current/release artifact equality will be verified.
