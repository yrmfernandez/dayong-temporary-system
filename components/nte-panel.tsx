"use client";

import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import { readApiResponse } from "@/lib/api-response";
import type { Nte } from "@/lib/nte";

type Standing = { employeeId: string; employeeName: string; active: number; subjectToSuspension: boolean; nextExpiry: string };
type Data = { notices: Nte[]; standing: Standing[]; today: string; days: number; threshold: number };
const fieldClass = "mt-1 block w-full rounded-md border bg-background p-2 text-sm";
const when = (value: string) => value ? new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "";

/**
 * Notices to Explain, for administrators (the panel hides itself for anyone else). A notice is in force for 90 days;
 * an employee with 3 or more in force is flagged as subject to suspension. The employee sees the notice in My Notices;
 * the table shows whether they have read it and their explanation.
 */
export function NtePanel({ employees }: { employees: Array<{ id: string; name: string }> }) {
  const [data, setData] = useState<Data | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/nte", { cache: "no-store" });
    if (response.status === 403) { setAllowed(false); return; }
    const result = await readApiResponse(response);
    if (response.ok && result.success) setData(result as unknown as Data); else setMessage(result.message || "Unable to load notices.");
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the notices once
    void load();
  }, [load]);
  if (!allowed) return null;

  const send = async (method: "POST" | "PATCH", body: Record<string, unknown>) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/nte", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await readApiResponse(response);
      setMessage(result.message || (response.ok ? "Saved." : "Unable to save."));
      if (response.ok && result.success) await load();
      return response.ok && result.success;
    } finally { setBusy(false); }
  };
  const flagged = data?.standing.filter((item) => item.subjectToSuspension) ?? [];
  const shown = (data?.notices ?? []).filter((nte) => showAll || nte.status === "Active");

  return <section className="space-y-4 rounded-xl border bg-background p-4" aria-label="Notices to Explain">
    <div>
      <h2 className="text-lg font-semibold">Notices to Explain (NTE)</h2>
      <p className="text-sm text-muted-foreground">A notice is in force for {data?.days ?? 90} days from the date issued. An employee with {data?.threshold ?? 3} or more notices in force is subject to suspension.</p>
    </div>
    {flagged.length > 0 && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" />Subject to suspension</p>
      <ul className="mt-1 list-disc pl-5">{flagged.map((item) => <li key={item.employeeId}>{item.employeeName} ({item.employeeId}): {item.active} notices in force; the earliest expires {item.nextExpiry}.</li>)}</ul>
    </div>}
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      if (await send("POST", { ...values, employeeId })) { form.reset(); setEmployeeId(""); }
    }}>
      <label className="text-sm">Employee *<SearchSelect aria-label="Employee" className="mt-1 h-9" placeholder="Search employee" value={employeeId} onValueChange={setEmployeeId} options={employees.map((item) => ({ value: item.id, label: item.name, description: item.id }))} /></label>
      <label className="text-sm">Date issued *<input name="issuedOn" type="date" required className={fieldClass} defaultValue={data?.today} max={data?.today} /></label>
      <label className="text-sm lg:col-span-2">Reason *<input name="reason" required minLength={3} maxLength={200} className={fieldClass} placeholder="e.g. Late remittance on 2026-10-05" /></label>
      <label className="text-sm sm:col-span-2 lg:col-span-3">Details<input name="details" maxLength={2000} className={fieldClass} placeholder="Optional" /></label>
      <div className="flex items-end"><Button type="submit" disabled={busy || !employeeId}>{busy ? "Saving..." : "Issue NTE"}</Button></div>
    </form>
    {message && <p role="status" className="text-sm">{message}</p>}
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium">{showAll ? "All notices" : "Notices in force"} ({shown.length})</p>
      <Button type="button" size="sm" variant="ghost" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show only notices in force" : "Show expired and withdrawn too"}</Button>
    </div>
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted"><tr>{["Employee", "Issued", "Expires", "Reason", "Status", "Employee's reply", "Issued by", ""].map((label, index) => <th key={index} scope="col" className="p-2">{label}</th>)}</tr></thead>
        <tbody>
          {shown.map((nte) => {
            const count = data?.standing.find((item) => item.employeeId === nte.employeeId)?.active ?? 0;
            return <tr key={nte.id} className="border-t align-top">
              <td className="p-2">{nte.employeeName}<span className="block text-xs text-muted-foreground">{nte.employeeId} · {count} in force</span></td>
              <td className="p-2">{nte.issuedOn}</td>
              <td className="p-2">{nte.expiresOn}</td>
              <td className="p-2">{nte.reason}{nte.details && <span className="block text-xs text-muted-foreground">{nte.details}</span>}{nte.withdrawnReason && <span className="block text-xs text-muted-foreground">Withdrawn: {nte.withdrawnReason}</span>}</td>
              <td className="p-2"><StatusBadge status={nte.status} tone={nte.status === "Active" ? "warning" : undefined} /></td>
              <td className="p-2 max-w-xs">{nte.explanation
                ? <><span className="block whitespace-pre-wrap">{nte.explanation}</span><span className="block text-xs text-muted-foreground">Explained {when(nte.explainedAt)}</span>
                  {nte.reviewedAt
                    ? <span className="block text-xs text-emerald-700">Reviewed {when(nte.reviewedAt)}{nte.reviewedBy ? ` by ${nte.reviewedBy}` : ""}</span>
                    : <Button type="button" size="sm" variant="outline" className="mt-1" disabled={busy} onClick={() => void send("PATCH", { id: nte.id, action: "reviewed" })}>Mark reviewed</Button>}</>
                : nte.acknowledgedAt ? <span className="text-xs text-muted-foreground">Read {when(nte.acknowledgedAt)}; no explanation yet</span>
                : <span className="text-xs text-amber-700">Not yet read by the employee</span>}</td>
              <td className="p-2">{nte.issuedBy || "-"}</td>
              <td className="p-2 text-right">{nte.status === "Active" && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { const reason = window.prompt(`Withdraw the notice to ${nte.employeeName}? Give the reason:`); if (reason) void send("PATCH", { id: nte.id, reason }); }}>Withdraw</Button>}</td>
            </tr>;
          })}
          {!shown.length && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">{data ? "No notices." : "Loading..."}</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}
