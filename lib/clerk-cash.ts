import { and, eq, lte, ne, sql } from "drizzle-orm";

import { currentDb, inTransaction, schema, type Queryable } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { createReadableId } from "@/lib/readable-id";
import { manilaNow } from "@/lib/remittance-deadline";

/**
 * What an Entry Clerk records for their report besides New Sales and Collections:
 *
 * - bank_deposits: cash the clerk forwarded to the bank (the report's Cash Flow Transaction section). A deposit is
 *   never deleted; a mistaken one is voided with a reason.
 * - report_notes: per clerk, period and branch (note_key "employee|kind|start|branch"; before October 13, 2026 without
 *   the branch), the cash received but not yet encoded, the three remark boxes, and (October 13, 2026) the Cash Beg the
 *   clerk typed for the period with its reason; blank = zero.
 *
 * They feed the clerk report only; the finance cash ledger is not changed.
 *
 * Saved directly in the database by ID (owner, October 24, 2026; upgrade #6 phase 2, replacing Sheets-style row
 * writes): each save is one statement or one transaction. A deposit takes a lock on each reference number it carries
 * before checking for it, so two clerks saving the same GCash reference at once cannot both pass; notes and Cash Beg
 * are one row per key, inserted or updated in one step, so two saves at once never add a second row.
 */
/** At least this many characters explain a typed Cash Beg. */
export const CASH_BEG_REASON_MIN = 5;
const text = (value: unknown) => String(value ?? "").trim();
const { bank_deposits: depositsTable, report_notes: notesTable } = schema;
/**
 * Cash-flow remarks (owner, October 14, 2026): letters and numbers or numbers only (a reference such as 01101026001363),
 * never letters only. Required.
 */
export const depositRemarksProblem = (value: unknown) => {
  const remarks = text(value);
  if (!remarks) return "Enter the remarks: the deposit's reference number (numbers, or letters and numbers).";
  if (!/\d/.test(remarks)) return "The remarks need a number (e.g. the deposit reference); letters only are not accepted.";
  return "";
};
/**
 * One reference number, one deposit (owner, October 23, 2026: CABALLERO, JENNY recorded GCash reference 8046291340931
 * twice, dated October 19 and October 20, so ₱880 left Cash on Hand in both reports). A reference is a run of 6 or more
 * digits in the remarks; another deposit that is not voided with the same one refuses the save, naming that deposit so
 * it is edited (its date or amount) or voided instead. `deposits` are rows in the order deposit_id, deposit_date,
 * employee_id, employee_name, branch, bank_account_name, amount, transfer_type, mas, remarks, status (a header row first).
 * Today only (owner, October 28, 2026): deposits dated today may share a reference (one transfer recorded in several
 * lines); a reference already on a deposit of another day, or a deposit dated another day, is still refused.
 */
const references = (remarks: unknown) => [...new Set(text(remarks).match(/\d{6,}/g) ?? [])];
export function duplicateReferenceProblem(remarks: unknown, deposits: unknown[][], exceptId = "", { date = "", today = manilaNow().date }: { date?: string; today?: string } = {}) {
  const wanted = references(remarks);
  if (!wanted.length) return "";
  const peso = (value: unknown) => (Number(value) || 0).toLocaleString("en-PH", { style: "currency", currency: "PHP" });
  for (const row of deposits.slice(1)) {
    if (!text(row[0]) || text(row[0]) === exceptId || text(row[10]) === "Voided") continue;
    if (date && date === today && text(row[1]).slice(0, 10) === today) continue;
    const shared = wanted.find((reference) => references(row[9]).includes(reference));
    if (shared) return `Reference ${shared} is already recorded on deposit ${text(row[0])} (${peso(row[6])}, deposit date ${text(row[1])}, recorded by ${text(row[3]) || "another clerk"}, ${text(row[4])}). Edit that deposit (its date or amount) or void it; do not record the same transfer again.`;
  }
  return "";
}
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const asRow = (row: typeof depositsTable.$inferSelect): unknown[] => [row.deposit_id, row.deposit_date, row.employee_id, row.employee_name, row.branch, row.bank_account_name, row.amount, row.transfer_type, row.mas, row.remarks, row.status];

