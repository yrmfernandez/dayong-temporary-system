"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Printer } from "lucide-react";

import { InlineRow } from "@/components/inline-panel";
import { MetricTile } from "@/components/metric-tile";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { todayInManila } from "@/lib/account-rules";

type Figures = {
  accounts: number; gross: number; incentives: number; fidelity: number; penalty: number; expectedRemittance: number;
  sales: Array<{ program: string; branch: string; accounts: number; gross: number }>;
  collections: Array<{ program: string; branch: string; accounts: number; gross: number; expectedRemittance: number }>;
  dailyAudits?: { approved: number; balanced: number; withFindings: number; drafts: number };
};
type Period = "daily" | "weekly" | "monthly" | "yearly";
const PERIODS: Array<[Period, string, string]> = [["daily", "Daily", "day"], ["weekly", "Weekly", "week"], ["monthly", "Monthly", "month"], ["yearly", "Yearly", "year"]];
type Audit = { id: string; status: string; findings: string; result: string; approvedByName: string; approvedAt: string; reopenReason: string; updatedAt: string; preparedBy: string };
type Row = { employeeId: string; employeeName: string; branch: string; status: "Not started" | "Draft" | "Approved"; audit: Audit | null; figures: Figures };

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value || 0);
const when = (value: string) => (value ? value.replace("T", " ").slice(0, 16) : "");

