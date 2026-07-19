import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { approvedControlStyles, commentListLayoutStyles, commentsButtonStyles, controlAlignmentStyles, createOverlayMarkup, helpButtonStyles, mountReviewOverlay, OVERLAY_HOST_ID, overlayStyles, semanticFilterHoverStyles, tealOverlayOverrides } from "../src/overlay/root.ts";

const context = { course_url: "https://learn.example/course/view.php?id=1", page_url: "https://learn.example/mod/page/view.php?id=2", title: "Law", pageTitle: "Week 2", moodle_course_id: 1, identityConfidence: "confirmed" as const };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const choosePage = (shadow: ShadowRoot, pageUrl: string) => shadow.querySelector<HTMLButtonElement>(`[data-comment-page-option="${pageUrl}"]`)!.click();
const acceptConfirmation = async (shadow: ShadowRoot) => { shadow.querySelector<HTMLButtonElement>("[data-confirm-action]")!.click(); await tick(); };

const contrastRatio = (foreground: string, background: string): number => {
  const luminance = (hex: string) => {
    const channels = hex.match(/[\da-f]{2}/gi)!.map((value) => Number.parseInt(value, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
};

const expandHex = (color: string) => color.length === 4
  ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  : color;

function auditOverlayContrast(styles: string): void {
  const declarations = (selector: string) => {
    const match = styles.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^}]*)\\}`));
    assert.ok(match, `missing ${selector} rule`);
    return match[1]!;
  };
  const property = (rule: string, name: string) => {
    const match = rule.match(new RegExp(`(?:^|;)${name}:([^;}]*)`));
    assert.ok(match, `missing ${name} declaration`);
    return match[1]!;
  };
  const host = declarations(":host");
  const resolve = (value: string) => {
    const variable = value.match(/^var\((--[^)]+)\)$/)?.[1];
    return expandHex(variable ? property(host, variable) : value);
  };
  const requireContrast = (label: string, foreground: string, background: string, minimum: number) =>
    assert.ok(contrastRatio(resolve(foreground), resolve(background)) >= minimum, `${label} contrast is below ${minimum}:1`);

  const toolbar = declarations(".toolbar");
  requireContrast("toolbar text", property(toolbar, "color"), property(toolbar, "background"), 4.5);
  requireContrast("status text", property(toolbar, "color"), property(toolbar, "background"), 4.5);
  const primary = declarations(".toolbar button");
  requireContrast("primary action", property(primary, "color"), property(primary, "background"), 4.5);
  const panel = declarations(".panel,[data-unresolved],[data-frame-fallback]");
  requireContrast("panel text", property(host, "color"), property(panel, "background"), 4.5);
  const diagnostic = declarations(".build-diagnostic");
  requireContrast("build diagnostic", property(diagnostic, "color"), property(diagnostic, "background"), 4.5);
  const control = declarations("button");
  requireContrast("secondary control", property(control, "color"), property(control, "background"), 4.5);
  const focus = declarations("button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible,[data-build-diagnostic]:focus-visible");
  const focusColor = property(focus, "outline").split(" ").at(-1)!;
  const surroundColor = property(focus, "box-shadow").split(" ").at(-1)!;
  requireContrast("focus indicator on header", focusColor, property(toolbar, "background"), 3);
  requireContrast("focus indicator on panel", surroundColor, property(panel, "background"), 3);
}

test("Help displays accessible pilot version diagnostics", () => {
  const markup = createOverlayMarkup({ courseTitle: "Law", pageTitle: "Week 2", status: "connected", version: "0.2.0", buildCommit: "abc1234def567890abc1234def567890abc1234d" });
  assert.match(markup, /data-build-info hidden>0\.2\.0\|abc1234</);

  const window = new Window(); const document = window.document as unknown as Document;
  mountReviewOverlay(document, context, "connected", {}, { version: "0.2.0", buildCommit: "abc1234def567890abc1234def567890abc1234d" });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  shadow.querySelector<HTMLElement>('[data-action="help"]')!.click();
  assert.equal(shadow.querySelector('[role="dialog"]')?.getAttribute("aria-modal"), "true");
  const diagnostic = shadow.querySelector<HTMLElement>(".help-version")!;
  assert.equal(diagnostic.textContent, "Pilot 0.2.0 · build abc1234");
});

function auditShellBoundary(styles: string): void {
  const rule = styles.match(/\.shell\{([^}]*)\}/)?.[1];
  assert.ok(rule, "missing shell rule");
  const declarations = new Map(rule.split(";").map((declaration) => declaration.split(":", 2) as [string, string]));
  assert.equal(declarations.get("box-sizing"), "border-box", "shell width must include its boundary");
  assert.equal(declarations.get("border"), "3px solid var(--review-red)", "shell must use the UCO red boundary");
  assert.equal(declarations.get("box-shadow"), "0 8px 24px #00000038", "shell must have a clear neutral separation shadow");

  const responsive = styles.match(/@media\(max-width:420px\)\{\.shell\{([^}]*)\}/)?.[1];
  assert.ok(responsive, "missing responsive shell rule");
  const responsiveDeclarations = new Map(responsive.split(";").map((declaration) => declaration.split(":", 2) as [string, string]));
  assert.equal(responsiveDeclarations.get("width"), "calc(100vw - 16px)", "shell must fit within a 320 CSS pixel viewport");
}

test("contrast audit reads colors from the overlay stylesheet", () => {
  assert.doesNotThrow(() => auditOverlayContrast(overlayStyles));
  assert.throws(() => auditOverlayContrast(overlayStyles.replace("background:#000;color:#fff", "background:#777;color:#fff")), /toolbar text/);
  assert.throws(() => auditOverlayContrast(overlayStyles.replace("background:var(--review-red);color:#fff", "background:#fff;color:#fff")), /primary action/);
  assert.throws(() => auditOverlayContrast(overlayStyles.replace("outline:3px solid #ffd54f", "outline:3px solid #fff").replace("box-shadow:0 0 0 5px #000", "box-shadow:0 0 0 5px #fff")), /focus indicator/);
});

test("overlay styles remain isolated, keyboard-visible, and usable at 320 CSS pixels", () => {
  assert.match(overlayStyles, /^:host\{/);
  assert.match(overlayStyles, /all:initial/);
  assert.match(overlayStyles, /outline:3px solid #ffd54f/);
  assert.match(overlayStyles, /box-shadow:0 0 0 5px #000/);
  assert.match(overlayStyles, /@media\(max-width:420px\)/);
  assert.match(overlayStyles, /width:calc\(100vw - 16px\)/);
  assert.match(overlayStyles, /flex-wrap:wrap/);
  assert.doesNotMatch(overlayStyles, /(?:^|})\s*(?:body|html|\.moodle)/);
});

test("shell boundary separates the complete overlay and remains in responsive bounds", () => {
  assert.doesNotThrow(() => auditShellBoundary(overlayStyles));
  assert.throws(() => auditShellBoundary(overlayStyles.replace("border:3px solid var(--review-red)", "border:1px solid var(--review-line)")), /UCO red boundary/);
  assert.throws(() => auditShellBoundary(overlayStyles.replace("box-shadow:0 8px 24px #00000038", "box-shadow:0 4px 16px #00000024")), /separation shadow/);
  assert.throws(() => auditShellBoundary(overlayStyles.replace("box-sizing:border-box", "box-sizing:content-box")), /width must include/);
  assert.throws(() => auditShellBoundary(overlayStyles.replace("width:calc(100vw - 16px)", "width:100vw")), /320 CSS pixel viewport/);
});

test("overlay host inline reset preserves the review typography inheritance", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  mountReviewOverlay(document, context, "connected");
  const host = document.getElementById(OVERLAY_HOST_ID)!;
  assert.equal(host.style.fontFamily, "Poppins, Arial, sans-serif");
  assert.equal(host.style.fontSize, "16px");
  assert.equal(host.style.lineHeight, "1.5");
  assert.equal(host.style.color, "#102f38");
});

test("0.3 visual treatment clearly separates the tool with teal and UCO accents", () => {
  assert.match(tealOverlayOverrides, /--review-teal:#28c4c2/);
  assert.match(tealOverlayOverrides, /--review-pale:#effafa/);
  assert.match(tealOverlayOverrides, /border:4px solid var\(--review-teal\)/);
  assert.match(overlayStyles, /--review-red:#d73b3d/);
});

test("compact toolbar exposes one primary action and calm metadata", () => {
  const markup = createOverlayMarkup({ courseTitle: "CRJU150 – Legal Method", pageTitle: "Week 2", status: "connected", version: "0.3.2", buildCommit: "abc1234def" });
  assert.match(markup, />Add comment marker</);
  assert.match(markup, />Comments \(/); assert.match(markup, /data-comment-count>0/);
  assert.match(markup, /aria-label="Help and instructions"/);
  assert.match(markup, /title="Help and instructions"/);
  assert.doesNotMatch(markup, />Highlight text</);
  assert.doesNotMatch(markup, />Add pin</);
  assert.doesNotMatch(markup, /<span class="label">Course:/);
  assert.doesNotMatch(markup, /Pilot v0\.3\.2/);
});

test("responsive toolbar keeps three actions in one row at 600 and 360 pixels", () => {
  const styles = overlayStyles + tealOverlayOverrides;
  assert.match(styles, /font:16px\/1\.5 Poppins/);
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /@media\(max-width:600px\)/);
  assert.match(styles, /grid-template-columns:minmax\(0,1fr\) auto 44px/);
  assert.match(styles, /@media\(max-width:360px\)/);
});

test("connected status stays textual with a decorative green indicator", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  mountReviewOverlay(document, context, "connected");
  const status = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!.querySelector<HTMLElement>("[data-auth-status]")!;
  assert.equal(status.textContent!.trim(), "Connected");
  assert.equal(status.querySelector(".dot")?.getAttribute("aria-hidden"), "true");
  assert.match(overlayStyles, /\.connected \.dot\{background:#16833b\}/);
});

test("signed-out, pending, and offline states expose deterministic accessible controls", () => {
  for (const [status, label, action] of [
    ["signed-out", "Signed out", "Sign in"],
    ["pending", "Waiting for approval — you can leave this page open or return later.", "Check approval"],
    ["offline", "Service unavailable—retry", "Retry"],
  ] as const) {
    const window = new Window();
    const document = window.document as unknown as Document;
    mountReviewOverlay(document, context, status);
    const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
    assert.equal(shadow.querySelector<HTMLElement>("[data-status-message]")!.textContent, label);
    assert.equal(shadow.querySelectorAll('[data-action="authenticate"]').length, action ? 1 : 0);
    if (action) assert.equal(shadow.querySelector('[data-action="authenticate"]')!.textContent, action);
    assert.equal(shadow.querySelector('[data-action="highlight"]'), null);
    assert.equal(shadow.querySelector('[data-action="pin"]'), null);
  }
});

test("authentication status is textual and announced through one live region", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "signed-out");
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  assert.equal(shadow.querySelectorAll('[aria-live="polite"]').length, 1);
  const liveRegion = shadow.querySelector('[aria-live="polite"]')!;
  assert.match(liveRegion.textContent!, /Signed out/);
  overlay.update(context, "offline");
  assert.equal(shadow.querySelector('[aria-live="polite"]'), liveRegion);
  assert.equal(liveRegion.querySelector("[data-status-message]")?.textContent, "Service unavailable—retry");
});

test("sign-in activation has one disabled busy action and ignores duplicate activation", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  let calls = 0; let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  mountReviewOverlay(document, context, "signed-out", { onAuthenticate: async () => { calls += 1; await pending; return { status: "connected" }; } });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const button = shadow.querySelector<HTMLButtonElement>('[data-action="authenticate"]')!;
  button.click(); button.click();
  assert.equal(calls, 1); assert.equal(button.disabled, true); assert.equal(button.textContent, "Signing in…");
  assert.equal(button.getAttribute("aria-busy"), "true");
  finish(); await tick();
});

test("authentication cancellation and failure restore focus to the retry action", async () => {
  for (const message of ["Sign-in cancelled", "Sign-in failed—try again"]) {
    const window = new Window(); const document = window.document as unknown as Document;
    mountReviewOverlay(document, context, "signed-out", { onAuthenticate: async () => ({ status: "signed-out", message }) });
    const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
    shadow.querySelector<HTMLElement>('[data-action="authenticate"]')!.click(); await tick();
    const retry = shadow.querySelector<HTMLElement>('[data-action="authenticate"]')!;
    assert.equal(shadow.activeElement, retry); assert.match(shadow.querySelector('[aria-live="polite"]')!.textContent!, new RegExp(message));
  }
});

test("successful authentication moves focus to the first review control", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  mountReviewOverlay(document, context, "signed-out", { onAuthenticate: async () => ({ status: "connected" }) });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  shadow.querySelector<HTMLElement>('[data-action="authenticate"]')!.click(); await tick();
  assert.equal(shadow.activeElement, shadow.querySelector('[data-action="add-comment"]'));
  assert.match(shadow.querySelector('[aria-live="polite"]')!.textContent!, /Connected/);
});

test("course access form restores saved reviewers without asking them for another code", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const submitted: any[] = [];
  let existingUses = 0;
  mountReviewOverlay(document, context, "signed-out", {
    onAccessSubmit: async (input) => { submitted.push(input); return { status: "connected" }; },
    getSavedReviewers: async () => [{ email: "richard@example.test", label: "Richard (richard@example.test)" }],
    onUseSavedReviewer: async () => { existingUses += 1; return { status: "connected" }; },
  });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  shadow.querySelector<HTMLElement>('[data-action="authenticate"]')!.click();
  const form = shadow.querySelector<HTMLFormElement>("[data-access-form]")!;
  assert.ok(form);
  assert.match(form.textContent!, /New reviewer|Existing reviewer/);
  assert.doesNotMatch(form.textContent!, /reconnect/i);
  assert.match(form.textContent!, /Invitation code/);
  assert.equal(shadow.querySelectorAll("[data-reviewer-name]").length, 0);
  assert.ok(form.querySelector('[name="displayName"]'));
  assert.ok(form.querySelector('[name="email"]'));
  assert.ok(form.querySelector('[name="role"]'));
  assert.ok(form.querySelector('[name="code"]'));
  assert.equal(form.querySelectorAll('[name="code"]').length, 1);
  assert.equal(submitted.length, 0);
  shadow.querySelector<HTMLElement>('[data-mode="existing"]')!.click();
  await tick();
  assert.match(form.textContent!, /Richard/);
  assert.equal((form.querySelector("[data-new-fields]") as HTMLElement).hidden, true);
  (form.querySelector('[data-use-existing]') as HTMLElement).click(); await tick();
  assert.equal(existingUses, 1);
});

test("approved course-team members can sign in without an invitation", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  let teamSignIns = 0;
  mountReviewOverlay(document, context, "signed-out", { onAccessSubmit: async () => ({ status: "signed-out" }), onAuthenticate: async () => { teamSignIns += 1; return { status: "connected" }; } });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  shadow.querySelector<HTMLElement>('[data-action="authenticate"]')!.click();
  const form = shadow.querySelector<HTMLFormElement>("[data-access-form]")!;
  assert.match(form.textContent!, /Course team sign in/);
  form.querySelector<HTMLElement>("[data-team-sign-in]")!.click(); await tick();
  assert.equal(teamSignIns, 1);
  assert.match(shadow.querySelector("[data-status-message]")!.textContent!, /Connected/);
});

test("pending approval uses a direct Check approval action", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  let checks = 0;
  mountReviewOverlay(document, context, "pending", { onCheckApproval: async () => { checks += 1; return { status: "connected", message: "Approved — connected" }; } });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const check = shadow.querySelector<HTMLElement>('[data-action="authenticate"]')!;
  assert.equal(check.textContent, "Check approval");
  check.click(); await tick();
  assert.equal(checks, 1);
  assert.match(shadow.querySelector("[data-status-message]")!.textContent!, /Approved — connected/);
});

test("comments count follows visible top-level threads", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const comment = { id: "00000000-0000-4000-8000-000000000001", body: "One", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: context.pageTitle, parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [{ id: "reply", body: "Reply", author: { display_name: "LD", role: "ld_dcd" } }], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: true } };
  overlay.setPageComments([comment, { ...comment, id: "00000000-0000-4000-8000-000000000002", body: "Two" }]);
  assert.equal(shadow.querySelector("[data-comment-count]")?.textContent, "2");
  overlay.update({ ...context, page_url: "https://learn.example/new", pageTitle: "New" }, "connecting");
  assert.equal(shadow.querySelector("[data-comment-count]")?.textContent, "0");
});

test("course-list projection does not recover anchors until renderer projection is set", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const target = document.createElement("div"); target.id = "target"; document.body.append(target);
  const overlay = mountReviewOverlay(document, context, "connected");
  const listed = { id: "00000000-0000-4000-8000-000000000003", body: "Feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: context.pageTitle, parent_activity_url: null, embedded_locator: null, anchor_type: "visual_pin" as const, selected_quote: null, prefix: null, suffix: null, css_selector: "#target", dom_selector: null, relative_x: 0.5, relative_y: 0.5, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: true } };

  overlay.setCommentList([listed]);
  assert.equal(document.querySelector("[data-moodle-review-stored-pin]"), null);
  assert.equal(document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!.querySelector("[data-comment-item]")?.textContent?.includes("Feedback"), true);

  overlay.setRendererComments([listed]);
  assert.ok(document.querySelector("[data-moodle-review-stored-pin]"));
});

test("one adaptive action opens highlighted text directly or enters marker placement", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  document.body.innerHTML = '<main><p id="copy">Select these words for review</p></main>';
  mountReviewOverlay(document, context, "connected");
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const button = shadow.querySelector<HTMLButtonElement>('[data-action="add-comment"]')!;
  assert.equal(button.textContent, "Add comment marker");
  const text = document.querySelector("#copy")!.firstChild!; const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 12);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range as any); document.dispatchEvent(new window.Event("selectionchange") as any);
  assert.equal(button.textContent, "Add comment to highlighted text");
  button.click();
  assert.match(shadow.querySelector(".dialog")!.textContent!, /Comment on highlighted text/);
});

test("Help dialog provides complete instructions and metadata", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  mountReviewOverlay(document, context, "connected", {}, { version: "0.3.2", buildCommit: "abc1234def" }); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const trigger = shadow.querySelector<HTMLElement>('[data-action="help"]')!; trigger.click();
  const dialog = shadow.querySelector<HTMLElement>('[role="dialog"]')!;
  assert.equal(dialog.getAttribute("aria-modal"), "true"); assert.equal(dialog.getAttribute("aria-labelledby"), "review-help-title"); assert.equal(dialog.getAttribute("aria-describedby"), "review-help-intro");
  for (const text of ["Highlight exact text", "Place a comment marker", "Moodle and SCORM", "Open comments in context", "Filter and jump", "Reply, edit, and attach", "Resolve or delete", "Who can see feedback", "Pilot 0.3.2 · build abc1234"]) assert.match(dialog.textContent!, new RegExp(text));
  assert.equal(shadow.activeElement, dialog.querySelector("h2"));
  dialog.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
  assert.equal(shadow.querySelector('[role="dialog"]'), null); assert.equal(shadow.activeElement, trigger);
});

test("an authentication completion cannot overwrite a newer external state update", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  let finish!: (outcome: { status: "connected" }) => void;
  const authentication = new Promise<{ status: "connected" }>((resolve) => { finish = resolve; });
  const overlay = mountReviewOverlay(document, context, "signed-out", { onAuthenticate: () => authentication });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  shadow.querySelector<HTMLElement>('[data-action="authenticate"]')!.click();
  overlay.update(context, "offline");
  finish({ status: "connected" }); await tick();
  assert.equal(shadow.querySelector('[data-status-message]')!.textContent, "Service unavailable—retry");
  assert.equal(shadow.querySelector('[data-action="authenticate"]')!.textContent, "Retry");
  assert.equal(shadow.querySelector('[data-action="highlight"]'), null);
});

test("identity and status updates preserve an open review panel toggle state", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected");
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  shadow.querySelector<HTMLElement>('[data-action="panel"]')!.click();
  assert.equal(shadow.querySelector<HTMLElement>(".panel")!.hidden, false);
  overlay.update({ ...context, pageTitle: "Week 3" }, "connected");
  const toggle = shadow.querySelector<HTMLElement>('[data-action="panel"]')!;
  assert.equal(shadow.querySelector<HTMLElement>(".panel")!.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(toggle.getAttribute("aria-label"), "Close review panel");
});

test("a disconnected state closes an open review panel when its toggle is removed", () => {
  for (const status of ["signed-out", "pending", "offline"] as const) {
    const window = new Window(); const document = window.document as unknown as Document;
    const overlay = mountReviewOverlay(document, context, "connected");
    const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
    shadow.querySelector<HTMLElement>('[data-action="panel"]')!.click();
    overlay.update(context, status);
    assert.equal(shadow.querySelector<HTMLElement>(".panel")!.hidden, true);
    assert.equal(shadow.querySelector('[data-action="panel"]'), null);
  }
});

test("thread edit and reply controls toggle without duplicating composers", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  document.body.innerHTML = '<main><p id="copy">Anchor words here</p></main>';
  let edits = 0; let replies = 0;
  const overlay = mountReviewOverlay(document, context, "connected", { editThread: async () => { edits += 1; }, replyThread: async () => { replies += 1; } });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const comment = { id: "00000000-0000-4000-8000-000000000010", body: "Original", category: "general", status: "open", author: { display_name: "Richard Davies", role: "ld_dcd" }, page_url: context.page_url, page_title: context.pageTitle, parent_activity_url: null, embedded_locator: null, anchor_type: "visual_pin" as const, selected_quote: null, prefix: null, suffix: null, css_selector: "#copy", dom_selector: null, relative_x: .5, relative_y: .5, replies: [], status_history: [], capabilities: { can_reply: true, can_edit: true, can_change_status: true, can_share_with_sme: false, can_delete: true } };
  overlay.setPageComments([comment]);
  document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")!.click();
  const popover = shadow.querySelector<HTMLElement>("[data-thread-popover]")!;
  const edit = popover.querySelector<HTMLButtonElement>('[aria-label="Edit original comment"]')!;
  edit.click(); edit.click();
  assert.equal(popover.querySelectorAll("[data-edit-composer]").length, 0);
  edit.click(); assert.equal(popover.querySelectorAll("[data-edit-composer]").length, 1);
  const reply = popover.querySelector<HTMLButtonElement>("[data-reply-toggle]")!;
  reply.click(); reply.click(); assert.equal(popover.querySelectorAll("[data-reply-composer]").length, 0);
  reply.click(); const box = popover.querySelector<HTMLTextAreaElement>("[data-reply-composer] textarea")!; box.value = "A reply";
  popover.querySelector<HTMLButtonElement>("[data-save-reply]")!.click(); await tick();
  assert.equal(replies, 1); assert.match(popover.textContent!, /A reply/);
  assert.equal(edits, 0);
});

test("thread popover remains positioned from its marker and markers have no white border", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  document.body.innerHTML = '<main><div id="target">Target</div></main>';
  const overlay = mountReviewOverlay(document, context, "connected", { changeStatus: async () => {}, deleteThread: async () => {} });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const comment = { id: "00000000-0000-4000-8000-000000000011", body: "Pinned", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: context.pageTitle, parent_activity_url: null, embedded_locator: null, anchor_type: "visual_pin" as const, selected_quote: null, prefix: null, suffix: null, css_selector: "#target", dom_selector: null, relative_x: .5, relative_y: .5, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: true, can_share_with_sme: false, can_delete: true } };
  overlay.setPageComments([comment]);
  const marker = document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")!;
  assert.doesNotMatch(marker.style.border, /white/i);
  marker.click(); const popover = shadow.querySelector<HTMLElement>("[data-thread-popover]")!;
  const deleteButton = popover.querySelector<HTMLElement>('[aria-label="Delete thread"]')!;
  const resolveButton = popover.querySelector<HTMLElement>('[aria-label="Resolve this comment"]')!;
  assert.equal(deleteButton.className, "thread-delete");
  assert.equal(resolveButton.className, "resolve-toggle");
  assert.ok(resolveButton.querySelector(".status-hover-tick"));
  assert.match(Array.from(shadow.querySelectorAll("style")).map((style) => style.textContent).join("\n"), /\.thread-delete\{right:8px;border:2px solid #d73b3d;background:#d73b3d/);
  assert.match(Array.from(shadow.querySelectorAll("style")).map((style) => style.textContent).join("\n"), /\.status-action:hover \.status-hover-tick\{opacity:\.28\}/);
  const before = popover.style.left; window.dispatchEvent(new window.Event("scroll"));
  assert.equal(popover.style.left, before); assert.equal(marker.getAttribute("aria-expanded"), "true");
  marker.click(); assert.equal(shadow.querySelector("[data-thread-popover]"), null);
});

test("thread popover hides when its marker scrolls outside the viewport", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  document.body.innerHTML = '<div id="target">Target</div>';
  const target = document.querySelector<HTMLElement>("#target")!;
  target.getBoundingClientRect = () => ({ x: 40, y: 100, left: 40, top: 100, right: 140, bottom: 140, width: 100, height: 40, toJSON: () => ({}) });
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const comment = { id: "00000000-0000-4000-8000-000000000012", body: "Pinned", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: context.pageTitle, parent_activity_url: null, embedded_locator: null, anchor_type: "visual_pin" as const, selected_quote: null, prefix: null, suffix: null, css_selector: "#target", dom_selector: null, relative_x: .5, relative_y: .5, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: true } };
  overlay.setPageComments([comment]); const marker = document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")!;
  let markerTop = 100;
  marker.getBoundingClientRect = () => ({ x: 70, y: markerTop, left: 70, top: markerTop, right: 108, bottom: markerTop + 38, width: 38, height: 38, toJSON: () => ({}) });
  marker.click(); const popover = shadow.querySelector<HTMLElement>("[data-thread-popover]")!;
  assert.equal(popover.hidden, false);
  markerTop = -40; window.dispatchEvent(new window.Event("scroll")); assert.equal(popover.hidden, true);
  markerTop = 100; window.dispatchEvent(new window.Event("scroll")); assert.equal(popover.hidden, false);
  overlay.destroy();
});

test("marker placement has an obvious active button and comment cursor", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  document.body.innerHTML = '<main style="width:300px;height:200px"><p>Place here</p></main>';
  mountReviewOverlay(document, context, "connected");
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const button = shadow.querySelector<HTMLButtonElement>('[data-action="add-comment"]')!;
  button.click();
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.match(button.textContent!, /Cancel marker/);
  assert.match(document.documentElement.style.cursor, /url\(/);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(document.documentElement.style.cursor, "");
});

test("course comments default to open and expose resolved separately", () => {
  assert.match(tealOverlayOverrides, /\.comment-index-link\[hidden\]\{display:none!important\}/);
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const base = { id: "00000000-0000-4000-8000-000000000021", body: "Open feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Week 2", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: true, can_share_with_sme: false, can_delete: true, allowed_statuses: ["open", "resolved"] } };
  overlay.setPageComments([base, { ...base, id: "00000000-0000-4000-8000-000000000022", body: "Finished feedback", status: "resolved" }]);
  shadow.querySelector<HTMLElement>('[data-action="panel"]')!.click();
  const items = Array.from(shadow.querySelectorAll<HTMLElement>("[data-comment-item]"));
  assert.equal(items.find((item) => item.textContent!.includes("Open feedback"))!.hidden, false);
  assert.equal(items.find((item) => item.textContent!.includes("Finished feedback"))!.hidden, true);
  shadow.querySelector<HTMLElement>('[data-comment-filter="resolved"]')!.click();
  assert.equal(items.find((item) => item.textContent!.includes("Finished feedback"))!.hidden, false);
  assert.equal(items.find((item) => item.textContent!.includes("Open feedback"))!.hidden, true);
});

test("resolving shows a large checked confirmation for three seconds", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  document.body.innerHTML = '<div id="target">Target</div>'; const target = document.querySelector<HTMLElement>("#target")!;
  target.getBoundingClientRect = () => ({ x: 20, y: 40, left: 20, top: 40, right: 120, bottom: 80, width: 100, height: 40, toJSON: () => ({}) });
  let delayed: (() => void) | undefined; let delay = 0;
  window.setTimeout = ((handler: TimerHandler, milliseconds?: number) => { delayed = handler as () => void; delay = milliseconds ?? 0; return 1; }) as unknown as typeof window.setTimeout;
  const overlay = mountReviewOverlay(document, context, "connected", { changeStatus: async () => undefined }); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const comment = { id: "00000000-0000-4000-8000-000000000051", body: "Resolve me", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: context.pageTitle, parent_activity_url: null, embedded_locator: null, anchor_type: "visual_pin" as const, selected_quote: null, prefix: null, suffix: null, css_selector: "#target", dom_selector: null, relative_x: .5, relative_y: .5, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: true, can_share_with_sme: false, can_delete: false } };
  overlay.setPageComments([comment]); document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")!.click();
  const resolve = shadow.querySelector<HTMLButtonElement>(".resolve-toggle")!; resolve.click(); await Promise.resolve(); await Promise.resolve();
  assert.equal(resolve.textContent, ""); assert.ok(resolve.querySelector("svg path")); assert.equal(delay, 3000); assert.ok(shadow.querySelector("[data-thread-popover]"));
  delayed?.(); assert.equal(shadow.querySelector("[data-thread-popover]"), null);
  overlay.destroy();
});

test("comment index switches between whole course and current page without renumbering loaded-course positions", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const base = { id: "00000000-0000-4000-8000-000000000031", body: "Here", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Week 2", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: true } };
  overlay.setPageComments([{ ...base, id: "00000000-0000-4000-8000-000000000032", page_url: "https://learn.example/mod/page/view.php?id=1", page_title: "Week 1", body: "Earlier" }, base]);
  const links = Array.from(shadow.querySelectorAll<HTMLElement>("[data-comment-item]")); assert.equal(links.every((link) => !link.hidden), true);
  shadow.querySelector<HTMLElement>('[data-comment-scope="page"]')!.click();
  assert.equal(links[0]!.hidden, true); assert.equal(links[1]!.hidden, false); assert.match(links[1]!.textContent!, /^#2 /);
  shadow.querySelector<HTMLElement>('[data-comment-scope="course"]')!.click(); assert.equal(links.every((link) => !link.hidden), true); assert.match(links[0]!.textContent!, /^#1 /); assert.match(links[1]!.textContent!, /^#2 /);
});

test("clicking a comment keeps the list open and scrolls its course content into view", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  document.body.innerHTML = '<section id="target">Course content</section>'; const target = document.querySelector<HTMLElement>("#target")!;
  target.getBoundingClientRect = () => ({ x: 20, y: 0, left: 20, top: 0, right: 220, bottom: 2000, width: 200, height: 2000, toJSON: () => ({}) });
  Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  let scrollDelta: number | undefined; window.scrollBy = ((options: ScrollToOptions) => { scrollDelta = options.top; }) as typeof window.scrollBy;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const comment = { id: "00000000-0000-4000-8000-000000000042", body: "Go here", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: context.pageTitle, parent_activity_url: null, embedded_locator: null, anchor_type: "visual_pin" as const, selected_quote: null, prefix: null, suffix: null, css_selector: "#target", dom_selector: null, relative_x: .5, relative_y: .9, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } };
  overlay.setPageComments([comment]); shadow.querySelector<HTMLElement>('[data-action="panel"]')!.click();
  shadow.querySelector<HTMLElement>("[data-comment-item]")!.click();
  assert.equal(shadow.querySelector<HTMLElement>(".panel")!.hidden, false);
  assert.equal(scrollDelta, 1500);
  assert.ok(shadow.querySelector("[data-thread-popover]"));
  overlay.destroy();
});

test("course scope and status filters share one compact row", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  overlay.setPageComments([{ id: "00000000-0000-4000-8000-000000000041", body: "Feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Week 2", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight", selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } }]);
  const row = shadow.querySelector<HTMLElement>(".comment-filter-row")!;
  assert.ok(row);
  assert.equal(row.querySelectorAll(".comment-control").length, 5);
  assert.match(tealOverlayOverrides, /\.comment-filter-row\{display:flex/);
  assert.match(approvedControlStyles, /--review-scope:#a84f12/);
  assert.match(approvedControlStyles, /--review-status:#176b43/);
});

test("current page heading cannot shrink behind the comment filters", () => {
  assert.match(commentListLayoutStyles, /\.panel-title\{[^}]*flex:0 0 auto/);
});

test("toolbar and semantic comment controls expose approved states", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const add = shadow.querySelector<HTMLButtonElement>('[data-action="add-comment"]')!;
  const panel = shadow.querySelector<HTMLButtonElement>('[data-action="panel"]')!;
  const help = shadow.querySelector<HTMLButtonElement>('[data-action="help"]')!;
  assert.equal(add.getAttribute("aria-pressed"), "false");
  assert.equal(panel.getAttribute("aria-expanded"), "false");
  assert.equal(help.getAttribute("aria-expanded"), "false");
  overlay.setCommentList([]); panel.click();
  assert.equal(panel.getAttribute("aria-expanded"), "true");
  const controls = Array.from(shadow.querySelectorAll<HTMLElement>(".comment-control"));
  assert.equal(controls.length, 5);
  assert.deepEqual(controls.map((control) => control.textContent), ["Whole course", "Current page", "Open", "Resolved", "Jump to"]);
  assert.ok(shadow.querySelector('[data-comment-jump][aria-controls]'));
  assert.ok(shadow.querySelector('[role="listbox"]'));
  assert.match(controlAlignmentStyles, /\[data-action="help"\]\{[^}]*width:44px[^}]*height:44px/);
  assert.match(controlAlignmentStyles, /\.comment-control\{[^}]*display:inline-flex[^}]*align-items:center[^}]*justify-content:center/);
  overlay.destroy();
});

test("Help uses a distinct blue button treatment", () => {
  assert.match(helpButtonStyles, /\.toolbar-actions \[data-action="help"\]\{background:#fff;border-color:var\(--review-jump\);color:var\(--review-jump\)\}/);
  assert.match(helpButtonStyles, /\.toolbar-actions \[data-action="help"\]:hover,\.toolbar-actions \[data-action="help"\]:focus-visible\{background:var\(--review-jump\);border-color:var\(--review-jump\);color:#fff\}/);
});

test("marker and delete controls follow the approved button states", () => {
  assert.match(semanticFilterHoverStyles, /\.toolbar-actions \[data-action="add-comment"\]:hover\{background:var\(--review-dark-teal\);border-color:var\(--review-dark-teal\);color:#fff\}/);
  assert.match(semanticFilterHoverStyles, /\.toolbar-actions \[data-action="add-comment"\]\[aria-pressed="true"\]\{background:var\(--review-red\);border-color:var\(--review-red\);color:#fff\}/);
  assert.match(semanticFilterHoverStyles, /\.toolbar-actions \[data-action="add-comment"\]\[aria-pressed="true"\]:hover\{background:#fff;border-color:var\(--review-red\);color:var\(--review-red\)\}/);
  assert.match(semanticFilterHoverStyles, /\.comment-row-action\.delete-action\{border-radius:5px\}/);
  assert.match(semanticFilterHoverStyles, /\.comment-row-action\.delete-action:hover\{background:#fff;border-color:var\(--review-red\)\}/);
});

test("comment controls use their semantic colours for selected and unselected states", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  overlay.setCommentList([]);
  const colours = (selector: string) => {
    const style = window.getComputedStyle(shadow.querySelector<HTMLElement>(selector)! as any);
    return [style.backgroundColor, style.color];
  };
  assert.deepEqual(colours('[data-comment-scope="course"]'), ["#a84f12", "#fff"]);
  assert.deepEqual(colours('[data-comment-scope="page"]'), ["#fff", "#a84f12"]);
  assert.deepEqual(colours('[data-comment-filter="open"]'), ["#176b43", "#fff"]);
  assert.deepEqual(colours('[data-comment-filter="resolved"]'), ["#fff", "#176b43"]);
  assert.deepEqual(colours("[data-comment-jump]"), ["#fff", "#356f9f"]);
  overlay.destroy();
});

test("unselected comment controls keep their semantic hover colours", () => {
  assert.match(approvedControlStyles, /\.comment-filters \.comment-scope:hover\{background:var\(--review-scope\);color:#fff\}/);
  assert.match(approvedControlStyles, /\.comment-filters \.comment-status:hover\{background:var\(--review-status\);color:#fff\}/);
  assert.match(approvedControlStyles, /\.comment-page-field \.comment-jump:hover\{background:var\(--review-jump\);color:#fff\}/);
});

test("comment filter buttons override dark fallback hover states", () => {
  assert.match(semanticFilterHoverStyles, /\.comment-filters \.comment-scope:hover\{background:var\(--review-scope\);border-color:var\(--review-scope\);color:#fff\}/);
  assert.match(semanticFilterHoverStyles, /\.comment-filters \.comment-status:hover\{background:var\(--review-status\);border-color:var\(--review-status\);color:#fff\}/);
  assert.match(semanticFilterHoverStyles, /\.comment-jump\[aria-expanded="true"\]\{background:var\(--review-jump\);border-color:var\(--review-jump\);color:#fff\}/);
});

test("comments button changes from outlined to solid while the panel is open", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const comments = shadow.querySelector<HTMLButtonElement>('[data-action="panel"]')!;
  const colours = () => { const style = window.getComputedStyle(comments as any); return [style.backgroundColor, style.color]; };
  assert.deepEqual(colours(), ["#fff", "#0b6261"]);
  comments.click();
  assert.equal(comments.getAttribute("aria-expanded"), "true");
  assert.deepEqual(colours(), ["#0b6261", "#fff"]);
  assert.match(commentsButtonStyles, /\[data-action="panel"\]\[aria-expanded="true"\]\{background:var\(--review-teal-dark\);border-color:var\(--review-teal-dark\);color:#fff\}/);
  assert.match(commentsButtonStyles, /\[data-action="panel"\]\[aria-expanded="true"\]:hover\{background:#fff;border-color:var\(--review-teal-dark\);color:var\(--review-teal-dark\)\}/);
  overlay.destroy();
});

test("whole-course list groups and canonically numbers comments in course order", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const base = { id: "00000000-0000-4000-8000-000000000100", body: "Feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Repeated title", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } };
  overlay.setCommentList([
    { ...base, id: "00000000-0000-4000-8000-000000000110", page_url: "https://learn.example/10", page_title: "1.10 Later" },
    { ...base, id: "00000000-0000-4000-8000-000000000101", page_url: "https://learn.example/info", page_title: "Course information" },
    { ...base, id: "00000000-0000-4000-8000-000000000103", page_url: "https://learn.example/1-3", page_title: "1.3 Case law" },
    { ...base, id: "00000000-0000-4000-8000-000000000102", page_url: "https://learn.example/1", page_title: "1 Introduction" },
  ]);
  assert.deepEqual(Array.from(shadow.querySelectorAll<HTMLElement>(".comment-group-heading")).map((node) => node.textContent), ["Course information", "1 Introduction", "1.3 Case law", "1.10 Later"]);
  assert.deepEqual(Array.from(shadow.querySelectorAll<HTMLElement>("[data-comment-item]")).map((node) => node.dataset.commentIndex), ["1", "2", "3", "4"]);
  const results = shadow.querySelector<HTMLElement>(".comment-results")!; results.scrollTop = 100; overlay.setCommentList([]); assert.equal(shadow.querySelector<HTMLElement>(".comment-results")!.scrollTop, 0);
  overlay.destroy();
});

test("large course comment lists are viewport bounded and scroll in a dedicated results region", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const base = { id: "00000000-0000-4000-8000-000000000100", body: "Feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Repeated title", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } };
  overlay.setCommentList(Array.from({ length: 32 }, (_, index) => ({ ...base, id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, page_url: `https://learn.example/mod/page/view.php?id=${index % 3}`, page_title: index % 2 ? "Repeated title" : `Page ${index}` })));
  const results = shadow.querySelector<HTMLElement>(".comment-results")!;
  assert.equal(results.getAttribute("role"), "list");
  assert.equal(results.querySelectorAll("[data-comment-item]").length, 32);
  const listItem = results.querySelector<HTMLElement>(":scope > [role='listitem']")!;
  const navigation = listItem.querySelector<HTMLButtonElement>(":scope > button[data-comment-item]")!;
  assert.ok(navigation); assert.equal(navigation.getAttribute("role"), null); assert.match(navigation.getAttribute("aria-label") ?? "", /Comment 1/);
  assert.match(commentListLayoutStyles, /\.shell\{[^}]*max-height:calc\(100vh - 32px\)[^}]*display:flex[^}]*flex-direction:column/);
  assert.match(commentListLayoutStyles, /\.panel\{[^}]*min-height:0[^}]*flex:1 1 auto/);
  assert.match(commentListLayoutStyles, /\[data-panel-content\]\{[^}]*min-height:0[^}]*display:flex[^}]*flex-direction:column/);
  assert.match(commentListLayoutStyles, /\.comment-results\{[^}]*min-height:0[^}]*flex:1 1 auto[^}]*overflow-y:auto[^}]*font-size:14px/);
});

