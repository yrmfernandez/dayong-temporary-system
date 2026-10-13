import { getEncoder } from "@/lib/encoder-context";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { createReadableId } from "@/lib/readable-id";

/**
 * What an Entry Clerk records for their report besides New Sales and Collections:
 *
 * - "Bank Deposits": cash the clerk forwarded to the bank (the report's Cash Flow Transaction section). A deposit is
 *   never deleted; a mistaken one is voided with a reason. Columns: deposit_id, deposit_date, employee_id,
 *   employee_name, branch, bank_account_name, amount, transfer_type, mas, remarks, status, void_reason, created_at.
 * - "Report Notes": per clerk and period, the cash received but not yet encoded and the three remark boxes. Columns:
 *   note_key (employee|kind|start), employee_id, period_kind, period_start, pending_cash, specific_remarks,
 *   pending_transactions, other_comments, updated_at, updated_by, and (October 13, 2026) cash_beg, cash_beg_reason,
 *   cash_beg_updated_at, cash_beg_updated_by: the Cash Beg the clerk typed for the period; blank = zero.
 *
 * Both sheets are created on first use. They feed the clerk report only; the finance cash ledger is not changed.
 */
const DEPOSITS = "Bank Deposits";
const NOTES = "Report Notes";
const DEPOSIT_HEADERS = ["deposit_id", "deposit_date", "employee_id", "employee_name", "branch", "bank_account_name", "amount", "transfer_type", "mas", "remarks", "status", "void_reason", "created_at"];
const NOTE_HEADERS = ["note_key", "employee_id", "period_kind", "period_start", "pending_cash", "specific_remarks", "pending_transactions", "other_comments", "updated_at", "updated_by", "cash_beg", "cash_beg_reason", "cash_beg_updated_at", "cash_beg_updated_by"];
/** At least this many characters explain a typed Cash Beg. */
export const CASH_BEG_REASON_MIN = 5;
const text = (value: unknown) => String(value ?? "").trim();
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const column = (count: number) => String.fromCharCode(64 + count);

async function titles() {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties.title" });
  return new Set((metadata.data.sheets ?? []).map((sheet) => sheet.properties?.title ?? ""));
}

async function ensure(title: string, headers: string[]) {
  if ((await titles()).has(title)) return;
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }] } });
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${title}'!A1:${column(headers.length)}1`, valueInputOption: "RAW", requestBody: { values: [headers] } });
}

async function rows(title: string, width: number) {
  if (!(await titles()).has(title)) return [];
  return (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${title}'!A:${column(width)}`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values ?? [];
}

export type BankDeposit = { id: string; date: string; employeeId: string; branch: string; bankAccount: string; amount: number; transferType: string; mas: string; remarks: string };

/** Posted (not voided) deposits by one clerk on or before `to`. */
export async function getDeposits(employeeId: string, to: string): Promise<BankDeposit[]> {
  return (await rows(DEPOSITS, DEPOSIT_HEADERS.length)).slice(1)
    .filter((row) => text(row[0]) && text(row[2]) === employeeId && text(row[10]) !== "Voided" && text(row[1]) <= to)
    .map((row) => ({ id: text(row[0]), date: text(row[1]), employeeId: text(row[2]), branch: text(row[4]), bankAccount: text(row[5]), amount: Number(row[6]) || 0, transferType: text(row[7]), mas: text(row[8]), remarks: text(row[9]) }));
}

export async function addDeposit(input: Record<string, unknown>, clerk: { employeeId: string; name: string; branch: string }) {
  const date = text(input.date), amount = Math.round(Number(input.amount) * 100) / 100;
  if (!validDate(date)) throw new Error("Enter the deposit date.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter the amount deposited.");
  const bankAccount = text(input.bankAccount).slice(0, 100), transferType = text(input.transferType).slice(0, 60);
  if (!bankAccount) throw new Error("Enter the bank account name.");
  if (!transferType) throw new Error("Enter the type of transfer (bank or channel).");
  getEncoder();
  await ensure(DEPOSITS, DEPOSIT_HEADERS);
  const id = createReadableId("DEP");
  await sheets.spreadsheets.values.append({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${DEPOSITS}'!A:M`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [[
    id, date, clerk.employeeId, clerk.name, clerk.branch, bankAccount, amount, transferType, text(input.mas).slice(0, 100), text(input.remarks).slice(0, 200), "Posted", "", new Date().toISOString(),
  ]] } });
  return { id };
}

