/**
 * Read-only (October 10, 2026). For the accounts move-program-accounts.mjs left because the member already has an
 * account in the target program (legacy-data/program-moves-left.txt), shows both accounts side by side: branch, MAS,
 * program, DOI, where each came from (old sheet LEG, old web app WEB, this system), the New Sale's application and OR
 * numbers, and the payments (count, NOP range, first and last OR number and date), plus the months both paid.
 * No months in common usually means one enrollment recorded twice (merge); the same months paid on both means two real
 * accounts. Writes legacy-data/double-accounts.csv (member numbers, OR numbers and branches; no names) and prints a
 * summary.
 *
 *   npm run prod -- node scripts/compare-double-accounts.mjs
 */
import fs from "node:fs";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const LEFT = "legacy-data/program-moves-left.txt";
if (!fs.existsSync(LEFT)) throw new Error(`${LEFT} not found: run move-program-accounts.mjs (dry run) first.`);
const lines = fs.readFileSync(LEFT, "utf8").split(/\r?\n/).filter((line) => line.includes("already has an account"));
// The program the account was meant to join, matched by code or name (the finalized D-300 (Bracketing) has the code
// "300" and the name "D-300 (Bracketing)"; the old draft had it as its code).
const targetCodes = (target) => /^D-300 \(Bracketing\)$/i.test(target) ? ["d-300 (bracketing)"] : [target.toLowerCase()];
const source = (id) => (id.includes("-LEG-") ? "old sheet" : id.includes("-WEB-") ? "old web app" : "this system");
const monthIndex = (month) => { const [y, m] = String(month).split("-").map(Number); return y * 12 + m - 1; };
const cell = (value) => { const text = String(value ?? ""); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };

async function describe(enrollmentId) {
  const [account] = await sql`select mp.enrollment_id, mp.member_id, mp.member_number, mp.branch, mp.mas, mp.doi::text as doi, mp.account_status, p.program_code, p.program_id
    from member_programs mp join programs p on p.program_id = mp.program_id where mp.enrollment_id = ${enrollmentId}`;
  if (!account) return null;
  const [sale] = await sql`select application_no, or_number, or_date::text as or_date from sales where member_number = ${account.member_number} and program_id = ${account.program_id} order by row_seq limit 1`;
  const payments = await sql`select or_number, or_date::text as or_date, nop_from, nop_to, month_from, month_to from collections where enrollment_id = ${enrollmentId} and status = 'Posted' order by or_date, nop_from`;
  const months = new Set(payments.flatMap((p) => /^\d{4}-\d{2}$/.test(p.month_from) && /^\d{4}-\d{2}$/.test(p.month_to) ? Array.from({ length: monthIndex(p.month_to) - monthIndex(p.month_from) + 1 }, (_, i) => monthIndex(p.month_from) + i) : []));
  const first = payments[0], last = payments.at(-1);
  return { ...account, sale, payments, months,
    summary: [account.enrollment_id, account.program_code, account.doi, source(account.enrollment_id), account.account_status, sale?.application_no ?? "", sale?.or_number ?? "", sale?.or_date ?? "", payments.length,
      payments.length ? `${Math.min(...payments.map((p) => p.nop_from))}-${Math.max(...payments.map((p) => p.nop_to))}` : "", first ? `${first.or_number} (${first.or_date})` : "", last ? `${last.or_number} (${last.or_date})` : ""] };
}

try {
  const header = ["#", "member number", "branch", "MAS", "both paid the same months", "suggestion",
    "A account", "A program", "A DOI", "A from", "A status", "A application no", "A New Sale OR", "A New Sale date", "A payments", "A NOP", "A first OR", "A last OR",
    "B account", "B program", "B DOI", "B from", "B status", "B application no", "B New Sale OR", "B New Sale date", "B payments", "B NOP", "B first OR", "B last OR"];
  const rows = [];
  let merge = 0, two = 0, missing = 0;
  for (const [index, line] of lines.entries()) {
    const [enrollmentId, route] = line.split("\t");
    const target = route.split("→")[1].trim();
    const a = await describe(enrollmentId.trim());
    if (!a) { missing++; continue; }
    const [other] = await sql`select mp.enrollment_id from member_programs mp join programs p on p.program_id = mp.program_id
      where mp.member_id = ${a.member_id} and mp.enrollment_id <> ${a.enrollment_id} and (lower(trim(p.program_code)) in ${sql(targetCodes(target))} or lower(trim(p.program_name)) in ${sql(targetCodes(target))}) order by mp.enrollment_id limit 1`;
    const b = other ? await describe(other.enrollment_id) : null;
    const shared = b ? [...a.months].filter((month) => b.months.has(month)).length : 0;
    const suggestion = !b ? "other account not found (moved or merged already?)" : shared ? "two real accounts (same months paid)" : "likely one enrollment recorded twice: merge";
    if (b && shared) two++; else if (b) merge++;
    rows.push([index + 1, a.member_number, a.branch, a.mas, shared, suggestion, ...a.summary, ...(b ? b.summary : Array(12).fill(""))]);
  }
  fs.mkdirSync("legacy-data", { recursive: true });
  fs.writeFileSync("legacy-data/double-accounts.csv", `﻿${[header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`);
  console.log(`Supabase project: ${project} · ${lines.length} account(s) from ${LEFT}`);
  console.log(`Likely one enrollment recorded twice (no month paid on both): ${merge}`);
  console.log(`Likely two real accounts (same months paid on both): ${two}`);
  if (missing) console.log(`Not found any more: ${missing}`);
  console.log(`\nEvery pair with branch, OR numbers and New Sale numbers: legacy-data/double-accounts.csv (open in Excel)\n`);
  for (const row of rows.slice(0, 10)) console.log(`#${row[0]} ${row[1]} · ${row[2]} · A ${row[7]} app ${row[11] || "—"} OR ${row[12] || "—"} · B ${row[19]} app ${row[23] || "—"} OR ${row[24] || "—"} · ${row[5]}`);
  if (rows.length > 10) console.log(`… ${rows.length - 10} more in the file.`);
} finally {
  await sql.end();
}
