export type RiseInteractionContext = {
  version: 1;
  kind: "tabs" | "process";
  container: {
    block_id: string | null;
    ordinal: number;
    fingerprint: string;
  };
  item: {
    ordinal: number;
    count: number;
    label: string;
    control_key: string | null;
  };
};

export type RestoreRiseInteractionResult = "ready" | "not-ready" | "mismatch";

const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,200}$/;
const TAB_CONTROL_KEY = /^[A-Za-z][A-Za-z0-9_.:-]{0,199}$/;
const exactKeys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).sort().join() === [...expected].sort().join();
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function normalise(value: string | null | undefined, max = 300): string {
  const result = (value ?? "").replace(/\s+/gu, " ").trim();
  return result.length <= max && result.length > 0 && !/[\u0000-\u001f\u007f]/u.test(result) ? result : "";
}

function normalisedEqual(left: string, right: string): boolean {
  return normalise(left).localeCompare(normalise(right), undefined, { sensitivity: "accent" }) === 0;
}

function validItem(value: unknown, kind: "tabs" | "process"): value is RiseInteractionContext["item"] {
  if (!record(value) || !exactKeys(value, ["ordinal", "count", "label", "control_key"])) return false;
  if (!Number.isSafeInteger(value.ordinal) || (value.ordinal as number) < 1 || (value.ordinal as number) > 100
    || !Number.isSafeInteger(value.count) || (value.count as number) < 1 || (value.count as number) > 100
    || (value.ordinal as number) > (value.count as number)
    || typeof value.label !== "string" || normalise(value.label) !== value.label) return false;
  if (kind === "process") return value.control_key === `Go to slide ${value.ordinal}`;
  return typeof value.control_key === "string" && TAB_CONTROL_KEY.test(value.control_key);
}

export function validateRiseInteractionContext(value: unknown): RiseInteractionContext | null {
  if (!record(value) || !exactKeys(value, ["version", "kind", "container", "item"])
    || value.version !== 1 || !["tabs", "process"].includes(value.kind as string)
    || !record(value.container) || !exactKeys(value.container, ["block_id", "ordinal", "fingerprint"])) return null;
  const kind = value.kind as "tabs" | "process";
  const container = value.container;
  if (!Number.isSafeInteger(container.ordinal) || (container.ordinal as number) < 1 || (container.ordinal as number) > 100
    || !(container.block_id === null || (typeof container.block_id === "string" && IDENTIFIER.test(container.block_id)))
    || typeof container.fingerprint !== "string" || normalise(container.fingerprint) !== container.fingerprint
    || !validItem(value.item, kind)) return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > 4096) return null;
  } catch { return null; }
  return value as RiseInteractionContext;
}

function asElement(target: Node): Element | null {
  return target.nodeType === 1 ? target as Element : target.parentElement;
}

function labelledText(element: Element, document: Document): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    const result = normalise(text);
    if (result) return result;
  }
  return normalise(element.getAttribute("aria-label"));
}

function interactionRoot(element: Element): Element {
  return element.closest("[data-block-id]") ?? element;
}

function precedingHeading(root: Element, interaction: Element): string {
  const headings = Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));
  const before = headings.filter((heading) => {
    const position = heading.compareDocumentPosition(interaction);
    return Boolean(position & 4);
  }).at(-1);
  return normalise(before?.textContent);
}

function interactionControlFingerprint(kind: "tabs" | "process", interaction: Element): string {
  const candidates = kind === "tabs"
    ? Array.from(interaction.querySelectorAll<HTMLElement>('[role="tab"]'))
    : Array.from(interaction.querySelectorAll<HTMLElement>(".carousel-slide"));
  const labels = candidates.map((candidate) => kind === "tabs"
    ? normalise(candidate.textContent || candidate.getAttribute("aria-label"))
    : normalise(candidate.querySelector<HTMLElement>("h1,h2,h3,h4,h5,h6")?.textContent));
  return labels.length > 0 && labels.every(Boolean) ? normalise(labels.join(" | ")) : "";
}

function fingerprint(kind: "tabs" | "process", root: Element, interaction: Element, document: Document): string {
  return labelledText(root, document)
    || labelledText(interaction, document)
    || precedingHeading(root, interaction)
    || interactionControlFingerprint(kind, interaction);
}

