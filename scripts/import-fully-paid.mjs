/**
 * Imports the old "DSRDPI - FULLY PAID MEMBERS (Responses)" form into the system (owner, October 27, 2026): each row
 * matched to one account (by name, program and branch, inside this script; names are never printed) is recorded Fully
 * Paid with the form's date, total and certificate number (source "Old list"; certificate Released when the form says
 * released, else Pending). An account the nightly job already recorded from its receipts, with its certificate not yet
 * released, is replaced by the form's record (the real certificate number). Rows that match no account, several
 * accounts, a program the labels do not name, or a certificate number already used are listed and left out.
 *
 * Also shows which other accounts the new rule finds fully paid from their receipts (the nightly job records those
 * with new certificate numbers). Run it after migration 0030 and before deploying, so the old certificate numbers are
 * in place before any new number is given.
 *
 *   npm run prod -- node scripts/import-fully-paid.mjs "legacy-data/old-data/DSRDPI - FULLY PAID MEMBERS (Responses).xlsx"           dry run
 *   npm run prod -- node scripts/import-fully-paid.mjs "legacy-data/old-data/DSRDPI - FULLY PAID MEMBERS (Responses).xlsx" --apply   import
 *
 * Program labels the old aliases do not name go in config/fully-paid-programs.json: { "D-460 (Old)": "<program ID>" }.
 * Prints row numbers, IDs, program labels, amounts and statuses only.
 */
import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import nextEnv from "@next/env";
import postgres from "postgres";
import { accountState, forfeitMonthsFor, todayInManila } from "../lib/account-rules.ts";

nextEnv.loadEnvConfig(process.cwd());
const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const apply = process.argv.includes("--apply");
if (!file) { console.error("Usage: node scripts/import-fully-paid.mjs <workbook.xlsx> [--apply]"); process.exit(1); }
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const cell = (v) => v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? String(v.text ?? v.result ?? "") : String(v);
const fold = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z, ]/g, " ").replace(/\s+/g, " ").trim();
const norm = (v) => String(v ?? "").toUpperCase().replace(/\(\s*HG\s*\)/g, "HG").replace(/\s+/g, " ").trim();
class DryRun extends Error {}

