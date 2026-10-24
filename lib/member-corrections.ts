import { and, eq, inArray, sql } from "drizzle-orm";

import { accountState, COLLECTION_CHANNELS, firstCollectionNop, monthIndex, saleNops, type AccountPayment } from "@/lib/account-rules";
import { loadAccountData } from "@/lib/account-data";
import { currentDb, inTransaction, schema, type Transaction } from "@/lib/db";
import { mergeAccountInto, numberingStart, receiptMonthsAt, renumber, repriceCollections, type NumberingStart } from "@/lib/entry-edit";
import { entryKey, recordedOrNumbers } from "@/lib/duplicate-entries";
import { normalizeOrNumber, orNumberProblem } from "@/lib/or-number";
import { recordCorrection } from "@/lib/record-corrections";
import { manilaNow } from "@/lib/remittance-deadline";

/**
 * Member Corrections (owner, October 24, 2026; upgrade #4): the four repairs that used to need a script for each case,
 * now on one page for IT and Administrators (app/member-corrections):
 *
 *   coverage  Fix an account's coverage: where its numbering starts (NOP and Month of) and how many months each receipt
 *             covers; the receipts are numbered again in OR-date order from there (renumber, the October 4 rule).
 *   move      Move several receipts of one member to another of the member's accounts; both sides are numbered again,
 *             and a receipt moving to a program of a different monthly pay is counted at the new pay (receiptMonthsAt).
 *   merge     Merge two members who are one person: accounts, receipts, transfers, beneficiaries and New Sales go to the
 *             kept member; two accounts in the same program are joined first (mergeAccountInto); blank details are
 *             filled from the other; the other member is deleted. Two different birthdates are refused.
 *   split     Split a member who is really two people: a new member with an account in the same program, branch and MAS
 *             takes the chosen receipts; both accounts are numbered again.
 *   insert    Insert a missing receipt (owner, October 24, 2026: "also inserting of record"), for example one on the paper
 *             or old-system record that was never encoded: saved as a posted, already remitted collection with no
 *             remittance slip (a history repair, not new cash), placed among the account's receipts by OR date, which
 *             are numbered again (optionally from a chosen first NOP and Month of).
 *
 * Every repair is worked out in one transaction. A preview runs it completely and then rolls it back, so what it shows is
 * exactly what saving does. Saving needs a reason; incentives and company shares follow the new NOPs
 * (repriceCollections, slips included), each account's status is stored again, every row change is in the Audit Log and
 * a summary with the reason in Record Corrections. Any account whose history no longer passes the account rules stops
 * the whole repair.
 */

const text = (value: unknown) => String(value ?? "").trim();
const day = (value: unknown) => text(value).slice(0, 10);
const validMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const { collections, member_programs: memberPrograms, members, programs } = schema;

export type ReceiptLine = { id: string; orNumber: string; orDate: string; amount: number; account: string; program: string; before: string; after: string };
export type StatusLine = { account: string; program: string; before: string; after: string };
export type CorrectionResult = { applied: boolean; summary: string; receipts: ReceiptLine[]; statuses: StatusLine[]; notes: string[] };
type Work = { summary: string; receipts: ReceiptLine[]; statuses: StatusLine[]; notes: string[]; recordId: string; before: unknown; after: unknown };

class PreviewRollback extends Error { constructor(readonly work: Work) { super("preview"); } }

const coverage = (payment: Pick<AccountPayment, "nopFrom" | "nopTo" | "monthFrom" | "monthTo">) =>
  `NOP ${payment.nopFrom}${payment.nopTo > payment.nopFrom ? `-${payment.nopTo}` : ""} (${payment.monthFrom}${payment.monthTo !== payment.monthFrom ? ` to ${payment.monthTo}` : ""})`;

/** Runs a repair: a preview rolls everything back; saving keeps it and logs the reason. */
async function run(module: string, reason: string, apply: boolean, work: (tx: Transaction) => Promise<Work>): Promise<CorrectionResult> {
  const why = text(reason);
  if (apply && (why.length < 5 || why.length > 300)) throw new Error("Give the reason for the correction (5 to 300 characters).");
  let done: Work;
  try {
    done = await inTransaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_name', ${`Member correction: ${module}`}, true)`).catch(() => undefined);
      const result = await work(tx);
      if (!apply) throw new PreviewRollback(result);
      return result;
    });
  } catch (error) {
    if (error instanceof PreviewRollback) return { applied: false, summary: error.work.summary, receipts: error.work.receipts, statuses: error.work.statuses, notes: error.work.notes };
    throw error;
  }
  // The saved repair stands even if the correction log cannot be written; the Audit Log has every change as well.
  await recordCorrection(`Member correction: ${module}`, done.recordId, why, done.before, done.after).catch(() => {});
  return { applied: true, summary: done.summary, receipts: done.receipts, statuses: done.statuses, notes: done.notes };
}

