import { eq, sql } from "drizzle-orm";

import { currentDb, inTransaction, schema } from "@/lib/db";
import { EMPLOYEE_ID_FORMAT_MESSAGE, isEmployeeIdFormat, normalizeEmployeeId } from "@/lib/employee-id";
import { recordCorrection } from "@/lib/record-corrections";

/**
 * Changes an Employee ID everywhere it is used, for example to replace a temporary LEG-… ID with the real one.
 *
 * All in the database, in one transaction (upgrade #6, October 24, 2026): the employee row's new ID carries into every
 * linked table (ON UPDATE CASCADE), including the sign-in account (users), so the person signs in with the new ID; every
 * other column ending in employee_id (who saved a row, who received or decided a remittance) is rewritten; report notes
 * keys start with the ID and are rewritten too. The audit_log keeps the old ID as history; the change itself is logged
 * there (each edited row) and summarized in Record Corrections. Record IDs that merely contain the old ID (e.g. EBA-…,
 * ATT-…) are left as they are: they are labels, not links.
 */
const text = (value: unknown) => String(value ?? "").trim();
/** Rows of a raw query: postgres.js returns them as the result itself, PGlite (tests) under .rows. */
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];

export async function changeEmployeeId(oldIdRaw: string, newIdRaw: string, reason = "Employee ID corrected") {
  const oldId = text(oldIdRaw), newId = normalizeEmployeeId(newIdRaw);
  if (!oldId) throw new Error("Choose the employee.");
  if (!isEmployeeIdFormat(newId)) throw new Error(EMPLOYEE_ID_FORMAT_MESSAGE);
  if (newId === oldId.toUpperCase()) return { oldId, newId, changed: 0, bySheet: {} as Record<string, number> };

  const db = currentDb();
  const [employee] = await db.select({ id: schema.employees.employee_id }).from(schema.employees).where(sql`upper(${schema.employees.employee_id}) = ${oldId.toUpperCase()}`);
  if (!employee) throw new Error("Employee not found.");
  const [clash] = await db.select({ id: schema.employees.employee_id }).from(schema.employees).where(eq(schema.employees.employee_id, newId));
  if (clash) throw new Error(`Employee ID ${newId} is already used by another employee or account.`);

  // Report notes are renamed in the database below (report_notes, keyed "<employee>|<kind>|<start>|<branch>").
  // The database first, in one transaction: the employee row (linked tables follow), then every other employee_id column.
  const bySheet: Record<string, number> = {};
  await inTransaction(async (tx) => {
    await tx.update(schema.employees).set({ employee_id: newId }).where(eq(schema.employees.employee_id, employee.id));
    bySheet.employees = 1;
    const columns = rowsOf<{ table_name: string; column_name: string }>(await tx.execute(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and column_name like '%employee\\_id' and table_name not in ('employees', 'audit_log')`));
    for (const { table_name: table, column_name: column } of columns) {
      const count = rowsOf(await tx.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${newId} where ${sql.identifier(column)} = ${employee.id} returning 1`)).length;
      if (count) bySheet[table] = (bySheet[table] ?? 0) + count;
    }
    const noteCount = rowsOf(await tx.execute(sql`update report_notes set note_key = ${newId} || substr(note_key, ${employee.id.length + 1}) where note_key like ${`${employee.id}|%`} returning 1`)).length;
    if (noteCount) bySheet.report_notes = noteCount;
  });

  await recordCorrection("Employees", newId, reason, { employeeId: oldId }, { employeeId: newId, cellsChanged: bySheet });
  return { oldId, newId, changed: Object.values(bySheet).reduce((sum, count) => sum + count, 0), bySheet };
}