/** HR, Finance, and Administrators audit each Entry Clerk's report by day, week, month, or year; only an Administrator approves. */
export default function DailyAuditPage() {
  const [tab, setTab] = useState<Period | "summary">("daily");
  const period: Period = tab === "summary" ? "daily" : tab;
  const unit = PERIODS.find(([id]) => id === period)?.[2] ?? "day";
  const [date, setDate] = useState(todayInManila());
  const [span, setSpan] = useState({ from: "", to: "" });
  const [rows, setRows] = useState<Row[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState("");
  const [draft, setDraft] = useState({ findings: "", result: "Balanced", reason: "" });
  const [message, setMessage] = useState("");

  const load = useCallback(async (day: string, which: Period) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/audit?date=${encodeURIComponent(day)}&period=${which}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load audits.");
      setRows(result.audits); setCanApprove(Boolean(result.canApprove)); setSpan({ from: result.from, to: result.to });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to load audits."); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    // Loading the chosen period's audits owns the busy state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab !== "summary") void load(date, period);
  }, [date, period, tab, load]);

  function toggle(row: Row) {
    setMessage("");
    if (open === row.employeeId) { setOpen(""); return; }
    setOpen(row.employeeId);
    setDraft({ findings: row.audit?.findings ?? "", result: row.audit?.result || "Balanced", reason: "" });
  }

  async function send(method: "POST" | "PATCH", body: Record<string, unknown>, done: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/audit", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, period, ...body }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to update the audit.");
      setMessage(done); await load(date, period);
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Unable to update the audit."); setBusy(false); }
  }

  const count = (status: Row["status"]) => rows.filter((row) => row.status === status).length;
  return <section className="mx-auto max-w-6xl space-y-6">
    <header className="page-hero">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="tone-soft tone-brand rounded-2xl p-3"><ClipboardCheck className="size-8" /></div>
          <div>
            <h1 className="text-2xl font-bold">Audits</h1>
            <p className="mt-1 text-sm text-muted-foreground">Check each Entry Clerk&apos;s report for the day, week, month or year. HR and Finance prepare the audit; an Administrator approves it, which locks it.</p>
          </div>
        </div>
        {tab === "daily" && <label className="text-sm">Report date<Input type="date" className="mt-1 h-9" max={todayInManila()} value={date} onChange={(event) => { if (event.target.value) { setOpen(""); setDate(event.target.value); } }} /></label>}
        {tab === "weekly" && <label className="text-sm">Any day in the week<Input type="date" className="mt-1 h-9" max={todayInManila()} value={date} onChange={(event) => { if (event.target.value) { setOpen(""); setDate(event.target.value); } }} /></label>}
        {tab === "monthly" && <label className="text-sm">Month<Input type="month" className="mt-1 h-9" max={todayInManila().slice(0, 7)} value={date.slice(0, 7)} onChange={(event) => { if (event.target.value) { setOpen(""); setDate(`${event.target.value}-01`); } }} /></label>}
        {tab === "yearly" && <label className="text-sm">Year<Input type="number" className="mt-1 h-9 w-28" min={2019} max={Number(todayInManila().slice(0, 4))} value={date.slice(0, 4)} onChange={(event) => { const year = event.target.value; if (/^\d{4}$/.test(year)) { setOpen(""); setDate(`${year}-01-01`); } }} /></label>}
      </div>
    </header>

    <div role="tablist" aria-label="Audit views" className="flex w-fit flex-wrap gap-1 rounded-xl border bg-muted/40 p-1 print:hidden">
      {([...PERIODS.map(([id, label]) => [id, label] as const), ["summary", "Daily summary"] as const]).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setOpen(""); setMessage(""); setTab(id); }} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === id ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>)}
    </div>

    {tab === "summary" ? <AuditSummary /> : <>

    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {span.from && period !== "daily" && <p className="text-sm text-muted-foreground">Auditing the {unit} from <strong>{span.from}</strong> to <strong>{span.to}</strong>: each Entry Clerk&apos;s report totals for the whole {unit}, with how their daily audits stand.</p>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricTile tone="brand" label="Entry Clerks to audit" value={String(rows.length)} detail="Active Entry Clerks" />
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
              <td className="p-3"><strong>{row.employeeName}</strong><span className="block text-xs text-muted-foreground"><span className="font-mono">{row.employeeId}</span>{row.branch ? ` · ${row.branch}` : ""}</span></td>
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
                {row.figures.dailyAudits && <div className="grid gap-3 text-sm sm:grid-cols-4">
                  {[["Daily audits approved", row.figures.dailyAudits.approved], ["Balanced days", row.figures.dailyAudits.balanced], ["Days with findings", row.figures.dailyAudits.withFindings], ["Daily audits not yet approved", row.figures.dailyAudits.drafts]].map(([label, value]) =>
                    <div key={String(label)} className="rounded-lg border bg-background p-2"><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold tabular-nums">{value}</p></div>)}
                </div>}
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
          {!rows.length && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">{busy ? "Loading..." : "No active Entry Clerks to audit."}</td></tr>}
        </tbody>
      </table>
    </div>
    </>}
  </section>;
}

type Totals = { accounts: number; gross: number; incentives: number; fidelity: number; penalty: number; expectedRemittance: number };
type Summary = {
  from: string; to: string; clerks: Array<{ employeeId: string; name: string; branch: string; branches: string[] }>; branches: string[];
  counts: { approved: number; balanced: number; withFindings: number; drafts: number }; totals: Totals;
  byClerk: Array<Totals & { employeeId: string; name: string; branch: string; branches: string[]; approvedDays: number; balanced: number; withFindings: number; drafts: number }>;
  audits: Array<{ date: string; employeeId: string; employeeName: string; branch: string; result: string; findings: string; approvedByName: string; approvedAt: string; figures: Totals | null }>;
};

/** Approved audits for a period, branch (any branch the clerk is assigned to), and Entry Clerk. */
function AuditSummary() {
  const today = todayInManila();
  const [filters, setFilters] = useState({ from: `${today.slice(0, 7)}-01`, to: today, branch: "", employeeId: "" });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(filters).toString();
    fetch(`/api/audit/summary?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.message || "Unable to load the summary."); setSummary(result.summary); setError(""); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load the summary."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [filters]);
  const set = (patch: Partial<typeof filters>) => { setBusy(true); setFilters((current) => ({ ...current, ...patch })); };
  const figureCells = (totals: Totals) => [String(totals.accounts), money(totals.gross), money(totals.incentives), money(totals.fidelity), money(totals.penalty), money(totals.expectedRemittance)];
  const figureHeaders = ["Accounts", "Collected", "Incentives", "Fidelity", "Penalties", "Expected remittance"];
  return <div className="space-y-6">
    <div className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2 lg:grid-cols-5 print:hidden">
      <label className="text-sm">This month<Input type="month" className="mt-1 h-9" value={filters.from.slice(0, 7) === filters.to.slice(0, 7) ? filters.from.slice(0, 7) : ""} onChange={(event) => { const month = event.target.value; if (!month) return; const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10); set({ from: `${month}-01`, to: last > today ? today : last }); }} /></label>
      <label className="text-sm">From<Input type="date" className="mt-1 h-9" value={filters.from} max={filters.to} onChange={(event) => event.target.value && set({ from: event.target.value })} /></label>
      <label className="text-sm">To<Input type="date" className="mt-1 h-9" value={filters.to} min={filters.from} onChange={(event) => event.target.value && set({ to: event.target.value })} /></label>
      <label className="text-sm">Branch<SearchSelect aria-label="Branch" className="mt-1 h-9" clearable placeholder="All branches" value={filters.branch} onValueChange={(branch) => set({ branch })} options={(summary?.branches ?? []).map((branch) => ({ value: branch, label: branch }))} /></label>
      <label className="text-sm">Entry Clerk<SearchSelect aria-label="Entry Clerk" className="mt-1 h-9" clearable placeholder="All Entry Clerks" value={filters.employeeId} onValueChange={(employeeId) => set({ employeeId })} options={(summary?.clerks ?? []).filter((clerk) => !filters.branch || clerk.branches.includes(filters.branch)).map((clerk) => ({ value: clerk.employeeId, label: clerk.name, description: `${clerk.employeeId} · ${clerk.branches.join(", ") || "No branch"}` }))} /></label>
    </div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {summary && <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Approved audits from {summary.from} to {summary.to}{filters.branch ? ` · ${filters.branch}` : ""}{filters.employeeId ? ` · ${summary.clerks.find((clerk) => clerk.employeeId === filters.employeeId)?.name ?? ""}` : ""}{busy ? " · updating..." : ""}</p>
        <Button type="button" variant="outline" className="print:hidden" onClick={() => window.print()}><Printer className="size-4" />Print</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile tone="success" label="Approved audits" value={String(summary.counts.approved)} />
        <MetricTile tone="brand" label="Balanced" value={String(summary.counts.balanced)} />
        <MetricTile tone="danger" label="With findings" value={String(summary.counts.withFindings)} />
        <MetricTile tone="warning" label="Not yet approved" value={String(summary.counts.drafts)} detail="Drafts in this period (not counted)" />
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">{figureHeaders.map((label, index) => <div key={label} className="rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold tabular-nums">{figureCells(summary.totals)[index]}</p></div>)}</div>

      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-muted"><tr>{["Entry Clerk", "Branch", "Approved days", "Balanced", "With findings", ...figureHeaders].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
          <tbody>
            {summary.byClerk.map((clerk) => <tr key={clerk.employeeId} className="border-t"><td className="p-3"><strong>{clerk.name}</strong>{clerk.drafts > 0 && <span className="block text-xs text-amber-700">{clerk.drafts} not yet approved</span>}</td><td className="p-3">{clerk.branch || "—"}{clerk.branches.length > 1 && <span className="block text-xs text-muted-foreground">Also: {clerk.branches.filter((name) => name !== clerk.branch).join(", ")}</span>}</td><td className="p-3 tabular-nums">{clerk.approvedDays}</td><td className="p-3 tabular-nums">{clerk.balanced}</td><td className="p-3 tabular-nums">{clerk.withFindings}</td>{figureCells(clerk).map((value, index) => <td key={index} className="p-3 tabular-nums">{value}</td>)}</tr>)}
            {!summary.byClerk.length && <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">No Entry Clerks match these filters.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-muted"><tr>{["Date", "Entry Clerk", "Branch", "Result", "Collected", "Expected remittance", "Findings", "Approved by"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
          <tbody>
            {summary.audits.map((audit) => <tr key={`${audit.date}-${audit.employeeId}`} className="border-t align-top"><td className="p-3 whitespace-nowrap">{audit.date}</td><td className="p-3">{audit.employeeName}</td><td className="p-3">{audit.branch || "—"}</td><td className="p-3"><StatusBadge status={audit.result} tone={audit.result === "Balanced" ? "success" : "danger"} /></td><td className="p-3 tabular-nums">{money(audit.figures?.gross ?? 0)}</td><td className="p-3 tabular-nums">{money(audit.figures?.expectedRemittance ?? 0)}</td><td className="p-3 whitespace-pre-wrap">{audit.findings || "—"}</td><td className="p-3">{audit.approvedByName}<span className="block text-xs text-muted-foreground">{when(audit.approvedAt)}</span></td></tr>)}
            {!summary.audits.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">{busy ? "Loading..." : "No approved audits in this period."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>}
  </div>;
}
