import { recoverPinAnchor } from "./anchors/pin.ts";
import { recoverTextAnchor, renderTextHighlight } from "./anchors/recover.ts";
import type { PageComment } from "./background-bridge.ts";
import { createSaveIcon } from "./ui/save-icon.ts";
import { projectCourseComments } from "./course-comment-order.ts";

export type UnresolvedAnchor = { id: string; label: string; quote?: string };

export type CommentRenderer = {
  setComments(comments: PageComment[]): void;
  takeToContext(commentId: string): boolean;
  destroy(): void;
};

export type CommentRendererOptions = {
  root?: ShadowRoot;
  editThread?: (commentId: string, body: string) => Promise<void>;
  replyThread?: (commentId: string, body: string) => Promise<void>;
  uploadAttachment?: (commentId: string, dataUrl: string) => Promise<void>;
  changeStatus?: (commentId: string, status: string) => Promise<void>;
  manageSme?: (commentId: string, userIds?: string[]) => Promise<{ available_recipients: Array<{ id: string; display_name: string }>; selected_user_ids: string[] }>;
  deleteThread?: (commentId: string) => Promise<void>;
  navigateToComment?: (commentId: string, pageUrl: string) => Promise<void> | void;
  onUnresolvedAnchors?: (anchors: UnresolvedAnchor[]) => void;
};

const rendererStyles = `:host{all:initial;font:16px/1.5 Poppins,Arial,sans-serif;color:#102f38}button,textarea,input{box-sizing:border-box;font:inherit}button{appearance:none;min-height:36px;border:2px solid #073f3e;border-radius:5px;background:#fff;color:#073f3e;font-weight:650;padding:7px 9px;cursor:pointer}.thread-action:hover,.thread-action[aria-pressed="true"]{background:#073f3e;color:#fff}.thread-top-actions{display:contents}.thread-edit,.thread-delete,.resolve-toggle{position:absolute;top:8px;width:34px;min-height:34px;height:34px;padding:2px;border-radius:5px}.thread-edit{right:92px;border:2px solid #a84f12;background:#fff;color:#a84f12;font-size:23px;line-height:1}.thread-edit:hover,.thread-edit[aria-pressed="true"]{background:#a84f12;color:#fff}.thread-delete{right:8px;border:2px solid #d73b3d;background:#d73b3d;color:#fff}.thread-delete svg,.resolve-toggle svg{display:block;width:100%;height:100%}.thread-delete:hover{border-color:#d73b3d;background:#fff}.thread-delete:hover .delete-body{fill:#d73b3d}.thread-delete:hover .delete-lines{stroke:#fff}.resolve-toggle{right:50px;margin:0;border:2px solid #111;border-radius:2px;background:#fff}.resolve-toggle:hover{border-color:#111;background:#f4f4f4}.status-hover-tick{opacity:0;transition:opacity .15s ease}.resolve-toggle:hover .status-hover-tick{opacity:.28}.status-resolved-tick{opacity:1}.thread-navigation{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.thread-navigation button{height:34px;min-height:34px;padding:3px 6px;white-space:nowrap}.thread-navigation button:disabled{cursor:default;opacity:.42}.thread-previous,.thread-next{border-color:#356f9f;color:#356f9f}.thread-previous:not(:disabled):hover,.thread-next:not(:disabled):hover{background:#356f9f;color:#fff}.thread-reply{border-color:#073f3e;color:#073f3e}.thread-reply:hover,.thread-reply[aria-expanded="true"]{background:#073f3e;color:#fff}.comment-composer-field-row{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:8px;align-items:start;margin-right:-6px}.comment-composer-field-row textarea{min-width:0;width:100%;min-height:72px}.comment-composer-save{box-sizing:border-box;width:34px;height:34px;min-height:34px;padding:2px;border:2px solid #176b43;border-radius:5px;background:#176b43;color:#fff}.comment-composer-save svg{display:block;width:100%;height:100%}.comment-composer-save:hover{background:#fff;color:#176b43}.comment-composer-actions{display:flex;justify-content:flex-end;margin-top:8px}.comment-composer-cancel{box-sizing:border-box;width:calc((100% - 16px)/3);height:34px;min-height:34px;padding:3px 9px;border:2px solid #d73b3d;border-radius:5px;background:#d73b3d;color:#fff;font:inherit;font-weight:650;line-height:1}.comment-composer-cancel:hover{background:#fff;color:#d73b3d}.attachment-field{display:block;margin:10px 0;font-size:13px;font-weight:650}.attachment-field input{display:block;width:100%;margin-top:4px;font-size:12px;font-weight:400}`;

