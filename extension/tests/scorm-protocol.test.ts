import assert from "node:assert/strict";
import test from "node:test";
import {
  SCORM_ACK_TYPES,
  scormAckTypeFor,
  validateScormAck,
  validateScormAckFor,
  validateScormMessage,
} from "../src/scorm-protocol.ts";
import type { ScormCommand, ScormEvent } from "../src/scorm-protocol.ts";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const workerInstanceId = "123e4567-e89b-42d3-a456-426614174001";
const courseId = "123e4567-e89b-42d3-a456-426614174002";
const commentId = "123e4567-e89b-42d3-a456-426614174003";
const pageUrl = "https://rise.example/activity/index.html#/lessons/one";
const base = { protocol: 1, request_id: requestId, worker_instance_id: workerInstanceId, generation: 7, course_id: courseId, page_url: pageUrl } as const;

const comment = {
  id: commentId,
  body: "Clarify this section",
  category: "general",
  status: "open",
  author: { display_name: "Reviewer", role: "beta_tester" },
  page_url: pageUrl,
  page_title: "Embedded activity · Lesson one",
  parent_activity_url: null,
  embedded_locator: null,
  anchor_type: "text_highlight",
  selected_quote: "important phrase",
  prefix: "Before ",
  suffix: " after",
  css_selector: null,
  dom_selector: null,
  relative_x: null,
  relative_y: null,
  replies: [],
  status_history: [],
  capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false },
} as const;

const messages = [
  { ...base, type: "SCORM_SELECTION_CHANGED", payload: { has_selection: true } },
  { ...base, type: "SCORM_START_SELECTION", payload: {} },
  { ...base, type: "SCORM_START_MARKER", payload: {} },
  { ...base, type: "SCORM_CANCEL_MARKER", payload: {} },
  { ...base, type: "SCORM_ANCHOR_CAPTURED", payload: { page_title: "Embedded activity · Lesson one", embedded_locator: "#/lessons/one", anchor_type: "text_highlight", selected_quote: "important phrase", prefix: "Before ", suffix: " after" } },
  { ...base, type: "SCORM_ANCHOR_CAPTURED", payload: { page_title: "Embedded activity · Lesson one", embedded_locator: "/activity/index.html#/lessons/one", anchor_type: "visual_pin", css_selector: "[data-region=\"continue\"]", relative_x: 0, relative_y: 1 } },
  { ...base, type: "SCORM_PAGE_IDENTITY_CHANGED", payload: { page_title: "Embedded activity · Lesson one", embedded_locator: "#/lessons/one" } },
  { ...base, type: "SCORM_SET_COMMENTS", payload: { comments: [comment] } },
  { ...base, type: "SCORM_COMMENTS_CHANGED", payload: {} },
  { ...base, type: "SCORM_COMMENT_NAVIGATION_REQUESTED", payload: { comment_id: commentId, page_url: "https://rise.example/activity#moodle-review-page=Lesson%20two" } },
  { ...base, type: "SCORM_ACTIVATE_COVER", payload: {} },
  { ...base, type: "SCORM_APPLY_LOCATOR", payload: { embedded_locator: "#/lessons/two" } },
  { ...base, type: "SCORM_TAKE_TO_CONTEXT", payload: { comment_id: commentId } },
] as const;

test("exports separate command and event discriminator families", () => {
  const commands: Array<ScormCommand["type"]> = ["SCORM_START_SELECTION", "SCORM_START_MARKER", "SCORM_CANCEL_MARKER", "SCORM_SET_COMMENTS", "SCORM_ACTIVATE_COVER", "SCORM_APPLY_LOCATOR", "SCORM_TAKE_TO_CONTEXT"];
  const events: Array<ScormEvent["type"]> = ["SCORM_SELECTION_CHANGED", "SCORM_ANCHOR_CAPTURED", "SCORM_PAGE_IDENTITY_CHANGED", "SCORM_COMMENTS_CHANGED", "SCORM_COMMENT_NAVIGATION_REQUESTED"];
  assert.deepEqual([...commands, ...events].sort(), [...new Set(messages.map(({ type }) => type))].sort());
});

