import { and, eq, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";

import { accountState, COLLECTION_CHANNELS, firstCollectionNop, forfeitMonthsFor, incentiveRoleFor, monthIndex, monthName, saleNops, type AccountPayment } from "@/lib/account-rules";
import { loadAccountData } from "@/lib/account-data";
import { currentDb, inTransaction, schema, type Queryable, type Transaction } from "@/lib/db";
import { entryKey, recordedApplicationNumbers, recordedOrNumbers } from "@/lib/duplicate-entries";
import { DOI_TIME_MESSAGE, INCOMPLETE_APPLICATION_MESSAGE, isDoiTime, isIncompleteApplicationNumber } from "@/lib/entry-controls";
import { getBranches, getPrograms } from "@/lib/google-sheets-data";
import { normalizeOrNumber, orNumberProblem } from "@/lib/or-number";
import { fixedNewSaleAmount } from "@/lib/program-amount-lock";
import { recordCorrection } from "@/lib/record-corrections";
import { calculateRemittance, calculateSaleIncentive, tiersForBranch } from "@/lib/remittance";
import { manilaNow } from "@/lib/remittance-deadline";
import { findActivePaymentMethod, getPaymentMethods } from "@/lib/remittance-methods";

/**
 * Edit / Corrections: a whole entry (owner, October 15, 2026). IT and Administrators change any part of a New Sale or
 * Collection, remitted ones included, for example when the Entry Clerk chose the wrong program of a member with several:
 *
 *   Collection: the account it pays (another program of the same member), OR number, OR date, amount, months paid,
 *     Date Remitted. When the account, OR date or months change, the payments of the account(s) are numbered again in
 *     OR-date order from their first NOP (months follow the DOI), as scripts/fix-legacy-receipts.mjs does, and each
 *     account's history must still pass the account rules (lib/account-rules.ts) or nothing is saved.
 *   New Sale: the program (its account moves with it; when the member already has an account in that program, the two
 *     are merged: mergeAccountInto),
 *     application number, OR number, application date (the DOI follows while the account has no collections), DOI time
 *     (on the sale and its account; owner, October 19, 2026), amount,
 *     notes, remittance method, Date Remitted.
 *
 * When the amount, months, NOPs or program change, the entry's incentive and company share are worked out again (a
 * number or date fix keeps them), and so are those of every other payment whose program or NOPs changed with it
 * (repriceCollections), so reports, commissions and payroll follow the program. On a remittance slip, the slip's expected amount
 * follows the new share and its difference (actual less expected) shows any cash short or over. Other payments of a
 * renumbered account are recalculated when their NOPs change. One transaction; every change is in the Audit Log, and a
 * summary with the reason in Record Corrections.
 */
export type EditKind = "New Sale" | "Collection";
const text = (value: unknown) => String(value ?? "").trim();
const day = (value: unknown) => text(value).slice(0, 10);
const cents = (value: number) => Math.round(value * 100);
const round = (value: number) => cents(value) / 100;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];

const { sales, collections, member_programs: memberPrograms, members, programs } = schema;

export type EditAccount = { enrollmentId: string; programId: string; program: string; branch: string; mas: string; doi: string; rate: number; flexible: boolean; status: string };
export type EditableEntry = {
  kind: EditKind; id: string;
  member: { id: string; number: string; name: string };
  branch: string; person: string;
  remittance: { status: string; slipId: string; onSlip: boolean };
  /** The member's accounts (a Collection may move to another of them). */
  accounts: EditAccount[];
  /** Every program (a New Sale may change program). */
  programs: Array<{ id: string; name: string; rate: number; active: boolean }>;
  paymentMethods: string[];
  values: {
    enrollmentId: string; programId: string; orNumber: string; orDate: string; amount: number; dateRemitted: string;
    monthFrom: string; monthTo: string; nopFrom: number; nopTo: number;
    applicationNumber: string; notes: string; paymentMethod: string;
    /** New Sale: HH:MM, the time of the DOI; blank on sales saved before October 19, 2026. */
    doiTime: string;
  };
};

