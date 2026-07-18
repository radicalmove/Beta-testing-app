export type CourseCommentIdentity = {
  page_url: string;
  page_title: string;
};

export type ProjectedCourseComment<T extends CourseCommentIdentity> = {
  comment: T;
  displayIndex: number;
};

export type ProjectedCourseCommentGroup<T extends CourseCommentIdentity> = {
  pageUrl: string;
  title: string;
  comments: Array<ProjectedCourseComment<T>>;
};

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

function leadingCourseNumber(title: string): number[] | undefined {
  const match = normalize(title).match(/^(\d+(?:\.\d+)*)\b/);
  return match ? match[1]!.split(".").map(Number) : undefined;
}

function compareNumbers(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference) return difference;
  }
  return 0;
}

export function projectCourseComments<T extends CourseCommentIdentity>(comments: readonly T[]): { groups: Array<ProjectedCourseCommentGroup<T>> } {
  const pages = new Map<string, { pageUrl: string; title: string; firstSeen: number; comments: T[] }>();
  comments.forEach((comment, index) => {
    const title = normalize(comment.page_title) || "Untitled page";
    const existing = pages.get(comment.page_url);
    if (existing) existing.comments.push(comment);
    else pages.set(comment.page_url, { pageUrl: comment.page_url, title, firstSeen: index, comments: [comment] });
  });

  const ordered = Array.from(pages.values()).sort((left, right) => {
    const leftNumber = leadingCourseNumber(left.title);
    const rightNumber = leadingCourseNumber(right.title);
    if (Boolean(leftNumber) !== Boolean(rightNumber)) return leftNumber ? 1 : -1;
    if (leftNumber && rightNumber) {
      const numeric = compareNumbers(leftNumber, rightNumber);
      if (numeric) return numeric;
    }
    const title = left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" });
    if (title) return title;
    const url = left.pageUrl.localeCompare(right.pageUrl);
    return url || left.firstSeen - right.firstSeen;
  });

  let displayIndex = 0;
  return {
    groups: ordered.map((page) => ({
      pageUrl: page.pageUrl,
      title: page.title,
      comments: page.comments.map((comment) => ({ comment, displayIndex: ++displayIndex })),
    })),
  };
}
