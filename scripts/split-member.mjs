/**
 * Splits one member who is really two people (owner, October 13, 2026), from config/member-splits.json. The old-sheet
 * import merged rows with the same surname and first name and no birthdate into one member and one account (e.g.
 * "Cabunag, Fe" and "Cabunag, Fe Dhivenil"), renumbering both people's receipts as one history. For each split:
 *   - the kept member's first name is corrected (keepFirstName);
 *   - a new member is made (newMember) with its own account of the same program, branch and MAS (DOI from the config);
 *   - the receipts in `move` go to the new account; `keep` stay; each gets the NOP given (the old sheet's), with months
 *     from its account's DOI;
 *   - old-sheet rows the import held back (addKeep / addNew) are added with the importer's IDs, so a re-import skips them;
 *   - both accounts' statuses are recalculated (lib/account-rules.ts).
 * Dry run (default): every change is made, printed, then rolled back. One transaction; the Audit Log keeps every row and
 * Record Corrections a summary. Prints IDs, OR numbers, NOPs, months, dates and amounts only.
 *
 *   npm run prod -- node scripts/split-member.mjs            dry run on production
 *   npm run prod -- node scripts/split-member.mjs --apply
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import nextEnv from "@next/env";
import postgres from "postgres";
import { accountState, monthIndex, monthName, todayInManila } from "../lib/account-rules.ts";
import { repriceEntries } from "../lib/entry-finance.mjs";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const config = process.argv.find(arg => arg.startsWith('--config='))?.slice('--config='.length) || 'config/member-splits.json';
const { splits = [] } = JSON.parse(fs.readFileSync(config, "utf8"));
const today = todayInManila();
const now = new Date().toISOString();
const text = (value) => String(value ?? "").trim();
const hashId = (prefix, ...parts) => `${prefix}-LEG-${createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 10).toUpperCase()}`;
const key = (value) => text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
const monthOf = (doi, nop) => monthName(monthIndex(doi.slice(0, 7)) + nop - 1);
class Rollback extends Error {}

async function statusOf(tx, enrollmentId) {
  const [account] = await tx`select mp.enrollment_id, mp.member_id, mp.doi::text as doi, mp.program_id, p.base_pay::float8 as rate, coalesce(p.pay_balance_total, 0)::float8 as total, p.flexible, p.max_monthly_payment::float8 as max
    from member_programs mp join programs p on p.program_id = mp.program_id where mp.enrollment_id = ${enrollmentId}`;
  const payments = await tx`select collection_id, or_date::text as or_date, or_number, amount_collected::float8 as amount, nop_from, nop_to, month_from, month_to from collections where enrollment_id = ${enrollmentId} and status = 'Posted' order by or_date, collection_id`;
  const state = accountState({ id: account.enrollment_id, memberId: account.member_id, memberNumber: "", programId: account.program_id, doi: account.doi, branch: "", mas: "", basePay: account.rate, payBalanceTotal: account.total, storedStatus: "", flexible: account.flexible, maxMonthlyPayment: account.max },
    payments.map((p) => ({ id: p.collection_id, enrollmentId, orDate: p.or_date, orNumber: text(p.or_number), monthFrom: p.month_from, monthTo: p.month_to, nopFrom: p.nop_from, nopTo: p.nop_to, amount: p.amount, dateRemitted: "", mas: "" })), today);
  await tx`update member_programs set account_status = ${state.status} where enrollment_id = ${enrollmentId}`;
  return state.status;
}

try {
  console.log(`Supabase project: ${project} · ${splits.length} split(s)${apply ? "" : " · dry run (changes made, then rolled back)"}\n`);
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_name', 'Member split', true)`;
    for (const split of splits) {
      const [member] = await tx`select * from members where member_number = ${split.member} for update`;
      if (!member) throw new Error(`${split.member}: member not found.`);
      if (split.expectedMemberId && member.member_id !== split.expectedMemberId) throw new Error('Member differs from reviewed snapshot.');
      const [account] = await tx`select * from member_programs where member_id = ${member.member_id} and program_id = ${split.program} for update`;
      if (!account) throw new Error(`${split.member}: no ${split.program} account.`);
      if (split.expectedDoi && text(account.doi.toISOString?.() ?? account.doi).slice(0, 10) !== split.expectedDoi) throw new Error('Enrollment date differs from reviewed snapshot.');
      const newMemberId = hashId("MEM", "SPLIT", member.member_id, split.newMember.firstName);
      const [already] = await tx`select member_number from members where member_id = ${newMemberId}`;
      if (already) { console.log(`${split.member}: already split (${already.member_number}).`); continue; }

      // Deterministic PH-######## from the new member ID (as the importer does), past any number in use.
      let n = parseInt(createHash("sha1").update(newMemberId).digest("hex").slice(0, 12), 16) % 100_000_000;
      while ((await tx`select 1 from members where member_number = ${`PH-${String(n).padStart(8, "0")}`}`).length) n = (n + 1) % 100_000_000;
      const newNumber = `PH-${String(n).padStart(8, "0")}`;
      const newEnrollment = hashId("ENR", newMemberId, split.program);

      await tx`update members set first_name = ${split.keepFirstName} where member_id = ${member.member_id}`;
      await tx`insert into members ${tx({ member_id: newMemberId, member_number: newNumber, surname: split.newMember.surname, first_name: split.newMember.firstName, name_extension: split.newMember.nameExtension ?? null, claimant_same_address: false, status: member.status, encoded_by_name: "Member split", encoded_at: now })}`;
      await tx`insert into member_programs ${tx({ enrollment_id: newEnrollment, member_id: newMemberId, member_number: newNumber, program_id: account.program_id, doi: split.newMember.doi, branch: account.branch, mas: account.mas,
        remittance_method: account.remittance_method, registration_fee: false, status: account.status, date_created: now, encoded_by_name: "Member split", encoded_at: now, branch_id: account.branch_id, mas_employee_id: account.mas_employee_id })}`;
      console.log(`${split.member} ${member.surname}, ${member.first_name} → first name ${split.keepFirstName}`);
      console.log(`New member ${newNumber} ${split.newMember.surname}, ${split.newMember.firstName} (${newMemberId}), account ${newEnrollment}, DOI ${split.newMember.doi}`);

      const receipts = await tx`select * from collections where enrollment_id = ${account.enrollment_id} for update`;
      const byOr = new Map(receipts.map((row) => [key(row.or_number), row]));
      const listed = [...split.keep, ...split.move].map((item) => key(item.or));
      if (byOr.size !== receipts.length || new Set(listed).size !== listed.length) throw new Error('Duplicate receipt key in account or split config.');
      const unlisted = receipts.filter((row) => !listed.includes(key(row.or_number)));
      if (unlisted.length) throw new Error(`${split.member}: receipts on the account not in the config: ${unlisted.map((row) => row.or_number).join(", ")}.`);
      const template = receipts[0];
      const place = async (item, enrollment, memberId, memberNumber, doi, label) => {
        const row = byOr.get(key(item.or));
        if (!row) throw new Error(`OR ${item.or}: not on the account.`);
        if (item.collectionId && row.collection_id !== item.collectionId) throw new Error(`OR ${item.or}: collection ID changed.`);
        if (item.amount != null && Number(row.amount_collected) !== item.amount) throw new Error(`OR ${item.or}: amount changed.`);
        const month = monthOf(doi, item.nop);
        await tx`update collections set enrollment_id = ${enrollment}, member_id = ${memberId}, member_number = ${memberNumber}, nop_from = ${item.nop}, nop_to = ${item.nop}, month_from = ${month}, month_to = ${month} where collection_id = ${row.collection_id}`;
        console.log(`   ${label} OR ${row.or_number} ${row.or_date.toISOString?.().slice(0, 10) ?? row.or_date} ₱${Number(row.amount_collected)} · NOP ${row.nop_from} → ${item.nop} (${month})`);
      };
      const add = async (item, enrollment, memberId, memberNumber, doi, label) => {
        const id = hashId("COL", item.ref);
        if ((await tx`select 1 from collections where collection_id = ${id}`).length) { console.log(`   ${label} OR ${item.or}: already in (${id})`); return; }
        const month = monthOf(doi, item.nop);
        const { row_seq, or_key, ...copy } = template;
        await tx`insert into collections ${tx({ ...copy, collection_id: id, collection_batch_id: copy.collection_batch_id, enrollment_id: enrollment, member_id: memberId, member_number: memberNumber,
          or_number: item.or, or_date: item.orDate, amount_collected: item.amount, month_from: month, month_to: month, nop_from: item.nop, nop_to: item.nop, created_at: now, remittance_amount: null, remittance_breakdown: null, linked_remittance_id: null, forfeited_incentive: null, backdate_reason: null })}`;
        console.log(`   ${label} OR ${item.or} ${item.orDate} ₱${item.amount} · added as NOP ${item.nop} (${month}) ${id}`);
      };
      console.log(` ${member.first_name} → ${split.keepFirstName}:`);
      for (const item of split.keep) await place(item, account.enrollment_id, member.member_id, member.member_number, text(account.doi.toISOString?.() ?? account.doi).slice(0, 10), "keep");
      for (const item of split.addKeep ?? []) await add(item, account.enrollment_id, member.member_id, member.member_number, text(account.doi.toISOString?.() ?? account.doi).slice(0, 10), "add ");
      console.log(` ${split.newMember.firstName}:`);
      for (const item of split.move) await place(item, newEnrollment, newMemberId, newNumber, split.newMember.doi, "move");
      for (const item of split.addNew ?? []) await add(item, newEnrollment, newMemberId, newNumber, split.newMember.doi, "add ");
      const finance = split.reprice ? await repriceEntries((query, parameters) => tx.unsafe(query, parameters), { collectionIds: receipts.map(row => row.collection_id) }) : null;
      if (finance) console.log(JSON.stringify({ financialSnapshots: finance.changes.length, incentiveChange: finance.incentiveChange, linkedRemittances: finance.slips.length }));
      const keptStatus = await statusOf(tx, account.enrollment_id), newStatus = await statusOf(tx, newEnrollment);
      console.log(` status: ${split.member} ${account.account_status || "—"} → ${keptStatus}; ${newNumber} → ${newStatus}\n`);
      await tx`insert into record_corrections ${tx({ correction_id: `COR-SPLIT-${member.member_id}-${Date.now().toString(36).toUpperCase()}`, module: "Member split", record_id: member.member_id, reason: split.reason,
        before_json: { member: member.member_id, memberNumber: member.member_number, firstName: member.first_name, account: account.enrollment_id, status: account.account_status },
        after_json: { firstName: split.keepFirstName, newMember: newMemberId, newMemberNumber: newNumber, newNameExtension: split.newMember.nameExtension ?? null, newAccount: newEnrollment, moved: split.move.map((item) => item.or), added: [...(split.addKeep ?? []), ...(split.addNew ?? [])].map((item) => item.or), status: keptStatus, newStatus, finance },
        corrected_at: now, encoded_by_name: "Member split", encoded_at: now })}`;
    }
    if (!apply) throw new Rollback();
  });
  console.log(apply ? "Applied." : "Dry run: nothing was saved. Add --apply to save.");
} catch (error) {
  if (error instanceof Rollback) console.log("Dry run: nothing was saved. Add --apply to save.");
  else { console.error("FAILED:", error instanceof Error ? error.message : error); process.exitCode = 1; }
} finally {
  await sql.end();
}
