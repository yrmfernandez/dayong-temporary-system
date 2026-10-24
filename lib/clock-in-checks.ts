import { eq, inArray } from "drizzle-orm";

import { currentDb, schema } from "@/lib/db";
import { checkClockIn, needsReview, type ClockInResult, type DevicePosition, type ReviewStatus } from "@/lib/clock-in-location";
import { getBranches } from "@/lib/google-sheets-data";

const table = schema.clock_in_checks;

/** What the attendance pages show next to a clock-in. */
export type ClockInCheck = {
  attendanceId: string;
  result: ClockInResult;
  distanceM: number | null;
  radiusM: number | null;
  accuracyM: number | null;
  deviceNote: string;
  needsReview: boolean;
  reviewStatus: ReviewStatus | "";
  reviewNote: string;
  reviewedBy: string;
  reviewedAt: string;
};

const toCheck = (row: typeof table.$inferSelect): ClockInCheck => ({
  attendanceId: row.attendance_id, result: row.result as ClockInResult, distanceM: row.distance_m, radiusM: row.radius_m, accuracyM: row.accuracy_m,
  deviceNote: row.device_note ?? "", needsReview: needsReview(row.result) && !row.review_status,
  reviewStatus: (row.review_status ?? "") as ReviewStatus | "", reviewNote: row.review_note ?? "", reviewedBy: row.reviewed_by_name ?? "", reviewedAt: row.reviewed_at ?? "",
});

/** Reads the position the clock-in page sent: coordinates, or the reason the phone gave none. */
export function readDevicePosition(value: unknown): DevicePosition | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.error === "string") return { error: body.error.slice(0, 200) };
  const latitude = Number(body.latitude), longitude = Number(body.longitude), accuracy = Number(body.accuracy);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude, accuracy: Number.isFinite(accuracy) ? accuracy : null } : null;
}

/**
 * Compares a clock-in with its branch's saved location and keeps the result (one row per attendance record; a new
 * clock-in for the same record replaces it). Returns the check, or null when it could not be saved.
 */
export async function recordClockInCheck(input: { attendanceId: string; employeeId: string; attendanceDate: string; branchName: string; position: DevicePosition | null }) {
  const branch = (await getBranches()).find((item) => item.name.trim().toLowerCase() === input.branchName.trim().toLowerCase());
  const outcome = checkClockIn({ latitude: branch?.latitude ?? null, longitude: branch?.longitude ?? null, radiusM: branch?.locationRadiusM ?? null }, input.position);
  const coordinates = input.position && !("error" in input.position) ? input.position : null;
  const values = {
    employee_id: input.employeeId, attendance_date: input.attendanceDate, branch_id: branch?.id ?? null, branch: input.branchName, result: outcome.result,
    latitude: coordinates?.latitude ?? null, longitude: coordinates?.longitude ?? null, accuracy_m: coordinates?.accuracy ?? null,
    distance_m: outcome.distanceM, radius_m: outcome.radiusM,
    device_note: input.position && "error" in input.position ? input.position.error : !input.position && outcome.result === "No location" ? "No location was sent." : null,
    checked_at: new Date().toISOString(), review_status: null, review_note: null, reviewed_by_name: null, reviewed_at: null,
  };
  const [row] = await currentDb().insert(table).values({ attendance_id: input.attendanceId, ...values })
    .onConflictDoUpdate({ target: table.attendance_id, set: values }).returning();
  return toCheck(row);
}

export async function getClockInChecks(attendanceIds: string[]) {
  const ids = [...new Set(attendanceIds.filter(Boolean))];
  if (!ids.length) return new Map<string, ClockInCheck>();
  const rows = await currentDb().select().from(table).where(inArray(table.attendance_id, ids));
  return new Map(rows.map((row) => [row.attendance_id, toCheck(row)]));
}

export async function getClockInCheck(attendanceId: string) {
  const [row] = await currentDb().select().from(table).where(eq(table.attendance_id, attendanceId));
  return row ? toCheck(row) : null;
}

export async function saveClockInReview(attendanceId: string, status: ReviewStatus, note: string, by: string) {
  await currentDb().update(table).set({ review_status: status, review_note: note || null, reviewed_by_name: by, reviewed_at: new Date().toISOString() })
    .where(eq(table.attendance_id, attendanceId));
}
