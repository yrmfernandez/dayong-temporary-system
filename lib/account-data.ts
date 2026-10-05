import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { accountState, monthIndex, monthName, paymentsByEnrollment, type Account, type AccountPayment, todayInManila } from "@/lib/account-rules";
import { currentDb, inTransaction, schema, type Queryable, type Transaction } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import type { IncentiveTier } from "@/lib/remittance";
import { buildMamReport } from "@/lib/mam-report";

const { collections, member_programs: memberPrograms, members, program_incentives: programIncentives, programs, sales } = schema;

/** Which accounts to load. Empty loads every account (reports); the others load only what a page or save needs. */
export type AccountScope = {
  enrollmentIds?: string[];
  memberId?: string;
  /** Exact MAS name, case-insensitive (lib/member-scope.ts). */
  mas?: string;
  /** Exact branch name, case-insensitive. */
  branch?: string;
  /** Accounts matching any of these member number + program pairs (a Collections batch). */
  memberPrograms?: Array<{ memberNumber: string; programId: string }>;
};
export type LoadedAccount = Account & { memberName: string; programName: string };
export type AccountData = Awaited<ReturnType<typeof loadAccountData>>;

const text = (value: string | null | undefined) => (value ?? "").trim();
const memberName = (surname: string | null, firstName: string | null, middleName: string | null) => `${text(surname)}, ${text(firstName)} ${text(middleName)}`.trim();

function scopeCondition(scope: AccountScope): SQL | undefined {
  const conditions: SQL[] = [];
  if (scope.enrollmentIds) conditions.push(scope.enrollmentIds.length ? inArray(memberPrograms.enrollment_id, scope.enrollmentIds) : sql`false`);
  if (scope.memberId !== undefined) conditions.push(eq(memberPrograms.member_id, scope.memberId));
  if (scope.mas !== undefined) conditions.push(sql`lower(trim(${memberPrograms.mas})) = ${scope.mas.trim().toLowerCase()}`);
  if (scope.branch !== undefined) conditions.push(sql`lower(trim(${memberPrograms.branch})) = ${scope.branch.trim().toLowerCase()}`);
  if (scope.memberPrograms) {
    const pairs = scope.memberPrograms.filter((pair) => pair.memberNumber && pair.programId);
    conditions.push(pairs.length ? sql`(${memberPrograms.member_number}, ${memberPrograms.program_id}) in (${sql.join(pairs.map((pair) => sql`(${pair.memberNumber}, ${pair.programId})`), sql`, `)})` : sql`false`);
  }
  return conditions.length ? and(...conditions) : undefined;
}

/**
 * Program accounts with their posted payments, the New Sale behind each, and the incentive tiers of their programs.
 * With `lock`, the accounts stay locked until the transaction ends, so two saves for the same account (on any server)
 * run one after the other and the second sees the first one's payments.
 */
