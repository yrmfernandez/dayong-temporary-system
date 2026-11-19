/**
 * Undo a New Sale saved over the wrong existing member (owner, November 19, 2026).
 *
 * A MAS picked an existing member and typed another person over them; the clerk's save wrote that person's details onto
 * the member (lib/member-records.ts updateMemberDetails), so the member's own account showed the other person's name and
 * the member's details were lost. The Audit Log keeps the old values. For each member number given, in one transaction:
 *
 *   1. finds that save: the latest name change on the member made with a New Sale account added in the same save
 *      (same encoder, within 10 seconds); refuses when the member was changed again after it (check those by hand);
 *   2. registers the other person as a new member with the details typed on that sale (encoded as of that save);
 *   3. moves the account(s) and New Sale(s) added in that save, with their receipts, transfers and beneficiaries, to them;
 *   4. puts the member's own details back as they were before the save (the database copies them onto the member's
 *      older New Sales again).
 *
 * Prints names, IDs and counts only. With --apply, writes a backup of the rows it changes to backups/ (git-ignored). Dry run rolls back and writes nothing.
 *
 *   npm run prod -- node scripts/undo-member-overwrite.mjs PH-19641808            dry run
 *   npm run prod -- node scripts/undo-member-overwrite.mjs PH-19641808 --apply
 */
import fs from "node:fs";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const numbers = process.argv.slice(2).filter((arg) => /^PH-\d{8}$/.test(arg));
if (!numbers.length) { console.error("Give the member number(s), e.g. PH-19641808. Add --apply to write."); process.exit(1); }
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const sql = postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} });
class Rollback extends Error {}
const WINDOW_MS = 10_000;
const name = (row) => [row.surname, [row.first_name, row.middle_name, row.name_extension].filter(Boolean).join(" ")].filter(Boolean).join(", ");
const near = (a, b) => a && b && Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= WINDOW_MS;

async function freeMemberNumber(tx) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const number = `PH-${String((Number(Date.now().toString().slice(-8)) + attempt * 7919) % 100_000_000).padStart(8, "0")}`;
    const [used] = await tx`select 1 from members where member_number = ${number}`;
    if (!used) return number;
  }
  throw new Error("Could not find a free PH number. Try again.");
}

