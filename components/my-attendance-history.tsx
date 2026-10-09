"use client";

import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { useEffect, useState } from "react";

import type { AttendanceHistory, HistoryPeriod, HistoryTotals } from "@/lib/attendance-board";

const PERIODS: { id: HistoryPeriod; label: string }[] = [{ id: "week", label: "Week" }, { id: "month", label: "Month" }, { id: "year", label: "Year" }];
/** Category → tone (globals.css .tone-*) and the share it takes in a breakdown bar. Colour always comes with a label. */
const CATEGORY: Record<string, { tone: string; label: string }> = {
  Early: { tone: "tone-teal", label: "Early" }, "On time": { tone: "tone-success", label: "On time" }, Late: { tone: "tone-warning", label: "Late" },
  Absent: { tone: "tone-danger", label: "Absent" }, AWOL: { tone: "tone-danger", label: "AWOL" }, "On leave": { tone: "tone-info", label: "On leave" },
  "Day Off": { tone: "tone-neutral", label: "Day off" }, "Not required": { tone: "tone-neutral", label: "No attendance needed" }, "Non-working day": { tone: "tone-neutral", label: "Non-working day" }, "Not clocked in": { tone: "tone-neutral", label: "Not clocked in" },
};
const SEGMENTS: { key: keyof HistoryTotals; label: string; tone: string }[] = [
  { key: "early", label: "Early", tone: "tone-teal" }, { key: "onTime", label: "On time", tone: "tone-success" }, { key: "late", label: "Late", tone: "tone-warning" },
  { key: "absent", label: "Absent", tone: "tone-danger" }, { key: "leave", label: "Leave", tone: "tone-info" },
];
const minutes = (value: number) => (value >= 60 ? `${Math.floor(value / 60)}h ${value % 60}m` : `${value}m`);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-PH", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

