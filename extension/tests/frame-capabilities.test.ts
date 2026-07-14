import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { measureChildOwnerFrame, measureFrameCapabilities } from "../src/frame-capabilities.ts";

const sized = (window: Window, width = 1000, height = 800) => {
  Object.defineProperty(window.document.documentElement, "getBoundingClientRect", { value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON() {} }) });
};

test("detects a content-bearing document", () => {
  const window = new Window({ url: "https://rise.example/lesson" });
  sized(window);
  window.document.body.innerHTML = "<main><h1>Lesson</h1><p>This is meaningful course content for a reviewer.</p><button>Continue</button></main>";
  assert.deepEqual(measureFrameCapabilities(window.document as unknown as Document, window as unknown as globalThis.Window), {
    contentBearing: true, wrapper: false, visible: true, area: 800_000,
  });
});

test("classifies an iframe-only document as a wrapper", () => {
  const window = new Window({ url: "https://moodle.example/wrapper" });
  sized(window);
  window.document.body.innerHTML = '<iframe src="https://rise.example/lesson"></iframe>';
  assert.equal(measureFrameCapabilities(window.document as unknown as Document, window as unknown as globalThis.Window).wrapper, true);
});

test("ignores review overlay content", () => {
  const window = new Window({ url: "https://moodle.example/empty" });
  sized(window);
  window.document.body.innerHTML = '<div id="moodle-course-review-overlay"><button>Add comment marker</button><p>Lots of review interface text</p></div>';
  assert.equal(measureFrameCapabilities(window.document as unknown as Document, window as unknown as globalThis.Window).contentBearing, false);
});

test("measures content without cloning course web components", () => {
  const window = new Window({ url: "https://rise.example/lesson" });
  sized(window);
  let constructed = 0;
  class CourseComponent extends window.HTMLElement {
    constructor() { super(); constructed += 1; }
  }
  window.customElements.define("course-component", CourseComponent);
  window.document.body.innerHTML = "<course-component>This is meaningful course content for a reviewer.</course-component>";
  const beforeMeasurement = constructed;

  assert.equal(measureFrameCapabilities(window.document as unknown as Document, window as unknown as globalThis.Window).contentBearing, true);
  assert.equal(constructed, beforeMeasurement);
});

test("rejects a small or hidden document", () => {
  const window = new Window({ url: "https://rise.example/lesson" });
  sized(window, 150, 100);
  window.document.body.innerHTML = "<main><h1>Lesson</h1><p>Course content exists here.</p></main>";
  assert.equal(measureFrameCapabilities(window.document as unknown as Document, window as unknown as globalThis.Window).visible, false);
});

test("reports immediate iframe origin and visibility", () => {
  const window = new Window({ url: "https://moodle.example/wrapper" });
  const iframe = window.document.createElement("iframe");
  iframe.src = "https://rise.example/lesson";
  Object.defineProperty(iframe, "getBoundingClientRect", { value: () => ({ width: 900, height: 700, top: 10, left: 10, right: 910, bottom: 710, x: 10, y: 10, toJSON() {} }) });
  window.document.body.append(iframe);
  assert.deepEqual(measureChildOwnerFrame(iframe as unknown as HTMLIFrameElement, 7), {
    childFrameId: 7, visible: true, area: 630_000, origin: "https://rise.example",
  });
});