test("course comment rows expose capability-gated resolve, reopen, and delete actions without navigating", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const statusCalls: string[][] = []; const deleteCalls: string[] = []; const navigationCalls: string[] = [];
  const base = { id: "00000000-0000-4000-8000-000000000400", body: "Actionable feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Week 2", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: true, can_share_with_sme: false, can_delete: true } };
  let records = [base, { ...base, id: "00000000-0000-4000-8000-000000000401", status: "resolved", body: "Already resolved", capabilities: { ...base.capabilities, can_delete: false } }];
  let overlay: ReturnType<typeof mountReviewOverlay>;
  overlay = mountReviewOverlay(document, context, "connected", {
    navigateToComment: async (id) => { navigationCalls.push(id); },
    changeStatus: async (id, status) => { statusCalls.push([id, status]); records = records.map((comment) => comment.id === id ? { ...comment, status } : comment); },
    deleteThread: async (id) => { deleteCalls.push(id); records = records.filter((comment) => comment.id !== id); overlay.setCommentList(records); },
  });
  overlay.setCommentList(records);
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const firstRow = shadow.querySelectorAll<HTMLElement>("[role='listitem']")[0]!;
  assert.ok(firstRow.querySelector("button[data-comment-item]"));
  const resolve = firstRow.querySelector<HTMLButtonElement>('[data-comment-action="status"]')!;
  const remove = firstRow.querySelector<HTMLButtonElement>('[data-comment-action="delete"]')!;
  assert.match(resolve.getAttribute("aria-label") ?? "", /Resolve comment 1/); assert.equal(resolve.title, resolve.getAttribute("aria-label"));
  assert.match(remove.getAttribute("aria-label") ?? "", /Delete comment 1/); assert.equal(remove.title, remove.getAttribute("aria-label"));
  resolve.click(); await acceptConfirmation(shadow);
  assert.deepEqual(statusCalls, [[base.id, "resolved"]]); assert.deepEqual(navigationCalls, []);
  overlay.setCommentList(records); assert.equal(shadow.querySelector<HTMLButtonElement>('[data-comment-filter="open"]')!.getAttribute("aria-pressed"), "true"); assert.equal(shadow.querySelectorAll("[role='listitem']").length, 2);
  shadow.querySelector<HTMLButtonElement>('[data-comment-filter="resolved"]')!.click();
  const reopened = shadow.querySelector<HTMLElement>(`[data-comment-row="${base.id}"]`)!.querySelector<HTMLButtonElement>('[data-comment-action="status"]')!;
  assert.match(reopened.getAttribute("aria-label") ?? "", /Reopen comment 1/);
  reopened.click(); await acceptConfirmation(shadow);
  assert.deepEqual(statusCalls, [[base.id, "resolved"], [base.id, "open"]]); assert.deepEqual(navigationCalls, []);

  assert.equal(shadow.querySelector<HTMLButtonElement>('[data-comment-filter="resolved"]')!.getAttribute("aria-pressed"), "true"); shadow.querySelector<HTMLButtonElement>('[data-comment-filter="open"]')!.click();
  overlay.setCommentList(records); shadow.querySelector<HTMLElement>(`[data-comment-row="${base.id}"]`)!.querySelector<HTMLButtonElement>('[data-comment-action="delete"]')!.click(); shadow.querySelector<HTMLButtonElement>("[data-confirm-cancel]")!.click(); await tick(); assert.deepEqual(deleteCalls, []);
  shadow.querySelector<HTMLElement>(`[data-comment-row="${base.id}"]`)!.querySelector<HTMLButtonElement>('[data-comment-action="delete"]')!.click(); assert.match(shadow.querySelector<HTMLElement>(".confirm-dialog")!.textContent!, /Delete this entire thread/); await acceptConfirmation(shadow);
  assert.deepEqual(deleteCalls, [base.id]); assert.deepEqual(navigationCalls, []);
  assert.equal(shadow.querySelectorAll("[role='listitem']").length, 1); assert.match(shadow.querySelector<HTMLButtonElement>("[data-comment-item]")!.textContent!, /^#1 /);
});

