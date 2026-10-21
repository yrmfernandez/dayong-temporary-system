"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DeleteKind, DeletionPlan } from "@/lib/admin-delete";

/**
 * Administrator-only permanent delete (lib/admin-delete.ts). Shows everything that goes with the record, any reason it
 * cannot be deleted yet, and asks for a reason and the word DELETE. Open it under the row it belongs to (InlineRow).
 * A remittance asks first whether its entries go back to Outstanding or are deleted with it (owner, October 21, 2026).
 */
export function AdminDeletePanel({ kind, id, onCancel, onDeleted }: { kind: DeleteKind; id: string; onCancel: () => void; onDeleted: (message: string) => void }) {
  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Remittance only: "" until the administrator chooses; "slip" keeps the entries (Outstanding again), "entries" deletes them.
  const [scope, setScope] = useState<"" | "slip" | "entries">("");
  const withEntries = kind === "remittance" && scope === "entries";

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the plan is reloaded for the chosen scope
    setPlan(null); setError("");
    fetch(`/api/admin-delete?kind=${kind}&id=${encodeURIComponent(id)}${withEntries ? "&entries=1" : ""}`, { cache: "no-store" })
      .then(async (response) => { const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.message || "Unable to check the record."); return result.plan as DeletionPlan; })
      .then((loaded) => { if (!cancelled) setPlan(loaded); })
      .catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Unable to check the record."); });
    return () => { cancelled = true; };
  }, [kind, id, withEntries]);

  async function remove() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, reason, confirm, withEntries }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to delete the record.");
      onDeleted(result.message);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to delete the record."); }
    finally { setBusy(false); }
  }

  const blocked = Boolean(plan?.blockers.length);
  const chosen = kind !== "remittance" || scope !== "";
  return (
    <div className="space-y-3 text-sm">
      <p className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-400"><Trash2 className="size-4" />Delete permanently{plan ? `: ${plan.title}` : ""}</p>
      {kind === "remittance" && (
        <fieldset className="space-y-2 rounded-lg border p-3">
          <legend className="px-1 font-medium">What happens to the entries on this remittance? *</legend>
          <label className="flex items-start gap-2"><input type="radio" name={`delete-scope-${id}`} className="mt-1" checked={scope === "slip"} onChange={() => setScope("slip")} />
            <span><strong>Delete the remittance only.</strong> <span className="text-muted-foreground">Its New Sales and collections stay and become Outstanding again, to be corrected and turned over anew (for adjustments). They stay in reports and the OR check.</span></span></label>
          <label className="flex items-start gap-2"><input type="radio" name={`delete-scope-${id}`} className="mt-1" checked={scope === "entries"} onChange={() => setScope("entries")} />
            <span><strong>Delete the remittance and its entries.</strong> <span className="text-muted-foreground">For duplicates or entries that should not exist: they leave reports and the OR check. A New Sale takes the account it opened with it.</span></span></label>
        </fieldset>
      )}
      {!plan && !error && <p className="text-muted-foreground">Checking what belongs to this record...</p>}
      {plan && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          <p className="font-medium">This removes:</p>
          <ul className="mt-1 list-disc pl-5">{plan.effects.map((effect) => <li key={effect}>{effect}</li>)}</ul>
          <p className="mt-2 text-xs">It cannot be undone in the app. Each deleted row is kept in the Audit Log, and the reason in Record Corrections.</p>
        </div>
      )}
      {blocked && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-4" />Cannot delete yet</p>
          <ul className="mt-1 list-disc pl-5">{plan?.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
        </div>
      )}
      {plan && !blocked && chosen && (
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <div className="space-y-1"><Label htmlFor={`delete-reason-${id}`}>Reason *</Label><Input id={`delete-reason-${id}`} maxLength={300} placeholder="e.g. Test entry" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor={`delete-confirm-${id}`}>Type DELETE</Label><Input id={`delete-confirm-${id}`} autoComplete="off" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></div>
          <Button type="button" variant="destructive" disabled={busy || reason.trim().length < 3 || confirm !== "DELETE"} onClick={() => void remove()}>{busy ? "Deleting..." : "Delete permanently"}</Button>
        </div>
      )}
      {error && <p role="alert" className="text-red-700 dark:text-red-400">{error}</p>}
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  );
}
