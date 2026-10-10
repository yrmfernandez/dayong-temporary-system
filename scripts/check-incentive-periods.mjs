/**
 * Read-only (October 10, 2026). Incentive periods that leave months without a rate: a collection for such a month
 * is refused ("Configure exactly one MAS incentive tier for NOP …"). Lists, per program, role and branch:
 *   - gaps between month 2 (the first collection; NOP 1 is the New Sale) and the last period, and
 *   - periods starting on month 12, 24, 36 … — the Programs form turned "from Year N" into month N×12 until
 *     October 10, 2026 (Year 2 starts at month 13), which leaves the 11 months before it uncovered;
 *   - for each gap, how many accounts already paid in it, and how many open accounts have their NEXT payment in it:
 *     those are the ones whose next collection will be refused. A program no longer sold (no accounts reaching the gap)
 *     can leave its early months empty (owner, October 10, 2026: old programs only have rates for later months).
 *
 *   node scripts/check-incentive-periods.mjs                      staging
 *   npm run prod -- node scripts/check-incentive-periods.mjs      production
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const tiers = await sql`select p.program_id, p.program_code, p.status, i.role, coalesce(i.branch_id, '') as branch, i.from_month, i.to_month
    from program_incentives i join programs p on p.program_id = i.program_id order by p.program_code, i.role, branch, i.from_month`;
  const accounts = new Map((await sql`select program_id, count(*)::int as n from member_programs group by 1`).map((row) => [row.program_id, row.n]));
  // Each open account's next NOP: one after its last posted payment, or 2 after a New Sale alone (NOP 1).
  const nextNop = await sql`select mp.program_id, mp.enrollment_id, mp.branch_id, coalesce((select max(c.nop_to) from collections c where c.enrollment_id = mp.enrollment_id and c.status = 'Posted'), 1) + 1 as next
    from member_programs mp where coalesce(mp.account_status, '') not in ('Forfeited', 'Paid')`;
  const groups = new Map();
  for (const tier of tiers) { const key = `${tier.program_id}|${tier.role}|${tier.branch}`; (groups.get(key) ?? groups.set(key, []).get(key)).push(tier); }
  let problems = 0;
  const blockedAccounts = new Set();
  console.log(`Supabase project: ${project} · ${tiers.length} incentive tiers in ${groups.size} program/role/branch groups\n`);
  for (const list of groups.values()) {
    const { program_id: programId, program_code: code, status, role, branch } = list[0];
    const gaps = [];
    let next = 2;
    for (const tier of list) { if (tier.from_month > next) gaps.push([next, tier.from_month - 1]); next = Math.max(next, tier.to_month + 1); }
    const yearStarts = list.filter((tier) => tier.from_month > 1 && tier.from_month % 12 === 0).map((tier) => `${tier.from_month}-${tier.to_month}`);
    if (!gaps.length && !yearStarts.length) continue;
    problems++;
    const blocked = [];
    for (const [from, to] of gaps) {
      const [{ n }] = await sql`select count(distinct enrollment_id)::int as n from collections where program_id = ${programId} and status = 'Posted' and nop_to >= ${from} and nop_from <= ${to}`;
      // Branch rates apply to that branch's accounts; base rates to every account (a branch without its own rates).
      const waitingRows = nextNop.filter((row) => row.program_id === programId && row.next >= from && row.next <= to && (!branch || row.branch_id === branch));
      const waiting = waitingRows.length;
      for (const row of waitingRows) blockedAccounts.add(row.enrollment_id);
      blocked.push(`months ${from}-${to}${n ? ` (${n} account(s) already paid in them)` : ""}${waiting ? ` · ${waiting} OPEN ACCOUNT(S) WHOSE NEXT PAYMENT IS IN THIS GAP` : " · no open account's next payment is here"}`);
    }
    console.log(`${code}${status === "inactive" ? " (inactive)" : ""} · ${role}${branch ? ` · branch ${branch}` : ""} · ${accounts.get(programId) ?? 0} account(s)`);
    if (gaps.length) console.log(`   no rate for ${blocked.join(", ")}`);
    if (yearStarts.length) console.log(`   starts on a multiple of 12 (likely "from Year N" entered before the fix): ${yearStarts.join(", ")}`);
  }
  console.log(`\n${problems} group(s) with months without a rate; ${blockedAccounts.size} open account(s) whose next collection would be refused (each counted once, MAS and Collector together).`);
} finally {
  await sql.end();
}
