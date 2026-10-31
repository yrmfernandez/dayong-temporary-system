import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { currentDb, inTransaction, schema } from "@/lib/db";
import { recordCorrection } from "@/lib/record-corrections";
import { manilaNow } from "@/lib/remittance-deadline";

/**
 * Deactivating a program for one member (owner, October 17, 2026): the member no longer has the program. The account
 * is marked Deactivated (member_programs.status) with the reason, and stays in the member's history: its New Sale and
 * past collections remain in reports, but it takes no collections (Collections lists only active accounts and refuses
 * others) and leaves MAM, payment statuses, Follow Up, status sync and account counts (lib/account-data.ts leaves it
 * out; from the month after its deactivated_on, migration 0037). Administrators, HR Officers and IT (the same people who transfer members) do it from Members, and can
 * reactivate it the same way. Every change is kept in Record Corrections.
 */
export const DEACTIVATED = "Deactivated";
export const isDeactivated = (status: unknown) => String(status ?? "").trim().toLowerCase() === "deactivated";
const MODULE = "Program account status";
const text = (value: unknown) => String(value ?? "").trim();

/** Entries of the account still waiting on a remittance: they are settled before the account is deactivated. */
export async function pendingEntries(enrollmentId: string, memberNumber: string, programId: string) {
  const waiting = ["Outstanding", "Returned", "Pending Remittance Approval"];
  const [collections, sales] = await Promise.all([
    currentDb().select({ n: sql<number>`count(*)::int` }).from(schema.collections)
      .where(and(eq(schema.collections.enrollment_id, enrollmentId), eq(schema.collections.status, "Posted"), inArray(schema.collections.remittance_status, waiting))),
    currentDb().select({ n: sql<number>`count(*)::int` }).from(schema.sales)
      .where(and(eq(schema.sales.member_number, memberNumber), eq(schema.sales.program_id, programId), inArray(schema.sales.remittance_status, waiting))),
  ]);
  return Number(collections[0]?.n ?? 0) + Number(sales[0]?.n ?? 0);
}

export async function setAccountActive(input: { enrollmentId: string; active: boolean; reason: string }) {
  const enrollmentId = text(input.enrollmentId), reason = text(input.reason);
  if (reason.length < 3 || reason.length > 300) throw new Error(`Give the reason for ${input.active ? "reactivating" : "deactivating"} the program (3–300 characters).`);
  const result = await inTransaction(async (tx) => {
    const [account] = await tx.select().from(schema.member_programs).where(eq(schema.member_programs.enrollment_id, enrollmentId)).for("update");
    if (!account) throw new Error("Program account not found.");
    const was = text(account.status) || "Active";
    if (input.active && !isDeactivated(was)) throw new Error("This program is not deactivated.");
    if (!input.active && isDeactivated(was)) throw new Error("This program is already deactivated for the member.");
    if (!input.active) {
      const pending = await pendingEntries(enrollmentId, text(account.member_number), account.program_id);
      if (pending) throw new Error(`This program has ${pending} entr${pending === 1 ? "y" : "ies"} still waiting on a remittance (not yet remitted, returned or for approval). Settle ${pending === 1 ? "it" : "them"} first, then deactivate.`);
    }
    const status = input.active ? "Active" : DEACTIVATED;
    // The day matters for MAM (migration 0037): it counts the account in that month and stops from the next.
    await tx.update(schema.member_programs).set({ status, deactivated_on: input.active ? null : manilaNow().date }).where(eq(schema.member_programs.enrollment_id, enrollmentId));
    return { enrollmentId, memberNumber: text(account.member_number), programId: account.program_id, before: was, status };
  });
  // The change stands even if the correction log cannot be written; the Audit Log has it as well.
  await recordCorrection(MODULE, enrollmentId, reason, { status: result.before }, { status: result.status }).catch(() => {});
  return result;
}

/** The latest deactivation reason, who and when, for each deactivated account among `enrollmentIds`. */
export async function deactivationNotes(enrollmentIds: string[]) {
  const ids = [...new Set(enrollmentIds.filter(Boolean))];
  const notes = new Map<string, { reason: string; by: string; at: string }>();
  if (!ids.length) return notes;
  const rows = await currentDb().select({ id: schema.record_corrections.record_id, reason: schema.record_corrections.reason, after: schema.record_corrections.after_json, by: schema.record_corrections.encoded_by_name, at: schema.record_corrections.corrected_at })
    .from(schema.record_corrections).where(and(eq(schema.record_corrections.module, MODULE), inArray(schema.record_corrections.record_id, ids))).orderBy(desc(schema.record_corrections.corrected_at));
  for (const row of rows) {
    const id = text(row.id);
    // Saved through the Sheets layer, the after value may arrive as JSON text.
    let after = row.after as { status?: string } | string | null;
    if (typeof after === "string") { try { after = JSON.parse(after) as { status?: string }; } catch { after = null; } }
    if (notes.has(id) || !isDeactivated(after?.status)) continue;
    notes.set(id, { reason: text(row.reason), by: text(row.by), at: text(row.at) });
  }
  return notes;
}
