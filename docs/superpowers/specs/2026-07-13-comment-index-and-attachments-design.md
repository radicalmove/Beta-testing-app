# Comment Index and Attachments Design

## Goal

Make the course Comments panel a compact navigation index, eliminate confusing placement and location UI, and replace screenshot capture with useful file attachments.

## Toolbar and filters

The Comments and Help buttons keep their existing turquoise/white treatment but use white text and icon on hover and keyboard focus. Open and Resolved are spaced segmented controls styled consistently with the Comments button. Their pressed state is visually distinct and exposed with `aria-pressed`.

Changing filter immediately shows only that status group. Open contains `open`, `in_progress`, `awaiting_sme`, and `deferred`; Resolved contains `resolved`. Each view has its own empty-state message. The filter remains selected while the panel stays open.

## Compact course index

The panel is an index, not an alternate thread reader. Each visible thread is a single-line text link formatted as `#<visible rank> · <short page title> · “<short excerpt>”`. Ordering is server-defined `updated_at DESC, id DESC`; visible rank is server-provided within the selected course/filter so it remains stable across pagination. The visible page title is truncated to 32 characters and excerpt to 56 characters after whitespace normalisation. `aria-label` contains the rank, full bounded page title, full bounded excerpt, author, and human-readable status; it does not rely on `title` alone.

Selecting a link never renders a thread inside the panel. On the current page it closes the panel, scrolls the recovered marker/highlight into view, focuses its marker, and opens the anchored thread popover. On another page the trusted background stores in `chrome.storage.session`, keyed by initiating tab ID, `{thread_id, course_id, canonical_url, nonce, created_at}`. It accepts only server-supplied URLs on configured HTTPS Moodle origins, expires after five minutes, and is consumed once. Destination content resolves the course before requesting consumption. The background independently validates the sender is the extension's authorised content script, exact initiating tab ID, nonce, expiry, canonical configured HTTPS origin/URL, and its trusted tab-to-course binding; it does not trust a content-supplied course claim. It then returns the target, after which content scrolls to the recovered anchor, focuses its marker, and opens the popover. Mismatch, cancellation, expiry, failed navigation, and tab closure clear the record. If recovery fails, the destination shows the thread with a clear “original location unavailable” message rather than reopening it in the bottom panel.

## Marker cancellation

While marker placement is active, clicking the active `Cancel marker` button performs the same cancellation as Escape. Its trusted shadow-control `pointerdown`/keyboard handler runs before the document placement listener, prevents propagation/default for that activation, and synchronously marks placement inactive before removing listeners. Cleanup executes exactly once: candidate outlines, custom cursor, instructions, and temporary placement panel are removed; the next click cannot place a marker; the normal `Add comment marker` label/state returns; and focus returns to the button. Repeated cancellation is harmless.

## Human-readable context

The comment composer never displays CSS/DOM selectors. For highlighted text it shows `Commenting on: “<selected text>”`. For a marker it derives `Commenting near:` or `Commenting in:` from the nearest meaningful accessible context, preferring: associated form label or control name, link/button text, image alt text, card title, nearest heading, then section/landmark label. Text is whitespace-normalised and bounded. When no useful label exists it displays `Commenting on this part of the page`.

Selectors and geometric anchor data remain stored but hidden so the extension can recover the location later.

## File attachments

Screenshot capture is removed from the composer. A reviewer may attach one PDF, DOC, DOCX, PNG, or JPEG file, no larger than 10 MiB, to a new top-level comment. Replies do not accept files in this pilot. The composer shows selected filename, size, removal control, and upload progress/error, and permits saving a text-only comment when no file is selected.

After `POST /api/comments` returns the new comment ID, the server issues an unguessable 256-bit upload capability. It stores only its hash with comment/course/author binding, five-minute expiry, created timestamp, and revoked/consumed timestamps. The trusted background stores the plaintext capability in session storage bound to tab/course/comment. `POST /api/comments/{comment_id}/attachments` accepts multipart field `file` plus `X-Upload-Capability`; the authenticated author, visible comment, course, and hashed token binding must all match. The token is consumed atomically only after the attachment database record and durable file commit succeed. Validation, network, and storage failures leave it retryable until expiry; explicit cancellation calls `DELETE /api/comments/{comment_id}/attachment-capability` with the header to revoke it. Retry after worker restart reclaims the same unexpired local capability and can target only that exact comment. Success returns attachment ID, filename, MIME type, size, owning comment ID, and `reply_id: null`.

The extension validates extension/MIME pair and size. The server streams with a hard 10 MiB limit and rejects: `.pdf` except `application/pdf` beginning `%PDF-`; `.png` except `image/png` with the PNG signature; `.jpg/.jpeg` except `image/jpeg` beginning `FF D8 FF`; `.doc` except `application/msword` with OLE compound signature `D0 CF 11 E0 A1 B1 1A E1`; and `.docx` except the DOCX MIME with a ZIP containing bounded `[Content_Types].xml` plus a `word/` entry. DOCX inspection caps 1,000 entries and streams every entry through counters, enforcing at most 25 MiB actual decompressed bytes and a 20:1 actual expansion ratio; a non-empty entry with zero compressed bytes is rejected, as are encrypted/path-traversal entries, and nothing is extracted to a caller path. Filenames are Unicode-normalised, stripped to a basename, control characters removed, and capped at 180 characters while preserving the final extension. The result must be non-empty and its final extension must still match the validated MIME/signature or it is rejected. Invalid type/signature/filename is `422`, oversized is `413`, invisible/cross-course is nondisclosing `404`, and consumed/expired capability is `409`. Temporary files are removed on every failure/cancellation path.

Thread detail and course-list items expose attachments only after normal thread visibility checks, with `{id, filename, mime_type, size_bytes, comment_id, reply_id:null}`. Download uses the `downloads` and `offscreen` manifest permissions. Content sends only the attachment ID to the trusted background; it validates the authorised sender and fresh tab/course binding, performs the authenticated fetch with a 10 MiB streaming cap, validates response type/length, and sanitises the server filename. Because MV3 service workers cannot create blob URLs, the background creates/reuses a trusted offscreen extension document with the `BLOBS` reason and transfers bytes only to that extension document. The offscreen document creates the object URL and returns it only to the background, which invokes `chrome.downloads.download({url, filename, saveAs:true})`. The URL remains registered by download ID and is revoked/removed only when `chrome.downloads.onChanged` reports complete/interrupted, or by a bounded 15-minute stale cleanup after worker restart. File bytes, bearer tokens, and blob URLs never pass through the content script or page context; server filesystem paths are never exposed.

Failed upload leaves the saved comment intact and offers retry or removal against that exact capability. Deleting a thread cascades all attachment records. Filesystem deletion failure records durable orphan cleanup work for retry rather than restoring or exposing the deleted thread.

## Help and testing

Help describes the index filters, navigation behaviour, marker cancellation, meaningful context labels, attachment limits/types, and role-dependent resolve/SME actions. Obsolete screenshot and page-only wording is removed.

Automated tests cover hover/focus styling, filter state and empty states, compact link labels, current/cross-page hand-off, exact anchored opening, cancellation by button and Escape, selector redaction, context-label fallback order, file validation/upload/retry/download permissions/deletion, and updated Help. Chrome and Edge pilot checks cover the complete workflow on CRJU150.
