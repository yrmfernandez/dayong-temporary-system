/**
 * Sets what an Entry Clerk's existing clearings cover (owner, October 11, 2026): clearings made before the Clearing page
 * asked "New Sales, Collections or both" count as both, so a clerk who only clears New Sales (or only Collections)
 * has lines waiting forever for the other kind. This sets every clearing the clerk made (not Removed) to the given kind,
 * so each line follows only its own entries and leaves the page once those are approved.
 *
 *   node scripts/set-clearing-covers.mjs --clerk=JENNY --covers=NewSales                             dry run on staging
 *   npm run prod -- node scripts/set-clearing-covers.mjs --clerk=MD-2026-0056 --covers=Collections   dry run on production
 *   ... --apply
 *
 * --clerk is the clerk's Employee ID or part of their name (it must match one clerk who made clearings).
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const arg = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3).trim() ?? "";
// "NewSales" / "new-sales" also accepted: a value with a space can be split when run through npm run prod.
const coversKey = arg("covers").toLowerCase().replace(/[^a-z]/g, "");
const clerkKey = arg("clerk"), covers = { newsales: "New Sales", collections: "Collections", both: "Both" }[coversKey] ?? arg("covers");
if (!clerkKey || !["New Sales", "Collections", "Both"].includes(covers)) throw new Error('Give --clerk="name or Employee ID" and --covers="New Sales" | Collections | Both.');
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const clerks = await sql`select distinct encoded_by_employee_id as id, encoded_by_name as name from clearings
    where encoded_by_employee_id = ${clerkKey} or encoded_by_name ilike ${`%${clerkKey}%`} order by 2`;
  console.log(`Supabase project: ${project}${apply ? "" : " · dry run"}\n`);
  if (clerks.length !== 1) {
    console.log(clerks.length ? `"${clerkKey}" matches ${clerks.length} clerks who made clearings: ${clerks.map((c) => `${c.id} ${c.name}`).join("; ")}. Use the Employee ID.` : `No clearings made by "${clerkKey}". Check the name or Employee ID.`);
    process.exitCode = 1;
  } else {
    const [clerk] = clerks;
    const rows = await sql`select clearing_id, cleared_date::text as day, employee_name, branch, status, covers from clearings
      where encoded_by_employee_id = ${clerk.id} and status <> 'Removed' order by cleared_date, cleared_at`;
    const change = rows.filter((row) => row.covers !== covers);
    console.log(`Clearings made by ${clerk.name} (${clerk.id}): ${rows.length}; ${change.length} ${apply ? "set" : "would be set"} to "${covers}" (${rows.length - change.length} already are).`);
    for (const row of change) console.log(`   ${row.clearing_id} · ${row.day} · ${row.employee_name} · ${row.branch} · ${row.status} · ${row.covers} → ${covers}`);
    if (apply && change.length) {
      await sql.begin(async (tx) => {
        await tx`select set_config('app.user_name', 'Clearing covers', true)`;
        await tx`update clearings set covers = ${covers} where clearing_id in ${tx(change.map((row) => row.clearing_id))}`;
      });
      console.log("\nApplied.");
    } else if (!apply) console.log("\nDry run: nothing was written. Add --apply to change them.");
  }
} finally {
  await sql.end();
}