type Loaded = Awaited<ReturnType<typeof loadAccountData>>;
type LoadedAccount = Loaded["accounts"][number];

/** Stores the new numbers of changed receipts and works out their incentives again; returns the changed lines. */
async function saveNumbers(tx: Transaction, plan: AccountPayment[], old: Map<string, AccountPayment>, account: LoadedAccount, moved = new Set<string>()) {
  const lines: ReceiptLine[] = [];
  for (const payment of plan) {
    const was = old.get(payment.id);
    if (!was) continue;
    const renumbered = was.nopFrom !== payment.nopFrom || was.nopTo !== payment.nopTo || was.monthFrom !== payment.monthFrom || was.monthTo !== payment.monthTo;
    if (!renumbered && !moved.has(payment.id)) continue;
    await tx.update(collections).set({ enrollment_id: account.id, program_id: account.programId, nop_from: payment.nopFrom, nop_to: payment.nopTo, month_from: payment.monthFrom, month_to: payment.monthTo })
      .where(eq(collections.collection_id, payment.id));
    lines.push({ id: payment.id, orNumber: payment.orNumber, orDate: payment.orDate, amount: payment.amount, account: account.id, program: account.programName, before: coverage(was), after: coverage(payment) });
  }
  return lines;
}

/** The status the account's new history gives, stored on the account; throws naming the account when it does not fit. */
async function storeStatus(tx: Transaction, account: LoadedAccount, plan: AccountPayment[], today: string, doi = account.doi) {
  let status: string;
  try { status = accountState({ ...account, doi }, plan, today).status; }
  catch (error) { throw new Error(`${account.programName} account ${account.id}: ${error instanceof Error ? error.message : "the receipts do not fit"} Nothing was saved.`); }
  await tx.update(memberPrograms).set({ account_status: status, ...(doi !== account.doi ? { doi } : {}) }).where(eq(memberPrograms.enrollment_id, account.id));
  return { account: account.id, program: account.programName, before: account.storedStatus || "—", after: status };
}

const span = (payment: AccountPayment) => Math.max(1, payment.nopTo - payment.nopFrom + 1);

// ---------------------------------------------------------------- reading

/** Members found by PH number or name, for the pickers. */
export async function searchMembers(query: string) {
  const term = text(query);
  if (term.length < 2) return [];
  const like = `%${term.toLowerCase()}%`;
  const rows = await currentDb().select({ id: members.member_id, number: members.member_number, surname: members.surname, firstName: members.first_name, middleName: members.middle_name, birthdate: members.birthdate })
    .from(members).where(sql`lower(${members.member_number}) like ${like} or lower(${members.surname} || ', ' || ${members.first_name}) like ${like} or lower(${members.first_name} || ' ' || ${members.surname}) like ${like}`)
    .orderBy(members.surname, members.first_name).limit(20);
  return rows.map((row) => ({ id: row.id, number: row.number, name: `${text(row.surname)}, ${[row.firstName, row.middleName].map(text).filter(Boolean).join(" ")}`, birthdate: day(row.birthdate) }));
}

/** One member with every account and its receipts in OR-date order, as the page shows them. */
export async function getMemberForCorrection(memberId: string) {
  const db = currentDb();
  const [member] = await db.select().from(members).where(eq(members.member_id, text(memberId)));
  if (!member) throw new Error("Member not found.");
  const data = await loadAccountData({ memberId: member.member_id, includeDeactivated: true });
  const statusRows = await db.select({ id: collections.collection_id, status: collections.remittance_status }).from(collections).where(eq(collections.member_id, member.member_id));
  const remitted = new Map(statusRows.map((row) => [row.id, text(row.status) || "Outstanding"]));
  return {
    member: { id: member.member_id, number: member.member_number, surname: member.surname, firstName: member.first_name, middleName: text(member.middle_name), nameExtension: text(member.name_extension), birthdate: day(member.birthdate) },
    accounts: data.accounts.map((account) => {
      const start = numberingStart(data.payments.filter((payment) => payment.enrollmentId === account.id).map((payment) => ({ nop: payment.nopFrom, month: payment.monthFrom })), account);
      return {
        id: account.id, programId: account.programId, program: account.programName, branch: account.branch, mas: account.mas, doi: account.doi, rate: account.basePay, flexible: Boolean(account.flexible), status: account.storedStatus,
        firstNop: firstCollectionNop(account), start,
        receipts: data.payments.filter((payment) => payment.enrollmentId === account.id).sort((a, b) => a.orDate.localeCompare(b.orDate) || a.nopFrom - b.nopFrom)
          .map((payment) => ({ id: payment.id, orNumber: payment.orNumber, orDate: payment.orDate, amount: payment.amount, months: span(payment), nopFrom: payment.nopFrom, nopTo: payment.nopTo, monthFrom: payment.monthFrom, monthTo: payment.monthTo, remittance: remitted.get(payment.id) ?? "" })),
      };
    }),
  };
}

