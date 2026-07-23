export type FixtureRole = "beta_tester" | "sme" | "ld_dcd";
export type FixtureViewer = { role: FixtureRole; userId: string; email: string; displayName?: string };

type Anchor = {
  page_url: string; page_title: string; body: string; category: string;
  parent_activity_url?: string | null; embedded_locator?: string | null;
  interaction_context?: unknown | null;
  anchor_type: "text_highlight" | "visual_pin";
  selected_quote: string | null; prefix: string | null; suffix: string | null;
  css_selector: string | null; dom_selector: string | null;
  relative_x: number | null; relative_y: number | null;
};

type Reply = { id: string; body: string; authorId: string; author: { display_name: string; role: FixtureRole } };
type Comment = Anchor & {
  id: string; status: "open"; authorId: string; author: { display_name: string; role: FixtureRole };
  replies: Reply[]; status_history: unknown[]; sharedSmeIds: Set<string>;
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export class StatefulCommentBackend {
  private viewer: FixtureViewer = { role: "beta_tester", userId: uuid(1), email: "beta@example.test" };
  private comments: Comment[] = [];
  private sequence = 10;

  setViewer(viewer: FixtureViewer) { this.viewer = viewer; }

  create(input: Anchor) {
    const comment: Comment = { parent_activity_url: null, embedded_locator: null, interaction_context: null, ...input, id: uuid(this.sequence++), status: "open", authorId: this.viewer.userId, author: this.publicAuthor(this.viewer), replies: [], status_history: [], sharedSmeIds: new Set() };
    if (this.viewer.role === "beta_tester") this.addReply(comment, { role: "ld_dcd", userId: uuid(2), email: "ld@example.test" }, "Fixture LD reply");
    this.comments.push(comment);
    return { id: comment.id, screenshot_available: false };
  }

  reply(commentId: string, author: FixtureViewer, body: string) {
    const comment = this.required(commentId);
    this.addReply(comment, author, body);
  }

  share(commentId: string, selectedSmeId: string) { this.required(commentId).sharedSmeIds.add(selectedSmeId); }

  list(pageUrl: string) {
    return this.comments.filter((comment) => comment.page_url === pageUrl && this.canView(comment)).map(({ authorId: _authorId, sharedSmeIds: _shares, ...comment }) => ({
      ...comment,
      replies: comment.replies.filter((reply) => this.viewer.role !== "beta_tester" || reply.authorId === this.viewer.userId || reply.author.role === "ld_dcd").map(({ authorId: _replyAuthorId, ...reply }) => reply),
    }));
  }

  private canView(comment: Comment) {
    if (this.viewer.role === "ld_dcd") return true;
    if (this.viewer.role === "beta_tester") return comment.author.role === "beta_tester" && comment.authorId === this.viewer.userId;
    return comment.author.role === "sme" || (comment.author.role === "beta_tester" && comment.sharedSmeIds.has(this.viewer.userId));
  }

  private addReply(comment: Comment, author: FixtureViewer, body: string) { comment.replies.push({ id: uuid(this.sequence++), body, authorId: author.userId, author: this.publicAuthor(author) }); }
  private publicAuthor(author: FixtureViewer) { return { display_name: author.displayName ?? author.email.split("@", 1)[0], role: author.role }; }
  private required(id: string) { const comment = this.comments.find((entry) => entry.id === id); if (!comment) throw new Error(`Unknown fixture comment ${id}`); return comment; }
}
