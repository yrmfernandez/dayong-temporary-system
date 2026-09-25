"use client";

import { useEffect, useRef, useState } from "react";
import type { buildMamReport } from "@/lib/mam-report";
import { todayInManila } from "@/lib/account-rules";
import { Button } from "@/components/ui/button";

type Report = ReturnType<typeof buildMamReport>;
type Row = Report["rows"][number];
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const statuses = ["NS", "U", "ADV", "60D", "90D", "120D", "150D", "Forfeited"];
const monthLabel = (value: string) => new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T00:00:00Z`));
const csvCell = (value: unknown) => `"${String(value ?? "").replace(/^[=+@\-]/, "'$&").replaceAll('"', '""')}"`;

export default function MamPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [from, setFrom] = useState(() => todayInManila().slice(0, 7));
  const [to, setTo] = useState(() => todayInManila().slice(0, 7));
  const [branch, setBranch] = useState("");
  const [mas, setMas] = useState("");
  const [program, setProgram] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const pending = useRef<AbortController | null>(null);
  async function load(sync = false) {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(""); setSelected(null);
    try {
      if (!from || !to || from > to) throw new Error("Choose a valid From / To month range.");
      if (sync) {
        const response = await fetch("/api/mam", { method: "POST", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Unable to sync statuses.");
      }
      const response = await fetch(`/api/mam?from=${from}&to=${to}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load MAM.");
      if (!controller.signal.aborted) setReport(result);
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load MAM."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController(); pending.current = controller;
    void fetch("/api/mam", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load MAM.");
      if (!controller.signal.aborted) setReport(result);
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load MAM."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => pending.current?.abort();
  }, []);
  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selected]);
  const rows = report?.rows.filter((r) => (!branch || r.branch === branch) && (!mas || r.mas === mas) && (!program || r.programId === program)
    && (!status || r.periods.some((p) => p.state?.status === status)) && `${r.memberName} ${r.memberNumber} ${r.applicationNumber}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row.branch}\u0000${row.mas}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const totalCollected = rows.reduce((sum, row) => sum + row.periods.reduce((subtotal, period) => subtotal + period.collected, 0), 0);
  const quota = rows.reduce((sum, row) => sum + (row.periods.at(-1)?.state?.balance ?? 0), 0);
  const lastMonthCollected = rows.reduce((sum, row) => sum + (row.periods.at(-1)?.collected ?? 0), 0);
  const activeCount = rows.filter((row) => { const p = row.periods.at(-1); return p?.state && p.state.status !== "Forfeited" && !p.state.temporarilySuspended; }).length;
  const options = (field: "branch" | "mas") => [...new Set(report?.rows.map((r) => r[field]) ?? [])].sort();
  function exportCsv() {
    const table: unknown[][] = [["Branch", "MAS", "Member", "Member Number", "Program", "Month", "Status", "Amount Received", "Covered Amount", "NOP", "TMD", "Balance", "Suspended", "Error"]];
    for (const row of rows) for (const period of row.periods) table.push([row.branch, row.mas, row.memberName, row.memberNumber, row.programName, period.month, period.state?.status, period.collected, period.coveredAmount, period.state?.nop, period.state?.tmd, period.state?.balance, period.state?.temporarilySuspended ? "Yes" : "No", period.error]);
    const url = URL.createObjectURL(new Blob(["\uFEFF" + table.map((r) => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `MAM-${report?.from}-${report?.to}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  const selectClass = "mt-1 block w-full rounded-md border bg-background p-2 text-sm";
  return <section className="mam-report space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Member Account Monitoring</h1><p className="text-sm text-muted-foreground">Monitor account coverage, collections, and balances across months.</p></div>
      <div className="flex gap-2 print:hidden"><Button disabled={busy} variant="outline" onClick={() => void load(true)}>Sync current statuses</Button><Button disabled={!report} variant="outline" onClick={() => window.print()}>Print</Button><Button disabled={!report} variant="outline" onClick={exportCsv}>Export CSV</Button></div>
    </div>
    <div className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
      <label className="text-sm">From month<input aria-label="From month" type="month" className={selectClass} value={from} onChange={(e) => setFrom(e.target.value)}/></label>
      <label className="text-sm">To month<input aria-label="To month" type="month" className={selectClass} value={to} min={from} onChange={(e) => setTo(e.target.value)}/></label>
      <label className="text-sm">Branch<select className={selectClass} value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">All branches</option>{options("branch").map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className="text-sm">MAS<select className={selectClass} value={mas} onChange={(e) => setMas(e.target.value)}><option value="">All MAS</option>{options("mas").map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className="text-sm">Program<select className={selectClass} value={program} onChange={(e) => setProgram(e.target.value)}><option value="">All programs</option>{[...new Map(report?.rows.map((r) => [r.programId, r.programName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="text-sm">Status (any displayed month)<select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className="text-sm">Search<input className={selectClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Member, PH number, APP number"/></label>
      <div className="flex items-end gap-2"><Button disabled={busy} onClick={() => void load()}>{busy ? "Loading..." : "Apply range"}</Button><Button variant="ghost" onClick={() => { setBranch(""); setMas(""); setProgram(""); setStatus(""); setSearch(""); }}>Reset filters</Button></div>
    </div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {report && <p className="text-sm text-muted-foreground">Showing {monthLabel(report.from)} – {monthLabel(report.to)} · As of {report.today}. Scroll horizontally to compare months. Future columns are projections.</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Active accounts at range end", activeCount], ["Collections received in range", money(totalCollected)], ["Quota at range end", money(quota)], ["Collection rate in final month", quota ? `${(lastMonthCollected / quota * 100).toFixed(1)}%` : "—"]].map(([label, value]) => <div key={label} className="rounded-xl border bg-background p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>)}</div>
    <div className="flex flex-wrap gap-2">{statuses.map((s) => <span key={s} className="rounded border bg-background px-3 py-2 text-xs">{s}: {rows.filter((r) => r.periods.at(-1)?.state?.status === s).length}</span>)}</div>
    <p className="text-xs text-muted-foreground">Quota uses the final month&apos;s balances. Forfeited accounts and periods needing review are excluded. Collections are counted once by OR Date; advance coverage is shown separately.</p>
    {[...groups].map(([key, group]) => <section key={key} className="overflow-hidden rounded-xl border bg-background">
      <div className="flex flex-wrap justify-between gap-2 border-b bg-muted/40 p-4"><div className="font-semibold">MAS: {group[0].mas} <span className="font-normal text-muted-foreground">· {group[0].branch}</span></div><span className="text-sm">{group.length} accounts</span></div>
      <div className="mam-scroll overflow-x-auto" tabIndex={0} role="region" aria-label={`Monthly monitoring for ${group[0].mas}`}>
        <table className="w-max min-w-full border-collapse text-sm">
          <thead><tr className="border-b bg-muted/30 text-left"><th className="sticky left-0 z-10 w-64 min-w-64 bg-background p-4">Member / Program</th>{report?.months.map((month) => <th key={month} className="min-w-80 border-l p-4">{monthLabel(month)}{month > report.today.slice(0, 7) && <span className="ml-2 text-xs font-normal">Projected</span>}</th>)}</tr></thead>
          <tbody>{group.map((row) => <tr key={row.id} className="border-b align-top">
            <td className="sticky left-0 z-10 max-w-64 bg-background p-4"><button className="text-left font-semibold underline-offset-4 hover:underline" onClick={() => setSelected(row)}>{row.memberName}</button><p>{row.memberNumber}</p><p className="text-muted-foreground">{row.programName}</p><p className="mt-2 text-xs">APP: {row.applicationNumber || "—"}<br/>DOI: {row.doi}<br/>Monthly: {money(row.basePay)}<br/>Registration: {money(row.registrationFee)}</p></td>
            {row.periods.map((period) => <td key={period.month} className="min-w-80 max-w-96 border-l p-4">
              {period.error ? <p className="text-red-600">Needs review: {period.error}</p> : !period.state ? <p className="text-muted-foreground">Not enrolled yet</p> : <>
                <div className="flex justify-between gap-4"><span className="rounded bg-muted px-2 py-1 font-semibold">{period.state.status}</span><strong>{money(period.collected)}</strong></div>
                {period.state.temporarilySuspended && <p className="mt-2 text-xs text-amber-700">Temporarily suspended · Waiver required</p>}
                <div className="my-3 space-y-2">{period.receipts.length ? period.receipts.map((p) => <div key={p.id} className="text-xs"><strong>OR {p.orNumber}</strong> · {p.orDate}<br/>{money(p.amount)} · For {p.monthFrom} – {p.monthTo}<br/>NOP {p.nopFrom} – {p.nopTo} · Remitted {p.dateRemitted || "—"}</div>) : <p className="text-xs text-muted-foreground">No payment received this month.</p>}</div>
                <div className="grid grid-cols-2 gap-2 border-t pt-2 text-xs"><span>Month covered: {money(period.coveredAmount)}</span><span>NOP: {period.state.nop}</span><span>TMD: {money(period.state.tmd)}</span><strong>Balance: {period.state.balance === null ? "—" : money(period.state.balance)}</strong></div>
              </>}
            </td>)}
          </tr>)}</tbody>
          <tfoot><tr className="bg-muted/30 font-semibold"><td className="sticky left-0 bg-background p-4">MAS totals</td>{report?.months.map((month, i) => <td key={month} className="border-l p-4 text-xs">Collected: {money(group.reduce((sum, row) => sum + row.periods[i].collected, 0))}<br/>Quota: {money(group.reduce((sum, row) => sum + (row.periods[i].state?.balance ?? 0), 0))}</td>)}</tr></tfoot>
        </table>
      </div>
    </section>)}
    {!busy && !rows.length && <p className="rounded border p-8 text-center">No accounts match these filters.</p>}
    {selected && <div className="fixed inset-0 z-50 bg-black/30 print:hidden" onClick={() => setSelected(null)}><aside role="dialog" aria-modal="true" aria-label="Account details" className="ml-auto h-full w-full max-w-md overflow-y-auto bg-background p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Account details</h2><Button autoFocus variant="ghost" onClick={() => setSelected(null)}>Close</Button></div>
      <h3 className="mt-6 font-semibold">{selected.memberName}</h3><p>{selected.memberNumber} · {selected.programName}</p><p className="text-sm">MAS: {selected.mas}<br/>DOI: {selected.doi}<br/>Monthly: {money(selected.basePay)}</p>
      <h3 className="mb-3 mt-6 font-semibold">Payment history</h3>{selected.history.length ? selected.history.map((p) => <div key={p.id} className="mb-3 rounded border p-3 text-sm"><strong>{p.orDate} · {money(p.amount)}</strong><p>OR {p.orNumber}<br/>Covers {p.monthFrom} – {p.monthTo}<br/>NOP {p.nopFrom} – {p.nopTo}<br/>Remitted {p.dateRemitted || "—"}</p></div>) : <p>No collection payments recorded.</p>}
    </aside></div>}
  </section>;
}
