/**
 * Read-only (October 10, 2026). For Exceptions → "Possible duplicates": shows both records of every pair side by side
 * so the owner can decide (same entry twice, two real records, or a typo). Reads the list from
 * legacy-data/exceptions.csv (scripts/exceptions-summary.mts).
 *   - OR number twice: both collections (member number, program, OR date, amount, months, NOP, remittance status).
 *   - Application number twice: every sale with that number (member number, program, branch, MAS, dates, amount, and
 *     whether the member's account in that program exists).
 *   - Same name and birthdate: both members with their accounts. Names are shown for these (owner, October 8, 2026:
 *     names may be listed for same-person decisions).
 *
 *   npm run prod -- node scripts/compare-duplicates.mjs
 */
import fs from "node:fs";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const FILE = "legacy-data/exceptions.csv";
if (!fs.existsSync(FILE)) throw new Error(`${FILE} not found: run scripts/exceptions-summary.mts first.`);
const parse = (line) => { const out = []; let cell = "", quoted = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (quoted) { if (c === "\"") { if (line[i + 1] === "\"") { cell += "\""; i++; } else quoted = false; } else cell += c; } else if (c === "\"") quoted = true; else if (c === ",") { out.push(cell); cell = ""; } else cell += c; } out.push(cell); return out; };
const rows = fs.readFileSync(FILE, "utf8").replace(/^﻿/, "").split(/\r?\n/).slice(1).filter(Boolean).map(parse).filter((r) => r[0].startsWith("Possible duplicates"));
const peso = (v) => (v == null ? "—" : `₱${Number(v).toLocaleString("en-PH")}`);

try {
  console.log(`Supabase project: ${project} · ${rows.length} possible duplicate(s) from ${FILE}\n`);
  const collection = async (id) => (await sql`select c.collection_id, c.member_number, coalesce(p.program_code, p.program_name, c.program_id) as program, c.branch, coalesce(nullif(c.accountable_name, ''), c.mas) as mas,
      c.or_number, c.or_date::text as or_date, c.amount_collected::float8 as amount, c.month_from, c.month_to, c.nop_from, c.nop_to, c.remittance_status, c.status, c.enrollment_id
    from collections c left join programs p on p.program_id = c.program_id where c.collection_id = ${id}`)[0];
  const sale = async (where) => sql`select s.sale_id, s.member_number, coalesce(p.program_code, p.program_name, s.program_id) as program, s.branch, s.mas, s.application_no, s.or_number,
      s.or_date::text as or_date, s.date_remitted::text as date_remitted, s.amount_paid::float8 as amount, s.remittance_status,
      exists (select 1 from member_programs mp where mp.member_number = s.member_number and mp.program_id = s.program_id) as account
    from sales s left join programs p on p.program_id = s.program_id where ${where} order by s.sale_id`;
  const describeCollection = (c) => c ? `${c.collection_id} · member ${c.member_number} · ${c.program} · ${c.branch} · ${c.mas} · OR ${c.or_number} ${c.or_date} · ${peso(c.amount)} · ${c.month_from}${c.month_to !== c.month_from ? ` to ${c.month_to}` : ""} (NOP ${c.nop_from}${c.nop_to !== c.nop_from ? `-${c.nop_to}` : ""}) · ${c.status}/${c.remittance_status}` : "not found";
  const doneApps = new Set();
  let n = 0;
  for (const [, id, , , problem] of rows) {
    const orMatch = /OR number (.+?) is also on collection (\S+?)\./.exec(problem);
    const appMatch = /Application number (.+?) is also on sale (\S+?)\./.exec(problem);
    const memberMatch = /Same name and birthdate as member (\S+?)\./.exec(problem);
    if (orMatch) {
      const [a, b] = [await collection(id), await collection(orMatch[2])];
      const same = a && b && a.member_number === b.member_number && a.or_date === b.or_date && Math.round(a.amount * 100) === Math.round(b.amount * 100);
      const sameMember = a && b && a.member_number === b.member_number;
      console.log(`#${++n} OR ${orMatch[1]} twice — ${!a || !b ? "one of them is no longer in the database (already fixed?)" : same ? "LIKELY THE SAME PAYMENT ENTERED TWICE (same member, date and amount)" : sameMember ? "same member, different date or amount" : "DIFFERENT MEMBERS: one OR number is wrong"}`);
      console.log(`   A ${describeCollection(a)}\n   B ${describeCollection(b)}\n`);
    } else if (appMatch) {
      const key = appMatch[1].toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (doneApps.has(key)) continue;
      doneApps.add(key);
      const list = await sale(sql`s.application_key = ${key}`);
      const members = new Set(list.map((s) => s.member_number));
      console.log(`#${++n} Application ${appMatch[1]} on ${list.length} sales — ${members.size === 1 ? "SAME MEMBER every time" : `${members.size} different members: the number is wrong on all but (at most) one`}`);
      for (const s of list) console.log(`   ${s.sale_id} · member ${s.member_number} · ${s.program} · ${s.branch} · ${s.mas} · OR ${s.or_number || "—"} ${s.or_date || ""} · remitted ${s.date_remitted || "—"} · ${peso(s.amount)} · ${s.remittance_status}${s.account ? "" : " · (no account in this program)"}`);
      console.log("");
    } else if (memberMatch) {
      const members = await sql`select m.member_id, m.member_number, trim(concat_ws(' ', m.first_name, m.middle_name, m.surname, m.name_extension)) as name, m.birthdate::text as birthdate, m.status
        from members m where m.member_id = ${id} or m.member_number = ${memberMatch[1]} or m.member_number = ${id} order by m.member_id`;
      console.log(`#${++n} Same name and birthdate`);
      for (const m of members) {
        const accounts = await sql`select coalesce(p.program_code, p.program_name) as program, mp.branch, mp.mas, mp.doi::text as doi, mp.account_status,
            (select count(*)::int from collections c where c.enrollment_id = mp.enrollment_id and lower(coalesce(c.status, '')) = 'posted') as payments
          from member_programs mp left join programs p on p.program_id = mp.program_id where mp.member_id = ${m.member_id}`;
        console.log(`   ${m.member_number} (${m.member_id}) · ${m.name} · born ${m.birthdate || "—"} · ${m.status || "—"}`);
        for (const a of accounts) console.log(`      ${a.program} · ${a.branch} · ${a.mas} · DOI ${a.doi || "—"} · ${a.account_status || "—"} · ${a.payments} payment(s)`);
        if (!accounts.length) console.log("      no accounts");
      }
      console.log("");
    }
  }
} finally {
  await sql.end();
}
