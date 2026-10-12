/**
 * Deletes test entries (owner, October 12, 2026): a member's New Sales and collections in one program encoded on one
 * day, with the remittance slips and Clearing lines that exist only because of them. Uses the administrator delete
 * (lib/admin-delete.ts), so everything that belongs to an entry goes with it (a New Sale's account, beneficiaries and
 * the member when nothing else is theirs; a collection's Fidelity and photo links), and the Audit Log keeps every row.
 * A remittance slip or Clearing line that also covers other entries is NOT deleted: it is listed and the run stops.
 * Dry run by default.
 *
 *   npm run prod -- npx tsx --tsconfig tsconfig.json scripts/delete-test-entries.mts --member=PH-07535010 --program=290
 *   ... --date=2026-10-12 (default today, Manila) --apply
 *
 * --program is part of the program's code or name (e.g. 290 matches D-290 and DSP-290; it must match only programs
 * the member has entries in that day).
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3).trim() ?? "";
const memberNumber = arg("member"), programKey = arg("program");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "unknown";
if (!memberNumber || !programKey) throw new Error("Give --member=PH-… and --program=… (part of the program code or name).");
const { runAsSystem } = await import("../lib/encoder-context");
const { getDb } = await import("../lib/db");
const { sql } = await import("drizzle-orm");
const { planDeletion, deleteRecord } = await import("../lib/admin-delete");
const { manilaNow } = await import("../lib/remittance-deadline");
const day = arg("date") || manilaNow().date;
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];
const q = async <T,>(statement: ReturnType<typeof sql>) => rowsOf<T>(await getDb().execute(statement));
const like = `%${programKey}%`;
const peso = (value: number) => `₱${Number(value).toLocaleString("en-PH")}`;

await runAsSystem(async () => {
  console.log(`Supabase project: ${project} · ${memberNumber} · programs matching "${programKey}" · encoded ${day}${apply ? "" : " · dry run"}\n`);
  type Entry = { kind: "sale" | "collection"; id: string; program: string; amount: number; remittance: string | null; branch: string; person: string; employee: string | null; encoder: string };
  const sales = await q<Entry>(sql`select 'sale' as kind, s.sale_id as id, coalesce(p.program_code, p.program_name) as program, s.amount_paid::float8 as amount, s.linked_remittance_id as remittance,
      s.branch, s.mas as person, coalesce(s.accountable_employee_id, s.mas_employee_id) as employee, coalesce(s.encoded_by_name, '') as encoder
    from sales s join programs p on p.program_id = s.program_id
    where s.member_number = ${memberNumber} and (p.program_code ilike ${like} or p.program_name ilike ${like}) and (coalesce(s.encoded_at, s.date_created) at time zone 'Asia/Manila')::date = ${day}::date`);
  const collections = await q<Entry>(sql`select 'collection' as kind, c.collection_id as id, coalesce(p.program_code, p.program_name) as program, c.amount_collected::float8 as amount, c.linked_remittance_id as remittance,
      c.branch, coalesce(nullif(c.accountable_name, ''), c.mas) as person, c.accountable_employee_id as employee, coalesce(c.encoded_by_name, '') as encoder
    from collections c join programs p on p.program_id = c.program_id
    where c.member_number = ${memberNumber} and (p.program_code ilike ${like} or p.program_name ilike ${like}) and (coalesce(c.encoded_at, c.created_at) at time zone 'Asia/Manila')::date = ${day}::date`);
  const entries = [...sales, ...collections];
  if (!entries.length) { console.log("No New Sale or collection of this member in that program was encoded that day. Nothing to delete."); return; }
  for (const e of entries) console.log(`${e.kind === "sale" ? "New Sale " : "Collection"} ${e.id} · ${e.program} · ${peso(e.amount)} · ${e.branch} · ${e.person} · encoded by ${e.encoder || "?"}${e.remittance ? ` · on remittance ${e.remittance}` : ""}`);
  const ids = new Set(entries.map((e) => e.id));

  // Remittance slips: only deleted when every entry on them is one of these.
  const slips = [...new Set(entries.map((e) => e.remittance).filter(Boolean))] as string[];
  const blocked: string[] = [];
  for (const slip of slips) {
    const linked = await q<{ id: string }>(sql`select collection_id as id from remittance_collections where remittance_id = ${slip}
      union select sale_id from sales where linked_remittance_id = ${slip} union select collection_id from collections where linked_remittance_id = ${slip}`);
    const others = linked.map((row) => row.id).filter((id) => !ids.has(id));
    if (others.length) blocked.push(`Remittance ${slip} also covers ${others.length} other entr${others.length === 1 ? "y" : "ies"} (${others.slice(0, 5).join(", ")}${others.length > 5 ? ", …" : ""})`);
  }
  // Clearing lines of the accountable person, branch and day: only deleted when no other entry of theirs that day is left.
  const people = [...new Set(entries.map((e) => `${e.employee ?? ""}|${e.branch}`))].filter((key) => !key.startsWith("|"));
  const clearings: Array<{ id: string; employee: string; branch: string; status: string; others: number }> = [];
  for (const key of people) {
    const [employee, branch] = key.split("|");
    const lines = await q<{ id: string; status: string }>(sql`select clearing_id as id, status from clearings where employee_id = ${employee} and lower(trim(branch)) = lower(trim(${branch})) and cleared_date = ${day}::date and status <> 'Removed'`);
    const others = await q<{ n: number }>(sql`select ((select count(*) from sales where coalesce(accountable_employee_id, mas_employee_id) = ${employee} and lower(trim(branch)) = lower(trim(${branch})) and date_remitted = ${day}::date and sale_id not in (${sql.join([...ids].map((id) => sql`${id}`), sql`, `)}))
        + (select count(*) from collections where accountable_employee_id = ${employee} and lower(trim(branch)) = lower(trim(${branch})) and date_remitted = ${day}::date and collection_id not in (${sql.join([...ids].map((id) => sql`${id}`), sql`, `)})))::int as n`);
    for (const line of lines) clearings.push({ id: line.id, employee, branch, status: line.status, others: Number(others[0]?.n ?? 0) });
  }
  for (const c of clearings) {
    if (c.others) blocked.push(`Clearing ${c.id} (${c.branch}, ${c.status}) also covers ${c.others} other entr${c.others === 1 ? "y" : "ies"} of that person that day`);
    else console.log(`Clearing ${c.id} · ${c.branch} · ${c.status} · only these entries`);
  }
  for (const slip of slips.filter((s) => !blocked.some((b) => b.startsWith(`Remittance ${s}`)))) console.log(`Remittance ${slip} · only these entries`);
  for (const e of entries) { const plan = await planDeletion(e.kind, e.id); if (plan.effects.length) console.log(`   deleting ${e.id} also removes: ${plan.effects.join(", ")}`); }
  if (blocked.length) { console.log(`\nSTOPPED, nothing deleted:\n  ${blocked.join("\n  ")}`); return; }
  if (!apply) { console.log("\nDry run: nothing was deleted. Add --apply to delete all of the above."); return; }

  const reason = `Test entry of ${memberNumber} (${entries[0].program}), deleted by the owner (October 12, 2026)`;
  for (const slip of slips) { await deleteRecord("remittance", slip, reason); console.log(`Deleted remittance ${slip}.`); }
  for (const e of entries.filter((item) => item.kind === "collection")) { await deleteRecord("collection", e.id, reason); console.log(`Deleted collection ${e.id}.`); }
  for (const e of entries.filter((item) => item.kind === "sale")) { await deleteRecord("sale", e.id, reason); console.log(`Deleted New Sale ${e.id} (with its account, and the member if nothing else is theirs).`); }
  for (const c of clearings) { await getDb().execute(sql`delete from clearings where clearing_id = ${c.id}`); console.log(`Deleted clearing ${c.id}.`); }
  console.log("\nDone. The Audit Log keeps every deleted row.");
});
process.exit(0);