test("course row actions are omitted without both capability and callback", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected", { changeStatus: async () => undefined }); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const base = { id: "00000000-0000-4000-8000-000000000410", body: "Restricted", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Week 2", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: true } };
  overlay.setCommentList([base]);
  const row = shadow.querySelector<HTMLElement>("[role='listitem']")!;
  assert.ok(row.querySelector("button[data-comment-item]")); assert.equal(row.querySelector("[data-comment-action]"), null);
});

test("a rejected course row mutation keeps the row, re-enables only its action, and reports a row status", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  let rejectMutation: ((error: Error) => void) | undefined;
  const overlay = mountReviewOverlay(document, context, "connected", { changeStatus: () => new Promise((_, reject) => { rejectMutation = reject; }) }); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const comment = { id: "00000000-0000-4000-8000-000000000420", body: "Will fail", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Week 2", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: true, can_share_with_sme: false, can_delete: false } };
  overlay.setCommentList([comment]);
  const row = shadow.querySelector<HTMLElement>("[role='listitem']")!; const navigation = row.querySelector<HTMLButtonElement>("[data-comment-item]")!; const resolve = row.querySelector<HTMLButtonElement>('[data-comment-action="status"]')!;
  resolve.click(); await acceptConfirmation(shadow); assert.equal(resolve.disabled, true); assert.equal(navigation.disabled, false);
  rejectMutation!(new Error("Connection lost")); await tick();
  assert.ok(row.isConnected); assert.equal(resolve.disabled, false); assert.equal(row.querySelector<HTMLElement>('[role="status"]')?.textContent, "Connection lost");
});

