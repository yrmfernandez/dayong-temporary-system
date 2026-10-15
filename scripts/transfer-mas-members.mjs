/**
 * Owner-confirmed transfer of named members' accounts from one MAS to another (owner, October 15, 2026: the members
 * of CONDES, MILDRED that the old sheet filed under "Racho, K."). Same records as Members → Transfer
 * (lib/member-transfer.ts): the account's MAS changes and member_transfers keeps the history with the reason; past
 * collections and New Sales stay with the MAS who handled them. Dry run by default (changes made, then rolled back).
 *
 *   npm run prod -- node scripts/transfer-mas-members.mjs --names-file=config/condes-members-20261015.json --from=LEG-2026-0022 --to=SDS-2026-0007
 *   ... add --apply --expected=N once the dry run lists N accounts to move.
 *
 * Each name ("First Middle Surname") must match exactly one member (scripts/name-match.mjs); only that member's
 * accounts under the --from MAS move. Names with no match, several matches, or no
 * account under --from are listed and skipped. Prints IDs, member numbers, programs and branches only.
 */
import nextEnv from "@next/env";
import postgres from "postgres";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { candidateMembers, matchesName } from "./name-match.mjs";

nextEnv.loadEnvConfig(process.cwd());
const arg = (key) => process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const apply = process.argv.includes("--apply");
const fromId = arg("from")?.trim(), toId = arg("to")?.trim(), namesFile = arg("names-file"), expected = arg("expected");
if (!fromId || !toId || !namesFile) { console.error("Usage: --names-file=<json> --from=<employee ID> --to=<employee ID> [--apply --expected=N]"); process.exit(1); }
if (apply && !expected) { console.error("--apply needs --expected=N (the number of accounts the dry run listed)."); process.exit(1); }
const names = JSON.parse(readFileSync(namesFile, "utf8")).names.map((name) => String(name).replace(/^[\s.•*-]+/, "").replace(/\s+/g, " ").trim()).filter(Boolean);
const words = (value) => String(value ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
const BY = "Owner-confirmed MAS transfer";

class DryRun extends Error {}
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  console.log(`Database ${/postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?"}${apply ? " (APPLY)" : " (dry run)"}`);
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_name', ${BY}, true)`;
    const [from] = await tx`select employee_id, full_name from employees where employee_id = ${fromId}`;
    const [to] = await tx`select employee_id, full_name, employment_status from employees where employee_id = ${toId}`;
    if (!from || !to) throw new Error(`Employee ${!from ? fromId : toId} not found.`);
    if ((to.employment_status ?? "").toLowerCase() !== "active") throw new Error(`${to.full_name} is not active.`);
    console.log(`From ${from.full_name} (${from.employee_id}) to ${to.full_name} (${to.employee_id})\n`);
    const fromWords = words(from.full_name);
    // The account's MAS is this employee by link, or by name where the link is empty ("Racho, K." = RACHO, KRISTINE).
    const isFrom = (account) => account.mas_employee_id === fromId || (!account.mas_employee_id && words(account.mas).includes(fromWords[0]) && words(account.mas).some((word) => word[0] === fromWords[1]?.[0]));

    const moving = [], skipped = [];
    for (const name of names) {
      const found = (await candidateMembers(tx, name)).filter((row) => matchesName(row, name));
      if (found.length !== 1) { skipped.push(`${name}: ${found.length ? `${found.length} matching members` : "not in the database"}`); continue; }
      const accounts = (await tx`select mp.enrollment_id, mp.member_id, mp.member_number, mp.program_id, p.program_code, mp.branch, mp.mas, mp.mas_employee_id from member_programs mp join programs p on p.program_id = mp.program_id where mp.member_id = ${found[0].member_id} for update of mp`).filter(isFrom);
      if (!accounts.length) { skipped.push(`${name}: ${found[0].member_number} has no account under ${from.full_name}`); continue; }
      for (const account of accounts) moving.push({ ...account, name });
    }

    for (const account of moving) console.log(`move ${account.member_number} · ${account.program_code} · ${account.branch} · ${account.enrollment_id}  (${account.name})`);
    for (const line of skipped) console.log(`skip ${line}`);
    console.log(`\n${moving.length} account(s) to move, ${skipped.length} name(s) skipped.`);
    if (expected && Number(expected) !== moving.length) throw new Error(`Expected ${expected} account(s), found ${moving.length}; nothing written.`);
    if (!moving.length) return;

    // The new MAS must be assigned to each account's branch, so Clearing and Collections list her there.
    const branches = await tx`select b.branch_id, b.branch_name_code, exists (select 1 from employee_branches eb where eb.employee_id = ${toId} and eb.branch_id = b.branch_id) as assigned
      from branches b where upper(b.branch_name_code) in ${tx([...new Set(moving.map((account) => String(account.branch).toUpperCase()))])}`;
    const stamp = new Date().toISOString();
    for (const branch of branches.filter((item) => !item.assigned)) {
      await tx`insert into employee_branches ${tx({ assignment_id: `EBA-${toId}-${branch.branch_id}`, employee_id: toId, branch_id: branch.branch_id, encoded_by_name: BY, encoded_at: stamp })} on conflict (employee_id, branch_id) do nothing`;
      console.log(`${to.full_name} assigned to ${branch.branch_name_code}.`);
    }

    if (apply) {
      mkdirSync("backups", { recursive: true });
      writeFileSync(`backups/mas-transfer-${toId}-${Date.now()}.json`, JSON.stringify({ from: fromId, to: toId, accounts: moving.map(({ name, ...account }) => account) }, null, 2));
    }
    const reason = `Owner confirmed these members belong to ${to.full_name}; the old sheet filed them under ${from.full_name} (October 15, 2026).`;
    await tx`update member_programs set mas = ${to.full_name}, mas_employee_id = ${toId} where enrollment_id in ${tx(moving.map((account) => account.enrollment_id))}`;
    await tx`insert into member_transfers ${tx(moving.map((account, index) => ({
      transfer_id: `MTR-${Date.now().toString(36).toUpperCase()}-${index + 1}`, enrollment_id: account.enrollment_id, member_id: account.member_id, member_number: account.member_number,
      program_id: account.program_id, branch: account.branch, from_mas: account.mas, to_mas: to.full_name, to_employee_id: toId, reason, encoded_by_name: BY, encoded_at: stamp,
    })))}`;
    await tx`insert into record_corrections ${tx({ correction_id: `COR-MAS-TRANSFER-${toId}-${Date.now().toString(36).toUpperCase()}`, module: "MAS transfer", record_id: toId, reason,
      before_json: { mas: from.full_name, employeeId: fromId, accounts: moving.map((account) => account.enrollment_id) }, after_json: { mas: to.full_name, employeeId: toId, count: moving.length },
      corrected_at: stamp, encoded_by_name: BY, encoded_at: stamp })}`;
    const [check] = await tx`select count(*)::int as count from member_programs where enrollment_id in ${tx(moving.map((account) => account.enrollment_id))} and mas_employee_id = ${toId}`;
    if (check.count !== moving.length) throw new Error("Verification failed; rolled back.");
    console.log(`\n${moving.length} account(s) now under ${to.full_name}.`);
    if (!apply) throw new DryRun();
  });
  if (apply) console.log("Applied.");
} catch (error) {
  if (error instanceof DryRun) console.log("Dry run: rolled back. Add --apply --expected=N to keep it.");
  else throw error;
} finally {
  await sql.end();
}