/**
 * Corrects a deposit (owner, October 13, 2026: edit it, not only void it): date, bank account, amount, type of transfer,
 * MAS and remarks. The clerk who recorded it or an administrator; not a voided one. The Audit Log keeps the old values.
 */
export async function editDeposit(id: string, input: Record<string, unknown>, by: { employeeId: string; isAdmin: boolean }) {
  const date = text(input.date), amount = Math.round(Number(input.amount) * 100) / 100;
  if (!validDate(date)) throw new Error("Enter the deposit date.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter the amount deposited.");
  const bankAccount = text(input.bankAccount).slice(0, 100), transferType = text(input.transferType).slice(0, 60);
  if (!bankAccount) throw new Error("Enter the bank account name.");
  if (!transferType) throw new Error("Enter the type of transfer (bank or channel).");
  getEncoder();
  const all = await rows(DEPOSITS, DEPOSIT_HEADERS.length);
  const index = all.findIndex((row, position) => position > 0 && text(row[0]) === text(id));
  if (index < 0) throw new Error("Deposit not found.");
  if (!by.isAdmin && text(all[index][2]) !== by.employeeId) throw new Error("You can edit only deposits you recorded.");
  if (text(all[index][10]) === "Voided") throw new Error("A voided deposit cannot be edited.");
  // B date, F bank account, G amount, H type of transfer, I MAS, J remarks; the clerk, branch and status stay.
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${DEPOSITS}'!B${index + 1}:B${index + 1}`, valueInputOption: "RAW", requestBody: { values: [[date]] } });
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${DEPOSITS}'!F${index + 1}:J${index + 1}`, valueInputOption: "RAW", requestBody: { values: [[bankAccount, amount, transferType, text(input.mas).slice(0, 100), text(input.remarks).slice(0, 200)]] } });
}

/** Voids a deposit recorded by mistake; the clerk who recorded it or an administrator may do so. */
export async function voidDeposit(id: string, reason: string, by: { employeeId: string; isAdmin: boolean }) {
  if (reason.trim().length < 3) throw new Error("Give the reason for voiding the deposit.");
  const all = await rows(DEPOSITS, DEPOSIT_HEADERS.length);
  const index = all.findIndex((row, position) => position > 0 && text(row[0]) === id);
  if (index < 0) throw new Error("Deposit not found.");
  if (!by.isAdmin && text(all[index][2]) !== by.employeeId) throw new Error("You can void only deposits you recorded.");
  if (text(all[index][10]) === "Voided") throw new Error("This deposit is already voided.");
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${DEPOSITS}'!K${index + 1}:L${index + 1}`, valueInputOption: "RAW", requestBody: { values: [["Voided", reason.trim().slice(0, 200)]] } });
}

export type CashBegEdit = { amount: number; reason: string; updatedAt: string; updatedBy: string };
export type ReportNotes = { pendingCash: number; specificRemarks: string; pendingTransactions: string; otherComments: string; updatedAt: string; updatedBy: string; cashBeg: CashBegEdit | null };
/** Columns K-N of a notes row: the typed Cash Beg, or null when it is blank. */
const cashBegOf = (row: unknown[] | undefined): CashBegEdit | null => text(row?.[10]) === "" || !Number.isFinite(Number(row?.[10])) ? null
  : { amount: Number(row?.[10]), reason: text(row?.[11]), updatedAt: text(row?.[12]), updatedBy: text(row?.[13]) };
/** One notes row per clerk, period and branch (October 13, 2026); rows from before then have no branch part. */
const noteKey = (employeeId: string, kind: string, start: string, branch = "") => `${employeeId}|${kind}|${start}${text(branch) ? `|${text(branch)}` : ""}`;
const sameKey = (a: unknown, b: string) => text(a).toLowerCase() === b.toLowerCase();

