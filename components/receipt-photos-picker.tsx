"use client";

import { ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";

import { compressReceiptPhoto } from "@/components/receipt-photo";

export type PickedPhoto = { dataUrl: string; width: number; height: number; bytes: number; name: string };

/**
 * The receipt photos of a New Sales or Collections batch (owner, October 14, 2026): at least one is required to save,
 * and as many as needed may be added. Each is compressed in the browser (components/receipt-photo.tsx) and attached to
 * every entry of the batch right after it is saved (uploadBatchPhotos).
 */
export function ReceiptPhotosPicker({ photos, onChange, kind }: { photos: PickedPhoto[]; onChange: (photos: PickedPhoto[]) => void; kind: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The file input stays display:none and a button opens it. A visually hidden (sr-only) input took focus when the
  // file picker closed, and the browser scrolled the overflow-hidden form card to show it, leaving the card blank
  // below the save bar (owner, October 15, 2026).
  const input = useRef<HTMLInputElement>(null);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setError("");
    const added: PickedPhoto[] = [];
    for (const file of Array.from(files)) {
      try { added.push({ ...(await compressReceiptPhoto(file)), name: file.name || `Photo ${photos.length + added.length + 1}` }); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "That photo could not be read."); }
    }
    onChange([...photos, ...added]);
    setBusy(false);
  };
  return (
    <div className={`min-w-0 space-y-2 rounded-xl border p-3 text-card-foreground ${photos.length ? "bg-card" : "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Receipt photos for this batch *</p>
          <p className="text-xs text-muted-foreground">At least one is required; add as many as the batch needs. They are attached to every {kind} in this batch.</p>
        </div>
        <button type="button" disabled={busy} className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60" onClick={() => input.current?.click()}>
          <ImagePlus className="size-4" />{busy ? "Reading..." : photos.length ? "Add more photos" : "Add photos"}
        </button>
        <input ref={input} type="file" accept="image/*" multiple className="hidden" tabIndex={-1} onChange={(event) => { void add(event.target.files); event.target.value = ""; }} />
      </div>
      {photos.length > 0 && <ul className="flex min-w-0 flex-wrap gap-2">
        {photos.map((photo, index) => <li key={`${photo.name}-${index}`} className="flex max-w-full items-center gap-2 rounded-md border bg-background py-1 pl-1 pr-2 text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the compressed photo */}
          <img src={photo.dataUrl} alt={`Receipt ${index + 1}`} width={40} height={40} className="size-10 shrink-0 rounded object-cover" />
          <span>Receipt {index + 1}<span className="block text-muted-foreground">{Math.round(photo.bytes / 1000)} KB</span></span>
          <button type="button" aria-label={`Remove receipt ${index + 1}`} className="text-muted-foreground hover:text-red-700" onClick={() => onChange(photos.filter((_, other) => other !== index))}><X className="size-4" /></button>
        </li>)}
      </ul>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** Attaches every photo to the saved entries, one by one; returns how many were saved and the first problem, if any. */
export async function uploadBatchPhotos(entryIds: string[], photos: PickedPhoto[]) {
  let saved = 0, problem = "";
  for (const photo of photos) {
    try {
      const response = await fetch("/api/receipt-photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryIds, dataUrl: photo.dataUrl, width: photo.width, height: photo.height }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "The photo was not saved.");
      saved++;
    } catch (failure) { problem ||= failure instanceof Error ? failure.message : "The photo was not saved."; }
  }
  return { saved, problem };
}
