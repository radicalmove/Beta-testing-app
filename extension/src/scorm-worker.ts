import { capturePinAnchor } from "./anchors/pin.ts";
import { captureTextAnchor, type TextAnchor } from "./anchors/text.ts";
import type { PageComment } from "./background-bridge.ts";
import { createCommentRenderer, type CommentRenderer } from "./comment-renderer.ts";
import { SCORM_ACK_TYPES, type ScormAck, type ScormCommand, type ScormEvent, validateScormMessage } from "./scorm-protocol.ts";
import { COMMENT_MARKER_CURSOR } from "./ui/comment-cursor.ts";
import { captureRiseInteractionContext, restoreRiseInteractionContext, type RiseInteractionContext } from "./rise-interaction-context.ts";

type LifecycleController = { teardown(): void; flush(): void };
type LifecycleFactory = (window: Window & typeof globalThis, document: Document, refresh: () => void) => LifecycleController;

export type ScormWorker = {
  handleCommand(command: unknown): ScormAck;
  initialEvents(): ScormEvent[];
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
  mutate?: (type: "edit" | "reply" | "status" | "delete" | "upload", commentId: string, value?: string) => Promise<void>;
  navigate?: (destination: URL, mode: "hash" | "route") => boolean;
  isTrustedActivation?: (event: Event) => boolean;
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

function riseCoverStart(document: Document): HTMLAnchorElement | undefined {
  const candidates = document.querySelectorAll<HTMLAnchorElement>('a.one-page-cover__start-link[aria-label="Start"]');
  if (candidates.length !== 1) return undefined;
  const start = candidates[0];
  return /^#\/lessons\/[A-Za-z0-9_-]{1,256}$/.test(start.getAttribute("href") ?? "") ? start : undefined;
}

export function createScormWorker(options: ScormWorkerOptions): ScormWorker {
  const { window, document } = options;
  const navigate = options.navigate ?? ((destination: URL, mode: "hash" | "route") => {
    if (mode === "hash") {
      window.location.hash = destination.hash;
      return window.location.hash === destination.hash;
    }
    window.location.assign(destination.href);
    return true;
  });
  let identity = embeddedPageIdentity(window, document);
  let navigationSignature = `${window.location.href}\n${document.title}`;
  let renderer: CommentRenderer;
  let cachedSelection: { anchor: TextAnchor; interactionContext: RiseInteractionContext | null } | undefined;
  let markerActive = false;
  let destroyed = false;
  let previousCursor = "";
  let previousCursorPriority = "";
  let projectedComments = new Map<string, PageComment>();
  let armedCoverStart: HTMLAnchorElement | undefined;
  const isTrustedActivation = options.isTrustedActivation ?? ((event: Event) => event.isTrusted);

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
  const onCoverActivation = (event: Event) => {
    if (!armedCoverStart || event.currentTarget !== armedCoverStart || !isTrustedActivation(event)) return;
    armedCoverStart.removeEventListener("click", onCoverActivation);
    armedCoverStart = undefined;
    options.emit(envelope("SCORM_COVER_ACTIVATED", {}));
  };
  const armRiseCover = () => {
    const start = riseCoverStart(document);
    if (!start) return false;
    if (armedCoverStart !== start) {
      armedCoverStart?.removeEventListener("click", onCoverActivation);
      armedCoverStart = start;
      armedCoverStart.addEventListener("click", onCoverActivation);
    }
    return true;
  };
  const mutation = async (type: "edit" | "reply" | "status" | "delete" | "upload", commentId: string, value?: string) => { await options.mutate?.(type, commentId, value); options.emit(envelope("SCORM_COMMENTS_CHANGED", {})); };
  const createRenderer = (pageUrl: string) => options.createRenderer
    ? options.createRenderer(document, pageUrl)
    : createCommentRenderer(document, pageUrl, { editThread: (id, body) => mutation("edit", id, body), replyThread: (id, body) => mutation("reply", id, body), uploadAttachment: (id, dataUrl) => mutation("upload", id, dataUrl), changeStatus: (id, status) => mutation("status", id, status), deleteThread: (id) => mutation("delete", id), navigateToComment: (commentId, targetPageUrl) => { options.emit(envelope("SCORM_COMMENT_NAVIGATION_REQUESTED", { comment_id: commentId, page_url: targetPageUrl })); } });
  renderer = createRenderer(identity.pageUrl);

  const onSelectionChange = () => {
    if (destroyed) return;
    const selection = window.getSelection();
    const range = selection && selection.rangeCount === 1 ? selection.getRangeAt(0) : undefined;
    const nextSelection = range ? captureTextAnchor(range, document) ?? undefined : undefined;
    if (nextSelection && range) cachedSelection = { anchor: nextSelection, interactionContext: captureRiseInteractionContext(range.commonAncestorContainer, document) };
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
    options.emit(envelope("SCORM_ANCHOR_CAPTURED", { page_title: identity.pageTitle, embedded_locator: identity.embeddedLocator, anchor_type: "visual_pin", ...anchor, interaction_context: captureRiseInteractionContext(event.target, document) }));
  };

  const startMarker = () => {
    if (markerActive) return;
    markerActive = true;
    previousCursor = document.documentElement.style.getPropertyValue("cursor");
    previousCursorPriority = document.documentElement.style.getPropertyPriority("cursor");
    document.documentElement.style.setProperty("cursor", COMMENT_MARKER_CURSOR, "important");
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
    projectedComments = new Map();
    identity = next;
    navigationSignature = nextNavigationSignature;
    renderer = createRenderer(identity.pageUrl);
    emitSelectionState();
    options.emit(envelope("SCORM_PAGE_IDENTITY_CHANGED", { page_title: identity.pageTitle, embedded_locator: identity.embeddedLocator }));
  };
  const lifecycle = options.createLifecycle(window, document, refreshIdentity);

  const acknowledgement = (command: ScormCommand, ok: boolean, errorCode?: string): ScormAck => ok ? {
    protocol: 1,
    request_id: command.request_id,
    worker_instance_id: command.worker_instance_id,
    generation: command.generation,
    course_id: command.course_id,
    page_url: command.page_url,
    ack_type: SCORM_ACK_TYPES[command.type],
    ok: true,
  } : {
    protocol: 1,
    request_id: command.request_id,
    worker_instance_id: command.worker_instance_id,
    generation: command.generation,
    course_id: command.course_id,
    page_url: command.page_url,
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
    initialEvents: () => [
      envelope("SCORM_PAGE_IDENTITY_CHANGED", { page_title: identity.pageTitle, embedded_locator: identity.embeddedLocator }),
      envelope("SCORM_SELECTION_CHANGED", { has_selection: Boolean(cachedSelection) }),
    ],
    handleCommand(value) {
      let command: ScormCommand;
      try {
        const parsed = validateScormMessage(value);
        if (!parsed.type.startsWith("SCORM_") || !["SCORM_START_SELECTION", "SCORM_START_MARKER", "SCORM_CANCEL_MARKER", "SCORM_SET_COMMENTS", "SCORM_ACTIVATE_COVER", "SCORM_APPLY_LOCATOR", "SCORM_RESTORE_INTERACTION", "SCORM_TAKE_TO_CONTEXT"].includes(parsed.type)) return invalidAcknowledgement(value);
        command = parsed as ScormCommand;
      } catch { return invalidAcknowledgement(value); }
      if (command.worker_instance_id !== options.workerInstanceId || command.generation !== options.generation || command.course_id !== options.courseId || command.page_url !== identity.pageUrl) return acknowledgement(command, false, "STALE_CONTEXT");
      switch (command.type) {
        case "SCORM_START_SELECTION": {
          if (!cachedSelection) return acknowledgement(command, false, "SELECTION_UNAVAILABLE");
          const cached = cachedSelection; cachedSelection = undefined;
          window.getSelection()?.removeAllRanges();
          options.emit(envelope("SCORM_ANCHOR_CAPTURED", {
            page_title: identity.pageTitle,
            embedded_locator: identity.embeddedLocator,
            anchor_type: "text_highlight",
            selected_quote: cached.anchor.selected_quote,
            prefix: cached.anchor.prefix,
            suffix: cached.anchor.suffix,
            interaction_context: cached.interactionContext,
          }));
          emitSelectionState();
          return acknowledgement(command, true);
        }
        case "SCORM_START_MARKER": startMarker(); return acknowledgement(command, true);
        case "SCORM_CANCEL_MARKER": stopMarker(); return acknowledgement(command, true);
        case "SCORM_SET_COMMENTS": {
          const comments = command.payload.comments;
          projectedComments = new Map(comments.filter((comment) => comment.page_url === identity.pageUrl).map((comment) => [comment.id, comment]));
          renderer.setComments(comments);
          return acknowledgement(command, true);
        }
        case "SCORM_ACTIVATE_COVER": return armRiseCover()
          ? acknowledgement(command, false, "USER_ACTION_REQUIRED")
          : acknowledgement(command, false, "COVER_NOT_READY");
        case "SCORM_APPLY_LOCATOR": {
          try {
            const destination = new URL(command.payload.embedded_locator, window.location.href);
            if (destination.origin !== window.location.origin) return acknowledgement(command, false, "LOCATOR_ORIGIN_MISMATCH");
            const mode = command.payload.embedded_locator.startsWith("#") ? "hash" : "route";
            return acknowledgement(command, navigate(destination, mode), "NAVIGATION_FAILED");
          } catch { return acknowledgement(command, false, "NAVIGATION_FAILED"); }
        }
        case "SCORM_RESTORE_INTERACTION": {
          const comment = projectedComments.get(command.payload.comment_id);
          if (!comment) return acknowledgement(command, false, "COMMENT_NOT_FOUND");
          if (!comment.interaction_context) return acknowledgement(command, true);
          const result = restoreRiseInteractionContext(comment.interaction_context, document);
          return result === "ready" ? acknowledgement(command, true) : acknowledgement(command, false, result === "not-ready" ? "INTERACTION_NOT_READY" : "INTERACTION_MISMATCH");
        }
        case "SCORM_TAKE_TO_CONTEXT": return acknowledgement(command, projectedComments.has(command.payload.comment_id) && renderer.takeToContext(command.payload.comment_id), "COMMENT_NOT_FOUND");
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cachedSelection = undefined;
      stopMarker();
      armedCoverStart?.removeEventListener("click", onCoverActivation);
      armedCoverStart = undefined;
      document.removeEventListener("selectionchange", onSelectionChange);
      lifecycle.teardown();
      renderer.setComments([]);
      projectedComments.clear();
      renderer.destroy();
    },
  };
}
