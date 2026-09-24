"use client";

import {
  useEffect,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export default function AttendancePage() {
  const [record, setRecord] =
    useState<AttendanceRecord | null>(null);

  const [branches, setBranches] = useState<Branch[]>(
    [],
  );

  const [branch, setBranch] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const loadAttendance = async () => {
    try {
      const response = await fetch("/api/attendance", {
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Unable to load attendance.",
        );
      }

      setRecord(result.record ?? null);

      if (result.record?.branch) {
        setBranch(result.record.branch);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load attendance.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadPage = async () => {
      try {
        const response = await fetch("/api/branches", {
          cache: "no-store",
        });

        const result = await response.json();

        if (response.ok && result.success) {
          setBranches(
            (result.branches ?? []).filter(
              (item: Branch) =>
                item.status === "active",
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

  const submitAttendance = async (
    action: "time-in" | "time-out",
  ) => {
    setMessage("");

    if (action === "time-in" && !branch) {
      setMessage("Select your branch first.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          branch,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Unable to update attendance.",
        );
      }

      setRecord(result.record);
      setMessage(result.message);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update attendance.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">
        Loading attendance...
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Attendance
        </h1>

        <p className="text-sm text-muted-foreground">
          Clock in and clock out for today.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            Today&apos;s Attendance

            {record && (
              <Badge>
                {record.status}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-5">
          {!record?.timeIn && (
            <div className="space-y-2">
              <Label>Branch *</Label>

              <Select
                value={branch}
                onValueChange={(value) =>
                  setBranch(value ?? "")
                }
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>

                <SelectContent>
                  {branches.map((item) => (
                    <SelectItem
                      key={item.id}
                      value={item.name}
                    >
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {record && (
            <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">
                  Date
                </p>
                <p className="font-medium">
                  {record.attendanceDate}
                </p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">
                  Branch
                </p>
                <p className="font-medium">
                  {record.branch}
                </p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">
                  Time In
                </p>
                <p className="font-medium">
                  {record.timeIn || "—"}
                </p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">
                  Time Out
                </p>
                <p className="font-medium">
                  {record.timeOut || "—"}
                </p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">
                  Late
                </p>
                <p className="font-medium">
                  {record.lateMinutes} minute(s)
                </p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">
                  Undertime
                </p>
                <p className="font-medium">
                  {record.undertimeMinutes} minute(s)
                </p>
              </div>

              {record.timeOut && (
                <>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Worked Hours
                    </p>
                    <p className="font-medium">
                      {record.workedHours}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-muted-foreground">
                      Overtime Hours
                    </p>
                    <p className="font-medium">
                      {record.overtimeHours}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {message && (
            <p className="text-sm text-muted-foreground">
              {message}
            </p>
          )}

          <div className="flex gap-3">
            {!record?.timeIn ? (
              <Button
                type="button"
                disabled={submitting}
                onClick={() =>
                  void submitAttendance("time-in")
                }
              >
                {submitting
                  ? "Clocking In..."
                  : "Clock In"}
              </Button>
            ) : !record.timeOut ? (
              <Button
                type="button"
                disabled={submitting}
                onClick={() =>
                  void submitAttendance("time-out")
                }
              >
                {submitting
                  ? "Clocking Out..."
                  : "Clock Out"}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Your attendance for today is complete.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}