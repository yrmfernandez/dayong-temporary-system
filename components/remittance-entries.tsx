"use client";

import { useEffect, useState } from "react";

import { ReceiptPhotoView } from "@/components/receipt-photo";
import { StatusBadge } from "@/components/status-badge";
import { parseJsonResponse } from "@/lib/api-response";
import type { RemittanceEntry } from "@/lib/remittance-workflow";

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

/**
 * Every entry on one remittance slip (GET /api/remittances/entries), opened from the Remittances page so the approver
 * sees exactly what the slip covers: member, program, OR, amount, company share, method and receipt photo.
 */
export function RemittanceEntries({ remittanceId }: { remittanceId: string }) {
  const [data, setData] = useState<{ entries: RemittanceEntry[]; missing: string[] } | null>(null);
  const [error, setError] = useState("");

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
  }, [remittanceId]);

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
            <td className="p-2">{entry.orNumber || "—"}<span className="block text-xs text-muted-foreground">{entry.orDate}</span></td>
            <td className="p-2 text-xs">{entry.paymentMethod}{entry.paymentReference && <span className="block text-muted-foreground">ref {entry.paymentReference}</span>}</td>
            <td className="p-2 text-right tabular-nums">{money(entry.amount)}</td>
            <td className="p-2 text-right tabular-nums">{money(entry.remittanceAmount)}{entry.forfeitedIncentive > 0 && <span className="block text-xs text-red-700">incentive forfeited {money(entry.forfeitedIncentive)}</span>}</td>
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
