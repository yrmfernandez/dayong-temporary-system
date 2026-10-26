/**
 * Read-only: the old "DSRDPI - FULLY PAID MEMBERS (Responses)" form (owner, October 27, 2026) against the system, to plan
 * the new Fully Paid status. Per row: the program the label names (with its rate, Pay Balance Total and category), the
 * member and account it matches (by name, program and branch, inside this script; names are never printed), what the
 * system has received on that account (New Sale + posted collections) and its months, compared with the form's total,
 * and the account's status now. Then the totals per program label.
 *
 *   npm run prod -- node scripts/check-fully-paid.mjs "legacy-data/old-data/DSRDPI - FULLY PAID MEMBERS (Responses).xlsx"
 *
 * Prints row numbers, IDs, program labels, amounts and statuses only. Nothing is written.
 */
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const file = process.argv[2];
if (!file) { console.error("Usage: node scripts/check-fully-paid.mjs <workbook.xlsx>"); process.exit(1); }
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const cell = (v) => v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? String(v.text ?? v.result ?? "") : String(v);
const fold = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z, ]/g, " ").replace(/\s+/g, " ").trim();
const norm = (v) => String(v ?? "").toUpperCase().replace(/\(\s*HG\s*\)/g, "HG").replace(/\s+/g, " ").trim();
const peso = (n) => Number(n || 0).toLocaleString("en-PH");

try {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const rows = [];
  workbook.worksheets[0].eachRow((row, number) => { if (number > 1) rows.push({ row: number, values: Array.from({ length: 15 }, (_, i) => cell(row.values[i + 1])) }); });
  const entries = rows.map(({ row, values }) => ({ row, branch: values[1].trim(), name: values[3].trim(), label: values[4].trim(), type: values[5].trim(), total: Number(values[6]) || 0,
    paidOn: values[7].slice(0, 10), doi: values[10].slice(0, 10), certificate: values[11].trim(), released: values[12] === "true", pending: values[13] === "true" }));
  console.log(`Database ${ref} (read only) · ${entries.length} rows in the form`);

  const aliases = new Map(Object.entries(JSON.parse(readFileSync("config/legacy-programs.json", "utf8")).aliases).map(([k, v]) => [norm(k), norm(v)]));
  const programs = await sql`select p.program_id, p.program_code, p.program_name, p.base_pay::float8 as rate, coalesce(p.pay_balance_total, 0)::float8 as total, p.registration_fee_required as fee,
      coalesce(c.category_name, '') as category from programs p left join program_categories c on c.category_id = p.category_id`;
  const programOf = (label) => { const key = aliases.get(norm(label)) ?? norm(label); return programs.find((p) => [p.program_id, p.program_code, p.program_name].some((v) => norm(v) === key)); };

  console.log("\nProgram labels in the form:");
  for (const label of [...new Set(entries.map((e) => e.label))]) {
    const p = programOf(label), inForm = entries.filter((e) => e.label === label);
    const totals = [...new Set(inForm.map((e) => e.total))].join("/");
    console.log(`  "${label}" (${inForm.length}) → ${p ? `${p.program_name} [${p.program_id}] rate ${peso(p.rate)} · Pay Balance Total ${p.total ? peso(p.total) : "not set"} · ${p.category || "no category"} · form total ${totals} = ${p.rate ? Math.round((Number(totals.split("/")[0]) / p.rate) * 10) / 10 : "?"} months` : "NO PROGRAM FOUND"}`);
  }

  const members = await sql`select member_id, member_number, surname, first_name from members`;
  const accounts = await sql`select mp.enrollment_id, mp.member_id, mp.program_id, mp.branch, mp.account_status, mp.doi::text as doi from member_programs mp`;
  const ids = accounts.map((a) => a.enrollment_id);
  const paid = new Map((await sql`select enrollment_id, coalesce(sum(amount_collected), 0)::float8 as amount, coalesce(max(nop_to), 0)::int as nop, max(or_date)::text as last
    from collections where lower(trim(status)) = 'posted' and enrollment_id in ${sql(ids)} group by 1`).map((r) => [r.enrollment_id, r]));
  const sales = await sql`select member_number, program_id, coalesce(sum(amount_paid), 0)::float8 as amount from sales group by 1, 2`;
  const saleOf = (memberNumber, programId) => sales.find((s) => s.member_number === memberNumber && s.program_id === programId)?.amount ?? 0;

  const results = [];
  console.log("\nRows: row · branch · label → account · form total · in the system (New Sale + collections, last NOP, last OR) · status now · certificate · released");
  for (const e of entries) {
    const p = programOf(e.label);
    const [surname = "", given = ""] = fold(e.name).includes(",") ? fold(e.name).split(",").map((s) => s.trim()) : [fold(e.name).split(" ").at(-1), fold(e.name).split(" ")[0]];
    const firstGiven = given.split(" ")[0] ?? "";
    const people = members.filter((m) => fold(m.surname) === surname && firstGiven && (fold(m.first_name).split(" ")[0] === firstGiven || fold(m.first_name).startsWith(given) || given.startsWith(fold(m.first_name))));
    let matched = p ? accounts.filter((a) => a.program_id === p.program_id && people.some((m) => m.member_id === a.member_id)) : [];
    if (matched.length > 1) { const byBranch = matched.filter((a) => fold(a.branch) === fold(e.branch)); if (byBranch.length) matched = byBranch; }
    let outcome, line;
    if (!p) { outcome = "no program"; line = "program not found"; }
    else if (!people.length) { outcome = "no member"; line = "no member with that name"; }
    else if (!matched.length) { outcome = "member, no account"; line = `member found (${people.length}), no ${p.program_name} account`; }
    else if (matched.length > 1) { outcome = "several"; line = `${matched.length} possible accounts`; }
    else {
      const a = matched[0], m = members.find((x) => x.member_id === a.member_id), c = paid.get(a.enrollment_id), received = saleOf(m.member_number, a.program_id) + (c?.amount ?? 0);
      outcome = received >= e.total ? "complete in system" : "short in system";
      line = `${a.enrollment_id} (${m.member_number}) · ${peso(e.total)} · ${peso(received)}${received < e.total ? ` (short ${peso(e.total - received)})` : ""}, NOP ${c?.nop ?? 0}, last OR ${c?.last ?? "-"} · ${a.account_status || "-"}`;
    }
    results.push({ ...e, outcome });
    console.log(`  ${e.row} · ${e.branch} · ${e.label} → ${line} · ${e.certificate ? "cert" : "NO CERT"} · ${e.released ? "released" : e.pending ? "pending" : "not released"}`);
  }
  const tally = (key) => Object.entries(results.reduce((m, r) => (m[r[key]] = (m[r[key]] || 0) + 1, m), {})).map(([k, n]) => `${k} ${n}`).join(" · ");
  console.log(`\nSummary: ${tally("outcome")}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
