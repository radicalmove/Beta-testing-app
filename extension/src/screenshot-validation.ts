export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const MAX_SCREENSHOT_DIMENSION = 1920;

export function validateScreenshotDataUrl(value: unknown, maxBytes = MAX_SCREENSHOT_BYTES): { mime: string; bytes: Uint8Array } {
  if (typeof value !== "string") throw new Error("Invalid screenshot payload");
  const match = /^data:(image\/(?:png|jpeg)|application\/(?:pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) throw new Error("Invalid screenshot payload");
  let binary: string;
  try { binary = atob(match[2]); } catch { throw new Error("Invalid screenshot payload"); }
  if (btoa(binary) !== match[2]) throw new Error("Invalid screenshot payload");
  if (binary.length > maxBytes) throw new Error("Screenshot is too large");
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const mime = match[1];
  const starts = (...values: number[]) => values.every((byte, index) => bytes[index] === byte);
  const validSignature = mime === "image/png" ? starts(137,80,78,71,13,10,26,10) : mime === "image/jpeg" ? starts(255,216,255) : mime === "application/pdf" ? starts(37,80,68,70,45) : mime === "application/msword" ? starts(208,207,17,224,161,177,26,225) : starts(80,75,3,4);
  if (!validSignature) throw new Error("Attachment content does not match its file type");
  return { mime, bytes };
}
