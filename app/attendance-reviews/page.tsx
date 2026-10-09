"use client";

import { useEffect, useState } from "react";

import { AttendanceCalendar } from "@/components/attendance-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type AttendanceRecord = {
  status: "Present" | "Leave" | "Absent" | "AWOL" | "Non-working Day" | "Day Off" | "Not Required";
  timeIn: string;
  timeOut: string;
};

type EmployeeAttendance = {
  employeeId: string;
  fullName: string;
  branch: string;
  roles: string[];
  // The employee's branch is closed by the date's non-working day.
  closed: boolean;
  // Recorded Absent by the system at the end of the day because management did not mark it.
  systemAbsent: boolean;
  record: AttendanceRecord | null;
};

const MARKS = [
  { value: "Absent", label: "Absent" }, { value: "AWOL", label: "AWOL" }, { value: "Day Off", label: "Day Off" },
  { value: "Not Required", label: "No attendance needed" },
] as const;
type MarkStatus = typeof MARKS[number]["value"];

type NonWorkingDay = { reason: string; allBranches: boolean; branchNames: string[] };

function todayInPhilippines() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
  }).format(new Date());
}

export default function AttendanceReviewsPage() {
  const [attendanceDate, setAttendanceDate] = useState(
    todayInPhilippines(),
  );
  const [employees, setEmployees] = useState<EmployeeAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState("");
  const [message, setMessage] = useState("");
  const [nonWorkingDay, setNonWorkingDay] = useState<NonWorkingDay | null>(null);
  const [branchFilter, setBranchFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const branchChoices = [...new Set(employees.map((employee) => employee.branch).filter(Boolean))].sort();
  const roleChoices = [...new Set(employees.flatMap((employee) => employee.roles ?? []))].sort();
  const shown = employees.filter((employee) => (!branchFilter || employee.branch === branchFilter) && (!roleFilter || (employee.roles ?? []).includes(roleFilter)));
  // Ticked employees, marked together through the attendance board's bulk mark (POST /api/attendance-tracking/daily).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<MarkStatus>("Not Required");
  const [bulkNote, setBulkNote] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const isLocked = (employee: EmployeeAttendance) => Boolean(employee.closed || employee.record?.timeIn || employee.record?.timeOut || employee.record?.status === "Leave");
  const selectable = shown.filter((employee) => !isLocked(employee)).map((employee) => employee.employeeId);
  const chosen = selectable.filter((id) => selected.has(id));
  const sunday = new Date(`${attendanceDate}T00:00:00Z`).getUTCDay() === 0;
  const toggle = (ids: string[], on: boolean) => setSelected((current) => { const next = new Set(current); for (const id of ids) { if (on) next.add(id); else next.delete(id); } return next; });

  const loadReview = async () => {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/attendance-reviews?date=${encodeURIComponent(attendanceDate)}`,
        { cache: "no-store" },
      );
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to load attendance review.");
      }

      setEmployees(result.employees ?? []);
      setNonWorkingDay(result.nonWorkingDay ?? null);
    } catch (error) {
      setEmployees([]);
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load attendance review.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load; loading state is already set
    void loadReview();
  }, []);
  // Live updates: reload when another user saves (lib/use-live-refresh.ts).
  useLiveRefresh(["attendance", "leave_requests", "holidays"], loadReview);

  const markAttendance = async (
    employeeId: string,
    status: "Absent" | "AWOL" | "Day Off" | "Not Required",
  ) => {
    setUpdatingId(employeeId);
    setMessage("");

    try {
      const response = await fetch("/api/attendance-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, attendanceDate, status }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to update attendance.");
      }

      setMessage(result.message);
      await loadReview();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update attendance.",
      );
    } finally {
      setUpdatingId("");
    }
  };

  const markSelected = async () => {
    if (!chosen.length) return;
    setBulkSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/attendance-tracking/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendanceDate, employeeIds: chosen, status: bulkStatus, notes: bulkNote }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to mark attendance.");
      const skipped = (result.skipped ?? []) as Array<{ employeeId: string; reason: string }>;
      setSelected(new Set());
      setBulkNote("");
      await loadReview();
      setMessage(`${result.message}${skipped.length ? ` ${skipped.slice(0, 5).map((item) => `${item.employeeId} (${item.reason})`).join(", ")}${skipped.length > 5 ? ", …" : ""}` : ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to mark attendance.");
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Attendance Review
        </h1>
        <p className="text-sm text-muted-foreground">
          Mark a missing attendance as Absent or AWOL, give an employee the Day Off (not counted as absent in payroll; they cannot clock in that day), or mark No attendance needed for someone who does not have to clock in that day, such as MAS (not counted as absent; a clock-in replaces it). To mark many at once, tick them (or Select all after filtering by branch or role) and use Mark selected. Clocked attendance and approved leave cannot be changed here. Anyone still unmarked after 11:59 PM is recorded Absent by the system and shown as &quot;Absent · by system&quot;; marking them here replaces it.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily Attendance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="attendance-date">Date</Label>
              <Input
                id="attendance-date"
                type="date"
                value={attendanceDate}
                onChange={(event) => { setAttendanceDate(event.target.value); setSelected(new Set()); }}
              />
            </div>
            <Button type="button" onClick={() => void loadReview()} disabled={loading}>
              {loading ? "Loading..." : "Load Attendance"}
            </Button>
            <div className="space-y-2">
              <Label htmlFor="attendance-branch">Branch</Label>
              <select id="attendance-branch" className="h-9 rounded-md border bg-background px-3 text-sm" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
                <option value="">All branches</option>
                {branchChoices.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="attendance-role">Role</Label>
              <select id="attendance-role" className="h-9 rounded-md border bg-background px-3 text-sm" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                <option value="">All roles</option>
                {roleChoices.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </div>
          </div>

          {nonWorkingDay && (
            <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Non-working day for {nonWorkingDay.allBranches ? "all branches" : nonWorkingDay.branchNames.join(", ")}: {nonWorkingDay.reason}. Manage it in the calendar below.
            </p>
          )}

          {message && (
            <p className="text-sm text-muted-foreground">{message}</p>
          )}

          {!loading && !message && employees.length === 0 && (
            <p className="text-sm text-muted-foreground">No active employee accounts found.</p>
          )}

          {!loading && !nonWorkingDay?.allBranches && employees.length > 0 && !sunday && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" aria-label="Select all shown" checked={selectable.length > 0 && chosen.length === selectable.length} disabled={!selectable.length} onChange={(event) => toggle(selectable, event.target.checked)} />
                  Select all ({selectable.length})
                </label>
                <span className="text-sm text-muted-foreground">{chosen.length} selected</span>
                {chosen.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>}
                {!selectable.length && <span className="text-xs text-muted-foreground">Everyone shown has clocked in, is on leave, or their branch is closed.</span>}
              </div>
              <div className="grid gap-3 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
                <div className="space-y-1">
                  <Label htmlFor="bulk-status">Mark selected as</Label>
                  <select id="bulk-status" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as MarkStatus)}>
                    {MARKS.map((mark) => <option key={mark.value} value={mark.value}>{mark.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bulk-note">Note (optional)</Label>
                  <Input id="bulk-note" maxLength={200} placeholder={bulkStatus === "Not Required" ? "e.g. MAS field work, no clock-in required" : "e.g. No call, no show"} value={bulkNote} onChange={(event) => setBulkNote(event.target.value)} />
                </div>
                <Button type="button" disabled={bulkSaving || !chosen.length} onClick={() => void markSelected()}>
                  {bulkSaving ? "Marking..." : `Mark ${chosen.length} as ${MARKS.find((mark) => mark.value === bulkStatus)?.label}`}
                </Button>
              </div>
            </div>
          )}

          {!loading && !nonWorkingDay?.allBranches && employees.length > 0 && (
            <div className="divide-y rounded-lg border">
              {shown.length === 0 && <p className="p-4 text-sm text-muted-foreground">No employee matches this branch and role.</p>}
              {shown.map((employee) => {
                const locked = isLocked(employee);

                return (
                  <div
                    key={employee.employeeId}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <label className="flex items-start gap-3">
                      <input type="checkbox" className="mt-1.5" aria-label={`Select ${employee.fullName || employee.employeeId}`} disabled={locked || sunday} checked={!locked && selected.has(employee.employeeId)} onChange={(event) => toggle([employee.employeeId], event.target.checked)} />
                      <span>
                        <span className="block font-medium">{employee.fullName || employee.employeeId}</span>
                        <span className="block text-sm text-muted-foreground">{employee.employeeId}{employee.branch ? ` · ${employee.branch}` : ""}</span>
                      </span>
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={employee.record?.status === "Present" ? "default" : "secondary"}>
                        {employee.closed ? "Branch closed" : employee.systemAbsent ? "Absent · by system" : employee.record?.status === "Not Required" ? "No attendance needed" : employee.record?.status || "No record"}
                      </Badge>
                      {!locked && (
                        <select
                          aria-label={`Mark ${employee.fullName || employee.employeeId} as`}
                          className="h-8 rounded-md border bg-background px-2 text-sm"
                          value=""
                          disabled={updatingId === employee.employeeId}
                          onChange={(event) => event.target.value && void markAttendance(employee.employeeId, event.target.value as MarkStatus)}
                        >
                          <option value="">{updatingId === employee.employeeId ? "Saving..." : "Mark as..."}</option>
                          {MARKS.filter((mark) => mark.value !== employee.record?.status || employee.systemAbsent).map((mark) => <option key={mark.value} value={mark.value}>{mark.label}</option>)}
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AttendanceCalendar onClosuresChanged={() => void loadReview()} />
    </div>
  );
}
