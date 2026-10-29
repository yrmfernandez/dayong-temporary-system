"use client";

import { useEffect, useState } from "react";

import { parseJsonResponse } from "@/lib/api-response";
import type { DiscrepancyBreakdown } from "@/lib/remittance-discrepancy";
import { formatDateTime as showDateTime } from "@/lib/date-format";
import { useLiveRefresh } from "@/lib/use-live-refresh";

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

/**
 * Why a remittance slip is short or over (GET /api/remittances/discrepancy; lib/remittance-discrepancy.ts): what it
 * expected and recorded when made, every later change with who, when and the correction's reason, and each entry's
 * share on the slip against its share now.
 */
export function RemittanceDiscrepancy({ remittanceId }: { remittanceId: string }) {
  const [data, setData] = useState<DiscrepancyBreakdown | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  // Live updates: the explanation is worked out again when the slip or its entries change (lib/use-live-refresh.ts).
  useLiveRefresh(["remittances", "remittance_collections", "collections", "sales", "receipt_photos", "turnover_variances"], () => setVersion((value) => value + 1));

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/remittances/discrepancy?id=${encodeURIComponent(remittanceId)}`, { cache: "no-store" });
        const result = await parseJsonResponse<{ success: boolean; message?: string; breakdown: DiscrepancyBreakdown }>(response);
        if (!response.ok || !result.success) throw new Error(result.message || "Unable to explain the difference.");
        if (active) setData(result.breakdown);
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : "Unable to explain the difference."); }
    })();
    return () => { active = false; };
  }, [remittanceId, version]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Working out the difference...</p>;
  const tone = data.difference < 0 ? "text-red-700 dark:text-red-400" : data.difference > 0 ? "text-amber-800 dark:text-amber-300" : "text-emerald-700";
  return <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/50 p-3 text-sm dark:border-amber-800 dark:bg-amber-500/5">
    <div className="flex flex-wrap gap-x-6 gap-y-1">
      <span>Expected <strong className="tabular-nums">{money(data.expected)}</strong>{data.fidelity > 0 && <span className="text-xs text-muted-foreground"> (incl. Fidelity {money(data.fidelity)})</span>}</span>
      <span>Recorded <strong className="tabular-nums">{money(data.actual)}</strong></span>
      <span className={tone}>Difference <strong className="tabular-nums">{money(data.difference)}</strong> {data.difference < 0 ? "short" : data.difference > 0 ? "over" : ""}</span>
      <span className="text-xs text-muted-foreground">Slip made {showDateTime(data.createdAt) || "—"} · received {showDateTime(data.receivedAt) || "—"}{data.cashCount ? ` · cash count ${data.cashCount}` : ""}</span>
    </div>
    <div><p className="font-semibold">Why</p><ul className="mt-1 list-disc space-y-1 pl-5">{data.causes.map((cause) => <li key={cause}>{cause}</li>)}</ul></div>
    {data.changes.length > 0 && <div className="overflow-x-auto rounded-md border bg-background">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="bg-muted/50 uppercase text-muted-foreground"><tr>{["When", "What changed", "From", "To", "Entry", "Reason", "By"].map((label) => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
        <tbody>{data.changes.map((change, index) => <tr key={index} className="border-t align-top">
          <td className="whitespace-nowrap p-2">{showDateTime(change.at)}</td><td className="p-2">{change.what === "Entry share" ? "Entry's share on the slip" : `Slip ${change.what.toLowerCase()}`}</td>
          <td className="p-2 tabular-nums">{money(change.from)}</td><td className="p-2 tabular-nums">{money(change.to)}</td>
          <td className="p-2">{change.entryId ? <><span className="font-mono">{change.entryId}</span>{change.orNumber && <span className="block text-muted-foreground">OR {change.orNumber}</span>}</> : "—"}</td>
          <td className="p-2">{change.reason || "—"}</td><td className="p-2">{change.by}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    <details><summary className="cursor-pointer text-xs font-medium">Each entry: share on the slip and now ({data.entries.length})</summary>
      <div className="mt-2 overflow-x-auto rounded-md border bg-background">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="bg-muted/50 uppercase text-muted-foreground"><tr>{["Entry", "OR", "Amount", "Share on slip", "Share now"].map((label) => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
          <tbody>{data.entries.map((entry) => { const drift = Math.round((entry.shareNow - entry.shareOnSlip) * 100) !== 0; return <tr key={entry.id} className={`border-t ${drift ? "bg-amber-50 dark:bg-amber-500/10" : ""}`}>
            <td className="p-2"><span className="block">{entry.kind}</span><span className="font-mono">{entry.id}</span></td><td className="p-2">{entry.orNumber || "—"}</td>
            <td className="p-2 tabular-nums">{money(entry.amount)}</td><td className="p-2 tabular-nums">{money(entry.shareOnSlip)}</td><td className={`p-2 tabular-nums ${drift ? "font-semibold text-amber-800" : ""}`}>{money(entry.shareNow)}</td>
          </tr>; })}</tbody>
        </table>
      </div>
    </details>
  </div>;
}