/** Everything the editor needs for one entry. */
export async function getEditableEntry(kind: EditKind, id: string): Promise<EditableEntry> {
  const db = currentDb();
  const [programList, methods] = await Promise.all([getPrograms(), getPaymentMethods()]);
  const programOptions = programList.map((program) => ({ id: program.id, name: program.name, rate: Number(program.basePay) || 0, active: program.status !== "inactive" })).sort((a, b) => a.name.localeCompare(b.name));
  const paymentMethods = methods.filter((method) => method.status === "active").map((method) => method.name);
  const accountsOf = async (memberId: string): Promise<EditAccount[]> => (await db.select({
    enrollmentId: memberPrograms.enrollment_id, programId: memberPrograms.program_id, program: programs.program_name, branch: memberPrograms.branch, mas: memberPrograms.mas,
    doi: memberPrograms.doi, rate: programs.base_pay, flexible: programs.flexible, status: memberPrograms.account_status,
  }).from(memberPrograms).innerJoin(programs, eq(programs.program_id, memberPrograms.program_id)).where(eq(memberPrograms.member_id, memberId)))
    .map((row) => ({ enrollmentId: row.enrollmentId, programId: row.programId, program: text(row.program), branch: text(row.branch), mas: text(row.mas), doi: day(row.doi), rate: Number(row.rate ?? 0), flexible: Boolean(row.flexible), status: text(row.status) }));
  const slip = (status: unknown, slipId: unknown) => ({ status: text(status) || "Outstanding", slipId: text(slipId), onSlip: !["", "Outstanding", "Returned"].includes(text(status)) });

  if (kind === "Collection") {
    const [row] = await db.select().from(collections).where(eq(collections.collection_id, text(id)));
    if (!row) throw new Error("Collection not found.");
    const [member] = await db.select().from(members).where(eq(members.member_id, row.member_id));
    return {
      kind, id: row.collection_id, member: { id: row.member_id, number: text(member?.member_number ?? row.member_number), name: [member?.first_name, member?.middle_name, member?.surname].map(text).filter(Boolean).join(" ") },
      branch: text(row.branch), person: text(row.accountable_name) || text(row.mas), remittance: slip(row.remittance_status, row.linked_remittance_id),
      accounts: await accountsOf(row.member_id), programs: programOptions, paymentMethods,
      values: {
        enrollmentId: row.enrollment_id, programId: row.program_id, orNumber: text(row.or_number), orDate: day(row.or_date), amount: Number(row.amount_collected), dateRemitted: day(row.date_remitted),
        monthFrom: text(row.month_from).slice(0, 7), monthTo: text(row.month_to).slice(0, 7), nopFrom: row.nop_from ?? 0, nopTo: row.nop_to ?? 0,
        applicationNumber: "", notes: "", paymentMethod: text(row.remittance_method), doiTime: "",
      },
    };
  }
  const [row] = await db.select().from(sales).where(eq(sales.sale_id, text(id)));
  if (!row) throw new Error("New Sale not found.");
  const [member] = await db.select().from(members).where(eq(members.member_number, text(row.member_number)));
  return {
    kind, id: row.sale_id, member: { id: text(member?.member_id), number: text(row.member_number), name: [row.first_name, row.middle_name, row.surname].map(text).filter(Boolean).join(" ") },
    branch: text(row.branch), person: text(row.mas), remittance: slip(row.remittance_status, row.linked_remittance_id),
    accounts: member ? await accountsOf(member.member_id) : [], programs: programOptions, paymentMethods,
    values: {
      enrollmentId: "", programId: row.program_id, orNumber: text(row.or_number), orDate: day(row.or_date), amount: Number(row.amount_paid ?? 0), dateRemitted: day(row.date_remitted),
      monthFrom: "", monthTo: "", nopFrom: 0, nopTo: 0, applicationNumber: text(row.application_no), notes: text(row.notes), paymentMethod: text(row.payment_method),
      doiTime: text(row.doi_time).slice(0, 5),
    },
  };
}

export type EntryEditInput = {
  kind: EditKind; id: string; reason: string;
  enrollmentId?: string; programId?: string; orNumber?: string; orDate?: string; amount?: number; dateRemitted?: string;
  /** Collections: number of months the payment covers. */
  months?: number;
  applicationNumber?: string; notes?: string; paymentMethod?: string;
  /** New Sale: HH:MM; blank keeps no time. */
  doiTime?: string;
};

/** Saves an edited entry; returns a message saying what changed. */
export async function saveEntryEdit(input: EntryEditInput) {
  const reason = text(input.reason);
  if (reason.length < 3 || reason.length > 300) throw new Error("Give the reason for the correction (3 to 300 characters).");
  const result = await inTransaction((tx) => (input.kind === "Collection" ? editCollection(tx, input) : editSale(tx, input)));
  if (!result.changed) return "Nothing was changed.";
  // The saved edit stands even if the correction log cannot be written; the Audit Log has every change as well.
  await recordCorrection(`Edit ${input.kind}`, input.id, reason, result.before, result.after).catch(() => {});
  return `${input.kind} ${input.id} saved: ${result.summary}.`;
}

type Outcome = { changed: boolean; summary: string; before: Record<string, unknown>; after: Record<string, unknown> };

/** The slip's line for this entry and its expected amount follow the entry's new company share. */
export async function followSlip(tx: Queryable, entryId: string, slipId: string, newDue: number) {
  if (!slipId) return null;
  const [link] = rowsOf<{ amount: number }>(await tx.execute(sql`select coalesce(amount, 0)::float8 as amount from remittance_collections where remittance_id = ${slipId} and collection_id = ${entryId} limit 1`));
  if (!link) return null;
  const delta = round(newDue - Number(link.amount));
  if (!delta) return null;
  await tx.execute(sql`update remittance_collections set amount = ${newDue} where remittance_id = ${slipId} and collection_id = ${entryId}`);
  const [slip] = rowsOf<{ expected: number; actual: number }>(await tx.execute(sql`update remittances set gross_collection = round((coalesce(gross_collection, 0) + ${delta})::numeric, 2),
      difference = round((coalesce(total_remittance, 0) - coalesce(gross_collection, 0) - ${delta})::numeric, 2)
    where remittance_id = ${slipId} returning gross_collection::float8 as expected, coalesce(total_remittance, 0)::float8 as actual`));
  return { slipId, expectedChange: delta, expected: Number(slip?.expected ?? 0), difference: round(Number(slip?.actual ?? 0) - Number(slip?.expected ?? 0)) };
}

/**
 * Works out again the incentive and company share of collections whose program or NOPs changed (owner, October 15,
 * 2026: reports, commissions and payroll read the incentive as amount less company share, so they must follow the
 * program). A forfeited incentive stays forfeited (the whole amount is the company's), as does one marked No incentive
 * (no_incentive_reason, owner, October 20, 2026). On a remittance slip, the slip's
 * expected amount follows. Missing or conflicting tiers stop the correction so stale figures cannot be saved.
 * Returns how many changed and the slips touched.
 */
