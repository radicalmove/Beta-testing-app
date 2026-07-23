import type { CourseContext } from "../course-context.ts";
import { captureTextAnchor, type TextAnchor } from "../anchors/text.ts";
import { renderTextHighlight } from "../anchors/recover.ts";
import { capturePinAnchor, renderPin, type PinAnchor } from "../anchors/pin.ts";
import type { PageComment } from "../background-bridge.ts";
import { createCommentRenderer, type CommentRenderer, type UnresolvedAnchor } from "../comment-renderer.ts";
import { coursePageJumpLabel, projectCourseComments } from "../course-comment-order.ts";
import { createReviewIcon, reviewIconMarkup } from "../ui/icon-family.ts";
import { COMMENT_MARKER_CURSOR } from "../ui/comment-cursor.ts";
import { readCoursePanelState, writeCoursePanelState, type PanelStateStorage } from "../ui/panel-state.ts";

export type { UnresolvedAnchor } from "../comment-renderer.ts";

export const OVERLAY_HOST_ID = "moodle-course-review-overlay";
export const overlayStyles = `:host{--review-red:#d73b3d;--review-navy:#000;--review-pale:#f2f2f2;--review-line:#d8d8d8;all:initial;position:fixed!important;inset:auto!important;z-index:2147483647!important;isolation:isolate;display:block!important;color:#000;font:14px/1.4 Poppins,Arial,sans-serif}.shell{box-sizing:border-box;position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:min(560px,calc(100vw - 32px));background:#fff;border:3px solid var(--review-red);border-radius:8px;box-shadow:0 8px 24px #00000038;overflow:hidden}.toolbar{display:flex;align-items:center;gap:8px;padding:7px 8px;background:#000;color:#fff}.identity{min-width:9rem;padding:0 5px;flex:1}.course,.page{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.course{font-weight:700}.page{font-size:12px;color:#fff}.pilot-version{font-size:12px;font-weight:700;white-space:nowrap}button,select,textarea{box-sizing:border-box;font:inherit}button{appearance:none;min-height:36px;border:1px solid #b9b9b9;border-radius:5px;background:#f2f2f2;color:#000;font-weight:650;padding:7px 9px;cursor:pointer}button:hover{background:#fff}.toolbar button{border-color:var(--review-red);background:var(--review-red);color:#fff}.toolbar button:hover,.primary:hover{background:#b52d30;border-color:#b52d30}button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible,[data-build-diagnostic]:focus-visible{outline:3px solid #ffd54f;outline-offset:2px;box-shadow:0 0 0 5px #000}.icon{padding:7px 10px}.status{display:flex;align-items:center;gap:5px;font-size:12px;white-space:nowrap}.dot{width:8px;height:8px;flex:0 0 8px;border:1px solid #fff;border-radius:50%;background:#ffd54f}.connected .dot{background:#16833b}.signed-out .dot,.offline .dot{background:var(--review-red)}.panel,[data-unresolved],[data-frame-fallback]{padding:10px;background:#fff;border-top:1px solid var(--review-line)}.build-diagnostic{margin:0 0 8px;padding:6px;background:#fff;color:#000;border:1px solid var(--review-line);font-size:12px}.panel[hidden],[data-unresolved][hidden]{display:none}[data-unresolved] h2{margin:0;font-size:14px}[data-unresolved] ul{display:grid;gap:6px;margin:6px 0 0;padding:0;list-style:none}[data-unresolved] li{display:flex;align-items:center;justify-content:space-between;gap:8px}.backdrop{position:fixed;inset:0;background:#0009;display:grid;place-items:center;z-index:2147483647}.dialog{box-sizing:border-box;width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#fff;border:1px solid var(--review-line);border-radius:8px;padding:18px;box-shadow:0 8px 28px #0005}.help-dialog{width:min(720px,calc(100vw - 32px))}.dialog h2{margin:0 0 10px;color:#000;font-size:18px;border-left:4px solid var(--review-red);padding-left:8px}.dialog textarea{width:100%;min-height:110px;border:1px solid #777;border-radius:5px;padding:8px}.field{display:grid;gap:4px;margin-top:9px}.preview{padding:8px;border:1px solid var(--review-line);border-radius:5px;background:var(--review-pale);font-size:12px}.error{color:#a51d24}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}.primary{background:var(--review-red);color:#fff;border-color:var(--review-red)}@media(max-width:420px){.shell{right:8px;bottom:8px;width:calc(100vw - 16px);max-width:none}.toolbar{align-items:flex-start;flex-wrap:wrap}.identity{flex-basis:100%}.status{margin-right:auto}.dialog{width:calc(100vw - 16px);max-height:calc(100vh - 16px);padding:12px}.actions{flex-wrap:wrap}.actions button{flex:1 1 auto}}`;

export const tealOverlayOverrides = `:host{--review-teal:#28c4c2;--review-teal-dark:#0b6261;--review-pale:#effafa;--review-line:#8ad9d8;color:#102f38;font:16px/1.5 Poppins,Arial,sans-serif}[hidden]{display:none!important}.shell{width:min(600px,calc(100vw - 32px));max-width:600px;border:5px solid var(--review-teal);border-radius:10px}.toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;background:var(--review-teal);color:#082f2f;padding:12px}.identity{min-width:0}.course{font-size:16px}.page{font-size:14px}.status{font-size:14px}.toolbar-actions{display:grid;grid-template-columns:minmax(0,1fr) auto 44px;gap:8px;align-items:center}.toolbar-actions button,button{min-height:44px}.toolbar-actions [data-action="add-comment"]{background:#082f2f;border-color:#082f2f;color:#fff}.toolbar-actions [data-action="panel"],.toolbar-actions [data-action="help"]{background:#fff;color:var(--review-teal-dark);border-color:#fff}.toolbar-actions [data-action="panel"]:hover,.toolbar-actions [data-action="panel"]:focus-visible,.toolbar-actions [data-action="help"]:hover,.toolbar-actions [data-action="help"]:focus-visible{background:var(--review-teal-dark);border-color:var(--review-teal-dark);color:#fff}.panel,[data-unresolved],[data-frame-fallback]{background:var(--review-pale);padding:16px}.panel-title{margin:0 0 12px;font-size:18px}.comment-filter-row{display:flex;gap:8px;flex-wrap:nowrap;margin-bottom:10px}.comment-filters{display:flex;gap:8px;margin:0}.comment-filters button{background:#fff;color:var(--review-teal-dark);border:2px solid var(--review-teal);white-space:nowrap}.comment-filters button[aria-pressed="true"]{background:#082f2f;color:#fff;border-color:#082f2f}.comment-filters button:hover{background:#28c4c2;color:#082f2f;border-color:#082f2f}.comment-index-link{display:block!important;min-width:0;min-height:auto!important;margin:4px 0!important;padding:5px 2px!important;border:0!important;background:transparent!important;color:var(--review-teal-dark)!important;text-align:left;text-decoration:none;font-size:12px;line-height:1.3;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.comment-index-link:hover,.comment-index-link:focus-visible{text-decoration:underline}.comment-index-link[hidden]{display:none!important}.comment-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px}.comment-row-actions{display:flex;gap:4px}.comment-row-action{width:40px;min-height:40px!important;padding:4px;border:2px solid var(--review-teal);background:#fff;color:var(--review-teal-dark);font-size:19px;line-height:1}.comment-row-action:hover,.comment-row-action:focus-visible{background:var(--review-teal-dark);border-color:var(--review-teal-dark);color:#fff}.comment-row-action:disabled{cursor:wait;opacity:.55}.comment-row-status{grid-column:1/-1;margin:0 2px 4px;color:#a51d24;font-size:13px}.resolve-toggle{float:right;margin-top:12px;border:2px solid #16833b;background:#fff;color:#11652e}.resolve-toggle.resolved{background:#16833b;color:#fff}.dialog{border:4px solid var(--review-teal)}.dialog h2{color:var(--review-teal-dark);font-size:20px}.primary{background:var(--review-teal-dark);border-color:var(--review-teal-dark)}input,select{box-sizing:border-box;width:100%;min-height:44px;border:1px solid #527f7f;border-radius:5px;padding:7px;font:inherit}.mode-tabs{display:flex;gap:8px}.mode-tabs [aria-pressed="true"]{background:var(--review-teal-dark);border-color:var(--review-teal-dark);color:#fff}.reconnect-code{display:block;padding:12px;background:var(--review-pale);border:2px dashed var(--review-teal-dark);font:700 16px/1.4 ui-monospace,monospace;letter-spacing:.04em}@media(max-width:600px){.toolbar{grid-template-columns:1fr}.toolbar-actions{grid-template-columns:minmax(0,1fr) auto 44px}.shell{right:8px;bottom:8px;width:calc(100vw - 16px)}}@media(max-width:420px){.comment-filter-row{flex-wrap:wrap}}@media(max-width:360px){.toolbar{padding:8px}.toolbar-actions{grid-template-columns:minmax(0,1fr) auto 44px;gap:6px}.comments-wide{display:none}.comments-short{display:inline}}`;

