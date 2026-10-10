/**
 * Puts a member's receipts onto their one right account (owner, October 10, 2026), from config/receipt-consolidations.json:
 * { member: "PH-…", program: "DP-…", receipts: ["OR …", …] }.
 *   - Each listed OR (matched ignoring spaces and case) must be a posted collection of that member; it moves to the
 *     member's account in `program` (which must exist), whatever program it was entered under.
 *   - That account's posted payments are then renumbered in OR-date order: from NOP 2 (NOP 1 is the New Sale), each
 *     payment as many months as it already covered, or its amount at the program rate when it came from another
 *     program; months follow from the DOI (the October 4 repair rule). Its payment status is recalculated.
 *   - Any other account of the member left with no collection is deleted: its transfer records move to the kept
 *     account, and its New Sale is deleted when the kept program already has one with the same application number
 *     (a duplicate), otherwise moved to the kept program.
 * Dry run: every change is made and then rolled back, so it shows exactly what --apply will do. One transaction; the
 * Audit Log keeps every change and Record Corrections a summary. Prints member numbers, OR numbers, dates, amounts and
 * NOPs only.
 *
 *   node scripts/consolidate-member-receipts.mjs                     dry run on staging
 *   npm run prod -- node scripts/consolidate-member-receipts.mjs     dry run on production
 *   ... --apply
 */
import fs from "node:fs";
import nextEnv from "@next/env";
import postgres from "postgres";
import { accountState, monthIndex, monthName, todayInManila } from "../lib/account-rules.ts";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { cases = [] } = JSON.parse(fs.readFileSync("config/receipt-consolidations.json", "utf8"));
const today = todayInManila();
const text = (value) => String(value ?? "").trim();
const key = (value) => text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
const peso = (value) => `₱${Number(value).toLocaleString("en-PH")}`;
class Rollback extends Error {}

