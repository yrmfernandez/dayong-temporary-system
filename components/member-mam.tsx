"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { paidInMonth } from "@/lib/mam-format";
import { formatDate as showDate } from "@/lib/date-format";

type Receipt = { id: string; orNumber: string; orDate: string; amount: number; monthFrom: string; monthTo: string; nopFrom: number; nopTo: number };
type Period = { month: string; projected: boolean; error: string; collected: number; coveredAmount: number; receipts: Receipt[]; state: { status: string; temporarilySuspended: boolean; nop: number; lastCoveredMonth: string; balance: number | null } | null };
type Row = { id: string; programName: string; doi: string; mas: string; basePay: number; periods: Period[] };

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value || 0);
// "Month of": the month the account's latest NOP pays for (the DOI's month while only the New Sale is in).
const monthOf = (state: { lastCoveredMonth: string } | null, doi: string) => {
  const month = state ? state.lastCoveredMonth || doi.slice(0, 7) : "";
  return /^\d{4}-\d{2}$/.test(month) ? new Intl.DateTimeFormat("en-PH", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`)) : "—";
};
const statusTone = (status: string) => status === "U" || status === "ADV" || status === "Fully Paid" ? "success" : status === "Forfeited" ? "danger" : status === "NS" ? "neutral" : "warning";

/** A member's MAM, collapsed until opened; it loads that member's accounts only when first expanded. */
export function MemberMam({ memberId }: { memberId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || rows) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/mam/member?memberId=${encodeURIComponent(memberId)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load this member's MAM.");
      setRows(result.rows);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to load this member's MAM."); }
    finally { setLoading(false); }
  }

  return <div className="rounded-lg border">
    <button type="button" aria-expanded={open} onClick={() => void toggle()} className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-semibold hover:bg-muted/40">
      <span>MAM (Member Account Monitoring)</span><ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div className="space-y-4 border-t p-3">
      {loading && <p className="text-sm text-muted-foreground">Loading payment history...</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {rows && !rows.length && <p className="text-sm text-muted-foreground">No program accounts yet.</p>}
      {rows?.map((row) => {
        const latest = row.periods.at(-1)?.state;
        return <section key={row.id} className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <strong>{row.programName}</strong>
            {latest && <StatusBadge status={latest.status} tone={statusTone(latest.status)} />}
            {latest?.temporarilySuspended && <span className="text-xs text-amber-700">Temporarily suspended</span>}
            <span className="text-xs text-muted-foreground">DOI {showDate(row.doi) || "—"} · Monthly {money(row.basePay)} · Paid up to NOP {latest?.nop ?? "—"} ({monthOf(latest ?? null, row.doi)}) · Balance today {latest ? latest.balance === null ? "—" : money(latest.balance) : "—"} · MAS {row.mas || "—"}</span>
          </div>
          <div className="max-h-80 overflow-auto rounded-md border"><table className="w-full min-w-[820px] text-xs">
            <thead className="sticky top-0 bg-muted text-left"><tr>{["Month", "Status", "OR No.", "OR Date", "NOP paid", "Month of", "Collected", "Covered", "Receipts"].map((heading) => <th key={heading} className="p-2">{heading}</th>)}</tr></thead>
            <tbody>{[...row.periods].reverse().filter((period) => period.state || period.error || period.receipts.length).map((period) => { const paid = paidInMonth(period.receipts); return <tr key={period.month} className="border-t align-top">
              <td className="p-2 font-medium">{period.month}</td>
              <td className="p-2">{period.error ? <span className="text-destructive">Needs review</span> : period.state ? <StatusBadge status={period.state.status} tone={statusTone(period.state.status)} /> : <span className="text-muted-foreground">Not enrolled</span>}</td>
              {/* OR number and date in their own columns, one line per receipt, for comparing with the old records (owner, October 13, 2026). */}
              <td className="p-2 font-mono whitespace-nowrap">{period.receipts.length ? period.receipts.map((receipt) => <span key={receipt.id} className="block">{receipt.orNumber || "—"}</span>) : <span className="text-muted-foreground">—</span>}</td>
              <td className="p-2 whitespace-nowrap tabular-nums">{period.receipts.length ? period.receipts.map((receipt) => <span key={receipt.id} className="block">{showDate(receipt.orDate) || "—"}</span>) : <span className="text-muted-foreground">—</span>}</td>
              <td className="p-2 tabular-nums">{paid.nop || <span className="text-muted-foreground">—</span>}</td>
              <td className="p-2">{paid.monthOf || <span className="text-muted-foreground">—</span>}</td>
              <td className="p-2 tabular-nums">{money(period.collected)}</td>
              <td className="p-2 tabular-nums">{money(period.coveredAmount)}</td>
              <td className="p-2">{period.receipts.length ? period.receipts.map((receipt) => <span key={receipt.id} className="block">{money(receipt.amount)} · covers {receipt.monthFrom}{receipt.monthTo !== receipt.monthFrom ? ` to ${receipt.monthTo}` : ""}{receipt.nopFrom ? ` (NOP ${receipt.nopFrom}${receipt.nopTo !== receipt.nopFrom ? `-${receipt.nopTo}` : ""})` : ""}</span>) : <span className="text-muted-foreground">—</span>}</td>
            </tr>; })}</tbody>
          </table></div>
        </section>;
      })}
    </div>}
  </div>;
}
