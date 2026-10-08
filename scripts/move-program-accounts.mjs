/**
 * Moves accounts from draft or legacy programs to the finalized program the owner says they belong to (October 8,
 * 2026). The matches come from config/program-moves.json, confirmed one by one by the owner after
 * scripts/list-programs.mjs:  { "moves": [ { "from": "DP-0009", "to": "DP-0061", "note": "D-350 (5Y) is D-350 5 years" } ] }
 *
 *   node scripts/move-program-accounts.mjs                      dry run on staging
 *   node scripts/move-program-accounts.mjs --apply              move on staging
 *   npm run prod -- node scripts/move-program-accounts.mjs [--apply]
 *
 * Each account of the "from" program moves with its New Sale, collections and transfer records, when:
 *   - the member has no account in the "to" program yet (one account per program), and
 *   - its payments fit the "to" program's monthly rate (lib/account-rules.ts); its payment status is recalculated.
 * Accounts that do not are left where they are and counted (listed by enrollment ID in legacy-data/program-moves-left.txt).
 * Amounts already paid, incentives and remittances keep what applied at the time. One transaction per move; every
 * change is in the Audit Log and a summary in Record Corrections. Prints program names and counts only.
 */
import fs from "node:fs";
import nextEnv from "@next/env";
import postgres from "postgres";
import { accountState, todayInManila } from "../lib/account-rules.ts";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const moves = JSON.parse(fs.readFileSync("config/program-moves.json", "utf8")).moves ?? [];
const today = todayInManila();
const text = (value) => String(value ?? "").trim();

try {
  console.log(`Supabase project: ${project} · ${moves.length} move(s)${apply ? "" : " · dry run"}\n`);
  const left = [];
  for (const move of moves) {
    const outcome = await sql.begin(async (tx) => {
      const [from] = await tx`select program_id, program_name from programs where program_id = ${move.from}`;
      const [to] = await tx`select program_id, program_name, base_pay::float8 as rate, coalesce(pay_balance_total, 0)::float8 as total, flexible, max_monthly_payment::float8 as max from programs where program_id = ${move.to}`;
      if (!from || !to) return { line: `${move.from} → ${move.to}: program not found` };
      const accounts = await tx`select mp.enrollment_id, mp.member_id, mp.member_number, mp.doi::text as doi,
          exists (select 1 from member_programs o where o.member_id = mp.member_id and o.program_id = ${to.program_id}) as has_target
        from member_programs mp where mp.program_id = ${from.program_id}`;
      const payments = new Map();
      for (const row of await tx`select collection_id, enrollment_id, or_date::text as or_date, or_number, month_from, month_to, nop_from, nop_to, amount_collected::float8 as amount
          from collections where program_id = ${from.program_id} and lower(coalesce(status, '')) = 'posted'`) {
        const list = payments.get(row.enrollment_id) ?? payments.set(row.enrollment_id, []).get(row.enrollment_id);
        list.push({ id: row.collection_id, enrollmentId: row.enrollment_id, orDate: row.or_date, orNumber: text(row.or_number), monthFrom: text(row.month_from), monthTo: text(row.month_to), nopFrom: Number(row.nop_from), nopTo: Number(row.nop_to), amount: Number(row.amount), dateRemitted: "", mas: "" });
      }
      const counts = { moved: 0, alreadyInTarget: 0, paymentsDoNotFit: 0 };
      const movable = [];
      for (const account of accounts) {
        if (account.has_target) { counts.alreadyInTarget++; left.push(`${account.enrollment_id}\t${from.program_name} → ${to.program_name}\tmember already has an account in ${to.program_name}`); continue; }
        try {
          const state = accountState({ id: account.enrollment_id, memberId: account.member_id, memberNumber: "", programId: to.program_id, doi: account.doi, branch: "", mas: "", basePay: to.rate, payBalanceTotal: to.total, storedStatus: "", flexible: to.flexible, maxMonthlyPayment: to.max }, payments.get(account.enrollment_id) ?? [], today);
          movable.push({ ...account, status: state.status });
        } catch (error) {
          counts.paymentsDoNotFit++;
          left.push(`${account.enrollment_id}\t${from.program_name} → ${to.program_name}\t${error.message.replace(/^(Payment|Account) \S+ /, "")}`);
        }
      }
      counts.moved = movable.length;
      if (apply && movable.length) {
        await tx`select set_config('app.user_name', 'Program move', true)`;
        const ids = movable.map((account) => account.enrollment_id);
        await tx`update collections set program_id = ${to.program_id} where enrollment_id in ${tx(ids)}`;
        await tx`update member_transfers set program_id = ${to.program_id} where enrollment_id in ${tx(ids)}`;
        await tx`update sales set program_id = ${to.program_id} where program_id = ${from.program_id} and member_number in ${tx(movable.map((account) => account.member_number))}`;
        for (const account of movable) await tx`update member_programs set program_id = ${to.program_id}, account_status = ${account.status} where enrollment_id = ${account.enrollment_id}`;
        await tx`insert into record_corrections ${tx({ correction_id: `COR-PMV-${from.program_id}-${to.program_id}-${Date.now().toString(36).toUpperCase()}`, module: "Program move", record_id: from.program_id,
          reason: `${move.note ?? `${from.program_name} is ${to.program_name}`} (owner, October 8, 2026)`, before_json: { program: from.program_id, enrollments: ids },
          after_json: { program: to.program_id, moved: ids.length, alreadyInTarget: counts.alreadyInTarget, paymentsDoNotFit: counts.paymentsDoNotFit }, corrected_at: new Date().toISOString(),
          encoded_by_name: "Program move", encoded_at: new Date().toISOString() })}`;
      }
      return { line: `${from.program_name} (${from.program_id}) → ${to.program_name} (${to.program_id}): ${accounts.length} account(s) · ${apply ? "moved" : "would move"} ${counts.moved} · left: ${counts.alreadyInTarget} already in ${to.program_name}, ${counts.paymentsDoNotFit} payments do not fit ₱${to.rate}/month` };
    });
    console.log(outcome.line);
  }
  if (left.length) {
    fs.mkdirSync("legacy-data", { recursive: true });
    fs.writeFileSync("legacy-data/program-moves-left.txt", left.join("\r\n"));
    console.log(`\nAccounts left where they are, by enrollment ID: legacy-data/program-moves-left.txt`);
  }
  if (!apply) console.log("\nDry run: nothing was written. Add --apply to move.");
} finally {
  await sql.end();
}
