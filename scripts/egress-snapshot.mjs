/**
 * Read-only: which queries send the most rows to the app right now. Takes two pg_stat_statements readings some
 * seconds apart and lists the difference per query, so old code that is already fixed does not mix in (the System
 * Health "Biggest readers" totals run from the last statistics reset). Query text is the parameterised SQL only, never
 * a value. Run in busy hours:
 *
 *   npm run prod -- node scripts/egress-snapshot.mjs 600
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const seconds = Math.max(10, Number(process.argv[2]) || 300);
const top = Math.max(5, Number(process.argv[3]) || 25);
const sql = postgres(url, { max: 1, onnotice: () => {} });

const reading = async () => new Map((await sql`
  select queryid::text as id, calls::bigint as calls, rows::bigint as rows, left(regexp_replace(query, '\\s+', ' ', 'g'), 400) as query
  from extensions.pg_stat_statements where rows > 0`).map((row) => [row.id, row]));

try {
  const first = await reading();
  console.log(`First reading: ${first.size} queries. Waiting ${seconds} s...`);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  const second = await reading();
  const changes = [...second.values()].map((row) => {
    const before = first.get(row.id);
    return { ...row, calls: Number(row.calls) - Number(before?.calls ?? 0), rows: Number(row.rows) - Number(before?.rows ?? 0) };
  }).filter((row) => row.rows > 0).sort((a, b) => b.rows - a.rows);
  const total = changes.reduce((sum, row) => sum + row.rows, 0);
  const table = (query) => /\bfrom\s+"?([a-z_0-9]+)"?/i.exec(query)?.[1] ?? "?";
  const perTable = new Map();
  for (const row of changes) perTable.set(table(row.query), (perTable.get(table(row.query)) ?? 0) + row.rows);
  console.log(`\n${total.toLocaleString()} rows in ${seconds} s (${Math.round(total / seconds * 3600).toLocaleString()} per hour)\n\nPer table:`);
  for (const [name, rows] of [...perTable].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${name.padEnd(28)} ${rows.toLocaleString().padStart(12)}  ${(rows / total * 100).toFixed(1)}%`);
  console.log("\nTop queries:");
  for (const row of changes.slice(0, top)) {
    console.log(`\n${(row.rows / total * 100).toFixed(1)}% · ${row.rows.toLocaleString()} rows · ${row.calls} calls · ${Math.round(row.rows / Math.max(1, row.calls)).toLocaleString()} rows/call · id ${row.id}`);
    console.log(`  ${row.query}`);
  }
} finally { await sql.end(); }
