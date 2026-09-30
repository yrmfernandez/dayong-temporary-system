import { appendEncodedRows } from "@/lib/encoder-sheets";
import { encoderHeaders } from "@/lib/encoder-schema";
import { getEncoder } from "@/lib/encoder-context";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";

const SHEET = "Company Targets";
const RANGE = `'${SHEET}'!A:E`;
const text = (value: unknown) => String(value ?? "").trim();

// Company Targets!A:E business columns: target_id (period key "2026" or "2026-Q3"), period_type, gross_sales_target,
// new_accounts_target, notes. F:I encoder identity. One row per period; saving a period again updates that row.
export type CompanyTarget = { period: string; type: "year" | "quarter"; grossSales: number; newAccounts: number; notes: string };

export const periodType = (period: string) => /^\d{4}$/.test(period) ? "year" as const : /^\d{4}-Q[1-4]$/.test(period) ? "quarter" as const : null;

async function ensureSheet() {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties.title" });
  if (metadata.data.sheets?.some((sheet) => sheet.properties?.title === SHEET)) return;
  getEncoder();
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: SHEET } } }] } });
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEET}'!A1:I1`, valueInputOption: "RAW", requestBody: { values: [["target_id", "period_type", "gross_sales_target", "new_accounts_target", "notes", ...encoderHeaders.map((header) => header.toLowerCase().replace(/ /g, "_"))]] } });
}

/** Targets by period key. A missing sheet simply means no targets have been set yet. */
export async function getCompanyTargets(): Promise<Map<string, CompanyTarget>> {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties.title" });
  if (!metadata.data.sheets?.some((sheet) => sheet.properties?.title === SHEET)) return new Map();
  const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: RANGE, valueRenderOption: "UNFORMATTED_VALUE" })).data.values ?? [];
  return new Map(rows.slice(1).filter((row) => periodType(text(row[0]))).map((row) => [text(row[0]), { period: text(row[0]), type: periodType(text(row[0]))!, grossSales: Number(row[2]) || 0, newAccounts: Number(row[3]) || 0, notes: text(row[4]) }]));
}

export async function saveCompanyTarget(input: Record<string, unknown>) {
  const period = text(input.period), type = periodType(period);
  if (!type) throw new Error("Choose a year (2026) or quarter (2026-Q3).");
  const grossSales = Math.round(Number(input.grossSales) * 100) / 100, newAccounts = Math.round(Number(input.newAccounts) || 0);
  if (!Number.isFinite(grossSales) || grossSales <= 0) throw new Error("Enter a gross sales target greater than zero.");
  if (newAccounts < 0) throw new Error("New accounts target cannot be negative.");
  const notes = text(input.notes).slice(0, 300);
  await ensureSheet();
  const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: RANGE })).data.values ?? [];
  const index = rows.slice(1).findIndex((row) => text(row[0]) === period);
  const values = [period, type, grossSales, newAccounts, notes];
  if (index < 0) await appendEncodedRows({ range: RANGE, requestBody: { values: [values] } });
  else await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEET}'!A${index + 2}:E${index + 2}`, valueInputOption: "RAW", requestBody: { values: [values] } });
  return { period, type, grossSales, newAccounts, notes };
}
