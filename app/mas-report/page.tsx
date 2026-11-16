"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck, Download, Printer, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate as showDate } from "@/lib/date-format";
import { masReportWeeks, type MasLine, type MasRow } from "@/lib/mas-report-rows";

type Report = { branch: string; from: string; to: string; officers: string[]; rows: MasRow[]; total: { sales: MasLine; collections: MasLine }; entryCount: number };
type Result = { success: boolean; message?: string; branches: string[]; officer: string; company: { name: string; address: string }; report: Report | null };

const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const lastDayOf = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]}-${month.slice(2, 4)}`;
// Whole pesos as on the paper report; centavos only when there are any.
const amount = (value: number) => value ? value.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "";
const count = (value: number) => value ? String(value) : "";
const PERIODS = [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["custom", "Chosen dates"]] as const;
type Period = (typeof PERIODS)[number][0];
/** What the report's heading says about the period it shows. */
type Shown = { period: Period; month: string; week: number };
/** The week of the month holding this day (masReportWeeks). */
const weekOfDay = (day: string) => masReportWeeks(day.slice(0, 7)).find((item) => item.from <= day && day <= item.to)?.week ?? 1;
const shortDate = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8))}`;

/**
 * MAS Report (owner, November 16, 2026): the paper "Monthly report format for officers and team heads" for a branch's
 * MAS-Officer: each MAS's New Sales and Collections (Accts, Gross, Inc., Net) for a month or chosen dates, with the
 * totals, printable and as CSV. lib/mas-report.ts, /api/mas-report.
 * Daily and Weekly too (owner, November 16, 2026): a day, a week of a month (Monday to Sunday, masReportWeeks), a month,
 * or chosen dates.
 */
