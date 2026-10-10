"use client";

import { Download, Printer, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { MetricTile } from "@/components/metric-tile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { parseJsonResponse } from "@/lib/api-response";
import type { ReportLine, ReportSummary } from "@/lib/reports";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type Report = {
  from: string; to: string; generatedAt: string; summary: ReportSummary;
  options: { branches: string[]; programs: Array<{ id: string; name: string }>; people: string[]; encoders: string[] };
  sales: ReportLine[]; collections: ReportLine[]; byDay: ReportLine[]; byBranch: ReportLine[]; byProgram: ReportLine[]; notes: string[];
};
type Period = "today" | "week" | "month" | "year" | "custom";
type View = "branch" | "program" | "person" | "day" | "clerk";
type Row = { label: string; detail?: string; salesCount: number; salesGross: number; collectionCount: number; collectionGross: number; incentives: number; fidelity: number; penalty: number; net: number };

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const round = (value: number) => Math.round(value * 100) / 100;
const todayInManila = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
function rangeFor(period: Period, today: string): [string, string] {
  if (period === "week") { const start = shift(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)); return [start, shift(start, 6)]; }
  if (period === "month") return [`${today.slice(0, 7)}-01`, new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10)];
  if (period === "year") return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
  return [today, today];
}
const VIEWS: Array<{ id: View; label: string }> = [
  { id: "branch", label: "By branch" }, { id: "program", label: "By program" }, { id: "person", label: "By MAS / Collector" }, { id: "day", label: "By day" }, { id: "clerk", label: "By Entry Clerk" },
];

/** New Sales and Collections lines grouped by `key`, with each kind's count and gross apart. */
function group(sales: ReportLine[], collections: ReportLine[], key: (line: ReportLine) => string, detail?: (line: ReportLine) => string): Row[] {
  const rows = new Map<string, Row>();
  const add = (line: ReportLine, kind: "sales" | "collections") => {
    const label = key(line) || "Unassigned";
    const row = rows.get(label) ?? { label, detail: detail?.(line), salesCount: 0, salesGross: 0, collectionCount: 0, collectionGross: 0, incentives: 0, fidelity: 0, penalty: 0, net: 0 };
    if (kind === "sales") { row.salesCount += line.accounts; row.salesGross += line.gross; } else { row.collectionCount += line.accounts; row.collectionGross += line.gross; }
    row.incentives += line.incentives; row.fidelity += line.fidelity; row.penalty += line.penalty; row.net += line.net;
    rows.set(label, row);
  };
  for (const line of sales) add(line, "sales");
  for (const line of collections) add(line, "collections");
  return [...rows.values()].map((row) => ({ ...row, salesGross: round(row.salesGross), collectionGross: round(row.collectionGross), incentives: round(row.incentives), fidelity: round(row.fidelity), penalty: round(row.penalty), net: round(row.net) }));
}
const csvCell = (value: string | number) => { const text = String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };

/**
 * The company's own report for administrators (owner, October 10, 2026): every branch's New Sales and Collections for
 * a period (from /api/reports, lib/reports.ts), with the cash picture (company share, expenses, approved remittances,
 * bank deposits) and breakdowns by branch, program, MAS/Collector, day and Entry Clerk. Entry Clerks' own reports are
 * reviewed in Report Review, so this page no longer repeats them for administrators.
 */
