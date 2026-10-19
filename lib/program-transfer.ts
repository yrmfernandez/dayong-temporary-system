import { sql, type SQL } from "drizzle-orm";

import { canAccessPath, canCorrectEntriesFor } from "@/lib/access-control";
import { accountState, forfeitMonthsFor, todayInManila, type AccountPayment } from "@/lib/account-rules";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { currentDb, inTransaction } from "@/lib/db";
import { createReadableId } from "@/lib/readable-id";
import { mergeAccountInto, renumber, repriceCollections, repriceSales } from "@/lib/entry-edit";
import { getEncoder } from "@/lib/encoder-context";

/**
 * Moving accounts between programs from the Programs page (owner, October 10, 2026): an administrator moves all of a
 * program's accounts, or the ones they tick, to another program, the same rules as scripts/move-program-accounts.mjs:
 *   - any program (owner, October 19, 2026), as long as what each receipt paid works out in the new monthly pay: with
 *     the same pay every NOP stays; otherwise each receipt covers amount ÷ the new monthly pay (whole months; on a
 *     flexible program at least the minimum a month) and the payments are numbered again in OR-date order from the
 *     account's first NOP, months following the DOI (monthsAt). An account whose receipts do not work out is left and reported;
 *   - an account moves with its New Sale, collections and transfer records; its payment status is recalculated;
 *   - a member who already has an account in the target program is merged into it (their payments join that account,
 *     renumbered in OR-date order from the lowest NOP either had, the earlier DOI kept: mergeAccountInto in
 *     lib/entry-edit.ts) unless the combined payments break the account rules: those are left and reported;
 *   - the moved New Sales and collections get the target program's incentives and company share (owner, October 15,
 *     2026: reports follow the program; lib/entry-edit.ts repriceCollections / repriceSales; slips follow);
 *   - optionally the emptied program is deleted (with its incentive tiers), or set inactive if anything still uses it.
 * One transaction; the Audit Log keeps every change and Record Corrections a summary.
 */
const text = (value: unknown) => String(value ?? "").trim();
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];
const query = async <T,>(statement: SQL) => rowsOf<T>(await currentDb().execute(statement));

type Program = { program_id: string; program_name: string; program_code: string; rate: number; total: number; flexible: boolean; max: number | null; status: string; category_id?: string | null };
const programById = async (id: string) => (await query<Program>(sql`select program_id, program_name, category_id, coalesce(program_code, '') as program_code, coalesce(base_pay, 0)::float8 as rate,
    coalesce(pay_balance_total, 0)::float8 as total, coalesce(flexible, false) as flexible, max_monthly_payment::float8 as max, coalesce(status, 'active') as status
  from programs where program_id = ${text(id)}`))[0];