test("a mutation rejected after a list refresh reports on the current row and re-enables its action", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  let rejectMutation: ((error: Error) => void) | undefined;
  const overlay = mountReviewOverlay(document, context, "connected", { changeStatus: () => new Promise((_, reject) => { rejectMutation = reject; }) }); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const comment = { id: "00000000-0000-4000-8000-000000000421", body: "Refresh while pending", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Week 2", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: true, can_share_with_sme: false, can_delete: false } };
  overlay.setCommentList([comment]); shadow.querySelector<HTMLButtonElement>('[data-comment-action="status"]')!.click(); await acceptConfirmation(shadow);
  overlay.setCommentList([comment]);
  const currentAction = shadow.querySelector<HTMLButtonElement>('[data-comment-action="status"]')!; assert.equal(currentAction.disabled, true);
  rejectMutation!(new Error("Refresh failed")); await tick();
  const currentRow = shadow.querySelector<HTMLElement>("[role='listitem']")!;
  assert.ok(currentRow.isConnected); assert.equal(currentAction.disabled, false); assert.equal(currentRow.querySelector<HTMLElement>('[role="status"]')?.textContent, "Refresh failed");
});

test("a confirmed delete rejection preserves the current row and reports its error", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected", { deleteThread: async () => { throw new Error("Delete unavailable"); } }); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const comment = { id: "00000000-0000-4000-8000-000000000422", body: "Keep after failure", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Week 2", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: true } };
  overlay.setCommentList([comment]); shadow.querySelector<HTMLButtonElement>('[data-comment-action="delete"]')!.click(); await acceptConfirmation(shadow);
  const row = shadow.querySelector<HTMLElement>("[role='listitem']")!; const remove = row.querySelector<HTMLButtonElement>('[data-comment-action="delete"]')!;
  assert.ok(row.isConnected); assert.equal(remove.disabled, false); assert.equal(row.querySelector<HTMLElement>('[role="status"]')?.textContent, "Delete unavailable");
});

