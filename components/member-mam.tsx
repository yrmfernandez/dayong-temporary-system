"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";

type Receipt = { id: string; orNumber: string; orDate: string; amount: number; monthFrom: string; monthTo: string };
type Period = { month: string; projected: boolean; error: string; collected: number; coveredAmount: number; receipts: Receipt[]; state: { status: string; temporarilySuspended: boolean; nop: number; balance: number | null } | null };
type Row = { id: string; programName: string; doi: string; mas: string; basePay: number; periods: Period[] };

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value || 0);
const statusTone = (status: string) => status === "U" || status === "ADV" || status === "Paid" ? "success" : status === "Forfeited" ? "danger" : status === "NS" ? "neutral" : "warning";

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
            <span className="text-xs text-muted-foreground">DOI {row.doi || "—"} · Monthly {money(row.basePay)} · NOP {latest?.nop ?? "—"} · Balance today {latest ? latest.balance === null ? "—" : money(latest.balance) : "—"} · MAS {row.mas || "—"}</span>
          </div>
          <div className="max-h-80 overflow-auto rounded-md border"><table className="w-full min-w-[560px] text-xs">
            <thead className="sticky top-0 bg-muted text-left"><tr>{["Month", "Status", "Collected", "Covered", "Receipts"].map((heading) => <th key={heading} className="p-2">{heading}</th>)}</tr></thead>
            <tbody>{[...row.periods].reverse().map((period) => <tr key={period.month} className="border-t align-top">
              <td className="p-2 font-medium">{period.month}</td>
              <td className="p-2">{period.error ? <span className="text-destructive">Needs review</span> : period.state ? <StatusBadge status={period.state.status} tone={statusTone(period.state.status)} /> : <span className="text-muted-foreground">Not enrolled</span>}</td>
              <td className="p-2 tabular-nums">{money(period.collected)}</td>
              <td className="p-2 tabular-nums">{money(period.coveredAmount)}</td>
              <td className="p-2">{period.receipts.length ? period.receipts.map((receipt) => <span key={receipt.id} className="block">OR {receipt.orNumber || "—"} · {receipt.orDate} · {money(receipt.amount)} · covers {receipt.monthFrom}{receipt.monthTo !== receipt.monthFrom ? ` to ${receipt.monthTo}` : ""}</span>) : <span className="text-muted-foreground">—</span>}</td>
            </tr>)}</tbody>
          </table></div>
        </section>;
      })}
    </div>}
  </div>;
}