/** The signed-in employee's own attendance by week, month or year, with totals, a breakdown and every day. */
export function MyAttendanceHistory() {
  const [period, setPeriod] = useState<HistoryPeriod>("month");
  const [date, setDate] = useState("");
  const [data, setData] = useState<AttendanceHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showDays, setShowDays] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ period, ...(date ? { date } : {}) });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the request this effect starts
    setLoading(true);
    fetch(`/api/attendance/history?${query}`, { cache: "no-store" })
      .then(async (response) => { const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.message || "Unable to load your attendance history."); return result.history as AttendanceHistory; })
      .then((history) => { if (!cancelled) { setData(history); setError(""); } })
      .catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Unable to load your attendance history."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, date]);

  const t = data?.totals;
  const isCurrent = data ? data.today >= data.from && data.today <= data.to : true;
  const daysOpen = showDays || period === "week";

  return (
    <section className="rounded-3xl border bg-white p-6 shadow-[0_4px_20px_-2px_rgb(45_28_89_/_0.05)] sm:p-8">
      <div className="mb-6 flex flex-col gap-4 border-b border-violet-90 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-95 text-violet-60"><History className="size-5" /></div>
          <div>
            <h2 className="text-xl font-bold text-violet-10">My Attendance History</h2>
            <p className="mt-1 text-xs text-violet-40">Early is clocking in at or before 8:00 AM; late starts after 8:20 AM. Lunch (12–1 PM) is not counted. Regular hours stop at 5:00 PM; total hours run to clock-out, overtime included.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="History period" className="inline-flex rounded-xl border border-violet-90 bg-violet-95/40 p-1">
            {PERIODS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={period === item.id} onClick={() => { setPeriod(item.id); setShowDays(false); }}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors ${period === item.id ? "bg-white text-violet-10 shadow-sm" : "text-violet-40 hover:text-violet-10"}`}>{item.label}</button>
            ))}
          </div>
          <div className="inline-flex items-center gap-1">
            <button type="button" aria-label="Previous" disabled={!data || loading} onClick={() => data && setDate(data.previous)} className="flex size-9 items-center justify-center rounded-lg border border-violet-90 text-violet-40 hover:text-violet-10 disabled:opacity-40"><ChevronLeft className="size-4" /></button>
            <span className="min-w-[9.5rem] px-2 text-center text-sm font-bold text-violet-10 tabular-nums">{data?.label ?? "…"}</span>
            <button type="button" aria-label="Next" disabled={!data || loading || isCurrent} onClick={() => data && setDate(data.next)} className="flex size-9 items-center justify-center rounded-lg border border-violet-90 text-violet-40 hover:text-violet-10 disabled:opacity-40"><ChevronRight className="size-4" /></button>
            {!isCurrent && <button type="button" onClick={() => setDate("")} className="ml-1 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-primary hover:underline">Today</button>}
          </div>
        </div>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-5 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
        <Tile label="Days present" value={String(data?.present ?? 0)} note={data?.punctuality === null || data?.punctuality === undefined ? "No clock-ins yet" : `${data.punctuality}% early or on time`} tone="tone-success" />
        <Tile label="Late" value={`${t?.late ?? 0} day${t?.late === 1 ? "" : "s"}`} note={`${minutes(t?.lateMinutes ?? 0)} in total`} tone="tone-warning" />
        <Tile label="Absent" value={String(t?.absent ?? 0)} note={`${t?.leave ?? 0} on leave · ${t?.dayOff ?? 0} day off`} tone="tone-danger" />
        <Tile label="Regular hours" value={(t?.regularHours ?? 0).toFixed(2)} note={`Clock-in to 5:00 PM · ${minutes(t?.undertimeMinutes ?? 0)} undertime`} tone="tone-brand" />
        <Tile label="Total hours" value={(t?.workedHours ?? 0).toFixed(2)} note={`Clock-in to clock-out · ${(t?.overtimeHours ?? 0).toFixed(2)} overtime`} tone="tone-info" />
      </div>

      {data && period !== "week" && data.breakdown.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-violet-10">By {period === "year" ? "month" : "week"}</h3>
            <ul className="flex flex-wrap gap-3 text-[11px] text-violet-40" aria-label="Legend">{SEGMENTS.map((s) => <li key={s.key} className="flex items-center gap-1.5"><span className={`${s.tone} tone-bar size-2.5 rounded-sm`} aria-hidden />{s.label}</li>)}</ul>
          </div>
          <ul className="space-y-2.5">
            {data.breakdown.map((group) => {
              const total = SEGMENTS.reduce((sum, s) => sum + Number(group.totals[s.key]), 0) || 1;
              return (
                <li key={group.key} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 text-sm sm:grid-cols-[7rem_minmax(0,1fr)_20rem]">
                  <span className="font-semibold text-violet-10">{group.label}</span>
                  <span className="flex h-3 overflow-hidden rounded-full bg-violet-95" role="img" aria-label={SEGMENTS.map((s) => `${group.totals[s.key]} ${s.label.toLowerCase()}`).join(", ")}>
                    {SEGMENTS.map((s) => Number(group.totals[s.key]) > 0 && <span key={s.key} className={`${s.tone} tone-bar h-full`} style={{ width: `${(Number(group.totals[s.key]) / total) * 100}%` }} title={`${group.totals[s.key]} ${s.label}`} />)}
                  </span>
                  <span className="col-span-2 text-xs text-violet-40 tabular-nums sm:col-span-1 sm:text-right">{group.totals.early + group.totals.onTime + group.totals.late} present · {group.totals.late} late · {group.totals.absent} absent · {group.totals.regularHours.toFixed(1)} h regular · {group.totals.workedHours.toFixed(1)} h total</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-violet-10">Days{data ? ` (${data.days.length})` : ""}</h3>
          {period !== "week" && data && data.days.length > 0 && <button type="button" onClick={() => setShowDays(!showDays)} className="text-sm font-semibold text-primary hover:underline">{showDays ? "Hide days" : "Show every day"}</button>}
        </div>
        {daysOpen && (data?.days.length ? (
          <div className="overflow-x-auto rounded-2xl border border-violet-90">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-violet-95/50 text-[11px] font-bold uppercase tracking-wider text-violet-40">
                <tr>{["Date", "Status", "Time in", "Time out", "Regular", "Total", "Late", "Undertime"].map((heading) => <th key={heading} className="px-3 py-2.5">{heading}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-violet-90">
                {data.days.map((day) => {
                  const category = CATEGORY[day.category] ?? { tone: "tone-neutral", label: day.category };
                  return (
                    <tr key={day.id || day.attendanceDate}>
                      <td className="px-3 py-2.5 font-semibold text-violet-10">{weekday(day.attendanceDate)}</td>
                      <td className="px-3 py-2.5"><span className={`tone-chip ${category.tone} rounded-full px-2 py-0.5 text-[11px] font-bold`}>{category.label}</span></td>
                      <td className="px-3 py-2.5 tabular-nums">{day.timeIn || "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums">{day.timeOut || "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums">{day.timeOut ? `${(day.regularHours ?? 0).toFixed(2)} h` : "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums">{day.timeOut ? `${day.workedHours.toFixed(2)} h` : "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums">{day.lateMinutes ? minutes(day.lateMinutes) : "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums">{day.undertimeMinutes ? minutes(day.undertimeMinutes) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : !loading && <p className="rounded-2xl border border-dashed border-violet-90 bg-violet-95/30 px-5 py-8 text-center text-sm text-violet-40">No attendance recorded for {data?.label ?? "this period"}.</p>)}
      </div>
    </section>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return (
    <div className={`${tone} relative overflow-hidden rounded-2xl border bg-white p-4`}>
      <span className="tone-bar absolute inset-x-0 top-0 h-1 opacity-80" aria-hidden />
      <p className="text-xs font-medium text-violet-40">{label}</p>
      <p className="mt-1 text-2xl font-black text-violet-10 tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-violet-40">{note}</p>
    </div>
  );
}
