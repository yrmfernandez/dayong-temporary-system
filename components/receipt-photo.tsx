"use client";

import { Camera, ImageIcon, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

// Must match MAX_PHOTO_BYTES in lib/receipt-photos.ts (kept here so this file stays browser-only).
const MAX_BYTES = 80_000;

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });

/**
 * Shrinks a receipt photo so it fits the system's storage: grayscale (receipts stay readable and compress far better),
 * at most 1280 px on the long side, WebP where the browser supports it (else JPEG), lowering quality and then size until
 * it is under 80 KB.
 */
export async function compressReceiptPhoto(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo of the receipt.");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    for (let longSide = 1280; longSide >= 560; longSide = Math.round(longSide * 0.8)) {
      const scale = Math.min(1, longSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser cannot process photos.");
      context.filter = "grayscale(1) contrast(1.15)";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.7, 0.55, 0.42, 0.32]) {
        let blob = await toBlob(canvas, "image/webp", quality);
        if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
        if (blob && blob.size <= MAX_BYTES) return { dataUrl: await toDataUrl(blob), width: canvas.width, height: canvas.height, bytes: blob.size };
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("The photo could not be made small enough. Take it again closer to the receipt.");
}

/** "Add receipt photo": take or choose a photo, shrink it, and attach it to the given entries. */
export function ReceiptPhotoUpload({ entryIds, label = "Add receipt photo", replace = false, onSaved }: { entryIds: string[]; label?: string; replace?: boolean; onSaved: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const photo = await compressReceiptPhoto(file);
      const response = await fetch("/api/receipt-photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryIds, dataUrl: photo.dataUrl, width: photo.width, height: photo.height }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to save the photo.");
      onSaved(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the photo.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => void upload(event.target.files?.[0])} />
      <Button type="button" size="sm" variant={replace ? "ghost" : "outline"} disabled={busy || !entryIds.length} onClick={() => input.current?.click()}>
        <Camera className="size-3.5" />{busy ? "Saving photo..." : replace ? "Replace photo" : label}
      </Button>
      {error && <span className="max-w-xs text-xs text-red-700">{error}</span>}
    </span>
  );
}

/**
 * "View receipt": loads the photo only when asked, so lists stay light. It opens full screen, fitted to the screen;
 * zoom in (button or a click on the photo) to read small print and scroll around, rotate a sideways photo, Esc closes.
 */
export function ReceiptPhotoView({ photoId, label = "View receipt" }: { photoId: string; label?: string }) {
  const [photo, setPhoto] = useState<{ dataUrl: string; uploadedAt: string; uploadedByName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);

  const close = () => { setPhoto(null); setZoom(1); };
  // Rotating redraws the photo turned a quarter, so fitting and zooming treat it as an upright photo.
  const rotate = async () => {
    if (!photo) return;
    const image = new Image();
    image.src = photo.dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalHeight; canvas.height = image.naturalWidth;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
    context.drawImage(image, 0, 0);
    setPhoto({ ...photo, dataUrl: canvas.toDataURL("image/png") });
  };
  useEffect(() => {
    if (!photo) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    // The page scrolls in the app shell's main area (body does not scroll), and the viewer sits inside it, so scrolling
    // over the photo moved the page behind it (owner, October 21, 2026). Lock every scrolling ancestor while open.
    const locked = [document.body, ...document.querySelectorAll<HTMLElement>(".app-main")].map((element) => ({ element, overflow: element.style.overflow }));
    for (const { element } of locked) element.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); for (const { element, overflow } of locked) element.style.overflow = overflow; };
  }, [photo]);

  const open = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/receipt-photos?photoId=${encodeURIComponent(photoId)}`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Photo not found.");
      setPhoto(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Photo not found.");
    } finally {
      setBusy(false);
    }
  };

  // Fitted: the whole photo as large as the screen below the toolbar allows (small photos are enlarged too). Zoomed:
  // wider than the screen, scrolled.
  const size = zoom === 1 ? { width: "100%", height: "calc(100dvh - 3.5rem)" } : { width: `${zoom * 100}%`, maxWidth: "none" };

  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void open()}><ImageIcon className="size-3.5" />{busy ? "Loading..." : label}</Button>
      {error && <span className="text-xs text-red-700">{error}</span>}
      {photo && (
        <div role="dialog" aria-modal="true" aria-label="Receipt photo" className="fixed inset-0 z-50 flex flex-col overscroll-contain bg-black/95 text-white">
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
            <p className="min-w-0 truncate text-xs text-white/70">Uploaded {new Date(photo.uploadedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} by {photo.uploadedByName}</p>
            <div className="flex shrink-0 items-center gap-1">
              <Button type="button" size="icon" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" aria-label="Zoom out" disabled={zoom === 1} onClick={() => setZoom((value) => Math.max(1, value - 1))}><ZoomOut className="size-5" /></Button>
              <span className="w-10 text-center text-xs tabular-nums">{zoom === 1 ? "Fit" : `${zoom}×`}</span>
              <Button type="button" size="icon" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" aria-label="Zoom in" disabled={zoom === 4} onClick={() => setZoom((value) => Math.min(4, value + 1))}><ZoomIn className="size-5" /></Button>
              <Button type="button" size="icon" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" aria-label="Rotate" onClick={() => void rotate()}><RotateCw className="size-5" /></Button>
              <Button type="button" size="icon" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" aria-label="Close" onClick={close}><X className="size-6" /></Button>
            </div>
          </div>
          <div className={`flex min-h-0 flex-1 overflow-auto overscroll-contain ${zoom === 1 ? "items-center justify-center" : ""}`} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the sheet, not an optimizable file */}
            <img src={photo.dataUrl} alt="Receipt" style={size}
              className={`m-auto h-auto object-contain ${zoom === 1 ? "cursor-zoom-in" : "cursor-zoom-out"}`}
              onClick={() => setZoom((value) => (value === 1 ? 2 : 1))} />
          </div>
        </div>
      )}
    </>
  );
}