// ---------------------------------------------------------------- 1. coverage

export type CoverageInput = { enrollmentId: string; startNop?: number; startMonth?: string; months?: Record<string, number>; doi?: string };

/** Numbers one account's receipts again from a chosen start (NOP and Month of), with each receipt's months. */
export function fixCoverage(input: CoverageInput, reason: string, apply: boolean) {
  return run("Fix coverage", reason, apply, async (tx) => {
    const today = manilaNow().date;
    const data = await loadAccountData({ enrollmentIds: [text(input.enrollmentId)], includeDeactivated: true }, tx, { lock: true });
    const account = data.accounts[0];
    if (!account) throw new Error("Account not found.");
    const payments = data.payments.filter((payment) => payment.enrollmentId === account.id);
    if (!payments.length) throw new Error("This account has no posted receipts to number.");
    const current = numberingStart(payments.map((payment) => ({ nop: payment.nopFrom, month: payment.monthFrom })), account);
    const start: NumberingStart = { nop: input.startNop === undefined ? current.nop : Number(input.startNop), month: text(input.startMonth) || current.month };
    if (!Number.isInteger(start.nop) || start.nop < 1 || start.nop > 1200) throw new Error("The first NOP must be a whole number from 1.");
    if (!validMonth(start.month)) throw new Error("Choose the Month of the first NOP (YYYY-MM).");
    const doi = text(input.doi) || account.doi;
    if (!validDate(doi) || doi > today) throw new Error("Enter a valid DOI, today or earlier.");
    for (const [id, months] of Object.entries(input.months ?? {})) {
      if (!payments.some((payment) => payment.id === id)) throw new Error(`Receipt ${id} is not on this account.`);
      if (!Number.isInteger(months) || months < 1 || months > 120) throw new Error("Each receipt covers 1 to 120 months.");
    }
    const plan = renumber(start, payments, (payment) => input.months?.[payment.id] ?? span(payment));
    if (monthIndex(plan[0].monthFrom) < monthIndex(doi.slice(0, 7))) throw new Error(`The first receipt would cover ${plan[0].monthFrom}, before the DOI (${doi}). Choose a later Month of or an earlier DOI.`);
    const old = new Map(payments.map((payment) => [payment.id, payment]));
    const status = await storeStatus(tx, account, plan, today, doi);
    const lines = await saveNumbers(tx, plan, old, account);
    const priced = await repriceCollections(tx, lines.map((line) => line.id));
    const notes = [
      doi !== account.doi ? `DOI ${account.doi} → ${doi}.` : "",
      priced.repriced ? `${priced.repriced} receipt(s) get new incentive figures${priced.slips.length ? `; remittance slips ${priced.slips.join(", ")} follow` : ""}.` : "",
    ].filter(Boolean);
    return {
      summary: lines.length || doi !== account.doi ? `${account.programName} account ${account.id}: ${lines.length} receipt(s) renumbered from NOP ${start.nop} (${start.month}); status ${status.before} → ${status.after}.` : "Nothing changes: the receipts already have these numbers.",
      receipts: lines, statuses: [status], notes, recordId: account.id,
      before: { account: account.id, start: current, doi: account.doi, status: account.storedStatus }, after: { start, doi, status: status.after, receipts: lines.map(({ id, before, after }) => ({ id, before, after })), repriced: priced.repriced, slips: priced.slips },
    };
  });
}

// ---------------------------------------------------------------- 2. move receipts

export type MoveInput = { collectionIds: string[]; targetEnrollmentId: string };