export default function MasReportPage() {
  const [period, setPeriod] = useState<Period>("monthly");
  const [day, setDay] = useState(() => manilaToday());
  const [week, setWeek] = useState(() => weekOfDay(manilaToday()));
  const [shown, setShown] = useState<Shown>(() => ({ period: "monthly", month: manilaToday().slice(0, 7), week: 0 }));
  const [month, setMonth] = useState(() => manilaToday().slice(0, 7));
  const [from, setFrom] = useState(() => `${manilaToday().slice(0, 7)}-01`);
  const [to, setTo] = useState(() => lastDayOf(manilaToday().slice(0, 7)));
  const [branch, setBranch] = useState("");
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(next: { from?: string; to?: string; branch?: string; shown?: Shown } = {}) {
    const query = { from: next.from ?? from, to: next.to ?? to, branch: next.branch ?? branch };
    // A branch change or Refresh keeps the heading of the period on screen.
    const shownNext = next.shown ?? shown;
    if (!query.from || !query.to || query.from > query.to) { setError("Choose a valid date range."); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/mas-report?${new URLSearchParams(query)}`, { cache: "no-store" });
      const result = await response.json() as Result;
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load the MAS Report.");
      setData(result);
      setShown(shownNext);
      if (result.report) setBranch(result.report.branch);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to load the MAS Report."); }
    finally { setLoading(false); }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load; loading state is already set
  useEffect(() => { void load(); }, []);

  // Each choice sets From and To and loads at once; Chosen dates waits for Show report.
  const show = (range: { from: string; to: string }, heading: Shown) => { setFrom(range.from); setTo(range.to); void load({ ...range, shown: heading }); };
  const chooseDay = (value: string) => { if (!value) return; setDay(value); show({ from: value, to: value }, { period: "daily", month: value.slice(0, 7), week: 0 }); };
  const chooseWeek = (inMonth: string, number: number) => {
    const weeks = masReportWeeks(inMonth);
    const chosen = weeks.find((item) => item.week === number) ?? weeks[weeks.length - 1];
    setMonth(inMonth); setWeek(chosen.week);
    show({ from: chosen.from, to: chosen.to }, { period: "weekly", month: inMonth, week: chosen.week });
  };
  const chooseMonth = (value: string, as: Period = period) => {
    if (!value) return;
    setMonth(value);
    if (as === "weekly") { chooseWeek(value, week); return; }
    show({ from: `${value}-01`, to: lastDayOf(value) }, { period: "monthly", month: value, week: 0 });
  };
  const choosePeriod = (value: Period) => {
    setPeriod(value);
    if (value === "daily") chooseDay(day);
    else if (value === "weekly") chooseWeek(month, month === manilaToday().slice(0, 7) ? weekOfDay(manilaToday()) : week);
    else if (value === "monthly") chooseMonth(month, "monthly");
  };
  const report = data?.report ?? null;
  const officerName = report?.officers.length ? report.officers.join(", ") : data?.officer ?? "";
  const title = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", custom: "" }[shown.period];
  const heading = `${title ? `${title} report` : "Report"} format for officers and team heads`;
  // The paper's "WK No. / Month": the week and month for a weekly, the month for a monthly or a day.
  const monthCell = shown.period === "custom" ? "" : `${shown.period === "weekly" ? `Week ${shown.week} / ` : ""}${monthLabel(shown.month)}`;
  const periodText = report ? (report.from === report.to ? showDate(report.from) : report.from.slice(5, 7) === report.to.slice(5, 7) && report.from.slice(0, 4) === report.to.slice(0, 4)
    ? `${Number(report.from.slice(5, 7))}/${Number(report.from.slice(8))}-${Number(report.to.slice(8))}/${report.from.slice(0, 4)}`
    : `${showDate(report.from)} – ${showDate(report.to)}`) : "";

  function downloadCsv() {
    if (!report) return;
    const line = (value: MasLine) => [value.accounts, value.gross, value.incentives, value.net];
    const rows: Array<Array<string | number>> = [
      [data?.company.name ?? ""], [heading],
      [shown.period === "weekly" ? "Wk No. / Month" : "Month", monthCell, "Date", periodText], ["Branch", report.branch, "Officer's name", officerName], [],
      ["No.", "Marketing Accnt. Staff", "New Sales Accts", "New Sales Gross", "New Sales Inc.", "New Sales Net", "Collection Accts", "Collection Gross", "Collection Inc.", "Collection Net"],
      ...report.rows.map((row, index) => [index + 1, row.name, ...line(row.sales), ...line(row.collections)]),
      ["", "TOTAL", ...line(report.total.sales), ...line(report.total.collections)],
    ];
    const text = rows.map((row) => row.map((cell) => { const value = String(cell); return /[",\n]/.test(value) ? `"${value.replaceAll("\"", "\"\"")}"` : value; }).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" }));
    link.download = `mas-report-${shown.period}-${report.branch}-${report.from}-to-${report.to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const head = "border border-foreground/70 px-2 py-1.5 text-center font-bold";
  const cell = "border border-foreground/40 px-2 py-1.5 text-center tabular-nums";
  return <section className="mx-auto max-w-7xl space-y-5">
    <header className="rounded-2xl page-hero p-5 print:hidden">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-violet-95 p-3 text-violet-40"><ClipboardCheck className="size-6" /></div><div><h1 className="text-2xl font-bold">MAS Report</h1><p className="text-sm text-violet-30/80">What each MAS of your branch sold and collected: accounts, gross, incentives and net, by the date encoded.</p></div></div>
    </header>

    <Card className="print:hidden"><CardContent className="space-y-4 p-4">
      <div role="group" aria-label="Period" className="grid grid-cols-2 gap-1 rounded-lg border bg-muted p-1 sm:inline-grid sm:grid-cols-4">
        {PERIODS.map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} onClick={() => choosePeriod(value)}
          className={`min-h-9 rounded-md px-4 text-sm font-medium ${period === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{label}</button>)}
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
        {period === "daily" && <div className="space-y-2"><Label htmlFor="mas-report-day">Date</Label><Input id="mas-report-day" type="date" max={manilaToday()} value={day} onChange={(event) => chooseDay(event.target.value)} /></div>}
        {(period === "weekly" || period === "monthly") && <div className="space-y-2"><Label htmlFor="mas-report-month">Month</Label><Input id="mas-report-month" type="month" value={month} onChange={(event) => chooseMonth(event.target.value)} /></div>}
        {period === "weekly" && <div className="space-y-2"><Label htmlFor="mas-report-week">Week</Label>
          <select id="mas-report-week" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={week} onChange={(event) => chooseWeek(month, Number(event.target.value))}>
            {masReportWeeks(month).map((item) => <option key={item.week} value={item.week}>Week {item.week} · {item.from === item.to ? shortDate(item.from) : `${shortDate(item.from)}–${Number(item.to.slice(8))}`}</option>)}
          </select>
        </div>}
        {period === "custom" && <>
          <div className="space-y-2"><Label htmlFor="mas-report-from">From</Label><Input id="mas-report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="mas-report-to">To</Label><Input id="mas-report-to" type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} /></div>
        </>}
        <div className="space-y-2"><Label htmlFor="mas-report-branch">Branch</Label>
          <select id="mas-report-branch" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={branch} disabled={!data?.branches.length} onChange={(event) => { setBranch(event.target.value); void load({ branch: event.target.value }); }}>
            {(data?.branches ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <Button type="button" disabled={loading || !from || !to || from > to} onClick={() => void load(period === "custom" ? { shown: { period: "custom", month, week: 0 } } : {})}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />{loading ? "Loading..." : period === "custom" ? "Show report" : "Refresh"}</Button>
      </div>
    </CardContent></Card>

    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
    {data && !report && data.message && <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">{data.message}</p>}

    {report && <Card><CardContent className="space-y-4 p-4 sm:p-6 print:p-0">
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        <Button type="button" variant="outline" onClick={downloadCsv}><Download className="size-4" />CSV</Button>
        <Button type="button" variant="outline" onClick={() => window.print()}><Printer className="size-4" />Print</Button>
      </div>
      <div className="text-center">
        <p className="text-xl font-black tracking-tight sm:text-2xl">{data?.company.name}</p>
        <p className="text-xs sm:text-sm">{data?.company.address}</p>
        <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{heading}</p>
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p><span className="font-bold">{shown.period === "weekly" ? "WK NO. / MONTH:" : "MONTH:"}</span> <span className="ml-2 border-b border-foreground/60 px-2">{monthCell || "—"}</span></p>
        <p><span className="font-bold">DATE:</span> <span className="ml-2 border-b border-foreground/60 px-2">{periodText}</span></p>
        <p><span className="font-bold">BRANCH:</span> <span className="ml-2 border-b border-foreground/60 px-2 uppercase">{report.branch}</span></p>
        <p><span className="font-bold">OFFICER&apos;S NAME:</span> <span className="ml-2 border-b border-foreground/60 px-2">{officerName}</span></p>
      </div>
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full min-w-[820px] border-collapse text-sm print:min-w-0 print:text-xs">
          <thead>
            <tr>
              <th rowSpan={2} className={`${head} w-12`}>NO.</th>
              <th rowSpan={2} className={head}>MARKETING<br />ACCNT. STAFF</th>
              <th colSpan={4} className={`${head} bg-sky-50 dark:bg-sky-950/40`}>NEW SALES DATA</th>
              <th colSpan={4} className={`${head} bg-amber-50 dark:bg-amber-950/40`}>COLLECTION DATA</th>
            </tr>
            <tr>{["Accts", "Gross", "Inc.", "Net", "Accts", "Gross", "Inc.", "Net"].map((label, index) => <th key={index} className={head}>{label}</th>)}</tr>
          </thead>
          <tbody>
            {report.rows.map((row, index) => <tr key={`${row.name}-${index}`}>
              <td className={cell}>{index + 1}</td>
              <td className={`${cell} text-left font-medium uppercase`}>{row.name}{!row.assigned && <span className="ml-1 text-xs font-normal normal-case text-muted-foreground">(not assigned here)</span>}</td>
              <td className={cell}>{count(row.sales.accounts)}</td><td className={cell}>{amount(row.sales.gross)}</td><td className={cell}>{amount(row.sales.incentives)}</td><td className={cell}>{amount(row.sales.net)}</td>
              <td className={cell}>{count(row.collections.accounts)}</td><td className={cell}>{amount(row.collections.gross)}</td><td className={cell}>{amount(row.collections.incentives)}</td><td className={cell}>{amount(row.collections.net)}</td>
            </tr>)}
            {!report.rows.length && <tr><td colSpan={10} className="border p-8 text-center text-muted-foreground">No MAS is assigned to this branch and nothing was encoded for it in this period.</td></tr>}
          </tbody>
          <tfoot className="font-bold text-red-800 dark:text-red-300">
            <tr>
              <td className={cell} /><td className={`${cell} text-left`}>TOTAL</td>
              <td className={cell}>{report.total.sales.accounts}</td><td className={cell}>{amount(report.total.sales.gross) || "0"}</td><td className={cell}>{amount(report.total.sales.incentives) || "0"}</td><td className={cell}>{amount(report.total.sales.net) || "0"}</td>
              <td className={cell}>{report.total.collections.accounts}</td><td className={cell}>{amount(report.total.collections.gross) || "0"}</td><td className={cell}>{amount(report.total.collections.incentives) || "0"}</td><td className={cell}>{amount(report.total.collections.net) || "0"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground print:hidden">New Sales and Collections encoded for {report.branch} from {showDate(report.from)} to {showDate(report.to)} ({report.entryCount} entries). Net = Gross less Inc. (the MAS&apos;s incentive). Collections count for the person accountable for the cash (the MAS, their Collector, or DTO), as in the clerk&apos;s report. Every MAS assigned to the branch is listed, even with nothing encoded.</p>
    </CardContent></Card>}
  </section>;
}
