/**
 * Read-only lookup (October 10, 2026): the member (PH number and name), program, branch and MAS of New Sales
 * (SALE-…), collections (COL-…) or accounts (ENR-…) by record ID, so staff can find them in the system.
 *
 *   npm run prod -- node scripts/lookup-records.mjs SALE-WEB-1975 COL-WEB-1462 ENR-WEB-391
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const ids = process.argv.slice(2).map((id) => id.trim()).filter(Boolean);
if (!ids.length) throw new Error("Give record IDs, e.g. SALE-WEB-1975 COL-WEB-1462.");

try {
  console.log(`Supabase project: ${project}\n`);
  for (const id of ids) {
    const [row] = id.startsWith("SALE")
      ? await sql`select s.member_number, trim(concat_ws(' ', m.first_name, m.middle_name, m.surname)) as name, coalesce(p.program_code, p.program_name) as program, s.branch, s.mas,
          coalesce(s.or_date::text, '') as date, s.amount_paid::float8 as amount, s.application_no as ref from sales s left join members m on m.member_number = s.member_number left join programs p on p.program_id = s.program_id where s.sale_id = ${id}`
      : id.startsWith("COL")
        ? await sql`select c.member_number, trim(concat_ws(' ', m.first_name, m.middle_name, m.surname)) as name, coalesce(p.program_code, p.program_name) as program, c.branch, coalesce(nullif(c.accountable_name, ''), c.mas) as mas,
            coalesce(c.or_date::text, '') as date, c.amount_collected::float8 as amount, c.or_number as ref from collections c left join members m on m.member_id = c.member_id left join programs p on p.program_id = c.program_id where c.collection_id = ${id}`
        : await sql`select mp.member_number, trim(concat_ws(' ', m.first_name, m.middle_name, m.surname)) as name, coalesce(p.program_code, p.program_name) as program, mp.branch, mp.mas,
            coalesce(mp.doi::text, '') as date, null::float8 as amount, mp.account_status as ref from member_programs mp left join members m on m.member_id = mp.member_id left join programs p on p.program_id = mp.program_id where mp.enrollment_id = ${id}`;
    if (!row) { console.log(`${id}: not found`); continue; }
    console.log(`${id} · ${row.member_number} · ${row.name} · ${row.program} · ${row.branch} · ${row.mas || "—"} · ${row.date}${row.amount != null ? ` · ₱${Number(row.amount).toLocaleString("en-PH")}` : ""}${row.ref ? ` · ${row.ref}` : ""}`);
  }
} finally {
  await sql.end();
}