/** Moves several receipts of one member to another of the member's accounts; both sides are numbered again. */
export function moveReceipts(input: MoveInput, reason: string, apply: boolean) {
  return run("Move receipts", reason, apply, async (tx) => {
    const today = manilaNow().date;
    const ids = [...new Set((input.collectionIds ?? []).map(text).filter(Boolean))];
    if (!ids.length) throw new Error("Tick the receipts to move.");
    const rows = await tx.select({ id: collections.collection_id, memberId: collections.member_id, enrollmentId: collections.enrollment_id, status: collections.status })
      .from(collections).where(inArray(collections.collection_id, ids)).for("update");
    if (rows.length !== ids.length) throw new Error("Some receipts were not found. Reload the member.");
    if (rows.some((row) => text(row.status) !== "Posted")) throw new Error("Only posted receipts can be moved.");
    const memberIds = new Set(rows.map((row) => row.memberId));
    if (memberIds.size !== 1) throw new Error("The receipts must belong to one member.");
    const targetId = text(input.targetEnrollmentId);
    const sourceIds = [...new Set(rows.map((row) => row.enrollmentId))];
    if (sourceIds.includes(targetId)) throw new Error("Some receipts are already on the chosen account. Untick them.");
    const data = await loadAccountData({ enrollmentIds: [...sourceIds, targetId], includeDeactivated: true }, tx, { lock: true });
    const target = data.accounts.find((account) => account.id === targetId);
    if (!target) throw new Error("Choose the account to move them to.");
    if (!memberIds.has(target.memberId)) throw new Error("Receipts can only move to another account of the same member. To move them to another person, use Split a member.");

    const movedIds = new Set(ids);
    const accountOf = (id: string) => data.accounts.find((account) => account.id === id)!;
    const sourceOf = new Map(data.payments.filter((payment) => movedIds.has(payment.id)).map((payment) => [payment.id, accountOf(payment.enrollmentId)]));
    // Counted again at the target's monthly pay when it differs; NOPs move onto the target's numbering (registration fee).
    const recount = new Map(sourceIds.map((id) => { const source = accountOf(id); return [id, receiptMonthsAt({ name: source.programName, rate: source.basePay, flexible: Boolean(source.flexible), max: source.maxMonthlyPayment ?? null }, { name: target.programName, rate: target.basePay, flexible: Boolean(target.flexible), max: target.maxMonthlyPayment ?? null })]; }));
    const targetPayments = data.payments.filter((payment) => payment.enrollmentId === target.id || movedIds.has(payment.id));
    const shift = (payment: AccountPayment) => movedIds.has(payment.id) ? saleNops(target) - saleNops(sourceOf.get(payment.id)!) : 0;
    const targetPlan = renumber(numberingStart(targetPayments.map((payment) => ({ nop: payment.nopFrom + shift(payment), month: payment.monthFrom })), target), targetPayments,
      (payment) => movedIds.has(payment.id) ? recount.get(sourceOf.get(payment.id)!.id)?.(payment) ?? span(payment) : span(payment));
    const old = new Map(data.payments.map((payment) => [payment.id, payment]));
    const statuses = [await storeStatus(tx, target, targetPlan, today)];
    const lines = await saveNumbers(tx, targetPlan, old, target, movedIds);
    const notes: string[] = [];
    for (const id of sourceIds) {
      const source = accountOf(id);
      const left = data.payments.filter((payment) => payment.enrollmentId === id && !movedIds.has(payment.id));
      const plan = left.length ? renumber(numberingStart(left.map((payment) => ({ nop: payment.nopFrom, month: payment.monthFrom })), source), left, span) : [];
      statuses.push(await storeStatus(tx, source, plan, today));
      lines.push(...await saveNumbers(tx, plan, old, source));
      if (!left.length) notes.push(`${source.programName} account ${source.id} has no receipts left. Delete it from Members if it should not exist.`);
    }
    const priced = await repriceCollections(tx, lines.map((line) => line.id));
    if (priced.repriced) notes.push(`${priced.repriced} receipt(s) get new incentive figures${priced.slips.length ? `; remittance slips ${priced.slips.join(", ")} follow` : ""}.`);
    return {
      summary: `${ids.length} receipt(s) moved to ${target.programName} account ${target.id}; ${lines.length - ids.length} other receipt(s) renumbered.`,
      receipts: lines, statuses, notes, recordId: target.id,
      before: { receipts: ids.map((id) => ({ id, account: old.get(id)?.enrollmentId, coverage: coverage(old.get(id)!) })) },
      after: { target: target.id, receipts: lines.map(({ id, account, before, after }) => ({ id, account, before, after })), statuses, repriced: priced.repriced, slips: priced.slips },
    };
  });
}

// ---------------------------------------------------------------- 3. merge members

export type MergeInput = { keepMemberId: string; otherMemberId: string; useOtherName?: boolean };
const FILL = ["birthdate", "birthplace", "gender", "civil_status", "member_contact", "address", "claimant_name", "claimant_contact", "claimant_address"] as const;
const fullName = (member: { first_name: string; middle_name: string | null; surname: string; name_extension: string | null }) => [member.first_name, member.middle_name, member.surname, member.name_extension].map(text).filter(Boolean).join(" ");

