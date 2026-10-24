"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";

import { promptDialog } from "@/components/app-dialog";
import { Button } from "@/components/ui/button";
import { clockInLabel, formatDistance } from "@/lib/clock-in-location";

/** The clock-in location check as the attendance APIs send it (lib/clock-in-checks.ts ClockInCheck). */
export type LocationCheck = {
  result: "Inside" | "Outside" | "No location" | "Not set";
  distanceM: number | null; radiusM: number | null; accuracyM: number | null; deviceNote: string;
  needsReview: boolean; reviewStatus: "Accepted" | "Absent" | ""; reviewNote: string; reviewedBy: string;
};

/**
 * The location flag on a clock-in (Daily board, Attendance Review). Outside and Location off wait for HR: Accept keeps
 * the day Present, Mark absent makes it Absent with a reason (app/api/attendance-tracking/location). Inside shows a
 * quiet note; Not set shows nothing.
 */
export function ClockInLocationFlag({ check, employeeId, employeeName, attendanceDate, canReview, onChanged }: {
  check: LocationCheck | null; employeeId: string; employeeName: string; attendanceDate: string; canReview: boolean; onChanged: (message: string) => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!check || check.result === "Not set") return null;
  if (check.result === "Inside") return <div className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-700"><MapPin className="size-3" />{clockInLabel(check)}</div>;

  const detail = [
    check.radiusM ? `Allowed ${formatDistance(check.radiusM)}` : "",
    check.accuracyM != null ? `phone accurate to about ${formatDistance(check.accuracyM)}` : "",
    check.deviceNote,
  ].filter(Boolean).join(" · ");

  async function decide(decision: "Accepted" | "Absent") {
    const note = await promptDialog(decision === "Absent"
      ? `Mark ${employeeName} Absent for ${attendanceDate}? ${clockInLabel(check!)}. The clock times are kept, but payroll counts the day as an absence.\n\nGive the reason:`
      : `Accept the clock-in of ${employeeName}? ${clockInLabel(check!)}. The day stays Present.\n\nNote (optional):`,
      { required: decision === "Absent", confirmLabel: decision === "Absent" ? "Mark absent" : "Accept", danger: decision === "Absent", placeholder: decision === "Absent" ? "e.g. Clocked in from home" : "e.g. Field visit approved by the branch head" });
    if (note === null || note === undefined) return;
    if (decision === "Absent" && !note.trim()) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/attendance-tracking/location", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId, attendanceDate, decision, note }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to save the review.");
      await onChanged(result.message);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to save the review."); }
    finally { setSaving(false); }
  }

  const reviewed = check.reviewStatus
    ? `${check.reviewStatus === "Absent" ? "Marked absent" : "Accepted"} by ${check.reviewedBy}${check.reviewNote ? `: ${check.reviewNote}` : ""}`
    : "";
  return <div className="mt-1 space-y-1">
    <div className={`inline-flex items-center gap-1 rounded px-1.5 text-xs font-medium ${check.reviewStatus === "Accepted" ? "bg-muted text-muted-foreground" : "bg-red-100 text-red-800"}`} title={detail}>
      <MapPin className="size-3" />{clockInLabel(check)}{check.needsReview ? " · needs review" : ""}
    </div>
    {reviewed && <div className="text-xs text-muted-foreground">{reviewed}</div>}
    {canReview && <div className="flex flex-wrap gap-1.5 print:hidden">
      {check.reviewStatus !== "Accepted" && <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={saving} onClick={() => void decide("Accepted")}>Accept</Button>}
      {check.reviewStatus !== "Absent" && <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs text-destructive" disabled={saving} onClick={() => void decide("Absent")}>Mark absent</Button>}
    </div>}
    {error && <div role="alert" className="text-xs text-red-700">{error}</div>}
  </div>;
}
