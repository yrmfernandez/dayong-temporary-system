import { and, eq } from "drizzle-orm";

import { currentDb, schema } from "@/lib/db";
import { getBranches } from "@/lib/google-sheets-data";
import type { DeclaredDay, WorkCalendar } from "@/lib/working-days";

/**
 * The declared non-working days (attendance calendar: SYSTEM rows marked "Non-working Day", branch = "All branches" or
 * branch IDs), for the entry deadlines in lib/working-days.ts. Read straight from the table, not the whole attendance
 * sheet, and kept for a minute because every ledger and form check asks.
 */
let cached: { at: number; days: DeclaredDay[] } | null = null;

export async function declaredNonWorkingDays(): Promise<DeclaredDay[]> {
  if (cached && Date.now() - cached.at < 60_000) return cached.days;
  const { attendance } = schema;
  const [rows, branches] = await Promise.all([
    currentDb().select({ date: attendance.attendance_date, branch: attendance.branch }).from(attendance)
      .where(and(eq(attendance.employee_id, "SYSTEM"), eq(attendance.attendance_status, "Non-working Day"))),
    getBranches(),
  ]);
  const names = new Map(branches.map((branch) => [branch.id, branch.name]));
  const days = rows.filter((row) => row.date).map((row) => {
    const value = String(row.branch ?? "").trim();
    const all = !value || value === "All branches";
    return { date: String(row.date).slice(0, 10), allBranches: all, branchNames: all ? [] : value.split(",").map((id) => id.trim()).filter(Boolean).map((id) => names.get(id) ?? id) };
  });
  cached = { at: Date.now(), days };
  return days;
}

/** The calendar for entries of one branch. */
export async function loadWorkCalendar(branch = ""): Promise<WorkCalendar> {
  return { days: await declaredNonWorkingDays(), branch };
}