/** Merges two members who are the same person into the kept one. */
export function mergeMembers(input: MergeInput, reason: string, apply: boolean) {
  return run("Merge members", reason, apply, async (tx) => {
    const today = manilaNow().date;
    if (!text(input.keepMemberId) || text(input.keepMemberId) === text(input.otherMemberId)) throw new Error("Choose two different members.");
    const [keep] = await tx.select().from(members).where(eq(members.member_id, text(input.keepMemberId))).for("update");
    const [other] = await tx.select().from(members).where(eq(members.member_id, text(input.otherMemberId))).for("update");
    if (!keep || !other) throw new Error("Member not found. Reload the page.");
    if (day(keep.birthdate) && day(other.birthdate) && day(keep.birthdate) !== day(other.birthdate)) throw new Error(`Their birthdates differ (${day(keep.birthdate)} and ${day(other.birthdate)}), so they are not merged. Correct the wrong birthdate first if they are the same person.`);
    const notes: string[] = [];
    const statuses: StatusLine[] = [];
    let receipts: ReceiptLine[] = [];
    // Two accounts in the same program become one first (the other's receipts join the kept account, renumbered).
    const keepAccounts = await tx.select({ id: memberPrograms.enrollment_id, programId: memberPrograms.program_id, status: memberPrograms.account_status, program: programs.program_name })
      .from(memberPrograms).innerJoin(programs, eq(programs.program_id, memberPrograms.program_id)).where(eq(memberPrograms.member_id, keep.member_id));
    const otherAccounts = await tx.select({ id: memberPrograms.enrollment_id, programId: memberPrograms.program_id }).from(memberPrograms).where(eq(memberPrograms.member_id, other.member_id));
    const before = new Map((await tx.select().from(collections).where(eq(collections.member_id, other.member_id))).map((row) => [row.collection_id, row]));
    const repriceIds: string[] = [];
    for (const clash of otherAccounts) {
      const kept = keepAccounts.find((account) => account.programId === clash.programId);
      if (!kept) continue;
      const merged = await mergeAccountInto(tx, clash.id, kept.id, today, undefined, { anyMember: true });
      repriceIds.push(...merged.collectionIds);
      statuses.push({ account: kept.id, program: text(kept.program), before: text(kept.status) || "—", after: merged.status });
      notes.push(`Both had ${text(kept.program)}: account ${clash.id} joined ${kept.id} (${merged.moved} receipt(s) moved, ${merged.renumbered} renumbered). Check for a second New Sale in that program.`);
    }
    const moved = {
      accounts: (await tx.update(memberPrograms).set({ member_id: keep.member_id, member_number: keep.member_number }).where(eq(memberPrograms.member_id, other.member_id)).returning({ id: memberPrograms.enrollment_id })).length,
      collections: (await tx.update(collections).set({ member_id: keep.member_id, member_number: keep.member_number }).where(eq(collections.member_id, other.member_id)).returning({ id: collections.collection_id })).length,
      transfers: (await tx.update(schema.member_transfers).set({ member_id: keep.member_id, member_number: keep.member_number }).where(eq(schema.member_transfers.member_id, other.member_id)).returning({ id: schema.member_transfers.transfer_id })).length,
      beneficiaries: (await tx.update(schema.beneficiaries).set({ member_id: keep.member_id }).where(eq(schema.beneficiaries.member_id, other.member_id)).returning({ id: schema.beneficiaries.member_id })).length,
      sales: (await tx.update(schema.sales).set({ member_number: keep.member_number }).where(eq(schema.sales.member_number, other.member_number)).returning({ id: schema.sales.sale_id })).length,
    };
    const filled = FILL.filter((column) => !text(keep[column]) && text(other[column]));
    const renamed = Boolean(input.useOtherName);
    await tx.update(members).set({
      ...Object.fromEntries(filled.map((column) => [column, other[column]])),
      ...(renamed ? { surname: other.surname, first_name: other.first_name, middle_name: other.middle_name, name_extension: other.name_extension } : {}),
    }).where(eq(members.member_id, keep.member_id));
    await tx.delete(members).where(eq(members.member_id, other.member_id));
    const priced = await repriceCollections(tx, repriceIds);
    if (priced.repriced) notes.push(`${priced.repriced} receipt(s) get new incentive figures${priced.slips.length ? `; remittance slips ${priced.slips.join(", ")} follow` : ""}.`);
    if (filled.length) notes.push(`Filled from ${other.member_number}: ${filled.join(", ").replace(/_/g, " ")}.`);
    const after = await tx.select().from(collections).where(inArray(collections.collection_id, [...before.keys()].length ? [...before.keys()] : ["-"]));
    receipts = after.filter((row) => { const was = before.get(row.collection_id); return was && (was.nop_from !== row.nop_from || was.enrollment_id !== row.enrollment_id); })
      .map((row) => { const was = before.get(row.collection_id)!; return { id: row.collection_id, orNumber: text(row.or_number), orDate: day(row.or_date), amount: Number(row.amount_collected), account: row.enrollment_id, program: "",
        before: `${was.enrollment_id} ${coverage({ nopFrom: was.nop_from ?? 0, nopTo: was.nop_to ?? 0, monthFrom: text(was.month_from).slice(0, 7), monthTo: text(was.month_to).slice(0, 7) })}`,
        after: `${row.enrollment_id} ${coverage({ nopFrom: row.nop_from ?? 0, nopTo: row.nop_to ?? 0, monthFrom: text(row.month_from).slice(0, 7), monthTo: text(row.month_to).slice(0, 7) })}` }; });
    return {
      summary: `${other.member_number} ${fullName(other)} merged into ${keep.member_number} ${renamed ? fullName(other) : fullName(keep)}: ${moved.accounts} account(s), ${moved.collections} receipt(s), ${moved.sales} New Sale(s), ${moved.transfers} transfer(s), ${moved.beneficiaries} beneficiar(ies) moved; ${other.member_number} removed.`,
      receipts, statuses, notes, recordId: other.member_id,
      before: { kept: { id: keep.member_id, number: keep.member_number, name: fullName(keep) }, removed: { id: other.member_id, number: other.member_number, name: fullName(other) } },
      after: { kept: keep.member_id, renamed, filled, ...moved, statuses, repriced: priced.repriced },
    };
  });
}

