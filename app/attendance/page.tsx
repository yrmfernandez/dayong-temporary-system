"use client";

import {
  AlertCircle,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LogIn,
  LogOut,
  MapPin,
  Timer,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AttendanceCalendar } from "@/components/attendance-calendar";
import { MyAttendanceHistory } from "@/components/my-attendance-history";
import { BREAK_END, BREAK_START, dayTotals, SCHEDULED_TIME_IN, SCHEDULED_TIME_OUT, timeToMinutes } from "@/lib/attendance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { formatDate as showDate } from "@/lib/date-format";

type AttendanceRecord = {
  attendanceDate: string;
  branch: string;
  timeIn: string;
  timeOut: string;
  scheduledTimeOut?: string;
  workedHours: number;
  overtimeHours: number;
  status: string;
  lateMinutes: number;
  undertimeMinutes: number;
};

const PHILIPPINE_TIME_ZONE = "Asia/Manila";
const SHIFT_HOURS = 8;

function formatClock(date: Date) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: PHILIPPINE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

function formatDate(date: Date) {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: PHILIPPINE_TIME_ZONE, weekday: "long" }).format(date);
  return `${weekday}, ${showDate(date)}`;
}

function timeToSeconds(time: string) {
  const [hours = 0, minutes = 0, seconds = 0] = time
    .split(":")
    .map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

function currentPhilippineSeconds(date: Date) {
  const parts = new Intl.DateTimeFormat("en-PH", {
    timeZone: PHILIPPINE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 3600 + value("minute") * 60 + value("second");
}

/** Why the phone gave no location: permission refused, location (GPS) turned off, too slow, or no location at all. */
type LocationProblem = "denied" | "off" | "slow" | "unsupported";
type Position = { latitude: number; longitude: number; accuracy: number };

function readPosition(options: PositionOptions): Promise<Position | { problem: LocationProblem }> {
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
    (error) => resolve({ problem: error.code === error.PERMISSION_DENIED ? "denied" : error.code === error.TIMEOUT ? "slow" : "off" }),
    options,
  ));
}

/**
 * The phone's location for the clock-in location check (lib/clock-in-location.ts), or why there is none. Never throws.
 * A precise reading first; when that is slow or unavailable, one quicker try with a coarser (network) location. Since
 * November 16, 2026 (owner) the page does not clock in without a location: it asks the employee to turn it on.
 */
async function devicePosition(): Promise<Position | { problem: LocationProblem }> {
  if (typeof navigator === "undefined" || !navigator.geolocation || (typeof window !== "undefined" && !window.isSecureContext)) return { problem: "unsupported" };
  const precise = await readPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  if (!("problem" in precise) || precise.problem === "denied") return precise;
  return readPosition({ enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

const locationHelp: Record<LocationProblem, { title: string; steps: string[] }> = {
  denied: {
    title: "Location is blocked for this site",
    steps: [
      "Tap the lock or settings icon beside the web address and set Location to Allow.",
      "iPhone: Settings → Privacy & Security → Location Services → your browser (Safari or Chrome) → While Using the App.",
      "Android: Settings → Apps → your browser → Permissions → Location → Allow.",
      "Then come back here and press Try again.",
    ],
  },
  off: {
    title: "Your phone's location is turned off",
    steps: [
      "Swipe down from the top of the screen and turn on Location (GPS).",
      "iPhone: Settings → Privacy & Security → Location Services → On.",
      "Then press Try again.",
    ],
  },
  slow: {
    title: "Your location could not be found in time",
    steps: [
      "Make sure Location (GPS) is on, and Wi-Fi or mobile data is on.",
      "Move near a window or outside for a moment, then press Try again.",
    ],
  },
  unsupported: {
    title: "This browser cannot give your location",
    steps: [
      "Open the system in Chrome or Safari on your phone, at the usual https:// address.",
      "If it keeps failing, ask HR to record your attendance.",
    ],
  },
};

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

export default function AttendancePage() {
  const [record, setRecord] = useState<AttendanceRecord | null>(null);
  // The branch on the employee's record; attendance never asks for one.
  const [branch, setBranch] = useState("");
  const [assignedBranches, setAssignedBranches] = useState<string[]>([]);
  // The branch's office location is saved, so clocking in sends the phone's location.
  const [locationSet, setLocationSet] = useState(false);
  // The administrator's reason when today is marked as a non-working day; clocking is closed while set.
  const [closedReason, setClosedReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  // Clocking in found no location: the page asks to turn it on, and clocks in only once the location comes through.
  const [locationProblem, setLocationProblem] = useState<LocationProblem | null>(null);
  const [now, setNow] = useState(() => new Date());
  // Server time minus device time. Clock-in times come from the server, so the clock and progress run on its time:
  // a device clock a few minutes slow would otherwise keep the shift short of 100% at 5 PM.
  const [clockOffset, setClockOffset] = useState(0);

  const loadAttendance = async () => {
    try {
      const sentAt = Date.now();
      const response = await fetch("/api/attendance", { cache: "no-store" });
      const result = await response.json();
      if (typeof result.serverTime === "number") setClockOffset(result.serverTime - (sentAt + Date.now()) / 2);

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to load attendance.");
      }

      setRecord(result.record ?? null);
      setBranch(result.record?.branch || result.assignedBranch || "");
      setAssignedBranches(result.assignedBranches ?? []);
      setLocationSet(Boolean(result.branchLocationSet));
      setClosedReason(result.nonWorkingDay ? result.nonWorkingDay.reason || "Non-working day" : "");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load attendance.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date(Date.now() + clockOffset)), 1000);
    return () => window.clearInterval(timer);
  }, [clockOffset]);

  useEffect(() => {
    const loadPage = async () => {
      await loadAttendance();
    };

    void loadPage();
  }, []);

  // Live updates: an administrator's correction (e.g. a voided clock-out, so the clock resumes) shows without a reload.
  useLiveRefresh(["attendance"], loadAttendance);

  // The session pauses during the 12:00–13:00 lunch break, which is not worked time. Regular time stops at 17:00;
  // total time runs on to clock-out (overtime included).
  const { regularSeconds, totalSeconds } = useMemo(() => {
    if (!record?.timeIn) return { regularSeconds: 0, totalSeconds: 0 };
    const start = timeToSeconds(record.timeIn);
    const end = record.timeOut ? timeToSeconds(record.timeOut) : currentPhilippineSeconds(now);
    const working = (to: number) => {
      const lunch = Math.max(0, Math.min(to, timeToMinutes(BREAK_END) * 60) - Math.max(start, timeToMinutes(BREAK_START) * 60));
      return Math.max(0, to - start - lunch);
    };
    const scheduledEnd = timeToMinutes(record.scheduledTimeOut || SCHEDULED_TIME_OUT) * 60;
    return { regularSeconds: working(Math.min(end, scheduledEnd)), totalSeconds: working(end) };
  }, [now, record]);

  // A finished day uses the clock times, so a day saved before the lunch-break rule also leaves the break out.
  const finished = record?.timeOut ? dayTotals(record.timeIn, record.timeOut, record.scheduledTimeOut) : null;
  const regularHours = finished ? finished.regularHours : Number((regularSeconds / 3600).toFixed(2));
  const totalHours = finished ? finished.totalHours : Number((totalSeconds / 3600).toFixed(2));
  const overtimeHours = Math.max(0, Number((totalHours - regularHours).toFixed(2)));
  const trackedHours = regularHours;
  const progress = Math.min(100, (trackedHours / SHIFT_HOURS) * 100);
  const isClockedIn = Boolean(record?.timeIn && !record.timeOut);
  const isComplete = Boolean(record?.timeOut);

  const submitAttendance = async (action: "time-in" | "time-out") => {
    setMessage("");
    if (action === "time-in" && !branch) {
      setMessage("No branch is assigned to you yet. Ask HR or an administrator to assign one in Employees.");
      return;
    }

    setSubmitting(true);
    try {
      if (action === "time-in" && locationSet) setMessage("Getting your location...");
      const location = action === "time-in" && locationSet ? await devicePosition() : undefined;
      if (location && "problem" in location) {
        setLocationProblem(location.problem);
        setMessage("");
        return;
      }
      setLocationProblem(null);
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, location }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        // The server also refuses a clock-in without location (an older page, or a reading it could not use).
        if (result.needsLocation) { setLocationProblem("off"); setMessage(""); return; }
        throw new Error(result.message || "Unable to update attendance.");
      }

      setRecord(result.record);
      setMessage(result.message);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to update attendance.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-7xl items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border bg-white/80 px-5 py-4 shadow-sm">
          <Clock3 className="size-5 animate-pulse text-violet-60" />
          <p className="text-sm font-medium text-muted-foreground">
            Loading attendance...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-md bg-purple-95 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-purple-60">
              HR Portal
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              Employee Attendance &amp; Time Tracking
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-violet-10">
            Attendance
          </h1>
        </div>

        <div className="inline-flex items-center gap-2 self-start rounded-2xl border bg-white/80 px-4 py-2.5 text-sm font-bold text-violet-10 shadow-sm sm:self-auto">
          <CalendarDays className="size-4 text-violet-60" />
          {formatDate(now)}
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-12">
        <div className="relative overflow-hidden rounded-3xl border bg-white p-6 shadow-[0_4px_20px_-2px_rgb(45_28_89_/_0.05)] sm:p-8 lg:col-span-7">
          <div className="pointer-events-none absolute -right-16 -top-16 size-72 rounded-full bg-accent-lime/15 blur-3xl" />

          <div className="relative flex h-full flex-col justify-between">
            <div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Badge
                  variant="outline"
                  className="w-fit gap-2 rounded-full border-violet-90 bg-violet-95 px-3 py-1.5 text-violet-10"
                >
                  <span
                    className={`size-2.5 rounded-full ${
                      isClockedIn
                        ? "animate-pulse bg-accent-lime"
                        : isComplete
                          ? "bg-violet-60"
                          : "bg-violet-80"
                    }`}
                  />
                  {isClockedIn
                    ? "Currently Clocked In"
                    : isComplete
                      ? "Attendance Complete"
                      : closedReason
                        ? "Attendance Closed"
                        : "Ready to Clock In"}
                </Badge>

                <div className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-40">
                  <MapPin className="size-4 text-violet-60" />
                  {record?.branch || branch || (loading ? "Loading branch..." : "No branch assigned")}
                </div>
              </div>

              <div className="my-9 text-center">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-violet-40">
                  Philippine Standard Time
                </p>
                <p className="font-mono text-4xl font-black tracking-tight text-violet-10 sm:text-6xl">
                  {formatClock(now)}
                </p>

                {record?.timeIn && (
                  <div className="mt-5 inline-flex items-center gap-3 rounded-2xl border border-violet-90 bg-violet-95/80 px-4 py-2">
                    <span className="text-xs font-semibold text-violet-40">
                      {isComplete ? "Total Session" : "Active Session"}
                    </span>
                    <span className="font-mono text-base font-black text-violet-60 sm:text-lg">
                      {formatDuration(totalSeconds)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {closedReason && !isComplete && (
                <div className="flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>Attendance is closed today: {closedReason}</span>
                </div>
              )}

              {!record?.timeIn && (
                <div className="space-y-2 rounded-2xl border border-violet-90 bg-violet-95/40 p-4">
                  <p className="flex items-center gap-2 text-sm font-bold text-violet-10">
                    <Building2 className="size-4 text-violet-60" />
                    Your branch
                  </p>
                  <p className="text-base font-semibold text-violet-10">{branch || (loading ? "Loading..." : "No branch assigned")}</p>
                  {assignedBranches.length > 1 && <p className="text-sm text-violet-40" title={assignedBranches.join(", ")}>
                    Assigned to {assignedBranches.slice(0, 3).join(", ")}{assignedBranches.length > 3 ? ` and ${assignedBranches.length - 3} more` : ""}
                  </p>}
                  <p className="text-xs text-violet-40">{branch ? (assignedBranches.length > 1 ? `You clock in at ${branch}, your primary branch. HR updates it in Employees.` : "Taken from your employee record. HR updates it in Employees.") : "Ask HR or an administrator to assign your branch before clocking in."}</p>
                </div>
              )}

              {!record?.timeIn ? (
                <Button
                  type="button"
                  size="lg"
                  className="h-14 w-full rounded-2xl text-base font-extrabold shadow-[0_10px_25px_-5px_rgb(105_51_255_/_0.35)]"
                  disabled={submitting || loading || !branch || Boolean(closedReason)}
                  onClick={() => void submitAttendance("time-in")}
                >
                  <LogIn className="size-5" />
                  {submitting ? "Clocking In..." : "Clock In"}
                </Button>
              ) : !record.timeOut ? (
                <Button
                  type="button"
                  size="lg"
                  className="h-14 w-full rounded-2xl text-base font-extrabold shadow-[0_10px_25px_-5px_rgb(105_51_255_/_0.35)]"
                  disabled={submitting}
                  onClick={() => void submitAttendance("time-out")}
                >
                  <LogOut className="size-5" />
                  {submitting ? "Clocking Out..." : "Clock Out"}
                </Button>
              ) : (
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-accent-lime/60 bg-accent-lime/15 p-4 text-sm font-bold text-accent-moss">
                  <CheckCircle2 className="size-5" />
                  Your attendance for today is complete.
                </div>
              )}

              {!record?.timeIn && locationProblem && (
                <div role="alert" className="space-y-2 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
                  <p className="flex items-center gap-2 font-bold"><MapPin className="size-4 shrink-0" />Turn on your location to clock in</p>
                  <p className="font-semibold">{locationHelp[locationProblem].title}.</p>
                  <ul className="list-disc space-y-1 pl-5">{locationHelp[locationProblem].steps.map((step) => <li key={step}>{step}</li>)}</ul>
                  <Button type="button" variant="outline" className="w-full border-red-300 bg-white text-red-900 hover:bg-red-100" disabled={submitting} onClick={() => void submitAttendance("time-in")}>
                    {submitting ? "Checking your location..." : "Try again"}
                  </Button>
                </div>
              )}

              {!record?.timeIn && locationSet && !locationProblem && (
                <p className="text-xs text-violet-40">Your branch checks your location when you clock in, so your location must be on. Allow location when your phone asks; a clock-in away from your main branch or at another of your branches is sent to HR for review.</p>
              )}

              {message && (
                <div className="flex items-start gap-2 rounded-xl bg-violet-95 px-4 py-3 text-sm text-violet-40">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-violet-60" />
                  {message}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5 lg:col-span-5">
          <div className="rounded-3xl border bg-white p-6 shadow-[0_4px_20px_-2px_rgb(45_28_89_/_0.05)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-bold text-violet-10">Shift Progress</h2>
              <span className="rounded-full bg-violet-95 px-2.5 py-1 text-xs font-bold text-violet-60">
                {Math.round(progress)}% completed
              </span>
            </div>
            <div className="h-4 overflow-hidden rounded-full border border-violet-90 bg-violet-95 p-0.5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-60 via-purple-60 to-accent-lime transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-3 flex justify-between text-[11px] font-semibold text-violet-40">
              <span>{record?.timeIn ? `Started ${record.timeIn}` : "Not started"}</span>
              <span>{SHIFT_HOURS} working hours</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <StatCard
              icon={<Clock3 className="size-4" />}
              label="Regular Hours"
              value={regularHours.toFixed(2)}
              suffix={`/ ${SHIFT_HOURS} hrs · to 5 PM`}
              tone="violet"
            />
            <StatCard
              icon={<CheckCircle2 className="size-4" />}
              label="Total Hours"
              value={totalHours.toFixed(2)}
              suffix={`incl. ${overtimeHours.toFixed(2)} hrs overtime`}
              tone="violet"
            />
            <StatCard
              icon={<Timer className="size-4" />}
              label="Late"
              value={String(record?.lateMinutes ?? 0)}
              suffix="minutes"
              tone="purple"
            />
            <StatCard
              icon={<LogOut className="size-4" />}
              label="Undertime"
              value={String(record?.undertimeMinutes ?? 0)}
              suffix="minutes"
              tone="lime"
            />
          </div>
        </div>
      </section>

      <section className="rounded-3xl border bg-white p-6 shadow-[0_4px_20px_-2px_rgb(45_28_89_/_0.05)] sm:p-8">
        <div className="mb-6 flex flex-col gap-2 border-b border-violet-90 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-violet-10">Today&apos;s Activity</h2>
            <p className="mt-1 text-xs text-violet-40">
              Your recorded clock entries and attendance result for today.
            </p>
          </div>
          {record && <Badge className="w-fit">{record.status}</Badge>}
        </div>

        {record?.timeIn ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="border-b border-violet-90 text-[11px] font-bold uppercase tracking-wider text-violet-40">
                  <th className="px-3 pb-3">Time &amp; action</th>
                  <th className="px-3 pb-3">Branch</th>
                  <th className="px-3 pb-3">Status</th>
                  <th className="px-3 pb-3 text-right">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-violet-90 text-sm">
                <ActivityRow
                  action="Clock In"
                  time={record.timeIn}
                  branch={record.branch}
                  status={record.lateMinutes > 0 ? `${record.lateMinutes} min late` : record.timeIn <= SCHEDULED_TIME_IN ? "Early" : "On time"}
                  icon={<LogIn className="size-4" />}
                  tone="lime"
                />
                {record.timeOut && (
                  <ActivityRow
                    action="Clock Out"
                    time={record.timeOut}
                    branch={record.branch}
                    status={
                      record.undertimeMinutes > 0
                        ? `${record.undertimeMinutes} min undertime`
                        : "Completed"
                    }
                    icon={<LogOut className="size-4" />}
                    tone="violet"
                    duration={`${regularHours.toFixed(2)} regular · ${totalHours.toFixed(2)} total hrs`}
                  />
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-violet-90 bg-violet-95/30 px-5 py-10 text-center">
            <Clock3 className="mb-3 size-8 text-violet-70" />
            <p className="font-bold text-violet-10">No attendance activity yet</p>
            <p className="mt-1 text-sm text-violet-40">
              Clock in to begin today&apos;s record.
            </p>
          </div>
        )}
      </section>

      <MyAttendanceHistory />

      <AttendanceCalendar />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  suffix,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix: string;
  tone: "violet" | "purple" | "lime";
}) {
  const tones = {
    violet: "bg-violet-95 text-violet-60",
    purple: "bg-purple-95 text-purple-60",
    lime: "bg-accent-lime/25 text-accent-moss",
  };

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-[0_4px_20px_-2px_rgb(45_28_89_/_0.05)]">
      <div className={`mb-3 flex size-9 items-center justify-center rounded-xl ${tones[tone]}`}>
        {icon}
      </div>
      <p className="text-xs font-medium text-violet-40">{label}</p>
      <p className="mt-1 text-2xl font-black text-violet-10">
        {value}{" "}
        <span className="text-xs font-normal text-violet-40">{suffix}</span>
      </p>
    </div>
  );
}

function ActivityRow({
  action,
  time,
  branch,
  status,
  icon,
  tone,
  duration = "Active session",
}: {
  action: string;
  time: string;
  branch: string;
  status: string;
  icon: React.ReactNode;
  tone: "violet" | "lime";
  duration?: string;
}) {
  return (
    <tr className="transition-colors hover:bg-violet-95/40">
      <td className="px-3 py-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex size-9 items-center justify-center rounded-lg ${
              tone === "lime"
                ? "bg-accent-lime/25 text-accent-moss"
                : "bg-violet-95 text-violet-60"
            }`}
          >
            {icon}
          </div>
          <div>
            <p className="font-bold text-violet-10">{time}</p>
            <p className="text-[11px] text-violet-40">{action}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-4 font-semibold text-violet-10">{branch}</td>
      <td className="px-3 py-4">
        <span className="rounded-full bg-violet-95 px-2.5 py-1 text-[11px] font-bold text-violet-60">
          {status}
        </span>
      </td>
      <td className="px-3 py-4 text-right text-xs font-medium text-violet-40">
        {duration}
      </td>
    </tr>
  );
}