test("concurrent status and delete failures retain independent row messages and action state", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  let rejectStatus: ((error: Error) => void) | undefined; let rejectDelete: ((error: Error) => void) | undefined;
  const overlay = mountReviewOverlay(document, context, "connected", { changeStatus: () => new Promise((_, reject) => { rejectStatus = reject; }), deleteThread: () => new Promise((_, reject) => { rejectDelete = reject; }) }); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const comment = { id: "00000000-0000-4000-8000-000000000423", body: "Concurrent actions", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Week 2", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: true, can_share_with_sme: false, can_delete: true } };
  overlay.setCommentList([comment]); const status = shadow.querySelector<HTMLButtonElement>('[data-comment-action="status"]')!; const remove = shadow.querySelector<HTMLButtonElement>('[data-comment-action="delete"]')!;
  status.click(); await acceptConfirmation(shadow); remove.click(); await acceptConfirmation(shadow); assert.equal(status.disabled, true); assert.equal(remove.disabled, true);
  rejectStatus!(new Error("Status unavailable")); await tick();
  assert.equal(status.disabled, false); assert.equal(remove.disabled, true); assert.equal(shadow.querySelector<HTMLElement>('[data-comment-mutation-status="status"]')?.textContent, "Status unavailable");
  rejectDelete!(new Error("Delete unavailable")); await tick();
  assert.equal(remove.disabled, false); assert.equal(shadow.querySelector<HTMLElement>('[data-comment-mutation-status="status"]')?.textContent, "Status unavailable"); assert.equal(shadow.querySelector<HTMLElement>('[data-comment-mutation-status="delete"]')?.textContent, "Delete unavailable");
});

