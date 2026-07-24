export const COMMENT_LIST_ARRIVAL_KEY = "moodle-review:comment-list-arrival";

const COMMENT_LIST_ARRIVAL_VERSION = 1;
const COMMENT_LIST_ARRIVAL_TTL_MS = 5 * 60 * 1_000;

export type CommentListArrivalStatus = "open" | "resolved";

export interface CommentListArrival {
  version: 1;
  course_url: string;
  page_url: string;
  comment_id: string;
  status: CommentListArrivalStatus;
  created_at: number;
  token: string;
}

export interface CommentListArrivalInput {
  course_url: string;
  page_url: string;
  comment_id: string;
  status: CommentListArrivalStatus;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface WriteOptions {
  now?: () => number;
  token?: () => string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isArrival(value: unknown): value is CommentListArrival {
  if (!value || typeof value !== "object") {
    return false;
  }
  const arrival = value as Record<string, unknown>;
  return arrival.version === COMMENT_LIST_ARRIVAL_VERSION
    && isNonEmptyString(arrival.course_url)
    && isNonEmptyString(arrival.page_url)
    && isNonEmptyString(arrival.comment_id)
    && (arrival.status === "open" || arrival.status === "resolved")
    && typeof arrival.created_at === "number"
    && Number.isFinite(arrival.created_at)
    && isNonEmptyString(arrival.token);
}

function removeSafely(storage: StorageLike | undefined): void {
  try {
    storage?.removeItem(COMMENT_LIST_ARRIVAL_KEY);
  } catch {
    // Session storage must never be able to break the extension.
  }
}

function defaultToken(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}

export function writeCommentListArrival(
  storage: StorageLike | undefined,
  input: CommentListArrivalInput,
  options: WriteOptions = {},
): CommentListArrival | undefined {
  if (!storage) {
    return undefined;
  }
  const arrival: CommentListArrival = {
    version: COMMENT_LIST_ARRIVAL_VERSION,
    ...input,
    created_at: (options.now ?? Date.now)(),
    token: (options.token ?? defaultToken)(),
  };
  if (!isArrival(arrival)) {
    return undefined;
  }
  try {
    storage.setItem(COMMENT_LIST_ARRIVAL_KEY, JSON.stringify(arrival));
    return arrival;
  } catch {
    return undefined;
  }
}

export function peekCommentListArrival(
  storage: StorageLike | undefined,
  now: () => number = Date.now,
): CommentListArrival | undefined {
  if (!storage) {
    return undefined;
  }
  try {
    const encoded = storage.getItem(COMMENT_LIST_ARRIVAL_KEY);
    if (!encoded) {
      return undefined;
    }
    const arrival: unknown = JSON.parse(encoded);
    if (!isArrival(arrival) || now() - arrival.created_at > COMMENT_LIST_ARRIVAL_TTL_MS) {
      removeSafely(storage);
      return undefined;
    }
    return arrival;
  } catch {
    removeSafely(storage);
    return undefined;
  }
}

export function clearCommentListArrival(
  storage: StorageLike | undefined,
  token: string,
): void {
  if (!storage || !isNonEmptyString(token)) {
    return;
  }
  try {
    const encoded = storage.getItem(COMMENT_LIST_ARRIVAL_KEY);
    if (!encoded) {
      return;
    }
    const arrival: unknown = JSON.parse(encoded);
    if (isArrival(arrival) && arrival.token === token) {
      storage.removeItem(COMMENT_LIST_ARRIVAL_KEY);
    }
  } catch {
    // Token clearing is deliberately best-effort.
  }
}