function tabInteractions(document: Document): Array<{ root: Element; interaction: Element }> {
  const found: Array<{ root: Element; interaction: Element }> = [];
  for (const tablist of Array.from(document.querySelectorAll('[role="tablist"]'))) {
    const root = interactionRoot(tablist);
    if (!found.some((entry) => entry.root === root)) found.push({ root, interaction: tablist });
  }
  return found;
}

function processInteractions(document: Document): Array<{ root: Element; interaction: Element }> {
  const found: Array<{ root: Element; interaction: Element }> = [];
  for (const carousel of Array.from(document.querySelectorAll('.carousel[role="region"], [role="region"][aria-label="Carousel"], .carousel'))) {
    if (!carousel.querySelector(".carousel-slide")) continue;
    const root = interactionRoot(carousel);
    if (!found.some((entry) => entry.root === root)) found.push({ root, interaction: carousel });
  }
  return found;
}

function containerIdentity(kind: "tabs" | "process", root: Element, interaction: Element, document: Document) {
  const candidates = kind === "tabs" ? tabInteractions(document) : processInteractions(document);
  const ordinal = candidates.findIndex((entry) => entry.root === root) + 1;
  const blockId = root.getAttribute("data-block-id");
  const resolvedFingerprint = fingerprint(kind, root, interaction, document);
  if (ordinal < 1 || ordinal > 100 || !resolvedFingerprint || (blockId !== null && !IDENTIFIER.test(blockId))) return null;
  return { block_id: blockId, ordinal, fingerprint: resolvedFingerprint };
}

export function captureRiseInteractionContext(target: Node, document: Document): RiseInteractionContext | null {
  const element = asElement(target);
  if (!element || element.ownerDocument !== document) return null;

  const panel = element.closest<HTMLElement>('[role="tabpanel"]');
  if (panel?.id) {
    const controls = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
    const control = controls.find((candidate) => candidate.getAttribute("aria-controls") === panel.id);
    const tablist = control?.closest('[role="tablist"]');
    if (control && tablist) {
      const inList = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
      const ordinal = inList.indexOf(control) + 1;
      const root = interactionRoot(tablist);
      const container = containerIdentity("tabs", root, tablist, document);
      const label = normalise(control.textContent || control.getAttribute("aria-label"));
      const context = container && label ? {
        version: 1 as const, kind: "tabs" as const, container,
        item: { ordinal, count: inList.length, label, control_key: panel.id },
      } : null;
      return validateRiseInteractionContext(context);
    }
  }

  const slide = element.closest<HTMLElement>(".carousel-slide");
  const carousel = slide?.closest<HTMLElement>(".carousel, [role=region]");
  if (slide && carousel) {
    const slides = Array.from(carousel.querySelectorAll<HTMLElement>(".carousel-slide"));
    const ordinal = slides.indexOf(slide) + 1;
    const controls = Array.from(carousel.querySelectorAll<HTMLElement>(".carousel-controls-item-btn"));
    const controlKey = `Go to slide ${ordinal}`;
    const control = controls.find((candidate) => candidate.getAttribute("aria-label") === controlKey);
    const root = interactionRoot(carousel);
    const container = containerIdentity("process", root, carousel, document);
    const label = normalise(slide.querySelector<HTMLElement>("h1,h2,h3,h4,h5,h6")?.textContent)
      || normalise(slide.getAttribute("aria-label")).replace(/^\d+\s+of\s+\d+\s*/iu, "");
    const context = container && control && label ? {
      version: 1 as const, kind: "process" as const, container,
      item: { ordinal, count: slides.length, label, control_key: controlKey },
    } : null;
    return validateRiseInteractionContext(context);
  }
  return null;
}

function resolveContainer(context: RiseInteractionContext, document: Document): { root: Element; interaction: Element } | "not-ready" | "mismatch" {
  const candidates = context.kind === "tabs" ? tabInteractions(document) : processInteractions(document);
  if (!candidates.length) return "not-ready";
  let matches: Array<{ root: Element; interaction: Element }>;
  if (context.container.block_id !== null) matches = candidates.filter(({ root }) => root.getAttribute("data-block-id") === context.container.block_id);
  else matches = candidates.filter((_entry, index) => index + 1 === context.container.ordinal);
  if (matches.length !== 1) return "mismatch";
  const match = matches[0];
  return normalisedEqual(fingerprint(context.kind, match.root, match.interaction, document), context.container.fingerprint) ? match : "mismatch";
}

function visible(element: HTMLElement): boolean {
  return !element.hidden && element.getAttribute("aria-hidden") !== "true";
}

