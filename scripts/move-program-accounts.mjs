/**
 * Moves accounts from draft or legacy programs to the finalized program the owner says they belong to (October 8,
 * 2026). The matches come from config/program-moves.json, confirmed one by one by the owner after
 * scripts/list-programs.mjs:  { "moves": [ { "from": "DP-0009", "to": "DP-0061", "note": "D-350 (5Y) is D-350 5 years" } ] }
 * "from" and "to" are a program ID or its exact code or name. "fromMatching": "290" instead moves every program whose
 * code or name contains that text (except the "to" program). "doiFrom" / "doiBefore" (YYYY-MM-DD) move only the
 * accounts enrolled on or after / before that date, so one program can be split by DOI over two moves (run
 * scripts/fix-impossible-doi.mjs first, so a typo DOI such as 1943 does not decide the program); an account
 * without a DOI matches neither and stays. "nextPaymentFrom" / "nextPaymentTo" (NOP numbers) move only the accounts
 * whose next payment falls in that range (e.g. members still in their first year). "remove": true then deletes the "from" program and its incentive tiers once
 * nothing is left in it; one that still has accounts, New Sales, collections or transfers is set inactive instead.
 * "mergeIntoExisting": true merges an account whose member already has one in the "to" program into that account
 * (owner, October 9, 2026): its collections join it, the combined payments are renumbered NOP 1, 2, 3… in month order
 * (the October 4 repair rule), the earlier DOI is kept, and the emptied account is deleted. Two accounts that paid the
 * same month are really two accounts and are left.
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
  // Members given an account in a "to" program by an earlier move of this run (a dry run writes nothing, so it tracks them).
  // Members given an account in a "to" program by an earlier move of this run → that account's enrollment ID.
  const joined = new Map();
  const monthIndex = (month) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
  // Accounts each "from" program gives up in this run, so a later move of the same program (a DOI split) skips them.
  const claimed = new Map();
  // A program by ID, or by its exact code or name (ignoring case and outer spaces).
  const find = async (key) => (await sql`select program_id from programs where program_id = ${text(key)} or lower(trim(program_code)) = ${text(key).toLowerCase()} or lower(trim(program_name)) = ${text(key).toLowerCase()} order by program_id`).map((row) => row.program_id);
  const pairs = [];
  // Every move must name exactly one program on each side; otherwise nothing is moved, and the matches are described
  // (code, name, rate, accounts, DOI range) so the owner can put the right program ID in config/program-moves.json.
  const problems = [];
  const describe = async (ids) => (await sql`select p.program_id, p.program_code, p.program_name, p.base_pay::float8 as rate, p.status,
      (select count(*)::int from member_programs m where m.program_id = p.program_id) as accounts,
      (select min(doi)::text from member_programs m where m.program_id = p.program_id) as first_doi,
      (select max(doi)::text from member_programs m where m.program_id = p.program_id) as last_doi
    from programs p where p.program_id in ${sql(ids)} order by p.program_id`)
    .map((p) => `    ${p.program_id}: code ${p.program_code || "(none)"} · name ${p.program_name} · ₱${p.rate}/mo · ${p.status} · ${p.accounts} account(s)${p.accounts ? ` · DOI ${p.first_doi} to ${p.last_doi}` : ""}`).join("\n");
  for (const move of moves) {
    const targets = await find(move.to);
    if (targets.length !== 1) { problems.push(`${move.to}: ${targets.length ? `${targets.length} programs match; put the right program ID in "to"\n${await describe(targets)}` : "program not found"}`); continue; }
    const sources = move.fromMatching
      ? (await sql`select program_id from programs where (program_code ilike ${`%${text(move.fromMatching)}%`} or program_name ilike ${`%${text(move.fromMatching)}%`}) and program_id <> ${targets[0]} order by program_id`).map((row) => row.program_id)
      : await find(move.from);
    if (!sources.length) { problems.push(`${move.fromMatching ? `Programs containing "${move.fromMatching}"` : move.from}: none found besides ${move.to}`); continue; }
    if (!move.fromMatching && sources.length > 1) { problems.push(`${move.from}: ${sources.length} programs match; put the right program ID in "from"\n${await describe(sources)}`); continue; }
    for (const source of sources) pairs.push({ ...move, from: source, to: targets[0] });
  }
  if (problems.length) {
    console.log(`Nothing was moved: ${problems.length} program name(s) in config/program-moves.json need fixing first.\n\n${problems.join("\n\n")}`);
    process.exitCode = 1;
    pairs.length = 0;
  }
  for (const move of pairs) {
    const outcome = await sql.begin(async (tx) => {
      const [from] = await tx`select program_id, program_name, program_code from programs where program_id = ${move.from}`;
      const [to] = await tx`select program_id, program_name, base_pay::float8 as rate, coalesce(pay_balance_total, 0)::float8 as total, flexible, max_monthly_payment::float8 as max from programs where program_id = ${move.to}`;
      if (!from || !to) return { line: `${move.from} → ${move.to}: program not found` };
      const all = await tx`select mp.enrollment_id, mp.member_id, mp.member_number, mp.doi::text as doi,
          (select o.enrollment_id from member_programs o where o.member_id = mp.member_id and o.program_id = ${to.program_id} order by o.enrollment_id limit 1) as target_enrollment,
          coalesce((select max(c.nop_to) from collections c where c.enrollment_id = mp.enrollment_id and c.status = 'Posted'), 1) + 1 as next_nop
        from member_programs mp where mp.program_id = ${from.program_id}`;
      const taken = claimed.get(from.program_id) ?? claimed.set(from.program_id, new Set()).get(from.program_id);
      const inDoi = (doi) => (!move.doiFrom || (doi && doi >= move.doiFrom)) && (!move.doiBefore || (doi && doi < move.doiBefore));
      // "nextPaymentFrom" / "nextPaymentTo": only accounts whose next payment (NOP) falls in that range, e.g. members
      // still in their first year (owner, October 10, 2026: D-300 members in months 2–12 go to D-300 (Bracketing)).
      const inNext = (nop) => (!move.nextPaymentFrom || nop >= move.nextPaymentFrom) && (!move.nextPaymentTo || nop <= move.nextPaymentTo);
      const accounts = all.filter((account) => !taken.has(account.enrollment_id) && inDoi(account.doi) && inNext(Number(account.next_nop)));
      const payments = new Map();
      for (const row of await tx`select collection_id, enrollment_id, or_date::text as or_date, or_number, month_from, month_to, nop_from, nop_to, amount_collected::float8 as amount
          from collections where program_id = ${from.program_id} and lower(coalesce(status, '')) = 'posted'`) {
        const list = payments.get(row.enrollment_id) ?? payments.set(row.enrollment_id, []).get(row.enrollment_id);
        list.push({ id: row.collection_id, enrollmentId: row.enrollment_id, orDate: row.or_date, orNumber: text(row.or_number), monthFrom: text(row.month_from), monthTo: text(row.month_to), nopFrom: Number(row.nop_from), nopTo: Number(row.nop_to), amount: Number(row.amount), dateRemitted: "", mas: "" });
      }
      const counts = { moved: 0, merged: 0, alreadyInTarget: 0, paymentsDoNotFit: 0 };
      const movable = [];
      const merges = [];
      for (const account of accounts) {
        const targetId = account.target_enrollment || joined.get(`${to.program_id}|${account.member_id}`);
        if (targetId && move.mergeIntoExisting) {
          // Merge into the member's account in the "to" program (it may still sit in another program in a dry run).
          const [target] = await tx`select enrollment_id, doi::text as doi from member_programs where enrollment_id = ${targetId}`;
          const theirs = (await tx`select collection_id, or_date::text as or_date, or_number, month_from, month_to, nop_from, nop_to, amount_collected::float8 as amount
              from collections where enrollment_id = ${targetId} and lower(coalesce(status, '')) = 'posted'`)
            .map((row) => ({ id: row.collection_id, orDate: row.or_date, orNumber: text(row.or_number), monthFrom: text(row.month_from), monthTo: text(row.month_to), nopFrom: Number(row.nop_from), nopTo: Number(row.nop_to), amount: Number(row.amount), dateRemitted: "", mas: "" }));
          const combined = [...theirs, ...(payments.get(account.enrollment_id) ?? [])].map((payment) => ({ ...payment, enrollmentId: targetId }))
            .sort((a, b) => a.monthFrom.localeCompare(b.monthFrom) || a.orDate.localeCompare(b.orDate));
          let nop = 1;
          const renumbered = combined.map((payment) => { const count = monthIndex(payment.monthTo) - monthIndex(payment.monthFrom) + 1; const next = { ...payment, nopFrom: nop, nopTo: nop + count - 1 }; nop += count; return next; });
          const doi = [target.doi, account.doi].filter(Boolean).sort()[0];
          try {
            const state = accountState({ id: targetId, memberId: account.member_id, memberNumber: "", programId: to.program_id, doi, branch: "", mas: "", basePay: to.rate, payBalanceTotal: to.total, storedStatus: "", flexible: to.flexible, maxMonthlyPayment: to.max }, renumbered, today);
            merges.push({ ...account, targetId, doi, status: state.status, renumbered: renumbered.filter((payment, index) => payment.nopFrom !== combined[index].nopFrom || payment.nopTo !== combined[index].nopTo) });
            taken.add(account.enrollment_id);
          } catch (error) {
            counts.paymentsDoNotFit++;
            left.push(`${account.enrollment_id}\t${from.program_name} → ${to.program_name}\tcannot merge into ${targetId}: ${error.message.replace(/^(Payment|Account) \S+ /, "")}`);
          }
          continue;
        }
        if (targetId) { counts.alreadyInTarget++; left.push(`${account.enrollment_id}\t${from.program_name} → ${to.program_name}\tmember already has an account in ${to.program_name}`); continue; }
        try {
          const state = accountState({ id: account.enrollment_id, memberId: account.member_id, memberNumber: "", programId: to.program_id, doi: account.doi, branch: "", mas: "", basePay: to.rate, payBalanceTotal: to.total, storedStatus: "", flexible: to.flexible, maxMonthlyPayment: to.max }, payments.get(account.enrollment_id) ?? [], today);
          movable.push({ ...account, status: state.status });
          joined.set(`${to.program_id}|${account.member_id}`, account.enrollment_id);
          taken.add(account.enrollment_id);
        } catch (error) {
          counts.paymentsDoNotFit++;
          left.push(`${account.enrollment_id}\t${from.program_name} → ${to.program_name}\t${error.message.replace(/^(Payment|Account) \S+ /, "")}`);
        }
      }
      counts.moved = movable.length;
      counts.merged = merges.length;
      if (apply && merges.length) {
        await tx`select set_config('app.user_name', 'Program move', true)`;
        for (const merge of merges) {
          await tx`update collections set enrollment_id = ${merge.targetId}, program_id = ${to.program_id} where enrollment_id = ${merge.enrollment_id}`;
          for (const payment of merge.renumbered) await tx`update collections set nop_from = ${payment.nopFrom}, nop_to = ${payment.nopTo} where collection_id = ${payment.id}`;
          await tx`update member_transfers set enrollment_id = ${merge.targetId}, program_id = ${to.program_id} where enrollment_id = ${merge.enrollment_id}`;
          await tx`update sales set program_id = ${to.program_id} where program_id = ${from.program_id} and member_number = ${merge.member_number}`;
          await tx`update member_programs set doi = ${merge.doi}, account_status = ${merge.status} where enrollment_id = ${merge.targetId}`;
          await tx`delete from member_programs where enrollment_id = ${merge.enrollment_id}`;
          await tx`insert into record_corrections ${tx({ correction_id: `COR-PMG-${merge.enrollment_id}-${Date.now().toString(36).toUpperCase()}`, module: "Program move", record_id: merge.enrollment_id,
            reason: `${move.note ?? `${from.program_name} is ${to.program_name}`}: merged into the member's ${to.program_name} account ${merge.targetId}`,
            before_json: { enrollment: merge.enrollment_id, program: from.program_id, doi: merge.doi },
            after_json: { enrollment: merge.targetId, program: to.program_id, doi: merge.doi, status: merge.status, renumbered: merge.renumbered.map((payment) => ({ id: payment.id, nopFrom: payment.nopFrom, nopTo: payment.nopTo })) },
            corrected_at: new Date().toISOString(), encoded_by_name: "Program move", encoded_at: new Date().toISOString() })}`;
        }
      }
      if (apply && movable.length) {
        await tx`select set_config('app.user_name', 'Program move', true)`;
        const ids = movable.map((account) => account.enrollment_id);
        await tx`update collections set program_id = ${to.program_id} where enrollment_id in ${tx(ids)}`;
        await tx`update member_transfers set program_id = ${to.program_id} where enrollment_id in ${tx(ids)}`;
        await tx`update sales set program_id = ${to.program_id} where program_id = ${from.program_id} and member_number in ${tx(movable.map((account) => account.member_number))}`;
        for (const account of movable) await tx`update member_programs set program_id = ${to.program_id}, account_status = ${account.status} where enrollment_id = ${account.enrollment_id}`;
        await tx`insert into record_corrections ${tx({ correction_id: `COR-PMV-${from.program_id}-${to.program_id}-${Date.now().toString(36).toUpperCase()}`, module: "Program move", record_id: from.program_id,
          reason: move.note ?? `${from.program_name} is ${to.program_name} (owner, October 8, 2026)`, before_json: { program: from.program_id, enrollments: ids },
          after_json: { program: to.program_id, moved: ids.length, alreadyInTarget: counts.alreadyInTarget, paymentsDoNotFit: counts.paymentsDoNotFit }, corrected_at: new Date().toISOString(),
          encoded_by_name: "Program move", encoded_at: new Date().toISOString() })}`;
      }
      // "remove": an emptied program is deleted with its incentive tiers; one still in use is set inactive.
      let removal = "";
      if (move.remove) {
        // After the move, anything still pointing at the program keeps it; a dry run wrote nothing, so it counts the
        // accounts no move of this run takes.
        const [{ other }] = await tx`select (select count(*)::int from member_programs where program_id = ${from.program_id}) + (select count(*)::int from sales where program_id = ${from.program_id})
            + (select count(*)::int from collections where program_id = ${from.program_id}) + (select count(*)::int from member_transfers where program_id = ${from.program_id}) as other`;
        const stays = apply ? other : all.length - taken.size;
        if (apply) {
          if (stays) await tx`update programs set status = 'inactive' where program_id = ${from.program_id}`;
          else { await tx`delete from program_incentives where program_id = ${from.program_id}`; await tx`delete from programs where program_id = ${from.program_id}`; }
        }
        removal = ` · program ${stays ? `${apply ? "set" : "would be set"} inactive (still in use)` : apply ? "deleted" : "would be deleted"}`;
      }
      const doiNote = (move.doiFrom || move.doiBefore ? ` with DOI${move.doiFrom ? ` from ${move.doiFrom}` : ""}${move.doiBefore ? ` before ${move.doiBefore}` : ""}` : "")
        + (move.nextPaymentFrom || move.nextPaymentTo ? ` with the next payment in NOP ${move.nextPaymentFrom ?? 1}-${move.nextPaymentTo ?? "..."}` : "");
      return { line: `${from.program_name} (${from.program_id}) → ${to.program_name} (${to.program_id}): ${accounts.length} account(s)${doiNote} · ${apply ? "moved" : "would move"} ${counts.moved}${move.mergeIntoExisting ? ` · ${apply ? "merged" : "would merge"} ${counts.merged} into the member's existing account` : ""} · left: ${counts.alreadyInTarget} already in ${to.program_name}, ${counts.paymentsDoNotFit} payments do not fit ₱${to.rate}/month${removal}` };
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
