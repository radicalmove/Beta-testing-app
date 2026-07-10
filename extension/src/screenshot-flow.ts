export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_SCREENSHOT_DIMENSION = 1920;

export function validateScreenshotDataUrl(value: unknown, maxBytes = MAX_SCREENSHOT_BYTES): { mime: "image/png" | "image/jpeg"; bytes: Uint8Array } {
  if (typeof value !== "string") throw new Error("Invalid screenshot payload");
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) throw new Error("Invalid screenshot payload");
  let binary: string;
  try { binary = atob(match[2]); } catch { throw new Error("Invalid screenshot payload"); }
  const canonical = btoa(binary);
  if (canonical !== match[2]) throw new Error("Invalid screenshot payload");
  if (binary.length > maxBytes) throw new Error("Screenshot is too large");
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const mime = match[1] as "image/png" | "image/jpeg";
  const validSignature = mime === "image/png"
    ? bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    : bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!validSignature) throw new Error("Screenshot content does not match its image type");
  return { mime, bytes };
}

function loadVideo(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.srcObject = stream;
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => void video.play().then(() => resolve(video), reject);
    video.onerror = () => reject(new Error("Could not read the shared tab"));
  });
}

async function frameDataUrl(stream: MediaStream): Promise<string> {
  const video = await loadVideo(stream);
  const scale = Math.min(1, MAX_SCREENSHOT_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  let encoded = canvas.toDataURL("image/png");
  try { validateScreenshotDataUrl(encoded); } catch { encoded = canvas.toDataURL("image/jpeg", 0.82); validateScreenshotDataUrl(encoded); }
  video.srcObject = null;
  return encoded;
}

export async function captureDisplayScreenshot(dependencies: {
  getDisplayMedia?: (constraints: DisplayMediaStreamOptions & { preferCurrentTab?: boolean }) => Promise<MediaStream>;
  captureFrame?: (stream: MediaStream) => Promise<string>;
} = {}): Promise<string> {
  const getDisplayMedia = dependencies.getDisplayMedia ?? navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices);
  if (!getDisplayMedia) throw new Error("Screenshot capture is unavailable in this browser.");
  let stream: MediaStream | undefined;
  try {
    stream = await getDisplayMedia({ video: true, audio: false, preferCurrentTab: true });
    return await (dependencies.captureFrame ?? frameDataUrl)(stream);
  } finally { for (const track of stream?.getTracks() ?? []) track.stop(); }
}