test("course row action labels retain loaded-course numbers through filtering", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected", { changeStatus: async () => undefined }); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const base = { id: "00000000-0000-4000-8000-000000000430", body: "First", category: "general", status: "resolved", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: "https://learn.example/mod/page/view.php?id=1", page_title: "Week 1", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: true, can_share_with_sme: false, can_delete: false } };
  overlay.setCommentList([base, { ...base, id: "00000000-0000-4000-8000-000000000431", body: "Second", page_url: context.page_url }]);
  shadow.querySelector<HTMLButtonElement>('[data-comment-filter="resolved"]')!.click(); shadow.querySelector<HTMLButtonElement>('[data-comment-scope="page"]')!.click();
  const visibleAction = Array.from(shadow.querySelectorAll<HTMLButtonElement>('[data-comment-action="status"]')).find((button) => !button.closest<HTMLElement>("[role='listitem']")!.hidden)!;
  assert.match(visibleAction.getAttribute("aria-label") ?? "", /comment 2/);
});

test("blank page titles use one Untitled page label in selectors, rows, and accessible names", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  overlay.setCommentList([{ id: "00000000-0000-4000-8000-000000000190", body: "Blank title feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: "https://learn.example/mod/page/view.php?id=190", page_title: "  \n  ", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight", selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } }]);
  const options = shadow.querySelectorAll<HTMLElement>("[data-comment-page-option]");
  assert.equal(options[1]!.textContent, "Untitled page");
  assert.equal(shadow.querySelector<HTMLElement>("[data-comment-group-heading]")!.textContent, "Untitled page");
  const navigation = shadow.querySelector<HTMLButtonElement>("button[data-comment-item]")!;
  assert.match(navigation.getAttribute("aria-label") ?? "", /Untitled page/);
  assert.doesNotMatch(navigation.getAttribute("aria-label") ?? "", /\n/);
});

test("page selector uses URLs, preserves duplicate titles, filters rows, and hides in current-page scope", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const base = { id: "00000000-0000-4000-8000-000000000200", body: "Feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Same title", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } };
  const otherUrl = "https://learn.example/mod/page/view.php?id=3";
  overlay.setCommentList([base, { ...base, id: "00000000-0000-4000-8000-000000000201", page_url: otherUrl, body: "Other page" }]);
  const listbox = shadow.querySelector<HTMLElement>('[role="listbox"]')!;
  assert.equal(listbox.getAttribute("aria-label"), "Jump to course page");
  assert.deepEqual(Array.from(listbox.querySelectorAll<HTMLElement>("[role=option]"), (option) => [option.dataset.commentPageOption, option.textContent]), [["", "All pages"], [context.page_url, "Same title"], [otherUrl, "Same title"]]);
  choosePage(shadow, otherUrl);
  const visible = Array.from(shadow.querySelectorAll<HTMLElement>("[data-comment-item]")).filter((item) => !item.hidden);
  assert.equal(visible.length, 1); assert.equal(visible[0]!.textContent!.includes("Same title"), false); assert.match(visible[0]!.textContent!, /Other page/);
  shadow.querySelector<HTMLButtonElement>('[data-comment-scope="page"]')!.click();
  assert.equal(shadow.querySelector<HTMLElement>(".comment-page-field")!.hidden, true);
});

