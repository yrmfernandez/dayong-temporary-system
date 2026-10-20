"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Printer, Search, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import type { GridCell, GridTone, SheetDay, SheetEmployee, SheetSummary } from "@/lib/attendance-sheet";
import { readPreference, writePreference } from "@/lib/ui-preferences";

type AllRow = { employee: SheetEmployee; summary: SheetSummary; cells: GridCell[]; rate: string };
type AllResult = { success: boolean; message?: string; employees: SheetEmployee[]; rows: AllRow[]; showRates: boolean; totals: SheetSummary };
type OneResult = { success: boolean; message?: string; employees: SheetEmployee[]; employee: SheetEmployee; days: SheetDay[]; summary: SheetSummary };

const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const lastDayOf = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const previousMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);

/** Payroll cut-offs and months, from today's month. */
function presets() {
  const month = manilaToday().slice(0, 7), last = previousMonth(month);
  return [
    { label: "This month", from: `${month}-01`, to: lastDayOf(month) },
    { label: "1–15", from: `${month}-01`, to: `${month}-15` },
    { label: "16–end", from: `${month}-16`, to: lastDayOf(month) },
    { label: "Last month", from: `${last}-01`, to: lastDayOf(last) },
    { label: "Last 16–end", from: `${last}-16`, to: lastDayOf(last) },
  ];
}

const minutes = (value: number) => value >= 60 ? `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m` : `${value} min`;
const hours = (value: number) => value.toFixed(2);
const rate = (value: number | null) => value === null ? "—" : `${value}%`;
const longDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-PH", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

const statusTone: Record<string, string> = {
  Present: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  Late: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  Absent: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  "Absent (system)": "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  AWOL: "bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-200",
  Leave: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  "Day Off": "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  "No record": "bg-amber-50 text-amber-800 ring-1 ring-amber-300 dark:bg-amber-950/40 dark:text-amber-300",
};