export async function loadAccountData(scope: AccountScope = {}, db: Queryable = currentDb(), { lock = false }: { lock?: boolean } = {}) {
  const where = scopeCondition(scope);
  const scoped = Boolean(where);
  let accountQuery = db.select({
    id: memberPrograms.enrollment_id, memberId: memberPrograms.member_id, memberNumber: memberPrograms.member_number, programId: memberPrograms.program_id,
    doi: memberPrograms.doi, branch: memberPrograms.branch, mas: memberPrograms.mas, storedStatus: memberPrograms.account_status,
    basePay: programs.base_pay, payBalanceTotal: programs.pay_balance_total, programName: programs.program_name,
    surname: members.surname, firstName: members.first_name, middleName: members.middle_name,
  }).from(memberPrograms)
    .innerJoin(programs, eq(programs.program_id, memberPrograms.program_id))
    .innerJoin(members, eq(members.member_id, memberPrograms.member_id))
    .where(where).$dynamic();
  if (lock) accountQuery = accountQuery.for("update", { of: memberPrograms });
  const accountRows = await accountQuery;
  const accounts: LoadedAccount[] = accountRows.map((row) => ({
    id: row.id, memberId: row.memberId, memberNumber: text(row.memberNumber), programId: row.programId, doi: row.doi ?? "",
    branch: text(row.branch), mas: text(row.mas), basePay: row.basePay ?? 0, payBalanceTotal: row.payBalanceTotal ?? 0, storedStatus: text(row.storedStatus),
    memberName: memberName(row.surname, row.firstName, row.middleName) || text(row.memberNumber), programName: row.programName,
  }));

  const ids = accounts.map((account) => account.id);
  const programIds = [...new Set(accounts.map((account) => account.programId))];
  const memberNumbers = [...new Set(accounts.map((account) => account.memberNumber))];
  const [paymentRows, saleRows, tierRows] = await Promise.all([
    scoped && !ids.length ? [] : db.select({
      id: collections.collection_id, enrollmentId: collections.enrollment_id, orDate: collections.or_date, orNumber: collections.or_number,
      monthFrom: collections.month_from, monthTo: collections.month_to, nopFrom: collections.nop_from, nopTo: collections.nop_to,
      amount: collections.amount_collected, dateRemitted: collections.date_remitted, mas: collections.mas,
    }).from(collections).where(and(eq(collections.status, "Posted"), scoped ? inArray(collections.enrollment_id, ids) : undefined)),
    scoped && !memberNumbers.length ? [] : db.select({ memberNumber: sales.member_number, programId: sales.program_id, applicationNumber: sales.application_no, registrationFee: sales.registration_amount })
      .from(sales).where(scoped ? inArray(sales.member_number, memberNumbers) : undefined),
    scoped && !programIds.length ? [] : db.select().from(programIncentives).where(scoped ? inArray(programIncentives.program_id, programIds) : undefined),
  ]);
  const payments: AccountPayment[] = paymentRows.map((row) => ({
    id: row.id, enrollmentId: row.enrollmentId, orDate: row.orDate ?? "", orNumber: text(row.orNumber),
    monthFrom: text(row.monthFrom).slice(0, 7), monthTo: text(row.monthTo).slice(0, 7), nopFrom: row.nopFrom ?? 0, nopTo: row.nopTo ?? 0,
    amount: row.amount, dateRemitted: row.dateRemitted ?? row.orDate ?? "", mas: text(row.mas),
  }));
  const saleList = saleRows.map((row) => ({ memberNumber: text(row.memberNumber), programId: row.programId, applicationNumber: text(row.applicationNumber), registrationFee: row.registrationFee ?? 0 }));
  const incentives = tierRows.map((row) => ({
    id: row.incentive_id, programId: row.program_id, role: text(row.role) as IncentiveTier["role"], fromMonth: row.from_month ?? 0, toMonth: row.to_month ?? 0,
    incentiveType: text(row.incentive_type) as IncentiveTier["incentiveType"], markUp: row.mark_up ?? 0, incentiveAmount: row.incentive_amount ?? 0, branchId: text(row.branch_id),
  }));
  return { accounts, payments, sales: saleList, incentives };
}

export async function accountReport(scope: AccountScope = {}) {
  const data = await loadAccountData(scope);
  const today = todayInManila();
  // Look payments and sales up per account instead of scanning every row for every account.
  const byEnrollment = paymentsByEnrollment(data.payments);
  const salesByAccount = new Map<string, (typeof data.sales)[number]>();
  for (const sale of data.sales) if (!salesByAccount.has(`${sale.memberNumber}\u0000${sale.programId}`)) salesByAccount.set(`${sale.memberNumber}\u0000${sale.programId}`, sale);
  const rows = data.accounts.filter((a) => !a.doi || a.doi <= today).map((account) => {
    try {
      const state = accountState(account, byEnrollment.get(account.id) ?? [], today);
      const sale = salesByAccount.get(`${account.memberNumber}\u0000${account.programId}`);
      return { ...account, ...state, applicationNumber: sale?.applicationNumber ?? "", registrationFee: sale?.registrationFee ?? 0, error: "" };
    } catch (error) { return { ...account, error: error instanceof Error ? error.message : "Review account data." }; }
  });
  return { today, month: today.slice(0, 7), rows };
}

