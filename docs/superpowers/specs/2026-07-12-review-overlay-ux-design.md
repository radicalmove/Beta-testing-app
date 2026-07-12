# Review overlay UX simplification

## Goal

Make the Moodle review overlay immediately understandable to a first-time reviewer. Remove technical anchoring language, enlarge important text and controls, and reduce competing actions without changing how feedback is stored.

## Compact toolbar

The toolbar becomes two calm zones. The left side shows the shortened course title on one line and a textual **Connected** state with its existing status dot. The right side shows three controls: a prominent **Add comment** button, a secondary **Comments (n)** button, and a square `?` Help button with the accessible name **Help and instructions**.

The page title and pilot version leave the always-visible toolbar. They appear inside the comments/details panel and Help dialog respectively. Course and page prefixes are removed. Course truncation retains a title attribute or equivalent accessible full name. Base interface text becomes 16px, supporting text no smaller than 14px, headings 18–20px, and interactive controls at least 44px high.

## Add-comment flow

Selecting **Add comment** opens a small anchored choice panel with two plain-language options:

- **Comment on text** — “Select words on the course page, then choose this option.” A usable selection is a non-collapsed range outside the extension host whose trimmed visible text is non-empty. The page selection is captured before focus moves into the Shadow DOM and retained while the choice panel is open. If no usable selection was captured, activation closes the choice panel, announces **Select text on the page first**, returns focus to the page, and does not open the composer or submit anything.
- **Comment on an area** — “Click the part of the page your feedback relates to.” This starts the existing visual location selection flow.

The interface no longer exposes the terms **Highlight text**, **Add pin**, or **parent-page pin**.

When an inaccessible Rise/SCORM frame is detected, the fallback area is reduced to a short passive notice: **Embedded activity detected — use Add comment and choose Comment on embedded content.** It has no duplicate button. The single toolbar **Add comment** opens the same choice panel with the area option relabelled **Comment on embedded content** and explained as “Mark the area of the embedded activity your feedback relates to.” Internally this continues to create the safe parent-page visual anchor and preserves the existing page-title fallback marker.

The area flow first shows a persistent instruction strip: **Click an area, or use the arrow keys to choose one. Press Escape to cancel.** Pointer activation outside the extension selects the underlying page element, prevents that placement event from triggering the page's own action, removes the strip, and opens the composer. For keyboard use, the overlay builds a bounded list of visible page targets outside the extension: interactive controls, images/media, headings, landmarks/sections, and other visible elements at least 24×24 CSS pixels. It starts with the last eligible page-focused element when available, otherwise the first target in document order. Up/Left and Down/Right cycle a visible outline through targets without moving DOM focus; Enter selects the outlined target and opens the composer. The retained target therefore survives focus entering the instruction strip. If there are no eligible targets, the strip announces **No selectable areas found; use Comment on text instead.** Escape cancels without a marker and returns focus to **Add comment**. Outside-click dismissal applies only to the choice panel before area mode begins, so it cannot consume or be confused with the placement click.

The choice panel closes on Escape, outside click, a completed choice, navigation, or disconnection. Focus returns to **Add comment** when dismissed and moves into the composer or persistent location-selection instruction after a choice.

## Comments panel

The menu icon becomes **Comments (n)**, where `n` is the number of top-level comment threads returned by the existing page-comments API for the current viewer and exact page URL. It includes all statuses, including resolved threads, and excludes replies. Unresolved anchors still count because their threads are visible. The count resets to zero immediately on navigation or disconnection and updates after every successful page load or new-comment save. Opening it shows the full page title first, then the current comment list. At zero, it reads **No comments on this page yet**. Existing unresolved-anchor and thread behaviour remains unchanged.

## Help dialog

The `?` button opens a keyboard-accessible modal titled **How course review works**. It explains:

1. **Comment on text:** select exact wording, then add feedback.
2. **Comment on an area:** mark a visual element, layout region, image, or control.
3. **Embedded activities:** use **Comment on embedded content** when Rise/SCORM cannot be inspected directly; the location is attached to the containing Moodle page.
4. **Comments:** reopen existing feedback for the current page.
5. **Conversations and status:** replies stay with the comment; LD/DCD users can progress or resolve feedback.

The dialog uses `role="dialog"`, `aria-modal="true"`, a heading referenced by `aria-labelledby`, and introductory text referenced by `aria-describedby`. The rest of the document is made inert while it is open. Initial focus moves to the heading (`tabindex="-1"`), followed by the scrollable instructions and **Close help** button in DOM order. Tab and Shift+Tab remain within the dialog. It closes on Escape or **Close help** and restores focus to the `?` trigger; if that trigger disappeared after navigation or disconnection, focus moves to the overlay shell. It uses no hover-only instructions.

The dialog includes the current pilot version/build in subdued text at the bottom and a single **Close help** button.

## Visual and accessibility rules

Keep the approved teal boundary/header, pale blue-grey surfaces, Poppins typography, and UCO red primary action. Above 600px, the overlay is no wider than 600px and the toolbar uses one row with at least 12px between identity/status and actions. At 600px and below, it uses two rows: identity/status occupies the first full-width row; actions use a second three-column row with `minmax(0, 1fr) auto 44px`, an 8px gap, and no vertical button stack. At 360px and below, **Comments (n)** may shorten to **n comments**, but all three controls remain on one action row and within the overlay bounds.

All controls have visible focus, plain-language accessible names, textual status, and at least 44×44 CSS-pixel targets. The choice panel and help dialog use semantic headings and descriptions. Colour is never the only status indicator.

## Testing and release

Tests cover the simplified toolbar labels, absence of retired terminology, 16px base type, 44px controls, narrow-width layout, choice-panel keyboard/focus behaviour, contextual embedded wording, comments count updates, help-dialog content/focus/Escape behaviour, and preservation of text/area anchor submission. Existing anchoring, comment, SCORM fallback, accessibility, and release tests must remain green. Publish as the next patch version after signed production verification.
