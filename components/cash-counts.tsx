"use client";

import { useCallback, useEffect, useState } from "react";

import { promptDialog } from "@/components/app-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseJsonResponse } from "@/lib/api-response";
import type { CashCount } from "@/lib/cash-position";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { formatPeso } from "@/lib/money";

type Row = CashCount & { expected: number | null };

/**
 * The Cash counts tab of Remittances (lib/cash-position.ts, owner, November 24, 2026): the cash each Entry Clerk counted
 * for a branch at the start of a day. Finance or an Administrator confirms it, and from then on the clerk's reports
 * carry the cash from it. A pending count shows what the system expected that day, so a difference shows first.
 */
export function CashCounts() {
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/cash-counts", { cache: "no-store" });
    const result = await parseJsonResponse<{ success: boolean; message?: string; counts?: Row[] }>(response);
    if (!response.ok || !result.success) { setMessage(result.message || "Unable to load the cash counts."); return; }
    setRows(result.counts ?? []);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void load();
  }, [load]);
  useLiveRefresh(["cash_counts"], load);

  const decide = async (row: Row, decision: "confirm" | "reject") => {
    const note = decision === "reject"
      ? (await promptDialog(`Why is ${row.employeeName}'s count of ${formatPeso(row.amount)} rejected? The clerk sees this and counts again.`, { required: true, title: "Reject cash count", confirmLabel: "Reject" })) ?? ""
      : row.expected !== null && Math.round(row.expected * 100) !== Math.round(row.amount * 100)
        ? (await promptDialog(`The system expected ${formatPeso(row.expected)}; ${row.employeeName} counted ${formatPeso(row.amount)} (${formatPeso(row.amount - row.expected)}). Confirm the counted cash? Note the reason for the difference.`, { required: true, title: "Confirm with a difference", confirmLabel: "Confirm" })) ?? ""
        : "ok";
    if (!note.trim()) return;
    setSaving(row.id); setMessage("");
    try {
      const response = await fetch("/api/cash-counts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, decision, note: note === "ok" ? "" : note }) });
      const result = await parseJsonResponse<{ success: boolean; message?: string }>(response);
      setMessage(result.message ?? (response.ok ? "Done." : "Unable to decide."));
      if (response.ok && result.success) await load();
    } finally { setSaving(""); }
  };
  const pending = rows.filter((row) => row.status === "Pending"), decided = rows.filter((row) => row.status !== "Pending");

  return <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>Cash counts to confirm ({pending.length})</CardTitle>
        <p className="text-sm text-muted-foreground">The cash each Entry Clerk counted for a branch at the start of a day. Once confirmed, their reports start from it and carry the cash on hand day after day, so the weekly, monthly and yearly Remaining Cash on Hand is the real cash held. Expected is what the system worked out from their previous confirmed count; none on the first count.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {message && <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm" role="status">{message}</p>}
        {pending.map((row) => {
          const difference = row.expected === null ? null : Math.round((row.amount - row.expected) * 100) / 100;
          return <div key={row.id} className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1 text-sm">
              <p className="font-semibold">{row.employeeName} · {row.branch} · start of {formatDate(row.date)}</p>
              <p>Counted <strong>{formatPeso(row.amount)}</strong>{row.denominations ? ` (${row.denominations})` : ""}{row.expected !== null ? <> · expected {formatPeso(row.expected)} · <span className={difference ? "font-semibold text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>{difference ? `difference ${formatPeso(difference)}` : "matches"}</span></> : " · first count"}</p>
              {row.note && <p className="text-muted-foreground">Note: {row.note}</p>}
              <p className="text-xs text-muted-foreground">{row.id} · recorded by {row.recordedBy || row.employeeName}{row.recordedAt ? ` · ${formatDateTime(row.recordedAt)}` : ""}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" size="sm" disabled={Boolean(saving)} onClick={() => void decide(row, "confirm")}>{saving === row.id ? "Saving..." : "Confirm"}</Button>
              <Button type="button" size="sm" variant="outline" disabled={Boolean(saving)} onClick={() => void decide(row, "reject")}>Reject</Button>
            </div>
          </div>;
        })}
        {!pending.length && <p className="py-8 text-center text-sm text-muted-foreground">No cash count is waiting.</p>}
      </CardContent>
    </Card>
    {decided.length > 0 && <Card>
      <CardHeader><CardTitle>Decided ({decided.length})</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/50 text-left"><tr>{["Clerk", "Branch", "Start of", "Counted", "Decision", "Note"].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead>
          <tbody>{decided.map((row) => <tr key={row.id} className="border-t align-top">
            <td className="p-3">{row.employeeName}<span className="block font-mono text-xs text-muted-foreground">{row.id}</span></td>
            <td className="p-3">{row.branch}</td>
            <td className="p-3">{formatDate(row.date)}</td>
            <td className="p-3">{formatPeso(row.amount)}</td>
            <td className="p-3"><StatusBadge status={row.status} tone={row.status === "Confirmed" ? "success" : "neutral"} /><span className="block text-xs text-muted-foreground">{row.decidedBy}{row.decidedAt ? ` · ${formatDateTime(row.decidedAt)}` : ""}</span></td>
            <td className="p-3 text-xs">{row.decisionNote || "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </CardContent>
    </Card>}
  </div>;
}
