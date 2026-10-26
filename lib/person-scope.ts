import { sql, type SQL } from "drizzle-orm";

/**
 * Picking one person's records by Employee ID, not by name (upgrade #8, October 24, 2026). Records keep the MAS name
 * for display and a link to the employee (mas_employee_id, accountable_employee_id) that the database fills from it.
 * Two employees with the same name (production: an old LEG-… and a new ID for one person) would otherwise share each
 * other's records. A record whose name matches no employee has no link (old data such as "Capacite, C."); it still
 * counts for the person by its name, so nothing drops out.
 */
export type Person = { employeeId: string; name: string };

const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
/** The same in SQL: spaces trimmed and collapsed, capitals ignored. */
const nameKey = (column: SQL) => sql`lower(regexp_replace(trim(${column}), '[[:space:]]+', ' ', 'g'))`;

/** Sales, member programs, remittances, deposits: the MAS on the record. */
export function masScope(person: Person) {
  return sql`(mas_employee_id = ${person.employeeId} or (mas_employee_id is null and ${nameKey(sql`mas`)} = ${key(person.name)}))`;
}

/**
 * Collections: the person accountable for the cash, as the reports show it: the collector or DTO clerk when recorded
 * (accountable_employee_id, else the accountable name), otherwise the MAS. Old collections can name a collector with
 * no link (production: 822 written "Degamo, N."); those belong to that collector by name, never to the MAS.
 */
export function accountableScope(person: Person) {
  const name = key(person.name);
  return sql`(case
    when accountable_employee_id is not null then accountable_employee_id = ${person.employeeId}
    when trim(coalesce(accountable_name, '')) <> '' and ${nameKey(sql`accountable_name`)} <> ${nameKey(sql`coalesce(mas, '')`)} then ${nameKey(sql`accountable_name`)} = ${name}
    else (mas_employee_id = ${person.employeeId} or (mas_employee_id is null and ${nameKey(sql`coalesce(nullif(trim(accountable_name), ''), mas)`)} = ${name})) end)`;
}
