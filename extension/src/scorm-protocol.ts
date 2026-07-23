import { validatePageCommentsResponse, type PageComment } from "./background-bridge.ts";
import { validateRiseInteractionContext, type RiseInteractionContext } from "./rise-interaction-context.ts";

export const SCORM_MESSAGE_TYPES = [
  "SCORM_SELECTION_CHANGED",
  "SCORM_START_SELECTION",
  "SCORM_START_MARKER",
  "SCORM_CANCEL_MARKER",
  "SCORM_ANCHOR_CAPTURED",
  "SCORM_PAGE_IDENTITY_CHANGED",
  "SCORM_SET_COMMENTS",
  "SCORM_COMMENTS_CHANGED",
  "SCORM_COMMENT_NAVIGATION_REQUESTED",
  "SCORM_COVER_ACTIVATED",
  "SCORM_ACTIVATE_COVER",
  "SCORM_APPLY_LOCATOR",
  "SCORM_RESTORE_INTERACTION",
  "SCORM_TAKE_TO_CONTEXT",
] as const;

export type ScormMessageType = typeof SCORM_MESSAGE_TYPES[number];

export const SCORM_ACK_TYPES = {
  SCORM_SELECTION_CHANGED: "SCORM_SELECTION_CHANGED_ACK",
  SCORM_START_SELECTION: "SCORM_START_SELECTION_ACK",
  SCORM_START_MARKER: "SCORM_START_MARKER_ACK",
  SCORM_CANCEL_MARKER: "SCORM_CANCEL_MARKER_ACK",
  SCORM_ANCHOR_CAPTURED: "SCORM_ANCHOR_CAPTURED_ACK",
  SCORM_PAGE_IDENTITY_CHANGED: "SCORM_PAGE_IDENTITY_CHANGED_ACK",
  SCORM_SET_COMMENTS: "SCORM_SET_COMMENTS_ACK",
  SCORM_COMMENTS_CHANGED: "SCORM_COMMENTS_CHANGED_ACK",
  SCORM_COMMENT_NAVIGATION_REQUESTED: "SCORM_COMMENT_NAVIGATION_REQUESTED_ACK",
  SCORM_COVER_ACTIVATED: "SCORM_COVER_ACTIVATED_ACK",
  SCORM_ACTIVATE_COVER: "SCORM_ACTIVATE_COVER_ACK",
  SCORM_APPLY_LOCATOR: "SCORM_APPLY_LOCATOR_ACK",
  SCORM_RESTORE_INTERACTION: "SCORM_RESTORE_INTERACTION_ACK",
  SCORM_TAKE_TO_CONTEXT: "SCORM_TAKE_TO_CONTEXT_ACK",
} as const satisfies Record<ScormMessageType, string>;

export type ScormAckType = typeof SCORM_ACK_TYPES[ScormMessageType];
export type EmptyScormPayload = Record<string, never>;
export type ScormSelectionChangedPayload = { has_selection: boolean };
export type ScormTextAnchorPayload = {
  page_title: string;
  embedded_locator: string;
  anchor_type: "text_highlight";
  selected_quote: string;
  prefix: string;
  suffix: string;
  interaction_context: RiseInteractionContext | null;
};
export type ScormPinAnchorPayload = {
  page_title: string;
  embedded_locator: string;
  anchor_type: "visual_pin";
  css_selector: string;
  relative_x: number;
  relative_y: number;
  interaction_context: RiseInteractionContext | null;
};
export type ScormAnchorCapturedPayload = ScormTextAnchorPayload | ScormPinAnchorPayload;
export type ScormPageIdentityPayload = { page_title: string; embedded_locator: string };
export type ScormSetCommentsPayload = { comments: PageComment[] };
export type ScormApplyLocatorPayload = { embedded_locator: string };
export type ScormTakeToContextPayload = { comment_id: string };
export type ScormRestoreInteractionPayload = { comment_id: string };
export type ScormCommentNavigationPayload = { comment_id: string; page_url: string };

export type ScormEnvelope<T extends ScormMessageType, P> = {
  protocol: 1;
  type: T;
  request_id: string;
  worker_instance_id: string;
  generation: number;
  course_id: string;
  page_url: string;
  payload: P;
};

export type ScormCommand =
  | ScormEnvelope<"SCORM_START_SELECTION", EmptyScormPayload>
  | ScormEnvelope<"SCORM_START_MARKER", EmptyScormPayload>
  | ScormEnvelope<"SCORM_CANCEL_MARKER", EmptyScormPayload>
  | ScormEnvelope<"SCORM_SET_COMMENTS", ScormSetCommentsPayload>
  | ScormEnvelope<"SCORM_ACTIVATE_COVER", EmptyScormPayload>
  | ScormEnvelope<"SCORM_APPLY_LOCATOR", ScormApplyLocatorPayload>
  | ScormEnvelope<"SCORM_RESTORE_INTERACTION", ScormRestoreInteractionPayload>
  | ScormEnvelope<"SCORM_TAKE_TO_CONTEXT", ScormTakeToContextPayload>;

