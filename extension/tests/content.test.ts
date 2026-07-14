import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { bootstrapContentScript, countInaccessibleFrames, createLifecycleController, isConfiguredFrame, refreshCourseBindingBeforeComment, sendRuntimeMessage, startCourseReview, startEmbeddedReview } from "../src/content.ts";

test("invalidated extension contexts fail quietly instead of throwing from a stale page timer", () => {
  let response: unknown;
  const sent = sendRuntimeMessage({ sendMessage: () => { throw new Error("Extension context invalidated."); } }, { type: "HEARTBEAT" }, (value) => { response = value; });
  assert.equal(sent, false);
  assert.deepEqual(response, { ok: false, status: "offline", error: "Extension context invalidated" });
});

test("comment submission refreshes the trusted course binding after a worker restart", async () => {
  const messages: unknown[] = [];
  await refreshCourseBindingBeforeComment(async (message) => {
    messages.push(message);
    return { id: "course-1" };
  }, { course_url: "https://moodle.example.invalid/course/view.php?id=7", title: "Law", moodle_course_id: 7 }, "course-1");
  assert.deepEqual(messages, [{ type: "RESOLVE_COURSE", payload: { course_url: "https://moodle.example.invalid/course/view.php?id=7", title: "Law", moodle_course_id: 7 } }]);
  await assert.rejects(() => refreshCourseBindingBeforeComment(async () => ({ id: "course-2" }), { course_url: "https://moodle.example.invalid/course/view.php?id=7", title: "Law" }, "course-1"), /connection changed/);
});

test("content activates on configured Moodle patterns", () => {
  assert.equal(isConfiguredFrame("https://moodle.example.invalid/course/view.php?id=1", ["https://moodle.example.invalid/*"], []), true);
  assert.equal(isConfiguredFrame("https://unrelated.example/course/view.php?id=1", ["https://moodle.example.invalid/*"], []), false);
});

test("authorised Moodle descendants activate when Rise uses an about:blank child frame", () => {
  assert.equal(isConfiguredFrame("about:blank", ["https://moodle.example.invalid/*"], [], () => false, "https://moodle.example.invalid/pluginfile.php/1/index.html"), true);
  assert.equal(isConfiguredFrame("about:blank", ["https://moodle.example.invalid/*"], [], () => false, "https://unrelated.example/activity"), false);
  assert.equal(isConfiguredFrame("blob:https://moodle.example.invalid/lesson-id", ["https://moodle.example.invalid/*"], []), true);
});

test("lifecycle teardown restores history and permits a clean restart without duplicate listeners", () => {
  const window = new Window({ url: "https://moodle.example.invalid/course/view.php?id=1" });
  const originalPush = window.history.pushState;
  let refreshes = 0;
  const first = createLifecycleController(window as unknown as globalThis.Window & typeof globalThis, window.document as unknown as Document, () => { refreshes += 1; }, 0);
  assert.notEqual(window.history.pushState, originalPush);
  first.teardown();
  assert.equal(window.history.pushState, originalPush);
  const second = createLifecycleController(window as unknown as globalThis.Window & typeof globalThis, window.document as unknown as Document, () => { refreshes += 1; }, 0);
  window.dispatchEvent(new window.Event("popstate"));
  second.flush();
  assert.equal(refreshes, 1);
  second.teardown();
});

test("Chrome wildcard host patterns match the root host and subdomains", () => {
  const patterns = ["https://*.example.com/*"];
  assert.equal(isConfiguredFrame("https://example.com/course", patterns, []), true);
  assert.equal(isConfiguredFrame("https://learn.example.com/course", patterns, []), true);
  assert.equal(isConfiguredFrame("https://notexample.com/course", patterns, []), false);
});

