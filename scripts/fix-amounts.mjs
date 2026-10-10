/**
 * Exceptions → "Amounts that do not match the program" (owner, October 10, 2026), from config/amount-fixes.json:
 *   - zeroSales: a New Sale recorded at ₱0 gets the program's New Sale amount (the October 4 rule: an unreadable
 *     amount is the program rate); its company share follows (amount less any recorded incentive).
 *   - multiMonth: a collection that pays exactly several months at the program rate covers that many months (the
 *     October 4 rule); the account is renumbered.
 *   - saleAmounts: a New Sale amount corrected to the given figure.
 *   - saleWithNextMonth: a New Sale that also paid the next month: the sale keeps the program's amount and a collection
 *     for the next month is added with the rest (same receipt and dates); the account is renumbered.
 *   - moveAccount: the account of that collection moves to the given program, only when all its payments fit that
 *     program's rate and the member has no account there; otherwise it is left and reported.
 *   - staffCheck: listed for staff in legacy-data/amount-checks.csv (member, program, amount, the program whose rate
 *     the amount matches, receipt and application numbers), nothing changed.
 * Renumbering: the account's payments in OR-date order from the earliest NOP recorded, each covering the months it
 * already covered or its corrected count; months follow from the DOI; the payment status is recalculated.
 * Dry run: every change is made and rolled back. One transaction; Audit Log and Record Corrections keep it.
 *
 *   node scripts/fix-amounts.mjs                       dry run on staging
 *   npm run prod -- node scripts/fix-amounts.mjs       dry run on production
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
const config = JSON.parse(fs.readFileSync("config/amount-fixes.json", "utf8"));
const today = todayInManila();
const text = (value) => String(value ?? "").trim();
const peso = (value) => `₱${Number(value).toLocaleString("en-PH")}`;
const cents = (value) => Math.round(Number(value) * 100);
const cell = (value) => { const v = String(value ?? ""); return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
class Rollback extends Error {}

const accountOf = (tx, enrollmentId) => tx`select mp.enrollment_id, mp.member_id, mp.program_id, coalesce(mp.doi::text, '') as doi, coalesce(p.program_code, p.program_name) as program,
    coalesce(p.base_pay, 0)::float8 as rate, coalesce(p.pay_balance_total, 0)::float8 as total, coalesce(p.flexible, false) as flexible, p.max_monthly_payment::float8 as max
  from member_programs mp join programs p on p.program_id = mp.program_id where mp.enrollment_id = ${enrollmentId}`.then((rows) => rows[0]);

/** Renumbers an account's posted payments in OR-date order; `months` overrides a payment's month count. */
async function renumber(tx, enrollmentId, months = new Map(), account = null) {
  const target = account ?? await accountOf(tx, enrollmentId);
  if (!target?.doi) return { error: `account ${enrollmentId} has no DOI` };
  const payments = await tx`select collection_id, or_number, or_date::text as or_date, amount_collected::float8 as amount, nop_from, nop_to from collections
    where enrollment_id = ${enrollmentId} and lower(coalesce(status, '')) = 'posted' order by or_date, collection_id`;
  const recorded = payments.map((p) => Number(p.nop_from)).filter((n) => n > 0);
  let next = Math.max(2, recorded.length ? Math.min(...recorded) : 2);
  const renumbered = payments.map((p) => {
    const count = months.get(p.collection_id) ?? (p.nop_to >= p.nop_from && p.nop_from > 0 ? p.nop_to - p.nop_from + 1 : 1);
    const nopFrom = next, nopTo = next + count - 1; next = nopTo + 1;
    return { ...p, nopFrom, nopTo, monthFrom: monthName(monthIndex(target.doi.slice(0, 7)) + nopFrom - 1), monthTo: monthName(monthIndex(target.doi.slice(0, 7)) + nopTo - 1) };
  });
  let status;
  try {
    status = accountState({ id: enrollmentId, memberId: target.member_id, memberNumber: "", programId: target.program_id, doi: target.doi, branch: "", mas: "", basePay: target.rate, payBalanceTotal: target.total, storedStatus: "", flexible: target.flexible, maxMonthlyPayment: target.max },
      renumbered.map((p) => ({ id: p.collection_id, enrollmentId, orDate: p.or_date, orNumber: text(p.or_number), monthFrom: p.monthFrom, monthTo: p.monthTo, nopFrom: p.nopFrom, nopTo: p.nopTo, amount: p.amount, dateRemitted: "", mas: "" })), today).status;
  } catch (error) { return { error: error.message }; }
  for (const p of renumbered) await tx`update collections set nop_from = ${p.nopFrom}, nop_to = ${p.nopTo}, month_from = ${p.monthFrom}, month_to = ${p.monthTo} where collection_id = ${p.collection_id}`;
  await tx`update member_programs set account_status = ${status} where enrollment_id = ${enrollmentId}`;
  return { status, line: renumbered.map((p) => `${p.or_number} NOP ${p.nopFrom}${p.nopTo > p.nopFrom ? `-${p.nopTo}` : ""} (${p.monthFrom})`).join(", ") };
}

