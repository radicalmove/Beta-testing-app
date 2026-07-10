import { normalizeErrorMessage } from "./background-bridge.ts";

type Comment = { id?: string; [key: string]: unknown };
type Dependencies<TPayload> = {
  createComment(payload: TPayload): Promise<Comment>;
  captureVisibleTab(): Promise<Blob>;
  uploadScreenshot(commentId: string, blob: Blob): Promise<unknown>;
};

export async function createCommentWithOptionalScreenshot<TPayload>(payload: TPayload, screenshot: boolean, dependencies: Dependencies<TPayload>): Promise<any> {
  const comment = await dependencies.createComment(payload);
  if (!screenshot || typeof comment.id !== "string") return comment;
  try {
    const blob = await dependencies.captureVisibleTab();
    const attachment = await dependencies.uploadScreenshot(comment.id, blob);
    return { ...comment, attachment };
  } catch (error) {
    return { ...comment, comment_saved: true, screenshot_failed: true, screenshot_error: normalizeErrorMessage(error) };
  }
}
