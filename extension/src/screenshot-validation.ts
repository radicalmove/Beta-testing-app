export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_SCREENSHOT_DIMENSION = 1920;

export function validateScreenshotDataUrl(value: unknown, maxBytes = MAX_SCREENSHOT_BYTES): { mime: "image/png" | "image/jpeg"; bytes: Uint8Array } {
  if (typeof value !== "string") throw new Error("Invalid screenshot payload");
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) throw new Error("Invalid screenshot payload");
  let binary: string;
  try { binary = atob(match[2]); } catch { throw new Error("Invalid screenshot payload"); }
  if (btoa(binary) !== match[2]) throw new Error("Invalid screenshot payload");
  if (binary.length > maxBytes) throw new Error("Screenshot is too large");
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const mime = match[1] as "image/png" | "image/jpeg";
  const validSignature = mime === "image/png"
    ? bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    : bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!validSignature) throw new Error("Screenshot content does not match its image type");
  return { mime, bytes };
}