export async function repriceCollections(tx: Queryable, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return { repriced: 0, slips: [] as string[], unpriced: [] as string[] };
  const rows = await tx.select().from(collections).where(and(sql`${collections.collection_id} in (${sql.join(unique.map((id) => sql`${id}`), sql`, `)})`, eq(collections.status, "Posted")));
  const data = await loadAccountData({ enrollmentIds: [...new Set(rows.map((row) => row.enrollment_id))], includeDeactivated: true }, tx);
  const branchIds = new Map((await getBranches()).map((branch) => [branch.name.trim().toLowerCase(), branch.id]));
  let repriced = 0;
  const slips = new Set<string>(), unpriced: string[] = [];
  for (const row of rows) {
    const account = data.accounts.find((item) => item.id === row.enrollment_id);
    if (!account || !row.nop_from || !row.nop_to) continue;
    const channel = (COLLECTION_CHANNELS as readonly string[]).includes(text(row.collected_by_role)) ? text(row.collected_by_role) : "MAS";
    const orc = channel === "Collector" && Array.isArray(row.remittance_breakdown) && (row.remittance_breakdown as Array<{ orc?: boolean }>).some((item) => item?.orc === true);
    const amount = Number(row.amount_collected);
    let quote: ReturnType<typeof calculateRemittance>;
    try { quote = calculateRemittance(account.basePay, tiersForBranch(data.incentives.filter((tier) => tier.programId === account.programId), row.branch_id || branchIds.get(text(row.branch).toLowerCase()) || ""), incentiveRoleFor(channel), row.nop_from, row.nop_to, amount, account.flexible, account.maxMonthlyPayment, { orc, reactivation: row.reactivation === true }); }
    catch (error) { throw new Error(`Cannot recalculate incentives for ${row.collection_id}: ${error instanceof Error ? error.message : "invalid incentive configuration"} Nothing was saved.`); }
    const forfeited = Number(row.forfeited_incentive ?? 0) > 0 || Boolean(text(row.no_incentive_reason));
    const share = forfeited ? amount : quote.remittance;
    const forfeit = forfeited ? round(amount - quote.remittance) : row.forfeited_incentive;
    if (cents(share) === cents(Number(row.remittance_amount ?? 0)) && Number(forfeit ?? 0) === Number(row.forfeited_incentive ?? 0) && isDeepStrictEqual(row.remittance_breakdown, quote.breakdown)) continue;
    await tx.update(collections).set({ remittance_amount: share, remittance_breakdown: quote.breakdown, forfeited_incentive: forfeit }).where(eq(collections.collection_id, row.collection_id));
    if (text(row.linked_remittance_id) && !["", "Outstanding", "Returned"].includes(text(row.remittance_status)) && await followSlip(tx, row.collection_id, text(row.linked_remittance_id), share)) slips.add(text(row.linked_remittance_id));
    repriced++;
  }
  return { repriced, slips: [...slips], unpriced };
}

/** The same for New Sales whose program changed: incentive and company share from the sale's program. */
export async function repriceSales(tx: Queryable, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return { repriced: 0, slips: [] as string[], unpriced: [] as string[] };
  const rows = await tx.select().from(sales).where(sql`${sales.sale_id} in (${sql.join(unique.map((id) => sql`${id}`), sql`, `)})`);
  const [programList, branches] = await Promise.all([getPrograms(), getBranches()]);
  let repriced = 0;
  const slips = new Set<string>(), unpriced: string[] = [];
  for (const row of rows) {
    const program = programList.find((item) => item.id === row.program_id);
    if (!program) continue;
    const amount = Number(row.amount_paid ?? 0);
    const branchId = row.branch_id || branches.find((branch) => branch.name.trim().toLowerCase() === text(row.branch).toLowerCase())?.id || "";
    let quote: ReturnType<typeof calculateSaleIncentive>;
    try { quote = calculateSaleIncentive({ ...program, incentiveTiers: tiersForBranch(program.incentiveTiers, branchId) }, amount); }
    catch (error) { throw new Error(`Cannot recalculate incentives for ${row.sale_id}: ${error instanceof Error ? error.message : "invalid incentive configuration"} Nothing was saved.`); }
    const forfeited = Number(row.forfeited_incentive ?? 0) > 0 || Boolean(text(row.no_incentive_reason));
    const share = forfeited ? amount : quote.remittance;
    if (cents(share) === cents(Number(row.remittance_amount ?? 0)) && cents(amount - share) === cents(Number(row.mas_incentive ?? 0)) && (!forfeited || cents(quote.incentive) === cents(Number(row.forfeited_incentive ?? 0)))) continue;
    await tx.update(sales).set({ remittance_amount: share, mas_incentive: round(amount - share), forfeited_incentive: forfeited ? quote.incentive : row.forfeited_incentive }).where(eq(sales.sale_id, row.sale_id));
    if (text(row.linked_remittance_id) && !["", "Outstanding", "Returned"].includes(text(row.remittance_status)) && await followSlip(tx, row.sale_id, text(row.linked_remittance_id), share)) slips.add(text(row.linked_remittance_id));
    repriced++;
  }
  return { repriced, slips: [...slips], unpriced };
}

/**
 * Merges a member's account into their other account (owner, October 16, 2026: a program can be moved even when the
 * member's account in the target program already has payments). Every payment of both goes to the target account,
 * numbered one after another in OR-date order from the lowest NOP either had, on the target's numbering (saleNops), each
 * keeping its number of months (or, with sourceMonths, the source's receipts counted again at the target's pay); months
 * continue from that payment's own first month (numberingStart), and the target keeps the earlier DOI. This is the October 4 repair
 * rule (scripts/fix-legacy-receipts.mjs). The combined history must pass the account rules with the target program,
 * or this throws and the caller's transaction saves nothing. Transfer records follow; the source account is deleted.
 * The callers move the New Sale and work out the incentives again.
 */
