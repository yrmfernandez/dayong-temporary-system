"use client";

import { useEffect, useState } from "react";

import { alertDialog, confirmDialog, promptDialog } from "@/components/app-dialog";
import { ReceiptPhotoView } from "@/components/receipt-photo";
import { StatusBadge } from "@/components/status-badge";
import { parseJsonResponse } from "@/lib/api-response";
import type { RemittanceEntry } from "@/lib/remittance-workflow";
import { formatDate as showDate } from "@/lib/date-format";

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

/**
 * Every entry on one remittance slip (GET /api/remittances/entries), opened from the Remittances page so the approver
 * sees exactly what the slip covers: member, program, OR, amount, company share, method and receipt photo.
 * An Administrator can keep or forfeit an entry's incentive there, overriding the 3:00 PM rule (lib/incentive-decision.ts).
 */
export function RemittanceEntries({ remittanceId, canDecideIncentive = false, onChanged }: { remittanceId: string; canDecideIncentive?: boolean; onChanged?: () => void }) {
  const [data, setData] = useState<{ entries: RemittanceEntry[]; missing: string[] } | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [deciding, setDeciding] = useState("");

  async function decide(entry: RemittanceEntry, decision: "Keep" | "Forfeit" | "") {
    const label = decision === "Keep" ? "Keep the incentive" : decision === "Forfeit" ? "Forfeit the incentive" : "Let the 3:00 PM rule decide";
    const reason = (await promptDialog(`${label} on ${entry.orNumber || entry.id}. Why?`, { required: true, confirmLabel: "Save", placeholder: "e.g. cash was received at 1:30 PM; the clearing was recorded late" }))?.trim();
    if (!reason) return;
    // On a pending slip the expected amount changes; the actual can move with it so the difference stays (slips are made
    // with the actual equal to the expected). Asked only when the decision may change the figures.
    const changes = decision === "Keep" ? entry.forfeitedIncentive > 0 : decision === "Forfeit" ? entry.forfeitedIncentive === 0 : true;
    const moveActual = entry.remittanceStatus === "Pending Remittance Approval" && changes
      ? await confirmDialog("Change the slip's actual cash by the same amount, so its difference stays as it is?\n\nChoose Yes when the actual was not counted separately (the slip was sent automatically) or the collector kept the incentive. Choose No when the cash really handed over differs: the difference then shows what to give back or collect.", { title: "Slip's actual cash", confirmLabel: "Yes, change the actual", cancelLabel: "No, keep the actual", requireChoice: true })
      : false;
    setDeciding(entry.id);
    try {
      const response = await fetch("/api/remittances/incentive", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: entry.id, decision, reason, moveActual }) });
      const result = await parseJsonResponse<{ success: boolean; message?: string; result?: { applied: string; actualMoved?: boolean; incentive?: number; slip?: { expectedChange: number; difference: number } | null } }>(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to save the decision.");
      const slip = result.result?.slip;
      await alertDialog(result.result?.applied === "now" && slip ? `Saved. The slip's expected amount changed by ${money(slip.expectedChange)}${result.result.actualMoved ? " and its actual cash with it" : ""}; its difference is now ${money(slip.difference)}.${result.result.actualMoved && decision === "Keep" ? `\n\nIf the collector handed over the full amount, give back the incentive (${money(result.result.incentive ?? 0)}).` : ""}` : result.result?.applied === "next slip" ? "Saved. It applies when this entry is put on a slip." : "Saved.");
      setVersion((value) => value + 1);
      onChanged?.();
    } catch (caught) {
      await alertDialog(caught instanceof Error ? caught.message : "Unable to save the decision.", { warning: true, title: "Not saved" });
    } finally { setDeciding(""); }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/remittances/entries?id=${encodeURIComponent(remittanceId)}`, { cache: "no-store" });
        const result = await parseJsonResponse<{ success: boolean; message?: string; entries: RemittanceEntry[]; missing: string[] }>(response);
        if (!response.ok || !result.success) throw new Error(result.message || "Unable to load the entries.");
        if (active) setData(result);
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : "Unable to load the entries."); }
    })();
    return () => { active = false; };
  }, [remittanceId, version]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading entries...</p>;
  const total = data.entries.reduce((sum, entry) => sum + entry.amount, 0), share = data.entries.reduce((sum, entry) => sum + entry.remittanceAmount, 0);
  return <div className="space-y-2">
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground"><tr>{["Entry", "Member", "Program", "OR · date", "Method", "Amount", "Company share", "Receipt", "Encoded by"].map((label) => <th key={label} scope="col" className={`p-2 ${["Amount", "Company share"].includes(label) ? "text-right" : ""}`}>{label}</th>)}</tr></thead>
        <tbody>
          {data.entries.map((entry) => <tr key={entry.id} className="border-t align-top">
            <td className="p-2"><span className="block text-xs font-medium">{entry.kind === "New Sales" ? "New Sale" : "Collection"}</span><span className="block font-mono text-xs">{entry.id}</span></td>
            <td className="p-2">{entry.memberName || "—"}<span className="block text-xs text-muted-foreground">{entry.memberNumber}</span></td>
            <td className="p-2">{entry.program || "—"}</td>
            <td className="p-2">{entry.orNumber || "—"}<span className="block text-xs text-muted-foreground">{showDate(entry.orDate)}</span>{entry.dateRemittedReason && <span className="block text-xs text-amber-800">Remitted {showDate(entry.dateRemitted)}: {entry.dateRemittedReason}</span>}</td>
            <td className="p-2 text-xs">{entry.paymentMethod}{entry.paymentReference && <span className="block text-muted-foreground">ref {entry.paymentReference}</span>}</td>
            <td className="p-2 text-right tabular-nums">{money(entry.amount)}</td>
            <td className="p-2 text-right tabular-nums">{money(entry.remittanceAmount)}{entry.noIncentiveReason ? <span className="block text-xs text-red-700">No incentive: {entry.noIncentiveReason}</span> : entry.forfeitedIncentive > 0 && <span className="block text-xs text-red-700">incentive forfeited {money(entry.forfeitedIncentive)}</span>}
              {entry.incentiveDecision && <span className="block text-xs text-primary" title={entry.incentiveDecisionNote}>{entry.incentiveDecision === "Keep" ? "Kept" : "Forfeited"} by Administrator{entry.incentiveDecisionNote ? `: ${entry.incentiveDecisionNote}` : ""}</span>}
              {canDecideIncentive && !entry.noIncentiveReason && entry.remittanceStatus !== "Remitted" && (entry.forfeitedIncentive > 0 || entry.amount > entry.remittanceAmount) && <span className="mt-1 flex flex-wrap justify-end gap-1 print:hidden">
                {entry.incentiveDecision !== "Keep" && <button type="button" disabled={deciding === entry.id} className="text-xs text-primary underline" onClick={() => void decide(entry, "Keep")}>Keep</button>}
                {entry.incentiveDecision !== "Forfeit" && <button type="button" disabled={deciding === entry.id} className="text-xs text-red-700 underline" onClick={() => void decide(entry, "Forfeit")}>Forfeit</button>}
                {entry.incentiveDecision && <button type="button" disabled={deciding === entry.id} className="text-xs text-muted-foreground underline" onClick={() => void decide(entry, "")}>Follow the rule</button>}
              </span>}</td>
            <td className="p-2">{entry.photoId ? <ReceiptPhotoView photoId={entry.photoId} label="View" /> : entry.cash ? <span className="text-xs text-muted-foreground">Cash, none needed</span> : <StatusBadge status="Missing" tone="warning" />}</td>
            <td className="p-2 text-xs">{entry.encodedByName || "—"}<span className="block text-muted-foreground">{entry.encodedAt}</span></td>
          </tr>)}
          {!data.entries.length && <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">No entries are linked to this remittance.</td></tr>}
        </tbody>
        {data.entries.length > 1 && <tfoot className="border-t bg-muted/30 font-medium"><tr><td className="p-2" colSpan={5}>{data.entries.length} entries</td><td className="p-2 text-right tabular-nums">{money(total)}</td><td className="p-2 text-right tabular-nums">{money(share)}</td><td colSpan={2} /></tr></tfoot>}
      </table>
    </div>
    {data.missing.length > 0 && <p className="text-xs text-amber-800">Linked but no longer found: {data.missing.join(", ")}.</p>}
  </div>;
}
