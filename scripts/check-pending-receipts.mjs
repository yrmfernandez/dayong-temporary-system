/**
 * Read-only (October 9, 2026). For each Legacy Pending COLL payment that is not a whole number of months at its
 * program's rate, looks for where it may really belong, as with the two ₱300 receipts that were D-300 (BRACKETING)
 * payments filed under D-350 (5Y):
 *   - MISFILED: the same member (the row's assigned member, or members with the same surname and first name) has another
 *     account whose rate the amount pays exactly (a flexible program: at least its minimum, within its monthly maximum),
 *     and that account has no payment in the receipt's month;
 *   - OTHER RATE: every pending payment of that account is a whole number of months at one lower rate (e.g. ₱350 steps on
 *     DPB-420), so the member seems to pay another plan;
 *   - CHECK RECEIPT: neither.
 * Names are matched inside the script; it prints row references, IDs, program codes, dates and amounts only.
 *
 *   node scripts/check-pending-receipts.mjs                      staging
 *   npm run prod -- node scripts/check-pending-receipts.mjs      production
 *   add --json=FILE to also write the MISFILED rows with one clear account as receipts for
 *   config/legacy-receipt-fixes.json (scripts/fix-legacy-receipts.mjs), for the owner to confirm before use.
 */
import fs from "node:fs";
import nextEnv from "@next/env";
import { google } from "googleapis";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const text = (value) => String(value ?? "").trim();
const norm = (value) => text(value).toUpperCase().replace(/\s+/g, " ");
const nameKey = (value) => text(value).toUpperCase().replace(/[^A-ZÑ, ]/g, "").replace(/\s+/g, " ").trim();
const cents = (value) => Math.round(Number(String(value).replace(/[^0-9.]/g, "")) * 100);
const isoDate = (value) => { const v = text(value); if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10); const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : ""; };
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

const aliases = new Map(Object.entries(JSON.parse(fs.readFileSync("config/legacy-programs.json", "utf8")).aliases).map(([k, v]) => [norm(k), norm(v)]));
const programs = await sql`select program_id, program_code, program_name, base_pay::float8 as rate from programs`;
const programOf = (label) => { const code = aliases.get(norm(label)) ?? norm(label); return programs.find((p) => norm(p.program_code) === code || norm(p.program_name) === code); };
const leaveOut = (fs.existsSync("config/legacy-migration-map.json") ? JSON.parse(fs.readFileSync("config/legacy-migration-map.json", "utf8")).leaveOut : null) ?? {};

const auth = new google.auth.GoogleAuth({ credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") }, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
const values = (await google.sheets({ version: "v4", auth }).spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: "'Legacy Pending COLL'" })).data.values ?? [];
const header = (values[0] ?? []).map((name) => norm(name));
const cell = (row, name) => text(row[header.indexOf(name)]);
const rows = values.slice(1).map((row) => ({
  ref: `${cell(row, "SOURCE TAB")} row ${cell(row, "SOURCE ROW")}`, key: `${cell(row, "SOURCE")}|${cell(row, "SOURCE TAB")}|${Number(cell(row, "SOURCE ROW"))}`,
  member: cell(row, "LEGACY MEMBER ID"), name: nameKey(cell(row, "PH/MEMBER")), label: cell(row, "DAYONG PROGRAM"), program: programOf(cell(row, "DAYONG PROGRAM")),
  amount: cents(cell(row, "AMOUNT COLLECTED")), orDate: isoDate(cell(row, "OR DATE")), branch: cell(row, "BRANCH"),
})).filter((row) => !leaveOut[row.key]);

console.log(`Supabase project: ${project} · ${rows.length} pending collection row(s)\n`);
const byAccount = new Map();
for (const row of rows) { const k = `${row.member || row.name}|${row.program?.program_id ?? row.label}`; (byAccount.get(k) ?? byAccount.set(k, []).get(k)).push(row); }