// ---------------------------------------------------------------- 4. split a member

export type SplitInput = {
  enrollmentId: string; collectionIds: string[];
  newMember: { surname: string; firstName: string; middleName?: string; nameExtension?: string; birthdate?: string };
  newDoi: string; newStartNop?: number; newStartMonth?: string;
  /** The kept member's corrected first name, when the import joined two names (e.g. "Fe" and "Fe Dhivenil"). */
  keepFirstName?: string;
};

async function freeMemberNumber(tx: Transaction) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const number = `PH-${String((Number(Date.now().toString().slice(-8)) + attempt * 7919) % 100_000_000).padStart(8, "0")}`;
    const [used] = await tx.select({ id: members.member_id }).from(members).where(eq(members.member_number, number));
    if (!used) return number;
  }
  throw new Error("Could not find a free PH number. Try again.");
}

/** Splits one member who is really two people: a new member with an account in the same program takes the chosen receipts. */
export function splitMember(input: SplitInput, reason: string, apply: boolean) {
  return run("Split member", reason, apply, async (tx) => {
    const today = manilaNow().date;
    const ids = [...new Set((input.collectionIds ?? []).map(text).filter(Boolean))];
    const person = input.newMember ?? { surname: "", firstName: "" };
    if (!text(person.surname) || !text(person.firstName)) throw new Error("Enter the new member's surname and first name.");
    if (text(person.birthdate) && (!validDate(text(person.birthdate)) || text(person.birthdate) > today)) throw new Error("Enter a valid birthdate for the new member.");
    if (!validDate(text(input.newDoi)) || text(input.newDoi) > today) throw new Error("Enter the new member's DOI (today or earlier).");
    if (!ids.length) throw new Error("Tick the receipts that belong to the new member.");
    const data = await loadAccountData({ enrollmentIds: [text(input.enrollmentId)], includeDeactivated: true }, tx, { lock: true });
    const account = data.accounts[0];
    if (!account) throw new Error("Account not found.");
    const payments = data.payments.filter((payment) => payment.enrollmentId === account.id);
    const movedIds = new Set(ids);
    if (ids.some((id) => !payments.some((payment) => payment.id === id))) throw new Error("Every ticked receipt must be a posted receipt of this account.");
    const [row] = await tx.select().from(memberPrograms).where(eq(memberPrograms.enrollment_id, account.id));
    const [member] = await tx.select().from(members).where(eq(members.member_id, account.memberId)).for("update");

    const stamp = Date.now().toString(36).toUpperCase();
    const newMemberId = `MEM-${Date.now()}-SPLIT${stamp.slice(-3)}`, newEnrollment = `ENR-${Date.now()}-SPLIT${stamp.slice(-3)}`;
    const newNumber = await freeMemberNumber(tx);
    const doi = text(input.newDoi);
    await tx.insert(members).values({ member_id: newMemberId, member_number: newNumber, surname: text(person.surname).toUpperCase(), first_name: text(person.firstName).toUpperCase(),
      middle_name: text(person.middleName).toUpperCase() || null, name_extension: text(person.nameExtension).toUpperCase() || null, birthdate: text(person.birthdate) || null, claimant_same_address: false, status: member.status });
    await tx.insert(memberPrograms).values({ enrollment_id: newEnrollment, member_id: newMemberId, member_number: newNumber, program_id: account.programId, doi, branch: row.branch, mas: row.mas,
      remittance_method: row.remittance_method, registration_fee: row.registration_fee, status: row.status, branch_id: row.branch_id, mas_employee_id: row.mas_employee_id, date_created: new Date().toISOString() });
    if (text(input.keepFirstName) && text(input.keepFirstName) !== member.first_name) await tx.update(members).set({ first_name: text(input.keepFirstName).toUpperCase() }).where(eq(members.member_id, member.member_id));

    const fresh = { ...account, id: newEnrollment, memberId: newMemberId, memberNumber: newNumber, doi, storedStatus: "NS" };
    const movedPayments = payments.filter((payment) => movedIds.has(payment.id));
    const defaultStart = { nop: firstCollectionNop(fresh), month: `${doi.slice(0, 7)}` };
    defaultStart.month = new Date(Date.UTC(Number(doi.slice(0, 4)), Number(doi.slice(5, 7)), 1)).toISOString().slice(0, 7);
    const start: NumberingStart = { nop: input.newStartNop === undefined ? defaultStart.nop : Number(input.newStartNop), month: text(input.newStartMonth) || defaultStart.month };
    if (!Number.isInteger(start.nop) || start.nop < 1) throw new Error("The new account's first NOP must be a whole number from 1.");
    if (!validMonth(start.month)) throw new Error("Choose the Month of the new account's first NOP.");
    const newPlan = renumber(start, movedPayments, span);
    const left = payments.filter((payment) => !movedIds.has(payment.id));
    const keptPlan = left.length ? renumber(numberingStart(left.map((payment) => ({ nop: payment.nopFrom, month: payment.monthFrom })), account), left, span) : [];
    const old = new Map(payments.map((payment) => [payment.id, payment]));
    const statuses = [await storeStatus(tx, account, keptPlan, today), await storeStatus(tx, { ...fresh, programName: account.programName }, newPlan, today)];
    const lines = [...await saveNumbers(tx, keptPlan, old, account), ...await saveNumbers(tx, newPlan, old, { ...fresh, programName: account.programName }, movedIds)];
    await tx.update(collections).set({ member_id: newMemberId, member_number: newNumber }).where(inArray(collections.collection_id, ids));
    const priced = await repriceCollections(tx, lines.map((line) => line.id));
    const notes = [
      `New member ${newNumber} ${text(person.surname).toUpperCase()}, ${text(person.firstName).toUpperCase()} with ${account.programName} account ${newEnrollment} (DOI ${doi}, same branch and MAS). It has no New Sale; add details and beneficiaries in Members.`,
      priced.repriced ? `${priced.repriced} receipt(s) get new incentive figures${priced.slips.length ? `; remittance slips ${priced.slips.join(", ")} follow` : ""}.` : "",
      text(input.keepFirstName) && text(input.keepFirstName) !== member.first_name ? `${member.member_number} first name ${member.first_name} → ${text(input.keepFirstName).toUpperCase()}.` : "",
    ].filter(Boolean);
    return {
      summary: `${ids.length} receipt(s) of ${member.member_number} moved to the new member ${newNumber}; ${keptPlan.length} stay.`,
      receipts: lines, statuses, notes, recordId: member.member_id,
      before: { member: member.member_id, number: member.member_number, firstName: member.first_name, account: account.id, receipts: ids },
      after: { newMember: newMemberId, newNumber, newAccount: newEnrollment, doi, receipts: lines.map(({ id, account: at, before: was, after: now }) => ({ id, account: at, before: was, after: now })), statuses, repriced: priced.repriced },
    };
  });
}

