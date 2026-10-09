import { desc, is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

import journal from "@/db/migrations/meta/_journal.json";
import { getDb, schema } from "@/lib/db";
import { GOOGLE_SHEET_ID, sheets, sheetsStats } from "@/lib/google-sheets";
import { readUserRows, USERS_RANGE } from "@/lib/users-sheet";
import { readServerVariable } from "@/lib/server-environment";

const text = (value: unknown) => String(value ?? "").trim();
const PRODUCTION_REF = "qnugejonwpfvsenxvhxz", STAGING_REF = "nziflfmwqnaqcisssapy";
const SIZE_LIMIT = 500 * 1024 * 1024; // Supabase Free plan: 500 MB of database space per project.
const splitRoles = (value: unknown) => text(value).split(",").map((role) => role.trim()).filter(Boolean);
/** Rows of a raw query: postgres.js returns them as the result itself, PGlite (tests) under .rows. */
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];

export type IntegrityIssue = { severity: "critical" | "warning" | "info"; title: string; detail: string; items: string[]; href: string }; // href "" when the fix is a command, not a page.

/** Every table and column db/schema.ts expects, which the deployed code will query. */
function expectedColumns() {
  return Object.values(schema as Record<string, unknown>).filter((value): value is PgTable => is(value, PgTable)).map((table) => getTableConfig(table))
    .map((config) => ({ table: config.name, columns: config.columns.map((column) => column.name) }));
}