const counts = { misfiled: 0, otherRate: 0, check: 0 };
const jsonFile = process.argv.find((arg) => arg.startsWith("--json="))?.slice(7) ?? "";
const suggestions = [];
for (const row of rows) {
  if (!row.program || !(row.program.rate > 0) || !(row.amount > 0)) continue;
  const rate = Math.round(row.program.rate * 100);
  if (row.amount % rate === 0) continue;
  // Candidate members: the assigned one, and members with the same surname and first name.
  const [surname, given = ""] = row.name.split(",").map((part) => part.trim());
  const first = given.split(" ")[0] ?? "";
  const members = await sql`select member_id from members where member_id = ${row.member || ""} or (upper(trim(surname)) = ${surname} and upper(trim(first_name)) like ${`${first}%`})`;
  const ids = members.map((m) => m.member_id);
  const accounts = ids.length ? await sql`select mp.enrollment_id, mp.member_id, p.program_code, p.base_pay::float8 as rate, p.flexible, p.max_monthly_payment::float8 as max, mp.doi::text as doi, mp.branch,
      (select count(*)::int from collections c where c.enrollment_id = mp.enrollment_id and c.status = 'Posted' and to_char(c.or_date, 'YYYY-MM') = ${row.orDate.slice(0, 7)}) as same_month
    from member_programs mp join programs p on p.program_id = mp.program_id where mp.member_id in ${sql(ids)} and mp.program_id <> ${row.program.program_id}` : [];
  // One month of a flexible program is any amount from its minimum up to its monthly maximum.
  const months = (a) => a.flexible ? (row.amount >= Math.round(a.rate * 100) && (!a.max || row.amount <= Math.round(a.max * 100)) ? 1 : 0) : row.amount % Math.round(a.rate * 100) === 0 ? row.amount / Math.round(a.rate * 100) : 0;
  const fits = accounts.filter((a) => a.rate > 0 && months(a) > 0 && (!a.doi || a.doi <= row.orDate));
  const misfiled = fits.filter((a) => a.same_month === 0);
  const siblings = byAccount.get(`${row.member || row.name}|${row.program.program_id}`) ?? [];
  const common = siblings.reduce((g, s) => gcd(g, s.amount), 0);
  const otherRate = common > 0 && common < rate && common >= 10000 && siblings.length > 1 ? common / 100 : 0;
  const verdict = misfiled.length ? "MISFILED" : otherRate ? "OTHER RATE" : "CHECK RECEIPT";
  if (misfiled.length === 1) suggestions.push({ row: row.key, member: misfiled[0].member_id, program: misfiled[0].program_code, months: months(misfiled[0]), note: `₱${row.amount / 100} ${misfiled[0].program_code} payment filed under ${row.program.program_code} in the old sheet` });
  counts[verdict === "MISFILED" ? "misfiled" : verdict === "OTHER RATE" ? "otherRate" : "check"]++;
  console.log(`${verdict.padEnd(13)} ${row.ref} · ${row.program.program_code} ₱${rate / 100}/mo · paid ₱${row.amount / 100} · OR ${row.orDate} · ${row.branch}`);
  for (const a of misfiled) console.log(`               → ${a.enrollment_id} · ${a.program_code} ₱${a.rate}${a.flexible ? " minimum, flexible" : ""}/mo (${months(a)} month) · member ${a.member_id} (${a.member_id === row.member ? "the row's own member" : "same name only"}) · ${a.branch} · no payment in ${row.orDate.slice(0, 7)}`);
  for (const a of fits.filter((x) => x.same_month > 0)) console.log(`               (${a.enrollment_id} · ${a.program_code} ₱${a.rate}/mo fits the amount but already has a payment in ${row.orDate.slice(0, 7)})`);
  if (!misfiled.length && otherRate) console.log(`               → all ${siblings.length} pending payments of this account are whole months at ₱${otherRate}`);
  if (!misfiled.length && !otherRate) console.log(`               member(s) found: ${ids.length} · other accounts: ${accounts.map((a) => `${a.program_code} ₱${a.rate}`).join(", ") || "none"}`);
}
console.log(`\nMISFILED ${counts.misfiled} · OTHER RATE ${counts.otherRate} · CHECK RECEIPT ${counts.check}`);
if (jsonFile) { fs.writeFileSync(jsonFile, JSON.stringify(suggestions, null, 2)); console.log(`${suggestions.length} suggestion(s) written to ${jsonFile}.`); }
await sql.end();
