import { capturePinAnchor } from "./anchors/pin.ts";
import { captureTextAnchor, type TextAnchor } from "./anchors/text.ts";
import type { PageComment } from "./background-bridge.ts";
import { createCommentRenderer, type CommentRenderer } from "./comment-renderer.ts";
import { SCORM_ACK_TYPES, type ScormAck, type ScormCommand, type ScormEvent, validateScormMessage } from "./scorm-protocol.ts";

type LifecycleController = { teardown(): void; flush(): void };
type LifecycleFactory = (window: Window & typeof globalThis, document: Document, refresh: () => void) => LifecycleController;

export type ScormWorker = {
  handleCommand(command: unknown): ScormAck;
  destroy(): void;
};

export type ScormWorkerOptions = {
  window: Window & typeof globalThis;
  document: Document;
  workerInstanceId: string;
  generation: number;
  courseId: string;
  emit(event: ScormEvent): void;
  createLifecycle: LifecycleFactory;
  createRenderer?: (document: Document, pageUrl: string) => CommentRenderer;
};

type PageIdentity = { pageUrl: string; pageTitle: string; embeddedLocator: string };

function pageLabel(document: Document): string {
  return document.querySelector<HTMLElement>("h1")?.textContent?.trim() || document.title.trim() || "Current page";
}

export function embeddedPageIdentity(window: Window & typeof globalThis, document: Document): PageIdentity {
  const label = pageLabel(document);
  const identity = new URL(window.location.href);
  identity.hash = `moodle-review-page=${encodeURIComponent(label)}`;
  const current = new URL(window.location.href);
  const embeddedLocator = current.hash || `${current.pathname}${current.search}` || "/";
  return { pageUrl: identity.href, pageTitle: `Embedded activity · ${label}`, embeddedLocator };
}