export function isRiseInteractionContextActive(value: RiseInteractionContext, document: Document): boolean {
  const context = validateRiseInteractionContext(value);
  if (!context) return false;
  const resolved = resolveContainer(context, document);
  if (typeof resolved === "string") return false;

  if (context.kind === "tabs") {
    const controls = Array.from(resolved.interaction.querySelectorAll<HTMLElement>('[role="tab"]'));
    const control = controls[context.item.ordinal - 1];
    if (controls.length !== context.item.count || !control
      || control.getAttribute("aria-controls") !== context.item.control_key
      || !normalisedEqual(control.textContent || control.getAttribute("aria-label") || "", context.item.label)) return false;
    const matchingPanels = Array.from(resolved.root.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
      .filter((panel) => panel.id === context.item.control_key);
    return matchingPanels.length === 1 && control.getAttribute("aria-selected") === "true";
  }

  const slides = Array.from(resolved.interaction.querySelectorAll<HTMLElement>(".carousel-slide"));
  const controls = Array.from(resolved.interaction.querySelectorAll<HTMLElement>(".carousel-controls-item-btn"));
  const slide = slides[context.item.ordinal - 1];
  const matchingControls = controls.filter((control) => control.getAttribute("aria-label") === context.item.control_key);
  if (slides.length !== context.item.count || controls.length !== context.item.count || !slide || matchingControls.length !== 1) return false;
  const label = normalise(slide.querySelector<HTMLElement>("h1,h2,h3,h4,h5,h6")?.textContent)
    || normalise(slide.getAttribute("aria-label")).replace(/^\d+\s+of\s+\d+\s*/iu, "");
  return normalisedEqual(label, context.item.label)
    && matchingControls[0].getAttribute("aria-current") === "true"
    && visible(slide);
}

export function restoreRiseInteractionContext(value: RiseInteractionContext, document: Document): RestoreRiseInteractionResult {
  const context = validateRiseInteractionContext(value);
  if (!context) return "mismatch";
  const resolved = resolveContainer(context, document);
  if (typeof resolved === "string") return resolved;

  if (context.kind === "tabs") {
    const controls = Array.from(resolved.interaction.querySelectorAll<HTMLElement>('[role="tab"]'));
    if (!controls.length) return "not-ready";
    if (controls.length !== context.item.count) return "mismatch";
    const control = controls[context.item.ordinal - 1];
    if (!control || !normalisedEqual(control.textContent || control.getAttribute("aria-label") || "", context.item.label)
      || control.getAttribute("aria-controls") !== context.item.control_key) return "mismatch";
    const panels = Array.from(resolved.root.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
    const panel = panels.find((candidate) => candidate.id === context.item.control_key);
    if (!panel || panels.filter((candidate) => candidate.id === context.item.control_key).length !== 1) return "mismatch";
    if (control.getAttribute("aria-selected") !== "true" || !visible(panel)) control.click();
    return control.getAttribute("aria-selected") === "true" && visible(panel) ? "ready" : "not-ready";
  }

  const slides = Array.from(resolved.interaction.querySelectorAll<HTMLElement>(".carousel-slide"));
  const controls = Array.from(resolved.interaction.querySelectorAll<HTMLElement>(".carousel-controls-item-btn"));
  if (!slides.length || !controls.length) return "not-ready";
  if (slides.length !== context.item.count || controls.length !== context.item.count) return "mismatch";
  const slide = slides[context.item.ordinal - 1];
  const label = normalise(slide?.querySelector<HTMLElement>("h1,h2,h3,h4,h5,h6")?.textContent)
    || normalise(slide?.getAttribute("aria-label")).replace(/^\d+\s+of\s+\d+\s*/iu, "");
  const matchingControls = controls.filter((candidate) => candidate.getAttribute("aria-label") === context.item.control_key);
  if (!slide || !normalisedEqual(label, context.item.label) || matchingControls.length !== 1) return "mismatch";
  const control = matchingControls[0];
  if (control.getAttribute("aria-current") !== "true" || !visible(slide)) control.click();
  return control.getAttribute("aria-current") === "true" && visible(slide) ? "ready" : "not-ready";
}

export function interactionContextLabel(context: RiseInteractionContext): string {
  return context.kind === "tabs"
    ? `Tab: ${context.item.label}`
    : `Step ${context.item.ordinal} of ${context.item.count}: ${context.item.label}`;
}
