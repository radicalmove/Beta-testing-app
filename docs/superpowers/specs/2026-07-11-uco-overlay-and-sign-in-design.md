# UCO overlay and extension sign-in design

## Goal

Make the live Moodle review overlay visually consistent with UC Online and give reviewers an obvious, functional way to authenticate the browser extension.

## Visual design

The overlay remains a fixed bottom-right tool so it is available without altering Moodle content. Its compact header uses black, matching UCO course section bars. `#d73b3d` is the primary action, active, and accent colour. Panels are white with restrained light-grey borders and shadows. Typography uses Poppins when available, followed by Arial and generic sans-serif. Visible keyboard focus uses a high-contrast outline and must remain clear against black, red, and white surfaces.

Disconnected states show a textual status and a prominent red **Sign in** button. Connected state uses both the text **Connected** and a small decorative green indicator, then reveals the normal highlight, pin, and comment controls. All state changes are announced through an `aria-live` status. The sign-in button becomes disabled and reads **Signing in…** while one request is in flight, preventing duplicate flows. Focus returns to the sign-in control after cancellation/failure and moves to the first normal review control after success. The layout must remain usable with keyboard alone, at 200% zoom, and at 320 CSS px width. Text, controls, status labels, and focus indicators must meet WCAG AA contrast. Shadow DOM styling must not alter Moodle content.

## Authentication flow

The content script sends the existing strict `AUTHENTICATE` message only after the reviewer activates **Sign in**. The background worker launches the existing `chrome.identity.launchWebAuthFlow` sequence against the Tailscale service and its exact extension callback. The dashboard session may allow the authorization page to continue without another password prompt, but dashboard cookies are never used for API requests. On success, the overlay refreshes course resolution and page comments without requiring a Moodle reload.

The deterministic state transitions are: initial course resolution → connected or signed out; signed out + activation → signing in; success → connected; user cancellation or rejected callback → signed out with **Sign-in cancelled**; token exchange failure → signed out with **Sign-in failed—try again**; unapproved account → pending with **Account awaiting approval**; unreachable service → offline with **Service unavailable—retry**; expired API session → signed out with **Session expired—sign in again**. Retry starts one fresh flow. Errors never reveal credentials, codes, tokens, or internal details.

The server continues to enforce the exact callback origin and path, single-use authorization codes, and trusted sender validation. API tokens live only in `chrome.storage.session`; they never enter the Moodle DOM, page-visible events, local storage, URLs, or logs.

## Functional acceptance

- The production content script remains a classic, self-contained script.
- CRJU150 is detected as Moodle course `896`.
- A disconnected reviewer can initiate sign-in from the overlay.
- Successful authentication changes the overlay to connected without reloading Moodle.
- Text highlight and visual pin comments can be created and recovered after refresh.
- Comments appear in the appropriate dashboard/course view and respect role visibility.
- SCORM/Rise content uses exact optional origins when known and otherwise retains the parent-page fallback.
- The unpacked pilot uses the same embedded public key and therefore one verified Chromium extension ID in Chrome and Edge. A future Chrome Web Store or Edge Add-ons package may receive a different store identity; every resulting exact `chromiumapp.org` redirect must be separately allow-listed before distribution.

## Testing

Add tests first for disconnected markup, disabled/busy duplicate-click prevention, every state transition above, focus movement/restoration, live-region announcements, authenticated refresh after success, and UCO design tokens. Security tests must cover exact callback origin/path validation, one-time-code consumption, session-only token storage, absence of secrets from page-visible surfaces, and rejection of untrusted messages. The packaged `content.js` must contain no ESM syntax, runtime chunk imports, or external dependencies and must execute successfully as a classic script. Run extension unit tests, type-check, production build, deployment tests, and live Chrome checks for keyboard-only use, 200% zoom, 320 CSS px width, sign-in, comment creation, refresh recovery, dashboard visibility, and the CRJU150 SCORM route.