test("content activates in an optional frame only when host permission is granted", () => {
  const optional = ["https://rise.example.invalid/*"];
  assert.equal(isConfiguredFrame("https://rise.example.invalid/scorm/index.html", [], optional, () => true), true);
  assert.equal(isConfiguredFrame("https://rise.example.invalid/scorm/index.html", [], optional, () => false), false);
});

test("real bootstrap replaces its owned instance and recovers from a stale marker", async () => {
  const markers = new Set<string>();
  const root = {
    hasAttribute: (name: string) => markers.has(name),
    setAttribute: (name: string) => { markers.add(name); },
    removeAttribute: (name: string) => { markers.delete(name); },
  };
  const documentLike = {
    documentElement: root,
  };
  let injections = 0;
  let cleanups = 0;
  const options = {
    url: "https://moodle.example.invalid/course/view.php?id=1",
    document: documentLike,
    moodlePatterns: ["https://moodle.example.invalid/*"],
    optionalFramePatterns: [],
    inject: () => { injections += 1; return () => { cleanups += 1; }; },
  };

  assert.equal(await bootstrapContentScript(options), true);
  assert.equal(await bootstrapContentScript(options), true);
  assert.equal(injections, 2);
  assert.equal(cleanups, 1);
  assert.equal(markers.has("data-moodle-review-extension"), true);

  for (const symbol of Object.getOwnPropertySymbols(root)) delete (root as Record<symbol, unknown>)[symbol];
  assert.equal(await bootstrapContentScript(options), true);
  assert.equal(injections, 3);
  assert.equal(markers.has("data-moodle-review-extension"), true);
});

test("bootstrap wired to the real start entry tears down the old overlay instance", async () => {
  const window = new Window({ url: "https://moodle.example.invalid/course/view.php?id=1" });
  window.document.body.innerHTML = "<h1>Law</h1>";
  let messages = 0;
  const runtime = { sendMessage: (_message: unknown, callback: (response: { ok: boolean }) => void) => { messages += 1; callback({ ok: true }); } };
  const options = {
    url: window.location.href,
    document: window.document as unknown as Document,
    moodlePatterns: ["https://moodle.example.invalid/*"],
    optionalFramePatterns: [] as string[],
    inject: () => startCourseReview(window as unknown as globalThis.Window & typeof globalThis, window.document as unknown as Document, runtime),
  };

  await bootstrapContentScript(options);
  const firstHistoryPatch = window.history.pushState;
  await bootstrapContentScript(options);

  assert.equal(window.document.querySelectorAll("#moodle-course-review-overlay").length, 1);
  assert.notEqual(window.history.pushState, firstHistoryPatch);
  assert.equal(messages, 2);
});

