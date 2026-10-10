import nextEnv from "@next/env";
import postgres from "postgres";
nextEnv.loadEnvConfig(process.cwd());
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, onnotice: () => {} });
console.log(await sql`select p.program_code, i.role, i.from_month, i.to_month, coalesce(i.branch_id, '') as branch from program_incentives i join programs p on p.program_id = i.program_id where i.from_month > 1 and i.from_month % 12 = 0 order by 1, 3`);
// Gaps: months not covered for a role/branch between the first and last tier.
const tiers = await sql`select p.program_code, i.role, coalesce(i.branch_id, '') as branch, i.from_month, i.to_month from program_incentives i join programs p on p.program_id = i.program_id order by 1, 2, 3, 4`;
const groups = new Map(); for (const t of tiers) { const k = `${t.program_code}|${t.role}|${t.branch}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(t); }
for (const [k, list] of groups) { const first = list[0].from_month; const gaps = []; let next = 1; for (const t of list) { if (t.from_month > next) gaps.push(`${next}-${t.from_month - 1}`); next = Math.max(next, t.to_month + 1); } if (gaps.length) console.log("gap", k, gaps.join(", ")); }
await sql.end();
