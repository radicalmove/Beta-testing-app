export type Rect = { left: number; top: number; right: number; bottom: number };
export type FrameGeometry = {
  renderedContentBox: Rect;
  childViewportWidth: number;
  childViewportHeight: number;
  axisAligned: boolean;
};

const finiteRect = (rect: Rect) => [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite);

export function intersectRects(left: Rect, right: Rect): Rect | undefined {
  if (!finiteRect(left) || !finiteRect(right)) return undefined;
  const intersection = {
    left: Math.max(left.left, right.left),
    top: Math.max(left.top, right.top),
    right: Math.min(left.right, right.right),
    bottom: Math.min(left.bottom, right.bottom),
  };
  return intersection.right > intersection.left && intersection.bottom > intersection.top ? intersection : undefined;
}

export function mapVisibleRectToChild(parentVisible: Rect, geometry: FrameGeometry): Rect | undefined {
  const box = geometry.renderedContentBox;
  if (!geometry.axisAligned || !finiteRect(box) || geometry.childViewportWidth <= 0 || geometry.childViewportHeight <= 0) return undefined;
  const renderedWidth = box.right - box.left;
  const renderedHeight = box.bottom - box.top;
  if (renderedWidth <= 0 || renderedHeight <= 0) return undefined;
  const visible = intersectRects(parentVisible, box);
  if (!visible) return undefined;
  const scaleX = renderedWidth / geometry.childViewportWidth;
  const scaleY = renderedHeight / geometry.childViewportHeight;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return undefined;
  return {
    left: (visible.left - box.left) / scaleX,
    top: (visible.top - box.top) / scaleY,
    right: (visible.right - box.left) / scaleX,
    bottom: (visible.bottom - box.top) / scaleY,
  };
}

export function toolbarDocumentPosition(
  visible: Rect,
  scroll: { x: number; y: number },
  toolbar: { width: number; height: number },
  margin: number,
): { left: number; top: number } {
  return {
    left: scroll.x + Math.max(visible.left + margin, visible.right - toolbar.width - margin),
    top: scroll.y + Math.max(visible.top + margin, visible.bottom - toolbar.height - margin),
  };
}

type ViewportMessage =
  | { type: "MCR_VIEWPORT_HELLO"; version: 1; nonce: string; width: number; height: number }
  | { type: "MCR_VIEWPORT_RECT"; version: 1; nonce: string; rect: Rect };

const messageType = (value: unknown): value is ViewportMessage => {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.version === 1 && typeof message.type === "string" && typeof message.nonce === "string";
};

const originOf = (url: string, base?: string): string | undefined => {
  try { const origin = new URL(url, base).origin; return origin === "null" ? undefined : origin; } catch { return undefined; }
};