test("Jump to closes when the reviewer clicks elsewhere in the review panel", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  overlay.setCommentList([{ id: "00000000-0000-4000-8000-000000000202", body: "Feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Current page", parent_activity_url: null, embedded_locator: null, anchor_type: "visual_pin", selected_quote: null, prefix: null, suffix: null, css_selector: "body", dom_selector: null, relative_x: 0.5, relative_y: 0.5, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } }]);
  const jump = shadow.querySelector<HTMLButtonElement>("[data-comment-jump]")!;
  jump.click();
  assert.equal(jump.getAttribute("aria-expanded"), "true");
  shadow.querySelector<HTMLElement>(".panel-title")!.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, composed: true }) as unknown as Event);
  assert.equal(jump.getAttribute("aria-expanded"), "false");
  assert.equal(shadow.querySelector<HTMLElement>("[role=listbox]")!.hidden, true);
});

test("Jump to opens a compact single-line list above the review panel", () => {
  assert.match(semanticFilterHoverStyles, /\.comment-page-list\{top:auto;bottom:42px;width:min\(380px,calc\(100vw - 32px\)\)\}/);
  assert.match(semanticFilterHoverStyles, /\.comment-page-option\{min-height:34px!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500\}/);
  assert.match(semanticFilterHoverStyles, /\.comment-page-option\[aria-selected="true"\]\{font-weight:650\}/);
  assert.match(semanticFilterHoverStyles, /\.shell:has\(\.comment-jump\[aria-expanded="true"\]\),\.panel:has\(\.comment-jump\[aria-expanded="true"\]\)\{overflow:visible\}/);
});

