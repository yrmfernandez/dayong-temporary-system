"use client";

import { Camera, ImageIcon, X } from "lucide-react";
import { useRef, useState } from "react";

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

/** "View receipt": loads the photo only when asked, so lists stay light. */
export function ReceiptPhotoView({ photoId, label = "View receipt" }: { photoId: string; label?: string }) {
  const [photo, setPhoto] = useState<{ dataUrl: string; uploadedAt: string; uploadedByName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void open()}><ImageIcon className="size-3.5" />{busy ? "Loading..." : label}</Button>
      {error && <span className="text-xs text-red-700">{error}</span>}
      {photo && (
        <div role="dialog" aria-modal="true" aria-label="Receipt photo" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPhoto(null)}>
          <div className="max-h-full max-w-3xl space-y-2 overflow-auto rounded-xl bg-background p-3" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Uploaded {new Date(photo.uploadedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} by {photo.uploadedByName}</p>
              <Button type="button" size="icon" variant="ghost" aria-label="Close" onClick={() => setPhoto(null)}><X className="size-4" /></Button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the sheet, not an optimizable file */}
            <img src={photo.dataUrl} alt="Receipt" className="h-auto max-w-full rounded" />
          </div>
        </div>
      )}
    </>
  );
}