/** System health for the IT workspace: database, schema, access integrity, configuration, and recent changes. */
export async function getSystemHealth() {
  const db = getDb();
  // Round trip of one tiny query, so the figure reflects the database now.
  const probe = async () => { const started = Date.now(); await db.execute(sql`select 1`); return Date.now() - started; };
  const latencyMs = await probe();
  const [sizeRows, tableRows, columnRows, migrationRows, unlinkedRows, connectionRows, auditRows, response] = await Promise.all([
    db.execute(sql`select pg_database_size(current_database())::bigint as bytes`),
    db.execute(sql`select c.relname as name, pg_total_relation_size(c.oid)::bigint as bytes, greatest(coalesce(s.n_live_tup, 0), c.reltuples::bigint, 0)::bigint as rows
      from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public' and c.relkind = 'r' order by bytes desc`),
    db.execute(sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`),
    db.execute(sql`select created_at::bigint as created_at from drizzle.__drizzle_migrations`).catch(() => null),
    // Linked tables: names on collections that match no branch or employee record (their link ID stays empty).
    db.execute(sql`select kind, name, sum(rows)::int as rows, string_agg(distinct source, ', ') as tables from (
        select 'Branch' as kind, branch as name, count(*) as rows, 'collections' as source from collections where branch_id is null and trim(coalesce(branch, '')) <> '' group by branch
        union all select 'MAS', mas, count(*), 'collections' from collections where mas_employee_id is null and trim(coalesce(mas, '')) <> '' group by mas
        union all select 'Branch', branch, count(*), 'sales' from sales where branch_id is null and trim(coalesce(branch, '')) <> '' group by branch
        union all select 'MAS', mas, count(*), 'sales' from sales where mas_employee_id is null and trim(coalesce(mas, '')) <> '' group by mas
        union all select 'Branch', branch, count(*), 'enrollments' from member_programs where branch_id is null and trim(coalesce(branch, '')) <> '' group by branch
        union all select 'MAS', mas, count(*), 'enrollments' from member_programs where mas_employee_id is null and trim(coalesce(mas, '')) <> '' group by mas
        union all select 'Branch', branch, count(*), 'remittances' from remittances where branch_id is null and trim(coalesce(branch, '')) <> '' group by branch
        union all select 'MAS', mas, count(*), 'remittances' from remittances where mas_employee_id is null and trim(coalesce(mas, '')) <> '' group by mas
        union all select 'Branch', branch, count(*), 'attendance' from attendance where branch_id is null and trim(coalesce(branch, '')) <> '' group by branch
      ) unlinked group by kind, name order by rows desc limit 30`).catch(() => null),
    db.execute(sql`select (select count(*) from pg_stat_activity where datname = current_database())::int as used, current_setting('max_connections')::int as max`),
    db.select({ at: schema.audit_log.logged_at, action: schema.audit_log.action, table: schema.audit_log.table_name, recordId: schema.audit_log.record_id, userName: schema.audit_log.user_name, userId: schema.audit_log.user_id })
      .from(schema.audit_log).orderBy(desc(schema.audit_log.logged_at)).limit(10).catch(() => []),
    // Accounts, roles and employees, through the Sheets layer that the account pages also use.
    sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: [USERS_RANGE, "Roles!A:L", "'User Roles'!A:B", "Employees!A:E"], valueRenderOption: "UNFORMATTED_VALUE" }),
  ]);
  const [userRows, roleRows, linkRows, employeeRows] = response.data.valueRanges?.map((range) => range.values ?? []) ?? [];

  const bytes = Number(rowsOf<{ bytes: number }>(sizeRows)[0]?.bytes ?? 0);
  const tables = rowsOf<{ name: string; bytes: number; rows: number }>(tableRows).map((table) => ({ name: table.name, bytes: Number(table.bytes), rows: Number(table.rows) }));
  const connection = rowsOf<{ used: number; max: number }>(connectionRows)[0] ?? { used: 0, max: 0 };

  // Schema: the columns the code queries must all exist, or every page reading that table fails ("Failed query").
  const present = new Set(rowsOf<{ table_name: string; column_name: string }>(columnRows).map((row) => `${row.table_name}.${row.column_name}`));
  const presentTables = new Set(rowsOf<{ table_name: string }>(columnRows).map((row) => row.table_name));
  const expected = expectedColumns();
  const missingTables = expected.filter((table) => !presentTables.has(table.table)).map((table) => table.table);
  const missingColumns = expected.filter((table) => presentTables.has(table.table)).flatMap((table) => table.columns.filter((column) => !present.has(`${table.table}.${column}`)).map((column) => `${table.table}.${column}`));
  const applied = migrationRows ? new Set(rowsOf<{ created_at: number }>(migrationRows).map((row) => Number(row.created_at))) : new Set<number>();
  const pendingMigrations = journal.entries.filter((entry) => !applied.has(entry.when)).map((entry) => entry.tag);

  const { users } = readUserRows(userRows);
  const roles = roleRows.slice(1).filter((row) => text(row[0])).map((row) => ({ id: text(row[0]), name: text(row[1]), manageUsers: /^(true|yes|1)$/i.test(text(row[3])), manageAttendance: /^(true|yes|1)$/i.test(text(row[4])), viewAttendanceReports: /^(true|yes|1)$/i.test(text(row[5])), active: text(row[6]).toLowerCase() !== "inactive", customPages: Boolean(text(row[11])) }));
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const links = linkRows.slice(1).filter((row) => text(row[0])).map((row) => ({ userId: text(row[0]), roleId: text(row[1]) }));
  const employees = employeeRows.slice(1).filter((row) => text(row[0])).map((row) => ({ id: text(row[0]), name: text(row[1]), roles: splitRoles(row[3]), status: text(row[4]).toLowerCase() || "active" }));
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const activeUsers = users.filter((user) => user.status === "active");
  const roleNamesOf = (userId: string) => links.filter((link) => link.userId === userId).map((link) => roleById.get(link.roleId)?.name ?? link.roleId);
  const who = (user: { employeeId: string; fullName: string }) => `${employeeById.get(user.employeeId)?.name || user.fullName || "Unnamed"} (${user.employeeId || "no employee ID"})`;

  const issues: IntegrityIssue[] = [];
  const add = (issue: IntegrityIssue) => { if (issue.items.length) issues.push(issue); };
  add({ severity: "critical", title: "Database is missing tables the code uses", detail: "Pages that read these tables fail. Run npm run db:migrate on this database (production: npm run prod -- npm run db:migrate).", href: "",
    items: missingTables });
  add({ severity: "critical", title: "Database is missing columns the code uses", detail: "Every query on these tables fails with \"Failed query\". Run npm run db:migrate on this database (production: npm run prod -- npm run db:migrate), before pushing next time.", href: "",
    items: missingColumns });
  add({ severity: "info", title: "Records whose branch or MAS name matches no record", detail: "Their link to the branch or employee stays empty until a record with that name exists. Registering the employee (or branch) under exactly that name links these records at once. DTO and Others are not people and can stay unlinked.", href: "/employees",
    items: unlinkedRows ? rowsOf<{ kind: string; name: string; rows: number; tables: string }>(unlinkedRows).map((row) => `${row.kind} "${row.name}" · ${Number(row.rows).toLocaleString("en-PH")} record${Number(row.rows) === 1 ? "" : "s"} (${row.tables})`) : [] });
  add({ severity: "warning", title: "Migrations not recorded as applied", detail: migrationRows ? "These db/migrations files are not in drizzle.__drizzle_migrations. Run npm run db:migrate." : "The migrations table could not be read.", href: "",
    items: migrationRows ? pendingMigrations : ["drizzle.__drizzle_migrations"] });
  add({ severity: "critical", title: "Active accounts for inactive or missing employees", detail: "These people can still sign in. Deactivate the account or correct the employee record.", href: "/user-accounts",
    items: activeUsers.filter((user) => { const employee = employeeById.get(user.employeeId); return !employee || employee.status !== "active"; }).map((user) => `${who(user)} · employee ${employeeById.get(user.employeeId)?.status ?? "not found"}`) });
  add({ severity: "critical", title: "Active accounts without a role", detail: "They can sign in but see only the safe fallback. Assign a role.", href: "/user-accounts",
    items: activeUsers.filter((user) => !links.some((link) => link.userId === user.id && roleById.get(link.roleId)?.active)).map(who) });
  add({ severity: "warning", title: "Role links to missing or inactive roles", detail: "These links are ignored at sign-in.", href: "/roles",
    items: links.filter((link) => !roleById.get(link.roleId)?.active).map((link) => `${link.userId} → ${link.roleId}${roleById.has(link.roleId) ? " (inactive)" : " (missing)"}`) });
  add({ severity: "warning", title: "Employee roles differ from sign-in roles", detail: "The Employees register and the account's roles disagree; the account's roles decide what they can open.", href: "/user-accounts",
    items: activeUsers.flatMap((user) => {
      const employee = employeeById.get(user.employeeId); if (!employee) return [];
      const account = roleNamesOf(user.id).map((role) => role.toLowerCase()).sort(), register = employee.roles.map((role) => role.toLowerCase()).sort();
      return account.join("|") === register.join("|") ? [] : [`${employee.name}: register "${employee.roles.join(", ") || "none"}" · account "${roleNamesOf(user.id).join(", ") || "none"}"`];
    }) });
  add({ severity: "info", title: "Active employees without a sign-in account", detail: "Create an account if they need to use the system.", href: "/user-accounts",
    items: employees.filter((employee) => employee.status === "active" && !users.some((user) => user.employeeId === employee.id)).map((employee) => `${employee.name} (${employee.id})`) });
  const duplicateEmployeeIds = [...new Set(users.map((user) => user.employeeId).filter((id, index, all) => id && all.indexOf(id) !== index))];
  add({ severity: "critical", title: "Several accounts for one employee", detail: "Sign-in uses the first active match; remove the extra account.", href: "/user-accounts", items: duplicateEmployeeIds.map((id) => `${employeeById.get(id)?.name ?? id} (${id})`) });

  const databaseUrl = readServerVariable("DATABASE_URL");
  const project = /postgres\.([a-z0-9]+)[:@]/.exec(databaseUrl)?.[1] ?? "";
  const authSecret = readServerVariable("AUTH_SECRET");
  // Read like lib/photo-storage.ts does; these are not in readServerVariable's list.
  const storageReady = Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_KEY?.trim());
  const config = [
    { label: "Database", ok: Boolean(project), detail: project === PRODUCTION_REF ? `Production (${project})` : project === STAGING_REF ? `Staging (${project})` : project || "DATABASE_URL missing" },
    { label: "Receipt photo storage", ok: storageReady, detail: storageReady ? "Supabase Storage configured" : "SUPABASE_URL or SUPABASE_SERVICE_KEY missing" },
    { label: "Session secret strength", ok: authSecret.length >= 32, detail: authSecret.length >= 32 ? `${authSecret.length} characters` : `Only ${authSecret.length} characters; use 32 or more` },
    { label: "Environment", ok: true, detail: process.env.NODE_ENV === "production" ? "Production (secure cookies on)" : `${process.env.NODE_ENV ?? "unknown"} (cookies not marked secure)` },
    { label: "Node.js", ok: true, detail: process.version },
  ];

  return {
    project, latencyMs, checkedAt: new Date().toISOString(),
    capacity: { bytes, limit: SIZE_LIMIT, percent: Math.round((bytes / SIZE_LIMIT) * 1000) / 10, tables: tables.slice(0, 8), tableCount: tables.length },
    schema: { tables: expected.length, migrations: journal.entries.length, applied: journal.entries.length - pendingMigrations.length, latest: journal.entries.at(-1)?.tag ?? "", missing: missingTables.length + missingColumns.length },
    connections: { used: Number(connection.used), max: Number(connection.max) },
    accounts: { total: users.length, active: activeUsers.length, inactive: users.length - activeUsers.length, employees: employees.length, activeEmployees: employees.filter((employee) => employee.status === "active").length },
    roles: roles.map((role) => ({ ...role, users: new Set(links.filter((link) => link.roleId === role.id && activeUsers.some((user) => user.id === link.userId)).map((link) => link.userId)).size })).sort((a, b) => b.users - a.users),
    issues: issues.sort((a, b) => ["critical", "warning", "info"].indexOf(a.severity) - ["critical", "warning", "info"].indexOf(b.severity)),
    audit: auditRows.map((row) => ({ at: text(row.at), action: text(row.action), table: text(row.table), recordId: text(row.recordId), by: text(row.userName) || text(row.userId) })),
    config, runtime: { ...sheetsStats(), uptimeMinutes: Math.round(process.uptime() / 60) },
  };
}
export type SystemHealth = Awaited<ReturnType<typeof getSystemHealth>>;
