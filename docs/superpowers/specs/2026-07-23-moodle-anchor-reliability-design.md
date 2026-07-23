# Moodle anchor reliability design

## Problem

Two failures affect ordinary Moodle pages.

First, selecting an entire text element can produce a valid quote whose 64-character prefix and suffix contain only layout whitespace. The extension accepts that anchor, but the API correctly rejects it with HTTP 422 because a text highlight must include meaningful context or a stable selector.

Second, visual-pin recovery calculates the pin's exact viewport coordinates but discards them when navigating. It calls `scrollIntoView` on the underlying element instead. Moodle often anchors a pin to a large section that is already partly visible, so the browser performs no scroll even though the pin itself is outside the viewport.

## Design

### Text highlights

`captureTextAnchor` will add a stable CSS selector for the nearest eligible element containing the selected range. It will reuse the existing bounded `selectorFor` algorithm used by visual pins and reject extension-owned UI.

Top-page text-highlight create messages will include `css_selector` alongside `selected_quote`, `prefix`, and `suffix`. The bridge will accept only that exact bounded shape. The API already supports this field, so no server code or deployment is required. Existing stored highlights without selectors remain valid and continue to recover from quote context.

SCORM highlight protocol and capability shapes remain unchanged in this release. Their existing surrounding-text capture is not implicated by the reported ordinary-Moodle failure, and expanding that trust boundary would be unrelated scope.

### Visual-pin navigation

On a top-level Moodle document, navigation will center the exact recovered pin coordinate in the viewport with a smooth window scroll. It will not treat the underlying element's visibility as proof that the pin is visible.

Embedded documents will retain element `scrollIntoView`, which correctly moves nested SCORM scrolling containers. If an exact pin cannot be recovered, existing unresolved-anchor behavior and navigation retries remain unchanged.

## Safety and compatibility

Selectors remain bounded to 4,000 characters and must resolve outside extension UI. Create-message validation stays exact-keyed and fail-closed. No comment bodies, tokens, or new privileged data are stored.

The scrolling change applies only after exact anchor recovery. It does not guess a destination, modify Moodle content, or alter cross-page and SCORM navigation state.

## Testing

Regression coverage will prove that:

- selecting all text in an element with whitespace-only surrounding context produces a bounded stable selector;
- a top-page highlight create message carries and validates that selector;
- malformed, missing, extra, or overlong selector data is rejected;
- clicking a visual-pin comment on a large Moodle element scrolls by the recovered pin coordinate;
- embedded visual pins retain nested-container `scrollIntoView`;
- text-highlight scrolling and existing unresolved-anchor behavior remain intact.

The full extension suite, type check, production build, deployment tests, packaged checksums, stable extension key, and current/release artifact equality will be verified before publishing the next patch version.