export const commentListLayoutStyles = `.shell{max-height:calc(100vh - 32px);display:flex;flex-direction:column}.panel{min-height:0;flex:1 1 auto;overflow:hidden;display:flex;flex-direction:column}[data-panel-content]{min-height:0;display:flex;flex-direction:column}.current-page-heading{margin:0 0 10px;color:var(--review-dark-teal);font-size:14px;line-height:1.35;font-weight:650}.current-page-heading strong{font-weight:800}.comment-results{min-height:0;flex:1 1 auto;overflow-y:auto;font-size:14px}.comment-page-field{display:grid;gap:4px;min-width:0;flex:1}.comment-page-field select{min-width:0}`;
export const approvedControlStyles = `:host{--review-dark-teal:#043e42;--review-scope:#a84f12;--review-status:#176b43;--review-jump:#356f9f;--review-help:#754668}.shell{border:3px solid var(--review-dark-teal)}.toolbar-actions button{border:2px solid var(--review-dark-teal);background:#fff;color:var(--review-dark-teal)}.toolbar-actions button[aria-pressed="true"],.toolbar-actions button[aria-expanded="true"]{background:var(--review-dark-teal);color:#fff}.toolbar-actions button:hover{background:var(--review-dark-teal);color:#fff}.toolbar-actions button[aria-pressed="true"]:hover,.toolbar-actions button[aria-expanded="true"]:hover{background:#fff;color:var(--review-dark-teal)}.toolbar-actions [data-action="panel"][aria-expanded="true"]{background:#fff;color:var(--review-teal-dark);border-color:#fff}.toolbar-actions [data-action="panel"][aria-expanded="true"]:hover{background:var(--review-teal-dark);color:#fff;border-color:var(--review-teal-dark)}.toolbar-actions [data-action="help"]{font-size:22px}.comment-filter-row{align-items:flex-start}.comment-control{box-sizing:border-box;width:104px;height:38px;min-height:38px!important;padding:0 7px;white-space:nowrap;border:2px solid;border-radius:5px;background:#fff;font-size:13px}.comment-scope{color:var(--review-scope)}.comment-status{color:var(--review-status)}.comment-jump{color:var(--review-jump);border-color:var(--review-jump)}.comment-control[aria-pressed="true"],.comment-control[aria-expanded="true"]{background:currentColor}.comment-control[aria-pressed="true"] span,.comment-control[aria-expanded="true"] span{color:#fff}.comment-control:hover{color:#fff}.comment-scope:hover{background:var(--review-scope)}.comment-status:hover{background:var(--review-status)}.comment-jump:hover{background:var(--review-jump)}.comment-control[aria-pressed="true"]:hover,.comment-control[aria-expanded="true"]:hover{background:#fff}.comment-control[aria-pressed="true"]:hover span,.comment-control[aria-expanded="true"]:hover span{color:currentColor}.comment-filters .comment-scope{color:var(--review-scope);border-color:var(--review-scope)}.comment-filters .comment-status{color:var(--review-status);border-color:var(--review-status)}.comment-filters .comment-scope[aria-pressed="true"]{background:var(--review-scope);border-color:var(--review-scope);color:#fff}.comment-filters .comment-status[aria-pressed="true"]{background:var(--review-status);border-color:var(--review-status);color:#fff}.comment-filters .comment-scope:hover{background:var(--review-scope);color:#fff}.comment-filters .comment-status:hover{background:var(--review-status);color:#fff}.comment-page-field .comment-jump:hover{background:var(--review-jump);color:#fff}.comment-filters .comment-scope[aria-pressed="true"]:hover{background:#fff;color:var(--review-scope)}.comment-filters .comment-status[aria-pressed="true"]:hover{background:#fff;color:var(--review-status)}.comment-page-field{position:relative;flex:none}.comment-page-list{position:absolute;right:0;top:42px;z-index:4;box-sizing:border-box;width:260px;max-height:260px;overflow-y:auto;padding:5px;background:#fff;border:2px solid var(--review-jump);border-radius:5px;box-shadow:0 5px 14px #0003}.comment-page-option{display:block;width:100%;min-height:36px!important;border:0;background:#fff;color:#244e71;text-align:left;text-decoration:none}.comment-page-option:hover,.comment-page-option:focus-visible{text-decoration:underline}.comment-page-option[aria-selected="true"]{background:#dceaf4;font-weight:750}.comment-results{font-size:13px}.comment-group-heading{margin:11px 0 3px;color:#506b70;font-size:13px;text-transform:uppercase;letter-spacing:.05em}.comment-row{gap:8px;padding:3px 0;border-bottom:1px solid #c9e8e7}.comment-row-actions{gap:8px}.comment-row-action{box-sizing:border-box;width:34px;min-height:34px!important;height:34px;padding:2px;border-radius:2px}.comment-row-action svg{display:block;width:100%;height:100%}.comment-row-action.status-action{border:2px solid #111;background:#fff}.comment-row-action.delete-action{border:2px solid var(--review-red);background:var(--review-red);color:#fff}.status-hover-tick{opacity:0;transition:opacity .15s ease}.status-action:hover .status-hover-tick{opacity:.28}.status-resolved-tick{opacity:1}.comment-row-action.status-action:hover{background:#f4f4f4;border-color:#111}.comment-row-action.delete-action:hover{background:#fff;border-color:var(--review-red);color:var(--review-red)}`;
export const controlAlignmentStyles = `.toolbar-actions button{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap}.toolbar-actions [data-action="help"]{box-sizing:border-box;width:44px;height:44px;padding:0;font-size:24px}.toolbar-actions [data-action="help"] svg{display:block;width:24px;height:24px}.comment-filter-row{align-items:center}.comment-control{display:inline-flex;align-items:center;justify-content:center}`;
export const semanticFilterHoverStyles = `.comment-filters .comment-scope:hover{background:var(--review-scope);border-color:var(--review-scope);color:#fff}.comment-filters .comment-status:hover{background:var(--review-status);border-color:var(--review-status);color:#fff}.comment-filters .comment-scope[aria-pressed="true"]:hover{background:#fff;border-color:var(--review-scope);color:var(--review-scope)}.comment-filters .comment-status[aria-pressed="true"]:hover{background:#fff;border-color:var(--review-status);color:var(--review-status)}.comment-jump[aria-expanded="true"]{background:var(--review-jump);border-color:var(--review-jump);color:#fff}.comment-page-field .comment-jump[aria-expanded="true"]:hover{background:#fff;border-color:var(--review-jump);color:var(--review-jump)}.toolbar-actions [data-action="add-comment"]{background:#fff;border-color:var(--review-dark-teal);color:var(--review-dark-teal)}.toolbar-actions [data-action="add-comment"]:hover{background:var(--review-dark-teal);border-color:var(--review-dark-teal);color:#fff}.toolbar-actions [data-action="add-comment"][aria-pressed="true"]{background:var(--review-red);border-color:var(--review-red);color:#fff}.toolbar-actions [data-action="add-comment"][aria-pressed="true"]:hover{background:#fff;border-color:var(--review-red);color:var(--review-red)}.comment-row-action.delete-action{border-radius:5px}.comment-page-list{position:fixed;width:min(380px,calc(100vw - 32px));overflow-y:auto}.comment-page-option{min-height:34px!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500}.comment-page-option[aria-selected="true"]{font-weight:650}.shell:has(.comment-jump[aria-expanded="true"]),.panel:has(.comment-jump[aria-expanded="true"]){overflow:visible}`;
export const helpButtonStyles = `.toolbar-actions [data-action="help"]{background:#fff;border-color:var(--review-help);color:var(--review-help)}.toolbar-actions [data-action="help"][aria-expanded="true"]{background:var(--review-help);border-color:var(--review-help);color:#fff}.toolbar-actions [data-action="help"][aria-expanded="false"]:hover,.toolbar-actions [data-action="help"][aria-expanded="false"]:focus-visible{background:var(--review-help);border-color:var(--review-help);color:#fff}.toolbar-actions [data-action="help"][aria-expanded="true"]:hover,.toolbar-actions [data-action="help"][aria-expanded="true"]:focus-visible{background:#fff;border-color:var(--review-help);color:var(--review-help)}`;
export const commentsButtonStyles = `.toolbar-actions [data-action="panel"]{background:#fff;border-color:var(--review-teal-dark);color:var(--review-teal-dark)}.toolbar-actions [data-action="panel"]:hover{background:var(--review-teal-dark);border-color:var(--review-teal-dark);color:#fff}.toolbar-actions [data-action="panel"][aria-expanded="true"]{background:var(--review-teal-dark);border-color:var(--review-teal-dark);color:#fff}.toolbar-actions [data-action="panel"][aria-expanded="true"]:hover{background:#fff;border-color:var(--review-teal-dark);color:var(--review-teal-dark)}`;
export const panelTransitionStyles = `.panel{max-height:calc(100vh - 96px);opacity:1;padding-top:16px;padding-bottom:16px;border-top-width:1px}.panel[data-panel-animate="true"]{transition:max-height 180ms ease,opacity 180ms ease,padding-top 180ms ease,padding-bottom 180ms ease,border-top-width 180ms ease}.panel[data-panel-state="closed"],.panel[data-panel-state="closing"]{max-height:0;opacity:0;padding-top:0;padding-bottom:0;border-top-width:0}@media(prefers-reduced-motion:reduce){.panel[data-panel-animate="true"]{transition:none}}`;
export const creationComposerSpacingStyles = `.preview+.comment-composer{margin-top:10px}`;
export const commentComposerStyles = `.comment-composer-field-row{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:8px;align-items:start}.comment-composer-field-row textarea{min-width:0;width:100%;min-height:110px}.comment-composer-save{box-sizing:border-box;width:34px;height:34px;min-height:34px!important;padding:2px;border:2px solid #176b43;border-radius:5px;background:#176b43;color:#fff}.comment-composer-save svg{display:block;width:100%;height:100%}.comment-composer-save:hover{background:#fff;color:#176b43}.comment-composer-actions{display:flex;justify-content:flex-end;margin-top:8px}.comment-composer-cancel{box-sizing:border-box;width:calc((100% - 16px)/3);height:34px;min-height:34px!important;padding:3px 9px;border:2px solid #d73b3d;border-radius:5px;background:#d73b3d;color:#fff;font:inherit;font-weight:650;line-height:1}.comment-composer-cancel:hover{background:#fff;color:#d73b3d}@media(max-width:420px){.comment-composer-actions button{flex:0 0 auto}}`;
export const stabilisationUxStyles = `.help-dialog{width:min(860px,calc(100vw - 32px))}.comment-index-link{white-space:normal;overflow:hidden;text-overflow:ellipsis;display:-webkit-box!important;-webkit-line-clamp:2;-webkit-box-orient:vertical}`;

export type ConnectionStatus = "connecting" | "connected" | "pending" | "signed-out" | "offline";
const statusLabels: Record<ConnectionStatus, string> = { connecting: "Connecting", connected: "Connected", pending: "Waiting for approval — you can leave this page open or return later.", "signed-out": "Signed out", offline: "Service unavailable—retry" };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const authActionLabels: Partial<Record<ConnectionStatus, string>> = { "signed-out": "Sign in", pending: "Check approval", offline: "Retry" };

function createStateActions(status: ConnectionStatus): string {
  const action = authActionLabels[status];
  const reviewControls = status === "connected" || status === "connecting" ? `<span class="toolbar-actions" data-review-controls><button type="button" data-action="add-comment" aria-pressed="false">Add comment marker</button><button type="button" data-action="panel" aria-expanded="false"><span class="comments-wide">Comments (<span data-comment-count>0</span>)</span><span class="comments-short"><span data-comment-count-short>0</span> comments</span></button><button type="button" data-action="help" aria-label="Help and instructions" title="Help and instructions" aria-expanded="false">${reviewIconMarkup("help")}</button></span>` : "";
  return `<span data-auth-action>${action ? `<button type="button" data-action="authenticate">${action}</button>` : ""}</span>${reviewControls}`;
}

export type BuildDiagnostics = { version: string; buildCommit: string };
const defaultBuildDiagnostics: BuildDiagnostics = { version: "0.0.0", buildCommit: "0000000000000000000000000000000000000000" };

export function createOverlayMarkup(input: { courseTitle: string; pageTitle: string; status: ConnectionStatus } & Partial<BuildDiagnostics>): string {
  const { version, buildCommit } = { ...defaultBuildDiagnostics, ...input };
  return `<section class="shell" tabindex="-1"><div class="toolbar" role="toolbar" aria-label="Course review tools"><div class="identity"><span class="course" title="${escapeHtml(input.courseTitle)}">${escapeHtml(input.courseTitle)}</span><span class="viewer-line" data-viewer-line hidden><span class="viewer" data-viewer></span><button type="button" class="sign-out" data-action="sign-out">Sign out</button></span><span class="status ${input.status}" data-auth-status aria-live="polite" aria-atomic="true"><span class="dot" aria-hidden="true"></span><span data-status-message>${statusLabels[input.status]}</span></span></div>${createStateActions(input.status)}</div><div class="panel" hidden><div data-panel-content>No comments on this page yet.</div></div><span data-build-info hidden>${escapeHtml(version)}|${escapeHtml(buildCommit.slice(0, 7))}</span></section>`;
}

export function handleDialogKey(input: { key: string; shiftKey: boolean; activeIndex: number; focusableCount: number }): { focusIndex: number; close: boolean } {
  if (input.key === "Escape") return { focusIndex: input.activeIndex, close: true };
  if (input.key !== "Tab" || input.focusableCount < 1) return { focusIndex: input.activeIndex, close: false };
  const delta = input.shiftKey ? -1 : 1;
  return { focusIndex: (input.activeIndex + delta + input.focusableCount) % input.focusableCount, close: false };
}