async function undo(tx, number) {
  await tx`lock table members, member_programs, collections, sales, beneficiaries, member_transfers in share row exclusive mode`;
  const [member] = await tx`select * from members where member_number = ${number} for update`;
  if (!member) throw new Error(`${number}: member not found.`);
  const changes = await tx`select row_seq, logged_at, user_id, employee_id, user_name, changes_json from audit_log
    where table_name = 'members' and action = 'update' and record_id = ${member.member_id} order by row_seq`;
  const accounts = await tx`select * from member_programs where member_id = ${member.member_id} order by row_seq`;
  // The save: a name change with a New Sale account added by the same encoder at the same moment.
  const save = [...changes].reverse().find((entry) => (entry.changes_json?.first_name || entry.changes_json?.surname)
    && accounts.some((account) => account.encoded_by_name === entry.user_name && near(account.encoded_at, entry.logged_at)));
  if (!save) throw new Error(`${number}: no New Sale save that changed this member's name was found.`);
  const later = changes.filter((entry) => entry.row_seq > save.row_seq);
  if (later.length) throw new Error(`${number}: changed again after that save (${later.map((entry) => `${entry.logged_at.toISOString()} ${entry.user_name}: ${Object.keys(entry.changes_json ?? {}).join(", ")}`).join("; ")}). Check by hand.`);
  const moved = accounts.filter((account) => account.encoded_by_name === save.user_name && near(account.encoded_at, save.logged_at));
  if (moved.length === accounts.length) throw new Error(`${number}: every account of this member came with that save; nothing of the member's own would be left. Check by hand.`);
  const programIds = moved.map((account) => account.program_id), enrollmentIds = moved.map((account) => account.enrollment_id);
  const sales = (await tx`select * from sales where member_number = ${number} and program_id in ${tx(programIds)}`)
    .filter((sale) => sale.encoded_by_name === save.user_name && near(sale.encoded_at, save.logged_at));
  const receipts = await tx`select collection_id from collections where enrollment_id in ${tx(enrollmentIds)}`;
  const transfers = await tx`select transfer_id from member_transfers where enrollment_id in ${tx(enrollmentIds)}`;
  const beneficiaries = sales.length ? await tx`select beneficiary_id from beneficiaries where sale_id in ${tx(sales.map((sale) => sale.sale_id))}` : [];
  const restore = Object.fromEntries(Object.entries(save.changes_json).map(([column, change]) => [column, change?.from ?? null]));

  const backup = `backups/undo-member-overwrite-${number}-${Date.now()}.json`;
  if (apply) {
    fs.mkdirSync("backups", { recursive: true });
    fs.writeFileSync(backup, JSON.stringify({ member, save, accounts: moved, sales, receipts, transfers, beneficiaries }, null, 2));
  }

  await tx`select set_config('app.user_name', 'Data fix (undo member overwrite)', true)`;
  // 2. The other person, with the details typed on that sale (the member's details now), registered as of that save.
  const columns = (await tx`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'members'
    and is_generated = 'NEVER' and is_identity = 'NO' order by ordinal_position`).map((row) => row.column_name)
    .filter((column) => !["member_id", "member_number", "died_on", "encoded_by_user_id", "encoded_by_employee_id", "encoded_by_name", "encoded_at"].includes(column));
  const newId = `MEM-${Date.now()}-UNDO`, newNumber = await freeMemberNumber(tx);
  await tx`insert into members ${tx({ ...Object.fromEntries(columns.map((column) => [column, member[column]])), member_id: newId, member_number: newNumber,
    encoded_by_user_id: save.user_id, encoded_by_employee_id: save.employee_id, encoded_by_name: save.user_name, encoded_at: save.logged_at })}`;
  // 3. What that save added goes with them.
  await tx`update member_programs set member_id = ${newId}, member_number = ${newNumber} where enrollment_id in ${tx(enrollmentIds)}`;
  await tx`update collections set member_id = ${newId}, member_number = ${newNumber} where enrollment_id in ${tx(enrollmentIds)}`;
  if (sales.length) await tx`update sales set member_number = ${newNumber} where sale_id in ${tx(sales.map((sale) => sale.sale_id))}`;
  if (transfers.length) await tx`update member_transfers set member_id = ${newId}, member_number = ${newNumber} where transfer_id in ${tx(transfers.map((row) => row.transfer_id))}`;
  if (beneficiaries.length) await tx`update beneficiaries set member_id = ${newId} where beneficiary_id in ${tx(beneficiaries.map((row) => row.beneficiary_id))}`;
  // 4. The member's own details back, typed as the table's columns (jsonb_populate_record).
  const restored = Object.keys(restore).filter((column) => columns.includes(column));
  await tx.unsafe(`update members m set ${restored.map((column) => `"${column}" = r."${column}"`).join(", ")} from jsonb_populate_record(null::members, $1::text::jsonb) r where m.member_id = $2`, [JSON.stringify(restore), member.member_id]);

  const [after] = await tx`select * from members where member_id = ${member.member_id}`;
  const [other] = await tx`select * from members where member_id = ${newId}`;
  const ownSales = await tx`select sale_id, surname, first_name from sales where member_number = ${number}`;
  const movedSales = await tx`select sale_id, surname, first_name from sales where member_number = ${newNumber}`;
  if (restored.some((column) => String(after[column] ?? "") !== String(restore[column] ?? "") && !(after[column] instanceof Date))) throw new Error(`${number}: a restored value did not take.`);
  console.log(`\n${number}: the save of ${save.logged_at.toISOString()} by ${save.user_name}`);
  console.log(`  ${number} back to ${name(after)} (${restored.length} details restored: ${restored.join(", ")})`);
  console.log(`  new member ${newNumber} ${name(other)} (${newId}) takes ${moved.map((account) => `${account.program_id} ${account.enrollment_id}`).join(", ")}, ${sales.length} New Sale(s), ${receipts.length} receipt(s), ${transfers.length} transfer(s), ${beneficiaries.length} beneficiar(ies)`);
  console.log(`  ${number} keeps ${accounts.length - moved.length} account(s); its New Sales now read ${ownSales.map((sale) => `${sale.sale_id} ${sale.surname}, ${sale.first_name}`).join("; ") || "(none)"}`);
  console.log(`  ${newNumber} New Sales read ${movedSales.map((sale) => `${sale.sale_id} ${sale.surname}, ${sale.first_name}`).join("; ") || "(none)"}`);
  if (apply) console.log(`  backup ${backup}`);
}

let failed = 0;
for (const number of numbers) {
  try {
    await sql.begin(async (tx) => { await undo(tx, number); if (!apply) throw new Rollback(); });
    console.log("  APPLIED");
  } catch (error) {
    if (error instanceof Rollback) console.log("  dry run: rolled back (add --apply to write)");
    else { failed++; console.error(`  NOT DONE: ${error instanceof Error ? error.message : error}`); }
  }
}
await sql.end();
process.exit(failed ? 1 : 0);
