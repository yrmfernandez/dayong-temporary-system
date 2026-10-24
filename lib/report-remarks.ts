import { and, asc, eq } from "drizzle-orm";

import { currentDb, encodedBy, schema } from "@/lib/db";
import { createReadableId } from "@/lib/readable-id";

/**
 * Remarks on a report for one exact From–To: reviewers' remarks on an Entry Clerk's report (scope = the clerk's name) and
 * notes on Company Reports (scope "Company" or "Company · <branch>"). Read and written directly in report_remarks
 * (October 24, 2026; upgrade #6 phase 4).
 */
const text = (value: unknown) => String(value ?? "").trim();
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const { report_remarks: remarksTable } = schema;

export async function getReportRemarks(from: string, to: string) {
  if (!datePattern.test(from) || !datePattern.test(to)) return [];
  const rows = await currentDb().select().from(remarksTable).where(and(eq(remarksTable.date_from, from), eq(remarksTable.date_to, to))).orderBy(asc(remarksTable.row_seq));
  return rows.map((row) => ({ id: row.remark_id, reportType: text(row.report_type), scope: text(row.scope), comment: text(row.comment), createdAt: text(row.created_at), encodedBy: text(row.encoded_by_name) }));
}

export async function addReportRemark(input: { from: string; to: string; reportType: string; scope: string; comment: string }) {
  if (!input.comment.trim()) throw new Error("Remark is required.");
  if (!datePattern.test(input.from) || !datePattern.test(input.to)) throw new Error("The report period is missing.");
  await currentDb().insert(remarksTable).values({
    remark_id: createReadableId("RRK"), date_from: input.from, date_to: input.to, report_type: input.reportType || null, scope: input.scope || null,
    comment: input.comment.trim(), created_at: new Date().toISOString(), ...encodedBy(),
  });
}
