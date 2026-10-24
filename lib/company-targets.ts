import { asc } from "drizzle-orm";

import { currentDb, encodedBy, schema } from "@/lib/db";

const text = (value: unknown) => String(value ?? "").trim();
const { company_targets: targetsTable } = schema;

// company_targets: target_id (period key "2026" or "2026-Q3"), period_type, gross_sales_target, new_accounts_target, notes.
// One row per period; saving a period again updates that row in the same statement (October 24, 2026; upgrade #6).
export type CompanyTarget = { period: string; type: "year" | "quarter"; grossSales: number; newAccounts: number; notes: string };

export const periodType = (period: string) => /^\d{4}$/.test(period) ? "year" as const : /^\d{4}-Q[1-4]$/.test(period) ? "quarter" as const : null;

/** Targets by period key. None saved simply means no targets have been set yet. */
export async function getCompanyTargets(): Promise<Map<string, CompanyTarget>> {
  const rows = await currentDb().select().from(targetsTable).orderBy(asc(targetsTable.row_seq));
  return new Map(rows.filter((row) => periodType(text(row.target_id))).map((row) => [text(row.target_id), { period: text(row.target_id), type: periodType(text(row.target_id))!, grossSales: Number(row.gross_sales_target) || 0, newAccounts: Number(row.new_accounts_target) || 0, notes: text(row.notes) }]));
}

export async function saveCompanyTarget(input: Record<string, unknown>) {
  const period = text(input.period), type = periodType(period);
  if (!type) throw new Error("Choose a year (2026) or quarter (2026-Q3).");
  const grossSales = Math.round(Number(input.grossSales) * 100) / 100, newAccounts = Math.round(Number(input.newAccounts) || 0);
  if (!Number.isFinite(grossSales) || grossSales <= 0) throw new Error("Enter a gross sales target greater than zero.");
  if (newAccounts < 0) throw new Error("New accounts target cannot be negative.");
  const notes = text(input.notes).slice(0, 300);
  const values = { period_type: type, gross_sales_target: grossSales, new_accounts_target: newAccounts, notes: notes || null };
  await currentDb().insert(targetsTable).values({ target_id: period, ...values, ...encodedBy() }).onConflictDoUpdate({ target: targetsTable.target_id, set: values });
  return { period, type, grossSales, newAccounts, notes };
}
