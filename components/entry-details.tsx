"use client";

import { AlertTriangle } from "lucide-react";

import { ReceiptPhotoView } from "@/components/receipt-photo";
import { Button } from "@/components/ui/button";
import type { DayEntry } from "@/lib/todays-entries";

/** Everything recorded about one entry, with any date warnings first. */
export function EntryDetails({ entry, onClose }: { entry: DayEntry; onClose: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">{entry.kind} {entry.id}</p>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {entry.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-4" />Dates to check</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{entry.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      )}
      {entry.photoId ? <ReceiptPhotoView photoId={entry.photoId} /> : <p className="text-sm text-amber-800">No receipt photo attached yet.</p>}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {entry.details.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={`break-words ${label === "Date remitted" ? "font-semibold" : ""}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
