import { sql, type SQL } from "drizzle-orm";

import { accountState, todayInManila, type AccountPayment } from "@/lib/account-rules";
import { currentDb, inTransaction } from "@/lib/db";
import { createReadableId } from "@/lib/readable-id";
import { getEncoder } from "@/lib/encoder-context";

/**
 * Moving accounts between programs from the Programs page (owner, October 10, 2026): an administrator moves all of a
 * program's accounts, or the ones they tick, to another program with the same monthly pay, the same rules as
 * scripts/move-program-accounts.mjs:
 *   - an account moves with its New Sale, collections and transfer records; its payment status is recalculated;
 *   - a member who already has an account in the target program is merged into it (their payments join that account,
 *     renumbered in month order from the lowest NOP either had, the earlier DOI kept) unless both accounts paid the same month, which
 *     means two real accounts: those are left and reported;
 *   - optionally the emptied program is deleted (with its incentive tiers), or set inactive if anything still uses it.
 * One transaction; the Audit Log keeps every change and Record Corrections a summary.
 */
const text = (value: unknown) => String(value ?? "").trim();
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];
const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const query = async <T,>(statement: SQL) => rowsOf<T>(await currentDb().execute(statement));

type Program = { program_id: string; program_name: string; program_code: string; rate: number; total: number; flexible: boolean; max: number | null; status: string };
const programById = async (id: string) => (await query<Program>(sql`select program_id, program_name, coalesce(program_code, '') as program_code, coalesce(base_pay, 0)::float8 as rate,
    coalesce(pay_balance_total, 0)::float8 as total, coalesce(flexible, false) as flexible, max_monthly_payment::float8 as max, coalesce(status, 'active') as status
  from programs where program_id = ${text(id)}`))[0];
const samePay = (a: Program, b: Program) => Math.round(a.rate * 100) === Math.round(b.rate * 100) && a.flexible === b.flexible;

export type TransferAccount = { enrollmentId: string; memberNumber: string; memberName: string; branch: string; mas: string; doi: string; status: string; payments: number };

/** A program's accounts and the programs with the same monthly pay they can move to. */
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
    targets: targets.filter((target) => samePay(target, from)).map((target) => ({ id: target.program_id, name: target.program_name, code: target.program_code, rate: target.rate, status: target.status, accounts: Number(target.accounts) })),
  };
}

type Payment = AccountPayment;
const paymentsOf = async (enrollmentId: string): Promise<Payment[]> => (await query<{ collection_id: string; or_date: string; or_number: string; month_from: string; month_to: string; nop_from: number; nop_to: number; amount: number }>(sql`
    select collection_id, coalesce(or_date::text, '') as or_date, coalesce(or_number, '') as or_number, coalesce(month_from, '') as month_from, coalesce(month_to, '') as month_to,
      nop_from, nop_to, amount_collected::float8 as amount
    from collections where enrollment_id = ${enrollmentId} and lower(coalesce(status, '')) = 'posted'`))
  .map((row) => ({ id: row.collection_id, enrollmentId, orDate: row.or_date, orNumber: row.or_number, monthFrom: row.month_from, monthTo: row.month_to, nopFrom: Number(row.nop_from), nopTo: Number(row.nop_to), amount: Number(row.amount), dateRemitted: "", mas: "" }));