let problems = 0;
try {
  console.log(`Supabase project: ${project} · ${cases.length} member(s)${apply ? "" : " · dry run (changes made, then rolled back)"}\n`);
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_name', 'Receipt consolidation', true)`;
    for (const item of cases) {
      const label = `${item.member} → ${item.program}`;
      const [member] = await tx`select member_id, member_number from members where member_number = ${text(item.member)}`;
      if (!member) { console.log(`${label}: member not found.\n`); problems++; continue; }
      const [target] = await tx`select mp.enrollment_id, mp.member_id, mp.program_id, coalesce(mp.doi::text, '') as doi, p.program_name, coalesce(p.base_pay, 0)::float8 as rate,
          coalesce(p.pay_balance_total, 0)::float8 as total, coalesce(p.flexible, false) as flexible, p.max_monthly_payment::float8 as max
        from member_programs mp join programs p on p.program_id = mp.program_id where mp.member_id = ${member.member_id} and mp.program_id = ${text(item.program)}`;
      if (!target) { console.log(`${label}: the member has no account in ${item.program}.\n`); problems++; continue; }
      if (!target.doi) { console.log(`${label}: account ${target.enrollment_id} has no DOI, so its months cannot be worked out.\n`); problems++; continue; }
      const wanted = [...new Set((item.receipts ?? []).map(key).filter(Boolean))];
      const found = await tx`select c.collection_id, c.or_number, c.or_key, c.or_date::text as or_date, c.amount_collected::float8 as amount, c.nop_from, c.nop_to, c.enrollment_id, c.member_id, c.program_id, coalesce(p.program_code, p.program_name, c.program_id) as program
        from collections c left join programs p on p.program_id = c.program_id where c.or_key in ${tx(wanted)} and lower(coalesce(c.status, '')) = 'posted'`;
      console.log(`${label} (${target.program_name}, account ${target.enrollment_id}, DOI ${target.doi}, ${peso(target.rate)}/month)`);
      const missing = wanted.filter((k) => !found.some((row) => row.or_key === k));
      const elsewhere = found.filter((row) => row.member_id !== member.member_id);
      if (missing.length) console.log(`   NOT FOUND (no posted collection): ${missing.join(", ")}`);
      if (elsewhere.length) console.log(`   ON ANOTHER MEMBER (not moved; check): ${elsewhere.map((row) => `${row.or_number} (${row.program})`).join(", ")}`);
      const mine = found.filter((row) => row.member_id === member.member_id);
      for (const row of mine) console.log(`   OR ${row.or_number} · ${row.or_date} · ${peso(row.amount)} · was ${row.program} NOP ${row.nop_from}${row.nop_to > row.nop_from ? `-${row.nop_to}` : ""}${row.enrollment_id === target.enrollment_id ? " (already here)" : ""}`);
      const movedIds = new Set(mine.filter((row) => row.enrollment_id !== target.enrollment_id).map((row) => row.collection_id));
      const sources = [...new Set(mine.filter((row) => row.enrollment_id !== target.enrollment_id).map((row) => row.enrollment_id))];
      if (movedIds.size) await tx`update collections set enrollment_id = ${target.enrollment_id}, program_id = ${target.program_id} where collection_id in ${tx([...movedIds])}`;

      // Renumber the kept account in OR-date order from NOP 2; months follow from the DOI.
      const payments = await tx`select collection_id, or_number, or_date::text as or_date, amount_collected::float8 as amount, nop_from, nop_to from collections
        where enrollment_id = ${target.enrollment_id} and lower(coalesce(status, '')) = 'posted' order by or_date, collection_id`;
      let next = 2, failed = "";
      const renumbered = payments.map((p) => {
        const byAmount = target.flexible ? 1 : Math.round(p.amount * 100) / Math.round(target.rate * 100);
        const kept = p.nop_to >= p.nop_from && p.nop_from > 0 ? p.nop_to - p.nop_from + 1 : 0;
        const count = movedIds.has(p.collection_id) ? byAmount : kept || byAmount;
        if (!Number.isInteger(count) || count < 1) failed ||= `OR ${p.or_number} (${peso(p.amount)}) is not a whole number of ${peso(target.rate)} months`;
        const months = Number.isInteger(count) && count > 0 ? count : 1;
        const nopFrom = next, nopTo = next + months - 1; next = nopTo + 1;
        return { ...p, nopFrom, nopTo, monthFrom: monthName(monthIndex(target.doi.slice(0, 7)) + nopFrom - 1), monthTo: monthName(monthIndex(target.doi.slice(0, 7)) + nopTo - 1) };
      });
      if (failed) { console.log(`   STOPPED: ${failed}. Nothing changes for this member.\n`); problems++; continue; }
      for (const p of renumbered) await tx`update collections set nop_from = ${p.nopFrom}, nop_to = ${p.nopTo}, month_from = ${p.monthFrom}, month_to = ${p.monthTo} where collection_id = ${p.collection_id}`;
      let status;
      try {
        status = accountState({ id: target.enrollment_id, memberId: member.member_id, memberNumber: "", programId: target.program_id, doi: target.doi, branch: "", mas: "", basePay: target.rate, payBalanceTotal: target.total, storedStatus: "", flexible: target.flexible, maxMonthlyPayment: target.max },
          renumbered.map((p) => ({ id: p.collection_id, enrollmentId: target.enrollment_id, orDate: p.or_date, orNumber: text(p.or_number), monthFrom: p.monthFrom, monthTo: p.monthTo, nopFrom: p.nopFrom, nopTo: p.nopTo, amount: p.amount, dateRemitted: "", mas: "" })), today).status;
      } catch (error) { console.log(`   STOPPED: ${error.message}. Nothing changes for this member.\n`); problems++; continue; }
      await tx`update member_programs set account_status = ${status} where enrollment_id = ${target.enrollment_id}`;
      console.log(`   Account ${target.enrollment_id} after: ${renumbered.map((p) => `${p.or_number} NOP ${p.nopFrom}${p.nopTo > p.nopFrom ? `-${p.nopTo}` : ""} (${p.monthFrom})`).join(", ")} · status ${status}`);

      // Other accounts of the member left with no collection go; their New Sale is deleted if it duplicates the kept one.
      const empty = await tx`select mp.enrollment_id, mp.program_id, coalesce(p.program_code, p.program_name) as program from member_programs mp left join programs p on p.program_id = mp.program_id
        where mp.member_id = ${member.member_id} and mp.enrollment_id <> ${target.enrollment_id} and not exists (select 1 from collections c where c.enrollment_id = mp.enrollment_id)`;
      const [keptSale] = await tx`select application_key from sales where member_number = ${member.member_number} and program_id = ${target.program_id} order by row_seq limit 1`;
      for (const account of empty) {
        const sales = await tx`select sale_id, application_no, application_key, linked_remittance_id from sales where member_number = ${member.member_number} and program_id = ${account.program_id}`;
        if (sales.some((sale) => sale.linked_remittance_id)) { console.log(`   KEPT ${account.enrollment_id} (${account.program}): its New Sale is on a remittance slip.`); continue; }
        await tx`update member_transfers set enrollment_id = ${target.enrollment_id}, program_id = ${target.program_id} where enrollment_id = ${account.enrollment_id}`;
        for (const sale of sales) {
          if (keptSale && sale.application_key && sale.application_key === keptSale.application_key) {
            await tx`delete from beneficiaries where sale_id = ${sale.sale_id}`.catch(() => undefined);
            await tx`delete from sales where sale_id = ${sale.sale_id}`;
            console.log(`   New Sale ${sale.sale_id} (application ${sale.application_no}) deleted: same application as the kept account's.`);
          } else {
            await tx`update sales set program_id = ${target.program_id} where sale_id = ${sale.sale_id}`;
            console.log(`   New Sale ${sale.sale_id}${sale.application_no ? ` (application ${sale.application_no})` : ""} moved to ${target.program_name}.`);
          }
        }
        await tx`delete from member_programs where enrollment_id = ${account.enrollment_id}`;
        console.log(`   Account ${account.enrollment_id} (${account.program}) deleted: no payment left${sources.includes(account.enrollment_id) ? "" : " (it had none)"}.`);
      }
      await tx`insert into record_corrections ${tx({ correction_id: `COR-RCN-${member.member_number}-${Date.now().toString(36).toUpperCase()}`, module: "Receipt consolidation", record_id: target.enrollment_id,
        reason: text(item.note) || `Receipts of ${member.member_number} put on ${target.program_name}`, before_json: { receipts: mine.map((row) => ({ or: row.or_number, enrollment: row.enrollment_id, program: row.program_id, nop: [row.nop_from, row.nop_to] })) },
        after_json: { enrollment: target.enrollment_id, status, nops: renumbered.map((p) => ({ or: p.or_number, nop: [p.nopFrom, p.nopTo], month: p.monthFrom })), deleted: empty.map((account) => account.enrollment_id) },
        corrected_at: new Date().toISOString(), encoded_by_name: "Receipt consolidation", encoded_at: new Date().toISOString() })}`;
      console.log("");
    }
    if (!apply) throw new Rollback();
  });
  console.log(problems ? `Applied, with ${problems} member(s) skipped (see above).` : "Applied.");
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
  console.log(`Dry run: everything above was rolled back.${problems ? ` ${problems} member(s) need attention first.` : ""} Add --apply to make the changes.`);
} finally {
  await sql.end();
}