export function createScormWorker(options: ScormWorkerOptions): ScormWorker {
  const { window, document } = options;
  const makeRenderer = options.createRenderer ?? ((target, pageUrl) => createCommentRenderer(target, pageUrl));
  let identity = embeddedPageIdentity(window, document);
  let navigationSignature = `${window.location.href}\n${document.title}`;
  let renderer = makeRenderer(document, identity.pageUrl);
  let cachedSelection: TextAnchor | undefined;
  let markerActive = false;
  let destroyed = false;
  let previousCursor = "";
  let previousCursorPriority = "";

  const envelope = <T extends ScormEvent["type"]>(type: T, payload: Extract<ScormEvent, { type: T }>["payload"]): Extract<ScormEvent, { type: T }> => ({
    protocol: 1,
    type,
    request_id: window.crypto?.randomUUID?.() ?? globalThis.crypto.randomUUID(),
    worker_instance_id: options.workerInstanceId,
    generation: options.generation,
    course_id: options.courseId,
    page_url: identity.pageUrl,
    payload,
  }) as Extract<ScormEvent, { type: T }>;

  const emitSelectionState = () => options.emit(envelope("SCORM_SELECTION_CHANGED", { has_selection: Boolean(cachedSelection) }));

  const onSelectionChange = () => {
    if (destroyed) return;
    const selection = window.getSelection();
    const range = selection && selection.rangeCount === 1 ? selection.getRangeAt(0) : undefined;
    cachedSelection = range ? captureTextAnchor(range, document) ?? undefined : undefined;
    emitSelectionState();
  };
  document.addEventListener("selectionchange", onSelectionChange);

  const stopMarker = () => {
    if (!markerActive) return;
    markerActive = false;
    document.removeEventListener("click", onMarkerClick, true);
    document.documentElement.style.setProperty("cursor", previousCursor, previousCursorPriority);
  };

  const onMarkerClick = (event: MouseEvent) => {
    if (!markerActive || !(event.target instanceof window.HTMLElement)) return;
    const anchor = capturePinAnchor(event.target, event.clientX, event.clientY);
    if (!anchor) return;
    event.preventDefault(); event.stopPropagation();
    stopMarker();
    options.emit(envelope("SCORM_ANCHOR_CAPTURED", { page_title: identity.pageTitle, embedded_locator: identity.embeddedLocator, anchor_type: "visual_pin", ...anchor }));
  };

  const startMarker = () => {
    if (markerActive) return;
    markerActive = true;
    previousCursor = document.documentElement.style.getPropertyValue("cursor");
    previousCursorPriority = document.documentElement.style.getPropertyPriority("cursor");
    document.documentElement.style.setProperty("cursor", "crosshair", "important");
    document.addEventListener("click", onMarkerClick, true);
  };

  const refreshIdentity = () => {
    if (destroyed) return;
    const next = embeddedPageIdentity(window, document);
    const nextNavigationSignature = `${window.location.href}\n${document.title}`;
    if (nextNavigationSignature === navigationSignature && next.pageUrl === identity.pageUrl && next.pageTitle === identity.pageTitle && next.embeddedLocator === identity.embeddedLocator) return;
    cachedSelection = undefined;
    stopMarker();
    renderer.setComments([]);
    renderer.destroy();
    identity = next;
    navigationSignature = nextNavigationSignature;
    renderer = makeRenderer(document, identity.pageUrl);
    emitSelectionState();
    options.emit(envelope("SCORM_PAGE_IDENTITY_CHANGED", { page_title: identity.pageTitle, embedded_locator: identity.embeddedLocator }));
  };
  const lifecycle = options.createLifecycle(window, document, refreshIdentity);

  const acknowledgement = (command: ScormCommand, ok: boolean, errorCode?: string): ScormAck => ok ? {
    protocol: 1,
    request_id: command.request_id,
    worker_instance_id: options.workerInstanceId,
    generation: options.generation,
    course_id: options.courseId,
    page_url: identity.pageUrl,
    ack_type: SCORM_ACK_TYPES[command.type],
    ok: true,
  } : {
    protocol: 1,
    request_id: command.request_id,
    worker_instance_id: options.workerInstanceId,
    generation: options.generation,
    course_id: options.courseId,
    page_url: identity.pageUrl,
    ack_type: SCORM_ACK_TYPES[command.type],
    ok: false,
    error_code: errorCode ?? "COMMAND_REJECTED",
  };

  const invalidAcknowledgement = (value: unknown): ScormAck => {
    const record = value && typeof value === "object" ? value as Partial<ScormCommand> : {};
    const type = typeof record.type === "string" && record.type in SCORM_ACK_TYPES ? record.type as ScormCommand["type"] : "SCORM_CANCEL_MARKER";
    const requestId = typeof record.request_id === "string" ? record.request_id : window.crypto.randomUUID();
    return {
      protocol: 1, request_id: requestId, worker_instance_id: options.workerInstanceId, generation: options.generation,
      course_id: options.courseId, page_url: identity.pageUrl, ack_type: SCORM_ACK_TYPES[type], ok: false, error_code: "INVALID_COMMAND",
    };
  };

  return {
    handleCommand(value) {
      let command: ScormCommand;
      try {
        const parsed = validateScormMessage(value);
        if (!parsed.type.startsWith("SCORM_") || !["SCORM_START_SELECTION", "SCORM_START_MARKER", "SCORM_CANCEL_MARKER", "SCORM_SET_COMMENTS", "SCORM_APPLY_LOCATOR", "SCORM_TAKE_TO_CONTEXT"].includes(parsed.type)) return invalidAcknowledgement(value);
        command = parsed as ScormCommand;
      } catch { return invalidAcknowledgement(value); }
      if (command.worker_instance_id !== options.workerInstanceId || command.generation !== options.generation || command.course_id !== options.courseId || command.page_url !== identity.pageUrl) return acknowledgement(command, false, "STALE_CONTEXT");
      switch (command.type) {
        case "SCORM_START_SELECTION": {
          if (!cachedSelection) return acknowledgement(command, false, "SELECTION_UNAVAILABLE");
          const anchor = cachedSelection; cachedSelection = undefined;
          window.getSelection()?.removeAllRanges();
          options.emit(envelope("SCORM_ANCHOR_CAPTURED", { page_title: identity.pageTitle, embedded_locator: identity.embeddedLocator, anchor_type: "text_highlight", ...anchor }));
          emitSelectionState();
          return acknowledgement(command, true);
        }
        case "SCORM_START_MARKER": startMarker(); return acknowledgement(command, true);
        case "SCORM_CANCEL_MARKER": stopMarker(); return acknowledgement(command, true);
        case "SCORM_SET_COMMENTS": renderer.setComments(command.payload.comments.filter((comment) => comment.page_url === identity.pageUrl)); return acknowledgement(command, true);
        case "SCORM_APPLY_LOCATOR": window.location.hash = command.payload.embedded_locator.startsWith("#") ? command.payload.embedded_locator : new URL(command.payload.embedded_locator, window.location.href).hash; return acknowledgement(command, true);
        case "SCORM_TAKE_TO_CONTEXT": return acknowledgement(command, renderer.takeToContext(command.payload.comment_id), "COMMENT_NOT_FOUND");
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cachedSelection = undefined;
      stopMarker();
      document.removeEventListener("selectionchange", onSelectionChange);
      lifecycle.teardown();
      renderer.setComments([]);
      renderer.destroy();
    },
  };
}
