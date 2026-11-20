"use client";

import { useState } from "react";

import { confirmDialog } from "@/components/app-dialog";
import { Button } from "@/components/ui/button";
import { parseJsonResponse } from "@/lib/api-response";
import type { AlreadySaved } from "@/lib/submission-already-saved";

/**
 * On Submitted by MAS (Collections and New Sales): the items of a waiting batch already saved another way
 * (lib/submission-already-saved.ts). When every item is, **Already saved** closes the batch and frees its clearing line;
 * when only some are, the clerk removes those on Review and saves the rest.
 */
export function AlreadySavedNote({ id, mas, found, endpoint, onDone }: { id: string; mas: string; found?: AlreadySaved; endpoint: "/api/collection-submissions" | "/api/sale-submissions"; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!found?.saved.length) return null;
  const all = found.saved.length >= found.total;
  const close = async () => {
    if (!await confirmDialog(`Close ${mas}'s batch ${id} as already saved? It leaves Submitted by MAS, linked to the entries already saved (${found.saved.flatMap((item) => item.entryIds).join(", ")}), and its clearing line is removed from Clearing when nothing is encoded under it.`, { confirmLabel: "Close as already saved" })) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "already-saved", id }) });
      const result = await parseJsonResponse<{ success: boolean; message?: string }>(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to close the batch.");
      onDone(result.message ?? "Closed.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to close the batch."); }
    finally { setBusy(false); }
  };
  return <div className="mt-2 space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
    <p className="font-semibold">{all ? `Already saved: all ${found.total}` : `Already saved: ${found.saved.length} of ${found.total}`}. {all ? "It cannot be saved again; close it here." : "Open it with Review, remove these, and save the rest."}</p>
    <ul className="list-disc pl-4">{found.saved.map((item) => <li key={item.label}>{item.label}: {item.entryIds.join(", ")}</li>)}</ul>
    {all && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void close()}>{busy ? "Closing..." : "Already saved: close batch"}</Button>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
