# Cross-page SCORM cover activation design

## Problem

When comment navigation starts outside the target SCORM activity—either on a normal Moodle page or in a different SCORM—Moodle first loads the target SCORM player and Rise then presents a Start cover. Rise keeps that cover and its Start link in the document after the lesson begins. Version 0.5.9 treats the continuing presence of the Start link as proof that the lesson still needs activation, so every retry activates Start again and never progresses to the saved comment locator.

Cover activation is not required when the reviewer is already inside the current SCORM activity. In that case, navigating with Next or selecting a comment must go directly to its saved locator and context.

## Design

The background navigation record will retain whether this request actually navigated the top-level Moodle tab into a different target SCORM player. A normal Moodle page and another SCORM both require that transition when their current top-level URL does not equal the target activity URL. That request-scoped fact—not merely the presence of a Rise Start link—determines whether cover activation is allowed.

For entry from a normal page or a different SCORM, the background will use a distinct cover-activation phase before sending any locator command. A cover-activation command sent after the target worker becomes ready has two meaningful outcomes:

- `cover-activated`: the worker found the exact unique Rise Start link and activated it. The background then persists completion of the cover phase.
- `cover-not-ready`: the link is absent, duplicated, or not yet valid. The background retains the cover phase and retries within the navigation record's existing bounded lifetime.

Transport failure or worker replacement before an acknowledgement leaves activation unconfirmed and therefore retryable. This can repeat an activation after an acknowledgement is lost, but it cannot create the permanent loop: the first confirmed activation is persisted in the background record, and every later retry—including retries after worker replacement—skips the persistent Start link and sends only the saved locator. Thus the guarantee is one confirmed cover phase per navigation record, rather than an unsafe claim that a browser-side action can be globally at-most-once across a lost acknowledgement.

For navigation that begins inside the current SCORM player, the record will never enable the cover phase. The first command will apply the saved locator directly.

The resulting order is:

1. Navigate to and wait for the target SCORM frame when entry began on a normal page or in another SCORM.
2. Confirm the Rise cover phase when that cross-page request requires it.
3. Retry the saved locator until the target embedded page identity is current.
4. Retry comment projection/context opening until the marker or recoverable anchor is available, then scroll to it.

## Safety and boundaries

Cover activation remains limited to one exact `a.one-page-cover__start-link[aria-label="Start"]` whose hash targets a bounded Rise lesson identifier. The distinct command and its empty payload are validated as part of the exact SCORM protocol envelope. It cannot activate arbitrary controls. Zero, multiple, or invalid candidates return `cover-not-ready` and do not advance the navigation record.

The activation state belongs to one pending comment-navigation record and expires with that record. It is not a global assumption about the SCORM package.

## Testing

Regression coverage will model Rise accurately by leaving the Start link in the DOM after activation. It will prove that:

- normal-page-to-SCORM and SCORM-to-different-SCORM navigation each confirm Start activation, then apply the saved locator on retry;
- an already-current SCORM applies the locator without activating Start;
- a persistent Start link cannot trap retries in the cover phase;
- a missing, duplicate, or invalid Start link retains the bounded activation retry phase without applying the locator;
- acknowledgement loss or worker replacement before confirmation remains retryable, while replacement after confirmation cannot reactivate the persistent cover;
- existing slow-load, worker-replacement, projection, and context-opening behavior remains intact.

The complete extension test suite, type check, production build, packaged manifest, release checksums, and current/release artifact equality will be verified before publishing version 0.5.10.
