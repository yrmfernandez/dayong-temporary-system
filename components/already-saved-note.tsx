"use client";

import { useState } from "react";

import { confirmDialog } from "@/components/app-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseJsonResponse } from "@/lib/api-response";
import { formatDate } from "@/lib/date-format";
import { formatPeso } from "@/lib/money";
import type { AlreadySaved } from "@/lib/submission-already-saved";

/**
 * On Submitted by MAS (Collections and New Sales): the items of a waiting batch already saved another way
 * (lib/submission-already-saved.ts). When every item is, **Already saved** closes the batch and frees its clearing line;
 * when only some are, the clerk removes those on Review and saves the rest.
 *
 * Collections only (owner, November 23, 2026): a member saved on another account or with other NOPs is not found on
 * their own account, so the batch could be neither saved (the OR is taken) nor rejected (marked remitted). **Already
 * encoded another way?** lists the collections that may be theirs (same MAS, same amount, OR dated near) to tick, or
 * takes typed collection IDs, with the reason, and closes the batch with them.
 */
export function AlreadySavedNote({ id, mas, found, endpoint, onDone }: { id: string; mas: string; found?: AlreadySaved; endpoint: "/api/collection-submissions" | "/api/sale-submissions"; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const possible = endpoint === "/api/collection-submissions" ? found?.possible ?? [] : [];
  if (!found?.saved.length && !possible.length) return null;
  const all = Boolean(found) && found!.saved.length >= found!.total;

  const send = async (body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "already-saved", id, ...body }) });
      const result = await parseJsonResponse<{ success: boolean; message?: string }>(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to close the batch.");
      onDone(result.message ?? "Closed.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to close the batch."); }
    finally { setBusy(false); }
  };
  const close = async () => {
    if (!await confirmDialog(`Close ${mas}'s batch ${id} as already saved? It leaves Submitted by MAS, linked to the entries already saved (${found!.saved.flatMap((item) => item.entryIds).join(", ")}), and its clearing line is removed from Clearing when nothing is encoded under it.`)) return;
    await send({});
  };
  const chosen = [...new Set([...picked, ...typed.split(/[\s,]+/).map((value) => value.trim().toUpperCase()).filter(Boolean)])];
  const candidates = possible.flatMap((item) => item.candidates);
  const otherMember = candidates.filter((candidate) => picked.includes(candidate.id) && !candidate.sameMember);
  const closeEncoded = async () => {
    const warning = otherMember.length ? ` ${otherMember.map((candidate) => candidate.id).join(", ")} ${otherMember.length === 1 ? "is" : "are"} on another member's account (${otherMember.map((candidate) => candidate.memberNumber).join(", ")}): check the receipt. If it was encoded on the wrong member, correct it in Member Corrections.` : "";
    if (!await confirmDialog(`Close ${mas}'s batch ${id} with ${chosen.join(", ")} as its members' payments?${warning} The batch leaves Submitted by MAS and Record Corrections keeps your reason.`)) return;
    await send({ collectionIds: chosen, reason });
  };

  return <div className="mt-2 space-y-2">
    {Boolean(found?.saved.length) && <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <p className="font-semibold">{all ? `Already saved: all ${found!.total}` : `Already saved: ${found!.saved.length} of ${found!.total}`}. {all ? "It cannot be saved again; close it here." : "Open it with Review, remove these, and save the rest."}</p>
      <ul className="list-disc pl-4">{found!.saved.map((item) => <li key={item.label}>{item.label}: {item.entryIds.join(", ")}</li>)}</ul>
      {all && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void close()}>{busy ? "Closing..." : "Already saved: close batch"}</Button>}
    </div>}
    {possible.length > 0 && <div className="text-xs">
      <button type="button" className="text-primary underline" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "Already encoded another way?"}</button>
      {open && <div className="mt-1 space-y-2 rounded-md border p-2">
        <p className="text-muted-foreground">For a batch that cannot be saved because its payment was already encoded on another account or with other NOPs. Tick the collection that is this member&apos;s payment (by {mas}, the same amount, OR dated near), or type its collection ID.</p>
        {possible.map((item) => <div key={item.index} className="space-y-1">
          <p className="font-semibold">{item.label} · {formatPeso(item.amount)} · OR date {formatDate(item.orDate)}</p>
          {item.candidates.length
            ? item.candidates.map((candidate) => <label key={candidate.id} className="flex flex-wrap items-center gap-2">
              <input type="checkbox" checked={picked.includes(candidate.id)} onChange={() => setPicked((current) => current.includes(candidate.id) ? current.filter((value) => value !== candidate.id) : [...current, candidate.id])} />
              <span className="font-mono">{candidate.id}</span> · {candidate.memberNumber} · OR {candidate.orNumber} ({formatDate(candidate.orDate)}) · NOP {candidate.nop} · {formatPeso(candidate.amount)}
              {!candidate.sameMember && <span className="rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">another member&apos;s account</span>}
            </label>)
            : <p className="text-muted-foreground">No collection by {mas} for {formatPeso(item.amount)} near that date. Type its collection ID below if you know it.</p>}
        </div>)}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Other collection IDs" placeholder="Collection ID(s), e.g. COL-2026…" value={typed} onChange={(event) => setTyped(event.target.value)} />
          <Input aria-label="Reason" placeholder="Reason, e.g. encoded on the other member's account" value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <Button type="button" size="sm" variant="outline" disabled={busy || !chosen.length || reason.trim().length < 5} onClick={() => void closeEncoded()}>{busy ? "Closing..." : "Already encoded: close batch"}</Button>
      </div>}
    </div>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