try {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const entries = [];
  workbook.worksheets[0].eachRow((row, number) => {
    if (number === 1) return;
    const v = Array.from({ length: 15 }, (_, i) => cell(row.values[i + 1]));
    entries.push({ row: number, submitted: v[0], branch: v[1].trim(), name: v[3].trim(), label: v[4].trim(), total: Number(v[6]) || 0, paidOn: v[7].slice(0, 10), certificate: v[11].trim().toUpperCase(), released: v[12] === "true" });
  });
  console.log(`Database ${ref}${apply ? " (APPLY)" : " (dry run)"} · ${entries.length} rows in the form`);

  const aliases = new Map(Object.entries(JSON.parse(readFileSync("config/legacy-programs.json", "utf8")).aliases).map(([k, v]) => [norm(k), norm(v)]));
  const extra = existsSync("config/fully-paid-programs.json") ? JSON.parse(readFileSync("config/fully-paid-programs.json", "utf8")) : {};
  for (const [label, target] of Object.entries(extra)) if (!label.startsWith("_")) aliases.set(norm(label), norm(target));

  // A number the form gave twice (owner, October 27, 2026): the first certificate (earliest form date) keeps it, the
  // later ones are renumbered. Every number in the form is reserved, so a new number never repeats a paper certificate.
  const byNumber = new Map();
  for (const e of entries) if (e.certificate) byNumber.set(e.certificate, [...(byNumber.get(e.certificate) ?? []), e]);
  for (const group of byNumber.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.submitted.localeCompare(b.submitted) || a.row - b.row);
    for (const later of group.slice(1)) { later.renumberedFrom = later.certificate; later.certificate = ""; }
  }
  const reservedNumbers = [...byNumber.keys()];
  const outcome = { recorded: [], replaced: [], already: [], skipped: [] };
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_name', 'Fully Paid import (old form)', true)`;
    const programs = await tx`select program_id, program_code, program_name from programs`;
    const programOf = (label) => { const key = aliases.get(norm(label)) ?? norm(label); return programs.find((p) => [p.program_id, p.program_code, p.program_name].some((v) => norm(v) === key)); };
    const members = await tx`select member_id, surname, first_name from members`;
    const accounts = await tx`select enrollment_id, member_id, program_id, branch, doi::text as doi, fully_paid_on, fully_paid_source, certificate_number, certificate_status from member_programs`;

    // First every row's account, so two rows matching the same account are both left out (the owner decides).
    console.log("Matching rows to accounts…");
    const plan = [];
    for (const e of entries) {
      const p = programOf(e.label);
      const [surname = "", given = ""] = fold(e.name).includes(",") ? fold(e.name).split(",").map((s) => s.trim()) : [fold(e.name).split(" ").at(-1), fold(e.name).split(" ")[0]];
      const firstGiven = given.split(" ")[0] ?? "";
      const people = members.filter((m) => fold(m.surname) === surname && firstGiven && (fold(m.first_name).split(" ")[0] === firstGiven || fold(m.first_name).startsWith(given) || given.startsWith(fold(m.first_name))));
      let matched = p ? accounts.filter((a) => a.program_id === p.program_id && people.some((m) => m.member_id === a.member_id)) : [];
      if (matched.length > 1) { const byBranch = matched.filter((a) => fold(a.branch) === fold(e.branch)); if (byBranch.length) matched = byBranch; }
      const skip = (why) => outcome.skipped.push({ row: e.row, label: e.label, branch: e.branch, why });
      if (!p) { skip("program label not known (add it to config/fully-paid-programs.json)"); continue; }
      if (!people.length) { skip("no member with that name"); continue; }
      if (!matched.length) { skip(`member found, no ${p.program_name} account`); continue; }
      if (matched.length > 1) { skip(`${matched.length} possible accounts`); continue; }
      plan.push({ e, account: matched[0] });
    }
    const rowsOfAccount = new Map();
    for (const item of plan) rowsOfAccount.set(item.account.enrollment_id, [...(rowsOfAccount.get(item.account.enrollment_id) ?? []), item.e.row]);
    console.log(`Recording ${plan.length} matched rows…`);
    const unnumbered = [];
    for (const { e, account } of plan) {
      const skip = (why) => outcome.skipped.push({ row: e.row, label: e.label, branch: e.branch, why });
      const sharing = rowsOfAccount.get(account.enrollment_id);
      if (sharing.length > 1) { skip(`rows ${sharing.join(" and ")} all match account ${account.enrollment_id} (two members with similar names?)`); continue; }
      if (account.fully_paid_on && !(account.fully_paid_source === "Receipts" && account.certificate_status !== "Released")) { outcome.already.push({ row: e.row, id: account.enrollment_id, certificate: account.certificate_number }); continue; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.paidOn) || !e.total) { skip("no valid date or total of full payment"); continue; }
      if (e.certificate) {
        const [taken] = await tx`select enrollment_id from member_programs where upper(certificate_number) = ${e.certificate} and enrollment_id <> ${account.enrollment_id}`;
        if (taken) { skip(`certificate ${e.certificate} already used by ${taken.enrollment_id} (the form gave it twice)`); continue; }
      }
      const replacing = Boolean(account.fully_paid_on);
      await tx`update member_programs set account_status = 'Fully Paid', fully_paid_on = ${e.paidOn}::date, fully_paid_total = ${e.total}, fully_paid_source = 'Old list',
          fully_paid_recorded_by = 'Fully Paid import (old form)', certificate_number = ${e.certificate || null},
          certificate_status = ${e.certificate ? (e.released ? "Released" : "Pending") : null}, certificate_released_on = null, certificate_released_by = null
        where enrollment_id = ${account.enrollment_id}`;
      account.fully_paid_on = e.paidOn;
      const item = { row: e.row, id: account.enrollment_id, certificate: e.certificate, note: e.renumberedFrom ? ` (${e.renumberedFrom} was given twice; the earlier certificate keeps it)` : "" };
      if (!e.certificate) unnumbered.push({ item, account });
      (replacing ? outcome.replaced : outcome.recorded).push(item);
    }
    // Rows without a certificate yet: the next number of the branch's area this year (as lib/full-payments.ts gives), after
    // every number from the form is in place.
    const year = Number(todayInManila().slice(0, 4));
    console.log(`Numbering ${unnumbered.length} without a certificate…`);
    for (const { item, account } of unnumbered) {
      const [branch] = await tx`select certificate_prefix from branches where upper(trim(branch_name_code)) = upper(trim(${account.branch ?? ""}))`;
      const area = String(branch?.certificate_prefix ?? "").toUpperCase();
      if (!area) { item.certificate = "(none: the branch has no certificate prefix)"; continue; }
      const used = (await tx`select certificate_number from member_programs where certificate_number is not null`).map((row) => row.certificate_number).concat(reservedNumbers);
      const sequenceOf = (number) => { const match = /^([A-Z]+)-?(\d{4})-(\d+)[A-Z]?$/i.exec(String(number)); return match && match[1].toUpperCase() === area && Number(match[2]) === year ? Number(match[3]) : 0; };
      const next = Math.max(0, ...used.map(sequenceOf)) + 1;
      item.certificate = `${area}${year}-${String(next).padStart(3, "0")} (new)`;
      await tx`update member_programs set certificate_number = ${item.certificate.replace(" (new)", "")}, certificate_status = 'Pending' where enrollment_id = ${item.id}`;
    }

    console.log(`\nRecorded from the form: ${outcome.recorded.length}`);
    for (const item of outcome.recorded) console.log(`  row ${item.row} → ${item.id} · ${item.certificate}${item.note}`);
    // Keep every number of the form reserved for the app's automatic numbering (lib/full-payments.ts RESERVED_KEY).
    await tx`insert into system_settings (setting_key, value, updated_at, updated_by) values ('certificate_reserved', ${JSON.stringify(reservedNumbers)}, now(), 'Fully Paid import (old form)')
      on conflict (setting_key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`;
    console.log(`
Certificate numbers in the form, reserved so no new number repeats them: ${reservedNumbers.length}`);
    if (outcome.replaced.length) { console.log(`\nAutomatic records replaced by the form's certificate: ${outcome.replaced.length}`); for (const item of outcome.replaced) console.log(`  row ${item.row} → ${item.id} · ${item.certificate}`); }
    if (outcome.already.length) { console.log(`\nAlready Fully Paid (kept): ${outcome.already.length}`); for (const item of outcome.already) console.log(`  row ${item.row} → ${item.id} · ${item.certificate ?? "-"}`); }
    console.log(`\nLeft out, for the owner: ${outcome.skipped.length}`);
    for (const item of outcome.skipped) console.log(`  row ${item.row} · ${item.branch} · ${item.label}: ${item.why}`);

    console.log("Checking other accounts the receipts complete…");
    // Other accounts the new rule finds fully paid from their receipts: the nightly job records them with new numbers.
    const today = todayInManila();
    const all = await tx`select mp.enrollment_id, mp.member_id, mp.member_number, mp.program_id, mp.doi::text as doi, mp.account_status, mp.forfeit_held, mp.fully_paid_on::text as fully_paid_on,
        p.program_name, p.category_id, coalesce(c.category_name, '') as category_name, coalesce(p.base_pay, 0)::float8 as rate, coalesce(p.pay_balance_total, 0)::float8 as total,
        coalesce(p.flexible, false) as flexible, p.max_monthly_payment::float8 as max, p.registration_fee_required as fee
      from member_programs mp join programs p on p.program_id = mp.program_id left join program_categories c on c.category_id = p.category_id
      where coalesce(p.pay_balance_total, 0) > 0 and mp.fully_paid_on is null and mp.doi is not null`;
    const payments = await tx`select collection_id, enrollment_id, or_date::text as or_date, or_number, month_from, month_to, nop_from, nop_to, amount_collected::float8 as amount
      from collections where status = 'Posted' and enrollment_id in ${tx(all.map((a) => a.enrollment_id).concat(["-"]))}`;
    const sales = await tx`select member_number, program_id, coalesce(sum(amount_paid), 0)::float8 as amount from sales group by 1, 2`;
    const byAccount = new Map();
    for (const p of payments) byAccount.set(p.enrollment_id, [...(byAccount.get(p.enrollment_id) ?? []), { id: p.collection_id, enrollmentId: p.enrollment_id, orDate: p.or_date, orNumber: p.or_number ?? "", monthFrom: (p.month_from ?? "").slice(0, 7), monthTo: (p.month_to ?? "").slice(0, 7), nopFrom: p.nop_from ?? 0, nopTo: p.nop_to ?? 0, amount: p.amount, dateRemitted: "", mas: "" }]);
    const found = new Map();
    for (const a of all) {
      const saleCredit = a.fee ? 0 : sales.find((s) => s.member_number === a.member_number && s.program_id === a.program_id)?.amount ?? 0;
      try {
        const state = accountState({ id: a.enrollment_id, memberId: a.member_id, memberNumber: a.member_number ?? "", programId: a.program_id, doi: a.doi, branch: "", mas: "", basePay: a.rate, payBalanceTotal: a.total, storedStatus: a.account_status ?? "", forfeitHeld: a.forfeit_held, flexible: a.flexible, maxMonthlyPayment: a.max, forfeitMonths: forfeitMonthsFor(a.category_id, a.category_name), saleCredit, registrationFee: a.fee }, byAccount.get(a.enrollment_id) ?? [], today);
        if (state.status === "Fully Paid") found.set(a.program_name, [...(found.get(a.program_name) ?? []), a.enrollment_id]);
      } catch { /* a history that does not fit is left to Exceptions */ }
    }
    const count = [...found.values()].reduce((sum, list) => sum + list.length, 0);
    console.log(`\nOther accounts the receipts complete (the nightly job records them, with new certificate numbers to release): ${count}`);
    for (const [program, ids] of found) console.log(`  ${program}: ${ids.length} · ${ids.slice(0, 12).join(", ")}${ids.length > 12 ? ", …" : ""}`);
    if (!apply) throw new DryRun();
  });
  console.log("\nApplied.");
} catch (error) {
  if (error instanceof DryRun) console.log("\nDry run: nothing was written. Add --apply to import.");
  else {
    // The whole error: some database errors carry no message, only a code and detail.
    console.error("\nStopped:", error instanceof Error ? (error.stack || error.message) : error);
    if (error && typeof error === "object") console.error(JSON.stringify({ code: error.code, detail: error.detail, hint: error.hint, where: error.where, query: String(error.query ?? "").slice(0, 300) }, null, 2));
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