test("real content-script startup does not require chrome.permissions", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalChrome = (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  const originalMoodle = (globalThis as typeof globalThis & { __MOODLE_PATTERNS__?: string[] }).__MOODLE_PATTERNS__;
  const originalOptional = (globalThis as typeof globalThis & { __OPTIONAL_FRAME_PATTERNS__?: string[] }).__OPTIONAL_FRAME_PATTERNS__;
  const markers = new Set<string>();
  let bootstraps = 0;
  try {
    Object.assign(globalThis, {
      window: { location: { href: "https://moodle.example.invalid/course/view.php?id=1" } },
      document: {
        documentElement: {
          hasAttribute: (name: string) => markers.has(name),
          setAttribute: (name: string) => { markers.add(name); },
          dispatchEvent: () => { bootstraps += 1; },
        },
      },
      chrome: { runtime: { sendMessage: (_message: unknown, callback: (response: unknown) => void) => callback({ ok: false, error: "Review context unavailable" }) } },
      __MOODLE_PATTERNS__: ["https://moodle.example.invalid/*"],
      __OPTIONAL_FRAME_PATTERNS__: ["https://rise.example.invalid/*"],
    });
    await import(`../src/content.ts?startup=${Date.now()}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(bootstraps, 1);
  } finally {
    Object.assign(globalThis, {
      window: originalWindow,
      document: originalDocument,
      chrome: originalChrome,
      __MOODLE_PATTERNS__: originalMoodle,
      __OPTIONAL_FRAME_PATTERNS__: originalOptional,
    });
  }
});

test("embedded review stays dormant until the coordinator activates it", async () => {
  const window = new Window({ url: "https://rise.example/activity#/lesson/1" });
  const parent = { postMessage: () => undefined };
  Object.defineProperty(window, "top", { value: parent }); Object.defineProperty(window, "parent", { value: parent });
  window.document.title = "Lesson 1"; window.document.body.innerHTML = "<main><h1>Lesson 1</h1><p>Meaningful Rise lesson content for review.</p></main>";
  let listener: ((message: any, sender: unknown, respond: (response: unknown) => void) => void) | undefined;
  let workerInstanceId = "";
  const runtime = {
    onMessage: { addListener: (candidate: typeof listener) => { listener = candidate; }, removeListener: (candidate: typeof listener) => { if (listener === candidate) listener = undefined; } },
    sendMessage: (message: any, callback: (response: any) => void) => {
      if (message.type === "GET_REVIEW_CONTEXT") callback({ ok: true, data: { course_id: "123e4567-e89b-12d3-a456-426614174000", course_title: "Law", parent_activity_url: "https://learn.example/mod/scorm/player.php?cmid=22" } });
      else { if (message.type === "REGISTER_REVIEW_FRAME") workerInstanceId = message.worker_instance_id; callback({ ok: true, data: {} }); }
    },
  };
  const cleanup = startEmbeddedReview(window as any, window.document as any, runtime as any);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.document.querySelector("#moodle-course-review-overlay"), null);
  listener!({ type: "ACTIVATE_REVIEW_FRAME", worker_instance_id: "223e4567-e89b-42d3-a456-426614174000", generation: 1 }, {}, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.document.querySelector("#moodle-course-review-overlay"), null);
  let activationResponse: unknown;
  listener!({ type: "ACTIVATE_REVIEW_FRAME", worker_instance_id: workerInstanceId, generation: 1 }, {}, (response) => { activationResponse = response; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(activationResponse, { ok: true, worker_instance_id: workerInstanceId, generation: 1 });
  const activeHost = window.document.querySelector("#moodle-course-review-overlay") as unknown as HTMLElement;
  assert.ok(activeHost);
  assert.notEqual(activeHost.style.getPropertyValue("display"), "none", "the elected Rise frame must own a visible controller even without viewport bridge messages");
  let reconstructionResponse: unknown;
  listener!({ type: "ACTIVATE_REVIEW_FRAME", worker_instance_id: workerInstanceId, generation: 0 }, {}, (response) => { reconstructionResponse = response; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(reconstructionResponse, { ok: true, worker_instance_id: workerInstanceId, generation: 0 });
  cleanup();
});

test("embedded review re-registers after a background worker restart interval", async () => {
  const window = new Window({ url: "https://rise.example/activity#/lesson/1" });
  window.document.body.innerHTML = "<main><h1>Lesson</h1><p>Meaningful Rise lesson content for review.</p></main>";
  let contextRequests = 0; const registrations: any[] = [];
  const runtime = {
    onMessage: { addListener: () => undefined, removeListener: () => undefined },
    sendMessage: (message: any, callback: (response: any) => void) => {
      if (message.type === "GET_REVIEW_CONTEXT") { contextRequests += 1; callback({ ok: true, data: { course_id: "123e4567-e89b-12d3-a456-426614174000", course_title: "Law", parent_activity_url: "https://learn.example/mod/scorm/player.php?cmid=22" } }); }
      else { if (message.type === "REGISTER_REVIEW_FRAME") registrations.push(message); callback({ ok: true, data: {} }); }
    },
  };
  const cleanup = startEmbeddedReview(window as any, window.document as any, runtime as any, 0, 5);
  await new Promise((resolve) => setTimeout(resolve, 18));
  assert.ok(contextRequests >= 2);
  assert.ok(registrations.length >= 2);
  assert.match(registrations[0].worker_instance_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(new Set(registrations.map((message) => message.worker_instance_id)).size, 1);
  cleanup();
  const stoppedAt = contextRequests;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(contextRequests, stoppedAt);
});

test("embedded review obtains trusted course context and updates its hash page identity", async () => {
  const window = new Window({ url: "https://rise.example/activity#/lesson/1" });
  window.document.title = "Lesson 1"; window.document.body.innerHTML = "<p>Review phrase</p>";
  const messages: unknown[] = [];
  const runtime = { sendMessage: (message: unknown, callback: (response: any) => void) => {
    messages.push(message);
    if ((message as any).type === "GET_REVIEW_CONTEXT") callback({ ok: true, data: { course_id: "123e4567-e89b-12d3-a456-426614174000", course_title: "Law", parent_activity_url: "https://learn.example/mod/scorm/player.php?cmid=22" } });
    else callback({ ok: true, data: {} });
  } };
  const cleanup = startEmbeddedReview(window as unknown as globalThis.Window & typeof globalThis, window.document as unknown as Document, runtime);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const host = window.document.querySelector("#moodle-course-review-overlay") as unknown as HTMLElement;
  assert.match(host.shadowRoot!.querySelector(".course")!.textContent!, /^Law$/);
  assert.match(host.shadowRoot!.textContent!, /Embedded activity · Lesson 1/);
  window.location.hash = "/lesson/2"; window.document.title = "Lesson 2"; window.dispatchEvent(new window.Event("hashchange"));
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.match(host.shadowRoot!.textContent!, /Embedded activity · Lesson 2/);
  assert.ok(messages.some((message: any) => message.type === "REVIEW_FRAME_READY"));
  cleanup();
});

test("embedded review loads the course comment list for its Comments panel", async () => {
  const window = new Window({ url: "https://rise.example/activity#/lesson/1" });
  window.document.title = "Lesson 1"; window.document.body.innerHTML = "<p>Rise content</p>";
  const comment = { id: "00000000-0000-4000-8000-000000000001", body: "Course feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: "https://rise.example/activity#moodle-review-page=Lesson%201", page_title: "Embedded activity · Lesson 1", anchor_type: "visual_pin", selected_quote: null, prefix: null, suffix: null, css_selector: "p", dom_selector: null, relative_x: 0.5, relative_y: 0.5, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } };
  const messages: unknown[] = [];
  const runtime = { sendMessage: (message: any, callback: (response: any) => void) => {
    messages.push(message);
    if (message.type === "GET_REVIEW_CONTEXT") callback({ ok: true, data: { course_id: "123e4567-e89b-12d3-a456-426614174000", course_title: "Law", parent_activity_url: "https://learn.example/mod/scorm/player.php?cmid=22" } });
    else if (message.type === "LIST_COURSE_COMMENTS") callback({ ok: true, data: [comment] });
    else callback({ ok: true, data: {} });
  } };
  const cleanup = startEmbeddedReview(window as any, window.document as any, runtime);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const shadow = window.document.querySelector("#moodle-course-review-overlay")!.shadowRoot!;
  assert.equal(shadow.querySelector("[data-comment-count]")!.textContent, "1");
  assert.ok(messages.some((message: any) => message.type === "LIST_COURSE_COMMENTS"));
  cleanup();
});

test("embedded review retries while the top frame is still resolving", async () => {
  const window = new Window({ url: "https://moodle.example.invalid/embedded" });
  let attempts = 0;
  const runtime = { sendMessage: (message: any, callback: (response: any) => void) => {
    if (message.type === "GET_REVIEW_CONTEXT") { attempts += 1; callback(attempts === 1 ? { ok: false, error: "Review context unavailable" } : { ok: true, data: { course_id: "123e4567-e89b-12d3-a456-426614174000", course_title: "Law", parent_activity_url: "https://moodle.example/mod/scorm/player.php?cmid=22" } }); return; }
    callback({ ok: true, data: {} });
  } };
  const cleanup = startEmbeddedReview(window as unknown as globalThis.Window & typeof globalThis, window.document as unknown as Document, runtime, 0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(attempts, 3);
  assert.ok(window.document.querySelector("#moodle-course-review-overlay"));
  cleanup();
});

test("top navigation immediately removes stored markers before delayed responses return", async () => {
  const window = new Window({ url: "https://moodle.example.invalid/mod/page/view.php?id=1" });
  window.document.body.innerHTML = "<h1>Page one</h1><p>An important phrase here</p>";
  const lists: Array<(response: any) => void> = [];
  const comment = { id: "00000000-0000-4000-8000-000000000001", body: "Stored feedback", category: "general", status: "open", author: { display_name: "beta@example.test", role: "beta_tester" }, page_url: window.location.href, page_title: "Page one", anchor_type: "text_highlight", selected_quote: "important phrase", prefix: "An ", suffix: " here", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [] };
  const runtime = { sendMessage: (message: any, callback: (response: any) => void) => {
    if (message.type === "RESOLVE_COURSE") callback({ ok: true, data: { id: "123e4567-e89b-12d3-a456-426614174000" } });
    else if (message.type === "LIST_COURSE_COMMENTS") lists.push(callback);
    else callback({ ok: true, data: {} });
  } };
  const cleanup = startCourseReview(window as unknown as globalThis.Window & typeof globalThis, window.document as unknown as Document, runtime);
  await new Promise((resolve) => setTimeout(resolve, 0)); lists[0]!({ ok: true, data: [comment] }); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(window.document.querySelector("[data-moodle-review-stored-highlight]"));
  window.history.pushState({}, "", "/mod/page/view.php?id=2");
  assert.equal(window.document.querySelector("[data-moodle-review-stored-highlight]"), null);
  lists[0]!({ ok: true, data: [comment] }); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.document.querySelector("[data-moodle-review-stored-highlight]"), null);
  cleanup();
});

test("sign in sends one authenticate per activation and refreshes course and comments without reload", async () => {
  const window = new Window({ url: "https://moodle.example.invalid/course/view.php?id=1" });
  window.document.body.innerHTML = "<h1>Law</h1>";
  const messages: any[] = [];
  let signedIn = false;
  const runtime = { sendMessage: (message: any, callback: (response: any) => void) => {
    messages.push(message);
    if (message.type === "RESOLVE_COURSE") callback(signedIn ? { ok: true, data: { id: "123e4567-e89b-12d3-a456-426614174000" } } : { ok: false, status: "signed-out", error: "Signed out" });
    else if (message.type === "AUTHENTICATE") { signedIn = true; callback({ ok: true, data: {} }); }
    else if (message.type === "LIST_COURSE_COMMENTS") callback({ ok: true, data: [] });
    else callback({ ok: true, data: {} });
  } };
  const cleanup = startCourseReview(window as unknown as globalThis.Window & typeof globalThis, window.document as unknown as Document, runtime);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const shadow = window.document.querySelector("#moodle-course-review-overlay")!.shadowRoot!;
  const signIn = shadow.querySelector('[data-action="authenticate"]') as unknown as HTMLElement;
  signIn.click();
  signIn.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(messages.filter((message) => message.type === "AUTHENTICATE").length, 1);
  assert.equal(messages.filter((message) => message.type === "RESOLVE_COURSE").length, 2);
  assert.equal(messages.filter((message) => message.type === "LIST_COURSE_COMMENTS").length, 1);
  assert.match(shadow.textContent!, /Connected/);
  cleanup();
});

test("pending course access is checked automatically and connects without another code", async () => {
  const window = new Window({ url: "https://my.uconline.ac.nz/course/view.php?id=896" });
  window.document.title = "CRJU150";
  let approved = false; let checks = 0;
  const runtime = { sendMessage(message: any, callback: any) {
    if (message.type === "RESOLVE_COURSE") callback(approved ? { ok: true, data: { id: "123e4567-e89b-12d3-a456-426614174000" } } : { ok: false, status: "signed-out", error: "Signed out" });
    else if (message.type === "LOOKUP_REVIEW_COURSE") callback({ ok: true, data: { course_handle: "123e4567-e89b-12d3-a456-426614174000", title: "CRJU150" } });
    else if (message.type === "CHECK_PENDING_REVIEW_ACCESS") { checks += 1; callback({ ok: true, data: { state: approved ? "connected" : "pending" } }); }
    else callback({ ok: true, data: [] });
  } };
  const cleanup = startCourseReview(window as any, window.document as any, runtime);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const shadow = window.document.querySelector("#moodle-course-review-overlay")!.shadowRoot!;
  assert.equal(checks, 1);
  assert.match(shadow.querySelector("[data-status-message]")!.textContent!, /Waiting for approval/);
  approved = true;
  (shadow.querySelector('[data-action="authenticate"]') as unknown as HTMLElement).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(checks, 2);
  assert.match(shadow.querySelector("[data-status-message]")!.textContent!, /Connected/);
  cleanup();
});

test("authentication maps cancellation, failure, pending, offline, and session expiry exactly", async () => {
  const cases = [
    [{ ok: false, status: "cancelled", error: "Authentication was cancelled" }, "Sign-in cancelled"],
    [{ ok: false, status: "failed", error: "Token exchange failed (500)" }, "Sign-in failed—try again"],
    [{ ok: false, status: "pending", error: "Account pending approval" }, "Waiting for approval — you can leave this page open or return later."],
    [{ ok: false, status: "offline", error: "Network down" }, "Service unavailable—retry"],
  ] as const;
  for (const [authResponse, expected] of cases) {
    const window = new Window({ url: "https://moodle.example.invalid/course/view.php?id=1" }); window.document.body.innerHTML = "<h1>Law</h1>";
    const runtime = { sendMessage: (message: any, callback: (response: any) => void) => callback(message.type === "AUTHENTICATE" ? authResponse : { ok: false, status: "signed-out", error: "Signed out" }) };
    const cleanup = startCourseReview(window as any, window.document as any, runtime); await new Promise((resolve) => setTimeout(resolve, 0));
    const shadow = window.document.querySelector("#moodle-course-review-overlay")!.shadowRoot!; (shadow.querySelector('[data-action="authenticate"]') as unknown as HTMLElement).click(); await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(shadow.querySelector("[data-status-message]")?.textContent, expected); cleanup();
  }
  for (const [response, expected] of [[{ ok: false, status: "pending", error: "Account pending approval" }, "Waiting for approval — you can leave this page open or return later."], [{ ok: false, status: "offline", error: "Network down" }, "Service unavailable—retry"], [{ ok: false, status: "signed-out", error: "Signed out: session expired" }, "Session expired—sign in again"]] as const) {
    const window = new Window({ url: "https://moodle.example.invalid/course/view.php?id=1" }); window.document.body.innerHTML = "<h1>Law</h1>";
    const cleanup = startCourseReview(window as any, window.document as any, { sendMessage: (_message: any, callback: any) => callback(response) }); await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(window.document.querySelector("#moodle-course-review-overlay")!.shadowRoot!.querySelector("[data-status-message]")?.textContent, expected); cleanup();
  }
});

test("counts only inaccessible iframe DOMs", () => {
  const window = new Window();
  window.document.body.innerHTML = "<iframe id=accessible></iframe><iframe id=blocked></iframe>";
  const accessible = window.document.querySelector("#accessible")!;
  const blocked = window.document.querySelector("#blocked")!;
  Object.defineProperty(accessible, "contentDocument", { value: window.document });
  Object.defineProperty(blocked, "contentDocument", { value: null });
  assert.equal(countInaccessibleFrames(window.document as unknown as Document), 1);
});

test("mixed ready and inaccessible frames keep a passive embedded activity notice", async () => {
  const window = new Window({ url: "https://moodle.example.invalid/course/view.php?id=1" });
  window.document.title = "Week 2";
  window.document.body.innerHTML = "<h1>Week 2</h1><iframe id=accessible></iframe><iframe id=blocked></iframe>";
  Object.defineProperty(window.document.querySelector("#accessible")!, "contentDocument", { value: window.document });
  Object.defineProperty(window.document.querySelector("#blocked")!, "contentDocument", { value: null });
  const messages: any[] = [];
  const runtime = { sendMessage: (message: any, callback: (response: any) => void) => {
    messages.push(message);
    if (message.type === "RESOLVE_COURSE") callback({ ok: true, data: { id: "123e4567-e89b-12d3-a456-426614174000" } });
    else if (message.type === "GET_REVIEW_FRAME_STATUS") callback({ ok: true, data: { ready_count: 1 } });
    else callback({ ok: true, data: {} });
  } };
  const cleanup = startCourseReview(window as unknown as globalThis.Window & typeof globalThis, window.document as unknown as Document, runtime);
  await new Promise((resolve) => setTimeout(resolve, 280));
  const shadow = window.document.querySelector("#moodle-course-review-overlay")!.shadowRoot! as unknown as ShadowRoot;
  assert.doesNotMatch(shadow.textContent!, /Embedded activity detected/);
  assert.doesNotMatch(shadow.textContent!, /Place parent-page pin/);
  cleanup();
});

test("ready embedded activity hides the duplicate parent overlay", async () => {
  const window = new Window({ url: "https://moodle.example.invalid/mod/scorm/player.php?id=22" });
  window.document.body.innerHTML = '<h1>SCORM activity</h1><iframe id="rise" src="https://rise.example.invalid/activity"></iframe>';
  Object.defineProperty(window.document.querySelector("#rise")!, "contentDocument", { value: null });
  const runtime = { sendMessage: (message: any, callback: (response: any) => void) => {
    if (message.type === "RESOLVE_COURSE") callback({ ok: true, data: { id: "123e4567-e89b-12d3-a456-426614174000" } });
    else if (message.type === "GET_REVIEW_FRAME_STATUS") callback({ ok: true, data: { ready_origins: ["https://rise.example.invalid"] } });
    else callback({ ok: true, data: {} });
  } };
  const cleanup = startCourseReview(window as any, window.document as any, runtime);
  await new Promise((resolve) => setTimeout(resolve, 280));
  assert.equal((window.document.querySelector("#moodle-course-review-overlay") as unknown as HTMLElement).hidden, true);
  cleanup();
});

test("active embedded activity hides the parent overlay even through an accessible SCORM wrapper", async () => {
  const window = new Window({ url: "https://moodle.example.invalid/mod/scorm/player.php?id=22" });
  const wrapper = new Window({ url: "https://moodle.example.invalid/mod/scorm/content" });
  window.document.body.innerHTML = '<h1>SCORM activity</h1><iframe id="wrapper"></iframe>';
  Object.defineProperty(window.document.querySelector("#wrapper")!, "contentDocument", { value: wrapper.document });
  const runtime = { sendMessage: (message: any, callback: (response: any) => void) => {
    if (message.type === "RESOLVE_COURSE") callback({ ok: true, data: { id: "123e4567-e89b-12d3-a456-426614174000" } });
    else if (message.type === "GET_REVIEW_FRAME_STATUS") callback({ ok: true, data: { active_embedded_count: 1 } });
    else callback({ ok: true, data: {} });
  } };
  const cleanup = startCourseReview(window as any, window.document as any, runtime);
  await new Promise((resolve) => setTimeout(resolve, 280));
  assert.equal((window.document.querySelector("#moodle-course-review-overlay") as unknown as HTMLElement).hidden, true);
  cleanup();
});

test("late SCORM ownership still hides the duplicate Moodle controller", async () => {
  const window = new Window({ url: "https://moodle.example.invalid/course/view.php?id=22" });
  const wrapper = new Window({ url: "https://moodle.example.invalid/mod/scorm/content" });
  window.document.body.innerHTML = '<h1>SCORM activity</h1><iframe id="wrapper"></iframe>';
  Object.defineProperty(window.document.querySelector("#wrapper")!, "contentDocument", { value: wrapper.document });
  let checks = 0;
  const runtime = { sendMessage: (message: any, callback: (response: any) => void) => {
    if (message.type === "RESOLVE_COURSE") callback({ ok: true, data: { id: "123e4567-e89b-12d3-a456-426614174000" } });
    else if (message.type === "GET_REVIEW_FRAME_STATUS") { checks += 1; callback({ ok: true, data: { active_embedded_count: checks >= 2 ? 1 : 0 } }); }
    else callback({ ok: true, data: {} });
  } };
  const cleanup = startCourseReview(window as any, window.document as any, runtime, undefined, 5);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(checks >= 2);
  assert.equal((window.document.querySelector("#moodle-course-review-overlay") as unknown as HTMLElement).style.getPropertyValue("display"), "none");
  cleanup();
});

test("an accessible descendant SCORM controller directly hides the Moodle controller", async () => {
  const window = new Window({ url: "https://moodle.example.invalid/mod/scorm/player.php?id=22" });
  const rise = new Window({ url: "https://moodle.example.invalid/pluginfile.php/rise/index.html" });
  rise.document.documentElement.innerHTML = '<body><main>Rise lesson content</main><div id="moodle-course-review-overlay"></div></body>';
  window.document.body.innerHTML = '<h1>SCORM activity</h1><iframe id="rise"></iframe>';
  Object.defineProperty(window.document.querySelector("#rise")!, "contentDocument", { value: rise.document });
  const runtime = { sendMessage: (message: any, callback: (response: any) => void) => {
    if (message.type === "RESOLVE_COURSE") callback({ ok: true, data: { id: "123e4567-e89b-12d3-a456-426614174000" } });
    else if (message.type === "GET_REVIEW_FRAME_STATUS") callback({ ok: true, data: { active_embedded_count: 0 } });
    else callback({ ok: true, data: {} });
  } };
  const cleanup = startCourseReview(window as any, window.document as any, runtime, undefined, 5);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal((window.document.querySelector("#moodle-course-review-overlay") as unknown as HTMLElement).style.getPropertyValue("display"), "none");
  cleanup();
});

test("the Moodle controller is always hidden on the dedicated SCORM player route", async () => {
  const window = new Window({ url: "https://moodle.example.invalid/mod/scorm/player.php" });
  window.document.body.innerHTML = '<h1>SCORM activity</h1><iframe id="rise"></iframe>';
  Object.defineProperty(window.document.querySelector("#rise")!, "contentDocument", { value: null });
  const runtime = { sendMessage: (message: any, callback: (response: any) => void) => {
    if (message.type === "RESOLVE_COURSE") callback({ ok: true, data: { id: "123e4567-e89b-12d3-a456-426614174000" } });
    else if (message.type === "GET_REVIEW_FRAME_STATUS") callback({ ok: true, data: { active_embedded_count: 0, ready_origins: [] } });
    else callback({ ok: true, data: {} });
  } };
  const cleanup = startCourseReview(window as any, window.document as any, runtime, undefined, 5);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal((window.document.querySelector("#moodle-course-review-overlay") as unknown as HTMLElement).style.getPropertyValue("display"), "none");
  cleanup();
});
