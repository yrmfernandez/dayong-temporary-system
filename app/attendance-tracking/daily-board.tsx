"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";

type Category = "On time" | "Late" | "Early" | "Absent" | "AWOL" | "On leave" | "Not clocked in";
type BoardRecord = { timeIn: string; timeOut: string; scheduledTimeIn: string; lateMinutes: number; leaveType: string; leaveApprovalStatus: string; notes: string; branch: string };
type Row = { employeeId: string; name: string; roles: string[]; branches: string[]; category: Category; earlyMinutes: number; record: BoardRecord | null };
type Board = { date: string; today: string; canAdjustLate: boolean; closedDay: string; rows: Row[] };

// Present covers On time, Late, and Early; the rest are listed in this order on screen and on paper.
const sections: Array<{ category: Category; title: string; tone: string }> = [
  { category: "Late", title: "Late", tone: "text-amber-700" },
  { category: "Early", title: "Early", tone: "text-emerald-700" },
  { category: "On time", title: "Present, on time", tone: "text-emerald-700" },
  { category: "Absent", title: "Absent", tone: "text-red-700" },
  { category: "AWOL", title: "AWOL", tone: "text-red-800" },
  { category: "On leave", title: "On leave", tone: "text-sky-700" },
  { category: "Not clocked in", title: "Not clocked in yet", tone: "text-muted-foreground" },
];
const presentCategories: Category[] = ["On time", "Late", "Early"];