export async function mergeAccountInto(tx: Queryable, sourceId: string, targetId: string, today = manilaNow().date, sourceMonths?: (payment: AccountPayment) => number, { anyMember = false }: { anyMember?: boolean } = {}) {
  const data = await loadAccountData({ enrollmentIds: [sourceId, targetId], includeDeactivated: true }, tx, { lock: true });
  const source = data.accounts.find((account) => account.id === sourceId), target = data.accounts.find((account) => account.id === targetId);
  if (!source || !target) throw new Error("The accounts to merge were not found.");
  // anyMember: a member merge (lib/member-corrections.ts) joins the two people's accounts in the same program first.
  if (source.memberId !== target.memberId && !anyMember) throw new Error("Only two accounts of the same member can be merged.");
  const doi = [source.doi, target.doi].filter(Boolean).sort()[0] ?? "";
  const fromSource = new Set(data.payments.filter((payment) => payment.enrollmentId === source.id).map((payment) => payment.id));
  const payments = data.payments.map((payment) => ({ ...payment, enrollmentId: target.id }));
  // Where numbering starts: the lowest NOP (moved onto the target's numbering when the two programs differ in registration
  // fee) and that payment's own first month.
  const owner = (payment: AccountPayment) => (fromSource.has(payment.id) ? source : target);
  const start = numberingStart(data.payments.map((payment) => ({ nop: payment.nopFrom - saleNops(owner(payment)) + saleNops(target), month: payment.monthFrom })), { doi, registrationFee: target.registrationFee });
  // sourceMonths: the source's payments counted again at the target's monthly pay (a move between programs of different pay).
  const renumbered = renumber(start, payments, (payment) => sourceMonths && fromSource.has(payment.id) ? sourceMonths(payment) : Math.max(1, payment.nopTo - payment.nopFrom + 1));
  let status: string;
  try { status = accountState({ ...target, doi }, renumbered, today).status; }
  catch (error) { throw new Error(`The payments of ${source.programName} and ${target.programName} do not fit together on one account (${error instanceof Error ? error.message : "coverage"}). Nothing was saved.`); }
  for (const payment of renumbered) {
    await tx.update(collections).set({ enrollment_id: target.id, program_id: target.programId, nop_from: payment.nopFrom, nop_to: payment.nopTo, month_from: payment.monthFrom, month_to: payment.monthTo }).where(eq(collections.collection_id, payment.id));
  }
  // Payments that are not Posted (voided) follow the account too, without numbers changing.
  await tx.update(collections).set({ enrollment_id: target.id, program_id: target.programId }).where(eq(collections.enrollment_id, source.id));
  await tx.update(schema.member_transfers).set({ enrollment_id: target.id, program_id: target.programId }).where(eq(schema.member_transfers.enrollment_id, source.id));
  await tx.update(memberPrograms).set({ doi: doi || null, account_status: status }).where(eq(memberPrograms.enrollment_id, target.id));
  await tx.delete(memberPrograms).where(eq(memberPrograms.enrollment_id, source.id));
  const moved = data.payments.filter((payment) => payment.enrollmentId === source.id).length;
  const changed = renumbered.filter((payment) => { const old = data.payments.find((item) => item.id === payment.id); return old && (old.nopFrom !== payment.nopFrom || old.nopTo !== payment.nopTo || old.monthFrom !== payment.monthFrom); }).length;
  return { status, doi, moved, renumbered: changed, collectionIds: renumbered.map((payment) => payment.id), target: target.id };
}

/** Where an account's numbering starts: a NOP and the month it covers. */
export type NumberingStart = { nop: number; month: string };

/**
 * The start of an account's numbering (owner, October 21, 2026: moves between programs mixed up Month of and NOP): its
 * lowest-NOP payment's NOP and that payment's own first month, so the history keeps where it began. Months used to be
 * worked out again from the DOI, which shifted every month on accounts whose DOI and NOPs do not line up (most from the
 * old system). With no payment: the first collection NOP and the month after DOI.
 */
export function numberingStart(starts: Array<{ nop: number; month: string }>, account: { doi: string; registrationFee?: boolean | null }): NumberingStart {
  const valid = starts.map((item) => ({ nop: item.nop, month: String(item.month ?? "").slice(0, 7) })).filter((item) => item.nop > 0 && /^\d{4}-\d{2}$/.test(item.month))
    .sort((a, b) => a.nop - b.nop || a.month.localeCompare(b.month));
  return valid[0] ?? { nop: firstCollectionNop(account), month: monthName(monthIndex(account.doi.slice(0, 7)) + 1) };
}

/**
 * Numbers an account's payments again in OR-date order from `start` (numberingStart); `count` gives each payment's
 * months, and each NOP keeps the same distance from the start's month.
 */
export function renumber(start: NumberingStart, payments: AccountPayment[], count: (payment: AccountPayment) => number) {
  const ordered = [...payments].sort((a, b) => a.orDate.localeCompare(b.orDate) || a.nopFrom - b.nopFrom || a.id.localeCompare(b.id));
  let next = start.nop;
  const base = monthIndex(start.month) - start.nop;
  return ordered.map((payment) => {
    const months = count(payment), nopFrom = next, nopTo = next + months - 1;
    next = nopTo + 1;
    return { ...payment, nopFrom, nopTo, monthFrom: monthName(base + nopFrom), monthTo: monthName(base + nopTo) };
  });
}

