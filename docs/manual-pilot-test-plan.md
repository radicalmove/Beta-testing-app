# Moodle Course Review — manual pilot test plan

**Release candidate:** 0.4.69  
**Course used for pilot:** CRJU150 (course 896)  
**Purpose:** confirm the release works in the real UC Online Moodle and Rise/SCORM environment before wider pilot use.

## Before starting

1. In Chrome or Edge, open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**, remove older Moodle Course Review entries, and load only:
   `/Users/rcd58/OpenAI Projects/Beta Testing App/pilot-builds/moodle-review-extension`
3. Confirm the extension version is **0.4.69**, click **Reload**, then reload the Moodle tab.
4. Use a normal Moodle page first, then a Rise/SCORM activity. Record browser, browser version, reviewer role, date, and result.

Use **Pass**, **Fail**, or **Blocked** for every test. A failure should include a screenshot, the page URL, and short steps to reproduce it.

## Core reviewer journey

| ID | Test | Expected result |
| --- | --- | --- |
| M01 | Open CRJU150 in Chrome. | One review toolbar appears at bottom-right, shows the signed-in person and **Connected**. |
| M02 | Repeat M01 in Edge. | Same behaviour; no separate installation or display issue. |
| M03 | Reload the Moodle page and return later in the same browser. | The reviewer remains recognised for the same course without unnecessary sign-in. |
| M04 | Highlight text, choose **Add comment marker**, save a comment. | The text remains yellow-highlighted with one teal comment marker beside it. |
| M05 | Click **Add comment marker**, then click an unhighlighted page area. | A teal marker is placed at that location and the comment form opens. |
| M06 | Start marker mode, then choose **Cancel marker** or press Escape. | Marker mode ends, pointer returns to normal, and no comment is created. |
| M07 | Click an existing marker twice. | First click opens its thread beside the marker; second click closes it. The thread moves with the page rather than sticking to the viewport. |
| M08 | Edit your own comment, reply, attach a permitted file, then save. | The revised text/reply/file is shown immediately and persists after reload. |
| M09 | Resolve an open comment. | A green tick confirmation appears briefly; the comment moves to **Resolved** and can be restored to the open list if required. |
| M10 | Delete a comment as its author or as LD/DCD. | The delete control is available, confirms the action, and removes the marker/highlight/thread. |

## Comment list and navigation

| ID | Test | Expected result |
| --- | --- | --- |
| N01 | Open **Comments**. | The panel opens with a short animation and remains open when moving within the same course. |
| N02 | Switch **Whole course / Current page** and **Open / Resolved**. | Each selected filter becomes solid; the list changes to match it. |
| N03 | Inspect the list. | Page/activity headings follow course order; comments beneath each heading follow their order on that page. Resolved items are excluded from the open count. |
| N04 | Choose a comment in the list. | Moodle moves to the correct page and position, then opens the relevant thread in context. |
| N05 | Use **Previous** and **Next** on an open thread. | Navigation follows the next visible open comment in course/page order, crossing to another Moodle page when needed. |
| N06 | Choose **Jump to**, then choose a Moodle page and a SCORM activity. | Moodle opens the intended destination; a SCORM item opens through its Moodle player, not directly from the package URL. |

## Roles and visibility

| ID | Test | Expected result |
| --- | --- | --- |
| R01 | Sign in as a Beta Tester and create a comment. | The tester sees their own thread and LD/DCD replies only; they cannot resolve, delete other users’ threads, or share feedback. |
| R02 | Sign in as LD/DCD. | All course comments are visible. LD/DCD can reply, edit/delete where permitted, resolve, and share a Beta Tester thread with a selected SME. |
| R03 | Sign in as an SME who was selected for a shared Beta Tester thread. | That SME sees the shared thread and relevant SME threads, can reply, and receives the correct context. |
| R04 | Sign in as another Beta Tester or an unselected SME. | The shared Beta Tester thread is not visible. |

## Rise/SCORM acceptance

| ID | Test | Expected result |
| --- | --- | --- |
| S01 | Open a CRJU150 Rise activity and wait for it to settle. | Exactly one toolbar is visible, at the Moodle page bottom-right. No duplicate toolbar appears inside Rise. |
| S02 | Select text inside Rise and create a comment. | The selection is retained, saved as a yellow highlight with a marker, and reappears after reload. |
| S03 | Add a marker inside Rise, then cancel and repeat. | The button changes to **Cancel marker**, the pointer becomes a comment marker, cancel works, and a saved marker opens its thread in the right place. |
| S04 | Scroll through Rise with an open marker/thread. | The marker and its thread stay attached to their content; they do not stick to the top or bottom of the browser. |
| S05 | Change Rise lesson/slide within a multi-lesson SCORM, then add and open a comment. | Comments remain associated with the current visible lesson even where the browser URL does not change. |
| S06 | From **Comments** or **Jump to**, select a SCORM comment. | Moodle opens the SCORM player, Rise reaches the intended internal lesson, scrolls to the comment, and opens the thread. |

## Recovery, accessibility, and finish

| ID | Test | Expected result |
| --- | --- | --- |
| Q01 | Temporarily lose access to the service or use **Retry** after a simulated error. | The toolbar gives a clear recoverable message and reconnects when service access returns. |
| Q02 | Use keyboard only: tab through controls, Enter/Space to activate, Escape to cancel marker mode. | Controls have visible focus, sensible labels/tooltips, and remain usable at 200% zoom. |
| Q03 | Use the help button. | Help reflects the current controls, marker flow, filters, roles, attachments, and SCORM behaviour. |
| Q04 | Clear historical extension errors, reload extension and Moodle, then repeat M01 or S01. | No new extension error occurs. Historical errors that do not return are recorded as cleared. |

## Pilot exit criteria

The build is ready for a broader pilot when:

- M01–M10, N01–N06, and S01–S06 pass in at least Chrome and Edge.
- R01–R04 pass with real pilot accounts.
- No blocker remains: data loss, incorrect role visibility, failure to save/recover a comment, duplicate SCORM toolbar, or inability to navigate to a listed comment.
- Any accepted minor issues are logged with an owner and target version.

At the end, resolve or delete test comments that should not remain in CRJU150.
