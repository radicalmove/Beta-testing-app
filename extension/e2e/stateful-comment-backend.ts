export type FixtureRole = "beta_tester" | "sme" | "ld_dcd";
export type FixtureViewer = { role: FixtureRole; userId: string; email: string };

type Anchor = {
  page_url: string; page_title: string; body: string; category: string;
  anchor_type: "text_highlight" | "visual_pin";
  selected_quote: string | null; prefix: string | null; suffix: string | null;
  css_selector: string | null; dom_selector: string | null;
  relative_x: number | null; relative_y: number | null;
};

type Reply = { id: string; body: string; author_user_id: string; author_role: FixtureRole; author_email: string };
type Comment = Anchor & {
  id: string; status: "open"; author_user_id: string; author_role: FixtureRole; author_email: string;
  replies: Reply[]; status_history: unknown[]; sharedSmeIds: Set<string>;
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export class StatefulCommentBackend {
  private viewer: FixtureViewer = { role: "beta_tester", userId: uuid(1), email: "beta@example.test" };
  private comments: Comment[] = [];
  private sequence = 10;

  setViewer(viewer: FixtureViewer) { this.viewer = viewer; }

  create(input: Anchor) {
    const comment: Comment = { ...input, id: uuid(this.sequence++), status: "open", author_user_id: this.viewer.userId, author_role: this.viewer.role, author_email: this.viewer.email, replies: [], status_history: [], sharedSmeIds: new Set() };
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
    return this.comments.filter((comment) => comment.page_url === pageUrl && this.canView(comment)).map((comment) => ({
      ...comment,
      replies: comment.replies.filter((reply) => this.viewer.role !== "beta_tester" || reply.author_role === "ld_dcd").map((reply) => ({ ...reply })),
      sharedSmeIds: undefined,
    }));
  }

  private canView(comment: Comment) {
    if (this.viewer.role === "ld_dcd") return true;
    if (this.viewer.role === "beta_tester") return comment.author_role === "beta_tester" && comment.author_user_id === this.viewer.userId;
    return (comment.author_role === "sme" && comment.author_user_id === this.viewer.userId) || (comment.author_role === "beta_tester" && comment.sharedSmeIds.has(this.viewer.userId));
  }

  private addReply(comment: Comment, author: FixtureViewer, body: string) { comment.replies.push({ id: uuid(this.sequence++), body, author_user_id: author.userId, author_role: author.role, author_email: author.email }); }
  private required(id: string) { const comment = this.comments.find((entry) => entry.id === id); if (!comment) throw new Error(`Unknown fixture comment ${id}`); return comment; }
}
