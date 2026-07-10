# CRJU150 pilot test script

Record browser/version, stable extension ID, service origin, role, time, result, and requested screenshots.

As Reviewer, use CRJU150 course `896`: course home, sections `9972` and `9976`, page `118172`, and SCORM `cmid=146308`/player. Test queryless SCORM context. Create highlight/pin comments, refresh/recover them, reply, change status/share, and accept then cancel the screenshot prompt (cancel must not duplicate comments).

Verify role visibility separately: Reviewer create/reply/share; LD assigned visibility/reply/status and LD-only share; SME assigned visibility/reply/status. Cross-check that unshared threads are absent for Reviewer, LD, and SME.

Test accessible same-origin frame keyboard/highlight/pin behavior; approved cross-origin Rise/SCORM after optional permission; and inaccessible/declined frame parent-page fallback. Record discovered frame origins for later approval, never `<all_urls>`. Exercise the full overlay keyboard-only, visible focus, labels, zoom, announcements, refresh, and expired session.

Confirm migration head, loopback listener behind Tailscale HTTPS, unauthenticated rejection, exact stable redirect URI, fresh backup checksum/listing, and recorded disposable restore. Record E2E browser launch as explicit debt if unavailable; unit/type/build tests do not replace it. Sign off with Reviewer, LD, SME, platform owner, operator, accepted defects, and rollback owner.