export type CommentAnchor = ({ anchor_type: "text_highlight" } & TextAnchor) | ({ anchor_type: "visual_pin" } & PinAnchor);
export type AuthenticationOutcome = { status: ConnectionStatus; message?: string };
export type ReviewerAccessInput = { displayName: string; email: string; role: string; code: string };
type SignOutOptions = { onSignOut?: () => Promise<void> };
export type ReviewOverlayOptions = { panelStateStorage?: PanelStateStorage; onRequestInteraction?: (intent: "marker" | "selection") => void; onRequestPermission?: () => Promise<boolean>; onReloadRequired?: () => void; submitEmbedded?: (input: { capability: string; body: string; category: string; screenshot: boolean }) => Promise<{ id?: string; screenshot_available?: boolean } | void>; onAuthenticate?: () => Promise<AuthenticationOutcome>; onCheckApproval?: () => Promise<AuthenticationOutcome>; onAccessSubmit?: (input: ReviewerAccessInput) => Promise<AuthenticationOutcome>; findApprovedReviewer?: (email: string) => Promise<{ membershipId: string; label: string } | undefined>; onUseSavedReviewer?: (membershipId: string) => Promise<AuthenticationOutcome>; useAccessForm?: () => boolean; navigateToComment?: (commentId: string, pageUrl: string) => Promise<void>; submit?: (input: { body: string; category: string; anchor: CommentAnchor; screenshot: boolean; embeddedFrameUnavailable: boolean; contextSnapshot: CourseContext }) => Promise<{ id?: string; screenshot_available?: boolean } | void>; editThread?: (commentId: string, body: string) => Promise<void>; replyThread?: (commentId: string, body: string) => Promise<void>; changeStatus?: (commentId: string, status: string) => Promise<void>; refreshComments?: () => Promise<void>; manageSme?: (commentId: string, userIds?: string[]) => Promise<{ available_recipients: Array<{ id: string; display_name: string }>; selected_user_ids: string[] }>; deleteThread?: (commentId: string) => Promise<void>; uploadScreenshot?: (commentId: string, dataUrl: string) => Promise<void>; cancelScreenshot?: (commentId: string) => Promise<void>; captureScreenshot?: () => Promise<string>; onFrameFallback?: () => void; onTakeToContext?: (id: string) => void };
export type ReviewOverlay = { update(context: CourseContext, status: ConnectionStatus): void; setInteractionState(state: "local" | "loading" | "embedded" | "permission-required" | "reload-required" | "unavailable", hasSelection?: boolean, markerActive?: boolean): void; setViewer(viewer?: { display_name: string | null; email: string; role: string }): void; setCommentList(comments: PageComment[]): void; setRendererComments(comments: PageComment[]): void; setPageComments(comments: PageComment[]): void; setCommentNavigationStatus(message?: string): void; takeToContext(id: string): boolean; showFrameFallback(): void; hideFrameFallback(): void; setPresentationVisible(visible: boolean): void; setPresentationPosition(position?: { left: number; top: number }): void; presentationSize(): { width: number; height: number }; setUnresolvedAnchors(anchors: UnresolvedAnchor[]): void; destroy(): void };

export function mountReviewOverlay(document: Document, context: CourseContext, status: ConnectionStatus = "connecting", options: ReviewOverlayOptions & SignOutOptions = {}, buildDiagnostics: BuildDiagnostics = defaultBuildDiagnostics): ReviewOverlay {
  const existing = document.getElementById(OVERLAY_HOST_ID) as HTMLElement | null;
  if (existing?.shadowRoot) return createController(existing, existing.shadowRoot, context, status, options, buildDiagnostics);
  const host = document.createElement("div");
  host.id = OVERLAY_HOST_ID;
  host.setAttribute("data-moodle-review-ui", "true");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;isolation:isolate;display:block;font-family:Poppins,Arial,sans-serif;font-size:16px;line-height:1.5;color:#102f38";
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = overlayStyles + tealOverlayOverrides + `.viewer{display:block;font-size:13px;font-weight:650;color:#082f2f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.viewer[hidden]{display:none}.comments-short{display:none}@media(max-width:360px){.comments-wide{display:none}.comments-short{display:inline}}.comment-choice{padding:16px;background:var(--review-pale);border-top:1px solid var(--review-line)}.comment-choice h2{margin:0 0 10px;font-size:18px}.comment-choice button{display:grid;width:100%;margin-top:8px;text-align:left}.comment-choice button span{font-size:14px;font-weight:400}.help-dialog ol{display:grid;gap:12px;padding-left:22px}.help-dialog li span{display:block;font-size:14px}.help-version{font-size:14px;color:#52666c}`;
  style.textContent += commentListLayoutStyles + approvedControlStyles + controlAlignmentStyles + semanticFilterHoverStyles + helpButtonStyles + commentsButtonStyles + panelTransitionStyles + creationComposerSpacingStyles + commentComposerStyles;
  style.textContent += stabilisationUxStyles + `.existing-action{margin-top:12px}.existing-confirmation{display:grid;gap:6px;margin-top:14px;padding:12px;border:1px solid var(--review-line);border-radius:7px;background:var(--review-pale)}.existing-confirmation[hidden]{display:none}.admin-sign-in{margin-top:12px}`;
  style.textContent += `.viewer-line{display:flex;align-items:center;gap:8px;min-width:0}.viewer-line[hidden]{display:none}.viewer-line .viewer{min-width:0}.sign-out{min-height:0!important;padding:0!important;border:0!important;background:transparent!important;color:#082f2f!important;font-size:12px;text-decoration:underline}.sign-out:hover{color:#7b235e!important}`;
  shadow.append(style);
  return createController(host, shadow, context, status, options, buildDiagnostics);
}

