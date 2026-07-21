# Moodle Course Review 0.5.0 focused retest checklist

Load the signed extension from:

`/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds/moodle-review-extension`

Confirm **0.5.0**, reload the extension, and refresh the Moodle tab. Use CRJU150 course 896. Record **Pass**, **Fail**, or **Blocked** plus a screenshot and URL for failures.

## 1. Identity, roles, and visibility

- [ ] Sign out, then sign in again to the same course; identity does not leak to another course.
- [ ] The admin page makes the selected course obvious before users, memberships, invitations, and codes are managed.
- [ ] A Beta Tester sees only their own threads and LD/DCD/Admin replies.
- [ ] LD/DCD/Admin sees the complete course projection with correct course-specific role labels.
- [ ] **Share with SME** appears only on eligible Beta Tester threads, lists eligible SMEs in rows, and saves the full selected set.
- [ ] A selected SME can reply; that reply is visible to LD/DCD/Admin and the selected SME, but not to the Beta Tester or an unselected SME.
- [ ] An SME-originated thread does not show **Share with SME**.

## 2. Creation, editing, attachments, and conversation

- [ ] Create a Moodle highlighted-text comment; the subtle yellow highlight remains readable.
- [ ] Create and cancel a Moodle marker; no neighbouring marker gains a red placement outline.
- [ ] Edit, reply, and attach one JPEG and one PDF/Word file; save succeeds and cancel clears any transient message.
- [ ] A file above 10 MB is rejected with useful text, not an internal command name.
- [ ] Four participants remain distinguishable by stable colour, name/role, and alignment after refresh.
- [ ] An open popover moves left when the course comment panel would otherwise overlap it.
- [ ] The active marker alone changes to burnt orange.

## 3. Ordering, filtering, refresh, and status

- [ ] Whole-course headings follow course order and comments under each heading follow their physical order on the page.
- [ ] Previous/Next and “Comment x of y” use the same open whole-course ordering as the list.
- [ ] Open shows only open markers/highlights/popovers; Resolved shows only resolved ones.
- [ ] Resolving an already-resolved comment and reopening an already-open comment do not produce 422 errors.
- [ ] Resolve/delete use app confirmation; a successful resolve briefly shows the green tick before removal from Open.
- [ ] A reply made in another browser appears through polling/focus refresh without collapsing the panel or destroying an active edit/reply draft.
- [ ] The comment list preview uses up to two compact lines before truncating.

## 4. Moodle and Rise/SCORM navigation

- [ ] A Moodle list item jumps to the correct page, scrolls to the marker, and opens the thread.
- [ ] Previous/Next crosses from the last comment on one Moodle page to the first open comment on the next page.
- [ ] Exactly one toolbar appears on the Moodle SCORM player; comments can still be placed inside Rise.
- [ ] Rise marker mode, cancel state, cursor, Poppins form text, and scrolling match Moodle behaviour.
- [ ] From another Moodle page, choose a Rise comment: the correct Moodle SCORM player opens, waits for Rise, scrolls to the recovered marker, and opens the thread.
- [ ] If the Rise anchor has changed, bounded retries stop, the correct activity stays open, and a clear manual-location message appears.

## 5. Finish

- [ ] Help is wide enough to read comfortably and describes roles, attachments, filtering, sharing, status, and Rise fallback accurately.
- [ ] Keyboard navigation, Escape cancellation, tooltips, and 200% zoom remain usable.
- [ ] Clear historical extension errors, reload extension and Moodle, and confirm no new error appears.
- [ ] Repeat the core Moodle and Rise flow in Edge.

Broader pilot release requires no blocker involving data loss, visibility leakage, failure to save/recover comments, duplicate SCORM toolbar, or navigation to the wrong activity.
