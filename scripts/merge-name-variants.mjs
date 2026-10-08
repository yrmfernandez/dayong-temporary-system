/**
 * Merges accounts split by a spelling difference (scripts/find-name-variants.mjs; October 8, 2026, e.g.
 * "Potenciando" / "Potenciado"). Pairs come from config/name-merges.json, chosen by the owner:
 *   { "merges": [ { "keep": "<enrollment ID>", "other": "<enrollment ID>", "note": "...", "useOtherName": true } ] }
 * useOtherName: the other spelling is the correct one (e.g. "Potenciado", owner October 8, 2026); the kept member takes it.
 *
 *   node scripts/merge-name-variants.mjs                      dry run on staging
 *   node scripts/merge-name-variants.mjs --apply              merge on staging
 *   npm run prod -- node scripts/merge-name-variants.mjs [--apply]
 *
 * For each pair, the other account's collections move to the kept account (and member). This only happens when the
 * combined payments form one valid history under the kept account's DOI and program rate (lib/account-rules.ts). When
 * their NOPs clash but no two payments fall in the same month (one person paying monthly, numbered wrongly, as in
 * "Potenciando": NOP 8 and 9 written twice), they are renumbered consecutively in OR-date order, each covering the
 * months its amount pays (the owner's rule of October 4, 2026). Payments made in the same month, in two or more
 * months, mean two people paying side by side: the pair is left as it is and listed. Two accounts that both have a New
 * Sale are never merged. Then the other account is deleted, and the other member too
 * when they have no other account or New Sale; the kept account's payment status is recalculated. One transaction per
 * pair; every change is in the Audit Log and a summary in Record Corrections. Prints names (the owner chose the pairs).
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import nextEnv from "@next/env";
import postgres from "postgres";
import { accountState, monthIndex, monthName, todayInManila } from "../lib/account-rules.ts";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const merges = JSON.parse(fs.readFileSync("config/name-merges.json", "utf8")).merges ?? [];
const today = todayInManila();
const text = (value) => String(value ?? "").trim();

async function load(db, enrollmentId) {
  const [account] = await db`select mp.enrollment_id, mp.member_id, mp.member_number, mp.program_id, mp.doi::text as doi, mp.branch, mp.mas, mp.status,
      trim(concat_ws(' ', m.first_name, m.middle_name, m.surname, m.name_extension)) as name, p.base_pay::float8 as base_pay,
      coalesce(p.pay_balance_total, 0)::float8 as pay_balance_total, p.flexible, p.max_monthly_payment::float8 as max_monthly_payment,
      exists (select 1 from sales s where s.member_number = mp.member_number and s.program_id = mp.program_id) as has_sale
    from member_programs mp join members m on m.member_id = mp.member_id left join programs p on p.program_id = mp.program_id
    where mp.enrollment_id = ${enrollmentId}`;
  if (!account) return null;
  const payments = (await db`select collection_id, or_date::text as or_date, or_number, month_from, month_to, nop_from, nop_to, amount_collected::float8 as amount
    from collections where enrollment_id = ${enrollmentId} and lower(coalesce(status, '')) = 'posted'`).map((row) => ({
    id: row.collection_id, enrollmentId, orDate: row.or_date, orNumber: text(row.or_number), monthFrom: text(row.month_from), monthTo: text(row.month_to),
    nopFrom: Number(row.nop_from), nopTo: Number(row.nop_to), amount: Number(row.amount), dateRemitted: "", mas: "",
  }));
  return { ...account, payments };
}

try {
  console.log(`Supabase project: ${project} · ${merges.length} pair(s) chosen${apply ? "" : " · dry run"}\n`);
  const result = { merged: 0, left: 0, missing: 0 };
  for (const [index, pair] of merges.entries()) {
    const label = `${String(index + 1).padStart(2)}. ${pair.note ?? `${pair.keep} ← ${pair.other}`}`;
    const outcome = await sql.begin(async (tx) => {
      const keep = await load(tx, pair.keep), other = await load(tx, pair.other);
      if (!keep || !other) return { status: "missing", reason: `${!keep ? "kept" : "other"} account not found (already merged?)` };
      if (keep.program_id !== other.program_id) return { status: "left", reason: "different programs" };
      if (keep.has_sale && other.has_sale) return { status: "left", reason: "both accounts have a New Sale" };
      // The kept account takes the other's payments under its own DOI and rate; they must fit as one history.
      const account = { id: keep.enrollment_id, memberId: keep.member_id, memberNumber: "", programId: keep.program_id, doi: keep.doi, branch: "", mas: "",
        basePay: keep.base_pay, payBalanceTotal: keep.pay_balance_total, storedStatus: "", flexible: keep.flexible, maxMonthlyPayment: keep.max_monthly_payment };
      const combined = [...keep.payments, ...other.payments.map((payment) => ({ ...payment, enrollmentId: keep.enrollment_id }))];
      let state, renumbered = false, payments = combined;
      try { state = accountState(account, combined, today); }
      catch (error) {
        const months = new Map();
        for (const payment of combined) months.set(payment.orDate.slice(0, 7), (months.get(payment.orDate.slice(0, 7)) ?? 0) + 1);
        const shared = [...months.values()].filter((count) => count > 1).length;
        if (shared >= 2) return { status: "left", reason: `two payments in the same month in ${shared} months: two people paying side by side` };
        // One person paying monthly with NOPs written wrongly: renumber in OR-date order from the first NOP.
        const sorted = [...combined].sort((x, y) => x.orDate.localeCompare(y.orDate) || x.nopFrom - y.nopFrom);
        const doiIndex = monthIndex(keep.doi.slice(0, 7));
        let next = doiIndex + Math.min(...combined.map((payment) => payment.nopFrom)) - 1;
        payments = [];
        for (const payment of sorted) {
          const count = keep.flexible ? monthIndex(payment.monthTo) - monthIndex(payment.monthFrom) + 1 : payment.amount / keep.base_pay;
          if (!Number.isInteger(count) || count < 1) return { status: "left", reason: `₱${payment.amount} is not a whole number of monthly payments at ₱${keep.base_pay}` };
          payments.push({ ...payment, monthFrom: monthName(next), monthTo: monthName(next + count - 1), nopFrom: next - doiIndex + 1, nopTo: next + count - doiIndex });
          next += count;
        }
        try { state = accountState(account, payments, today); renumbered = true; }
        catch (again) { return { status: "left", reason: `the payments do not form one history even renumbered (${(again.message || String(error)).replace(/^(Payment|Account) \S+ /, "")})` }; }
      }
      const nops = renumbered ? `; renumbered NOP ${payments[0].nopFrom}–${payments.at(-1).nopTo}` : "";
      if (!apply) return { status: "merged", detail: `${other.payments.length} collection(s) move${nops}; status ${state.status}` };
      await tx`select set_config('app.user_name', 'Same-person merge', true)`;
      await tx`update collections set enrollment_id = ${keep.enrollment_id}, member_id = ${keep.member_id}, member_number = ${keep.member_number} where enrollment_id = ${other.enrollment_id}`;
      // Renumbered payments get their new months and NOPs (the Audit Log keeps the old ones).
      if (renumbered) for (const payment of payments) await tx`update collections set month_from = ${payment.monthFrom}, month_to = ${payment.monthTo}, nop_from = ${payment.nopFrom}, nop_to = ${payment.nopTo} where collection_id = ${payment.id}`;
      await tx`update member_transfers set enrollment_id = ${keep.enrollment_id}, member_id = ${keep.member_id}, member_number = ${keep.member_number} where enrollment_id = ${other.enrollment_id}`;
      await tx`delete from member_programs where enrollment_id = ${other.enrollment_id}`;
      // The member's name (and the copies on their New Sales, by the member trigger) follow the correct spelling.
      if (pair.useOtherName) {
        await tx`update members m set first_name = o.first_name, middle_name = o.middle_name, surname = o.surname, name_extension = o.name_extension
          from (select first_name, middle_name, surname, name_extension from members where member_id = ${other.member_id}) o where m.member_id = ${keep.member_id}`;
      }
      const [left] = await tx`select (select count(*)::int from member_programs where member_id = ${other.member_id}) as accounts,
        (select count(*)::int from sales where member_number = ${other.member_number}) as sales, (select count(*)::int from collections where member_id = ${other.member_id}) as collections`;
      let memberRemoved = false;
      if (other.member_id !== keep.member_id && !left.accounts && !left.sales && !left.collections) {
        await tx`update beneficiaries set member_id = ${keep.member_id} where member_id = ${other.member_id}`;
        await tx`delete from members where member_id = ${other.member_id}`;
        memberRemoved = true;
      }
      await tx`update member_programs set account_status = ${state.status} where enrollment_id = ${keep.enrollment_id}`;
      await tx`insert into record_corrections ${tx({ correction_id: `COR-MRG-${createHash("sha1").update(`${keep.enrollment_id}|${other.enrollment_id}`).digest("hex").slice(0, 10).toUpperCase()}`,
        module: "Same-person merge", record_id: keep.enrollment_id, reason: `Same person, different spelling: ${other.name} merged into ${keep.name} (owner, October 8, 2026)`,
        before_json: { keep: keep.enrollment_id, other: other.enrollment_id, otherMember: other.member_id, movedCollections: other.payments.map((payment) => payment.id) },
        after_json: { status: state.status, memberRemoved, renumbered: renumbered ? payments.map((payment) => ({ id: payment.id, nop: [payment.nopFrom, payment.nopTo], months: [payment.monthFrom, payment.monthTo] })) : null }, corrected_at: new Date().toISOString(), encoded_by_name: "Same-person merge", encoded_at: new Date().toISOString() })}`;
      return { status: "merged", detail: `${other.payments.length} collection(s) moved${nops}; status ${state.status}${memberRemoved ? "; duplicate member removed" : ""}` };
    });
    result[outcome.status]++;
    console.log(`${label}: ${outcome.status === "merged" ? (apply ? "MERGED" : "would merge") : outcome.status === "left" ? "LEFT AS IS" : "SKIPPED"} · ${outcome.detail ?? outcome.reason}`);
  }
  console.log(`\n${apply ? "Merged" : "Would merge"} ${result.merged}; left as is ${result.left}; not found ${result.missing}.${apply ? "" : " Dry run: nothing was written. Add --apply to merge."}`);
} finally {
  await sql.end();
}