/** A program's pay, for counting a receipt's months in it. */
export type PayRule = { name: string; rate: number; flexible: boolean; max: number | null };
const peso = (value: number) => `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

/**
 * The months each receipt covers in the target program, or null when they stay as they are (same pay). A fixed program:
 * the amount ÷ its monthly pay, which must be a whole number of months. A flexible one: the months the receipt had when
 * each still gets the minimum, otherwise as many whole minimums as it holds, and never above the monthly maximum.
 * Throws, naming the receipt, when the amount does not work out.
 */
export function receiptMonthsAt(from: PayRule, to: PayRule) {
  if (Math.round(from.rate * 100) === Math.round(to.rate * 100) && from.flexible === to.flexible) return null;
  const rate = Math.round(to.rate * 100);
  if (rate <= 0) throw new Error(`${to.name} has no monthly pay.`);
  return (payment: AccountPayment) => {
    const paid = Math.round(payment.amount * 100), had = Math.max(1, payment.nopTo - payment.nopFrom + 1);
    const months = to.flexible ? (paid >= rate * had ? had : Math.floor(paid / rate)) : paid % rate === 0 ? paid / rate : 0;
    const receipt = `OR ${payment.orNumber || payment.id} (${peso(payment.amount)})`;
    if (months < 1) throw new Error(to.flexible ? `${receipt} is less than the ${peso(to.rate)} minimum of ${to.name}.` : `${receipt} is not a whole number of ${peso(to.rate)} months of ${to.name}.`);
    if (to.flexible && to.max && paid > Math.round(to.max * 100) * months) throw new Error(`${receipt} is more than the ${peso(to.max)} monthly maximum of ${to.name}.`);
    return months;
  };
}

async function editCollection(tx: Transaction, input: EntryEditInput): Promise<Outcome> {
  const [row] = await tx.select().from(collections).where(eq(collections.collection_id, text(input.id))).for("update");
  if (!row) throw new Error("Collection not found.");
  if (text(row.status) !== "Posted") throw new Error("Only a posted collection can be edited.");
  const today = manilaNow().date;
  const targetId = text(input.enrollmentId) || row.enrollment_id;
  const data = await loadAccountData({ enrollmentIds: [...new Set([row.enrollment_id, targetId])], includeDeactivated: true }, tx, { lock: true });
  const from = data.accounts.find((account) => account.id === row.enrollment_id);
  const to = data.accounts.find((account) => account.id === targetId);
  if (!from || !to) throw new Error("The account was not found.");
  if (to.memberId !== row.member_id) throw new Error("A collection can only move to another account of the same member.");

  const orNumber = normalizeOrNumber(text(input.orNumber ?? row.or_number));
  const orDate = day(input.orDate ?? row.or_date);
  const amount = round(Number(input.amount ?? row.amount_collected));
  const dateRemitted = day(input.dateRemitted ?? row.date_remitted);
  const oldMonths = Math.max(1, (row.nop_to ?? 0) - (row.nop_from ?? 0) + 1);
  const months = Number(input.months ?? oldMonths);
  if (!orNumber) throw new Error("OR number is required.");
  if (entryKey(orNumber) !== entryKey(row.or_number)) {
    const problem = orNumberProblem(orNumber);
    if (problem) throw new Error(problem);
    const used = (await recordedOrNumbers([orNumber], tx)).get(entryKey(orNumber));
    if (used && used.collectionId !== row.collection_id) throw new Error(`OR Number ${orNumber} is already recorded on collection ${used.collectionId}.`);
  }
  if (!validDate(orDate) || orDate > today) throw new Error("Enter a valid OR date, today or earlier.");
  if (dateRemitted && (!validDate(dateRemitted) || dateRemitted < orDate)) throw new Error("The Date Remitted must be a valid date on or after the OR date.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount greater than zero.");
  if (!Number.isInteger(months) || months < 1 || months > 120) throw new Error("Enter the number of months paid (1 to 120).");

  // Numbered again when the account, its order or its months change; otherwise every NOP stays.
  const moved = to.id !== from.id;
  const reorder = moved || orDate !== day(row.or_date) || months !== oldMonths;
  const edited: AccountPayment = { id: row.collection_id, enrollmentId: to.id, orDate, orNumber, monthFrom: text(row.month_from).slice(0, 7), monthTo: text(row.month_to).slice(0, 7), nopFrom: row.nop_from ?? 0, nopTo: row.nop_to ?? 0, amount, dateRemitted: dateRemitted || orDate, mas: text(row.mas) };
  const others = (accountId: string) => data.payments.filter((payment) => payment.enrollmentId === accountId && payment.id !== row.collection_id);
  const span = (payment: AccountPayment) => (payment.id === row.collection_id ? months : Math.max(1, payment.nopTo - payment.nopFrom + 1));
  const plans = new Map<string, AccountPayment[]>();
  // Where an account's numbering starts: its lowest NOP and that payment's own month (the edited payment counts only on
  // its own account), else its first collection NOP and the month after DOI. A payment moving between accounts whose
  // programs differ in registration fee keeps its month.
  const firstNop = (accountId: string, withEdited: boolean) => {
    const account = accountId === to.id ? to : from;
    const shift = (payment: AccountPayment) => payment.id === row.collection_id ? saleNops(account) - saleNops(from) : 0;
    return numberingStart([...others(accountId), ...(withEdited ? [edited] : [])].map((payment) => ({ nop: payment.nopFrom + shift(payment), month: payment.monthFrom })), account);
  };
  if (reorder) {
    // The edited payment takes its place among the target account's payments by OR date.
    plans.set(to.id, renumber(firstNop(to.id, !moved), [...others(to.id), edited], span));
    if (moved) plans.set(from.id, renumber(firstNop(from.id, true), others(from.id), span));
  } else plans.set(to.id, [...others(to.id), edited]);
  const statuses = new Map<string, string>();
  for (const account of [to, ...(moved ? [from] : [])]) {
    const list = plans.get(account.id) ?? [];
    try { statuses.set(account.id, accountState(account, list, today).status); }
    catch (error) { throw new Error(`${account.programName} account ${account.id}: ${error instanceof Error ? error.message : "the payments do not fit"} Nothing was saved.`); }
  }
  const mine = (plans.get(to.id) ?? []).find((payment) => payment.id === row.collection_id) ?? edited;

  // The company share at the payment's NOPs, for the role that collected it; a forfeited incentive stays forfeited.
  const channel = (COLLECTION_CHANNELS as readonly string[]).includes(text(row.collected_by_role)) ? text(row.collected_by_role) : "MAS";
  const branches = await getBranches();
  const branchId = branches.find((branch) => branch.name.trim().toLowerCase() === text(row.branch).toLowerCase())?.id ?? "";
  const orc = channel === "Collector" && Array.isArray(row.remittance_breakdown) && (row.remittance_breakdown as Array<{ orc?: boolean }>).some((item) => item?.orc === true);
  const quote = calculateRemittance(to.basePay, tiersForBranch(data.incentives.filter((tier) => tier.programId === to.programId), branchId), incentiveRoleFor(channel), mine.nopFrom, mine.nopTo, amount, to.flexible, to.maxMonthlyPayment, { orc, reactivation: row.reactivation === true });
  const forfeited = Number(row.forfeited_incentive ?? 0) > 0 || Boolean(text(row.no_incentive_reason));
  // The share is worked out again only when what it depends on changed; a receipt-number or date fix keeps the share
  // the entry was remitted with (imported entries carry their old system's figures).
  const repriced = moved || cents(amount) !== cents(Number(row.amount_collected)) || mine.nopFrom !== (row.nop_from ?? 0) || mine.nopTo !== (row.nop_to ?? 0);
  const share = !repriced ? Number(row.remittance_amount ?? 0) : forfeited ? amount : quote.remittance;

  const after = {
    enrollment_id: to.id, program_id: to.programId, or_number: orNumber, or_date: orDate, amount_collected: amount, date_remitted: dateRemitted || null,
    month_from: mine.monthFrom, month_to: mine.monthTo, nop_from: mine.nopFrom, nop_to: mine.nopTo, remittance_amount: share, forfeited_incentive: repriced && forfeited ? round(amount - quote.remittance) : row.forfeited_incentive,
  };
  const before = {
    enrollment_id: row.enrollment_id, program_id: row.program_id, or_number: text(row.or_number), or_date: day(row.or_date), amount_collected: Number(row.amount_collected), date_remitted: day(row.date_remitted) || null,
    month_from: text(row.month_from).slice(0, 7), month_to: text(row.month_to).slice(0, 7), nop_from: row.nop_from, nop_to: row.nop_to, remittance_amount: Number(row.remittance_amount ?? 0), forfeited_incentive: row.forfeited_incentive,
  };
  const changedKeys = (Object.keys(after) as Array<keyof typeof after>).filter((key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]));
  if (!changedKeys.length) return { changed: false, summary: "", before, after };

  await tx.update(collections).set({ ...after, ...(repriced ? { remittance_breakdown: quote.breakdown } : {}) }).where(eq(collections.collection_id, row.collection_id));
  const renumbered: Array<{ id: string; nop: string }> = [];
  for (const list of plans.values()) for (const payment of list) {
    if (payment.id === row.collection_id) continue;
    const old = data.payments.find((item) => item.id === payment.id);
    if (old && (old.nopFrom !== payment.nopFrom || old.nopTo !== payment.nopTo || old.monthFrom !== payment.monthFrom || old.monthTo !== payment.monthTo)) {
      await tx.update(collections).set({ nop_from: payment.nopFrom, nop_to: payment.nopTo, month_from: payment.monthFrom, month_to: payment.monthTo }).where(eq(collections.collection_id, payment.id));
      renumbered.push({ id: payment.id, nop: `${old.nopFrom}-${old.nopTo} → ${payment.nopFrom}-${payment.nopTo}` });
    }
  }
  for (const [accountId, status] of statuses) await tx.update(memberPrograms).set({ account_status: status }).where(eq(memberPrograms.enrollment_id, accountId));
  // Renumbered payments sit at other NOPs now, so their incentives follow too.
  const followed = await repriceCollections(tx, renumbered.map((item) => item.id));
  const slip = repriced && text(row.linked_remittance_id) && !["", "Outstanding", "Returned"].includes(text(row.remittance_status)) ? await followSlip(tx, row.collection_id, text(row.linked_remittance_id), share) : null;

  const parts = [moved ? `moved from ${from.programName} to ${to.programName}` : "", changedKeys.filter((key) => !["enrollment_id", "program_id", "month_from", "month_to", "nop_from", "nop_to", "remittance_amount", "forfeited_incentive"].includes(key)).map((key) => key.replace(/_/g, " ")).join(", "),
    reorder ? `NOP ${mine.nopFrom}${mine.nopTo > mine.nopFrom ? `-${mine.nopTo}` : ""} (${mine.monthFrom}${mine.monthTo !== mine.monthFrom ? ` to ${mine.monthTo}` : ""})` : "",
    renumbered.length ? `${renumbered.length} other payment(s) renumbered${followed.repriced ? `, ${followed.repriced} with new incentives` : ""}${followed.unpriced.length ? ` (${followed.unpriced.length} kept their figures: no incentive tiers)` : ""}` : "", slip ? `slip ${slip.slipId} expected ${slip.expectedChange > 0 ? "+" : ""}${slip.expectedChange.toFixed(2)} (difference ${slip.difference.toFixed(2)})` : ""].filter(Boolean);
  return { changed: true, summary: parts.join("; "), before, after: { ...after, renumbered, repricedOthers: followed, statuses: Object.fromEntries(statuses), slip } };
}

async function editSale(tx: Transaction, input: EntryEditInput): Promise<Outcome> {
  const [row] = await tx.select().from(sales).where(eq(sales.sale_id, text(input.id))).for("update");
  if (!row) throw new Error("New Sale not found.");
  const today = manilaNow().date;
  const programList = await getPrograms();
  const programId = text(input.programId) || row.program_id;
  const program = programList.find((item) => item.id === programId);
  if (!program) throw new Error("Choose a program.");
  const applicationNumber = text(input.applicationNumber ?? row.application_no);
  const orNumber = text(input.orNumber ?? row.or_number);
  const orDate = day(input.orDate ?? row.or_date);
  const amount = round(Number(input.amount ?? row.amount_paid));
  const notes = text(input.notes ?? row.notes);
  const dateRemitted = day(input.dateRemitted ?? row.date_remitted);
  const doiTime = text(input.doiTime ?? text(row.doi_time).slice(0, 5));
  if (doiTime && !isDoiTime(doiTime)) throw new Error(DOI_TIME_MESSAGE);
  const method = text(input.paymentMethod) && text(input.paymentMethod) !== text(row.payment_method) ? (await findActivePaymentMethod(text(input.paymentMethod))).name : text(row.payment_method);
  if (!applicationNumber) throw new Error("The application number is required.");
  if (entryKey(applicationNumber) !== entryKey(row.application_no)) {
    if (isIncompleteApplicationNumber(applicationNumber)) throw new Error(INCOMPLETE_APPLICATION_MESSAGE);
    const used = (await recordedApplicationNumbers([applicationNumber], tx)).get(entryKey(applicationNumber));
    if (used && used.saleId !== row.sale_id) throw new Error(`Application number ${applicationNumber} is already recorded on sale ${used.saleId}.`);
  }
  if (orDate && (!validDate(orDate) || orDate > today)) throw new Error("Enter a valid application date, today or earlier.");
  if (dateRemitted && (!validDate(dateRemitted) || (orDate && dateRemitted < orDate))) throw new Error("The Date Remitted must be a valid date on or after the application date.");
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter a valid amount paid.");
  if (program.flexible && cents(amount) < cents(fixedNewSaleAmount(program))) throw new Error(`${program.name} needs at least ${fixedNewSaleAmount(program)}.`);
  if (!program.flexible && !program.newSaleAmountEditable && cents(amount) !== cents(fixedNewSaleAmount(program))) throw new Error(`${program.name} has a fixed New Sale amount of ${fixedNewSaleAmount(program)}.`);

  // The account this New Sale opened: the member's account in the sale's program.
  const [account] = await tx.select().from(memberPrograms).where(and(eq(memberPrograms.member_number, text(row.member_number)), eq(memberPrograms.program_id, row.program_id))).for("update");
  const changesProgram = programId !== row.program_id;
  let accountNote = "", status: string | null = null, doi = day(account?.doi), mergeTarget = "";
  // Moving to another program: with a different monthly pay each receipt is counted again at the new pay (as a program
  // transfer does); with a different registration fee the NOPs shift by one so the months stay (saleNops).
  let renumberedPaid: AccountPayment[] | null = null;
  if (account) {
    const data = await loadAccountData({ enrollmentIds: [account.enrollment_id], includeDeactivated: true }, tx, { lock: true });
    const loaded = data.accounts[0];
    const paid = data.payments.filter((payment) => payment.enrollmentId === account.enrollment_id);
    // The New Sale is the account's first month: the DOI follows the application date while nothing else is paid.
    if (orDate && orDate !== day(row.or_date) && doi === day(row.or_date) && !paid.length) doi = orDate;
    if (changesProgram) {
      const [existing] = await tx.select({ id: memberPrograms.enrollment_id }).from(memberPrograms).where(and(eq(memberPrograms.member_id, account.member_id), eq(memberPrograms.program_id, programId)));
      mergeTarget = existing?.id ?? "";
    }
    // Merging into the member's existing account is checked there (mergeAccountInto); otherwise the account moves as it is.
    if (!mergeTarget) try {
      if (changesProgram) {
        const nopShift = saleNops({ registrationFee: program.registrationFeeRequired }) - saleNops(loaded);
        const recount = receiptMonthsAt({ name: loaded.programName, rate: loaded.basePay, flexible: Boolean(loaded.flexible), max: loaded.maxMonthlyPayment ?? null }, { name: program.name, rate: Number(program.basePay) || 0, flexible: Boolean(program.flexible), max: program.maxMonthlyPayment ?? null });
        const posted = paid.filter((payment) => payment.nopFrom > 0);
        if (recount) renumberedPaid = renumber(numberingStart(posted.map((payment) => ({ nop: payment.nopFrom + nopShift, month: payment.monthFrom })), { doi, registrationFee: program.registrationFeeRequired }), posted, recount);
        else if (nopShift) renumberedPaid = posted.map((payment) => ({ ...payment, nopFrom: payment.nopFrom + nopShift, nopTo: payment.nopTo + nopShift }));
      }
      const shifted = renumberedPaid ?? paid;
      status = accountState({ ...loaded, programId, doi, basePay: Number(program.basePay) || 0, payBalanceTotal: Number(program.payBalanceTotal) || 0, flexible: program.flexible, maxMonthlyPayment: program.maxMonthlyPayment ?? null, forfeitMonths: forfeitMonthsFor(program.categoryId), registrationFee: program.registrationFeeRequired }, shifted, today).status;
    }
    catch (error) { throw new Error(`${program.name}: ${error instanceof Error ? error.message : "the account's payments do not fit"} Nothing was saved.`); }
    if (changesProgram && !mergeTarget) accountNote = `account ${account.enrollment_id} and its ${paid.length} collection(s) moved to ${program.name}`;
  } else if (changesProgram) accountNote = "no account was found for this New Sale; only the sale changed";

  const branchId = (await getBranches()).find((branch) => branch.name.trim().toLowerCase() === text(row.branch).toLowerCase())?.id ?? "";
  const quote = calculateSaleIncentive({ ...program, incentiveTiers: tiersForBranch(program.incentiveTiers, branchId) }, amount);
  const forfeited = Number(row.forfeited_incentive ?? 0) > 0 || Boolean(text(row.no_incentive_reason));
  // As for collections: worked out again only when the amount or program changed.
  const repriced = changesProgram || cents(amount) !== cents(Number(row.amount_paid ?? 0));
  const share = !repriced ? Number(row.remittance_amount ?? 0) : forfeited ? amount : quote.remittance;
  const after = {
    program_id: programId, application_no: applicationNumber, or_number: orNumber || null, or_date: orDate || null, doi: doi || null, doi_time: doiTime || null, amount_paid: amount, notes: notes || null,
    payment_method: method || null, date_remitted: dateRemitted || null, mas_incentive: repriced ? round(amount - share) : Number(row.mas_incentive ?? 0), remittance_amount: share, forfeited_incentive: repriced && forfeited ? quote.incentive : row.forfeited_incentive,
  };
  const before = {
    program_id: row.program_id, application_no: text(row.application_no), or_number: text(row.or_number) || null, or_date: day(row.or_date) || null, doi: day(row.doi) || null, doi_time: text(row.doi_time).slice(0, 5) || null, amount_paid: Number(row.amount_paid ?? 0), notes: text(row.notes) || null,
    payment_method: text(row.payment_method) || null, date_remitted: day(row.date_remitted) || null, mas_incentive: Number(row.mas_incentive ?? 0), remittance_amount: Number(row.remittance_amount ?? 0), forfeited_incentive: row.forfeited_incentive,
  };
  const changedKeys = (Object.keys(after) as Array<keyof typeof after>).filter((key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]));
  if (!changedKeys.length) return { changed: false, summary: "", before, after };

  await tx.update(sales).set(after).where(eq(sales.sale_id, row.sale_id));
  if (account && mergeTarget) {
    // The member already has an account in the new program: this account's payments join it (renumbered in OR-date order).
    const merged = await mergeAccountInto(tx, account.enrollment_id, mergeTarget, today);
    const followed = await repriceCollections(tx, merged.collectionIds);
    const [{ n }] = rowsOf<{ n: number }>(await tx.execute(sql`select count(*)::int as n from sales where member_number = ${text(row.member_number)} and program_id = ${programId}`));
    accountNote = `account ${account.enrollment_id} merged into the member's ${program.name} account ${mergeTarget} (${merged.moved} collection(s) joined, ${merged.renumbered} renumbered, status ${merged.status})`
      + (followed.repriced ? `; ${followed.repriced} collection(s) with new incentives${followed.slips.length ? ` (slips ${followed.slips.join(", ")} follow)` : ""}` : "")
      + (Number(n) > 1 ? `; the member now has ${n} New Sales in ${program.name}: delete the extra one if it was entered twice` : "");
  } else if (account) {
    await tx.update(memberPrograms).set({ program_id: programId, doi: doi || null, doi_time: doiTime || null, amount_paid: amount, remittance_method: method || null, ...(status ? { account_status: status } : {}) }).where(eq(memberPrograms.enrollment_id, account.enrollment_id));
    if (changesProgram) {
      await tx.update(collections).set({ program_id: programId }).where(eq(collections.enrollment_id, account.enrollment_id));
      for (const payment of renumberedPaid ?? []) await tx.update(collections).set({ nop_from: payment.nopFrom, nop_to: payment.nopTo, month_from: payment.monthFrom, month_to: payment.monthTo }).where(eq(collections.collection_id, payment.id));
      const moved = await tx.select({ id: collections.collection_id }).from(collections).where(eq(collections.enrollment_id, account.enrollment_id));
      const followed = await repriceCollections(tx, moved.map((item) => item.id));
      if (followed.repriced) accountNote += `; ${followed.repriced} collection(s) with new incentives${followed.slips.length ? ` (slips ${followed.slips.join(", ")} follow)` : ""}`;
      if (followed.unpriced.length) accountNote += `; ${followed.unpriced.length} collection(s) kept their figures: ${program.name} has no incentive tiers for their NOPs`;
      await tx.update(schema.member_transfers).set({ program_id: programId }).where(eq(schema.member_transfers.enrollment_id, account.enrollment_id));
    }
  }
  const slip = repriced && text(row.linked_remittance_id) && !["", "Outstanding", "Returned"].includes(text(row.remittance_status)) ? await followSlip(tx, row.sale_id, text(row.linked_remittance_id), share) : null;
  const shown = changedKeys.filter((key) => !["mas_incentive", "remittance_amount", "forfeited_incentive", "doi"].includes(key)).map((key) => key === "program_id" ? `program (${program.name})` : key === "doi_time" ? `DOI time ${doiTime || "cleared"}` : key.replace(/_/g, " "));
  const parts = [shown.join(", "), accountNote, after.doi !== before.doi ? `DOI ${after.doi}` : "", slip ? `slip ${slip.slipId} expected ${slip.expectedChange > 0 ? "+" : ""}${slip.expectedChange.toFixed(2)} (difference ${slip.difference.toFixed(2)})` : ""].filter(Boolean);
  return { changed: true, summary: parts.join("; "), before, after: { ...after, account: account?.enrollment_id ?? null, status, slip } };
}
