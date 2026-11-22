/** The phone's player token, kept in localStorage so a refresh or sleep rejoins the same team. */

const KEY = "kwistig.player";

export interface StoredPlayer {
  token: string;
  code: string;
}

export function loadPlayer(): StoredPlayer | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredPlayer>;
    return typeof v.token === "string" && typeof v.code === "string" ? { token: v.token, code: v.code } : null;
  } catch {
    return null;
  }
}

export function savePlayer(p: StoredPlayer) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode: the phone rejoins via the QR code instead */
  }
}

export function clearPlayer() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Centre-crops an image file to a square JPEG (800×800 by default), honouring EXIF rotation. */
export async function squareJpeg(file: File, size = 800, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality),
  );
}
