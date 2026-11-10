/**
 * Old member and beneficiary records in capitals (owner, November 10, 2026, upgrade list 2 item 8): typing has been in
 * capitals since November 5 (lib/uppercase-typing.ts), but older records kept mixed case. Names, birthplace and addresses
 * of members (with the claimant's name and address) and beneficiaries' names become capitals with the database's upper()
 * (ñ becomes Ñ). Coded choices (gender, civil status, status, relationship) and contact numbers are left as they are.
 * Employee names are left too: saved MAS batches compare the MAS name exactly (lib/sale-submissions.ts).
 * Names are compared ignoring case everywhere else, so nothing depends on the change. Prints counts only, no names.
 *
 *   npm run prod -- node scripts/convert-to-capitals.mjs          dry run: what would change
 *   npm run prod -- node scripts/convert-to-capitals.mjs --apply  write, in one transaction
 *
 * The Audit Log keeps every changed row's old values (as "Data fix (capitals)"), and one Record Corrections row keeps the
 * counts. Safe to rerun: only values not already in capitals change. Run outside busy hours: each changed row is one live
 * update, so open pages reload once it ends.
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? /db\.([a-z0-9]+)\.supabase/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });

const COLUMNS = {
  members: ["surname", "first_name", "middle_name", "name_extension", "birthplace", "address", "claimant_name", "claimant_address"],
  beneficiaries: ["surname", "first_name", "middle_name"],
};
const differs = (column) => sql`${sql(column)} is distinct from upper(${sql(column)})`;
const anyDiffers = (columns) => sql`(${columns.map(differs).reduce((all, next) => sql`${all} or ${next}`)})`;

async function preview(db) {
  const counts = {};
  for (const [table, columns] of Object.entries(COLUMNS)) {
    const [row] = await db`select count(*)::int as total, count(*) filter (where ${anyDiffers(columns)})::int as rows,
      ${sql.unsafe(columns.map((column) => `count(*) filter (where "${column}" is distinct from upper("${column}"))::int as "${column}"`).join(", "))}
      from ${sql(table)}`;
    counts[table] = row;
  }
  // upper() follows the database's collation: check ñ turns into Ñ, not into N or something else.
  const [enye] = await db`select count(*)::int as values, count(*) filter (where upper(value) like '%Ñ%')::int as kept
    from (select unnest(array[surname, first_name, middle_name, address]) as value from members) v where value like '%ñ%'`;
  return { counts, enye };
}

try {
  console.log(`Supabase project: ${project}`);
  const { counts, enye } = await preview(sql);
  for (const [table, row] of Object.entries(counts)) {
    const { total, rows, ...byColumn } = row;
    console.log(`${table}: ${rows} of ${total} rows would change (${Object.entries(byColumn).filter(([, n]) => n).map(([column, n]) => `${column} ${n}`).join(", ") || "none"})`);
  }
  console.log(`values with ñ: ${enye.values}, turning into Ñ: ${enye.kept}`);
  if (enye.kept !== enye.values) throw new Error("upper() does not keep ñ as Ñ on this database. Nothing was written.");
  if (!apply) console.log("Dry run. Nothing was written. Add --apply to convert them.");
  else {
    const changed = await sql.begin(async (tx) => {
      await tx`select set_config('app.user_name', ${"Data fix (capitals)"}, true)`;
      const result = {};
      for (const [table, columns] of Object.entries(COLUMNS)) {
        const set = sql.unsafe(columns.map((column) => `"${column}" = upper("${column}")`).join(", "));
        result[table] = (await tx`update ${sql(table)} set ${set} where ${anyDiffers(columns)}`).count;
      }
      const after = await preview(tx);
      if (Object.values(after.counts).some((row) => row.rows)) throw new Error("Some values are still not in capitals. Nothing was written.");
      const stamp = new Date().toISOString();
      await tx`insert into record_corrections (correction_id, module, record_id, reason, before_json, after_json, corrected_at, encoded_by_name, encoded_at)
        values (${`COR-CAPITALS-${stamp.slice(0, 10).replace(/-/g, "")}-${stamp.slice(11, 19).replace(/:/g, "")}`}, 'Member records', 'members, beneficiaries',
          'Old records in capitals (owner, November 10, 2026); old values are in the Audit Log as Data fix (capitals)',
          ${tx.json(Object.fromEntries(Object.entries(counts).map(([table, row]) => [table, row])))}, ${tx.json(result)}, ${stamp}, 'Data fix (capitals)', ${stamp})`;
      return result;
    });
    console.log(`Converted ${changed.members} member(s) and ${changed.beneficiaries} beneficiary record(s).`);
  }
} finally {
  await sql.end();
}