export type ScormEvent =
  | ScormEnvelope<"SCORM_SELECTION_CHANGED", ScormSelectionChangedPayload>
  | ScormEnvelope<"SCORM_ANCHOR_CAPTURED", ScormAnchorCapturedPayload>
  | ScormEnvelope<"SCORM_PAGE_IDENTITY_CHANGED", ScormPageIdentityPayload>
  | ScormEnvelope<"SCORM_COMMENTS_CHANGED", EmptyScormPayload>
  | ScormEnvelope<"SCORM_COVER_ACTIVATED", EmptyScormPayload>
  | ScormEnvelope<"SCORM_COMMENT_NAVIGATION_REQUESTED", ScormCommentNavigationPayload>;

export type ScormMessage = ScormCommand | ScormEvent;

type ScormAckBinding = {
  protocol: 1;
  request_id: string;
  worker_instance_id: string;
  generation: number;
  course_id: string;
  page_url: string;
  ack_type: ScormAckType;
};

export type ScormSuccessAck = ScormAckBinding & { ok: true };
export type ScormErrorAck = ScormAckBinding & { ok: false; error_code: string };
export type ScormAck = ScormSuccessAck | ScormErrorAck;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ENVELOPE_KEYS = ["protocol", "type", "request_id", "worker_instance_id", "generation", "course_id", "page_url", "payload"];
const ACK_TYPES = new Set<string>(Object.values(SCORM_ACK_TYPES));

function invalidMessage(): never { throw new Error("Invalid SCORM message"); }
function invalidAcknowledgement(): never { throw new Error("Invalid SCORM acknowledgement"); }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function exactHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && !url.username
      && !url.password
      && url.href === value;
  } catch { return false; }
}

function validBinding(record: Record<string, unknown>): boolean {
  return record.protocol === 1
    && validUuid(record.request_id)
    && validUuid(record.worker_instance_id)
    && Number.isSafeInteger(record.generation)
    && (record.generation as number) >= 0
    && validUuid(record.course_id)
    && exactHttpUrl(record.page_url);
}

function validPageTitle(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 512
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function validEmbeddedLocator(value: unknown, pageUrl: string): value is string {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > 2048
    || value.trim() !== value
    || /[\u0000-\u0020\u007f\\]/.test(value)
    || (!value.startsWith("#") && !value.startsWith("/"))
    || value.startsWith("//")) return false;
  try { return new URL(value, pageUrl).origin === new URL(pageUrl).origin; } catch { return false; }
}

function validEmptyPayload(payload: unknown): payload is EmptyScormPayload {
  return isRecord(payload) && exactKeys(payload, []);
}

function validIdentity(payload: Record<string, unknown>, pageUrl: string): boolean {
  return validPageTitle(payload.page_title) && validEmbeddedLocator(payload.embedded_locator, pageUrl);
}

function validAnchor(payload: unknown, pageUrl: string): payload is ScormAnchorCapturedPayload {
  if (!isRecord(payload) || !validIdentity(payload, pageUrl)) return false;
  const interaction = payload.interaction_context === null || validateRiseInteractionContext(payload.interaction_context) !== null;
  if (!interaction) return false;
  if (payload.anchor_type === "text_highlight") {
    return exactKeys(payload, ["page_title", "embedded_locator", "anchor_type", "selected_quote", "prefix", "suffix", "interaction_context"])
      && typeof payload.selected_quote === "string"
      && payload.selected_quote.length <= 20_000
      && Boolean(payload.selected_quote.trim())
      && typeof payload.prefix === "string"
      && payload.prefix.length <= 2_000
      && typeof payload.suffix === "string"
      && payload.suffix.length <= 2_000;
  }
  if (payload.anchor_type === "visual_pin") {
    return exactKeys(payload, ["page_title", "embedded_locator", "anchor_type", "css_selector", "relative_x", "relative_y", "interaction_context"])
      && typeof payload.css_selector === "string"
      && payload.css_selector.length >= 1
      && payload.css_selector.length <= 4_000
      && payload.css_selector.trim() === payload.css_selector
      && typeof payload.relative_x === "number"
      && Number.isFinite(payload.relative_x)
      && payload.relative_x >= 0
      && payload.relative_x <= 1
      && typeof payload.relative_y === "number"
      && Number.isFinite(payload.relative_y)
      && payload.relative_y >= 0
      && payload.relative_y <= 1;
  }
  return false;
}

