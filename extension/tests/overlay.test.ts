import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { createOverlayMarkup, mountReviewOverlay, OVERLAY_HOST_ID, overlayStyles, tealOverlayOverrides } from "../src/overlay/root.ts";

const context = { course_url: "https://learn.example/course/view.php?id=1", page_url: "https://learn.example/mod/page/view.php?id=2", title: "Law", pageTitle: "Week 2", moodle_course_id: 1, identityConfidence: "confirmed" as const };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  for (const text of ["Comment on text", "Comment on an area", "Embedded activities", "Comments", "Conversations and status", "Pilot 0.3.2 · build abc1234"]) assert.match(dialog.textContent!, new RegExp(text));
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
  const overlay = mountReviewOverlay(document, context, "connected");
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const comment = { id: "00000000-0000-4000-8000-000000000011", body: "Pinned", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: context.pageTitle, parent_activity_url: null, embedded_locator: null, anchor_type: "visual_pin" as const, selected_quote: null, prefix: null, suffix: null, css_selector: "#target", dom_selector: null, relative_x: .5, relative_y: .5, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: true } };
  overlay.setPageComments([comment]);
  const marker = document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")!;
  assert.doesNotMatch(marker.style.border, /white/i);
  marker.click(); const popover = shadow.querySelector<HTMLElement>("[data-thread-popover]")!;
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
  assert.equal(resolve.textContent, "☑ Resolved"); assert.match(resolve.style.fontSize, /18px/); assert.equal(delay, 3000); assert.ok(shadow.querySelector("[data-thread-popover]"));
  delayed?.(); assert.equal(shadow.querySelector("[data-thread-popover]"), null);
  overlay.destroy();
});

test("comment index switches between whole course and current page and renumbers visible links", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected"); const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const base = { id: "00000000-0000-4000-8000-000000000031", body: "Here", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: context.page_url, page_title: "Week 2", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "missing", prefix: "", suffix: "", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: true } };
  overlay.setPageComments([{ ...base, id: "00000000-0000-4000-8000-000000000032", page_url: "https://learn.example/mod/page/view.php?id=1", page_title: "Week 1", body: "Earlier" }, base]);
  const links = Array.from(shadow.querySelectorAll<HTMLElement>("[data-comment-item]")); assert.equal(links.every((link) => !link.hidden), true);
  shadow.querySelector<HTMLElement>('[data-comment-scope="page"]')!.click();
  assert.equal(links[0]!.hidden, true); assert.equal(links[1]!.hidden, false); assert.match(links[1]!.textContent!, /^#1 /);
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
  assert.equal(row.querySelectorAll("button").length, 4);
  assert.match(tealOverlayOverrides, /\.comment-filter-row\{display:flex/);
  assert.match(tealOverlayOverrides, /\.comment-filters button\[aria-pressed="true"\]\{background:#082f2f;color:#fff;border-color:#082f2f\}/);
  assert.match(tealOverlayOverrides, /\.comment-filters button:hover\{background:#28c4c2;color:#082f2f;border-color:#082f2f\}/);
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
