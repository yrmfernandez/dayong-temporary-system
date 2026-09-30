import { AUDIT_SHEET } from "@/lib/audit-log";
import { GOOGLE_SHEET_ID, readingFresh, sheets, sheetsStats } from "@/lib/google-sheets";
import { readUserRows, USERS_RANGE } from "@/lib/users-sheet";
import { readServerVariable } from "@/lib/server-environment";

const text = (value: unknown) => String(value ?? "").trim();
const CELL_LIMIT = 10_000_000; // Google Sheets allows 10 million cells per spreadsheet.
const splitRoles = (value: unknown) => text(value).split(",").map((role) => role.trim()).filter(Boolean);

export type IntegrityIssue = { severity: "critical" | "warning" | "info"; title: string; detail: string; items: string[]; href: string };

/** System health for the IT workspace: capacity, access integrity, configuration, and recent changes. */
export async function getSystemHealth() {
  // Round trip of one tiny live read, so the figure reflects Google now rather than the cache.
  const probe = async () => { const started = Date.now(); await readingFresh(() => sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Roles!A1:A1" })); return Date.now() - started; };
  const [metadata, response, latencyMs] = await Promise.all([
    sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "properties.title,sheets.properties(title,gridProperties)" }),
    sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: [USERS_RANGE, "Roles!A:L", "'User Roles'!A:B", "Employees!A:E"], valueRenderOption: "UNFORMATTED_VALUE" }),
    probe(),
  ]);
  const [userRows, roleRows, linkRows, employeeRows] = response.data.valueRanges?.map((range) => range.values ?? []) ?? [];

  const tabs = (metadata.data.sheets ?? []).map((sheet) => ({ title: sheet.properties?.title ?? "", rows: sheet.properties?.gridProperties?.rowCount ?? 0, columns: sheet.properties?.gridProperties?.columnCount ?? 0 }))
    .map((tab) => ({ ...tab, cells: tab.rows * tab.columns })).sort((a, b) => b.cells - a.cells);
  const cells = tabs.reduce((sum, tab) => sum + tab.cells, 0);

  // Recent edits and deletes, read only when the Audit Log exists.
  let audit: Array<{ at: string; action: string; sheet: string; recordId: string; by: string }> = [];
  if (tabs.some((tab) => tab.title === AUDIT_SHEET)) {
    const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${AUDIT_SHEET}'!A:J` })).data.values ?? [];
    audit = rows.slice(1).filter((row) => text(row[0])).map((row) => ({ at: text(row[1]), action: text(row[2]), sheet: text(row[3]), recordId: text(row[4]), by: text(row[9]) || text(row[7]) }))
      .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  }

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

  const authSecret = readServerVariable("AUTH_SECRET");
  const config = [
    { label: "Google service account", ok: Boolean(readServerVariable("GOOGLE_SERVICE_ACCOUNT_EMAIL")), detail: readServerVariable("GOOGLE_SERVICE_ACCOUNT_EMAIL") ? "Configured" : "Missing" },
    { label: "Spreadsheet", ok: Boolean(GOOGLE_SHEET_ID), detail: metadata.data.properties?.title ?? "Unknown" },
    { label: "Session secret strength", ok: authSecret.length >= 32, detail: authSecret.length >= 32 ? `${authSecret.length} characters` : `Only ${authSecret.length} characters; use 32 or more` },
    { label: "Environment", ok: true, detail: process.env.NODE_ENV === "production" ? "Production (secure cookies on)" : `${process.env.NODE_ENV ?? "unknown"} (cookies not marked secure)` },
    { label: "Node.js", ok: true, detail: process.version },
  ];

  return {
    spreadsheet: metadata.data.properties?.title ?? "", latencyMs, checkedAt: new Date().toISOString(),
    capacity: { cells, limit: CELL_LIMIT, percent: Math.round((cells / CELL_LIMIT) * 1000) / 10, tabs: tabs.slice(0, 8), tabCount: tabs.length },
    accounts: { total: users.length, active: activeUsers.length, inactive: users.length - activeUsers.length, employees: employees.length, activeEmployees: employees.filter((employee) => employee.status === "active").length },
    roles: roles.map((role) => ({ ...role, users: new Set(links.filter((link) => link.roleId === role.id && activeUsers.some((user) => user.id === link.userId)).map((link) => link.userId)).size })).sort((a, b) => b.users - a.users),
    issues: issues.sort((a, b) => ["critical", "warning", "info"].indexOf(a.severity) - ["critical", "warning", "info"].indexOf(b.severity)),
    audit, config, runtime: { ...sheetsStats(), uptimeMinutes: Math.round(process.uptime() / 60) },
  };
}
export type SystemHealth = Awaited<ReturnType<typeof getSystemHealth>>;