function createController(host: HTMLElement, shadow: ShadowRoot, initial: CourseContext, initialStatus: ConnectionStatus, options: ReviewOverlayOptions & SignOutOptions, buildDiagnostics: BuildDiagnostics): ReviewOverlay {
  const ownerDocument = host.ownerDocument;
  let lastPageFocus: HTMLElement | null = null;
  const rememberPageFocus = (event: FocusEvent) => { const target = event.target as HTMLElement | null; if (target && target !== host && !host.contains(target)) lastPageFocus = target; };
  ownerDocument.addEventListener("focusin", rememberPageFocus, true);
  let context = initial;
  let status = initialStatus;
  let currentViewer: { display_name: string | null; email: string; role: string } | undefined;
  let authenticating = false;
  let stateVersion = 0;
  let returnFocus: HTMLElement | null = null;
  let previewCleanup: (() => void) | undefined;
  let pinListener: ((event: PointerEvent) => void) | undefined;
  let areaKeyListener: ((event: KeyboardEvent) => void) | undefined;
  let areaCandidates: HTMLElement[] = [];
  let areaCandidateIndex = -1;
  let choiceOutsideListener: ((event: PointerEvent) => void) | undefined;
  let fallbackPin = false;
  let frameUnavailable = false;
  let composerContext: CourseContext | undefined;
  let pendingScreenshotId: string | undefined;
  let interactionTarget: "local" | "loading" | "embedded" | "permission-required" | "reload-required" | "unavailable" = "local";
  let embeddedSelection = false;
  let embeddedMarkerActive = false;
  let loadingMarkerQueued = false;
  let loadedComments = new Map<string, PageComment>();
  const rowMutations = new Map<string, { pending: boolean; error?: string }>();
  const transientStatuses = new Map<string, { original: PageComment; nextStatus: "open" | "resolved"; timer: number }>();
  let commentListFilter: "open" | "resolved" = "open";
  let commentListScope: "course" | "page" = "course";
  let commentListPage = "";
  let jumpOutsideListener: EventListener | undefined;
  let renderer: CommentRenderer;
  let rendererOrder = new Map<string, number>();
  let panelOpen = false;
  let panelOpenBeforeMarker: boolean | undefined;
  let panelTransitionTimer: number | undefined;
  const panelStateStorage = options.panelStateStorage ?? (() => {
    try { return ownerDocument.defaultView?.localStorage; }
    catch { return undefined; }
  })();
  const clearPanelTransition = () => {
    if (panelTransitionTimer === undefined) return;
    ownerDocument.defaultView?.clearTimeout(panelTransitionTimer);
    panelTransitionTimer = undefined;
  };
  const setPanelOpen = (open: boolean, behavior: { animate: boolean; persist: boolean }) => {
    const panel = shadow.querySelector<HTMLElement>(".panel");
    if (!panel) return;
    clearPanelTransition();
    panelOpen = open;
    if (behavior.persist) writeCoursePanelState(panelStateStorage, context.course_url, open);
    const toggle = shadow.querySelector<HTMLElement>('[data-action="panel"]');
    toggle?.setAttribute("aria-expanded", String(open));
    toggle?.setAttribute("aria-label", open ? "Close review panel" : "Open review panel");
    let reducedMotion = false;
    try { reducedMotion = ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; }
    catch { reducedMotion = true; }
    const animate = behavior.animate && !reducedMotion;
    if (open) {
      const wasHidden = panel.hidden;
      panel.hidden = false;
      panel.inert = false;
      if (!animate) {
        panel.dataset.panelState = "open";
        delete panel.dataset.panelAnimate;
        return;
      }
      panel.dataset.panelAnimate = "true";
      if (wasHidden) {
        panel.dataset.panelState = "closed";
        void panel.offsetHeight;
      }
      panel.dataset.panelState = "opening";
      panelTransitionTimer = ownerDocument.defaultView?.setTimeout(() => {
        panelTransitionTimer = undefined;
        panel.dataset.panelState = "open";
        delete panel.dataset.panelAnimate;
      }, 180);
      return;
    }
    const activeElement = shadow.activeElement;
    if (activeElement && panel.contains(activeElement)) {
      const focusTarget = shadow.querySelector<HTMLElement>('[data-action="authenticate"]')
        ?? shadow.querySelector<HTMLElement>('[data-action="panel"]')
        ?? shadow.querySelector<HTMLElement>(".shell");
      focusTarget?.focus();
    }
    panel.inert = true;
    if (!animate || panel.hidden) {
      panel.hidden = true;
      panel.dataset.panelState = "closed";
      delete panel.dataset.panelAnimate;
      return;
    }
    panel.dataset.panelAnimate = "true";
    panel.dataset.panelState = "closing";
    panelTransitionTimer = ownerDocument.defaultView?.setTimeout(() => {
      panelTransitionTimer = undefined;
      panel.hidden = true;
      panel.dataset.panelState = "closed";
      delete panel.dataset.panelAnimate;
    }, 180);
  };
  const clearAreaSelection = () => {
    ownerDocument.removeEventListener("pointerdown", pinListener!, true);
    ownerDocument.removeEventListener("keydown", cancelPin, true);
    if (areaKeyListener) ownerDocument.removeEventListener("keydown", areaKeyListener, true);
    pinListener = undefined; areaKeyListener = undefined;
    ownerDocument.documentElement.style.removeProperty("cursor");
    const action = shadow.querySelector<HTMLElement>('[data-action="add-comment"]');
    if (action) { action.setAttribute("aria-pressed", "false"); action.textContent = "Add comment marker"; }
    shadow.querySelector("[data-marker-instruction]")?.remove();
    const panelContent = shadow.querySelector<HTMLElement>("[data-panel-content]");
    if (panelContent) panelContent.hidden = false;
    const restorePanelOpen = panelOpenBeforeMarker;
    panelOpenBeforeMarker = undefined;
    if (restorePanelOpen !== undefined) setPanelOpen(restorePanelOpen, { animate: false, persist: false });
    for (const candidate of areaCandidates) { candidate.style.removeProperty("outline"); candidate.style.removeProperty("outline-offset"); }
    areaCandidates = []; areaCandidateIndex = -1;
  };
  const contextLabel = (anchor: CommentAnchor) => {
    if (anchor.anchor_type === "text_highlight") return `Commenting on: “${anchor.selected_quote.slice(0, 180)}${anchor.selected_quote.length > 180 ? "…" : ""}”`;
    const target = ownerDocument.querySelector<HTMLElement>(anchor.css_selector);
    const clean = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
    const direct = clean(target?.getAttribute("aria-label")) || clean(target?.getAttribute("alt")) || clean(target?.textContent);
    const heading = target?.closest("section,article,main,aside")?.querySelector<HTMLElement>("h1,h2,h3,h4,h5,h6,[aria-label]");
    const label = (direct.length >= 2 && direct.length <= 120 ? direct : clean(heading?.getAttribute("aria-label")) || clean(heading?.textContent)).slice(0, 120);
    return label ? `Commenting near: ${label}` : "Commenting on this part of the page";
  };
  const cancelPin = (event: KeyboardEvent) => { if (event.key === "Escape" && pinListener) { clearAreaSelection(); fallbackPin = false; returnFocus?.focus(); } };
  const mount = () => {
    const style = shadow.querySelector("style");
    shadow.innerHTML = "";
    if (style) shadow.append(style);
    const wrapper = ownerDocument.createElement("div");
    wrapper.innerHTML = createOverlayMarkup({ courseTitle: context.title, pageTitle: context.pageTitle, status, ...buildDiagnostics });
    shadow.append(...Array.from(wrapper.childNodes));
    bind();
  };
  const updateLabels = () => {
    const course = shadow.querySelector<HTMLElement>(".course");
    if (course) { course.textContent = `${context.title}${context.identityConfidence === "unconfirmed" ? " (unconfirmed)" : ""}`; course.title = context.title; }
    const viewerLine = shadow.querySelector<HTMLElement>("[data-viewer-line]");
    const viewer = shadow.querySelector<HTMLElement>("[data-viewer]");
    if (viewerLine) viewerLine.hidden = !currentViewer;
    if (viewer) viewer.textContent = currentViewer ? `${currentViewer.display_name || currentViewer.email} · ${currentViewer.role === "ld_dcd" ? "Learning Designer / Course Developer" : currentViewer.role === "sme" ? "Subject Matter Expert" : currentViewer.role === "beta_tester" ? "Beta Tester" : "Administrator"}` : "";
    renderStateControls();
  };
  const renderStateControls = (message = statusLabels[status]) => {
    const toolbar = shadow.querySelector<HTMLElement>(".toolbar");
    if (!toolbar) return;
    const panel = shadow.querySelector<HTMLElement>(".panel");
    const existingPanelToggle = toolbar.querySelector<HTMLElement>('[data-action="panel"]');
    const hadPanelToggle = Boolean(existingPanelToggle);
    const panelToggleHadFocus = shadow.activeElement === existingPanelToggle;
    const statusNode = toolbar.querySelector<HTMLElement>("[data-auth-status]");
    if (statusNode) { statusNode.className = `status ${status}`; const messageNode = statusNode.querySelector<HTMLElement>("[data-status-message]"); if (messageNode) messageNode.textContent = message; }
    toolbar.querySelector("[data-auth-action]")?.remove(); toolbar.querySelector("[data-review-controls]")?.remove();
    const wrapper = ownerDocument.createElement("div"); wrapper.innerHTML = createStateActions(status); toolbar.append(...Array.from(wrapper.childNodes));
    bind();
    const panelToggle = toolbar.querySelector<HTMLElement>('[data-action="panel"]');
    if (panelToggle && !hadPanelToggle) setPanelOpen(readCoursePanelState(panelStateStorage, context.course_url), { animate: false, persist: false });
    else if (panelToggle) { panelToggle.setAttribute("aria-expanded", String(panelOpen)); panelToggle.setAttribute("aria-label", panelOpen ? "Close review panel" : "Open review panel"); }
    else if (panel) setPanelOpen(false, { animate: false, persist: false });
    if (panelToggleHadFocus) {
      const focusTarget = panelToggle
        ?? toolbar.querySelector<HTMLElement>('[data-action="authenticate"]')
        ?? shadow.querySelector<HTMLElement>(".shell");
      focusTarget?.focus();
    }
  };
  const bindStateControls = () => {
    const signOutButton = shadow.querySelector<HTMLButtonElement>('[data-action="sign-out"]');
    if (signOutButton && signOutButton.dataset.bound !== "true") signOutButton.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true; button.textContent = "Signing out…";
      try { await options.onSignOut?.(); currentViewer = undefined; status = "signed-out"; updateLabels(); }
      catch { button.disabled = false; button.textContent = "Sign out"; renderStateControls("Sign out failed—try again"); }
    });
    if (signOutButton) signOutButton.dataset.bound = "true";
    shadow.querySelector<HTMLButtonElement>('[data-action="authenticate"]')?.addEventListener("click", async (event) => {
      if (authenticating) return;
      if (status === "pending" && options.onCheckApproval) {
        authenticating = true; const attemptVersion = ++stateVersion; const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true; button.textContent = "Checking…"; button.setAttribute("aria-busy", "true");
        try { const outcome = await options.onCheckApproval(); if (attemptVersion !== stateVersion) return; status = outcome.status; authenticating = false; renderStateControls(outcome.message); if (status === "connected") shadow.querySelector<HTMLElement>('[data-action="add-comment"]')?.focus(); else shadow.querySelector<HTMLElement>('[data-action="authenticate"]')?.focus(); }
        catch { if (attemptVersion !== stateVersion) return; authenticating = false; renderStateControls("Waiting for approval — you can leave this page open or return later."); shadow.querySelector<HTMLElement>('[data-action="authenticate"]')?.focus(); }
        return;
      }
      if (options.onAccessSubmit && (options.useAccessForm?.() ?? true)) { openAccessDialog(event.currentTarget as HTMLElement); return; }
      authenticating = true;
      const attemptVersion = ++stateVersion;
      const button = event.currentTarget as HTMLButtonElement; button.disabled = true; button.textContent = "Signing in…"; button.setAttribute("aria-busy", "true");
      try {
        const outcome = await options.onAuthenticate?.();
        if (attemptVersion !== stateVersion) return;
        status = outcome?.status ?? "signed-out"; authenticating = false; renderStateControls(outcome?.message);
        if (status === "connected") shadow.querySelector<HTMLElement>('[data-action="add-comment"]')?.focus();
        else shadow.querySelector<HTMLElement>('[data-action="authenticate"]')?.focus();
      } catch {
        if (attemptVersion !== stateVersion) return;
        status = "signed-out"; authenticating = false; renderStateControls("Sign-in failed—try again"); shadow.querySelector<HTMLElement>('[data-action="authenticate"]')?.focus();
      }
    });
  };
  const openAccessDialog = (trigger: HTMLElement) => {
    returnFocus = trigger;
    const backdrop = ownerDocument.createElement("div"); backdrop.className = "backdrop";
    backdrop.innerHTML = `<form class="dialog" data-access-form><h2>Join this course review</h2><div class="mode-tabs"><button type="button" data-mode="new" aria-pressed="true">New reviewer</button><button type="button" data-mode="existing" aria-pressed="false">Existing reviewer</button></div><div data-new-fields><label class="field">Name<input name="displayName" required maxlength="100"></label><label class="field">Role<select name="role"><option value="beta_tester">Beta tester</option><option value="sme">Subject matter expert</option><option value="ld_dcd">Learning designer / course developer</option></select></label><label class="field">Email<input name="email" type="email" required maxlength="320"></label><label class="field">Invitation code<input name="code" required maxlength="32" autocomplete="one-time-code"></label></div><div data-existing-fields hidden><label class="field">Email<input name="existingEmail" type="email" maxlength="320" autocomplete="email"></label><button type="button" class="primary existing-action" data-find-existing>Find reviewer</button><p data-no-saved hidden>No approved reviewer was found for this email in this course.</p><div class="existing-confirmation" data-existing-confirmation hidden><strong data-existing-label></strong><span data-existing-email></span><button type="button" class="primary" data-confirm-existing>Confirm and continue</button></div><hr><button type="button" class="primary admin-sign-in" data-admin-sign-in>Admin sign in</button></div><p class="error" role="alert" hidden></p><div class="actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary" data-new-submit>Continue</button></div></form>`;
    let matchedReviewer: { membershipId: string; label: string } | undefined;
    const setMode = (mode: "new" | "existing") => {
      backdrop.querySelector<HTMLElement>("[data-new-fields]")!.hidden = mode !== "new";
      backdrop.querySelector<HTMLElement>("[data-existing-fields]")!.hidden = mode !== "existing";
      backdrop.querySelector<HTMLElement>("[data-new-submit]")!.hidden = mode !== "new";
      backdrop.querySelectorAll<HTMLElement>("[data-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
      if (mode === "existing") backdrop.querySelector<HTMLInputElement>('[name="existingEmail"]')?.focus();
    };
    backdrop.querySelector('[data-mode="new"]')?.addEventListener("click", () => setMode("new"));
    backdrop.querySelector('[data-mode="existing"]')?.addEventListener("click", () => setMode("existing"));
    backdrop.querySelector<HTMLButtonElement>("[data-admin-sign-in]")?.addEventListener("click", async (event) => { if (!options.onAuthenticate) return; const button = event.currentTarget as HTMLButtonElement; button.disabled = true; button.textContent = "Signing in…"; try { const outcome = await options.onAuthenticate(); close(); status = outcome.status; renderStateControls(outcome.message); } catch { button.disabled = false; button.textContent = "Admin sign in"; } });
    backdrop.querySelector<HTMLButtonElement>("[data-find-existing]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const email = backdrop.querySelector<HTMLInputElement>('[name="existingEmail"]')!.value.trim();
      const error = backdrop.querySelector<HTMLElement>(".error")!;
      const notFound = backdrop.querySelector<HTMLElement>("[data-no-saved]")!;
      const confirmation = backdrop.querySelector<HTMLElement>("[data-existing-confirmation]")!;
      error.hidden = true; notFound.hidden = true; confirmation.hidden = true; matchedReviewer = undefined;
      if (!email || !email.includes("@")) { error.textContent = "Enter your email address."; error.hidden = false; return; }
      button.disabled = true; button.textContent = "Checking…";
      try {
        matchedReviewer = await options.findApprovedReviewer?.(email);
        if (!matchedReviewer) { notFound.hidden = false; return; }
        const [local, domain = ""] = email.split("@");
        const maskedLocal = local.length < 2 ? "*" : `${local[0]}${"*".repeat(Math.max(1, local.length - 2))}${local.at(-1)}`;
        backdrop.querySelector<HTMLElement>("[data-existing-label]")!.textContent = matchedReviewer.label;
        backdrop.querySelector<HTMLElement>("[data-existing-email]")!.textContent = `${maskedLocal}@${domain}`;
        confirmation.hidden = false;
      } catch { error.textContent = "Unable to verify reviewer access"; error.hidden = false; }
      finally { button.disabled = false; button.textContent = "Find reviewer"; }
    });
    backdrop.querySelector("[data-confirm-existing]")?.addEventListener("click", async () => { if (!matchedReviewer || !options.onUseSavedReviewer) return; const outcome = await options.onUseSavedReviewer(matchedReviewer.membershipId); close(); status = outcome.status; renderStateControls(outcome.message); });
    const close = () => { backdrop.remove(); returnFocus?.focus(); };
    backdrop.querySelector("[data-cancel]")?.addEventListener("click", close);
    backdrop.querySelector("form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const data = new FormData(form); const error = form.querySelector<HTMLElement>(".error")!; const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!; submit.disabled = true; error.hidden = true; try { const input: ReviewerAccessInput = { displayName: String(data.get("displayName") ?? "").trim(), email: String(data.get("email") ?? "").trim(), role: String(data.get("role") ?? "beta_tester"), code: String(data.get("code") ?? "").trim() }; const outcome = await options.onAccessSubmit!(input); close(); status = outcome.status; renderStateControls(outcome.message); } catch (caught) { error.textContent = caught instanceof Error ? caught.message : "Unable to verify reviewer access"; error.hidden = false; submit.disabled = false; } });
    shadow.append(backdrop); backdrop.querySelector<HTMLInputElement>('input[name="displayName"]')?.focus();
  };
  const cleanupPreview = () => { previewCleanup?.(); previewCleanup = undefined; };
  const closeDialog = () => { if (pendingScreenshotId) void options.cancelScreenshot?.(pendingScreenshotId).catch(() => undefined); pendingScreenshotId = undefined; shadow.querySelector(".backdrop")?.remove(); composerContext = undefined; cleanupPreview(); fallbackPin = false; returnFocus?.focus(); };
  const closeChoice = (restore = true) => { shadow.querySelector("[data-comment-choice]")?.remove(); if (choiceOutsideListener) ownerDocument.removeEventListener("pointerdown", choiceOutsideListener, true); choiceOutsideListener = undefined; if (restore) returnFocus?.focus(); };
  const startAreaSelection = (trigger: HTMLElement) => {
    closeChoice(false);
    if (pinListener) clearAreaSelection();
    returnFocus = trigger;
    panelOpenBeforeMarker = panelOpen;
    trigger.setAttribute("aria-pressed", "true");
    trigger.textContent = "💬 Cancel marker";
    ownerDocument.documentElement.style.cursor = COMMENT_MARKER_CURSOR;
    setPanelOpen(true, { animate: false, persist: false });
    const panel = shadow.querySelector<HTMLElement>(".panel")!;
    const panelContent = panel.querySelector<HTMLElement>("[data-panel-content]")!;
    panelContent.hidden = panelOpenBeforeMarker !== true;
    const instruction = ownerDocument.createElement("div");
    instruction.dataset.markerInstruction = "true";
    instruction.setAttribute("role", "status");
    instruction.setAttribute("aria-live", "polite");
    instruction.tabIndex = -1;
    instruction.textContent = "Click an area, or use the arrow keys to choose one. Press Escape to cancel.";
    panel.insertBefore(instruction, panelContent);
    const finish = (element: HTMLElement, x: number, y: number) => { const anchor = capturePinAnchor(element, x, y); if (!anchor) return; clearAreaSelection(); previewCleanup = renderPin(ownerDocument, anchor); openDialog(trigger, frameUnavailable ? "Comment on embedded content" : "Comment on an area", { anchor_type: "visual_pin", ...anchor }); };
    pinListener = (pointer) => {
      const pointed = ownerDocument.elementFromPoint(pointer.clientX, pointer.clientY) as HTMLElement | null;
      const eventTarget = pointer.target as HTMLElement | null;
      const element = pointed ?? (eventTarget?.nodeType === 1 ? eventTarget : null);
      if (!element || host.contains(element)) return;
      pointer.preventDefault(); pointer.stopPropagation(); finish(element, pointer.clientX, pointer.clientY);
    };
    areaCandidates = Array.from(ownerDocument.querySelectorAll<HTMLElement>("main,article,section,h1,h2,h3,h4,h5,h6,p,li,a,button,img,video,iframe,input,select,textarea,[role]"))
      .filter((element) => !host.contains(element) && element.getBoundingClientRect().width >= 24 && element.getBoundingClientRect().height >= 24).slice(0, 200);
    const showCandidate = (next: number) => { if (!areaCandidates.length) return; if (areaCandidateIndex >= 0) { areaCandidates[areaCandidateIndex]?.style.removeProperty("outline"); areaCandidates[areaCandidateIndex]?.style.removeProperty("outline-offset"); } areaCandidateIndex = (next + areaCandidates.length) % areaCandidates.length; const candidate = areaCandidates[areaCandidateIndex]!; candidate.style.setProperty("outline", "3px solid #b85812", "important"); candidate.style.setProperty("outline-offset", "3px", "important"); candidate.scrollIntoView?.({ block: "nearest", inline: "nearest" }); };
    areaKeyListener = (event) => { if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); showCandidate(areaCandidateIndex + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1)); } else if (event.key === "Enter" && areaCandidateIndex >= 0) { event.preventDefault(); event.stopPropagation(); const candidate = areaCandidates[areaCandidateIndex]!; const rect = candidate.getBoundingClientRect(); finish(candidate, rect.left + rect.width / 2, rect.top + rect.height / 2); } };
    ownerDocument.addEventListener("pointerdown", pinListener, true); ownerDocument.addEventListener("keydown", cancelPin, true);
    ownerDocument.addEventListener("keydown", areaKeyListener, true);
    if (areaCandidates.length) showCandidate(Math.max(0, areaCandidates.indexOf(lastPageFocus!)));
    else instruction.textContent = "No selectable areas found; use Comment on text instead.";
    instruction.focus();
  };
  const openCommentChoice = (trigger: HTMLElement) => {
    closeChoice(false); returnFocus = trigger;
    const selection = ownerDocument.defaultView?.getSelection();
    const selectedRange = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0).cloneRange() : undefined;
    const textAnchor = selectedRange ? captureTextAnchor(selectedRange, ownerDocument) : null;
    const choice = ownerDocument.createElement("section"); choice.dataset.commentChoice = "true"; choice.className = "comment-choice"; choice.setAttribute("aria-label", "Choose how to add a comment");
    choice.innerHTML = `<h2>Add a comment</h2><button type="button" data-choice="text"><strong>Comment on text</strong><span>Select words on the course page, then choose this option.</span></button><button type="button" data-choice="area"><strong>${frameUnavailable ? "Comment on embedded content" : "Comment on an area"}</strong><span>${frameUnavailable ? "Mark the area of the embedded activity your feedback relates to." : "Click the part of the page your feedback relates to."}</span></button><button type="button" data-choice="cancel">Cancel</button>`;
    choice.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); closeChoice(); } });
    choice.querySelector('[data-choice="cancel"]')?.addEventListener("click", () => closeChoice());
    choice.querySelector('[data-choice="text"]')?.addEventListener("click", () => { if (!textAnchor || !selectedRange) { closeChoice(false); setPanelOpen(true, { animate: false, persist: false }); shadow.querySelector<HTMLElement>("[data-panel-content]")!.textContent = "Select text on the page first."; ownerDocument.body?.focus?.(); return; } closeChoice(false); previewCleanup = renderTextHighlight(ownerDocument, selectedRange); openDialog(trigger, "Comment on text", { anchor_type: "text_highlight", ...textAnchor }); });
    choice.querySelector('[data-choice="area"]')?.addEventListener("click", () => { fallbackPin = frameUnavailable; startAreaSelection(trigger); });
    shadow.querySelector(".shell")?.append(choice);
    choiceOutsideListener = (event) => { if (event.target !== host) closeChoice(); };
    ownerDocument.addEventListener("pointerdown", choiceOutsideListener, true);
    choice.querySelector<HTMLElement>('[data-choice="text"]')?.focus();
  };
  const selectedTextDraft = () => {
    const selection = ownerDocument.defaultView?.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return undefined;
    const range = selection.getRangeAt(0).cloneRange();
    const anchor = captureTextAnchor(range, ownerDocument);
    return anchor ? { range, anchor } : undefined;
  };
  const updateAdaptiveAction = () => {
    const button = shadow.querySelector<HTMLButtonElement>('[data-action="add-comment"]');
    if (!button) return;
    if (interactionTarget === "embedded" || interactionTarget === "loading") button.setAttribute("aria-pressed", String(embeddedMarkerActive || loadingMarkerQueued));
    else if (interactionTarget !== "local") button.setAttribute("aria-pressed", "false");
    if (interactionTarget === "embedded" && embeddedMarkerActive) button.textContent = "💬 Cancel marker";
    else if (interactionTarget === "permission-required") button.textContent = "Allow SCORM review access";
    else if (interactionTarget === "reload-required") button.textContent = "Reload page to finish SCORM setup";
    else if (interactionTarget === "loading") button.textContent = loadingMarkerQueued ? "Cancel queued comment marker" : "Add comment marker (waiting for SCORM…)";
    else if (interactionTarget === "unavailable") button.textContent = "Comment on parent page";
    else button.textContent = (interactionTarget === "embedded" ? embeddedSelection : Boolean(selectedTextDraft())) ? "Add comment to highlighted text" : "Add comment marker";
    button.removeAttribute("disabled");
  };
  const selectionListener = () => updateAdaptiveAction();
  ownerDocument.addEventListener("selectionchange", selectionListener);
  const openHelp = (trigger: HTMLElement) => {
    trigger.setAttribute("aria-expanded", "true"); returnFocus = trigger; const backdrop = ownerDocument.createElement("div"); backdrop.className = "backdrop";
    backdrop.innerHTML = `<div class="dialog help-dialog" role="dialog" aria-modal="true" aria-labelledby="review-help-title" aria-describedby="review-help-intro"><h2 id="review-help-title" tabindex="-1">How course review works</h2><p id="review-help-intro">Use the review toolbar to place feedback in context and follow each conversation through to resolution.</p><ol><li><strong>Highlight exact text</strong><span>Select words on the page first. The main button changes to Add comment to highlighted text. After saving, the selected words are highlighted yellow and a comment marker appears beside them.</span></li><li><strong>Place a comment marker</strong><span>Choose Add comment marker, then click the image, control, layout area, or other location you want to discuss. The button turns red and says Cancel marker while placement is active; press Escape or choose Cancel marker to stop.</span></li><li><strong>Moodle and SCORM</strong><span>The same two methods work in Moodle pages and supported Rise or SCORM activities. Wait briefly while embedded content connects. If the toolbar asks for access or a reload, follow that prompt before placing feedback.</span></li><li><strong>Open comments in context</strong><span>Choose a marker to open its conversation beside the referenced content; choose the marker again to close it. Comments opens the course comment list without losing your place.</span></li><li><strong>Filter and jump</strong><span>Switch between Whole course and Current page, then Open or Resolved. Jump to narrows the whole-course list to one page. Choosing a comment takes you to its Moodle page or SCORM activity and opens it at the saved location.</span></li><li><strong>Reply, edit, and attach</strong><span>Use Reply to continue a conversation. The pencil edits feedback you created. A file can be attached while creating a comment when an example or supporting document will help.</span></li><li><strong>Resolve or delete</strong><span>Use the tick control to resolve completed feedback; find it again with the Resolved filter and reopen it if needed. The red rubbish-bin control permanently deletes feedback after confirmation and is available only when your role permits it.</span></li><li><strong>Who can see feedback</strong><span>Beta testers see their own feedback and course-team replies. SMEs see SME feedback plus beta feedback an LD or DCD shares for clarification. LD, DCD, and administrator roles can review the complete course list.</span></li></ol><p class="help-version">Pilot ${escapeHtml(buildDiagnostics.version)} · build ${escapeHtml(buildDiagnostics.buildCommit.slice(0, 7))}</p><div class="actions"><button type="button" class="primary" data-close-help>Close help</button></div></div>`;
    const shell = shadow.querySelector<HTMLElement>(".shell")!; shell.inert = true;
    const close = () => { shell.inert = false; backdrop.remove(); const help = shadow.querySelector<HTMLElement>('[data-action="help"]'); help?.setAttribute("aria-expanded", "false"); (help ?? shell)?.focus(); };
    backdrop.addEventListener("keydown", (event) => { const focusable = Array.from(backdrop.querySelectorAll<HTMLElement>('h2,[data-close-help]')); const index = Math.max(0, focusable.indexOf(shadow.activeElement as HTMLElement)); const outcome = handleDialogKey({ key: event.key, shiftKey: event.shiftKey, activeIndex: index, focusableCount: focusable.length }); if (event.key === "Tab" || outcome.close) event.preventDefault(); if (outcome.close) close(); else if (event.key === "Tab") focusable[outcome.focusIndex]?.focus(); });
    backdrop.querySelector("[data-close-help]")?.addEventListener("click", close); shadow.append(backdrop); backdrop.querySelector<HTMLElement>("h2")?.focus();
  };
  const confirmAction = (trigger: HTMLElement, title: string, message: string, confirmLabel: string) => new Promise<boolean>((resolve) => {
    const backdrop = ownerDocument.createElement("div"); backdrop.className = "backdrop";
    backdrop.innerHTML = `<div class="dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="review-confirm-title"><h2 id="review-confirm-title">${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><div class="actions"><button type="button" data-confirm-cancel>Cancel</button><button type="button" class="primary" data-confirm-action>${escapeHtml(confirmLabel)}</button></div></div>`;
    const shell = shadow.querySelector<HTMLElement>(".shell")!; shell.inert = true;
    const finish = (accepted: boolean) => { shell.inert = false; backdrop.remove(); trigger.focus(); resolve(accepted); };
    backdrop.addEventListener("keydown", (event) => { const focusable = Array.from(backdrop.querySelectorAll<HTMLElement>("button")); const activeIndex = Math.max(0, focusable.indexOf(shadow.activeElement as HTMLElement)); const outcome = handleDialogKey({ key: event.key, shiftKey: event.shiftKey, activeIndex, focusableCount: focusable.length }); if (event.key === "Tab" || outcome.close) event.preventDefault(); if (outcome.close) finish(false); else if (event.key === "Tab") focusable[outcome.focusIndex]?.focus(); });
    backdrop.querySelector("[data-confirm-cancel]")?.addEventListener("click", () => finish(false)); backdrop.querySelector("[data-confirm-action]")?.addEventListener("click", () => finish(true)); shadow.append(backdrop); backdrop.querySelector<HTMLElement>("[data-confirm-cancel]")?.focus();
  });
  const statusIcon = (resolved: boolean) => {
    const svg = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 34 34"); svg.setAttribute("aria-hidden", "true");
    const path = ownerDocument.createElementNS(svg.namespaceURI, "path"); path.setAttribute("class", resolved ? "status-resolved-tick" : "status-hover-tick"); path.setAttribute("d", "M5.5 18c3 1.5 5 3.5 7.2 6C17 17.5 21 11.5 28 6.8"); path.setAttribute("fill", "none"); path.setAttribute("stroke", "#176b43"); path.setAttribute("stroke-width", "3.5"); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round"); svg.append(path);
    return svg;
  };
  const openDialog = (trigger: HTMLElement, label: string, anchor: CommentAnchor, embeddedCapability?: string) => {
    const contextSnapshot = { ...context };
    composerContext = contextSnapshot;
    returnFocus = trigger;
    const backdrop = ownerDocument.createElement("div");
    backdrop.className = "backdrop";
    const preview = contextLabel(anchor);
    backdrop.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title"><h2 id="review-dialog-title">${escapeHtml(label)}</h2><div class="preview">${escapeHtml(preview)}</div><div class="comment-composer"><div class="comment-composer-field-row"><textarea data-initial-focus required aria-label="Comment"></textarea><button type="button" class="comment-composer-save" data-save aria-label="Save comment" title="Save comment">${reviewIconMarkup("save")}</button></div><label class="field">Attach a file (optional)<input type="file" data-attachment accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg"><small>PDF, Word, PNG or JPEG; maximum 10 MB.</small></label><div class="comment-composer-actions"><button type="button" class="comment-composer-cancel" data-cancel>Cancel</button></div></div><div class="error" role="alert" hidden></div></div>`;
    backdrop.addEventListener("keydown", (event) => {
      const focusable = Array.from(backdrop.querySelectorAll<HTMLElement>("textarea,select,input,button"));
      const activeIndex = Math.max(0, focusable.indexOf(shadow.activeElement as HTMLElement));
      const outcome = handleDialogKey({ key: event.key, shiftKey: event.shiftKey, activeIndex, focusableCount: focusable.length });
      if (event.key === "Tab" || outcome.close) event.preventDefault();
      if (outcome.close) closeDialog(); else if (event.key === "Tab") focusable[outcome.focusIndex]?.focus();
    });
    backdrop.querySelector("[data-cancel]")?.addEventListener("click", closeDialog);
    backdrop.querySelector("[data-save]")?.addEventListener("click", async () => {
      const textarea = backdrop.querySelector<HTMLTextAreaElement>("textarea")!; const error = backdrop.querySelector<HTMLElement>(".error")!;
      if (anchor.anchor_type === "text_highlight" && !anchor.selected_quote) { error.textContent = "Select text on the page before saving."; error.hidden = false; returnFocus?.focus(); return; }
      if (!textarea.value.trim()) { error.textContent = "Enter a comment before saving."; error.hidden = false; textarea.focus(); return; }
      const save = backdrop.querySelector<HTMLButtonElement>("[data-save]")!; save.disabled = true; error.hidden = true;
      try {
        const file = backdrop.querySelector<HTMLInputElement>("[data-attachment]")!.files?.[0];
        if (file && file.size > 10 * 1024 * 1024) throw new Error("The attachment must be 10 MB or smaller.");
        const wantsScreenshot = Boolean(file);
        const embeddedSubmit = (options as ReviewOverlayOptions & { submitEmbedded?: (input: { capability: string; body: string; category: string; screenshot: boolean }) => Promise<{ id?: string; screenshot_available?: boolean } | void> }).submitEmbedded;
        const saved = embeddedCapability && embeddedSubmit
          ? await embeddedSubmit({ capability: embeddedCapability, body: textarea.value.trim(), category: "general", screenshot: wantsScreenshot })
          : await options.submit?.({ body: textarea.value.trim(), category: "general", anchor, screenshot: wantsScreenshot, embeddedFrameUnavailable: fallbackPin, contextSnapshot });
        fallbackPin = false;
        if (!file) { closeDialog(); return; }
        const commentId = saved && typeof saved.id === "string" ? saved.id : undefined;
        if (!commentId || saved?.screenshot_available === false || !options.uploadScreenshot) throw new Error("Comment saved, but attachment upload is unavailable.");
        const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        await options.uploadScreenshot(commentId, `data:${file.type};base64,${btoa(binary)}`); closeDialog();
      }
      catch (caught) { error.textContent = caught instanceof Error ? caught.message : "Could not save comment."; error.hidden = false; save.disabled = false; }
    });
    shadow.append(backdrop);
    backdrop.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
  };
  const bind = () => {
    bindStateControls();
    const addComment = shadow.querySelector<HTMLElement>('[data-action="add-comment"]');
    addComment?.addEventListener("click", (event) => {
      const trigger = event.currentTarget as HTMLElement;
      if (interactionTarget === "permission-required") { void options.onRequestPermission?.(); return; }
      if (interactionTarget === "reload-required") { options.onReloadRequired?.(); return; }
      if (interactionTarget === "loading") { loadingMarkerQueued = !loadingMarkerQueued; options.onRequestInteraction?.("marker"); updateAdaptiveAction(); return; }
      if (interactionTarget === "embedded") { options.onRequestInteraction?.(embeddedSelection ? "selection" : "marker"); return; }
      if (pinListener) { event.preventDefault(); event.stopPropagation(); clearAreaSelection(); fallbackPin = false; trigger.focus(); return; }
      const selected = selectedTextDraft();
      if (selected) { returnFocus = trigger; previewCleanup = renderTextHighlight(ownerDocument, selected.range); openDialog(trigger, "Comment on highlighted text", { anchor_type: "text_highlight", ...selected.anchor }); }
      else startAreaSelection(trigger);
    });
    updateAdaptiveAction();
    shadow.querySelector<HTMLElement>('[data-action="help"]')?.addEventListener("click", (event) => openHelp(event.currentTarget as HTMLElement));
    shadow.querySelector<HTMLElement>('[data-action="panel"]')?.addEventListener("click", (event) => {
      event.preventDefault();
      setPanelOpen(!panelOpen, { animate: true, persist: true });
    });
  };
  mount();
  setPanelOpen((status === "connected" || status === "connecting") && readCoursePanelState(panelStateStorage, context.course_url), { animate: false, persist: false });
  updateLabels();
  const embeddedAnchorListener = (event: Event) => {
    const detail = (event as CustomEvent).detail as { capability?: unknown; anchor?: unknown } | undefined;
    if (typeof detail?.capability !== "string" || !detail.anchor || typeof detail.anchor !== "object") return;
    const anchor = detail.anchor as CommentAnchor;
    if (!["text_highlight", "visual_pin"].includes(anchor.anchor_type)) return;
    const trigger = shadow.querySelector<HTMLElement>('[data-action="add-comment"]');
    if (trigger) openDialog(trigger, anchor.anchor_type === "text_highlight" ? "Comment on highlighted text" : "Comment on an area", anchor, detail.capability);
  };
  ownerDocument.documentElement.addEventListener("moodle-review:embedded-anchor", embeddedAnchorListener);
  const renderUnresolvedAnchors = (anchors: UnresolvedAnchor[]) => {
    let region = shadow.querySelector<HTMLElement>("[data-unresolved]");
    if (!region) {
      region = ownerDocument.createElement("section");
      region.dataset.unresolved = "true";
      region.setAttribute("aria-labelledby", "unresolved-anchor-heading");
      shadow.querySelector(".shell")?.append(region);
    }
    region.hidden = true;
    if (!anchors.length) { region.replaceChildren(); return; }
    const heading = ownerDocument.createElement("h2"); heading.id = "unresolved-anchor-heading"; heading.textContent = "Unresolved comment anchors";
    const list = ownerDocument.createElement("ul");
    for (const anchor of anchors) {
      const item = ownerDocument.createElement("li");
      const label = ownerDocument.createElement("span"); label.textContent = anchor.quote ? `${anchor.label}: “${anchor.quote}”` : anchor.label;
      const button = ownerDocument.createElement("button"); button.type = "button"; button.dataset.commentId = anchor.id; button.textContent = "Take me to context";
      button.addEventListener("click", () => options.onTakeToContext ? options.onTakeToContext(anchor.id) : void renderer.takeToContext(anchor.id)); item.append(label, button); list.append(item);
    }
    region.replaceChildren(heading, list);
  };
  const makeRenderer = () => createCommentRenderer(ownerDocument, context.page_url, {
    root: shadow,
    editThread: options.editThread,
    replyThread: options.replyThread,
    uploadAttachment: options.uploadScreenshot,
    changeStatus: options.changeStatus,
    refreshComments: options.refreshComments,
    manageSme: options.manageSme,
    deleteThread: options.deleteThread,
    confirmAction,
    currentViewer: () => currentViewer,
    navigateToComment: async (commentId, pageUrl) => {
      if (pageUrl === context.page_url) { renderer.takeToContext(commentId); return; }
      if (options.navigateToComment) await options.navigateToComment(commentId, pageUrl);
      else ownerDocument.defaultView?.location.assign(pageUrl);
    },
    onUnresolvedAnchors: renderUnresolvedAnchors,
  });
  renderer = makeRenderer();
  return {
    setInteractionState(next, hasSelection = false, markerActive = false) { interactionTarget = next; embeddedSelection = hasSelection; embeddedMarkerActive = markerActive; if (next !== "loading") loadingMarkerQueued = false; frameUnavailable = next === "unavailable"; updateAdaptiveAction(); },
    update(next, nextStatus) {
      const pageChanged = context.page_url !== next.page_url;
      const courseChanged = context.course_url !== next.course_url;
      stateVersion += 1; authenticating = false; context = next; status = nextStatus; closeChoice(false);
      if (pageChanged) { renderer.destroy(); renderer = makeRenderer(); }
      updateLabels();
      if (courseChanged) setPanelOpen((nextStatus === "connected" || nextStatus === "connecting") && readCoursePanelState(panelStateStorage, next.course_url), { animate: false, persist: false });
      if (nextStatus !== "connected") { shadow.querySelectorAll<HTMLElement>("[data-comment-count],[data-comment-count-short]").forEach((node) => { node.textContent = "0"; }); }
      const dialog = shadow.querySelector<HTMLElement>(".dialog");
      if (dialog && composerContext && (composerContext.page_url !== next.page_url || composerContext.course_url !== next.course_url) && !dialog.querySelector("[data-context-warning]")) {
        const warning = ownerDocument.createElement("p"); warning.dataset.contextWarning = "true"; warning.className = "error"; warning.textContent = "The page changed. This comment will stay attached to the page where you opened it."; dialog.querySelector(".preview")?.after(warning);
      }
    },
    setViewer(viewer) { currentViewer = viewer; updateLabels(); },
    setCommentList(comments) {
      if (jumpOutsideListener) shadow.removeEventListener("pointerdown", jumpOutsideListener);
      const previousResults = shadow.querySelector<HTMLElement>(".comment-results");
      const previousScrollTop = previousResults?.scrollTop ?? 0;
      const focusedCommentId = (shadow.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-comment-item]")?.dataset.commentItem;
      for (const [id, transient] of transientStatuses) if (!comments.some((comment) => comment.id === id)) comments = [...comments, transient.original];
      loadedComments = new Map(comments.map((comment) => [comment.id, comment]));
      shadow.querySelectorAll<HTMLElement>("[data-comment-count],[data-comment-count-short]").forEach((node) => { node.textContent = String(comments.length); });
      const panel = shadow.querySelector<HTMLElement>(".panel")!;
      const panelContent = panel.querySelector<HTMLElement>("[data-panel-content]")!;
      panelContent.replaceChildren();
      const projection = projectCourseComments(comments, rendererOrder);
      const pages = new Map<string, string>();
      const pageDestinations = new Map<string, PageComment>();
      const pageLabels = new Map<string, string>();
      for (const group of projection.groups) for (const { comment } of group.comments) { pageLabels.set(comment.id, group.title); if (!pages.has(group.pageUrl)) pages.set(group.pageUrl, group.title); if (!pageDestinations.has(group.pageUrl)) pageDestinations.set(group.pageUrl, comment); }
      if (commentListPage && !pages.has(commentListPage)) commentListPage = "";
      const currentPageHeading = ownerDocument.createElement("p"); currentPageHeading.className = "current-page-heading"; currentPageHeading.dataset.currentPageHeading = "true"; currentPageHeading.innerHTML = `<strong>Current page:</strong> ${escapeHtml(context.pageTitle.trim() || "Untitled page")}`;
      const filters = ownerDocument.createElement("div"); filters.className = "comment-filters"; filters.setAttribute("role", "group"); filters.setAttribute("aria-label", "Comment status filter");
      const scopes = ownerDocument.createElement("div"); scopes.className = "comment-filters"; scopes.setAttribute("role", "group"); scopes.setAttribute("aria-label", "Comment page scope");
      const filterRow = ownerDocument.createElement("div"); filterRow.className = "comment-filter-row";
      const pageField = ownerDocument.createElement("div"); pageField.className = "comment-page-field";
      const jumpId = `comment-page-list-${Math.random().toString(36).slice(2)}`;
      const jumpButton = ownerDocument.createElement("button"); jumpButton.type = "button"; jumpButton.dataset.commentJump = "true"; jumpButton.className = "comment-control comment-jump"; jumpButton.setAttribute("aria-expanded", "false"); jumpButton.setAttribute("aria-controls", jumpId); jumpButton.innerHTML = "<span>Jump to</span>";
      const pageList = ownerDocument.createElement("div"); pageList.id = jumpId; pageList.className = "comment-page-list"; pageList.setAttribute("role", "listbox"); pageList.setAttribute("aria-label", "Jump to course page"); pageList.hidden = true;
      const pageEntries: Array<[string, string]> = [["", "All pages"], ...pages];
      for (const [pageUrl, pageTitle] of pageEntries) { const option = ownerDocument.createElement("button"); option.type = "button"; option.className = "comment-page-option"; option.dataset.commentPageOption = pageUrl; option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(pageUrl === commentListPage)); option.textContent = pageUrl ? coursePageJumpLabel(pageTitle) : pageTitle; pageList.append(option); }
      const resetJumpGeometry = () => { for (const property of ["position", "left", "top", "max-height", "overflow-y", "visibility"]) pageList.style.removeProperty(property); };
      const closeJump = (restoreFocus = false) => { pageList.hidden = true; resetJumpGeometry(); jumpButton.setAttribute("aria-expanded", "false"); if (restoreFocus) jumpButton.focus(); };
      const openJump = () => {
        const view = ownerDocument.defaultView;
        if (!view) return;
        resetJumpGeometry();
        pageList.style.position = "fixed";
        pageList.style.visibility = "hidden";
        pageList.style.overflowY = "auto";
        pageList.hidden = false;
        const trigger = jumpButton.getBoundingClientRect();
        const viewportWidth = view.innerWidth;
        const viewportHeight = view.innerHeight;
        const margin = 8;
        const menuWidth = Math.min(380, Math.max(1, viewportWidth - 32));
        const desiredHeight = Math.max(1, pageList.scrollHeight);
        const availableAbove = Math.max(0, trigger.top - margin);
        const availableBelow = Math.max(0, viewportHeight - trigger.bottom - margin);
        const openAbove = desiredHeight <= availableAbove || availableAbove >= availableBelow;
        const maxHeight = Math.max(1, openAbove ? availableAbove : availableBelow);
        const visibleHeight = Math.min(desiredHeight, maxHeight);
        const unclampedTop = openAbove ? trigger.top - visibleHeight : trigger.bottom;
        const top = Math.max(margin, Math.min(unclampedTop, viewportHeight - margin - visibleHeight));
        const maxLeft = Math.max(margin, viewportWidth - margin - menuWidth);
        const left = Math.max(margin, Math.min(trigger.right - menuWidth, maxLeft));
        pageList.style.left = `${left}px`;
        pageList.style.top = `${top}px`;
        pageList.style.maxHeight = `${maxHeight}px`;
        pageList.style.visibility = "visible";
        jumpButton.setAttribute("aria-expanded", "true");
        (pageList.querySelector<HTMLElement>('[aria-selected="true"]') ?? pageList.querySelector<HTMLElement>("[role=option]"))?.focus();
      };
      jumpOutsideListener = (event) => { if (!pageList.hidden && !pageField.contains(event.target as Node)) closeJump(); };
      shadow.addEventListener("pointerdown", jumpOutsideListener);
      jumpButton.addEventListener("click", () => pageList.hidden ? openJump() : closeJump());
      jumpButton.addEventListener("keydown", (event) => { if (["ArrowDown", "Enter", " "].includes(event.key)) { event.preventDefault(); openJump(); } });
      pageList.addEventListener("keydown", (event) => { const optionsList = Array.from(pageList.querySelectorAll<HTMLElement>("[role=option]")); const active = optionsList.indexOf(shadow.activeElement as HTMLElement); if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); optionsList[(active + (event.key === "ArrowDown" ? 1 : -1) + optionsList.length) % optionsList.length]?.focus(); } else if (event.key === "Escape") { event.preventDefault(); closeJump(true); } else if (event.key === "Tab") closeJump(); });
      pageList.addEventListener("click", (event) => { void (async () => {
        const option = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-comment-page-option]"); if (!option) return;
        commentListPage = option.dataset.commentPageOption ?? ""; if (commentListPage) commentListScope = "course"; pageList.querySelectorAll("[role=option]").forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === option))); closeJump(true); applyFilter();
        if (!commentListPage) return;
        const destination = pageDestinations.get(commentListPage); if (!destination) return;
        panelContent.querySelector("[data-comment-navigation-status]")?.remove();
        try {
          if (destination.page_url === context.page_url) renderer.takeToContext(destination.id);
          else if (options.navigateToComment) await options.navigateToComment(destination.id, destination.page_url);
          else ownerDocument.defaultView?.location.assign(destination.page_url);
        } catch (error) {
          const message = ownerDocument.createElement("p"); message.dataset.commentNavigationStatus = "true"; message.setAttribute("role", "status"); message.textContent = error instanceof Error && error.message ? error.message : "Unable to open this course page."; filterRow.after(message);
        }
      })(); });
      pageField.append(jumpButton, pageList);
      const results = ownerDocument.createElement("div"); results.className = "comment-results"; results.setAttribute("role", "list");
      const empty = ownerDocument.createElement("p"); empty.dataset.commentEmpty = "true"; empty.textContent = "No comments match these filters.";
      const applyFilter = () => { let visibleCount = 0; results.querySelectorAll<HTMLElement>("[data-comment-item]").forEach((node) => { const pageUrl = node.dataset.commentPageUrl; node.hidden = node.dataset.commentGroup !== commentListFilter || (commentListScope === "page" ? pageUrl !== context.page_url : Boolean(commentListPage) && pageUrl !== commentListPage); node.parentElement!.hidden = node.hidden; if (!node.hidden) { visibleCount += 1; const comment = loadedComments.get(node.dataset.commentItem!); if (comment) { const shortBody = comment.body.replace(/\s+/g, " ").trim().slice(0, 112); node.textContent = `“${shortBody}${comment.body.length > 112 ? "…" : ""}”`; } } }); results.querySelectorAll<HTMLElement>("[data-comment-group-heading]").forEach((heading) => { let sibling = heading.nextElementSibling as HTMLElement | null; let groupVisible = false; while (sibling && !sibling.dataset.commentGroupHeading) { if (sibling.getAttribute("role") === "listitem" && !sibling.hidden) groupVisible = true; sibling = sibling.nextElementSibling as HTMLElement | null; } heading.hidden = commentListScope === "page" || Boolean(commentListPage) || !groupVisible; }); empty.hidden = visibleCount > 0; filters.querySelectorAll<HTMLElement>("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.commentFilter === commentListFilter))); scopes.querySelectorAll<HTMLElement>("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.commentScope === commentListScope))); if (commentListScope === "page") commentListPage = ""; };
      for (const value of ["open", "resolved"] as const) { const filter = ownerDocument.createElement("button"); filter.type = "button"; filter.dataset.commentFilter = value; filter.className = "comment-control comment-status"; filter.innerHTML = `<span>${value === "open" ? "Open" : "Resolved"}</span>`; filter.addEventListener("click", () => { commentListFilter = value; renderer.setStatusFilter(value); applyFilter(); }); filters.append(filter); }
      for (const value of ["course", "page"] as const) { const scope = ownerDocument.createElement("button"); scope.type = "button"; scope.dataset.commentScope = value; scope.className = "comment-control comment-scope"; scope.innerHTML = `<span>${value === "course" ? "Whole course" : "Current page"}</span>`; scope.addEventListener("click", () => { commentListScope = value; applyFilter(); }); scopes.append(scope); }
      filterRow.append(scopes, filters, pageField); panelContent.append(currentPageHeading, filterRow, results, empty);
      for (const group of projection.groups) {
        const heading = ownerDocument.createElement("h3"); heading.dataset.commentGroupHeading = "true"; heading.className = "comment-group-heading"; heading.textContent = coursePageJumpLabel(group.title); results.append(heading);
        for (const { comment, displayIndex } of group.comments) {
        const commentIndex = displayIndex - 1;
        const listItem = ownerDocument.createElement("div"); listItem.setAttribute("role", "listitem"); listItem.className = "comment-row"; listItem.dataset.commentRow = comment.id;
        const item = ownerDocument.createElement("button"); item.type = "button"; item.className = "comment-index-link"; item.dataset.commentItem = comment.id; item.dataset.commentIndex = String(commentIndex + 1); item.dataset.commentGroup = comment.status === "resolved" ? "resolved" : "open"; item.dataset.commentPageUrl = comment.page_url; const pageLabel = pageLabels.get(comment.id)!; const initialBody = comment.body.replace(/\s+/g, " ").trim().slice(0, 56); const conciseBody = `“${initialBody}${comment.body.length > 56 ? "…" : ""}”`; item.textContent = conciseBody; item.setAttribute("aria-label", `Open comment in context. ${pageLabel}. ${comment.body}. ${comment.author.display_name}. Status ${comment.status}.`);
        item.addEventListener("click", async () => {
          panelContent.querySelector("[data-comment-navigation-status]")?.remove();
          if (comment.page_url !== context.page_url) {
            try { if (options.navigateToComment) await options.navigateToComment(comment.id, comment.page_url); else ownerDocument.defaultView?.location.assign(comment.page_url); }
            catch (error) { const status = ownerDocument.createElement("p"); status.dataset.commentNavigationStatus = "true"; status.setAttribute("role", "status"); status.textContent = error instanceof Error && error.message ? error.message : "Unable to open this comment in context."; filterRow.after(status); }
            return;
          }
          renderer.takeToContext(comment.id);
        });
        const rowActions = ownerDocument.createElement("div"); rowActions.className = "comment-row-actions";
        const mutationKey = (action: string) => `${comment.id}:${action}`;
        const currentRow = () => Array.from(shadow.querySelectorAll<HTMLElement>("[data-comment-row]")).find((row) => row.dataset.commentRow === comment.id);
        const showMutationState = (action: string) => {
          const row = currentRow(); if (!row) return; const state = rowMutations.get(mutationKey(action)); const currentAction = Array.from(row.querySelectorAll<HTMLButtonElement>("[data-comment-action]")).find((candidate) => candidate.dataset.commentAction === action); if (currentAction) currentAction.disabled = state?.pending === true;
          if (!row.dataset.transientStatus) Array.from(row.querySelectorAll<HTMLElement>("[data-comment-mutation-status]")).find((message) => message.dataset.commentMutationStatus === action)?.remove(); if (state?.error) { const message = ownerDocument.createElement("p"); message.className = "comment-row-status"; message.dataset.commentMutationStatus = action; message.setAttribute("role", "status"); message.textContent = state.error; row.append(message); }
        };
        const runRowMutation = async (action: string, mutation: () => Promise<void>, fallback: string) => {
          rowMutations.set(mutationKey(action), { pending: true }); showMutationState(action);
          try { await mutation(); rowMutations.delete(mutationKey(action)); showMutationState(action); }
          catch (error) { rowMutations.set(mutationKey(action), { pending: false, error: error instanceof Error && error.message ? error.message : fallback }); showMutationState(action); }
        };
        if (comment.capabilities?.can_change_status && options.changeStatus) {
          const nextStatus = comment.status === "resolved" ? "open" : "resolved"; const verb = nextStatus === "open" ? "Reopen" : "Resolve";
          const action = ownerDocument.createElement("button"); action.type = "button"; action.className = "comment-row-action status-action"; action.dataset.commentAction = "status"; action.append(statusIcon(comment.status === "resolved")); action.setAttribute("aria-label", `${verb} comment ${conciseBody}`); action.title = `${verb} comment ${conciseBody}`;
          action.disabled = rowMutations.get(mutationKey("status"))?.pending === true; action.addEventListener("click", async () => {
            if (!await confirmAction(action, `${verb} comment`, `${verb} this comment? It will move to the ${nextStatus === "resolved" ? "Resolved" : "Open"} list.`, verb)) return;
            await runRowMutation("status", async () => {
              await options.changeStatus!(comment.id, nextStatus);
              action.replaceChildren(statusIcon(nextStatus === "resolved")); listItem.dataset.transientStatus = nextStatus;
              const announcement = ownerDocument.createElement("span"); announcement.className = "comment-row-status"; announcement.dataset.commentMutationStatus = "status"; announcement.setAttribute("role", "status"); announcement.textContent = nextStatus === "resolved" ? "Comment resolved. Moving to Resolved." : "Comment reopened. Moving to Open."; listItem.append(announcement);
              const existing = transientStatuses.get(comment.id); if (existing) ownerDocument.defaultView?.clearTimeout(existing.timer);
              const timer = ownerDocument.defaultView!.setTimeout(() => {
                void options.refreshComments?.().then(() => {
                  transientStatuses.delete(comment.id);
                }).catch((error) => {
                  rowMutations.set(mutationKey("status"), { pending: false, error: error instanceof Error ? error.message : "Change saved, but comments could not be refreshed. Reload the page." });
                  currentRow()?.querySelectorAll<HTMLElement>('[data-comment-mutation-status="status"]').forEach((message) => message.remove());
                  showMutationState("status");
                });
              }, 3000); transientStatuses.set(comment.id, { original: comment, nextStatus, timer });
            }, `Could not ${verb.toLowerCase()} comment`);
          }); rowActions.append(action);
        }
        if (comment.capabilities?.can_delete && options.deleteThread) {
          const action = ownerDocument.createElement("button"); action.type = "button"; action.className = "comment-row-action delete-action"; action.dataset.commentAction = "delete"; action.append(createReviewIcon(ownerDocument, "delete")); action.setAttribute("aria-label", `Delete comment ${conciseBody}`); action.title = `Delete comment ${conciseBody}`;
          action.disabled = rowMutations.get(mutationKey("delete"))?.pending === true; action.addEventListener("click", async () => { if (!await confirmAction(action, "Delete comment", "Delete this entire thread, including all replies and screenshots?", "Delete")) return; await runRowMutation("delete", async () => { const transient = transientStatuses.get(comment.id); if (transient) ownerDocument.defaultView?.clearTimeout(transient.timer); transientStatuses.delete(comment.id); await options.deleteThread!(comment.id); }, "Could not delete comment"); }); rowActions.append(action);
        }
        listItem.append(item); if (rowActions.childElementCount) listItem.append(rowActions); results.append(listItem); for (const action of ["status", "delete"]) if (rowMutations.has(mutationKey(action))) showMutationState(action);
        }
      }
      if (!comments.length) { empty.textContent = "No comments in this course yet."; empty.hidden = false; }
      renderer.setStatusFilter(commentListFilter);
      applyFilter();
      results.scrollTop = previousScrollTop;
      if (focusedCommentId) results.querySelector<HTMLElement>(`[data-comment-item="${focusedCommentId}"]`)?.focus();
    },
    setRendererComments(comments) {
      renderer.setComments(comments);
      rendererOrder = new Map(renderer.orderedCommentIds().map((id, index) => [id, index]));
    },
    setPageComments(comments) { this.setRendererComments(comments); this.setCommentList(comments); },
    setCommentNavigationStatus(message) {
      shadow.querySelector("[data-comment-navigation-status]")?.remove();
      if (!message) return;
      const status = ownerDocument.createElement("p"); status.dataset.commentNavigationStatus = "true"; status.setAttribute("role", "status"); status.textContent = message;
      shadow.querySelector(".comment-filter-row")?.after(status);
    },
    takeToContext(id) { return renderer.takeToContext(id); },
    showFrameFallback() { frameUnavailable = true; shadow.querySelector("[data-frame-fallback]")?.remove(); },
    hideFrameFallback() { frameUnavailable = false; fallbackPin = false; const region = shadow.querySelector<HTMLElement>("[data-frame-fallback]"); if (region) region.hidden = true; },
    setPresentationVisible(visible) { host.hidden = !visible; host.style.setProperty("display", visible ? "block" : "none", "important"); },
    setPresentationPosition(position) {
      const shell = shadow.querySelector<HTMLElement>(".shell");
      if (!shell) return;
      if (!position) { host.style.removeProperty("left"); host.style.removeProperty("top"); host.style.setProperty("position", "fixed", "important"); shell.style.removeProperty("position"); shell.style.removeProperty("right"); shell.style.removeProperty("bottom"); return; }
      host.style.setProperty("position", "absolute", "important"); host.style.setProperty("left", `${position.left}px`, "important"); host.style.setProperty("top", `${position.top}px`, "important");
      shell.style.setProperty("position", "static", "important"); shell.style.setProperty("right", "auto", "important"); shell.style.setProperty("bottom", "auto", "important");
    },
    presentationSize() { const shell = shadow.querySelector<HTMLElement>(".shell"); const rect = shell?.getBoundingClientRect(); return { width: rect?.width || shell?.offsetWidth || 600, height: rect?.height || shell?.offsetHeight || 150 }; },
    setUnresolvedAnchors(anchors) { renderUnresolvedAnchors(anchors); },
    destroy() { clearPanelTransition(); clearAreaSelection(); closeChoice(false); if (jumpOutsideListener) shadow.removeEventListener("pointerdown", jumpOutsideListener); for (const transient of transientStatuses.values()) ownerDocument.defaultView?.clearTimeout(transient.timer); transientStatuses.clear(); ownerDocument.removeEventListener("focusin", rememberPageFocus, true); ownerDocument.removeEventListener("selectionchange", selectionListener); ownerDocument.documentElement.removeEventListener("moodle-review:embedded-anchor", embeddedAnchorListener); cleanupPreview(); renderer.destroy(); host.remove(); },
  };
}