const attachmentAccept = ".pdf,.doc,.docx,.png,.jpg,.jpeg,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg";
const maxAttachmentBytes = 10 * 1024 * 1024;

function attachmentField(document: Document): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label"); label.className = "attachment-field"; label.textContent = "Attach a file (optional)";
  const input = document.createElement("input"); input.type = "file"; input.dataset.attachment = "true"; input.accept = attachmentAccept;
  label.append(input); return { label, input };
}

function createComposerControls(document: Document, kind: "edit" | "reply", saveLabel: string, attachmentEnabled: boolean) {
  const composer = document.createElement("div"); composer.className = "comment-composer"; composer.dataset[kind === "edit" ? "editComposer" : "replyComposer"] = "true";
  const textarea = document.createElement("textarea");
  const { label: attachmentLabel, input: attachment } = attachmentField(document); attachmentLabel.hidden = !attachmentEnabled;
  const save = document.createElement("button"); save.type = "button"; save.className = "comment-composer-save"; save.dataset[kind === "edit" ? "saveEdit" : "saveReply"] = "true"; save.setAttribute("aria-label", saveLabel); save.title = saveLabel; save.append(createSaveIcon(document));
  const fieldRow = document.createElement("div"); fieldRow.className = "comment-composer-field-row"; fieldRow.dataset.composerFieldRow = "true"; fieldRow.append(textarea, save);
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "comment-composer-cancel"; cancel.textContent = "Cancel";
  const actions = document.createElement("div"); actions.className = "comment-composer-actions"; actions.dataset.composerActions = "true"; actions.append(cancel);
  composer.append(fieldRow, attachmentLabel);
  return { composer, textarea, attachment, save, actions, cancel };
}

function readAttachment(document: Document, file: File): Promise<string> {
  if (file.size > maxAttachmentBytes) return Promise.reject(new Error("The attachment must be 10 MB or smaller."));
  return new Promise((resolve, reject) => {
    const Reader = document.defaultView?.FileReader;
    if (!Reader) { reject(new Error("This browser cannot read the selected attachment.")); return; }
    const reader = new Reader(); reader.addEventListener("load", () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read attachment")));
    reader.addEventListener("error", () => reject(new Error("Could not read attachment"))); reader.readAsDataURL(file);
  });
}

function deleteIcon(document: Document): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<path class="delete-body" d="M4 6h16l-1.4 15H5.4L4 6Z" fill="white"/><path class="delete-body" d="M8 3h8l1 2H7l1-2ZM3 5h18v2H3V5Z" fill="white"/><path class="delete-lines" d="M8.5 9v8M12 9v8M15.5 9v8" stroke="#d73b3d" stroke-width="1.8" stroke-linecap="round"/>';
  return svg;
}

function statusIcon(document: Document, resolved: boolean): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 34 34"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("class", resolved ? "status-resolved-tick" : "status-hover-tick"); path.setAttribute("d", "M5.5 18c3 1.5 5 3.5 7.2 6C17 17.5 21 11.5 28 6.8"); path.setAttribute("fill", "none"); path.setAttribute("stroke", "#176b43"); path.setAttribute("stroke-width", "3.5"); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round"); svg.append(path);
  return svg;
}

function createThreadRoot(document: Document): { root: ShadowRoot; dispose: () => void } {
  const host = document.createElement("div");
  host.dataset.moodleReviewRendererRoot = "true";
  host.setAttribute("data-moodle-review-ui", "true");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style"); style.dataset.commentRendererStyles = "true"; style.textContent = rendererStyles; root.append(style);
  document.documentElement.append(host);
  return { root, dispose: () => host.remove() };
}