/** Which accounts of the member are in which program, to show where merges join accounts. */
export async function sharedPrograms(keepMemberId: string, otherMemberId: string) {
  const rows = await currentDb().select({ program: programs.program_name }).from(memberPrograms).innerJoin(programs, eq(programs.program_id, memberPrograms.program_id))
    .where(and(eq(memberPrograms.member_id, keepMemberId), sql`${memberPrograms.program_id} in (select program_id from member_programs where member_id = ${otherMemberId})`));
  return rows.map((row) => text(row.program));
}

// ---------------------------------------------------------------- 5. insert a missing receipt

export type InsertInput = {
  enrollmentId: string; orNumber: string; orDate: string; amount: number; months: number;
  collectedByRole?: string; mas?: string; dateRemitted?: string; reactivation?: boolean;
  startNop?: number; startMonth?: string;
};

/**
 * Adds a receipt that is missing from an account's history. It is saved Posted and Remitted with no slip, like the
 * receipts imported from the old system, so it does not enter Clearing or Remittances; its incentive and company share
 * are worked out at its NOPs. The account's receipts are numbered again in OR-date order with it.
 */
export function insertReceipt(input: InsertInput, reason: string, apply: boolean) {
  return run("Insert receipt", reason, apply, async (tx) => {
    const today = manilaNow().date;
    const data = await loadAccountData({ enrollmentIds: [text(input.enrollmentId)], includeDeactivated: true }, tx, { lock: true });
    const account = data.accounts[0];
    if (!account) throw new Error("Account not found.");
    const orNumber = normalizeOrNumber(text(input.orNumber));
    const problem = orNumberProblem(orNumber);
    if (!orNumber || problem) throw new Error(problem || "Enter the OR number.");
    const used = (await recordedOrNumbers([orNumber], tx)).get(entryKey(orNumber));
    if (used) throw new Error(`OR Number ${orNumber} is already recorded on collection ${used.collectionId}.`);
    const orDate = text(input.orDate), dateRemitted = text(input.dateRemitted) || orDate;
    if (!validDate(orDate) || orDate > today) throw new Error("Enter a valid OR date, today or earlier.");
    if (orDate < account.doi) throw new Error(`The OR date is before the account's DOI (${account.doi}).`);
    if (!validDate(dateRemitted) || dateRemitted < orDate || dateRemitted > today) throw new Error("The Date Remitted must be on or after the OR date, and not in the future.");
    const amount = Math.round(Number(input.amount) * 100) / 100, months = Number(input.months);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter the amount paid.");
    if (!Number.isInteger(months) || months < 1 || months > 120) throw new Error("Enter the months the receipt covers (1 to 120).");
    const channel = (COLLECTION_CHANNELS as readonly string[]).includes(text(input.collectedByRole)) ? text(input.collectedByRole) : "MAS";
    const mas = text(input.mas) || account.mas;

    const payments = data.payments.filter((payment) => payment.enrollmentId === account.id);
    const id = `COL-FIX-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const added: AccountPayment = { id, enrollmentId: account.id, orDate, orNumber, monthFrom: "", monthTo: "", nopFrom: 0, nopTo: 0, amount, dateRemitted, mas };
    const current = numberingStart(payments.map((payment) => ({ nop: payment.nopFrom, month: payment.monthFrom })), account);
    const start: NumberingStart = { nop: input.startNop === undefined ? current.nop : Number(input.startNop), month: text(input.startMonth) || current.month };
    if (!Number.isInteger(start.nop) || start.nop < 1) throw new Error("The first NOP must be a whole number from 1.");
    if (!validMonth(start.month)) throw new Error("Choose the Month of the first NOP (YYYY-MM).");
    const plan = renumber(start, [...payments, added], (payment) => payment.id === id ? months : span(payment));
    const mine = plan.find((payment) => payment.id === id)!;
    const status = await storeStatus(tx, account, plan, today);
    await tx.insert(collections).values({
      collection_id: id, collection_batch_id: `CBT-FIX-${id.slice(8)}`, enrollment_id: account.id, member_id: account.memberId, member_number: account.memberNumber, program_id: account.programId,
      branch: account.branch, mas, or_number: orNumber, or_date: orDate, amount_collected: amount, month_from: mine.monthFrom, month_to: mine.monthTo, nop_from: mine.nopFrom, nop_to: mine.nopTo,
      reactivation: Boolean(input.reactivation), status: "Posted", created_at: new Date().toISOString(), collected_by_role: channel, remittance_status: "Remitted",
      accountable_name: mas, accountable_role: channel === "Collector" ? "Collector" : channel === "DTO" ? "DTO" : "MAS", remittance_method: "Cash", date_remitted: dateRemitted,
      backdate_reason: `Inserted by Member Corrections: ${text(reason).slice(0, 200)}`,
    });
    const old = new Map(payments.map((payment) => [payment.id, payment]));
    const lines = await saveNumbers(tx, plan, old, account);
    const priced = await repriceCollections(tx, [id, ...lines.map((line) => line.id)]);
    lines.unshift({ id, orNumber, orDate, amount, account: account.id, program: account.programName, before: "(not recorded)", after: coverage(mine) });
    return {
      summary: `OR ${orNumber} (${orDate}, ₱${amount.toLocaleString("en-PH")}) inserted on ${account.programName} account ${account.id} as ${coverage(mine)}; ${lines.length - 1} other receipt(s) renumbered; status ${status.before} → ${status.after}.`,
      receipts: lines, statuses: [status],
      notes: [`Saved as already remitted (no slip), so it does not enter Clearing or Remittances.${priced.repriced ? " Its incentive and company share are worked out at its NOPs." : ""}`],
      recordId: id,
      before: { account: account.id, status: account.storedStatus },
      after: { collection: id, orNumber, orDate, amount, months, channel, mas, dateRemitted, coverage: coverage(mine), renumbered: lines.slice(1).map(({ id: receipt, before, after }) => ({ id: receipt, before, after })), status: status.after },
    };
  });
}