/**
 * Refuses a deposit whose reference is already on another deposit. Inside the save's transaction it first locks each
 * reference it carries, so a second save of the same reference waits and then sees the first.
 */
async function assertReferenceFree(tx: Queryable, remarks: unknown, exceptId = "", date = "") {
  const wanted = references(remarks).sort();
  if (!wanted.length) return;
  for (const reference of wanted) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`deposit-reference:${reference}`}))`);
  const candidates = await tx.select().from(depositsTable).where(and(ne(depositsTable.status, "Voided"), sql`${depositsTable.remarks} ~ ${wanted.join("|")}`));
  const problem = duplicateReferenceProblem(remarks, [[], ...candidates.map(asRow)], exceptId, { date });
  if (problem) throw new Error(problem);
}

export type BankDeposit = { id: string; date: string; employeeId: string; branch: string; bankAccount: string; amount: number; transferType: string; mas: string; remarks: string };

/** Posted (not voided) deposits by one clerk on or before `to`. */
export async function getDeposits(employeeId: string, to: string): Promise<BankDeposit[]> {
  const rows = await currentDb().select().from(depositsTable)
    .where(and(eq(depositsTable.employee_id, employeeId), ne(depositsTable.status, "Voided"), lte(depositsTable.deposit_date, to)));
  return rows.sort((a, b) => text(a.deposit_date).localeCompare(text(b.deposit_date)) || a.row_seq - b.row_seq)
    .map((row) => ({ id: row.deposit_id, date: text(row.deposit_date), employeeId: text(row.employee_id), branch: text(row.branch), bankAccount: text(row.bank_account_name), amount: Number(row.amount) || 0, transferType: text(row.transfer_type), mas: text(row.mas), remarks: text(row.remarks) }));
}

function depositFields(input: Record<string, unknown>) {
  const date = text(input.date), amount = Math.round(Number(input.amount) * 100) / 100;
  if (!validDate(date)) throw new Error("Enter the deposit date.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter the amount deposited.");
  const bankAccount = text(input.bankAccount).slice(0, 100), transferType = text(input.transferType).slice(0, 60);
  if (!bankAccount) throw new Error("Enter the bank account name.");
  if (!transferType) throw new Error("Enter the type of transfer (bank or channel).");
  const remarksProblem = depositRemarksProblem(input.remarks);
  if (remarksProblem) throw new Error(remarksProblem);
  return { deposit_date: date, bank_account_name: bankAccount, amount, transfer_type: transferType, mas: text(input.mas).slice(0, 100), remarks: text(input.remarks).slice(0, 200) };
}

export async function addDeposit(input: Record<string, unknown>, clerk: { employeeId: string; name: string; branch: string }) {
  const fields = depositFields(input);
  getEncoder();
  return inTransaction(async (tx) => {
    await assertReferenceFree(tx, fields.remarks, "", fields.deposit_date);
    const id = createReadableId("DEP");
    await tx.insert(depositsTable).values({ deposit_id: id, employee_id: clerk.employeeId, employee_name: clerk.name, branch: clerk.branch, status: "Posted", void_reason: null, created_at: new Date().toISOString(), ...fields });
    return { id };
  });
}

/**
 * Corrects a deposit (owner, October 13, 2026: edit it, not only void it): date, bank account, amount, type of transfer,
 * MAS and remarks. The clerk who recorded it or an administrator; not a voided one. The Audit Log keeps the old values.
 */
export async function editDeposit(id: string, input: Record<string, unknown>, by: { employeeId: string; isAdmin: boolean }) {
  const fields = depositFields(input);
  getEncoder();
  await inTransaction(async (tx) => {
    const [row] = await tx.select().from(depositsTable).where(eq(depositsTable.deposit_id, text(id))).for("update");
    if (!row) throw new Error("Deposit not found.");
    if (!by.isAdmin && text(row.employee_id) !== by.employeeId) throw new Error("You can edit only deposits you recorded.");
    if (text(row.status) === "Voided") throw new Error("A voided deposit cannot be edited.");
    await assertReferenceFree(tx, fields.remarks, row.deposit_id, fields.deposit_date);
    // The clerk, branch and status stay.
    await tx.update(depositsTable).set(fields).where(eq(depositsTable.deposit_id, row.deposit_id));
  });
}

/** Voids a deposit recorded by mistake; the clerk who recorded it or an administrator may do so. */
export async function voidDeposit(id: string, reason: string, by: { employeeId: string; isAdmin: boolean }) {
  if (reason.trim().length < 3) throw new Error("Give the reason for voiding the deposit.");
  await inTransaction(async (tx) => {
    const [row] = await tx.select().from(depositsTable).where(eq(depositsTable.deposit_id, text(id))).for("update");
    if (!row) throw new Error("Deposit not found.");
    if (!by.isAdmin && text(row.employee_id) !== by.employeeId) throw new Error("You can void only deposits you recorded.");
    if (text(row.status) === "Voided") throw new Error("This deposit is already voided.");
    await tx.update(depositsTable).set({ status: "Voided", void_reason: reason.trim().slice(0, 200) }).where(eq(depositsTable.deposit_id, row.deposit_id));
  });
}

export type CashBegEdit = { amount: number; reason: string; updatedAt: string; updatedBy: string };
export type ReportNotes = { pendingCash: number; specificRemarks: string; pendingTransactions: string; otherComments: string; updatedAt: string; updatedBy: string; cashBeg: CashBegEdit | null };
type NoteRow = typeof notesTable.$inferSelect;
/** The typed Cash Beg of a notes row, or null when it is blank. */
const cashBegOf = (row: NoteRow | undefined): CashBegEdit | null => row?.cash_beg === null || row?.cash_beg === undefined || !Number.isFinite(Number(row.cash_beg)) ? null
  : { amount: Number(row.cash_beg), reason: text(row.cash_beg_reason), updatedAt: text(row.cash_beg_updated_at), updatedBy: text(row.cash_beg_updated_by) };
/** One notes row per clerk, period and branch (October 13, 2026); rows from before then have no branch part. */
const noteKey = (employeeId: string, kind: string, start: string, branch = "") => `${employeeId}|${kind}|${start}${text(branch) ? `|${text(branch)}` : ""}`;
const sameKey = (a: unknown, b: string) => text(a).toLowerCase() === b.toLowerCase();
/** The clerk's notes rows (keys start with their Employee ID). */
const notesOf = (employeeId: string, db: Queryable = currentDb()) => db.select().from(notesTable).where(sql`lower(${notesTable.note_key}) like ${`${employeeId.toLowerCase()}|%`}`);

/** A branch's notes; the notes saved before reports were split by branch count for the clerk's primary branch. */
export async function getReportNotes(employeeId: string, kind: string, start: string, branch = "", primary = false): Promise<ReportNotes> {
  const all = await notesOf(employeeId);
  if (!text(branch)) {
    /*
     * All branches (Audits, Report Review): every branch's notes for this clerk and period together (owner, October 13,
     * 2026: the remarks were missing from the audit), each labelled with its branch when there are several; pending cash
     * adds up.
     */
    const base = noteKey(employeeId, kind, start).toLowerCase();
    const found = all.filter((item) => { const key = text(item.note_key).toLowerCase(); return key === base || key.startsWith(`${base}|`); }).sort((a, b) => a.row_seq - b.row_seq);
    const several = found.length > 1;
    const join = (field: "specific_remarks" | "pending_transactions" | "other_comments") => found.filter((item) => text(item[field])).map((item) => { const label = text(item.note_key).split("|")[3] ?? ""; return several && label ? `${label}: ${text(item[field])}` : text(item[field]); }).join("\n\n");
    const latest = [...found].sort((a, b) => text(b.updated_at).localeCompare(text(a.updated_at)))[0];
    return { pendingCash: Math.round(found.reduce((total, item) => total + (Number(item.pending_cash) || 0), 0) * 100) / 100, specificRemarks: join("specific_remarks"), pendingTransactions: join("pending_transactions"), otherComments: join("other_comments"), updatedAt: text(latest?.updated_at), updatedBy: text(latest?.updated_by), cashBeg: null };
  }
  const row = all.find((item) => sameKey(item.note_key, noteKey(employeeId, kind, start, branch)))
    ?? (branch && primary ? all.find((item) => sameKey(item.note_key, noteKey(employeeId, kind, start))) : undefined);
  return { pendingCash: Number(row?.pending_cash) || 0, specificRemarks: text(row?.specific_remarks), pendingTransactions: text(row?.pending_transactions), otherComments: text(row?.other_comments), updatedAt: text(row?.updated_at), updatedBy: text(row?.updated_by), cashBeg: cashBegOf(row) };
}

/** Every Cash Beg the clerk typed, with the report it belongs to (kind, start day and branch; "" before the split), oldest first. */
export async function getCashBegEdits(employeeId: string): Promise<Array<CashBegEdit & { kind: string; start: string; branch: string }>> {
  return (await notesOf(employeeId))
    .filter((row) => text(row.employee_id) === employeeId && cashBegOf(row))
    .map((row) => { const [, kind = "", start = "", branch = ""] = text(row.note_key).split("|"); return { ...cashBegOf(row)!, kind, start, branch }; })
    .filter((edit) => validDate(edit.start))
    .sort((a, b) => a.start.localeCompare(b.start) || a.updatedAt.localeCompare(b.updatedAt));
}

/**
 * Inserts or updates the one notes row of a key, in one transaction: an existing row written with other capitals is
 * found and kept (its key unchanged); otherwise a new row is inserted, and a second save arriving at the same moment
 * updates that row instead of adding another (the key is unique).
 */
async function upsertNotes(employeeId: string, kind: string, start: string, branch: string, changes: Partial<NoteRow>) {
  const key = noteKey(employeeId, kind, start, branch);
  await inTransaction(async (tx) => {
    const [existing] = await tx.select({ key: notesTable.note_key }).from(notesTable).where(sql`lower(${notesTable.note_key}) = ${key.toLowerCase()}`).for("update").limit(1);
    if (existing) { await tx.update(notesTable).set(changes).where(eq(notesTable.note_key, existing.key)); return; }
    await tx.insert(notesTable).values({ note_key: key, employee_id: employeeId, period_kind: kind, period_start: start, pending_cash: 0, ...changes })
      .onConflictDoUpdate({ target: notesTable.note_key, set: changes });
  });
}

/**
 * The clerk types the Cash Beg of their own report for one period: the cash actually received at its start (owner,
 * October 13, 2026: case by case), with the reason. It is that report's alone; other reports are not changed. A blank
 * amount clears it (Cash Beg zero). Only the Cash Beg fields change, so the notes stay as they are.
 */
export async function saveCashBeg(employeeId: string, kind: string, start: string, input: Record<string, unknown>, branch = "") {
  const blank = input.cashBeg === null || input.cashBeg === undefined || text(input.cashBeg) === "";
  const amount = blank ? null : Math.round(Number(input.cashBeg) * 100) / 100;
  const reason = text(input.reason).slice(0, 300);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new Error("Cash Beg must be zero or a positive amount.");
  if (amount !== null && reason.length < CASH_BEG_REASON_MIN) throw new Error("Enter the reason for the Cash Beg (at least 5 characters).");
  const actor = getEncoder();
  await upsertNotes(employeeId, kind, start, branch, amount === null
    ? { cash_beg: null, cash_beg_reason: null, cash_beg_updated_at: null, cash_beg_updated_by: null }
    : { cash_beg: amount, cash_beg_reason: reason, cash_beg_updated_at: actor.encodedAt, cash_beg_updated_by: actor.name });
}

/** The clerk saves the notes of their own report for one period. */
export async function saveReportNotes(employeeId: string, kind: string, start: string, input: Record<string, unknown>, branch = "") {
  const pendingCash = Math.round((Number(input.pendingCash) || 0) * 100) / 100;
  if (pendingCash < 0) throw new Error("Pending cash cannot be negative.");
  const actor = getEncoder();
  await upsertNotes(employeeId, kind, start, branch, {
    pending_cash: pendingCash, specific_remarks: text(input.specificRemarks).slice(0, 1000) || null, pending_transactions: text(input.pendingTransactions).slice(0, 1000) || null,
    other_comments: text(input.otherComments).slice(0, 1000) || null, updated_at: actor.encodedAt, updated_by: actor.name,
  });
}