export function CompanyReports() {
  const [period, setPeriod] = useState<Period>("month");
  const [[from, to], setRange] = useState<[string, string]>(() => rangeFor("month", todayInManila()));
  const [branch, setBranch] = useState("");
  const [program, setProgram] = useState("");
  const [person, setPerson] = useState("");
  const [view, setView] = useState<View>("branch");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ from, to, ...(branch ? { branch } : {}), ...(program ? { program } : {}), ...(person ? { person } : {}) });
      const response = await fetch(`/api/reports?${params}`, { cache: "no-store" });
      const result = await parseJsonResponse<{ success: boolean; message?: string; report: Report }>(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load the report.");
      setReport(result.report);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load the report."); }
    finally { setLoading(false); }
  }, [from, to, branch, program, person]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the chosen period and filters
    void load();
  }, [load]);
  useLiveRefresh(["sales", "collections", "remittances", "expenses", "cash_transactions"], load, 15000);

  const choose = (next: Period) => { setPeriod(next); if (next !== "custom") setRange(rangeFor(next, todayInManila())); };
  const rows = useMemo(() => {
    if (!report) return [];
    const by: Record<View, [(line: ReportLine) => string, ((line: ReportLine) => string)?]> = {
      branch: [(line) => line.branch], program: [(line) => line.programName || line.programId], person: [(line) => line.person, (line) => line.role], day: [(line) => line.date], clerk: [(line) => line.encodedBy || "Imported (no encoder)"],
    };
    const [key, detail] = by[view];
    const list = group(report.sales, report.collections, key, detail);
    return view === "day" ? list.sort((a, b) => a.label.localeCompare(b.label)) : list.sort((a, b) => (b.salesGross + b.collectionGross) - (a.salesGross + a.collectionGross));
  }, [report, view]);
  const totals = useMemo(() => group(report?.sales ?? [], report?.collections ?? [], () => "Total")[0], [report]);
  const summary = report?.summary;
  const viewLabel = VIEWS.find((item) => item.id === view)?.label ?? "";
  const headers = [viewLabel.replace(/^By /, ""), "New Sales", "New Sales gross", "Collections", "Collections gross", "Incentives", "Fidelity", "Penalty", "Company share"];

  const exportCsv = () => {
    const lines = [headers, ...rows.map((row) => [row.detail ? `${row.label} (${row.detail})` : row.label, row.salesCount, row.salesGross, row.collectionCount, row.collectionGross, row.incentives, row.fidelity, row.penalty, row.net])];
    if (totals) lines.push(["Total", totals.salesCount, totals.salesGross, totals.collectionCount, totals.collectionGross, totals.incentives, totals.fidelity, totals.penalty, totals.net]);
    const blob = new Blob([`﻿${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = `company-report-${view}-${from}-to-${to}.csv`; link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="space-y-6">
      <Card className="print:hidden">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-1 rounded-lg border p-1" role="group" aria-label="Period">
              {([["today", "Today"], ["week", "This week"], ["month", "This month"], ["year", "This year"], ["custom", "Choose dates"]] as const).map(([value, label]) => (
                <Button key={value} type="button" size="sm" variant={period === value ? "default" : "ghost"} onClick={() => choose(value)}>{label}</Button>
              ))}
            </div>
            {period === "custom" && <>
              <div className="space-y-1"><Label htmlFor="report-from">From</Label><Input id="report-from" type="date" value={from} max={to} onChange={(event) => event.target.value && setRange([event.target.value, to])} /></div>
              <div className="space-y-1"><Label htmlFor="report-to">To</Label><Input id="report-to" type="date" value={to} min={from} onChange={(event) => event.target.value && setRange([from, event.target.value])} /></div>
            </>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label>Branch</Label><SearchSelect aria-label="Branch" className="h-9" clearable placeholder="All branches" value={branch} onValueChange={setBranch} options={(report?.options.branches ?? []).map((item) => ({ value: item, label: item }))} /></div>
            <div className="space-y-1"><Label>Program</Label><SearchSelect aria-label="Program" className="h-9" clearable placeholder="All programs" value={program} onValueChange={setProgram} options={(report?.options.programs ?? []).map((item) => ({ value: item.id, label: item.name, description: item.id }))} /></div>
            <div className="space-y-1"><Label>MAS / Collector</Label><SearchSelect aria-label="MAS or Collector" className="h-9" clearable placeholder="Everyone" value={person} onValueChange={setPerson} options={(report?.options.people ?? []).map((item) => ({ value: item, label: item }))} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
            <Button type="button" variant="outline" size="sm" disabled={!rows.length} onClick={exportCsv}><Download className="size-4" />Export CSV</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-4" />Print</Button>
          </div>
        </CardContent>
      </Card>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <p className="text-sm text-muted-foreground">{from === to ? from : `${from} to ${to}`}{branch ? ` · ${branch}` : " · all branches"}{program ? ` · ${report?.options.programs.find((item) => item.id === program)?.name ?? program}` : ""}{person ? ` · ${person}` : ""}. New Sales by the date saved, Collections by OR date.</p>

      {summary && totals && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricTile tone="brand" label="Gross" value={money(summary.gross)} detail={`${summary.accounts} entries`} />
          <MetricTile tone="info" label="New Sales" value={money(totals.salesGross)} detail={`${totals.salesCount} sales`} />
          <MetricTile tone="teal" label="Collections" value={money(totals.collectionGross)} detail={`${totals.collectionCount} payments`} />
          <MetricTile tone="warning" label="Incentives" value={money(summary.incentives)} detail={`MAS ${money(summary.masCommission)} · Collector ${money(summary.collectorCommission)}`} />
        </div>
        <Card><CardHeader><CardTitle>Cash</CardTitle></CardHeader><CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Company share (gross less incentives)", summary.net], ["Fidelity", summary.fidelity], ["Penalties", summary.penalty],
              ["Posted expenses", summary.expenses], ["Expected remittance (share less expenses)", summary.expectedRemittance], ["Approved remittances", summary.actualRemittance],
              ["Bank deposits", summary.deposits], ["Difference (expected less approved)", summary.difference],
            ] as Array<[string, number]>).map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b py-1"><dt className="text-muted-foreground">{label}</dt><dd className={`font-medium tabular-nums ${label.startsWith("Difference") && value !== 0 ? "text-red-700" : ""}`}>{money(value)}</dd></div>)}
          </dl>
        </CardContent></Card>
      </>}

      <Card>
        <CardHeader className="gap-3">
          <CardTitle>Breakdown</CardTitle>
          <div className="flex flex-wrap gap-1 print:hidden" role="tablist">{VIEWS.map((item) => <Button key={item.id} type="button" role="tab" aria-selected={view === item.id} size="sm" variant={view === item.id ? "default" : "outline"} onClick={() => setView(item.id)}>{item.label}</Button>)}</div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/50 text-left"><tr>{headers.map((header, index) => <th key={header} scope="col" className={`p-2 ${index ? "text-right" : ""}`}>{header}</th>)}</tr></thead>
              <tbody>
                {rows.map((row) => <tr key={row.label} className="border-t">
                  <td className="p-2">{row.label}{row.detail && <span className="block text-xs text-muted-foreground">{row.detail}</span>}</td>
                  {[row.salesCount, money(row.salesGross), row.collectionCount, money(row.collectionGross), money(row.incentives), money(row.fidelity), money(row.penalty), money(row.net)].map((value, index) => <td key={index} className="p-2 text-right tabular-nums">{value}</td>)}
                </tr>)}
                {!rows.length && <tr><td colSpan={headers.length} className="p-8 text-center text-muted-foreground">{loading ? "Loading..." : "Nothing in this period."}</td></tr>}
              </tbody>
              {totals && rows.length > 1 && <tfoot className="border-t bg-muted/30 font-medium"><tr><td className="p-2">Total</td>{[totals.salesCount, money(totals.salesGross), totals.collectionCount, money(totals.collectionGross), money(totals.incentives), money(totals.fidelity), money(totals.penalty), money(totals.net)].map((value, index) => <td key={index} className="p-2 text-right tabular-nums">{value}</td>)}</tr></tfoot>}
            </table>
          </div>
          {report?.notes.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{report.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
        </CardContent>
      </Card>
    </div>
  );
}