const samePay = (a: Program, b: Program) => Math.round(a.rate * 100) === Math.round(b.rate * 100) && a.flexible === b.flexible;
const peso = (value: number) => `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

/**
 * The months each receipt covers in the target program, or null when they stay as they are (same pay). A fixed program:
 * the amount ÷ its monthly pay, which must be a whole number of months. A flexible one: the months the receipt had when
 * each still gets the minimum, otherwise as many whole minimums as it holds, and never above the monthly maximum.
 * Throws, naming the receipt, when the amount does not work out.
 */
function monthsAt(from: Program, to: Program) {
  if (samePay(from, to)) return null;
  const rate = Math.round(to.rate * 100);
  if (rate <= 0) throw new Error(`${to.program_name} has no monthly pay.`);
  return (payment: Payment) => {
    const paid = Math.round(payment.amount * 100), had = Math.max(1, payment.nopTo - payment.nopFrom + 1);
    const months = to.flexible ? (paid >= rate * had ? had : Math.floor(paid / rate)) : paid % rate === 0 ? paid / rate : 0;
    const receipt = `OR ${payment.orNumber || payment.id} (${peso(payment.amount)})`;
    if (months < 1) throw new Error(to.flexible ? `${receipt} is less than the ${peso(to.rate)} minimum of ${to.program_name}.` : `${receipt} is not a whole number of ${peso(to.rate)} months of ${to.program_name}.`);
    if (to.flexible && to.max && paid > Math.round(to.max * 100) * months) throw new Error(`${receipt} is more than the ${peso(to.max)} monthly maximum of ${to.program_name}.`);
    return months;
  };
}

export type TransferAccount = { enrollmentId: string; memberNumber: string; memberName: string; branch: string; mas: string; doi: string; status: string; payments: number };

/** Who may move accounts between programs: administrators, and IT with Edit / Corrections. */
export async function canMovePrograms() {
  const user = await getSessionUser();
  return Boolean(user && ((await canManageUsers()) || (canCorrectEntriesFor(user) && canAccessPath(user, "/entry-corrections"))));
}

/** The programs a program's accounts can move to (Members → Transfer, one account): any other active program. */
export async function programTargets(programId: string) {
  const from = await programById(programId);
  if (!from) throw new Error("Program not found.");
  const targets = await query<Program>(sql`select program_id, program_name, coalesce(program_code, '') as program_code, coalesce(base_pay, 0)::float8 as rate,
      coalesce(pay_balance_total, 0)::float8 as total, coalesce(flexible, false) as flexible, max_monthly_payment::float8 as max, coalesce(status, 'active') as status
    from programs where program_id <> ${from.program_id} order by program_name`);
  return {
    program: { id: from.program_id, name: from.program_name, code: from.program_code, rate: from.rate, flexible: from.flexible },
    targets: targets.filter((target) => target.status !== "inactive").map((target) => ({ id: target.program_id, name: target.program_name, code: target.program_code, rate: target.rate, flexible: target.flexible, status: target.status, accounts: 0 })),
  };
}

/** A program's accounts and the programs they can move to (any other; a different pay recounts the months). */
export async function programTransferOptions(programId: string) {
  const from = await programById(programId);
  if (!from) throw new Error("Program not found.");
  const [accounts, targets] = await Promise.all([
    query<{ enrollment_id: string; member_number: string; name: string; branch: string; mas: string; doi: string; status: string; payments: number }>(sql`
      select mp.enrollment_id, coalesce(mp.member_number, '') as member_number, trim(concat_ws(' ', m.first_name, m.middle_name, m.surname)) as name,
        coalesce(mp.branch, '') as branch, coalesce(mp.mas, '') as mas, coalesce(mp.doi::text, '') as doi, coalesce(mp.account_status, '') as status,
        (select count(*)::int from collections c where c.enrollment_id = mp.enrollment_id and lower(coalesce(c.status, '')) = 'posted') as payments
      from member_programs mp left join members m on m.member_id = mp.member_id where mp.program_id = ${from.program_id} order by m.surname, m.first_name`),
    query<Program & { accounts: number }>(sql`select program_id, program_name, coalesce(program_code, '') as program_code, coalesce(base_pay, 0)::float8 as rate,
        coalesce(pay_balance_total, 0)::float8 as total, coalesce(flexible, false) as flexible, max_monthly_payment::float8 as max, coalesce(status, 'active') as status,
        (select count(*)::int from member_programs x where x.program_id = p.program_id) as accounts
      from programs p where program_id <> ${from.program_id} order by program_name`),
  ]);
  return {
    program: { id: from.program_id, name: from.program_name, code: from.program_code, rate: from.rate, flexible: from.flexible },
    accounts: accounts.map((row): TransferAccount => ({ enrollmentId: row.enrollment_id, memberNumber: row.member_number, memberName: row.name, branch: row.branch, mas: row.mas, doi: row.doi, status: row.status, payments: Number(row.payments) })),
    targets: targets.map((target) => ({ id: target.program_id, name: target.program_name, code: target.program_code, rate: target.rate, flexible: target.flexible, status: target.status, accounts: Number(target.accounts) })),
  };
}

type Payment = AccountPayment;
const paymentsOf = async (enrollmentId: string): Promise<Payment[]> => (await query<{ collection_id: string; or_date: string; or_number: string; month_from: string; month_to: string; nop_from: number; nop_to: number; amount: number }>(sql`
    select collection_id, coalesce(or_date::text, '') as or_date, coalesce(or_number, '') as or_number, coalesce(month_from, '') as month_from, coalesce(month_to, '') as month_to,
      nop_from, nop_to, amount_collected::float8 as amount
    from collections where enrollment_id = ${enrollmentId} and lower(coalesce(status, '')) = 'posted'`))
  .map((row) => ({ id: row.collection_id, enrollmentId, orDate: row.or_date, orNumber: row.or_number, monthFrom: row.month_from, monthTo: row.month_to, nopFrom: Number(row.nop_from), nopTo: Number(row.nop_to), amount: Number(row.amount), dateRemitted: "", mas: "" }));

/** Moves the chosen accounts (or all) of one program to another; see the file comment. */
export async function transferProgramAccounts(input: { fromProgramId: string; toProgramId: string; enrollmentIds?: string[]; all?: boolean; removeWhenEmpty?: boolean; reason?: string }) {
  const reason = text(input.reason);
  if (reason.length < 3 || reason.length > 300) throw new Error("Give the reason for the transfer (3 to 300 characters).");
  return inTransaction(async () => {
    const [from, to] = await Promise.all([programById(input.fromProgramId), programById(input.toProgramId)]);
    if (!from || !to) throw new Error("Program not found.");
    if (from.program_id === to.program_id) throw new Error("Choose a different program to move to.");
    const months = monthsAt(from, to);
    const accounts = await query<{ enrollment_id: string; member_id: string; member_number: string; doi: string; target: string | null }>(sql`
      select mp.enrollment_id, mp.member_id, coalesce(mp.member_number, '') as member_number, coalesce(mp.doi::text, '') as doi,
        (select o.enrollment_id from member_programs o where o.member_id = mp.member_id and o.program_id = ${to.program_id} order by o.enrollment_id limit 1) as target
      from member_programs mp where mp.program_id = ${from.program_id}`);
    const wanted = input.all ? null : new Set((input.enrollmentIds ?? []).map(text).filter(Boolean));
    if (wanted && !wanted.size) throw new Error("Choose the accounts to move, or all of them.");
    const chosen = accounts.filter((account) => !wanted || wanted.has(account.enrollment_id));
    if (wanted && chosen.length !== wanted.size) throw new Error("Some of the chosen accounts are no longer in this program. Reload and try again.");
    const today = todayInManila();
    const base = (id: string, memberId: string, doi: string) => ({ id, memberId, memberNumber: "", programId: to.program_id, doi, branch: "", mas: "", basePay: to.rate, payBalanceTotal: to.total, storedStatus: "", flexible: to.flexible, maxMonthlyPayment: to.max, forfeitMonths: forfeitMonthsFor(to.category_id) });
    const left: Array<{ enrollmentId: string; why: string }> = [];
    let moved = 0, merged = 0;
    // A member with two accounts here: the first moves, the second merges into it.
    const joined = new Map<string, string>();
    const changedAccounts = new Set<string>(), changedMembers = new Set<string>();
    for (const chosenAccount of chosen) {
      const account = { ...chosenAccount, target: chosenAccount.target ?? joined.get(chosenAccount.member_id) ?? null };
      const own = await paymentsOf(account.enrollment_id);
      if (account.target) {
        // Merge into the member's account in the target program: every payment of both, numbered again in OR-date order
        // (owner, October 16, 2026: a program moves even when that account already has payments). Refused only when the
        // combined payments break the account rules; then the account is left and reported.
        try { await mergeAccountInto(currentDb(), account.enrollment_id, account.target, today, months ?? undefined); }
        catch (error) { left.push({ enrollmentId: account.enrollment_id, why: `cannot merge into ${account.target}: ${error instanceof Error ? error.message : "payments do not fit"}` }); continue; }
        await currentDb().execute(sql`update sales set program_id = ${to.program_id} where program_id = ${from.program_id} and member_number = ${account.member_number}`);
        changedAccounts.add(account.target);
        changedMembers.add(account.member_number);
        merged++;
        continue;
      }
      let status: string, recounted: Payment[] = [];
      try {
        // A different pay: every receipt counted again at the new monthly pay and numbered on from the account's first NOP.
        if (months) { const nops = own.map((payment) => payment.nopFrom).filter((nop) => nop > 0); recounted = renumber({ doi: account.doi }, own, nops.length ? Math.min(...nops) : 2, months); }
        status = accountState(base(account.enrollment_id, account.member_id, account.doi), months ? recounted : own, today).status;
      } catch (error) { left.push({ enrollmentId: account.enrollment_id, why: error instanceof Error ? error.message : "payments do not fit" }); continue; }
      for (const payment of recounted) await currentDb().execute(sql`update collections set nop_from = ${payment.nopFrom}, nop_to = ${payment.nopTo}, month_from = ${payment.monthFrom}, month_to = ${payment.monthTo} where collection_id = ${payment.id}`);
      await currentDb().execute(sql`update collections set program_id = ${to.program_id} where enrollment_id = ${account.enrollment_id}`);
      await currentDb().execute(sql`update member_transfers set program_id = ${to.program_id} where enrollment_id = ${account.enrollment_id}`);
      await currentDb().execute(sql`update sales set program_id = ${to.program_id} where program_id = ${from.program_id} and member_number = ${account.member_number}`);
      await currentDb().execute(sql`update member_programs set program_id = ${to.program_id}, account_status = ${status} where enrollment_id = ${account.enrollment_id}`);
      joined.set(account.member_id, account.enrollment_id);
      changedAccounts.add(account.enrollment_id);
      changedMembers.add(account.member_number);
      moved++;
    }
    // Incentives and company shares follow the new program (merged accounts were renumbered too).
    const touched = [...changedAccounts];
    const movedCollections = touched.length ? await query<{ id: string }>(sql`select collection_id as id from collections where enrollment_id in (${sql.join(touched.map((id) => sql`${id}`), sql`, `)})`) : [];
    const movedSales = changedMembers.size ? await query<{ id: string }>(sql`select sale_id as id from sales where program_id = ${to.program_id} and member_number in (${sql.join([...changedMembers].map((number) => sql`${number}`), sql`, `)})`) : [];
    const repriced = { collections: await repriceCollections(currentDb(), movedCollections.map((row) => row.id)), sales: await repriceSales(currentDb(), movedSales.map((row) => row.id)) };
    let removal: "" | "deleted" | "inactive" = "";
    if (input.removeWhenEmpty) {
      const [{ other }] = await query<{ other: number }>(sql`select (select count(*)::int from member_programs where program_id = ${from.program_id}) + (select count(*)::int from sales where program_id = ${from.program_id})
          + (select count(*)::int from collections where program_id = ${from.program_id}) + (select count(*)::int from member_transfers where program_id = ${from.program_id}) as other`);
      if (Number(other)) { await currentDb().execute(sql`update programs set status = 'inactive' where program_id = ${from.program_id}`); removal = "inactive"; }
      else { await currentDb().execute(sql`delete from program_incentives where program_id = ${from.program_id}`); await currentDb().execute(sql`delete from programs where program_id = ${from.program_id}`); removal = "deleted"; }
    }
    const actor = getEncoder();
    await currentDb().execute(sql`insert into record_corrections (correction_id, module, record_id, reason, before_json, after_json, corrected_at, encoded_by_user_id, encoded_by_employee_id, encoded_by_name, encoded_at)
      values (${createReadableId("COR")}, 'Program transfer', ${from.program_id}, ${`${from.program_name} → ${to.program_name}: ${reason}`},
        ${JSON.stringify({ program: from.program_id, accounts: chosen.map((account) => account.enrollment_id) })}::jsonb,
        ${JSON.stringify({ program: to.program_id, moved, merged, left, removal, repriced })}::jsonb, ${actor.encodedAt}, ${actor.userId}, ${actor.employeeId}, ${actor.name}, ${actor.encodedAt})`);
    return { from: from.program_name, to: to.program_name, moved, merged, left, removal, repriced: repriced.collections.repriced + repriced.sales.repriced, unpriced: repriced.collections.unpriced.length + repriced.sales.unpriced.length };
  });
}