export type ProgramStanding = { enrollmentId: string; programName: string; standing: "Temporarily suspended" | "Forfeited"; since: string; amountDue: number | null };

/** A member's program accounts that are temporarily suspended or forfeited today, to warn before new business. */
export async function memberStanding(memberId: string): Promise<ProgramStanding[]> {
  const report = await accountReport({ memberId });
  return report.rows.flatMap((row): ProgramStanding[] => {
    if (!("status" in row)) return [];
    if (row.status === "Forfeited") return [{ enrollmentId: row.id, programName: row.programName, standing: "Forfeited", since: row.forfeitedAt, amountDue: null }];
    if (row.temporarilySuspended) return [{ enrollmentId: row.id, programName: row.programName, standing: "Temporarily suspended", since: row.suspendedAt, amountDue: row.balance }];
    return [];
  });
}

/**
 * MAM for the chosen branch, MAS or member: only those accounts and their payments are loaded. `onlyMas` limits it to
 * that MAS's own accounts (lib/member-scope.ts) whatever else is chosen.
 */
export async function mamReport(from?: string, to?: string, onlyMas: string | null = null, filter: { branch?: string; mas?: string; memberId?: string } = {}) {
  const today = todayInManila();
  const scope: AccountScope = {};
  if (filter.branch) scope.branch = filter.branch;
  if (filter.memberId) scope.memberId = filter.memberId;
  // A MAS user's own name always wins over a chosen MAS.
  if (onlyMas !== null) scope.mas = onlyMas; else if (filter.mas) scope.mas = filter.mas;
  return buildMamReport(await loadAccountData(scope), from || today.slice(0, 7), to || today.slice(0, 7), today);
}

/** One member's MAM: each of their program accounts, month by month, from enrollment (at most the last 36 months) to today. */
export async function memberMam(memberId: string, onlyMas: string | null = null) {
  const today = todayInManila();
  const data = await loadAccountData(onlyMas === null ? { memberId } : { memberId, mas: onlyMas });
  const current = monthIndex(today.slice(0, 7));
  const earliest = Math.min(current, ...data.accounts.filter((account) => account.doi).map((account) => monthIndex(account.doi.slice(0, 7))));
  const from = monthName(Math.max(earliest, current - 35));
  return buildMamReport(data, from, today.slice(0, 7), today);
}

/** Stores each account's current status where it differs from the stored one, in one transaction. */
export async function syncAccountStatuses() {
  getEncoder();
  const report = await accountReport();
  const changed = new Map<string, string[]>();
  for (const row of report.rows) if ("status" in row && row.status !== row.storedStatus) changed.set(row.status, [...(changed.get(row.status) ?? []), row.id]);
  if (changed.size) await inTransaction(async (tx) => {
    for (const [status, ids] of changed) await tx.update(memberPrograms).set({ account_status: status }).where(inArray(memberPrograms.enrollment_id, ids));
  });
  return report;
}

export type NewCollection = typeof collections.$inferInsert;

/** Saves a Collections batch and the resulting account statuses inside the caller's transaction. */
export async function commitCollections(tx: Transaction, rows: NewCollection[], accounts: Account[], payments: AccountPayment[]) {
  const actor = getEncoder();
  await tx.insert(collections).values(rows.map((row) => ({ ...row, encoded_by_user_id: actor.userId, encoded_by_employee_id: actor.employeeId, encoded_by_name: actor.name, encoded_at: actor.encodedAt })));
  const byEnrollment = paymentsByEnrollment(payments);
  for (const account of accounts) {
    const status = accountState(account, byEnrollment.get(account.id) ?? []).status;
    if (status !== account.storedStatus) await tx.update(memberPrograms).set({ account_status: status }).where(eq(memberPrograms.enrollment_id, account.id));
  }
}
