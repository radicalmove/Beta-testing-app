declare const __MOODLE_PATTERNS__: string[];
declare const __OPTIONAL_FRAME_PATTERNS__: string[];
declare const chrome: any;

const MARKER = "data-moodle-review-extension";

function matchPattern(url: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(url);
}

export function isConfiguredFrame(
  url: string,
  moodlePatterns: string[],
  optionalFramePatterns: string[],
  hasOptionalPermission: (pattern: string) => boolean = () => false,
): boolean {
  if (moodlePatterns.some((pattern) => matchPattern(url, pattern))) return true;
  return optionalFramePatterns.some((pattern) => matchPattern(url, pattern) && hasOptionalPermission(pattern));
}

export async function bootstrapContentScript(options: {
  url: string;
  document: { documentElement: { hasAttribute(name: string): boolean; setAttribute(name: string, value: string): void } };
  moodlePatterns: string[];
  optionalFramePatterns: string[];
  hasOptionalPermission?: (pattern: string) => boolean | Promise<boolean>;
  inject: () => void;
}): Promise<boolean> {
  const optionalPermission = options.hasOptionalPermission ?? (() => false);
  const permitted: string[] = [];
  for (const pattern of options.optionalFramePatterns) {
    if (await optionalPermission(pattern)) permitted.push(pattern);
  }
  if (!isConfiguredFrame(options.url, options.moodlePatterns, permitted, () => true)) return false;
  if (options.document.documentElement.hasAttribute(MARKER)) return false;
  options.document.documentElement.setAttribute(MARKER, "active");
  options.inject();
  return true;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  void bootstrapContentScript({
    url: window.location.href,
    document,
    moodlePatterns: __MOODLE_PATTERNS__,
    optionalFramePatterns: __OPTIONAL_FRAME_PATTERNS__,
    hasOptionalPermission: async (pattern) => chrome.permissions.contains({ origins: [pattern] }),
    inject: () => document.documentElement.dispatchEvent(new CustomEvent("moodle-review:bootstrap")),
  });
}
