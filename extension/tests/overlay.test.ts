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

test("overlay displays accessible pilot version diagnostics", () => {
  const markup = createOverlayMarkup({ courseTitle: "Law", pageTitle: "Week 2", status: "connected", version: "0.2.0", buildCommit: "abc1234def567890abc1234def567890abc1234d" });
  assert.match(markup, />Pilot v0\.2\.0</);

  const window = new Window(); const document = window.document as unknown as Document;
  mountReviewOverlay(document, context, "connected", {}, { version: "0.2.0", buildCommit: "abc1234def567890abc1234def567890abc1234d" });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const version = shadow.querySelector<HTMLElement>("[data-pilot-version]")!;
  assert.equal(version.getAttribute("role"), "note");
  assert.equal(version.getAttribute("aria-label"), "Pilot version 0.2.0");
  shadow.querySelector<HTMLElement>('[data-action="panel"]')!.click();
  const diagnostic = shadow.querySelector<HTMLElement>("[data-build-diagnostic]")!;
  assert.equal(diagnostic.textContent, "Version 0.2.0 · build abc1234");
  assert.equal(diagnostic.tabIndex, 0);
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
  assert.equal(host.style.fontSize, "14px");
  assert.equal(host.style.lineHeight, "1.4");
  assert.equal(host.style.color, "#000");
});

test("0.3 visual treatment clearly separates the tool with teal and UCO accents", () => {
  assert.match(tealOverlayOverrides, /--review-teal:#0f4c5c/);
  assert.match(tealOverlayOverrides, /--review-pale:#f3f7f8/);
  assert.match(tealOverlayOverrides, /border:4px solid var\(--review-teal\)/);
  assert.match(overlayStyles, /--review-red:#d73b3d/);
});

test("connected status stays textual with a decorative green indicator", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  mountReviewOverlay(document, context, "connected");
  const status = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!.querySelector<HTMLElement>("[data-auth-status]")!;
  assert.match(status.textContent!, /Connection:\s*Connected/);
  assert.equal(status.querySelector(".dot")?.getAttribute("aria-hidden"), "true");
  assert.match(overlayStyles, /\.connected \.dot\{background:#16833b\}/);
});

test("signed-out, pending, and offline states expose deterministic accessible controls", () => {
  for (const [status, label, action] of [
    ["signed-out", "Signed out", "Sign in"],
    ["pending", "Account awaiting approval", "Retry"],
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
  assert.equal(shadow.activeElement, shadow.querySelector('[data-action="highlight"]'));
  assert.match(shadow.querySelector('[aria-live="polite"]')!.textContent!, /Connected/);
});

test("course access form supports new and existing reviewers without listing identities", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const submitted: any[] = [];
  mountReviewOverlay(document, context, "signed-out", { onAccessSubmit: async (input) => { submitted.push(input); return { status: "connected", reconnectCode: "AAAAA-BBBBB-CCCCC-DDDDD" }; } });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  shadow.querySelector<HTMLElement>('[data-action="authenticate"]')!.click();
  const form = shadow.querySelector<HTMLFormElement>("[data-access-form]")!;
  assert.ok(form);
  assert.equal(form.textContent?.includes("New reviewer"), true);
  assert.equal(form.textContent?.includes("Existing reviewer"), true);
  assert.equal(shadow.querySelectorAll("[data-reviewer-name]").length, 0);
  assert.ok(form.querySelector('[name="displayName"]'));
  assert.ok(form.querySelector('[name="email"]'));
  assert.ok(form.querySelector('[name="role"]'));
  assert.ok(form.querySelector('[name="code"]'));
  shadow.querySelector<HTMLElement>('[data-mode="existing"]')!.click();
  assert.equal(shadow.querySelector<HTMLElement>("[data-code-label]")!.textContent, "Personal reconnect code");
  assert.equal(submitted.length, 0);
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
