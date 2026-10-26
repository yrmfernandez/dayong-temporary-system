import { and, asc, eq, isNotNull, sql } from "drizzle-orm";

import { accountState, todayInManila, validDate, type AccountPayment } from "@/lib/account-rules";
import { currentDb, inTransaction, schema, type Queryable, type Transaction } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";

/**
 * Fully Paid accounts and their certificates (owner, October 27, 2026). An account is Fully Paid when its receipts complete
 * the program (lib/account-rules.ts) or when a full payment is recorded (by hand, or from the old "DSRDPI - Fully Paid
 * Members" form). The record keeps the date, the total, where it came from, the certificate number and whether the
 * certificate was released. Certificate numbers continue the old pattern AREA + YEAR + "-" + sequence (DAVAO2026-038):
 * the area is the branch's certificate prefix (DAVAO, DAVNOR, DDO, SDS…), the year the year the number is given, and
 * the sequence counts per area and year, three digits (a number removed before its certificate was released may be given
 * again; a released one never is).
 */
const { member_programs: accounts, branches, members, programs } = schema;
const text = (value: unknown) => String(value ?? "").trim();
const money = (value: number) => Math.round(value * 100) / 100;
export const CERTIFICATE_STATUSES = ["Pending", "Released"] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];
export type FullPaymentSource = "Receipts" | "Manual" | "Old list";

/** "DAVAO2026-038" → { prefix: "DAVAO", year: 2026, sequence: 38 }; tolerant of the old spellings (SDS-2026-002, DDO2026-08). */
export function parseCertificate(value: string) {
  const match = /^([A-Z]+)-?(\d{4})-(\d+)[A-Z]?$/i.exec(text(value));
  return match ? { prefix: match[1].toUpperCase(), year: Number(match[2]), sequence: Number(match[3]) } : null;
}
export const formatCertificate = (prefix: string, year: number, sequence: number) => `${prefix.toUpperCase()}${year}-${String(sequence).padStart(3, "0")}`;

/**
 * Certificate numbers already printed but not on an account yet (System Setting certificate_reserved, written by
 * scripts/import-fully-paid.mjs): automatic numbering continues after them; recording one by hand may still use it.
 */
export const RESERVED_KEY = "certificate_reserved";
async function reservedCertificates(tx: Queryable) {
  const [row] = await tx.select({ value: schema.system_settings.value }).from(schema.system_settings).where(eq(schema.system_settings.setting_key, RESERVED_KEY)).limit(1);
  try { const list = JSON.parse(text(row?.value) || "[]"); return Array.isArray(list) ? list.map(text) : []; } catch { return []; }
}