let problems = 0;
const note = (tx, record, reason, before, after) => tx`insert into record_corrections ${tx({ correction_id: `COR-AMT-${record}-${Date.now().toString(36).toUpperCase()}`, module: "Amount fix", record_id: record,
  reason, before_json: before, after_json: after, corrected_at: new Date().toISOString(), encoded_by_name: "Amount fix", encoded_at: new Date().toISOString() })}`;

try {
  console.log(`Supabase project: ${project}${apply ? "" : " · dry run (changes made, then rolled back)"}\n`);
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_name', 'Amount fix', true)`;
    const saleRow = async (id) => (await tx`select s.*, s.amount_paid::float8 as amount, p.base_pay::float8 as rate, p.registration_fee_required, p.registration_amount::float8 as registration, coalesce(p.program_code, p.program_name) as program,
        (select enrollment_id from member_programs mp where mp.member_number = s.member_number and mp.program_id = s.program_id limit 1) as enrollment_id
      from sales s join programs p on p.program_id = s.program_id where s.sale_id = ${id}`)[0];
    const fixedOf = (sale) => (sale.registration_fee_required ? Number(sale.registration ?? 0) : Number(sale.rate ?? 0));

    console.log("New Sales at ₱0 → the program's amount:");
    for (const id of config.zeroSales ?? []) {
      const sale = await saleRow(id);
      if (!sale) { console.log(`   ${id}: not found`); continue; }
      if (cents(sale.amount) !== 0) { console.log(`   ${id}: already ${peso(sale.amount)}; skipped`); continue; }
      const amount = fixedOf(sale), share = Math.max(0, amount - Number(sale.mas_incentive ?? 0));
      await tx`update sales set amount_paid = ${amount}, remittance_amount = ${share} where sale_id = ${id}`;
      await note(tx, id, "New Sale recorded at ₱0: the program's amount (owner, October 10, 2026)", { amount: 0 }, { amount, remittance: share });
      console.log(`   ${id} · ${sale.program} · ₱0 → ${peso(amount)}`);
    }

    console.log("\nCollections paying several months → that many months:");
    for (const id of config.multiMonth ?? []) {
      const [c] = await tx`select c.collection_id, c.enrollment_id, c.amount_collected::float8 as amount, c.nop_from, c.nop_to, p.base_pay::float8 as rate, coalesce(p.program_code, p.program_name) as program
        from collections c join programs p on p.program_id = c.program_id where c.collection_id = ${id}`;
      if (!c) { console.log(`   ${id}: not found`); continue; }
      const months = cents(c.amount) / cents(c.rate);
      if (!Number.isInteger(months) || months < 2) { console.log(`   ${id}: ${peso(c.amount)} is not several whole months of ${peso(c.rate)}; skipped`); problems++; continue; }
      if (c.nop_to - c.nop_from + 1 === months) { console.log(`   ${id}: already ${months} months`); continue; }
      const result = await renumber(tx, c.enrollment_id, new Map([[id, months]]));
      if (result.error) { console.log(`   ${id}: STOPPED, ${result.error}`); problems++; continue; }
      await note(tx, id, `${peso(c.amount)} pays ${months} months of ${peso(c.rate)} (owner, October 10, 2026)`, { nop: [c.nop_from, c.nop_to] }, { months, account: c.enrollment_id, status: result.status });
      console.log(`   ${id} · ${c.program} · ${peso(c.amount)} = ${months} months · account ${c.enrollment_id}: ${result.line} · ${result.status}`);
    }

    console.log("\nNew Sale amounts corrected:");
    for (const fix of config.saleAmounts ?? []) {
      const sale = await saleRow(fix.id);
      if (!sale) { console.log(`   ${fix.id}: not found`); continue; }
      const share = Math.max(0, fix.amount - Number(sale.mas_incentive ?? 0));
      await tx`update sales set amount_paid = ${fix.amount}, remittance_amount = ${share} where sale_id = ${fix.id}`;
      await note(tx, fix.id, fix.note, { amount: sale.amount }, { amount: fix.amount });
      console.log(`   ${fix.id} · ${sale.program} · ${peso(sale.amount)} → ${peso(fix.amount)}`);
    }

    console.log("\nNew Sales that also paid the next month:");
    for (const fix of config.saleWithNextMonth ?? []) {
      const sale = await saleRow(fix.id);
      if (!sale) { console.log(`   ${fix.id}: not found`); continue; }
      const fixed = fixedOf(sale), rest = Math.round((sale.amount - fixed) * 100) / 100;
      if (!sale.enrollment_id || rest <= 0 || cents(rest) % cents(sale.rate) !== 0) { console.log(`   ${fix.id}: ${peso(sale.amount)} is not the New Sale plus whole months of ${peso(sale.rate)}, or it has no account; skipped`); problems++; continue; }
      const id = `COL-FIX-${fix.id}`;
      const [done] = await tx`select collection_id from collections where collection_id = ${id}`;
      if (done) { console.log(`   ${fix.id}: already split (${id})`); continue; }
      const [account] = await tx`select member_id from member_programs where enrollment_id = ${sale.enrollment_id}`;
      const months = cents(rest) / cents(sale.rate);
      await tx`update sales set amount_paid = ${fixed}, remittance_amount = ${Math.max(0, fixed - Number(sale.mas_incentive ?? 0))} where sale_id = ${fix.id}`;
      await tx`insert into collections ${tx({ collection_id: id, collection_batch_id: `CBT-FIX-${fix.id}`, enrollment_id: sale.enrollment_id, member_id: account.member_id, member_number: sale.member_number,
        program_id: sale.program_id, branch: sale.branch, mas: sale.mas, or_number: sale.or_number ? `${text(sale.or_number)}` : null, or_date: sale.or_date, amount_collected: rest,
        month_from: "", month_to: "", nop_from: 2, nop_to: 1 + months, status: "Posted", created_at: new Date().toISOString(), collected_by_role: "MAS", remittance_amount: rest, remittance_status: "Remitted",
        accountable_employee_id: sale.accountable_employee_id, accountable_name: sale.mas, accountable_role: "MAS", date_remitted: sale.date_remitted, legacy_duplicate: Boolean(sale.or_number),
        encoded_by_name: "Amount fix", encoded_at: new Date().toISOString() })}`;
      const result = await renumber(tx, sale.enrollment_id, new Map([[id, months]]));
      if (result.error) throw new Error(`${fix.id}: ${result.error}`);
      await note(tx, fix.id, fix.note, { amount: sale.amount }, { amount: fixed, collection: id, months, status: result.status });
      console.log(`   ${fix.id} · ${sale.program} · ${peso(sale.amount)} → New Sale ${peso(fixed)} + ${id} ${peso(rest)} (${months} month${months === 1 ? "" : "s"}) · account ${sale.enrollment_id}: ${result.line} · ${result.status}`);
    }

    console.log("\nAccounts moved to the program their payments fit:");
    for (const fix of config.moveAccount ?? []) {
      const [c] = await tx`select enrollment_id from collections where collection_id = ${fix.collection}`;
      const [to] = await tx`select program_id, coalesce(program_code, program_name) as program, base_pay::float8 as rate, coalesce(pay_balance_total, 0)::float8 as total, coalesce(flexible, false) as flexible, max_monthly_payment::float8 as max
        from programs where lower(program_code) = lower(${fix.program}) or lower(program_name) = lower(${fix.program})`;
      if (!c || !to) { console.log(`   ${fix.collection}: ${!c ? "collection" : `program ${fix.program}`} not found`); problems++; continue; }
      const account = await accountOf(tx, c.enrollment_id);
      const [already] = await tx`select enrollment_id from member_programs where member_id = ${account.member_id} and program_id = ${to.program_id}`;
      if (already) { console.log(`   ${fix.collection}: the member already has a ${to.program} account (${already.enrollment_id}); left for staff`); problems++; continue; }
      const [sale] = await tx`select sale_id, amount_paid::float8 as amount from sales where member_number = (select member_number from member_programs where enrollment_id = ${c.enrollment_id}) and program_id = ${account.program_id} limit 1`;
      const result = await renumber(tx, c.enrollment_id, new Map(), { ...account, program_id: to.program_id, rate: to.rate, total: to.total, flexible: to.flexible, max: to.max });
      if (result.error) { console.log(`   ${fix.collection}: account ${c.enrollment_id} (${account.program}) cannot be ${to.program}: ${result.error}. Left for staff.`); problems++; continue; }
      if (sale && cents(sale.amount) !== cents(to.rate)) { console.log(`   ${fix.collection}: its New Sale is ${peso(sale.amount)}, not ${to.program}'s ${peso(to.rate)}; left for staff`); problems++; continue; }
      await tx`update collections set program_id = ${to.program_id} where enrollment_id = ${c.enrollment_id}`;
      if (sale) await tx`update sales set program_id = ${to.program_id} where sale_id = ${sale.sale_id}`;
      await tx`update member_programs set program_id = ${to.program_id} where enrollment_id = ${c.enrollment_id}`;
      await note(tx, c.enrollment_id, fix.note, { program: account.program_id }, { program: to.program_id, status: result.status });
      console.log(`   ${fix.collection}: account ${c.enrollment_id} ${account.program} → ${to.program} · ${result.line} · ${result.status}`);
    }

    // For staff: what each listed record is and which program its amount matches.
    const rows = [["record", "member number", "member", "branch", "MAS", "program", "program rate", "amount", "amount matches the rate of", "OR number", "application no.", "date"]];
    for (const id of config.staffCheck ?? []) {
      const [r] = id.startsWith("SALE")
        ? await tx`select s.member_number, trim(concat_ws(' ', m.first_name, m.middle_name, m.surname)) as name, s.branch, s.mas, coalesce(p.program_code, p.program_name) as program, p.base_pay::float8 as rate,
            s.amount_paid::float8 as amount, s.or_number, s.application_no, coalesce(s.or_date::text, '') as date from sales s left join members m on m.member_number = s.member_number left join programs p on p.program_id = s.program_id where s.sale_id = ${id}`
        : await tx`select c.member_number, trim(concat_ws(' ', m.first_name, m.middle_name, m.surname)) as name, c.branch, coalesce(nullif(c.accountable_name, ''), c.mas) as mas, coalesce(p.program_code, p.program_name) as program, p.base_pay::float8 as rate,
            c.amount_collected::float8 as amount, c.or_number, '' as application_no, coalesce(c.or_date::text, '') as date from collections c left join members m on m.member_id = c.member_id left join programs p on p.program_id = c.program_id where c.collection_id = ${id}`;
      if (!r) continue;
      const matches = await tx`select coalesce(program_code, program_name) as program from programs where base_pay = ${r.amount} and coalesce(status, 'active') = 'active' order by 1`;
      rows.push([id, r.member_number, r.name, r.branch, r.mas, r.program, r.rate, r.amount, matches.map((m) => m.program).join(" / "), r.or_number, r.application_no, r.date]);
    }
    fs.mkdirSync("legacy-data", { recursive: true });
    fs.writeFileSync("legacy-data/amount-checks.csv", `﻿${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`);
    console.log(`\nFor staff (amount equals another program's rate): ${rows.length - 1} listed in legacy-data/amount-checks.csv (member, program, amount, matching program, receipt and application numbers).`);
    if (!apply) throw new Rollback();
  });
  console.log(problems ? `\nApplied, with ${problems} item(s) left (see above).` : "\nApplied.");
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
  console.log(`\nDry run: everything above was rolled back.${problems ? ` ${problems} item(s) would be left (see above).` : ""} Add --apply to make the changes.`);
} finally {
  await sql.end();
}
