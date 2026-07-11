import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { mountReviewOverlay, OVERLAY_HOST_ID, overlayStyles } from "../src/overlay/root.ts";

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

test("UCO visual tokens provide deterministic WCAG AA contrast", () => {
  assert.match(overlayStyles, /--review-red:#d73b3d/);
  assert.match(overlayStyles, /font:14px\/1\.4 Poppins,Arial,sans-serif/);
  assert.ok(contrastRatio("#ffffff", "#000000") >= 4.5, "header text must meet AA");
  assert.ok(contrastRatio("#ffffff", "#d73b3d") >= 4.5, "primary action text must meet AA");
  assert.ok(contrastRatio("#000000", "#ffffff") >= 4.5, "panel text must meet AA");
  assert.ok(contrastRatio("#000000", "#f2f2f2") >= 4.5, "secondary control text must meet AA");
  assert.ok(contrastRatio("#000000", "#ffd54f") >= 3, "focus indicator must contrast with adjacent black");
  assert.ok(contrastRatio("#000000", "#ffffff") >= 3, "focus surround must contrast with adjacent white");
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