export function startFrameViewportBridge(
  targetWindow: Window & typeof globalThis,
  targetDocument: Document,
  onVisibleRect: (rect: Rect | undefined) => void,
  intervalMs = 750,
): () => void {
  if (typeof targetWindow.addEventListener !== "function" || typeof targetWindow.requestAnimationFrame !== "function" || typeof targetWindow.setInterval !== "function") return () => undefined;
  const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const children = new Map<Window, { frame: HTMLIFrameElement; origin: string; nonce: string; width: number; height: number }>();
  let inherited: Rect | undefined;
  let stopped = false;
  let animationFrame: number | undefined;
  const isTop = targetWindow === targetWindow.top;
  const parentOrigin = !isTop ? originOf(targetDocument.referrer) : undefined;

  const localViewport = (): Rect => {
    const visual = targetWindow.visualViewport;
    return visual ? { left: visual.offsetLeft, top: visual.offsetTop, right: visual.offsetLeft + visual.width, bottom: visual.offsetTop + visual.height }
      : { left: 0, top: 0, right: targetWindow.innerWidth, bottom: targetWindow.innerHeight };
  };
  const visible = () => isTop ? localViewport() : inherited;
  const frameForSource = (source: MessageEventSource | null) => Array.from(targetDocument.querySelectorAll("iframe")).find((frame) => frame.contentWindow === source);
  const geometry = (frame: HTMLIFrameElement, width: number, height: number): FrameGeometry => {
    const rect = frame.getBoundingClientRect();
    const style = targetWindow.getComputedStyle(frame);
    const transform = style.transform;
    const axisAligned = !transform || transform === "none" || /^matrix\([^,]+,\s*0(?:\.0+)?,\s*0(?:\.0+)?,/i.test(transform);
    const scaleX = frame.offsetWidth > 0 ? rect.width / frame.offsetWidth : 1;
    const scaleY = frame.offsetHeight > 0 ? rect.height / frame.offsetHeight : 1;
    const left = rect.left + frame.clientLeft * scaleX;
    const top = rect.top + frame.clientTop * scaleY;
    return { renderedContentBox: { left, top, right: left + frame.clientWidth * scaleX, bottom: top + frame.clientHeight * scaleY }, childViewportWidth: width, childViewportHeight: height, axisAligned };
  };
  const publish = () => {
    animationFrame = undefined;
    const current = visible();
    onVisibleRect(current);
    for (const child of children.values()) {
      const rect = current ? mapVisibleRectToChild(current, geometry(child.frame, child.width, child.height)) : undefined;
      if (rect) child.frame.contentWindow?.postMessage({ type: "MCR_VIEWPORT_RECT", version: 1, nonce: child.nonce, rect } satisfies ViewportMessage, child.origin);
    }
  };
  const schedule = () => { if (!stopped && animationFrame === undefined) animationFrame = targetWindow.requestAnimationFrame(publish); };
  const onMessage = (event: MessageEvent) => {
    if (!messageType(event.data) || !event.origin || event.origin === "null") return;
    const message = event.data;
    if (message.type === "MCR_VIEWPORT_HELLO") {
      const frame = frameForSource(event.source);
      const expected = frame ? originOf(frame.src, targetDocument.baseURI) : undefined;
      if (!frame || !expected || expected !== event.origin || !Number.isFinite(message.width) || !Number.isFinite(message.height) || message.width <= 0 || message.height <= 0) return;
      children.set(event.source as Window, { frame, origin: expected, nonce: message.nonce, width: message.width, height: message.height });
      schedule();
    } else if (!isTop && event.source === targetWindow.parent && parentOrigin === event.origin && message.nonce === nonce) {
      const rect = message.rect;
      inherited = rect && [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) && rect.right > rect.left && rect.bottom > rect.top ? rect : undefined;
      schedule();
    }
  };
  targetWindow.addEventListener("message", onMessage);
  targetWindow.addEventListener("scroll", schedule, true);
  targetWindow.addEventListener("resize", schedule);
  targetWindow.visualViewport?.addEventListener("scroll", schedule);
  targetWindow.visualViewport?.addEventListener("resize", schedule);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : undefined;
  for (const frame of Array.from(targetDocument.querySelectorAll("iframe"))) observer?.observe(frame);
  const greetParent = () => { if (!isTop && parentOrigin) targetWindow.parent.postMessage({ type: "MCR_VIEWPORT_HELLO", version: 1, nonce, width: targetWindow.innerWidth, height: targetWindow.innerHeight } satisfies ViewportMessage, parentOrigin); };
  const timer = targetWindow.setInterval(() => { greetParent(); schedule(); }, intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  greetParent();
  schedule();
  return () => {
    stopped = true;
    targetWindow.removeEventListener("message", onMessage);
    targetWindow.removeEventListener("scroll", schedule, true);
    targetWindow.removeEventListener("resize", schedule);
    targetWindow.visualViewport?.removeEventListener("scroll", schedule);
    targetWindow.visualViewport?.removeEventListener("resize", schedule);
    if (animationFrame !== undefined) targetWindow.cancelAnimationFrame(animationFrame);
    targetWindow.clearInterval(timer);
    observer?.disconnect();
    children.clear();
  };
}
