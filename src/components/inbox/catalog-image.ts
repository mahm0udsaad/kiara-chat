/**
 * The service photo, ready to attach to a reply.
 *
 * Two conversions happen on the way: the CDN serves multi-megabyte WebP, and
 * WhatsApp treats `image/webp` as a sticker rather than a photo. Re-encoding
 * through a canvas gives a plain JPEG at a sane size — the same trick the
 * cropper already uses on staged images.
 */
const MAX_EDGE = 1280;
const QUALITY = 0.9;

/** A filename WhatsApp and the storage bucket can both live with. */
function fileNameFor(name: string): string {
  const base = name.replace(/[^\p{L}\p{N}\s-]/gu, "").trim().slice(0, 40);
  return `${base || "service"}.jpg`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = src;
  });
}

export async function catalogImageFile(item: {
  id: string;
  name: string;
}): Promise<File | null> {
  const res = await fetch(`/api/catalog/${item.id}/image`);
  if (!res.ok) return null;
  const blob = await res.blob();

  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY)
    );
    if (!jpeg) return null;
    return new File([jpeg], fileNameFor(item.name), { type: "image/jpeg" });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