/** The next free number for an area and year, under a lock so two at once never get the same one. */
export async function nextCertificateNumber(tx: Transaction, prefix: string, year: number) {
  const area = text(prefix).toUpperCase();
  if (!/^[A-Z]{2,10}$/.test(area)) throw new Error("Set the branch's certificate prefix (letters only, e.g. DAVAO) on the Fully Paid page first.");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`certificate:${area}:${year}`}))`);
  const used = await tx.select({ number: accounts.certificate_number }).from(accounts)
    .where(sql`upper(${accounts.certificate_number}) ~ ${`^${area}-?${year}-[0-9]+`}`);
  // Numbers on paper certificates not yet in the system (old Fully Paid form rows still to record) are reserved too.
  const reserved = await reservedCertificates(tx);
  const sequences = [...used.map((row) => text(row.number)), ...reserved].map(parseCertificate).filter((item) => item && item.prefix === area && item.year === year).map((item) => item!.sequence);
  return formatCertificate(area, year, Math.max(0, ...sequences) + 1);
}

/** The certificate prefix of an account's branch (by its link, else by name). */
async function prefixOf(tx: Queryable, branchId: string | null, branchName: string) {
  const [row] = await tx.select({ prefix: branches.certificate_prefix }).from(branches)
    .where(branchId ? eq(branches.branch_id, branchId) : sql`upper(trim(${branches.branch_name_code})) = ${branchName.toUpperCase()}`).limit(1);
  return text(row?.prefix);
}

export type FullPaymentInput = { enrollmentId: string; paidOn: string; total: number; source: FullPaymentSource; certificateNumber?: string; certificateStatus?: CertificateStatus; releasedOn?: string; releasedBy?: string };

/** Records an account's full payment inside the caller's transaction; a number is given when none is passed. */
export async function recordFullPayment(tx: Transaction, input: FullPaymentInput) {
  const [account] = await tx.select({ id: accounts.enrollment_id, branchId: accounts.branch_id, branch: accounts.branch, doi: accounts.doi, paidOn: accounts.fully_paid_on, certificate: accounts.certificate_number })
    .from(accounts).where(eq(accounts.enrollment_id, text(input.enrollmentId))).for("update");
  if (!account) throw new Error("Account not found.");
  if (account.paidOn) throw new Error(`This account is already Fully Paid (${account.paidOn}${account.certificate ? `, certificate ${account.certificate}` : ""}).`);
  if (!validDate(input.paidOn) || input.paidOn > todayInManila()) throw new Error("Enter the date of full payment (today or earlier).");
  if (account.doi && input.paidOn < account.doi) throw new Error("The date of full payment is before the account's DOI.");
  if (!Number.isFinite(input.total) || input.total <= 0) throw new Error("Enter the total amount of the full payment.");
  let number = text(input.certificateNumber).toUpperCase();
  if (number) {
    const [taken] = await tx.select({ id: accounts.enrollment_id }).from(accounts).where(sql`upper(${accounts.certificate_number}) = ${number}`).limit(1);
    if (taken) throw new Error(`Certificate ${number} is already used by account ${taken.id}.`);
  } else {
    number = await nextCertificateNumber(tx, await prefixOf(tx, account.branchId, text(account.branch)), Number(todayInManila().slice(0, 4)));
  }
  const status: CertificateStatus = input.certificateStatus ?? "Pending";
  await tx.update(accounts).set({
    account_status: "Fully Paid", fully_paid_on: input.paidOn, fully_paid_total: money(input.total), fully_paid_source: input.source, fully_paid_recorded_by: getEncoder().name,
    certificate_number: number, certificate_status: status,
    certificate_released_on: status === "Released" ? (input.releasedOn || null) : null, certificate_released_by: status === "Released" ? (text(input.releasedBy) || null) : null,
  }).where(eq(accounts.enrollment_id, account.id));
  return { enrollmentId: account.id, certificateNumber: number };
}

/**
 * Accounts whose receipts just completed the program get their full payment recorded (date = last OR date, total = what
 * was received) with a certificate number to release. Called after statuses are worked out (nightly, collection saves).
 */
export async function recordCompletedAccounts(tx: Transaction, completed: Array<{ id: string; payments: AccountPayment[]; saleCredit?: number }>) {
  let recorded = 0;
  for (const item of completed) {
    const [row] = await tx.select({ paidOn: accounts.fully_paid_on }).from(accounts).where(eq(accounts.enrollment_id, item.id));
    if (!row || row.paidOn) continue;
    const last = [...item.payments].sort((a, b) => a.orDate.localeCompare(b.orDate)).at(-1)?.orDate ?? todayInManila();
    const total = item.payments.reduce((sum, payment) => sum + payment.amount, 0) + (item.saleCredit ?? 0);
    try { await recordFullPayment(tx, { enrollmentId: item.id, paidOn: last, total, source: "Receipts" }); recorded++; }
    catch (error) { console.error(`Fully Paid ${item.id}: not recorded.`, error); }
  }
  return recorded;
}

/** Marks a certificate released (date and who received it), or back to pending. */
export async function setCertificateRelease(enrollmentId: string, released: boolean, releasedOn = "", receivedBy = "") {
  if (released && (!validDate(releasedOn) || releasedOn > todayInManila())) throw new Error("Enter the date the certificate was released.");
  return inTransaction(async (tx) => {
    const [row] = await tx.select({ number: accounts.certificate_number }).from(accounts).where(eq(accounts.enrollment_id, text(enrollmentId))).for("update");
    if (!row?.number) throw new Error("This account has no certificate.");
    await tx.update(accounts).set({ certificate_status: released ? "Released" : "Pending", certificate_released_on: released ? releasedOn : null,
      certificate_released_by: released ? (text(receivedBy).slice(0, 120) || getEncoder().name) : null }).where(eq(accounts.enrollment_id, text(enrollmentId)));
  });
}

/** Removes a full payment recorded by mistake (only while its certificate is not released); the status is worked out again. */
export async function removeFullPayment(enrollmentId: string, reason: string) {
  if (text(reason).length < 5) throw new Error("Give the reason (at least 5 characters).");
  const { loadAccountData } = await import("@/lib/account-data");
  return inTransaction(async (tx) => {
    const [row] = await tx.select({ status: accounts.certificate_status, paidOn: accounts.fully_paid_on }).from(accounts).where(eq(accounts.enrollment_id, text(enrollmentId))).for("update");
    if (!row?.paidOn) throw new Error("This account has no full payment recorded.");
    if (row.status === "Released") throw new Error("The certificate was already released. Mark it pending first if it was not really handed over.");
    await tx.update(accounts).set({ fully_paid_on: null, fully_paid_total: null, fully_paid_source: null, fully_paid_recorded_by: null, certificate_number: null, certificate_status: null, certificate_released_on: null, certificate_released_by: null })
      .where(eq(accounts.enrollment_id, text(enrollmentId)));
    const data = await loadAccountData({ enrollmentIds: [text(enrollmentId)], includeDeactivated: true }, tx);
    const account = data.accounts[0];
    if (account) {
      let status = "";
      try { status = accountState({ ...account, fullyPaidOn: "" }, data.payments).status; } catch { status = account.storedStatus; }
      await tx.update(accounts).set({ account_status: status }).where(eq(accounts.enrollment_id, account.id));
    }
    return { reason: text(reason) };
  });
}

/** Fully Paid accounts for the list: newest first; filters by branch, certificate status and member number. */
export async function listFullPayments(filters: { branch?: string; status?: string; search?: string } = {}) {
  const rows = await currentDb().select({
    enrollmentId: accounts.enrollment_id, memberNumber: accounts.member_number, branch: accounts.branch, mas: accounts.mas, doi: accounts.doi,
    paidOn: accounts.fully_paid_on, total: accounts.fully_paid_total, source: accounts.fully_paid_source, recordedBy: accounts.fully_paid_recorded_by,
    certificate: accounts.certificate_number, certificateStatus: accounts.certificate_status, releasedOn: accounts.certificate_released_on, releasedBy: accounts.certificate_released_by,
    program: programs.program_name, surname: members.surname, firstName: members.first_name, middleName: members.middle_name,
  }).from(accounts).innerJoin(programs, eq(programs.program_id, accounts.program_id)).innerJoin(members, eq(members.member_id, accounts.member_id))
    .where(and(isNotNull(accounts.fully_paid_on),
      filters.branch ? sql`upper(trim(${accounts.branch})) = ${text(filters.branch).toUpperCase()}` : undefined,
      filters.status ? eq(accounts.certificate_status, text(filters.status)) : undefined,
      filters.search ? sql`(${accounts.member_number} ilike ${`%${text(filters.search)}%`} or ${accounts.certificate_number} ilike ${`%${text(filters.search)}%`} or concat_ws(' ', ${members.surname}, ${members.first_name}) ilike ${`%${text(filters.search)}%`})` : undefined))
    .orderBy(sql`${accounts.fully_paid_on} desc`, asc(accounts.member_number));
  return rows.map((row) => ({ ...row, total: Number(row.total ?? 0), memberName: [row.surname, row.firstName, row.middleName].map(text).filter(Boolean).join(" ") }));
}

/** Branches and their certificate prefixes, for the page's settings. */
export async function certificatePrefixes() {
  return currentDb().select({ id: branches.branch_id, name: branches.branch_name_code, prefix: branches.certificate_prefix, territory: branches.territory }).from(branches).orderBy(asc(branches.branch_name_code));
}

export async function setCertificatePrefix(branchId: string, prefix: string) {
  const area = text(prefix).toUpperCase();
  if (area && !/^[A-Z]{2,10}$/.test(area)) throw new Error("A certificate prefix is 2 to 10 letters, e.g. DAVAO.");
  await currentDb().update(branches).set({ certificate_prefix: area || null }).where(eq(branches.branch_id, text(branchId)));
}

/** A member's accounts that can be recorded Fully Paid by hand: not yet recorded. */
export async function accountsToRecord(memberNumber: string) {
  return currentDb().select({ enrollmentId: accounts.enrollment_id, program: programs.program_name, branch: accounts.branch, doi: accounts.doi, status: accounts.account_status, total: programs.pay_balance_total })
    .from(accounts).innerJoin(programs, eq(programs.program_id, accounts.program_id))
    .where(and(eq(accounts.member_number, text(memberNumber)), sql`${accounts.fully_paid_on} is null`));
}


