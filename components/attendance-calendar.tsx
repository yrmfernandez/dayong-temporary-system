"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Flag, Lock, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HOLIDAY_TYPES, type HolidayType } from "@/lib/philippine-holidays";

type Holiday = { id: string; date: string; name: string; type: HolidayType; notes: string };
type Closure = { date: string; reason: string; allBranches: boolean; branchIds: string[]; branchNames: string[]; appliesToMe: boolean };
type CalendarData = {
  month: string; canManage: boolean; myBranch: string; holidays: Holiday[]; closures: Closure[];
  yearHolidayCount: number; branches: Array<{ id: string; name: string }>;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const holidayTone: Record<HolidayType, string> = {
  "Regular holiday": "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  "Special non-working day": "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  "Special working day": "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
};
const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";

const todayInPhilippines = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const shiftMonth = (month: string, by: number) => {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return date.toISOString().slice(0, 7);
};
const monthLabel = (month: string) => new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
const dayLabel = (date: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const isSunday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
const closureScope = (closure: Closure) => closure.allBranches ? "All branches" : closure.branchNames.join(", ");

/**
 * Month calendar of holidays and declared non-working days. Everyone sees it; with `canManage` from the server,
 * HR and administrators also edit holidays and declare or reopen non-working days per branch.
 */
export function AttendanceCalendar({ onClosuresChanged }: { onClosuresChanged?: () => void }) {
  const today = todayInPhilippines();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState<CalendarData | null>(null);
  const [selected, setSelected] = useState(today);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async (target: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/attendance-calendar?month=${target}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load the calendar.");
      setData(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load the calendar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the visible month
    void load(month);
  }, [load, month]);

  const post = async (body: Record<string, unknown>, closuresChanged = false) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/attendance-calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to update the calendar.");
      await load(month);
      if (closuresChanged) onClosuresChanged?.();
      setMessage(result.message);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update the calendar.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cells = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00Z`);
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return [
      ...Array.from({ length: first.getUTCDay() }, () => ""),
      ...Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`),
    ];
  }, [month]);

  const holidaysOn = (date: string) => data?.holidays.filter((holiday) => holiday.date === date) ?? [];
  const closureOn = (date: string) => data?.closures.find((closure) => closure.date === date) ?? null;
  const year = month.slice(0, 4);
  const events = [...new Set([...(data?.holidays ?? []).map((holiday) => holiday.date), ...(data?.closures ?? []).map((closure) => closure.date)])].sort();

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2"><CalendarDays className="size-5" />Holiday &amp; Non-working Day Calendar</CardTitle>
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="outline" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft className="size-4" /></Button>
          <span className="min-w-36 text-center text-sm font-semibold">{monthLabel(month)}</span>
          <Button type="button" size="icon" variant="outline" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight className="size-4" /></Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>Today</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Holidays are shown for reference. Attendance closes only on days HR or an administrator declares non-working{data?.myBranch ? `; closures that include your branch (${data.myBranch}) are marked.` : "."}
        </p>

        {data?.canManage && (
          <div className="flex flex-col gap-2 rounded-xl border border-dashed p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>{data.yearHolidayCount ? `${data.yearHolidayCount} holidays are recorded for ${year}.` : `No holidays are recorded for ${year} yet.`}</span>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void post({ action: "add-philippine-holidays", year: Number(year) })}>
              <Flag className="size-4" />{data.yearHolidayCount ? `Add missing Philippine holidays for ${year}` : `Add Philippine holidays for ${year}`}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {HOLIDAY_TYPES.map((type) => <span key={type} className="flex items-center gap-1.5"><span className={`size-3 rounded-sm ${holidayTone[type]}`} />{type}</span>)}
          <span className="flex items-center gap-1.5"><Lock className="size-3 text-violet-700 dark:text-violet-300" />Declared non-working day</span>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-muted-foreground">
          {WEEKDAYS.map((day) => <div key={day}>{day}</div>)}
        </div>
        <div className={`grid grid-cols-7 gap-1 ${loading ? "opacity-60" : ""}`}>
          {cells.map((date, index) => {
            if (!date) return <div key={`blank-${index}`} />;
            const holidays = holidaysOn(date), closure = closureOn(date);
            const highlighted = closure && (closure.appliesToMe || data?.canManage);
            return (
              <button
                key={date} type="button" onClick={() => setSelected(date)}
                className={`flex min-h-14 flex-col items-stretch gap-0.5 rounded-lg border p-1 text-left text-xs transition-colors sm:min-h-24 sm:p-1.5 ${selected === date ? "border-primary ring-2 ring-primary/30" : ""} ${highlighted ? "bg-violet-100 dark:bg-violet-950" : isSunday(date) ? "bg-muted/60 text-muted-foreground" : "hover:bg-muted/40"}`}
              >
                <span className={`flex items-center justify-between font-semibold ${date === today ? "text-primary" : ""}`}>
                  {Number(date.slice(8))}
                  {closure && <Lock className={`size-3 ${closure.appliesToMe || data?.canManage ? "text-violet-700 dark:text-violet-300" : "text-muted-foreground"}`} aria-label="Non-working day" />}
                </span>
                {holidays.map((holiday) => (
                  <span key={holiday.id} title={`${holiday.name} (${holiday.type})`} className={`hidden truncate rounded px-1 text-[10px] leading-4 sm:block ${holidayTone[holiday.type]}`}>{holiday.name}</span>
                ))}
                {holidays.length > 0 && <span className={`mx-auto size-1.5 rounded-full sm:hidden ${holidayTone[holidays[0].type]}`} />}
                {closure && <span className="hidden truncate text-[10px] text-violet-800 sm:block dark:text-violet-200">Closed · {closure.allBranches ? "All" : `${closure.branchNames.length} branch${closure.branchNames.length === 1 ? "" : "es"}`}</span>}
              </button>
            );
          })}
        </div>

        {message && <p className="text-sm text-muted-foreground">{message}</p>}

        <DayDetails
          key={`${selected}-${closureOn(selected)?.reason ?? ""}-${closureOn(selected)?.branchIds.join() ?? ""}`}
          date={selected} holidays={holidaysOn(selected)} closure={closureOn(selected)} data={data} busy={busy} post={post}
        />

        {events.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">This month</p>
            <ul className="divide-y rounded-lg border text-sm">
              {events.map((date) => (
                <li key={date}>
                  <button type="button" onClick={() => setSelected(date)} className="flex w-full flex-col gap-1 p-3 text-left hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-3">
                    <span className="w-28 shrink-0 font-medium">{new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))}</span>
                    <span className="flex flex-wrap gap-1.5">
                      {holidaysOn(date).map((holiday) => <span key={holiday.id} className={`rounded px-1.5 text-xs ${holidayTone[holiday.type]}`}>{holiday.name}</span>)}
                      {closureOn(date) && <span className="flex items-center gap-1 text-xs text-violet-800 dark:text-violet-200"><Lock className="size-3" />Non-working · {closureScope(closureOn(date)!)}{closureOn(date)!.appliesToMe ? " (your branch)" : ""}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DayDetails({ date, holidays, closure, data, busy, post }: {
  date: string; holidays: Holiday[]; closure: Closure | null; data: CalendarData | null; busy: boolean;
  post: (body: Record<string, unknown>, closuresChanged?: boolean) => Promise<boolean>;
}) {
  const canManage = Boolean(data?.canManage);
  const [reason, setReason] = useState(closure?.reason ?? holidays.find((holiday) => holiday.type !== "Special working day")?.name ?? "");
  const [allBranches, setAllBranches] = useState(closure ? closure.allBranches : true);
  const [branchIds, setBranchIds] = useState<string[]>(closure?.branchIds ?? []);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const sunday = isSunday(date);

  const toggleBranch = (id: string) => setBranchIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return (
    <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
      <div>
        <p className="font-semibold">{dayLabel(date)}</p>
        {sunday && <p className="text-sm text-muted-foreground">Sunday is never a working day.</p>}
      </div>

      <div className="space-y-2">
        {holidays.length === 0 && <p className="text-sm text-muted-foreground">No holiday on this date.</p>}
        {holidays.map((holiday) => (
          <div key={holiday.id} className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{holiday.name} <span className={`ml-1 rounded px-1.5 text-xs ${holidayTone[holiday.type]}`}>{holiday.type}</span></p>
              {holiday.notes && <p className="text-xs text-muted-foreground">{holiday.notes}</p>}
            </div>
            {canManage && (
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(holiday)}>Edit</Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${holiday.name}`} onClick={() => { if (window.confirm(`Remove ${holiday.name} from the calendar?`)) void post({ action: "delete-holiday", id: holiday.id }); }}><Trash2 className="size-4" /></Button>
              </div>
            )}
          </div>
        ))}
        {canManage && !editing && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing({ id: "", date, name: "", type: "Special non-working day", notes: "" })}>Add holiday on this date</Button>}
        {canManage && editing && <HolidayForm holiday={editing} busy={busy} onCancel={() => setEditing(null)} onSave={async (holiday) => { if (await post({ action: "save-holiday", ...holiday })) setEditing(null); }} />}
      </div>

      {closure && (
        <div className="rounded-lg border border-violet-300 bg-violet-50 p-3 text-sm text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100">
          <p className="flex items-center gap-1.5 font-semibold"><Lock className="size-4" />Non-working day · {closureScope(closure)}</p>
          <p>{closure.reason}</p>
          {!canManage && <p className="mt-1 text-xs">{closure.appliesToMe ? "Your branch is closed; clocking in is not available." : "Your branch is not included; attendance is open for you."}</p>}
        </div>
      )}

      {canManage && !sunday && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-semibold">{closure ? "Update non-working day" : "Declare non-working day"}</p>
          <div className="space-y-2">
            <Label htmlFor="closure-reason">Reason</Label>
            <Input id="closure-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Holiday, emergency closure, company event..." />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Affected branches</p>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={allBranches} onChange={(event) => setAllBranches(event.target.checked)} />All branches
            </label>
            {!allBranches && (
              <div className="space-y-2">
                <div className="flex gap-2 text-xs">
                  <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setBranchIds(data?.branches.map((branch) => branch.id) ?? [])}>Select all</button>
                  <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setBranchIds([])}>Clear</button>
                </div>
                <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border bg-background p-2 sm:grid-cols-2 lg:grid-cols-3">
                  {(data?.branches ?? []).map((branch) => (
                    <label key={branch.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted/50">
                      <input type="checkbox" checked={branchIds.includes(branch.id)} onChange={() => toggleBranch(branch.id)} />{branch.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Clock-ins already recorded at the affected branches on this date are cancelled; their times stay in the record notes.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || !reason.trim() || (!allBranches && !branchIds.length)} onClick={() => void post({ action: "declare-closure", date, reason, allBranches, branchIds: allBranches ? [] : branchIds }, true)}>
              {closure ? "Update Non-working Day" : "Declare Non-working Day"}
            </Button>
            {closure && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => { if (window.confirm("Reopen attendance for this date? Clock-ins cancelled by this closure stay cancelled.")) void post({ action: "remove-closure", date }, true); }}>
                Remove Non-working Day
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HolidayForm({ holiday, busy, onSave, onCancel }: { holiday: Holiday; busy: boolean; onSave: (holiday: Holiday) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState(holiday);
  const set = (change: Partial<Holiday>) => setDraft((current) => ({ ...current, ...change }));
  return (
    <div className="grid gap-3 rounded-lg border bg-background p-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="holiday-name">Holiday name</Label><Input id="holiday-name" value={draft.name} onChange={(event) => set({ name: event.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="holiday-date">Date</Label><Input id="holiday-date" type="date" value={draft.date} onChange={(event) => set({ date: event.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="holiday-type">Type</Label><select id="holiday-type" className={selectClass} value={draft.type} onChange={(event) => set({ type: event.target.value as HolidayType })}>{HOLIDAY_TYPES.map((type) => <option key={type}>{type}</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor="holiday-notes">Notes</Label><Input id="holiday-notes" value={draft.notes} onChange={(event) => set({ notes: event.target.value })} placeholder="Optional" /></div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="button" size="sm" disabled={busy || !draft.name.trim() || !draft.date} onClick={() => void onSave(draft)}>{holiday.id ? "Save Holiday" : "Add Holiday"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