/** Moves the chosen accounts (or all) of one program to another with the same monthly pay; see the file comment. */
export async function transferProgramAccounts(input: { fromProgramId: string; toProgramId: string; enrollmentIds?: string[]; all?: boolean; removeWhenEmpty?: boolean; reason?: string }) {
  const reason = text(input.reason);
  if (reason.length < 3 || reason.length > 300) throw new Error("Give the reason for the transfer (3 to 300 characters).");
  return inTransaction(async () => {
    const [from, to] = await Promise.all([programById(input.fromProgramId), programById(input.toProgramId)]);
    if (!from || !to) throw new Error("Program not found.");
    if (from.program_id === to.program_id) throw new Error("Choose a different program to move to.");
    if (!samePay(from, to)) throw new Error(`${to.program_name} has a different monthly pay (₱${to.rate}${to.flexible ? ", flexible" : ""}) from ${from.program_name} (₱${from.rate}${from.flexible ? ", flexible" : ""}). Only programs with the same pay can take these accounts.`);
    const accounts = await query<{ enrollment_id: string; member_id: string; member_number: string; doi: string; target: string | null }>(sql`
      select mp.enrollment_id, mp.member_id, coalesce(mp.member_number, '') as member_number, coalesce(mp.doi::text, '') as doi,
        (select o.enrollment_id from member_programs o where o.member_id = mp.member_id and o.program_id = ${to.program_id} order by o.enrollment_id limit 1) as target
      from member_programs mp where mp.program_id = ${from.program_id}`);
    const wanted = input.all ? null : new Set((input.enrollmentIds ?? []).map(text).filter(Boolean));
    if (wanted && !wanted.size) throw new Error("Choose the accounts to move, or all of them.");
    const chosen = accounts.filter((account) => !wanted || wanted.has(account.enrollment_id));
    if (wanted && chosen.length !== wanted.size) throw new Error("Some of the chosen accounts are no longer in this program. Reload and try again.");
    const today = todayInManila();
    const base = (id: string, memberId: string, doi: string) => ({ id, memberId, memberNumber: "", programId: to.program_id, doi, branch: "", mas: "", basePay: to.rate, payBalanceTotal: to.total, storedStatus: "", flexible: to.flexible, maxMonthlyPayment: to.max });
    const left: Array<{ enrollmentId: string; why: string }> = [];
    let moved = 0, merged = 0;
    // A member with two accounts here: the first moves, the second merges into it.
    const joined = new Map<string, string>();
    for (const chosenAccount of chosen) {
      const account = { ...chosenAccount, target: chosenAccount.target ?? joined.get(chosenAccount.member_id) ?? null };
      const own = await paymentsOf(account.enrollment_id);
      if (account.target) {
        // Merge into the member's account in the target program.
        const [target] = await query<{ doi: string }>(sql`select coalesce(doi::text, '') as doi from member_programs where enrollment_id = ${account.target}`);
        const theirs = await paymentsOf(account.target);
        const months = (list: Payment[]) => new Set(list.flatMap((payment) => /^\d{4}-\d{2}$/.test(payment.monthFrom) && /^\d{4}-\d{2}$/.test(payment.monthTo) ? Array.from({ length: monthIndex(payment.monthTo) - monthIndex(payment.monthFrom) + 1 }, (_, i) => monthIndex(payment.monthFrom) + i) : []));
        const theirMonths = months(theirs);
        if ([...months(own)].some((month) => theirMonths.has(month))) { left.push({ enrollmentId: account.enrollment_id, why: `both this account and the member's ${to.program_name} account (${account.target}) paid the same month: two real accounts, left as they are` }); continue; }
        const combined = [...theirs, ...own].map((payment) => ({ ...payment, enrollmentId: account.target! })).sort((a, b) => a.monthFrom.localeCompare(b.monthFrom) || a.orDate.localeCompare(b.orDate));
        // Numbered on from the lowest NOP either account already had (2 when NOP 1 was the New Sale).
        const firstNops = combined.map((payment) => payment.nopFrom).filter((value) => value > 0);
        let nop = firstNops.length ? Math.min(...firstNops) : 1;
        const renumbered = combined.map((payment) => { const count = monthIndex(payment.monthTo) - monthIndex(payment.monthFrom) + 1; const next = { ...payment, nopFrom: nop, nopTo: nop + count - 1 }; nop += count; return next; });
        const doi = [target?.doi, account.doi].filter(Boolean).sort()[0] ?? "";
        let status: string;
        try { status = accountState(base(account.target, account.member_id, doi), renumbered, today).status; }
        catch (error) { left.push({ enrollmentId: account.enrollment_id, why: `cannot merge into ${account.target}: ${error instanceof Error ? error.message : "payments do not fit"}` }); continue; }
        await currentDb().execute(sql`update collections set enrollment_id = ${account.target}, program_id = ${to.program_id} where enrollment_id = ${account.enrollment_id}`);
        for (const payment of renumbered) await currentDb().execute(sql`update collections set nop_from = ${payment.nopFrom}, nop_to = ${payment.nopTo} where collection_id = ${payment.id} and (nop_from <> ${payment.nopFrom} or nop_to <> ${payment.nopTo})`);
        await currentDb().execute(sql`update member_transfers set enrollment_id = ${account.target}, program_id = ${to.program_id} where enrollment_id = ${account.enrollment_id}`);
        await currentDb().execute(sql`update sales set program_id = ${to.program_id} where program_id = ${from.program_id} and member_number = ${account.member_number}`);
        await currentDb().execute(sql`update member_programs set doi = ${doi || null}, account_status = ${status} where enrollment_id = ${account.target}`);
        await currentDb().execute(sql`delete from member_programs where enrollment_id = ${account.enrollment_id}`);
        merged++;
        continue;
      }
      let status: string;
      try { status = accountState(base(account.enrollment_id, account.member_id, account.doi), own, today).status; }
      catch (error) { left.push({ enrollmentId: account.enrollment_id, why: error instanceof Error ? error.message : "payments do not fit" }); continue; }
      await currentDb().execute(sql`update collections set program_id = ${to.program_id} where enrollment_id = ${account.enrollment_id}`);
      await currentDb().execute(sql`update member_transfers set program_id = ${to.program_id} where enrollment_id = ${account.enrollment_id}`);
      await currentDb().execute(sql`update sales set program_id = ${to.program_id} where program_id = ${from.program_id} and member_number = ${account.member_number}`);
      await currentDb().execute(sql`update member_programs set program_id = ${to.program_id}, account_status = ${status} where enrollment_id = ${account.enrollment_id}`);
      joined.set(account.member_id, account.enrollment_id);
      moved++;
    }
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
        ${JSON.stringify({ program: to.program_id, moved, merged, left, removal })}::jsonb, ${actor.encodedAt}, ${actor.userId}, ${actor.employeeId}, ${actor.name}, ${actor.encodedAt})`);
    return { from: from.program_name, to: to.program_name, moved, merged, left, removal };
  });
}