export function createCommentRenderer(document: Document, pageUrl: string, options: CommentRendererOptions = {}): CommentRenderer {
  const ownedRoot = options.root ? undefined : createThreadRoot(document);
  const root = options.root ?? ownedRoot!.root;
  if (options.root && !root.querySelector("style[data-comment-renderer-styles]")) {
    const style = document.createElement("style"); style.dataset.commentRendererStyles = "true"; style.textContent = rendererStyles; root.append(style);
  }
  let comments = new Map<string, PageComment>();
  let projectedComments: PageComment[] = [];
  let courseOpenComments: PageComment[] = [];
  let cleanups: Array<() => void> = [];
  let markers = new Map<string, HTMLElement>();
  let activeThreadId: string | undefined;
  let popoverCleanup: (() => void) | undefined;
  let pendingProjection: PageComment[] | undefined;
  let deferredThreadId: string | undefined;
  let applyComments: (next: PageComment[]) => void;
  let mutationDepth = 0;
  const repositioners = new Set<() => void>();
  let repositionFrame: number | undefined;
  let repositionListening = false;
  const repositionAll = () => { repositionFrame = undefined; for (const reposition of repositioners) reposition(); };
  const scheduleReposition = () => { if (repositionFrame === undefined) repositionFrame = document.defaultView?.requestAnimationFrame(repositionAll); };
  const startRepositioning = () => { if (repositionListening) return; repositionListening = true; document.defaultView?.addEventListener("resize", scheduleReposition); document.defaultView?.addEventListener("scroll", scheduleReposition, true); };
  const stopRepositioning = () => { if (!repositionListening) return; repositionListening = false; document.defaultView?.removeEventListener("resize", scheduleReposition); document.defaultView?.removeEventListener("scroll", scheduleReposition, true); if (repositionFrame !== undefined) document.defaultView?.cancelAnimationFrame(repositionFrame); repositionFrame = undefined; repositioners.clear(); };

  const closeThread = (flushProjection = true) => {
    popoverCleanup?.(); popoverCleanup = undefined;
    root.querySelector("[data-thread-popover]")?.remove();
    if (activeThreadId) markers.get(activeThreadId)?.setAttribute("aria-expanded", "false");
    activeThreadId = undefined;
    if (flushProjection && pendingProjection) { const next = pendingProjection; pendingProjection = undefined; applyComments(next); }
  };

  const showError = (article: HTMLElement, error: unknown, fallback: string) => {
    const alert = document.createElement("p"); alert.setAttribute("role", "alert"); alert.textContent = error instanceof Error ? error.message : fallback; article.append(alert);
  };
  const runMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    mutationDepth += 1;
    try { return await operation(); }
    finally {
      mutationDepth -= 1;
      if (mutationDepth === 0 && deferredThreadId) deferredThreadId = undefined;
    }
  };

  const openThread = (comment: PageComment, index: number, marker: HTMLElement) => {
    if (activeThreadId && activeThreadId !== comment.id && pendingProjection) {
      const requestedId = comment.id; const next = pendingProjection; pendingProjection = undefined;
      applyComments(next);
      const refreshedComment = comments.get(requestedId); const refreshedMarker = markers.get(requestedId);
      if (refreshedComment && refreshedMarker) openThread(refreshedComment, Array.from(comments.keys()).indexOf(requestedId), refreshedMarker);
      else deferredThreadId = requestedId;
      return;
    }
    deferredThreadId = undefined;
    if (activeThreadId === comment.id && root.querySelector("[data-thread-popover]")) { closeThread(); marker.focus(); return; }
    closeThread(false);
    activeThreadId = comment.id; marker.setAttribute("aria-expanded", "true");
    const article = document.createElement("article"); article.dataset.threadPopover = "true"; article.tabIndex = -1;
    const courseIndex = courseOpenComments.findIndex((candidate) => candidate.id === comment.id);
    const contextLine = document.createElement("p"); contextLine.dataset.threadPosition = "true"; contextLine.textContent = courseIndex >= 0 ? `Comment ${courseIndex + 1} of ${courseOpenComments.length}` : "Resolved comment"; contextLine.style.cssText = "margin:0 126px 4px 0;font-size:12px;color:#52666c";
    const byline = document.createElement("p"); byline.textContent = `${comment.author.display_name} · ${comment.author.role.replaceAll("_", " ")}`; byline.style.cssText = "margin:0 126px 10px 0;font-size:13px;font-weight:650";
    const body = document.createElement("div"); body.textContent = comment.body; body.style.cssText = "padding:12px;border:1px solid #8ad9d8;border-radius:8px;background:#effafa";
    const topActions = document.createElement("div"); topActions.className = "thread-top-actions"; topActions.dataset.threadTopActions = "true";
    article.append(contextLine, byline, body, topActions);

    if (comment.capabilities.can_edit && options.editThread) {
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "thread-edit"; edit.textContent = "✎"; edit.setAttribute("aria-label", "Edit original comment"); edit.title = "Edit comment";
      edit.addEventListener("click", () => {
        const existing = article.querySelector<HTMLElement>("[data-edit-composer]");
        if (existing) { existing.remove(); article.querySelector("[data-composer-actions]")?.remove(); edit.setAttribute("aria-pressed", "false"); body.hidden = false; edit.focus(); return; }
        article.querySelector("[data-reply-composer]")?.remove(); article.querySelector("[data-composer-actions]")?.remove(); article.querySelector<HTMLElement>("[data-reply-toggle]")?.setAttribute("aria-expanded", "false");
        const { composer: editor, textarea: input, attachment, save, actions, cancel } = createComposerControls(document, "edit", "Save edited comment", Boolean(options.uploadAttachment));
        input.value = body.textContent ?? comment.body;
        cancel.dataset.cancelEdit = "true";
        const close = () => { editor.remove(); actions.remove(); edit.setAttribute("aria-pressed", "false"); body.hidden = false; edit.focus(); };
        cancel.addEventListener("click", close);
        save.addEventListener("click", async () => { if (!input.value.trim()) return; save.disabled = true; try { await runMutation(() => options.editThread!(comment.id, input.value.trim())); const file = attachment.files?.[0]; if (file && options.uploadAttachment) await runMutation(async () => options.uploadAttachment!(comment.id, await readAttachment(document, file))); body.textContent = input.value.trim(); close(); } catch (error) { save.disabled = false; showError(article, error, "Could not save edit"); } });
        body.hidden = true; body.after(editor); article.querySelector("[data-thread-navigation]")?.after(actions); edit.setAttribute("aria-pressed", "true"); input.focus();
      });
      topActions.append(edit);
    }

    for (const reply of comment.replies) { const node = document.createElement("div"); node.textContent = `${reply.author.display_name} (${reply.author.role.replaceAll("_", " ")}): ${reply.body}`; node.style.cssText = "margin-top:8px;padding:10px;border:1px solid #d7e6e6;border-radius:8px"; article.append(node); }

    let replyToggle: HTMLButtonElement | undefined;
    if (comment.capabilities.can_reply && options.replyThread) {
      const toggle = document.createElement("button"); replyToggle = toggle; toggle.type = "button"; toggle.className = "thread-reply"; toggle.dataset.replyToggle = "true"; toggle.textContent = "Reply";
      toggle.addEventListener("click", () => {
        const existing = article.querySelector<HTMLElement>("[data-reply-composer]");
        if (existing) { existing.remove(); article.querySelector("[data-composer-actions]")?.remove(); toggle.setAttribute("aria-expanded", "false"); toggle.focus(); return; }
        const openEditor = article.querySelector<HTMLElement>("[data-edit-composer]");
        if (openEditor) {
          openEditor.remove();
          article.querySelector("[data-composer-actions]")?.remove();
          body.hidden = false;
          article.querySelector<HTMLElement>('[aria-label="Edit original comment"]')?.setAttribute("aria-pressed", "false");
        }
        const { composer, textarea: input, attachment, save, actions, cancel } = createComposerControls(document, "reply", "Save reply", Boolean(options.uploadAttachment));
        input.placeholder = "Add a reply…"; input.setAttribute("aria-label", "Add a reply");
        const close = () => { composer.remove(); actions.remove(); toggle.setAttribute("aria-expanded", "false"); toggle.focus(); };
        cancel.addEventListener("click", close);
        save.addEventListener("click", async () => { const value = input.value.trim(); if (!value) return; save.disabled = true; try { await runMutation(() => options.replyThread!(comment.id, value)); const file = attachment.files?.[0]; if (file && options.uploadAttachment) await runMutation(async () => options.uploadAttachment!(comment.id, await readAttachment(document, file))); const node = document.createElement("div"); node.textContent = value; node.style.cssText = "margin-top:8px;padding:10px;border:1px solid #d7e6e6;border-radius:8px"; toggle.before(node); close(); } catch (error) { save.disabled = false; showError(article, error, "Could not save reply"); } });
        article.querySelector("[data-thread-navigation]")?.before(composer); article.querySelector("[data-thread-navigation]")?.after(actions); toggle.setAttribute("aria-expanded", "true"); input.focus();
      });
    }

    if (comment.capabilities.can_share_with_sme && options.manageSme) {
      const ask = document.createElement("button"); ask.type = "button"; ask.textContent = "Ask SME";
      ask.addEventListener("click", async () => { ask.disabled = true; try { const state = await runMutation(() => options.manageSme!(comment.id)); const chooser = document.createElement("div"); chooser.style.cssText = "margin-top:10px;padding:10px;border:1px solid #8ad9d8;border-radius:8px"; const boxes: HTMLInputElement[] = []; for (const sme of state.available_recipients) { const label = document.createElement("label"); label.style.display = "block"; const box = document.createElement("input"); box.type = "checkbox"; box.value = sme.id; box.checked = state.selected_user_ids.includes(sme.id); boxes.push(box); label.append(box, ` ${sme.display_name}`); chooser.append(label); } const save = document.createElement("button"); save.type = "button"; save.textContent = "Save SME access"; save.addEventListener("click", async () => { save.disabled = true; await runMutation(() => options.manageSme!(comment.id, boxes.filter((box) => box.checked).map((box) => box.value))); chooser.remove(); ask.disabled = false; }); chooser.append(save); ask.after(chooser); } catch { ask.disabled = false; } });
      article.append(ask);
    }

    if (comment.capabilities.can_change_status && options.changeStatus) {
      const target = comment.status === "resolved" ? "open" : "resolved";
      const button = document.createElement("button"); button.type = "button"; button.className = `resolve-toggle${comment.status === "resolved" ? " resolved" : ""}`; button.append(statusIcon(document, comment.status === "resolved")); button.setAttribute("aria-label", target === "resolved" ? "Resolve this comment" : "Reopen this resolved comment"); button.title = target === "resolved" ? "Resolve comment" : "Reopen comment";
      button.addEventListener("click", async () => { button.disabled = true; try { await runMutation(() => options.changeStatus!(comment.id, target)); if (target === "resolved") { button.replaceChildren(statusIcon(document, true)); button.classList.add("resolved"); document.defaultView?.setTimeout(() => { if (activeThreadId === comment.id) closeThread(); else article.remove(); }, 3000); } else closeThread(); } catch (error) { button.disabled = false; showError(article, error, "Could not update status"); } });
      topActions.append(button);
    }

    if (comment.capabilities.can_delete && options.deleteThread) {
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "thread-delete"; remove.append(deleteIcon(document)); remove.setAttribute("aria-label", "Delete thread"); remove.title = "Delete comment thread";
      remove.addEventListener("click", async () => { if (document.defaultView?.confirm && !document.defaultView.confirm("Delete this entire thread, including all replies and screenshots?")) return; remove.disabled = true; try { await runMutation(() => options.deleteThread!(comment.id)); closeThread(); } catch (error) { remove.disabled = false; showError(article, error, "Could not delete thread"); } });
      topActions.append(remove);
    }

    const navigation = document.createElement("div"); navigation.className = "thread-navigation"; navigation.dataset.threadNavigation = "true";
    const navigate = async (target: PageComment | undefined) => {
      if (!target) return;
      if (target.page_url === pageUrl) { closeThread(); document.defaultView?.setTimeout(() => { (root.host as HTMLElement).isConnected && (markers.get(target.id) ? (() => { const targetMarker = markers.get(target.id)!; targetMarker.focus({ preventScroll: true }); openThread(target, Array.from(comments.keys()).indexOf(target.id), targetMarker); })() : undefined); }, 0); }
      else await options.navigateToComment?.(target.id, target.page_url);
    };
    const previous = document.createElement("button"); previous.type = "button"; previous.className = "thread-previous"; previous.dataset.direction = "previous"; previous.textContent = "Previous"; previous.disabled = courseIndex <= 0; previous.addEventListener("click", () => void navigate(courseOpenComments[courseIndex - 1]));
    const next = document.createElement("button"); next.type = "button"; next.className = "thread-next"; next.dataset.direction = "next"; next.textContent = "Next"; next.disabled = courseIndex < 0 || courseIndex >= courseOpenComments.length - 1; next.addEventListener("click", () => void navigate(courseOpenComments[courseIndex + 1]));
    const reply = replyToggle ?? document.createElement("button"); if (!replyToggle) { reply.type = "button"; reply.className = "thread-reply"; reply.textContent = "Reply"; reply.disabled = true; }
    navigation.append(previous, reply, next); article.append(navigation);

    const position = () => { const rect = marker.getBoundingClientRect(); const width = document.defaultView?.innerWidth ?? 800; const height = document.defaultView?.innerHeight ?? 600; article.hidden = rect.top < 0 || rect.left < 0 || rect.bottom > height || rect.right > width; if (article.hidden) return; const popoverWidth = Math.min(360, width - 16); const popoverHeight = Math.min(article.offsetHeight || 300, height - 16); const right = rect.right + 8; article.style.left = `${right + popoverWidth <= width - 8 ? right : Math.max(8, rect.left - popoverWidth - 8)}px`; article.style.top = `${Math.max(8, Math.min(height - popoverHeight - 8, rect.top))}px`; };
    article.style.cssText += ";position:fixed;pointer-events:auto;z-index:2147483647;width:min(360px,calc(100vw - 16px));max-height:min(480px,calc(100vh - 16px));overflow:auto;background:white;border:4px solid #28c4c2;border-radius:10px;padding:14px;box-shadow:0 8px 28px #0006";
    root.append(article); position();
    document.defaultView?.addEventListener("scroll", position, true); document.defaultView?.addEventListener("resize", position);
    popoverCleanup = () => { document.defaultView?.removeEventListener("scroll", position, true); document.defaultView?.removeEventListener("resize", position); article.remove(); };
    article.focus();
  };

  const clear = () => { closeThread(false); for (const cleanup of cleanups) cleanup(); cleanups = []; stopRepositioning(); markers.clear(); comments.clear(); };

  const renderMarker = (comment: PageComment, index: number, place: (marker: HTMLElement) => void) => {
    const marker = document.createElement("button"); marker.type = "button"; marker.setAttribute("aria-label", `Open feedback: ${comment.body}`); marker.title = "Open comment"; marker.setAttribute("aria-expanded", "false"); marker.textContent = "💬"; marker.style.cssText = "position:fixed;z-index:900;width:38px;height:38px;border:2px solid #0b6261;border-radius:10px;background:#28c4c2;color:#082f2f;padding:4px;font:20px/1 sans-serif;box-shadow:0 3px 10px #0005";
    marker.addEventListener("click", () => openThread(comment, index, marker)); document.documentElement.append(marker); markers.set(comment.id, marker);
    const reposition = () => place(marker); repositioners.add(reposition); startRepositioning(); reposition();
    cleanups.push(() => { repositioners.delete(reposition); marker.remove(); });
  };

  applyComments = (next) => {
      clear();
      projectedComments = [...next];
      courseOpenComments = projectCourseComments(next.filter((comment) => comment.status !== "resolved")).groups.flatMap((group) => group.comments.map(({ comment }) => comment));
      root.querySelectorAll("[data-recovery-status], [data-recovery-quote]").forEach((node) => node.remove());
      const local = next.filter((comment) => comment.page_url === pageUrl);
      comments = new Map(local.map((comment) => [comment.id, comment]));
      const unresolved: UnresolvedAnchor[] = [];
      for (const [index, comment] of local.entries()) {
        if (comment.anchor_type === "text_highlight" && comment.selected_quote) {
          const recovered = recoverTextAnchor(document, { selected_quote: comment.selected_quote, prefix: comment.prefix ?? "", suffix: comment.suffix ?? "" });
          if (recovered.status === "unresolved") unresolved.push({ id: comment.id, label: `${comment.page_title} · ${comment.body}`, quote: comment.selected_quote });
          else {
            cleanups.push(renderTextHighlight(document, recovered.range));
            renderMarker(comment, index, (marker) => { const rect = recovered.range.getBoundingClientRect(); marker.hidden = rect.width === 0 && rect.height === 0; marker.style.left = `${Math.max(0, rect.left)}px`; marker.style.top = `${Math.max(0, rect.bottom + 4)}px`; });
            markers.get(comment.id)!.id = `moodle-review-highlight-${comment.id}`; markers.get(comment.id)!.dataset.moodleReviewStoredHighlight = comment.id;
          }
        } else if (comment.anchor_type === "visual_pin" && comment.css_selector && comment.relative_x !== null && comment.relative_y !== null) {
          const anchor = { css_selector: comment.css_selector, relative_x: comment.relative_x, relative_y: comment.relative_y };
          const recovered = recoverPinAnchor(document, anchor);
          if (recovered.status === "unresolved") unresolved.push({ id: comment.id, label: `${comment.page_title} · ${comment.body}` });
          else {
            renderMarker(comment, index, (marker) => { const position = recoverPinAnchor(document, anchor); marker.hidden = position.status !== "resolved"; if (position.status === "resolved") { marker.style.left = `${position.x}px`; marker.style.top = `${position.y}px`; } });
            const marker = markers.get(comment.id)!; marker.dataset.moodleReviewStoredPin = comment.id; marker.style.transform = "translate(-50%,-50%)";
          }
        }
      }
      options.onUnresolvedAnchors?.(unresolved);
  };

  return {
    setComments(next) {
      if (mutationDepth > 0 && activeThreadId && root.querySelector("[data-thread-popover]")) { pendingProjection = [...next]; return; }
      pendingProjection = undefined;
      applyComments(next);
      if (deferredThreadId) {
        const requestedId = deferredThreadId;
        const refreshedComment = comments.get(requestedId);
        const refreshedMarker = markers.get(requestedId);
        if (refreshedComment && refreshedMarker) {
          deferredThreadId = undefined;
          openThread(refreshedComment, Array.from(comments.keys()).indexOf(requestedId), refreshedMarker);
        } else if (mutationDepth === 0) deferredThreadId = undefined;
      }
    },
    takeToContext(commentId) {
      let comment = comments.get(commentId); let marker = markers.get(commentId);
      if (!comment) return false;
      if (!marker) {
        const snapshot = [...projectedComments];
        this.setComments(snapshot);
        comment = comments.get(commentId); marker = markers.get(commentId);
      }
      if (!comment || !marker) {
        root.querySelectorAll(`[data-recovery-status="${commentId}"], [data-recovery-quote="${commentId}"]`).forEach((node) => node.remove());
        const status = document.createElement("p"); status.dataset.recoveryStatus = commentId; status.setAttribute("role", "status"); status.textContent = "The original content could not be found on this page";
        const quote = document.createElement("blockquote"); quote.dataset.recoveryQuote = commentId; quote.textContent = comment?.selected_quote || (comment ? `${comment.page_title} · ${comment.body}` : "Comment context unavailable"); root.append(status, quote);
        return false;
      }
      let anchorY: number | undefined;
      if (comment.anchor_type === "text_highlight" && comment.selected_quote) {
        const recovered = recoverTextAnchor(document, { selected_quote: comment.selected_quote, prefix: comment.prefix ?? "", suffix: comment.suffix ?? "" });
        if (recovered.status === "resolved") (recovered.range.commonAncestorContainer.nodeType === 1 ? recovered.range.commonAncestorContainer as HTMLElement : recovered.range.commonAncestorContainer.parentElement)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      } else if (comment.css_selector && comment.relative_x !== null && comment.relative_y !== null) {
        const recovered = recoverPinAnchor(document, { css_selector: comment.css_selector, relative_x: comment.relative_x, relative_y: comment.relative_y });
        if (recovered.status === "resolved") anchorY = recovered.y;
      }
      if (anchorY !== undefined && document.defaultView) document.defaultView.scrollBy({ top: anchorY - document.defaultView.innerHeight / 2, behavior: "auto" });
      marker.focus({ preventScroll: true }); openThread(comment, Array.from(comments.keys()).indexOf(commentId), marker); return true;
    },
    destroy() { pendingProjection = undefined; deferredThreadId = undefined; clear(); projectedComments = []; courseOpenComments = []; options.onUnresolvedAnchors?.([]); ownedRoot?.dispose(); },
  };
}
