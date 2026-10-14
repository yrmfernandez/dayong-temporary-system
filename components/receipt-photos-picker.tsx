"use client";

import { ImagePlus, X } from "lucide-react";
import { useState } from "react";

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
    <div className={`space-y-2 rounded-xl border p-3 ${photos.length ? "bg-muted/20" : "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Receipt photos for this batch *</p>
          <p className="text-xs text-muted-foreground">At least one is required; add as many as the batch needs. They are attached to every {kind} in this batch.</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted">
          <ImagePlus className="size-4" />{busy ? "Reading..." : photos.length ? "Add more photos" : "Add photos"}
          <input type="file" accept="image/*" multiple className="sr-only" disabled={busy} onChange={(event) => { void add(event.target.files); event.target.value = ""; }} />
        </label>
      </div>
      {photos.length > 0 && <ul className="flex flex-wrap gap-2">
        {photos.map((photo, index) => <li key={`${photo.name}-${index}`} className="flex items-center gap-2 rounded-md border bg-background py-1 pl-1 pr-2 text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the compressed photo */}
          <img src={photo.dataUrl} alt={`Receipt ${index + 1}`} className="size-10 rounded object-cover" />
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