test("accepts every exact post-election SCORM message family", () => {
  for (const message of messages) assert.deepEqual(validateScormMessage(message), message);
});

test("does not fold pre-election registration into the generation-bound protocol", () => {
  assert.throws(() => validateScormMessage({ ...base, type: "REGISTER_REVIEW_FRAME", payload: {} }), /Invalid SCORM message/);
});

test("rejects extra envelope, client tab/frame, and payload keys", () => {
  for (const message of messages) {
    assert.throws(() => validateScormMessage({ ...message, extra: true }), /Invalid SCORM message/);
    assert.throws(() => validateScormMessage({ ...message, tabId: 8 }), /Invalid SCORM message/);
    assert.throws(() => validateScormMessage({ ...message, frameId: 3 }), /Invalid SCORM message/);
    assert.throws(() => validateScormMessage({ ...message, payload: { ...message.payload, extra: true } }), /Invalid SCORM message/);
  }
});

test("rejects malformed common envelope fields", () => {
  const message = messages[0];
  for (const invalid of [
    { ...message, protocol: 2 },
    { ...message, protocol: "1" },
    { ...message, request_id: "not-a-uuid" },
    { ...message, worker_instance_id: "00000000-0000-0000-0000-000000000000" },
    { ...message, course_id: "123e4567-e89b-62d3-a456-426614174002" },
    { ...message, generation: -1 },
    { ...message, generation: 1.5 },
    { ...message, generation: Number.MAX_SAFE_INTEGER + 1 },
    { ...message, page_url: "/relative" },
    { ...message, page_url: "javascript:alert(1)" },
    { ...message, page_url: "ftp://rise.example/file" },
    { ...message, page_url: "https://user:pass@rise.example/activity" },
    { ...message, page_url: "https://rise.example" },
    { ...message, page_url: `https://rise.example/${"a".repeat(4096)}` },
  ]) assert.throws(() => validateScormMessage(invalid), /Invalid SCORM message/);
});

test("validates selection, empty command, identity, and locator payload bounds", () => {
  const selection = messages[0];
  assert.throws(() => validateScormMessage({ ...selection, payload: { has_selection: "yes" } }), /Invalid SCORM message/);
  for (const message of [messages[1], messages[2], messages[3], messages[8]]) {
    assert.throws(() => validateScormMessage({ ...message, payload: [] }), /Invalid SCORM message/);
  }
  const identity = messages[6];
  for (const payload of [
    { page_title: "", embedded_locator: "#/lessons/one" },
    { page_title: `x${"a".repeat(512)}`, embedded_locator: "#/lessons/one" },
    { page_title: " Lesson ", embedded_locator: "#/lessons/one" },
    { page_title: "Lesson\nOne", embedded_locator: "#/lessons/one" },
    { page_title: "Lesson", embedded_locator: "javascript:alert(1)" },
    { page_title: "Lesson", embedded_locator: "//evil.example/lesson" },
    { page_title: "Lesson", embedded_locator: `#${"a".repeat(2048)}` },
  ]) assert.throws(() => validateScormMessage({ ...identity, payload }), /Invalid SCORM message/);
  const apply = messages[9];
  assert.throws(() => validateScormMessage({ ...apply, payload: { embedded_locator: "relative/lesson" } }), /Invalid SCORM message/);
});

test("validates both anchor variants exactly and within existing anchor bounds", () => {
  const anchor = messages[4];
  for (const payload of [
    { ...anchor.payload, anchor_type: "unknown" },
    { ...anchor.payload, selected_quote: "" },
    { ...anchor.payload, selected_quote: "q".repeat(20_001) },
    { ...anchor.payload, prefix: "p".repeat(2_001) },
    { ...anchor.payload, suffix: 3 },
    { ...anchor.payload, css_selector: "#mixed" },
  ]) assert.throws(() => validateScormMessage({ ...anchor, payload }), /Invalid SCORM message/);

  const pin = messages[5];
  for (const payload of [
    { ...pin.payload, css_selector: "" },
    { ...pin.payload, css_selector: "x".repeat(4_001) },
    { ...pin.payload, relative_x: -0.01 },
    { ...pin.payload, relative_y: 1.01 },
    { ...pin.payload, relative_x: Number.NaN },
    { ...pin.payload, selected_quote: "mixed" },
  ]) assert.throws(() => validateScormMessage({ ...pin, payload }), /Invalid SCORM message/);
});

