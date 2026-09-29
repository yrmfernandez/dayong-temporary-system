"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";

import { InlineRow } from "@/components/inline-panel";
import { MetricTile } from "@/components/metric-tile";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayInManila } from "@/lib/account-rules";

type Figures = {
  accounts: number; gross: number; incentives: number; fidelity: number; penalty: number; expectedRemittance: number;
  sales: Array<{ program: string; branch: string; accounts: number; gross: number }>;
  collections: Array<{ program: string; branch: string; accounts: number; gross: number; expectedRemittance: number }>;
};
type Audit = { id: string; status: string; findings: string; result: string; approvedByName: string; approvedAt: string; reopenReason: string; updatedAt: string; preparedBy: string };
type Row = { employeeId: string; employeeName: string; status: "Not started" | "Draft" | "Approved"; audit: Audit | null; figures: Figures };

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value || 0);
const when = (value: string) => (value ? value.replace("T", " ").slice(0, 16) : "");

/** HR, Finance, and Administrators audit each employee's Daily Report; only an Administrator approves. */
export default function DailyAuditPage() {
  const [date, setDate] = useState(todayInManila());
  const [rows, setRows] = useState<Row[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState("");
  const [draft, setDraft] = useState({ findings: "", result: "Balanced", reason: "" });
  const [message, setMessage] = useState("");

  const load = useCallback(async (day: string) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/audit?date=${encodeURIComponent(day)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load audits.");
      setRows(result.audits); setCanApprove(Boolean(result.canApprove));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to load audits."); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    // Loading the chosen day's audits owns the busy state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(date);
  }, [date, load]);

  function toggle(row: Row) {
    setMessage("");
    if (open === row.employeeId) { setOpen(""); return; }
    setOpen(row.employeeId);
    setDraft({ findings: row.audit?.findings ?? "", result: row.audit?.result || "Balanced", reason: "" });
  }

  async function send(method: "POST" | "PATCH", body: Record<string, unknown>, done: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/audit", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, ...body }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to update the audit.");
      setMessage(done); await load(date);
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Unable to update the audit."); setBusy(false); }
  }

  const count = (status: Row["status"]) => rows.filter((row) => row.status === status).length;
  return <section className="mx-auto max-w-6xl space-y-6">
    <header className="page-hero">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="tone-soft tone-brand rounded-2xl p-3"><ClipboardCheck className="size-8" /></div>
          <div>
            <h1 className="text-2xl font-bold">Daily Audit</h1>
            <p className="mt-1 text-sm text-muted-foreground">Check each employee&apos;s Daily Report for the day. HR and Finance prepare the audit; an Administrator approves it, which locks it.</p>
          </div>
        </div>
        <label className="text-sm">Report date<Input type="date" className="mt-1 h-9" max={todayInManila()} value={date} onChange={(event) => { setOpen(""); setDate(event.target.value); }} /></label>
      </div>
    </header>

    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricTile tone="brand" label="Employees to audit" value={String(rows.length)} detail="Those with Daily Report access" />
      <MetricTile tone="warning" label="Not started" value={String(count("Not started"))} />
      <MetricTile tone="teal" label="Draft" value={String(count("Draft"))} detail="Prepared, awaiting approval" />
      <MetricTile tone="success" label="Approved" value={String(count("Approved"))} />
    </div>

    <div className="overflow-x-auto rounded-xl border bg-background">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted"><tr>{["Employee", "Accounts", "Amount collected", "Expected remittance", "Status", ""].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => <Fragment key={row.employeeId}>
            <tr className="border-t">
              <td className="p-3"><strong>{row.employeeName}</strong><span className="block font-mono text-xs text-muted-foreground">{row.employeeId}</span></td>
              <td className="p-3 tabular-nums">{row.figures.accounts}</td>
              <td className="p-3 tabular-nums">{money(row.figures.gross)}</td>
              <td className="p-3 tabular-nums">{money(row.figures.expectedRemittance)}</td>
              <td className="p-3"><StatusBadge status={row.status} tone={row.status === "Approved" ? "success" : row.status === "Draft" ? "info" : "warning"} />{row.audit?.result && <span className="block text-xs text-muted-foreground">{row.audit.result}</span>}</td>
              <td className="p-3 text-right"><Button type="button" size="sm" variant={open === row.employeeId ? "default" : "outline"} aria-expanded={open === row.employeeId} onClick={() => toggle(row)}>{open === row.employeeId ? "Close" : row.status === "Approved" ? "View" : "Audit"}</Button></td>
            </tr>
            {open === row.employeeId && <InlineRow colSpan={6}>
              <div className="space-y-4">
                <div className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
                  {[["Accounts", String(row.figures.accounts)], ["Amount collected", money(row.figures.gross)], ["Incentives", money(row.figures.incentives)], ["Fidelity", money(row.figures.fidelity)], ["Penalties", money(row.figures.penalty)], ["Expected remittance", money(row.figures.expectedRemittance)]].map(([label, value]) =>
                    <div key={label} className="rounded-lg border bg-background p-2"><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold tabular-nums">{value}</p></div>)}
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div><p className="mb-1 text-sm font-semibold">New Sales ({row.figures.sales.length})</p>
                    {row.figures.sales.length ? <ul className="divide-y rounded-lg border bg-background text-sm">{row.figures.sales.map((line, index) => <li key={index} className="flex justify-between gap-2 p-2"><span>{line.program}<span className="block text-xs text-muted-foreground">{line.branch} · {line.accounts} account(s)</span></span><span className="tabular-nums">{money(line.gross)}</span></li>)}</ul>
                      : <p className="text-sm text-muted-foreground">No new sales encoded.</p>}</div>
                  <div><p className="mb-1 text-sm font-semibold">Collections ({row.figures.collections.length})</p>
                    {row.figures.collections.length ? <ul className="divide-y rounded-lg border bg-background text-sm">{row.figures.collections.map((line, index) => <li key={index} className="flex justify-between gap-2 p-2"><span>{line.program}<span className="block text-xs text-muted-foreground">{line.branch} · {line.accounts} account(s) · remit {money(line.expectedRemittance)}</span></span><span className="tabular-nums">{money(line.gross)}</span></li>)}</ul>
                      : <p className="text-sm text-muted-foreground">No collections encoded.</p>}</div>
                </div>
                {row.audit?.reopenReason && row.status === "Draft" && <p className="text-xs text-amber-700">Reopened: {row.audit.reopenReason}</p>}
                {row.status === "Approved" ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <p><strong>{row.audit?.result}</strong> · approved by {row.audit?.approvedByName} on {when(row.audit?.approvedAt ?? "")}. Figures are locked as approved.</p>
                  {row.audit?.findings && <p className="mt-1 whitespace-pre-wrap">{row.audit.findings}</p>}
                  {canApprove && <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs">Reason to reopen<Input className="mt-1 h-9 min-w-72 bg-background" value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label><Button type="button" variant="outline" disabled={busy || draft.reason.trim().length < 3} onClick={() => void send("PATCH", { employeeId: row.employeeId, decision: "reopen", reason: draft.reason }, "Audit reopened.")}>Reopen</Button></div>}
                </div> : <div className="space-y-3">
                  <div role="radiogroup" aria-label="Audit result" className="flex flex-wrap gap-2">{(["Balanced", "With findings"] as const).map((result) => <label key={result} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${draft.result === result ? "border-primary bg-primary/5 font-semibold" : ""}`}><input type="radio" name={`result-${row.employeeId}`} checked={draft.result === result} onChange={() => setDraft({ ...draft, result })} />{result}</label>)}</div>
                  <label className="block text-sm">Findings{draft.result === "With findings" ? " *" : ""}<textarea className="mt-1 block min-h-24 w-full rounded-md border bg-background p-2 text-sm" maxLength={2000} value={draft.findings} placeholder="What was checked (receipts, slips, cash) and anything that does not match." onChange={(event) => setDraft({ ...draft, findings: event.target.value })} /></label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" disabled={busy} onClick={() => void send("POST", { employeeId: row.employeeId, findings: draft.findings, result: draft.result }, "Audit saved as draft.")}>Save draft</Button>
                    {canApprove && row.status === "Draft" && <Button type="button" variant="outline" disabled={busy} onClick={() => void send("PATCH", { employeeId: row.employeeId, decision: "approve" }, "Audit approved and locked.")}>Approve</Button>}
                    {!canApprove && <span className="text-xs text-muted-foreground">An Administrator approves saved audits.</span>}
                    {row.audit?.updatedAt && <span className="text-xs text-muted-foreground">Last saved {when(row.audit.updatedAt)}{row.audit.preparedBy ? ` · prepared by ${row.audit.preparedBy.replace(/^'/, "")}` : ""}</span>}
                  </div>
                </div>}
                {message && <p role="status" className="text-sm">{message}</p>}
              </div>
            </InlineRow>}
          </Fragment>)}
          {!rows.length && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">{busy ? "Loading..." : "No employees with Daily Report access."}</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}
