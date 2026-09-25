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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Branch = {
  id: string;
  name: string;
  status: "active" | "inactive";
};

type AttendanceRecord = {
  attendanceDate: string;
  branch: string;
  timeIn: string;
  timeOut: string;
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
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: PHILIPPINE_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
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

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

export default function AttendancePage() {
  const [record, setRecord] = useState<AttendanceRecord | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branch, setBranch] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(() => new Date());

  const loadAttendance = async () => {
    try {
      const response = await fetch("/api/attendance", { cache: "no-store" });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to load attendance.");
      }

      setRecord(result.record ?? null);
      if (result.record?.branch) setBranch(result.record.branch);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load attendance.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadPage = async () => {
      try {
        const response = await fetch("/api/branches", { cache: "no-store" });
        const result = await response.json();
        if (response.ok && result.success) {
          setBranches(
            (result.branches ?? []).filter(
              (item: Branch) => item.status === "active",
            ),
          );
        }
      } catch {
        setBranches([]);
      }

      await loadAttendance();
    };

    void loadPage();
  }, []);

  const activeSeconds = useMemo(() => {
    if (!record?.timeIn) return 0;
    if (record.timeOut) {
      return Math.max(
        0,
        timeToSeconds(record.timeOut) - timeToSeconds(record.timeIn),
      );
    }
    return Math.max(
      0,
      currentPhilippineSeconds(now) - timeToSeconds(record.timeIn),
    );
  }, [now, record]);

  const trackedHours = record?.timeOut
    ? record.workedHours
    : Number((activeSeconds / 3600).toFixed(2));
  const progress = Math.min(100, (trackedHours / SHIFT_HOURS) * 100);
  const isClockedIn = Boolean(record?.timeIn && !record.timeOut);
  const isComplete = Boolean(record?.timeOut);

  const submitAttendance = async (action: "time-in" | "time-out") => {
    setMessage("");
    if (action === "time-in" && !branch) {
      setMessage("Select your branch first.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, branch }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
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
                      : "Ready to Clock In"}
                </Badge>

                <div className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-40">
                  <MapPin className="size-4 text-violet-60" />
                  {record?.branch || branch || "Select your branch"}
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
                      {formatDuration(activeSeconds)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {!record?.timeIn && (
                <div className="space-y-2 rounded-2xl border border-violet-90 bg-violet-95/40 p-4">
                  <Label className="flex items-center gap-2 font-bold text-violet-10">
                    <Building2 className="size-4 text-violet-60" />
                    Work branch
                  </Label>
                  <Select
                    value={branch}
                    onValueChange={(value) => setBranch(value ?? "")}
                    disabled={submitting}
                  >
                    <SelectTrigger className="w-full bg-white">
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((item) => (
                        <SelectItem key={item.id} value={item.name}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {!record?.timeIn ? (
                <Button
                  type="button"
                  size="lg"
                  className="h-14 w-full rounded-2xl text-base font-extrabold shadow-[0_10px_25px_-5px_rgb(105_51_255_/_0.35)]"
                  disabled={submitting}
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
              label="Hours Tracked"
              value={trackedHours.toFixed(2)}
              suffix={`/ ${SHIFT_HOURS} hrs`}
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
            <StatCard
              icon={<CheckCircle2 className="size-4" />}
              label="Overtime"
              value={(record?.overtimeHours ?? 0).toFixed(2)}
              suffix="hours"
              tone="violet"
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
                  status={record.lateMinutes > 0 ? `${record.lateMinutes} min late` : "On time"}
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
                    duration={`${record.workedHours.toFixed(2)} hrs worked`}
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
              Select your branch and clock in to begin today&apos;s record.
            </p>
          </div>
        )}
      </section>
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
