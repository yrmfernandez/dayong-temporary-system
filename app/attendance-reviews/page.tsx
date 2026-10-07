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
  status: "Present" | "Leave" | "Absent" | "AWOL" | "Non-working Day" | "Day Off";
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
    status: "Absent" | "AWOL" | "Day Off",
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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Attendance Review
        </h1>
        <p className="text-sm text-muted-foreground">
          Mark a missing attendance as Absent or AWOL, or give an employee the Day Off (not counted as absent in payroll; they cannot clock in that day). Clocked attendance and approved leave cannot be changed here. Anyone still unmarked after 11:59 PM is recorded Absent by the system and shown as &quot;Absent · by system&quot;; marking them here replaces it.
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
                onChange={(event) => setAttendanceDate(event.target.value)}
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

          {!loading && !nonWorkingDay?.allBranches && employees.length > 0 && (
            <div className="divide-y rounded-lg border">
              {shown.length === 0 && <p className="p-4 text-sm text-muted-foreground">No employee matches this branch and role.</p>}
              {shown.map((employee) => {
                const locked = Boolean(
                  employee.closed ||
                    employee.record?.timeIn ||
                    employee.record?.timeOut ||
                    employee.record?.status === "Leave",
                );

                return (
                  <div
                    key={employee.employeeId}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">{employee.fullName || employee.employeeId}</p>
                      <p className="text-sm text-muted-foreground">{employee.employeeId}{employee.branch ? ` · ${employee.branch}` : ""}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={employee.record?.status === "Present" ? "default" : "secondary"}>
                        {employee.closed ? "Branch closed" : employee.systemAbsent ? "Absent · by system" : employee.record?.status || "No record"}
                      </Badge>
                      {!locked && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={updatingId === employee.employeeId}
                            onClick={() => void markAttendance(employee.employeeId, "Absent")}
                          >
                            Mark Absent
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={updatingId === employee.employeeId}
                            onClick={() => void markAttendance(employee.employeeId, "AWOL")}
                          >
                            Mark AWOL
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={updatingId === employee.employeeId || employee.record?.status === "Day Off"}
                            onClick={() => void markAttendance(employee.employeeId, "Day Off")}
                          >
                            Mark Day Off
                          </Button>
                        </>
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