test("validates exact bounded whole-course comment projections", () => {
  const projection = messages[7];
  assert.deepEqual(validateScormMessage({ ...projection, payload: { comments: [] } }).payload, { comments: [] });
  for (const payload of [
    { comments: new Array(501).fill(comment) },
    { comments: [{ ...comment, extra: true }] },
    { comments: [{ ...comment, capabilities: { ...comment.capabilities, secret: true } }] },
    { comments: [{ ...comment, body: "x".repeat(10_001) }] },
  ]) assert.throws(() => validateScormMessage({ ...projection, payload }), /Invalid SCORM message/);
});

test("validates take-to-context comment identifiers", () => {
  const message = messages[12];
  assert.throws(() => validateScormMessage({ ...message, payload: { comment_id: "comment-3" } }), /Invalid SCORM message/);
});

test("accepts exact success and bounded error acknowledgements", () => {
  const message = messages[1];
  const binding = { ...base, ack_type: SCORM_ACK_TYPES.SCORM_START_SELECTION };
  const success = { ...binding, ok: true };
  const failure = { ...binding, ok: false, error_code: "NO_SELECTION" };
  assert.deepEqual(validateScormAck(success), success);
  assert.deepEqual(validateScormAck(failure), failure);
  assert.deepEqual(validateScormAckFor(message, success), success);
  assert.equal(scormAckTypeFor(message.type), "SCORM_START_SELECTION_ACK");
});

test("enforces exact ACK success and error rules", () => {
  const binding = { ...base, ack_type: "SCORM_START_MARKER_ACK" };
  for (const invalid of [
    { ...binding, ok: true, error_code: "OPERATION_FAILED" },
    { ...binding, ok: false },
    { ...binding, ok: false, error_code: "not_uppercase" },
    { ...binding, ok: false, error_code: "X".repeat(65) },
    { ...binding, ok: false, error_code: "NOT A CODE" },
    { ...binding, ok: false, error_code: "OPERATION_FAILED", extra: true },
    { ...binding, ok: "yes" },
    { ...binding, ok: true, protocol: 2 },
    { ...binding, ok: true, ack_type: "SCORM_UNKNOWN_ACK" },
  ]) assert.throws(() => validateScormAck(invalid), /Invalid SCORM acknowledgement/);
});

test("rejects a validly shaped ACK with the wrong type", () => {
  const message = messages[1];
  const wrong = { ...base, ack_type: "SCORM_START_MARKER_ACK", ok: true };
  assert.deepEqual(validateScormAck(wrong), wrong);
  assert.throws(() => validateScormAckFor(message, wrong), /does not match request/);
});

test("rejects acknowledgements with any mismatched request binding", () => {
  const message = messages[1];
  const acknowledgement = { ...base, ack_type: "SCORM_START_SELECTION_ACK", ok: true };
  const mismatches = [
    { request_id: "123e4567-e89b-42d3-a456-426614174010" },
    { worker_instance_id: "123e4567-e89b-42d3-a456-426614174011" },
    { generation: 8 },
    { course_id: "123e4567-e89b-42d3-a456-426614174012" },
    { page_url: "https://rise.example/activity/index.html#/lessons/two" },
  ];
  for (const mismatch of mismatches) {
    const candidate = { ...acknowledgement, ...mismatch };
    assert.deepEqual(validateScormAck(candidate), candidate);
    assert.throws(() => validateScormAckFor(message, candidate), /does not match request/);
  }
});