const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const duration = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)} hr${minutes >= 120 ? "s" : ""}${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;

export function DailyBoard() {
  const [date, setDate] = useState(manilaToday);
  const [branch, setBranch] = useState("");
  const [focus, setFocus] = useState<Category | "Present" | "">("");
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<{ employeeId: string; hours: string; minutes: string; reason: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/attendance-tracking/daily?date=${encodeURIComponent(date)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load the attendance board.");
      setBoard(result);
    } catch (failure) { setBoard(null); setError(failure instanceof Error ? failure.message : "Unable to load the attendance board."); }
    finally { setLoading(false); }
  }, [date]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the board whenever the date changes
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => (board?.rows ?? []).filter((row) => !branch || row.branches.includes(branch)), [board, branch]);
  const count = (category: Category) => rows.filter((row) => row.category === category).length;
  const presentCount = rows.filter((row) => presentCategories.includes(row.category)).length;
  const branchOptions = [...new Set((board?.rows ?? []).flatMap((row) => row.branches))].sort().map((name) => ({ value: name, label: name }));
  const shown = sections.filter((section) => (!focus || focus === section.category || (focus === "Present" && presentCategories.includes(section.category))) && count(section.category) > 0);

  async function saveLate() {
    if (!editing) return;
    const lateMinutes = (Number(editing.hours) || 0) * 60 + (Number(editing.minutes) || 0);
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/attendance-tracking/daily", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: editing.employeeId, attendanceDate: date, lateMinutes, reason: editing.reason }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to adjust late time.");
      setMessage(result.message); setEditing(null); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to adjust late time."); }
    finally { setSaving(false); }
  }

  const tiles: Array<{ key: Category | "Present"; label: string; value: number; tone: string }> = [
    { key: "Present", label: "Present", value: presentCount, tone: "text-emerald-700" },
    { key: "Late", label: "Late", value: count("Late"), tone: "text-amber-700" },
    { key: "Early", label: "Early", value: count("Early"), tone: "text-emerald-700" },
    { key: "Absent", label: "Absent", value: count("Absent"), tone: "text-red-700" },
    { key: "AWOL", label: "AWOL", value: count("AWOL"), tone: "text-red-800" },
    { key: "On leave", label: "On leave", value: count("On leave"), tone: "text-sky-700" },
    ...(board && board.date === board.today ? [{ key: "Not clocked in" as const, label: "Not clocked in", value: count("Not clocked in"), tone: "text-muted-foreground" }] : []),
  ];

  return <div className="space-y-4">
    <Card className="print:hidden"><CardContent className="grid gap-4 p-4 md:grid-cols-4">
      <div className="space-y-2"><Label htmlFor="board-date">Date</Label><Input id="board-date" type="date" max={manilaToday()} value={date} onChange={(event) => event.target.value && setDate(event.target.value)} /></div>
      <div className="space-y-2 md:col-span-2"><Label>Branch</Label><SearchSelect aria-label="Branch" className="h-9" clearable placeholder="All branches" value={branch} onValueChange={setBranch} options={branchOptions} /></div>
      <div className="flex items-end gap-2"><Button type="button" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button><Button type="button" onClick={() => window.print()} disabled={!board}><Printer className="mr-2 size-4" />Print</Button></div>
    </CardContent></Card>

    <div className="hidden print:block"><h2 className="text-lg font-bold">Daily attendance · {date}</h2><p className="text-sm">{branch || "All branches"} · Printed {new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</p></div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 print:hidden">{message}</p>}
    {board?.closedDay && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{board.closedDay}</p>}

    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">{tiles.map((tile) => <button key={tile.key} type="button" aria-pressed={focus === tile.key} onClick={() => setFocus(focus === tile.key ? "" : tile.key)} className={`rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary ${focus === tile.key ? "border-primary ring-2 ring-primary/30" : ""}`}><p className="text-xs text-muted-foreground">{tile.label}</p><p className={`text-2xl font-bold tabular-nums ${tile.tone}`}>{tile.value}</p></button>)}</div>
    {focus && <p className="text-xs text-muted-foreground print:hidden">Showing {focus} only. <button type="button" className="font-medium text-primary hover:underline" onClick={() => setFocus("")}>Show everyone</button></p>}

    {loading && !board && <p className="p-6 text-sm text-muted-foreground">Loading attendance...</p>}
    {board && !shown.length && <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">No employees match these filters.</p>}
    {shown.map((section) => {
      const list = rows.filter((row) => row.category === section.category);
      const showLate = section.category === "Late", showEarly = section.category === "Early", clocked = presentCategories.includes(section.category);
      return <Card key={section.category} className="break-inside-avoid"><CardHeader className="pb-2"><CardTitle className={`text-base ${section.tone}`}>{section.title} <span className="font-normal text-muted-foreground">({list.length})</span></CardTitle></CardHeader><CardContent><div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/50 text-left"><tr><th className="p-2.5">Employee</th><th className="p-2.5">Branch</th>{clocked && <><th className="p-2.5">Time in</th><th className="p-2.5">Time out</th></>}{showLate && <th className="p-2.5">Late by</th>}{showEarly && <th className="p-2.5">Early by</th>}<th className="p-2.5">Notes</th>{clocked && board?.canAdjustLate && <th className="p-2.5 print:hidden" />}</tr></thead>
        <tbody>{list.map((row) => { const record = row.record; const isEditing = editing?.employeeId === row.employeeId; return [
          <tr key={row.employeeId} className="border-t align-top">
            <td className="p-2.5"><strong>{row.name}</strong><div className="text-xs text-muted-foreground">{row.employeeId}{row.roles.length ? ` · ${row.roles.join(", ")}` : ""}</div></td>
            <td className="p-2.5">{record?.branch || row.branches.join(", ") || "—"}</td>
            {clocked && <><td className="p-2.5 tabular-nums">{record?.timeIn || "—"}</td><td className="p-2.5 tabular-nums">{record?.timeOut || "—"}</td></>}
            {showLate && <td className="p-2.5 font-semibold text-amber-700 tabular-nums">{duration(record?.lateMinutes ?? 0)}</td>}
            {showEarly && <td className="p-2.5 text-emerald-700 tabular-nums">{duration(row.earlyMinutes)}</td>}
            <td className="max-w-80 p-2.5 text-xs">{record?.notes || (record?.leaveType ? `${record.leaveType} · ${record.leaveApprovalStatus}` : "—")}</td>
            {clocked && board?.canAdjustLate && <td className="p-2.5 text-right print:hidden"><Button type="button" size="sm" variant="outline" onClick={() => setEditing(isEditing ? null : { employeeId: row.employeeId, hours: String(Math.floor((record?.lateMinutes ?? 0) / 60)), minutes: String((record?.lateMinutes ?? 0) % 60), reason: "" })}>{isEditing ? "Cancel" : "Adjust late"}</Button></td>}
          </tr>,
          isEditing && <tr key={`${row.employeeId}-edit`} className="bg-muted/30 print:hidden"><td colSpan={8} className="p-3">
            <div className="grid gap-3 sm:grid-cols-[6rem_6rem_1fr_auto] sm:items-end">
              <div className="space-y-1"><Label htmlFor="late-hours">Hours</Label><Input id="late-hours" type="number" min={0} max={24} step={1} value={editing.hours} onChange={(event) => setEditing({ ...editing, hours: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="late-minutes">Minutes</Label><Input id="late-minutes" type="number" min={0} max={59} step={1} value={editing.minutes} onChange={(event) => setEditing({ ...editing, minutes: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="late-reason">Reason *</Label><Input id="late-reason" maxLength={200} placeholder="e.g. Approved client visit before reporting" value={editing.reason} onChange={(event) => setEditing({ ...editing, reason: event.target.value })} /></div>
              <Button type="button" disabled={saving || editing.reason.trim().length < 3} onClick={() => void saveLate()}>{saving ? "Saving..." : "Save late time"}</Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Currently {duration(record?.lateMinutes ?? 0)} late. Set 0 hours 0 minutes to clear it. The change, who made it, and the reason are kept in the attendance notes, and payroll uses the new late time.</p>
          </td></tr>,
        ]; })}</tbody>
      </table></div></CardContent></Card>;
    })}
  </div>;
}
