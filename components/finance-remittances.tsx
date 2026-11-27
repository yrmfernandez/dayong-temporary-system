"use client";

import { useCallback, useEffect, useState } from "react";

import { promptDialog } from "@/components/app-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseJsonResponse } from "@/lib/api-response";
import type { BankDeposit } from "@/lib/clerk-cash";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { formatPeso } from "@/lib/money";

type Row = BankDeposit & { employeeName: string; recordedAt: string };

/**
 * Cash remitted to Finance, in Remittances → Cash counts (owner, November 27, 2026): what each Entry Clerk recorded as
 * handed to Finance. Finance checks the amount received and confirms it, or rejects it with a note; the clerk's audit
 * for that day is saved only once it is confirmed (lib/clerk-cash.ts, lib/daily-audit.ts).
 */
export function FinanceRemittances() {
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/finance-remittances", { cache: "no-store" });
    const result = await parseJsonResponse<{ success: boolean; message?: string; remittances?: Row[] }>(response);
    if (!response.ok || !result.success) { setMessage(result.message || "Unable to load the cash remitted to Finance."); return; }
    setRows(result.remittances ?? []);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void load();
  }, [load]);
  useLiveRefresh(["bank_deposits"], load);

  const decide = async (row: Row, decision: "confirm" | "reject") => {
    const note = decision === "reject"
      ? (await promptDialog(`Why is ${formatPeso(row.amount)} from ${row.employeeName} not correct? Give the amount Finance received; the clerk sees this and corrects the record.`, { required: true, title: "Amount not correct", confirmLabel: "Reject" })) ?? ""
      : "ok";
    if (!note.trim()) return;
    setSaving(row.id); setMessage("");
    try {
      const response = await fetch("/api/finance-remittances", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, decision, note: note === "ok" ? "" : note }) });
      const result = await parseJsonResponse<{ success: boolean; message?: string }>(response);
      setMessage(result.message ?? (response.ok ? "Done." : "Unable to decide."));
      if (response.ok && result.success) await load();
    } finally { setSaving(""); }
  };
  const pending = rows.filter((row) => row.financeStatus === "Pending"), decided = rows.filter((row) => row.financeStatus !== "Pending");

  return <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>Cash remitted to Finance to confirm ({pending.length})</CardTitle>
        <p className="text-sm text-muted-foreground">Cash each Entry Clerk recorded as handed to Finance. Check the amount you received: Confirm when it is correct, Reject with the amount you received when it is not. The clerk&apos;s audit for that day cannot be saved until it is confirmed.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {message && <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm" role="status">{message}</p>}
        {pending.map((row) => <div key={row.id} className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1 text-sm">
            <p className="font-semibold">{row.employeeName} · {row.branch} · {formatDate(row.date)}</p>
            <p>Remitted <strong>{formatPeso(row.amount)}</strong> · received by {row.bankAccount || "—"}</p>
            {row.remarks && <p className="text-muted-foreground">Remarks: {row.remarks}</p>}
            <p className="text-xs text-muted-foreground">{row.id}{row.recordedAt ? ` · recorded ${formatDateTime(row.recordedAt)}` : ""}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" size="sm" disabled={Boolean(saving)} onClick={() => void decide(row, "confirm")}>{saving === row.id ? "Saving..." : "Confirm amount"}</Button>
            <Button type="button" size="sm" variant="outline" disabled={Boolean(saving)} onClick={() => void decide(row, "reject")}>Not correct</Button>
          </div>
        </div>)}
        {!pending.length && <p className="py-8 text-center text-sm text-muted-foreground">No cash remitted to Finance is waiting.</p>}
      </CardContent>
    </Card>
    {decided.length > 0 && <Card>
      <CardHeader><CardTitle>Cash remitted to Finance: decided ({decided.length})</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/50 text-left"><tr>{["Clerk", "Branch", "Date", "Amount", "Decision", "Note"].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead>
          <tbody>{decided.map((row) => <tr key={row.id} className="border-t align-top">
            <td className="p-3">{row.employeeName}<span className="block font-mono text-xs text-muted-foreground">{row.id}</span></td>
            <td className="p-3">{row.branch}</td>
            <td className="p-3">{formatDate(row.date)}</td>
            <td className="p-3">{formatPeso(row.amount)}</td>
            <td className="p-3"><StatusBadge status={row.financeStatus} tone={row.financeStatus === "Confirmed" ? "success" : "neutral"} /><span className="block text-xs text-muted-foreground">{row.financeDecidedBy}{row.financeDecidedAt ? ` · ${formatDateTime(row.financeDecidedAt)}` : ""}</span></td>
            <td className="p-3 text-xs">{row.financeNote || "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </CardContent>
    </Card>}
  </div>;
}