test("comment list filters persist across refreshes and missing selected pages reset to all pages", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const base = { id: "00000000-0000-4000-8000-000000000300", body: "Resolved", category: "general", status: "resolved", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Current", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } };
  const otherUrl = "https://learn.example/mod/page/view.php?id=4";
  const comments = [base, { ...base, id: "00000000-0000-4000-8000-000000000301", page_url: otherUrl, page_title: "Other" }];
  overlay.setCommentList(comments);
  shadow.querySelector<HTMLButtonElement>('[data-comment-filter="resolved"]')!.click();
  choosePage(shadow, otherUrl);
  overlay.setCommentList(comments);
  assert.equal(shadow.querySelector<HTMLButtonElement>('[data-comment-filter="resolved"]')!.getAttribute("aria-pressed"), "true");
  assert.equal(shadow.querySelector<HTMLElement>(`[data-comment-page-option="${otherUrl}"]`)!.getAttribute("aria-selected"), "true");
  overlay.setCommentList([base]);
  assert.equal(shadow.querySelector<HTMLElement>('[data-comment-page-option=""]')!.getAttribute("aria-selected"), "true");
});

test("course, selected-page, status, and empty filters compose without renumbering rows", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const base = { id: "00000000-0000-4000-8000-000000000500", body: "First open", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Week 2", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } };
  const otherUrl = "https://learn.example/mod/page/view.php?id=5";
  overlay.setCommentList([base, { ...base, id: "00000000-0000-4000-8000-000000000501", body: "Other resolved", status: "resolved", page_url: otherUrl, page_title: "Week 5" }, { ...base, id: "00000000-0000-4000-8000-000000000502", body: "Other open", page_url: otherUrl, page_title: "Week 5" }]);
  const visible = () => Array.from(shadow.querySelectorAll<HTMLButtonElement>("[data-comment-item]"), (item) => item.hidden ? "" : item.textContent!).filter(Boolean);
  assert.deepEqual(visible().map((text) => text.match(/^#\d+/)?.[0]), ["#1", "#3"]);
  choosePage(shadow, otherUrl);
  assert.deepEqual(visible().map((text) => text.match(/^#\d+/)?.[0]), ["#3"]); assert.doesNotMatch(visible()[0]!, /Week 5/);
  shadow.querySelector<HTMLButtonElement>('[data-comment-filter="resolved"]')!.click();
  assert.deepEqual(visible().map((text) => text.match(/^#\d+/)?.[0]), ["#2"]); assert.doesNotMatch(visible()[0]!, /Week 5/);
  shadow.querySelector<HTMLButtonElement>('[data-comment-scope="page"]')!.click();
  assert.deepEqual(visible(), []);
  const empty = shadow.querySelector<HTMLElement>("[data-comment-empty]")!;
  assert.equal(empty.textContent, "No comments match these filters."); assert.equal(empty.hidden, false);
  shadow.querySelector<HTMLButtonElement>('[data-comment-filter="open"]')!.click();
  assert.deepEqual(visible().map((text) => text.match(/^#\d+/)?.[0]), ["#1"]); assert.equal(empty.hidden, true);
});

test("current-page overlay filtering matches the exact page_url including its hash", () => {
  const scormContext = { ...context, page_url: "https://rise.example/activity#moodle-review-page=Lesson-2", pageTitle: "Embedded activity · Lesson 2" };
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, scormContext, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const base = { id: "00000000-0000-4000-8000-000000000510", body: "SCORM feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: scormContext.page_url, page_title: scormContext.pageTitle, parent_activity_url: context.page_url, embedded_locator: "Lesson 2", anchor_type: "visual_pin" as const, selected_quote: null, prefix: null, suffix: null, css_selector: "#target", dom_selector: null, relative_x: .5, relative_y: .5, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } };
  overlay.setCommentList([base, { ...base, id: "00000000-0000-4000-8000-000000000511", page_url: "https://rise.example/activity#moodle-review-page=Lesson-1", page_title: "Embedded activity · Lesson 1" }]);
  shadow.querySelector<HTMLButtonElement>('[data-comment-scope="page"]')!.click();
  const visible = Array.from(shadow.querySelectorAll<HTMLButtonElement>("[data-comment-item]")).filter((item) => !item.hidden);
  assert.equal(visible.length, 1); assert.match(visible[0]!.textContent!, /^#2 /); assert.doesNotMatch(visible[0]!.textContent!, /Embedded activity/);
});

test("course-list navigation reports the precise SCORM recovery instruction without closing the list", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected", { navigateToComment: async () => { throw new Error("Open the original SCORM activity first"); } });
  const comment = { id: "00000000-0000-4000-8000-000000000099", body: "Legacy feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: "https://rise.example/activity#moodle-review-page=Lesson", page_title: "Embedded activity · Lesson", parent_activity_url: null, embedded_locator: null, anchor_type: "visual_pin" as const, selected_quote: null, prefix: null, suffix: null, css_selector: "#target", dom_selector: null, relative_x: .5, relative_y: .5, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } };
  overlay.setCommentList([comment]);
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  shadow.querySelector<HTMLButtonElement>('[data-action="panel"]')!.click();
  shadow.querySelector<HTMLButtonElement>("[data-comment-item]")!.click(); await tick();
  assert.equal(shadow.querySelector('[data-action="panel"]')?.getAttribute("aria-expanded"), "true");
  assert.match(shadow.querySelector<HTMLElement>("[data-comment-navigation-status]")?.textContent ?? "", /Open the original SCORM activity first/);
});

test("delegated mode sends one adaptive interaction request and exposes permission recovery", async () => {
  const window = new Window({ url: "https://learn.example/mod/scorm/player.php" });
  window.document.body.innerHTML = "<h1>SCORM</h1>";
  const requested: string[] = [];
  let permissions = 0;
  const overlay = mountReviewOverlay(window.document as unknown as Document, context, "connected", {
    onRequestInteraction: (intent) => { requested.push(intent); },
    onRequestPermission: () => { permissions += 1; return Promise.resolve(true); },
  });
  overlay.setInteractionState("embedded", true);
  const root = window.document.querySelector("#moodle-course-review-overlay")!.shadowRoot!;
  const add = root.querySelector('[data-action="add-comment"]') as unknown as HTMLButtonElement;
  assert.equal(add.textContent, "Add comment to highlighted text");
  add.click();
  assert.deepEqual(requested, ["selection"]);
  overlay.setInteractionState("permission-required", false);
  assert.equal(add.textContent, "Allow SCORM review access");
  add.click();
  await Promise.resolve();
  assert.equal(permissions, 1);
  overlay.destroy();
});

test("loading SCORM keeps one actionable queued marker toggle", () => {
  const window = new Window({ url: "https://learn.example/mod/scorm/player.php" });
  const requested: string[] = [];
  const overlay = mountReviewOverlay(window.document as unknown as Document, context, "connected", { onRequestInteraction: (intent) => requested.push(intent) });
  const root = window.document.querySelector("#moodle-course-review-overlay")!.shadowRoot!;
  const add = root.querySelector('[data-action="add-comment"]') as unknown as HTMLButtonElement;
  overlay.setInteractionState("loading");
  assert.equal(add.disabled, false);
  assert.match(add.textContent!, /waiting/i);
  add.click(); add.click();
  assert.deepEqual(requested, ["marker", "marker"]);
  assert.match(add.textContent!, /waiting/i);
  overlay.destroy();
});

test("reload-required state explains and performs the precise recovery", () => {
  const window = new Window({ url: "https://learn.example/mod/scorm/player.php" });
  let reloads = 0;
  const overlay = mountReviewOverlay(window.document as unknown as Document, context, "connected", { onReloadRequired: () => { reloads += 1; } });
  const root = window.document.querySelector("#moodle-course-review-overlay")!.shadowRoot!;
  const add = root.querySelector('[data-action="add-comment"]') as unknown as HTMLButtonElement;
  overlay.setInteractionState("reload-required");
  assert.match(add.textContent!, /reload/i);
  add.click();
  assert.equal(reloads, 1);
  overlay.destroy();
});