/** A branch's notes; the notes saved before reports were split by branch count for the clerk's primary branch. */
export async function getReportNotes(employeeId: string, kind: string, start: string, branch = "", primary = false): Promise<ReportNotes> {
  const all = await rows(NOTES, NOTE_HEADERS.length);
  const row = all.find((item) => sameKey(item[0], noteKey(employeeId, kind, start, branch)))
    ?? (branch && primary ? all.find((item) => sameKey(item[0], noteKey(employeeId, kind, start))) : undefined);
  return { pendingCash: Number(row?.[4]) || 0, specificRemarks: text(row?.[5]), pendingTransactions: text(row?.[6]), otherComments: text(row?.[7]), updatedAt: text(row?.[8]), updatedBy: text(row?.[9]), cashBeg: cashBegOf(row) };
}

/** Every Cash Beg the clerk typed, with the report it belongs to (kind, start day and branch; "" before the split), oldest first. */
export async function getCashBegEdits(employeeId: string): Promise<Array<CashBegEdit & { kind: string; start: string; branch: string }>> {
  return (await rows(NOTES, NOTE_HEADERS.length)).slice(1)
    .filter((row) => text(row[1]) === employeeId && cashBegOf(row))
    .map((row) => { const [, kind = "", start = "", branch = ""] = text(row[0]).split("|"); return { ...cashBegOf(row)!, kind, start, branch }; })
    .filter((edit) => validDate(edit.start))
    .sort((a, b) => a.start.localeCompare(b.start) || a.updatedAt.localeCompare(b.updatedAt));
}

/**
 * The clerk types the Cash Beg of their own report for one period: the cash actually received at its start (owner,
 * October 13, 2026: case by case), with the reason. It is that report's alone; other reports are not changed. A blank
 * amount clears it (Cash Beg zero). Only columns K-N change, so the notes stay as they are.
 */
export async function saveCashBeg(employeeId: string, kind: string, start: string, input: Record<string, unknown>, branch = "") {
  const blank = input.cashBeg === null || input.cashBeg === undefined || text(input.cashBeg) === "";
  const amount = blank ? null : Math.round(Number(input.cashBeg) * 100) / 100;
  const reason = text(input.reason).slice(0, 300);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new Error("Cash Beg must be zero or a positive amount.");
  if (amount !== null && reason.length < CASH_BEG_REASON_MIN) throw new Error("Enter the reason for the Cash Beg (at least 5 characters).");
  const actor = getEncoder();
  await ensure(NOTES, NOTE_HEADERS);
  const key = noteKey(employeeId, kind, start, branch);
  const cash = amount === null ? ["", "", "", ""] : [amount, reason, actor.encodedAt, actor.name];
  const all = await rows(NOTES, NOTE_HEADERS.length);
  const index = all.findIndex((row, position) => position > 0 && sameKey(row[0], key));
  if (index < 0) await sheets.spreadsheets.values.append({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${NOTES}'!A:N`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [[key, employeeId, kind, start, 0, "", "", "", actor.encodedAt, actor.name, ...cash]] } });
  else await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${NOTES}'!K${index + 1}:N${index + 1}`, valueInputOption: "RAW", requestBody: { values: [cash] } });
}

/** The clerk saves the notes of their own report for one period. */
export async function saveReportNotes(employeeId: string, kind: string, start: string, input: Record<string, unknown>, branch = "") {
  const pendingCash = Math.round((Number(input.pendingCash) || 0) * 100) / 100;
  if (pendingCash < 0) throw new Error("Pending cash cannot be negative.");
  const actor = getEncoder();
  await ensure(NOTES, NOTE_HEADERS);
  const values = [[noteKey(employeeId, kind, start, branch), employeeId, kind, start, pendingCash, text(input.specificRemarks).slice(0, 1000), text(input.pendingTransactions).slice(0, 1000), text(input.otherComments).slice(0, 1000), actor.encodedAt, actor.name]];
  const all = await rows(NOTES, NOTE_HEADERS.length);
  const index = all.findIndex((row, position) => position > 0 && sameKey(row[0], String(values[0][0])));
  if (index < 0) await sheets.spreadsheets.values.append({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${NOTES}'!A:J`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values } });
  else await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${NOTES}'!A${index + 1}:J${index + 1}`, valueInputOption: "RAW", requestBody: { values } });
}
