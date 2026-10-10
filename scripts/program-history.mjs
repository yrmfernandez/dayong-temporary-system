/**
 * Read-only (October 10, 2026). Who changed which program settings, and when, from the Audit Log: every program edit
 * with each changed field (before → after), and every save of a program's incentive tiers with the rates before and the
 * rates saved (a save rewrites all of them; the old ones are in the Audit Log). Used to find edits that
 * were later undone (e.g. two people with the same program open in Programs → Edit; the later save writes back the
 * older values).
 *
 *   node scripts/program-history.mjs                                  staging, last 14 days
 *   npm run prod -- node scripts/program-history.mjs --days=30
 *   npm run prod -- node scripts/program-history.mjs --program=DSP-290
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const days = Number(process.argv.find((arg) => arg.startsWith("--days="))?.slice(7)) || 14;
const only = process.argv.find((arg) => arg.startsWith("--program="))?.slice(10).trim().toLowerCase() ?? "";
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const manila = (value) => new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "medium" });
const show = (value) => (value === null || value === undefined || value === "" ? "—" : String(value));

try {
  const codes = new Map((await sql`select program_id, program_code from programs`).map((row) => [row.program_id, row.program_code]));
  const edits = await sql`select logged_at, user_name, record_id, changes_json from audit_log
    where table_name = 'programs' and action = 'update' and logged_at > now() - make_interval(days => ${days}) order by logged_at`;
  // A tier rewrite deletes the old tiers (logged with their values) and inserts the new ones (not logged): one group per
  // save. So what a save wrote is what the next rewrite deleted, and the last save's tiers are the current ones.
  const tierLabel = (tier) => `${tier.role} ${tier.from_month}-${tier.to_month} ${tier.incentive_type === "fixed" ? `₱${Number(tier.incentive_amount)}` : `${Number(tier.incentive_amount)}%`} mark-up ₱${Number(tier.mark_up ?? 0)}${tier.branch_id ? ` (${tier.branch_id})` : ""}${tier.non_commissionable ? " non-commissionable" : ""}`;
  // Sorted fully, so the same rates saved in another order read as unchanged.
  const describe = (list) => list.map(tierLabel).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).join(", ");
  const deleted = await sql`select date_trunc('second', logged_at) as at, user_name, changes_json from audit_log
    where table_name = 'program_incentives' and action = 'delete' and logged_at > now() - make_interval(days => ${days}) order by logged_at`;
  const saves = new Map();
  for (const row of deleted) {
    const key = `${row.at.toISOString()}|${row.user_name}|${row.changes_json.program_id}`;
    (saves.get(key) ?? saves.set(key, { at: row.at, who: row.user_name, programId: row.changes_json.program_id, before: [] }).get(key)).before.push(row.changes_json);
  }
  const current = new Map();
  for (const row of await sql`select * from program_incentives`) (current.get(row.program_id) ?? current.set(row.program_id, []).get(row.program_id)).push(row);
  const rewrites = [...saves.values()].sort((a, b) => a.at - b.at);
  const events = [
    ...edits.map((row) => ({ at: row.logged_at, who: row.user_name, program: codes.get(row.record_id) ?? row.record_id,
      what: Object.entries(row.changes_json ?? {}).map(([field, change]) => `${field}: ${show(change?.from)} → ${show(change?.to)}`).join("; ") })),
    ...rewrites.map((save, index) => {
      const next = rewrites.slice(index + 1).find((later) => later.programId === save.programId);
      const wrote = next ? describe(next.before) : describe(current.get(save.programId) ?? []);
      const before = describe(save.before);
      return { at: save.at, who: save.who, program: codes.get(save.programId) ?? save.programId,
        what: before === wrote ? `incentive tiers saved unchanged: ${wrote}` : `incentive tiers\n      before: ${before}\n      saved:  ${wrote}${next ? "" : " (current)"}` };
    }),
  ].filter((event) => !only || String(event.program).toLowerCase() === only).sort((a, b) => new Date(a.at) - new Date(b.at));
  console.log(`Supabase project: ${project} · program changes in the last ${days} day(s)${only ? ` for ${only.toUpperCase()}` : ""}: ${events.length}\n`);
  for (const event of events) console.log(`${manila(event.at)} · ${event.who || "(no name: database or script)"} · ${event.program}\n    ${event.what}`);
  // The tell-tale sign: a field set by one person and set back by a later save.
  const reverted = [];
  const last = new Map();
  for (const row of edits) for (const [field, change] of Object.entries(row.changes_json ?? {})) {
    const key = `${row.record_id}|${field}`, previous = last.get(key);
    if (only && String(codes.get(row.record_id) ?? row.record_id).toLowerCase() !== only) continue;
    if (previous && JSON.stringify(previous.change.from) === JSON.stringify(change.to) && previous.who !== row.user_name) reverted.push(`${codes.get(row.record_id) ?? row.record_id} ${field}: set to ${show(previous.change.to)} by ${previous.who} (${manila(previous.at)}), back to ${show(change.to)} by ${row.user_name} (${manila(row.logged_at)})`);
    last.set(key, { change, who: row.user_name, at: row.logged_at });
  }
  console.log(`\nSettings changed and then set back by someone else: ${reverted.length}`);
  for (const line of reverted) console.log(`  ${line}`);
} finally {
  await sql.end();
}
