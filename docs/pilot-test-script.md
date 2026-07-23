# CRJU150 pilot test script

For the full tester-facing checklist and pass/fail criteria, use the [manual pilot test plan](manual-pilot-test-plan.md). This document retains the installation and technical SCORM acceptance details.

## Install and confirm the pilot build

Use only this unpacked-extension folder in both browsers:

`/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds/moodle-review-extension`

In `chrome://extensions` or `edge://extensions`, enable Developer mode, remove any older Moodle Course Review entries, choose **Load unpacked**, and select that folder. Confirm the extension details and the in-course help/version diagnostic both report **0.5.14**. After every replacement build, click **Reload** on the extension card and then reload the Moodle tab. Do not load `extension/dist` or a release-history folder alongside it.

If Chrome or Edge shows historical errors after a reload, open the extension's **Errors** page, choose **Clear all**, reload the extension, and reload the Moodle tab. An old warning is not a current failure unless it returns after those steps.

## Single-toolbar SCORM acceptance

Open the CRJU150 SCORM player and confirm there is exactly one teal review toolbar, owned by the Moodle page and fixed at bottom right. There must never be a second toolbar inside Rise, including after scrolling, changing Rise lessons, reloading, or waiting for the activity to settle.

Select text inside Rise, then click the Moodle toolbar: the selection must remain available for a highlighted comment. Start marker mode, cancel it, and confirm the pointer returns to normal and no comment is created. Start it again, place a marker inside Rise, save, refresh, and confirm both highlights and markers restore and open their threads in context. From **Comments**, choose a SCORM comment and confirm Moodle opens the correct activity and makes bounded attempts to reach the saved Rise lesson, marker, and thread. If Rise has changed enough that the anchor cannot be recovered, accept the documented fallback only when the correct Moodle SCORM activity stays open and the app gives a clear manual-location message.

Also test a late/replaced Rise worker by reloading the activity and navigating between Rise lessons. There must remain one toolbar, old workers must not place markers, and existing comments must restore against the active lesson.

For an origin that needs optional frame access, deny the permission once and confirm the toolbar explains that access is required without creating a fallback toolbar. Grant access, reload when prompted, and repeat marker/highlight creation. Then revoke the permission in browser extension site settings: interaction must stop safely and recover after access is granted and the page is reloaded.

Record browser/version, stable extension ID, service origin, role, time, result, and requested screenshots.

Use these exact CRJU150 pilot routes:

- `https://my.uconline.ac.nz/course/view.php?id=896`
- `https://my.uconline.ac.nz/course/section.php?id=9972`
- `https://my.uconline.ac.nz/course/section.php?id=9976`
- `https://my.uconline.ac.nz/mod/page/view.php?id=118172`
- `https://my.uconline.ac.nz/mod/scorm/view.php?id=146308`
- `https://my.uconline.ac.nz/mod/scorm/player.php` (queryless; confirm the body supplies course `896` and cmid `146308` context)

As a beta tester (Reviewer), create highlight/pin comments, refresh/recover them, reply, and accept then cancel the screenshot prompt (cancel must not duplicate comments). A beta tester sees only their own threads and LD/DCD replies; they cannot share threads or change status.

Verify role visibility separately. LD/DCD sees all course feedback and can reply, change status, and share beta threads with specifically selected SMEs. Every SME sees all SME-created threads in the course plus beta threads explicitly shared with that SME account, and can reply in visible threads. Other beta testers and unselected SMEs must not see a beta thread.

Test accessible same-origin frame keyboard/highlight/pin behavior; approved cross-origin Rise/SCORM after optional permission; and inaccessible/declined frame parent-page fallback. Record discovered frame origins for later approval, never `<all_urls>`. Exercise the full overlay keyboard-only, visible focus, labels, zoom, announcements, refresh, and expired session.

Confirm migration head, loopback listener behind Tailscale HTTPS, unauthenticated rejection, exact stable redirect URI, fresh backup checksum/listing, and recorded disposable restore. Record E2E browser launch as explicit debt if unavailable; unit/type/build tests do not replace it. Sign off with Reviewer, LD, SME, platform owner, operator, accepted defects, and rollback owner.
