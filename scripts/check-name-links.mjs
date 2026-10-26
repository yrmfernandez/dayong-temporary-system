/**
 * Read-only, for upgrade #8 (reports join by ID instead of names): how safe it is to pick records by their branch and
 * MAS links (branch_id, mas_employee_id) instead of the name text they also carry.
 *   - Employees who share a full name (a name filter mixes their records), with how many records each one is linked to.
 *   - Per linked table: records whose branch or MAS name has no link (the name matches no branch or employee, or several
 *     employees), and the most common such names.
 * Branch and employee names, IDs and counts only; no member data. Nothing is written.
 *
 *   node scripts/check-name-links.mjs                     staging
 *   npm run prod -- node scripts/check-name-links.mjs     production
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const TABLES = [
  ["sales", "branch", "branch_id", "mas", "mas_employee_id"], ["collections", "branch", "branch_id", "mas", "mas_employee_id"],
  ["remittances", "branch", "branch_id", "mas", "mas_employee_id"], ["member_programs", "branch", "branch_id", "mas", "mas_employee_id"],
  ["bank_deposits", "branch", "branch_id", "mas", "mas_employee_id"], ["expenses", "branch", "branch_id", "", ""],
  ["cash_transactions", "branch", "branch_id", "", ""], ["attendance", "branch", "branch_id", "", ""],
];

try {
  console.log(`Database ${ref} (read only)`);
  const shared = await sql`select lower(trim(full_name)) as name, array_agg(employee_id || ' (' || coalesce(nullif(employment_status, ''), '?') || ')' order by employee_id) as ids
    from employees where trim(coalesce(full_name, '')) <> '' group by 1 having count(*) > 1 order by 1`;
  console.log(`\nEmployees sharing a full name: ${shared.length}`);
  for (const row of shared) {
    const ids = row.ids.map((label) => label.split(" ")[0]);
    const [linked] = await sql`select
        (select count(*)::int from sales where mas_employee_id in ${sql(ids)}) as sales,
        (select count(*)::int from collections where mas_employee_id in ${sql(ids)} or accountable_employee_id in ${sql(ids)}) as collections,
        (select count(*)::int from member_programs where mas_employee_id in ${sql(ids)}) as accounts`;
    console.log(`  ${row.name}: ${row.ids.join(", ")} · linked sales ${linked.sales}, collections ${linked.collections}, accounts ${linked.accounts}`);
  }
  for (const [table, branchCol, branchLink, masCol, masLink] of TABLES) {
    const [{ total }] = await sql`select count(*)::int as total from ${sql(table)}`;
    const [branch] = await sql`select count(*)::int as n from ${sql(table)} where trim(coalesce(${sql(branchCol)}, '')) <> '' and ${sql(branchLink)} is null`;
    let line = `\n${table}: ${total} records · branch name without link ${branch.n}`;
    let mas = { n: 0 };
    if (masCol) [mas] = await sql`select count(*)::int as n from ${sql(table)} where trim(coalesce(${sql(masCol)}, '')) <> '' and ${sql(masLink)} is null`;
    if (masCol) line += ` · MAS name without link ${mas.n}`;
    if (table === "collections") {
      // Who collected the cash on old collections: a collector name with no link counts by name (lib/person-scope.ts).
      const [collector] = await sql`select count(*)::int as n from collections where accountable_employee_id is null and trim(coalesce(accountable_name, '')) <> ''
        and lower(trim(accountable_name)) <> lower(trim(coalesce(mas, '')))`;
      line += ` · collector name without link ${collector.n}`;
    }
    console.log(line);
    if (table === "collections") {
      // For the owner to confirm (relink in config/employee-merges.json): an old collector name is usually an older
      // spelling of the MAS on the same collections. Per name: the linked MAS found most on its collections, and how often.
      const suggestions = await sql`with named as (
          select trim(accountable_name) as name, mas_employee_id from collections where accountable_employee_id is null
            and trim(coalesce(accountable_name, '')) <> '' and lower(trim(accountable_name)) <> lower(trim(coalesce(mas, '')))),
        totals as (select name, count(*)::int as total from named group by name),
        ranked as (select n.name, n.mas_employee_id, count(*)::int as n, row_number() over (partition by n.name order by count(*) desc) as rank
          from named n where n.mas_employee_id is not null group by n.name, n.mas_employee_id)
        select t.name, t.total, r.mas_employee_id, e.full_name, coalesce(r.n, 0) as n from totals t
          left join ranked r on r.name = t.name and r.rank = 1 left join employees e on e.employee_id = r.mas_employee_id
          order by t.total desc limit 40`;
      if (suggestions.length) console.log("    Old collector names and the MAS most often on the same collections (confirm before relinking):");
      for (const row of suggestions) console.log(`      "${row.name}" (${row.total}): ${row.mas_employee_id ? `${row.full_name} [${row.mas_employee_id}] on ${row.n} (${Math.round((row.n / row.total) * 100)}%)` : "no linked MAS"}`);
    }
    if (branch.n) for (const row of await sql`select trim(${sql(branchCol)}) as name, count(*)::int as n from ${sql(table)} where trim(coalesce(${sql(branchCol)}, '')) <> '' and ${sql(branchLink)} is null group by 1 order by 2 desc limit 8`) console.log(`    branch "${row.name}": ${row.n}`);
    if (mas.n) for (const row of await sql`select trim(${sql(masCol)}) as name, count(*)::int as n from ${sql(table)} where trim(coalesce(${sql(masCol)}, '')) <> '' and ${sql(masLink)} is null group by 1 order by 2 desc limit 8`) console.log(`    MAS "${row.name}": ${row.n}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
