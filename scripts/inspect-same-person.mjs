/**
 * Read-only: two member records that should be one person (owner, October 27, 2026: the Entry Clerk answered "Yes, same
 * person" in New Sales, but a second member was still created). For each member number: whether the names and
 * birthdates match the other's (yes/no only, no names printed), their accounts and New Sales with when and by whom they
 * were saved, and whether a sale came through a MAS sale submission (approved in New Sales) instead of the New Sales form.
 *
 *   npm run prod -- node scripts/inspect-same-person.mjs PH-91674008 PH-53477804
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const numbers = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (numbers.length !== 2) { console.error("Usage: node scripts/inspect-same-person.mjs <member number> <member number>"); process.exit(1); }
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const fold = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const same = (a, b) => !fold(a) && !fold(b) ? "both blank" : !fold(a) || !fold(b) ? "one blank" : fold(a) === fold(b) ? "same" : "DIFFERENT";

try {
  console.log(`Database ${ref} (read only)`);
  const found = [];
  for (const number of numbers) {
    const [member] = await sql`select member_id, member_number, surname, first_name, middle_name, name_extension, birthdate::text as birthdate from members where member_number = ${number}`;
    if (!member) { console.log(`\n${number}: no member with that number`); continue; }
    found.push(member);
  }
  if (found.length === 2) {
    const [a, b] = found;
    console.log(`\nCompared: surname ${same(a.surname, b.surname)} · first name ${same(a.first_name, b.first_name)} · middle name ${same(a.middle_name, b.middle_name)} · extension ${same(a.name_extension, b.name_extension)} · birthdate ${same(a.birthdate, b.birthdate)}`);
    // What the New Sales same-name lookup compares: surname and first name, capitals and spaces ignored.
    const key = (value) => String(value ?? "").trim().toLowerCase().replace(/ñ/g, "n").replace(/\s+/g, " ");
    console.log(`The New Sales same-name check would ${key(a.surname) === key(b.surname) && key(a.first_name) === key(b.first_name) ? "find" : "NOT find"} one from the other (it needs the same surname and first name).`);
  }
  for (const member of found) {
    console.log(`\n${member.member_number} (${member.member_id})`);
    const accounts = await sql`select mp.enrollment_id, p.program_name, mp.doi::text as doi, mp.branch, to_char(mp.date_created at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as created, mp.encoded_by_name
      from member_programs mp join programs p on p.program_id = mp.program_id where mp.member_id = ${member.member_id} order by mp.date_created`;
    for (const a of accounts) console.log(`  account ${a.enrollment_id} · ${a.program_name} · DOI ${a.doi ?? "-"} · ${a.branch ?? "-"} · created ${a.created ?? "?"} by ${a.encoded_by_name || "?"}`);
    const sales = await sql`select s.sale_id, p.program_name, s.application_no, to_char(coalesce(s.encoded_at, s.date_created) at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as saved, s.encoded_by_name,
        (select ss.submission_id from sale_submissions ss where ss.sale_ids ilike '%' || s.sale_id || '%' limit 1) as submission
      from sales s left join programs p on p.program_id = s.program_id where s.member_number = ${member.member_number} order by coalesce(s.encoded_at, s.date_created)`;
    for (const s of sales) console.log(`  New Sale ${s.sale_id} · ${s.program_name ?? "-"} · app ${s.application_no || "-"} · saved ${s.saved ?? "?"} by ${s.encoded_by_name || "?"} · ${s.submission ? `from MAS submission ${s.submission}` : "encoded in New Sales"}`);
    if (!accounts.length && !sales.length) console.log("  no accounts or New Sales");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