function validProjection(payload: unknown): payload is ScormSetCommentsPayload {
  if (!isRecord(payload) || !exactKeys(payload, ["comments"]) || !Array.isArray(payload.comments)) return false;
  try {
    validatePageCommentsResponse(payload.comments);
    return payload.comments.every((comment) => {
      if (!isRecord(comment.capabilities)) return false;
      const keys = Object.keys(comment.capabilities);
      const allowed = ["can_reply", "can_edit", "can_change_status", "can_share_with_sme", "can_delete", "allowed_statuses"];
      return keys.every((key) => allowed.includes(key));
    });
  } catch { return false; }
}

export function validateScormMessage(value: unknown): ScormMessage {
  if (!isRecord(value) || !exactKeys(value, ENVELOPE_KEYS) || !validBinding(value) || typeof value.type !== "string" || !SCORM_MESSAGE_TYPES.includes(value.type as ScormMessageType)) return invalidMessage();
  const pageUrl = value.page_url as string;
  switch (value.type) {
    case "SCORM_SELECTION_CHANGED":
      if (!isRecord(value.payload) || !exactKeys(value.payload, ["has_selection"]) || typeof value.payload.has_selection !== "boolean") return invalidMessage();
      break;
    case "SCORM_START_SELECTION":
    case "SCORM_START_MARKER":
    case "SCORM_CANCEL_MARKER":
    case "SCORM_ACTIVATE_COVER":
    case "SCORM_COMMENTS_CHANGED":
    case "SCORM_COVER_ACTIVATED":
      if (!validEmptyPayload(value.payload)) return invalidMessage();
      break;
    case "SCORM_COMMENT_NAVIGATION_REQUESTED":
      if (!isRecord(value.payload) || !exactKeys(value.payload, ["comment_id", "page_url"]) || !validUuid(value.payload.comment_id) || !exactHttpUrl(value.payload.page_url)) return invalidMessage();
      break;
    case "SCORM_ANCHOR_CAPTURED":
      if (!validAnchor(value.payload, pageUrl)) return invalidMessage();
      break;
    case "SCORM_PAGE_IDENTITY_CHANGED":
      if (!isRecord(value.payload) || !exactKeys(value.payload, ["page_title", "embedded_locator"]) || !validIdentity(value.payload, pageUrl)) return invalidMessage();
      break;
    case "SCORM_SET_COMMENTS":
      if (!validProjection(value.payload)) return invalidMessage();
      break;
    case "SCORM_APPLY_LOCATOR":
      if (!isRecord(value.payload) || !exactKeys(value.payload, ["embedded_locator"]) || !validEmbeddedLocator(value.payload.embedded_locator, pageUrl)) return invalidMessage();
      break;
    case "SCORM_TAKE_TO_CONTEXT":
    case "SCORM_RESTORE_INTERACTION":
      if (!isRecord(value.payload) || !exactKeys(value.payload, ["comment_id"]) || !validUuid(value.payload.comment_id)) return invalidMessage();
      break;
    default:
      return invalidMessage();
  }
  return value as ScormMessage;
}

export function scormAckTypeFor(type: ScormMessageType): ScormAckType {
  return SCORM_ACK_TYPES[type];
}

export function validateScormAck(value: unknown): ScormAck {
  if (!isRecord(value) || !validBinding(value) || typeof value.ack_type !== "string" || !ACK_TYPES.has(value.ack_type) || typeof value.ok !== "boolean") return invalidAcknowledgement();
  if (value.ok) {
    if (!exactKeys(value, ["protocol", "request_id", "worker_instance_id", "generation", "course_id", "page_url", "ack_type", "ok"])) return invalidAcknowledgement();
  } else if (!exactKeys(value, ["protocol", "request_id", "worker_instance_id", "generation", "course_id", "page_url", "ack_type", "ok", "error_code"])
    || typeof value.error_code !== "string"
    || !ERROR_CODE.test(value.error_code)) return invalidAcknowledgement();
  return value as ScormAck;
}

export function validateScormAckFor(message: ScormMessage, value: unknown): ScormAck {
  const acknowledgement = validateScormAck(value);
  if (acknowledgement.ack_type !== scormAckTypeFor(message.type)
    || acknowledgement.request_id !== message.request_id
    || acknowledgement.worker_instance_id !== message.worker_instance_id
    || acknowledgement.generation !== message.generation
    || acknowledgement.course_id !== message.course_id
    || acknowledgement.page_url !== message.page_url) throw new Error("SCORM acknowledgement does not match request");
  return acknowledgement;
}
