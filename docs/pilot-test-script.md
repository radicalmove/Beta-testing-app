# CRJU150 pilot test script

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
