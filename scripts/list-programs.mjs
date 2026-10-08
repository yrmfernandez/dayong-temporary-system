/**
 * Programs at a glance, read-only (October 8, 2026): which are finalized (incentives set and a total amount payable)
 * and, for each program that is not, the finalized programs it may be the same as (same monthly rate, same number in
 * the code or name), with how many accounts each has. Used to move members from draft and legacy programs to the
 * finalized ones; the owner confirms every match before anything moves.
 *
 *   node scripts/list-programs.mjs                      staging
 *   npm run prod -- node scripts/list-programs.mjs      production
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const programs = await sql`select p.program_id as id, p.program_code as code, p.program_name as name, coalesce(p.base_pay, 0)::float8 as rate,
      coalesce(p.pay_balance_total, 0)::float8 as total, p.status, p.flexible,
      (select count(*)::int from program_incentives i where i.program_id = p.program_id) as incentives,
      (select count(*)::int from member_programs mp where mp.program_id = p.program_id) as accounts
    from programs p order by p.program_name`;
  const final = programs.filter((p) => p.incentives > 0 && p.total > 0);
  const numbers = (p) => new Set(`${p.code ?? ""} ${p.name}`.match(/\d+/g) ?? []);
  const label = (p) => `${p.id} ${p.name}${p.code && p.code !== p.name ? ` [${p.code}]` : ""} · ₱${p.rate}/mo · total ₱${p.total} · ${p.incentives} incentive tier(s) · ${p.accounts} account(s)${p.flexible ? " · flexible" : ""}${p.status !== "active" ? ` · ${p.status}` : ""}`;
  console.log(`Supabase project: ${project}\n\nFINALIZED (${final.length}):`);
  for (const p of final) console.log(`  ${label(p)}`);
  console.log(`\nNOT FINALIZED, with possible finalized matches (same rate, or a shared number in the code or name):`);
  for (const p of programs.filter((item) => !final.includes(item))) {
    const mine = numbers(p);
    const matches = final.filter((f) => f.rate === p.rate || [...numbers(f)].some((n) => mine.has(n)));
    console.log(`  ${label(p)}`);
    console.log(`      → ${matches.length ? matches.map((f) => `${f.id} ${f.name} (₱${f.rate}/mo${f.rate === p.rate ? ", same rate" : ""})`).join("  |  ") : "no likely match"}`);
  }
} finally {
  await sql.end();
}