function downloadCsv(name: string, rows: Array<Array<string | number>>) {
  const text = rows.map((row) => row.map((cell) => { const value = String(cell); return /[",\n]/.test(value) ? `"${value.replaceAll("\"", "\"\"")}"` : value; }).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

const summaryHeadings = ["Working days", "Present", "Days payable", "Late days", "Late", "Undertime", "Overtime hrs", "Regular hrs", "Total hrs", "Approved leave", "Other leave", "Day off", "Not required", "Absent", "AWOL", "No record", "No time-out", "Attendance"];
const summaryCells = (summary: SheetSummary) => [summary.scheduledDays, summary.present, summary.daysPayable, summary.lateDays, summary.lateMinutes, summary.undertimeMinutes, hours(summary.overtimeHours), hours(summary.regularHours), hours(summary.totalHours), summary.approvedLeave, summary.otherLeave, summary.dayOff, summary.notRequired, summary.absent, summary.awol, summary.noRecord, summary.missingTimeOut, rate(summary.attendanceRate)];

const NO_BRANCH = "No primary branch";
// The people chosen to show (owner, October 20, 2026), kept in this browser; none chosen = everyone.
const PEOPLE_KEY = "dayong-attendance-sheet-people";
const readPeople = () => { try { const saved: unknown = JSON.parse(readPreference(PEOPLE_KEY, "[]")); return Array.isArray(saved) ? saved.map(String) : []; } catch { return []; } };

/**
 * Attendance sheet (owner, October 14, 2026): for Finance to check attendance before paying salaries. All employees'
 * totals for a date range, and each employee's day-by-day sheet (every day, including days with no record), with
 * print and CSV. lib/attendance-sheet.ts, /api/attendance-sheet.
 */
export function AttendanceSheet() {
  const initial = presets()[0];
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [employeeId, setEmployeeId] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [search, setSearch] = useState("");
  // Role and branch filters (owner, October 17, 2026); branch is the employee's primary branch.
  const [role, setRole] = useState("");
  const [branch, setBranch] = useState("");
  const [view, setView] = useState<"sheet" | "summary">("sheet");
  const [people, setPeople] = useState<string[]>([]);
  const [choosingPeople, setChoosingPeople] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved choice is read after mount (no storage on the server)
  useEffect(() => { setPeople(readPeople()); }, []);
  const choosePeople = (ids: string[]) => { setPeople(ids); writePreference(PEOPLE_KEY, JSON.stringify(ids)); };
  const [all, setAll] = useState<AllResult | null>(null);
  const [one, setOne] = useState<OneResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(next: { from?: string; to?: string; employeeId?: string } = {}) {
    const range = { from: next.from ?? from, to: next.to ?? to, employeeId: next.employeeId ?? employeeId };
    if (!range.from || !range.to || range.from > range.to) { setError("Choose a valid date range."); return; }
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ from: range.from, to: range.to, ...(range.employeeId ? { employeeId: range.employeeId } : {}), ...(includeInactive ? { inactive: "1" } : {}) });
      const response = await fetch(`/api/attendance-sheet?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load the attendance sheet.");
      if (range.employeeId) setOne(result as OneResult); else { setAll(result as AllResult); setOne(null); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to load the attendance sheet."); }
    finally { setLoading(false); }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load; loading state is already set
  useEffect(() => { void load(); }, []);

  const employees = one?.employees ?? all?.employees ?? [];
  const openEmployee = (id: string) => { setEmployeeId(id); void load({ employeeId: id }); };
  const backToAll = () => { setEmployeeId(""); setOne(null); if (!all) void load({ employeeId: "" }); };
  const choosePreset = (preset: { from: string; to: string }) => { setFrom(preset.from); setTo(preset.to); void load(preset); };

  const shownRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const chosen = new Set(people);
    return (all?.rows ?? []).filter((row) => (!chosen.size || chosen.has(row.employee.id)) && (!role || row.employee.roles.includes(role)) && (!branch || (row.employee.branch || NO_BRANCH) === branch)
      && (!needle || `${row.employee.name} ${row.employee.id} ${row.employee.branch} ${row.employee.roles.join(" ")}`.toLowerCase().includes(needle)));
  }, [all, search, role, branch, people]);
  const roleOptions = useMemo(() => [...new Set((all?.rows ?? []).flatMap((row) => row.employee.roles))].sort((a, b) => a.localeCompare(b)), [all]);
  const branchOptions = useMemo(() => [...new Set((all?.rows ?? []).map((row) => row.employee.branch || NO_BRANCH))].sort((a, b) => a.localeCompare(b)), [all]);
  // Chosen people no longer in the list (left, or outside the range) do not count.
  const chosenShown = (all?.rows ?? []).filter((row) => people.includes(row.employee.id)).length;
  const filtered = Boolean(search.trim() || role || branch || people.length);

  const period = `${longDate(from)} – ${longDate(to)}`;
  const showingOne = Boolean(employeeId && one);

  return <div className="space-y-5">
    <Card className="print:hidden"><CardContent className="space-y-4 p-4">
      <div className="flex flex-wrap gap-2">{presets().map((preset) => <Button key={preset.label} type="button" size="sm" variant={from === preset.from && to === preset.to ? "default" : "outline"} onClick={() => choosePreset(preset)}>{preset.label}</Button>)}</div>
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end">
        <div className="space-y-2"><Label htmlFor="sheet-from">From</Label><Input id="sheet-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="sheet-to">To</Label><Input id="sheet-to" type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} /></div>
        <div className="space-y-2"><Label>Employee</Label><SearchSelect aria-label="Employee" clearable value={employeeId} placeholder="All employees - search ID or name" options={employees.map((employee) => ({ value: employee.id, label: employee.name, description: `${employee.id}${employee.branch ? ` · ${employee.branch}` : ""}${employee.status !== "active" ? ` · ${employee.status}` : ""}` }))} onValueChange={(value) => { setEmployeeId(value); if (!value) setOne(null); }} /></div>
        <Button type="button" disabled={loading || !from || !to || from > to} onClick={() => void load()}>{loading ? "Loading..." : "Show sheet"}</Button>
      </div>
      {!employeeId && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} />Include inactive and resigned employees without attendance in the period</label>}
    </CardContent></Card>

    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

    {showingOne && one ? <EmployeeSheet result={one} period={period} from={from} to={to} onBack={backToAll} />
      : all && <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div><CardTitle>{view === "sheet" ? "Attendance sheet" : "Attendance summary"} · {period}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{filtered ? `${shownRows.length} of ${all.rows.length}` : all.rows.length} employees{role ? ` · ${role}` : ""}{branch ? ` · ${branch}` : ""}. Click an employee for the day-by-day sheet. {view === "sheet" ? "Total days" : "Days payable"} = present + approved leave, as payroll counts them.</p></div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <div className="flex rounded-md border p-0.5">{(["sheet", "summary"] as const).map((option) => <Button key={option} type="button" size="sm" variant={view === option ? "default" : "ghost"} onClick={() => setView(option)}>{option === "sheet" ? "Sheet" : "Summary"}</Button>)}</div>
            <Button type="button" variant={people.length ? "default" : "outline"} aria-expanded={choosingPeople} onClick={() => setChoosingPeople((open) => !open)}><Users className="size-4" />{people.length ? `${chosenShown} chosen` : "Choose people"}</Button>
            <select aria-label="Filter by role" className="h-9 rounded-md border bg-background px-2 text-sm" value={role} onChange={(event) => setRole(event.target.value)}><option value="">All roles</option>{roleOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select>
            <select aria-label="Filter by branch" className="h-9 rounded-md border bg-background px-2 text-sm" value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">All branches</option>{branchOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select>
            <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Search employees" className="w-56 pl-8" placeholder="Search name, ID, branch" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <Button type="button" variant="outline" onClick={() => view === "sheet"
              ? downloadCsv(`attendance-sheet-${from}-to-${to}.csv`, [["Employee ID", "Employee Name", ...sheetDates(from, to).map((day) => `${day.weekday} ${Number(day.date.slice(8))}`), "Total Days", ...(all.showRates ? ["Rate"] : [])], ...shownRows.map((row) => [row.employee.id, row.employee.name, ...row.cells.map((cell) => cell.code), row.summary.daysPayable, ...(all.showRates ? [row.rate] : [])])])
              : downloadCsv(`attendance-summary-${from}-to-${to}.csv`, [["Employee ID", "Employee", "Branch", "Roles", "Status", ...summaryHeadings], ...shownRows.map((row) => [row.employee.id, row.employee.name, row.employee.branch, row.employee.roles.join("; "), row.employee.status, ...summaryCells(row.summary)])])}><Download className="size-4" />CSV</Button>
            <Button type="button" variant="outline" onClick={() => window.print()}><Printer className="size-4" />Print</Button>
          </div>
        </CardHeader>
        <CardContent>
          {choosingPeople && <PeoplePicker rows={all.rows} chosen={people} onChange={choosePeople} onClose={() => setChoosingPeople(false)} />}
          {view === "sheet" ? <AttendanceGrid rows={shownRows} from={from} to={to} showRates={all.showRates} onOpen={openEmployee} /> : <>
          <div className="max-h-[70vh] overflow-auto rounded-lg border print:max-h-none print:overflow-visible">
            <table className="w-full min-w-[1400px] text-sm print:min-w-0 print:text-[10px]">
              <thead className="sticky top-0 z-10 bg-muted text-left"><tr>
                <th className="sticky left-0 bg-muted p-2">Employee</th>
                {["Working days", "Present", "Days payable", "Late", "Undertime", "Overtime", "Regular hrs", "Total hrs", "Leave", "Day off / not req.", "Absent", "AWOL", "No record", "No time-out", "Attendance"].map((heading) => <th key={heading} className="p-2 text-right">{heading}</th>)}
              </tr></thead>
              <tbody>
                {shownRows.map(({ employee, summary }) => <tr key={employee.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => openEmployee(employee.id)}>
                  <td className="sticky left-0 bg-background p-2"><span className="font-medium text-primary underline-offset-2 hover:underline">{employee.name}</span><span className="block text-xs text-muted-foreground">{employee.id}{employee.branch ? ` · ${employee.branch}` : ""}{employee.status !== "active" ? ` · ${employee.status}` : ""}</span></td>
                  <SummaryRow summary={summary} />
                </tr>)}
                {!shownRows.length && <tr><td colSpan={16} className="p-8 text-center text-muted-foreground">No employees match.</td></tr>}
              </tbody>
              {shownRows.length > 1 && !filtered && <tfoot className="border-t-2 bg-muted/50 font-semibold"><tr><td className="sticky left-0 bg-muted p-2">All employees</td><SummaryRow summary={all.totals} /></tr></tfoot>}
            </table>
          </div>
          </>}
          <Legend />
        </CardContent>
      </Card>}
  </div>;
}

/** Tick the people the sheet shows (owner, October 20, 2026); with none ticked it shows everyone. */
function PeoplePicker({ rows, chosen, onChange, onClose }: { rows: AllRow[]; chosen: string[]; onChange: (ids: string[]) => void; onClose: () => void }) {
  const [find, setFind] = useState("");
  const needle = find.trim().toLowerCase();
  const listed = rows.filter((row) => !needle || `${row.employee.name} ${row.employee.id} ${row.employee.branch} ${row.employee.roles.join(" ")}`.toLowerCase().includes(needle));
  const toggle = (id: string) => onChange(chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id]);
  return <div className="mb-4 space-y-3 rounded-lg border bg-muted/30 p-3 print:hidden">
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm font-medium">Show only these people</p>
      <span className="text-xs text-muted-foreground">{chosen.length ? `${chosen.length} ticked` : "None ticked: everyone is shown"}. Kept on this device.</span>
      <div className="ml-auto flex flex-wrap gap-2">
        <Input aria-label="Find people" className="h-8 w-52" placeholder="Find name, ID, branch, role" value={find} onChange={(event) => setFind(event.target.value)} />
        <Button type="button" size="sm" variant="outline" disabled={!listed.length} onClick={() => onChange([...new Set([...chosen, ...listed.map((row) => row.employee.id)])])}>Tick {needle ? "found" : "all"}</Button>
        <Button type="button" size="sm" variant="outline" disabled={!chosen.length} onClick={() => onChange([])}>Show everyone</Button>
        <Button type="button" size="sm" onClick={onClose}>Done</Button>
      </div>
    </div>
    <div className="grid max-h-64 gap-1 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
      {listed.map(({ employee }) => <label key={employee.id} className="flex items-start gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
        <input type="checkbox" className="mt-1" checked={chosen.includes(employee.id)} onChange={() => toggle(employee.id)} />
        <span><span className="font-medium">{employee.name}</span><span className="block text-xs text-muted-foreground">{employee.id}{employee.branch ? ` · ${employee.branch}` : ""}</span></span>
      </label>)}
      {!listed.length && <p className="p-2 text-sm text-muted-foreground">No one matches.</p>}
    </div>
  </div>;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Every date from `from` to `to` with its weekday, for the grid's columns. */
function sheetDates(from: string, to: string) {
  const dates: Array<{ date: string; weekday: string }> = [];
  for (let time = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); time <= end; time += 86400000) {
    dates.push({ date: new Date(time).toISOString().slice(0, 10), weekday: WEEKDAY_NAMES[new Date(time).getUTCDay()] });
  }
  return dates;
}

/** Cell colours of the paper attendance sheet: peach present, salmon leave and absent, yellow late and rest day, red Sundays. */
const gridTone: Record<GridTone, string> = {
  present: "bg-orange-100 text-orange-950 dark:bg-orange-950/70 dark:text-orange-100",
  late: "bg-amber-100 font-semibold text-red-600 dark:bg-amber-950/60 dark:text-red-400",
  leave: "bg-rose-300 text-rose-950 dark:bg-rose-900/70 dark:text-rose-100",
  absent: "bg-red-400 font-semibold text-red-950 dark:bg-red-900 dark:text-red-100",
  rest: "bg-yellow-200 text-yellow-950 dark:bg-yellow-900/60 dark:text-yellow-100",
  none: "text-muted-foreground",
  closed: "bg-red-600 dark:bg-red-800",
  blank: "",
};

const gridKey: Array<[string, string, GridTone]> = [["L", "Leave", "leave"], ["P", "Present", "present"], ["A", "Absent", "absent"], ["LA", "Late", "late"], ["RD", "Rest day", "rest"], ["NR", "Not required", "rest"], ["ND", "No record", "none"]];

/**
 * All employees in the paper attendance sheet's format (owner, October 15, 2026): the key, the month and year, one
 * column per date with its weekday (Sundays and non-working days in red), the time in for days worked (late in red),
 * the letter codes for the rest, the total days (present + approved leave) and, for Payroll users, the rate.
 */
function AttendanceGrid({ rows, from, to, showRates, onOpen }: { rows: AllRow[]; from: string; to: string; showRates: boolean; onOpen: (id: string) => void }) {
  const dates = sheetDates(from, to);
  const firstMonth = Number(from.slice(5, 7)) - 1, lastMonth = Number(to.slice(5, 7)) - 1;
  const months = from.slice(0, 7) === to.slice(0, 7) ? MONTHS[firstMonth] : `${MONTHS[firstMonth]} – ${MONTHS[lastMonth]}`;
  const years = from.slice(0, 4) === to.slice(0, 4) ? from.slice(0, 4) : `${from.slice(0, 4)} – ${to.slice(0, 4)}`;
  const heading = "p-2 text-base font-bold text-red-900 dark:text-red-300";
  return <div className="space-y-3">
    <style>{"@media print { @page { size: landscape; } }"}</style>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <span className="font-semibold">Key</span>
      {gridKey.map(([code, label, tone]) => <span key={code} className="flex items-center gap-1.5"><span className={`inline-flex min-w-8 justify-center rounded px-1.5 py-0.5 font-semibold ${gridTone[tone]} ${tone === "none" ? "ring-1 ring-border" : ""}`}>{code}</span>{label.toUpperCase()}</span>)}
    </div>
    <div className="max-h-[70vh] overflow-auto rounded-lg border print:max-h-none print:overflow-visible">
      <table className="w-full border-collapse text-xs print:text-[8px]">
        <thead className="sticky top-0 z-10">
          <tr className="bg-muted">
            <th className={`sticky left-0 z-20 bg-muted text-left ${heading}`}>{months}</th>
            <th colSpan={dates.length} className={`text-center ${heading}`}>Dates of Attendance</th>
            <th colSpan={showRates ? 2 : 1} className={`text-right ${heading}`}>{years}</th>
          </tr>
          <tr className="bg-muted">
            <th className="sticky left-0 z-20 bg-muted" />
            {dates.map((day) => <th key={day.date} className={`border-x border-border px-1 py-1 text-center font-semibold ${day.weekday === "SUN" ? "bg-red-600 text-white dark:bg-red-800" : ""}`}>{day.weekday}</th>)}
            <th className="bg-muted" />{showRates && <th className="bg-muted" />}
          </tr>
          <tr className="bg-[#5b1f16] text-white">
            <th className="sticky left-0 z-20 bg-[#5b1f16] p-2 text-left font-semibold">Employee Name</th>
            {dates.map((day) => <th key={day.date} className="min-w-11 border-x border-white/20 px-1 py-1 text-center font-semibold tabular-nums">{Number(day.date.slice(8))}</th>)}
            <th className="whitespace-nowrap px-2 py-1 text-center font-semibold">Total Days</th>
            {showRates && <th className="px-2 py-1 text-center font-semibold">Rate</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ employee, summary, cells, rate }, index) => <tr key={employee.id} className={index % 2 ? "bg-muted/40" : "bg-background"}>
            <td className={`sticky left-0 z-[1] whitespace-nowrap border-y border-border p-0 ${index % 2 ? "bg-muted" : "bg-background"}`}>
              <button type="button" className="w-full px-2 py-1.5 text-left font-semibold uppercase hover:text-primary hover:underline" title={`${employee.id}${employee.branch ? ` · ${employee.branch}` : ""}`} onClick={() => onOpen(employee.id)}>{employee.name}</button>
            </td>
            {cells.map((cell, day) => <td key={dates[day]?.date ?? day} className={`border border-border px-1 py-1.5 text-center tabular-nums ${gridTone[cell.tone]}`}>{cell.code}</td>)}
            <td className="border border-border px-2 py-1.5 text-center font-semibold tabular-nums">{summary.daysPayable}</td>
            {showRates && <td className="whitespace-nowrap border border-border px-2 py-1.5 tabular-nums">{rate || "—"}</td>}
          </tr>)}
          {!rows.length && <tr><td colSpan={dates.length + (showRates ? 3 : 2)} className="p-8 text-center text-muted-foreground">No employees match.</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}

function SummaryRow({ summary }: { summary: SheetSummary }) {
  const warn = (value: number) => value > 0 ? "font-semibold text-red-700 dark:text-red-400" : "text-muted-foreground";
  const caution = (value: number) => value > 0 ? "font-semibold text-amber-700 dark:text-amber-400" : "text-muted-foreground";
  return <>
    <td className="p-2 text-right tabular-nums">{summary.scheduledDays}</td>
    <td className="p-2 text-right tabular-nums">{summary.present}{summary.restDayWork ? <span className="block text-xs text-muted-foreground">{summary.restDayWork} rest day</span> : null}</td>
    <td className="p-2 text-right font-semibold tabular-nums">{summary.daysPayable}</td>
    <td className={`p-2 text-right tabular-nums ${caution(summary.lateMinutes)}`}>{summary.lateDays ? <>{minutes(summary.lateMinutes)}<span className="block text-xs font-normal">{summary.lateDays} day(s)</span></> : "—"}</td>
    <td className={`p-2 text-right tabular-nums ${caution(summary.undertimeMinutes)}`}>{summary.undertimeDays ? <>{minutes(summary.undertimeMinutes)}<span className="block text-xs font-normal">{summary.undertimeDays} day(s)</span></> : "—"}</td>
    <td className="p-2 text-right tabular-nums">{summary.overtimeHours ? `${hours(summary.overtimeHours)} h` : "—"}</td>
    <td className="p-2 text-right tabular-nums">{hours(summary.regularHours)}</td>
    <td className="p-2 text-right tabular-nums">{hours(summary.totalHours)}</td>
    <td className="p-2 text-right tabular-nums">{summary.approvedLeave + summary.otherLeave || "—"}{summary.otherLeave ? <span className="block text-xs text-amber-700 dark:text-amber-400">{summary.otherLeave} not approved</span> : null}</td>
    <td className="p-2 text-right tabular-nums">{summary.dayOff + summary.notRequired || "—"}</td>
    <td className={`p-2 text-right tabular-nums ${warn(summary.absent)}`}>{summary.absent || "—"}{summary.systemAbsent ? <span className="block text-xs font-normal">{summary.systemAbsent} by system</span> : null}</td>
    <td className={`p-2 text-right tabular-nums ${warn(summary.awol)}`}>{summary.awol || "—"}</td>
    <td className={`p-2 text-right tabular-nums ${caution(summary.noRecord)}`}>{summary.noRecord || "—"}</td>
    <td className={`p-2 text-right tabular-nums ${caution(summary.missingTimeOut)}`}>{summary.missingTimeOut || "—"}</td>
    <td className="p-2 text-right tabular-nums">{rate(summary.attendanceRate)}</td>
  </>;
}

function EmployeeSheet({ result, period, from, to, onBack }: { result: OneResult; period: string; from: string; to: string; onBack: () => void }) {
  const { employee, days, summary } = result;
  const [problemsOnly, setProblemsOnly] = useState(false);
  const isProblem = (day: SheetDay) => ["Late", "Absent", "Absent (system)", "AWOL", "No record"].includes(day.status) || day.missingTimeOut || day.undertimeMinutes > 0 || (day.status === "Leave" && !day.leave.toLowerCase().includes("approved"));
  const shown = problemsOnly ? days.filter(isProblem) : days;
  const cards: Array<[string, string, string?]> = [
    ["Days payable", String(summary.daysPayable), `${summary.present} present + ${summary.approvedLeave} approved leave`],
    ["Working days", String(summary.scheduledDays), "Mon–Sat, less declared non-working days"],
    ["Attendance", rate(summary.attendanceRate), "Present ÷ days expected"],
    ["Late", summary.lateDays ? minutes(summary.lateMinutes) : "None", summary.lateDays ? `${summary.lateDays} day(s) late` : undefined],
    ["Undertime", summary.undertimeDays ? minutes(summary.undertimeMinutes) : "None", summary.undertimeDays ? `${summary.undertimeDays} day(s)` : undefined],
    ["Overtime", `${hours(summary.overtimeHours)} h`],
    ["Regular / total hours", `${hours(summary.regularHours)} / ${hours(summary.totalHours)}`, "Lunch break excluded"],
    ["Absent / AWOL", `${summary.absent} / ${summary.awol}`, summary.systemAbsent ? `${summary.systemAbsent} absent by system (no clock-in)` : undefined],
    ["Leave", String(summary.approvedLeave + summary.otherLeave), summary.otherLeave ? `${summary.otherLeave} not approved (not paid)` : "All approved"],
    ["Day off / not required", `${summary.dayOff} / ${summary.notRequired}`],
    ["No record", String(summary.noRecord), "Past working days with nothing recorded; payroll does not deduct them"],
    ["No time-out", String(summary.missingTimeOut), "Clocked in but not out: no hours counted"],
  ];
  return <Card>
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
      <div>
        <Button type="button" variant="ghost" size="sm" className="-ml-2 mb-1 print:hidden" onClick={onBack}><ArrowLeft className="size-4" />All employees</Button>
        <CardTitle>Attendance sheet · {employee.name}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{employee.id} · {employee.branch || "No primary branch"} · {employee.roles.join(", ") || "Employee"}{employee.status !== "active" ? ` · ${employee.status}` : ""}{employee.dateHired ? ` · hired ${longDate(employee.dateHired.slice(0, 10))}` : ""}</p>
        <p className="text-sm font-medium">{period}</p>
      </div>
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button type="button" variant="outline" onClick={() => downloadCsv(`attendance-${employee.id}-${from}-to-${to}.csv`, [
          ["Date", "Day", "Status", "Branch", "Time in", "Time out", "Regular hrs", "Total hrs", "Overtime hrs", "Late min", "Undertime min", "Leave", "Notes"],
          ...days.map((day) => [day.date, day.weekday, day.status + (day.missingTimeOut ? " (no time-out)" : "") + (day.restDayWork ? " (rest day)" : ""), day.branch, day.timeIn, day.timeOut, hours(day.regularHours), hours(day.totalHours), hours(day.overtimeHours), day.lateMinutes, day.undertimeMinutes, day.leave, day.notes]),
          [],
          summaryHeadings, summaryCells(summary),
        ])}><Download className="size-4" />CSV</Button>
        <Button type="button" variant="outline" onClick={() => window.print()}><Printer className="size-4" />Print</Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
        {cards.map(([label, value, detail]) => <div key={label} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold tabular-nums">{value}</p>{detail && <p className="text-xs text-muted-foreground">{detail}</p>}</div>)}
      </div>
      <label className="flex items-center gap-2 text-sm print:hidden"><input type="checkbox" checked={problemsOnly} onChange={(event) => setProblemsOnly(event.target.checked)} />Only days to check (late, undertime, absent, AWOL, no record, no time-out, leave not approved)</label>
      <div className="overflow-x-auto rounded-lg border print:overflow-visible">
        <table className="w-full min-w-[980px] text-sm print:min-w-0 print:text-[10px]">
          <thead className="bg-muted text-left"><tr>{["Date", "Status", "Time in", "Time out", "Regular", "Total", "OT", "Late", "Undertime", "Branch", "Leave / notes"].map((heading) => <th key={heading} className="p-2">{heading}</th>)}</tr></thead>
          <tbody>
            {shown.map((day) => {
              const muted = ["Sunday", "Non-working day", "Upcoming", "Before hire"].includes(day.status);
              return <tr key={day.date} className={`border-t ${muted ? "bg-muted/30 text-muted-foreground" : ""}`}>
                <td className="whitespace-nowrap p-2"><span className="font-medium">{day.weekday}</span> {longDate(day.date)}</td>
                <td className="p-2"><Badge variant="secondary" className={statusTone[day.status] ?? ""}>{day.status}</Badge>{day.missingTimeOut && <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">no time-out</span>}{day.restDayWork && <span className="ml-1 text-xs text-muted-foreground">rest day</span>}</td>
                <td className="p-2 tabular-nums">{day.timeIn || "—"}</td>
                <td className="p-2 tabular-nums">{day.timeOut || "—"}</td>
                <td className="p-2 tabular-nums">{day.timeIn ? hours(day.regularHours) : "—"}</td>
                <td className="p-2 tabular-nums">{day.timeIn ? hours(day.totalHours) : "—"}</td>
                <td className="p-2 tabular-nums">{day.overtimeHours ? hours(day.overtimeHours) : "—"}</td>
                <td className={`p-2 tabular-nums ${day.lateMinutes ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}>{day.lateMinutes ? `${day.lateMinutes} min` : "—"}</td>
                <td className={`p-2 tabular-nums ${day.undertimeMinutes ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}>{day.undertimeMinutes ? `${day.undertimeMinutes} min` : "—"}</td>
                <td className="p-2">{day.branch || "—"}</td>
                <td className="max-w-72 p-2 text-xs">{[day.leave, day.notes].filter(Boolean).join(" · ") || "—"}</td>
              </tr>;
            })}
            {!shown.length && <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">{problemsOnly ? "Nothing to check in this period." : "No days in this period."}</td></tr>}
          </tbody>
        </table>
      </div>
      <Legend />
    </CardContent>
  </Card>;
}

function Legend() {
  return <p className="text-xs text-muted-foreground">
    Days payable = Present + approved leave (payroll&apos;s attendance method). Late, undertime and overtime come from days worked. Absent (system) = no clock-in by 11:59 PM and not marked by management. No record = a past working day with nothing recorded (not deducted by payroll; mark it in Attendance Review). Sundays, declared non-working days, days before the hire date and days still to come are not counted.
  </p>;
}
