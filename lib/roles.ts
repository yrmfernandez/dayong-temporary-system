import { eq, sql } from "drizzle-orm";

import { encodedBy, inTransaction, schema, type Queryable } from "@/lib/db";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { getEncoder } from "@/lib/encoder-context";
import { isAdministratorRole } from "@/lib/access-control";
import { pageCatalogRoutes } from "@/lib/page-catalog";

const text = (value: unknown) => String(value ?? "").trim();
const bool = (value: unknown) => ["true", "yes", "1"].includes(text(value).toLowerCase());

// Roles!A:G business columns, H:K encoder identity, L page_access (comma-separated routes; blank = role defaults).
const RANGE = "Roles!A:L";
export type RoleRecord = { id: string; name: string; description: string; manageUsers: boolean; manageAttendance: boolean; viewAttendanceReports: boolean; status: "active" | "inactive"; pages: string[] | null };

export const parsePageAccess = (value: unknown) => {
  const pages = text(value).split(",").map((page) => page.trim()).filter(Boolean);
  return pages.length ? pages : null;
};

async function data() { return (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: RANGE })).data.values ?? []; }

export async function getRoles(): Promise<RoleRecord[]> {
  const rows = await data(); const ids = new Set<string>();
  return rows.slice(1).filter((row) => text(row[0])).map((row) => {
    const id = text(row[0]);
    if (ids.has(id)) throw new Error(`Duplicate role ID ${id}. Run the roles migration.`);
    ids.add(id);
    return { id, name: text(row[1]), description: text(row[2]), manageUsers: bool(row[3]), manageAttendance: bool(row[4]), viewAttendanceReports: bool(row[5]), status: text(row[6]).toLowerCase() === "inactive" ? "inactive" : "active", pages: parsePageAccess(row[11]) };
  });
}

function input(value: Partial<RoleRecord>) {
  const name = text(value.name);
  if (!name || name.length > 80) throw new Error("Enter a unique role name of up to 80 characters.");
  const known = new Set(pageCatalogRoutes);
  const requested = Array.isArray(value.pages) ? [...new Set(value.pages.map(text).filter(Boolean))] : null;
  if (requested?.some((page) => !known.has(page))) throw new Error("One or more selected pages are not recognized.");
  // Administrators always have every page, so their page access is never stored.
  const pages = isAdministratorRole(name) ? null : requested;
  return { name, description: text(value.description), manageUsers: Boolean(value.manageUsers), manageAttendance: Boolean(value.manageAttendance), viewAttendanceReports: Boolean(value.viewAttendanceReports), status: value.status === "inactive" ? "inactive" as const : "active" as const, pages };
}

const pageCell = (pages: string[] | null) => pages ? pages.join(", ") : "";

/**
 * Role changes (October 24, 2026; upgrade #6 phase 4): saved directly in the roles table by ID, inside one transaction
 * that holds a roles-wide lock, so two roles with the same name cannot be created or renamed at the same moment, and an
 * edit never lands on another row. Sign-in and the access checks keep reading roles as before.
 */
const lockRoles = (tx: Queryable) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('roles'))`);
const roleColumns = (role: ReturnType<typeof input>) => ({ role_name: role.name, description: role.description || null, manage_users: role.manageUsers, manage_attendance: role.manageAttendance, view_attendance_reports: role.viewAttendanceReports, status: role.status, page_access: pageCell(role.pages) || null });
async function rolesIn(tx: Queryable) {
  return (await tx.select({ id: schema.roles.role_id, name: schema.roles.role_name }).from(schema.roles)).map((row) => ({ id: row.id, name: text(row.name) }));
}

export async function createRole(value: Partial<RoleRecord>) {
  const role = input(value);
  getEncoder();
  return inTransaction(async (tx) => {
    await lockRoles(tx);
    const roles = await rolesIn(tx);
    if (roles.some((item) => item.name.toLowerCase() === role.name.toLowerCase())) throw new Error("That role name already exists.");
    const stem = `ROLE-${role.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "CUSTOM"}`;
    let id = stem;
    for (let suffix = 2; roles.some((item) => item.id === id); suffix++) id = `${stem}-${String(suffix).padStart(2, "0")}`;
    await tx.insert(schema.roles).values({ role_id: id, ...roleColumns(role), ...encodedBy() });
    return { id, ...role };
  });
}

export async function updateRole(id: string, value: Partial<RoleRecord>) {
  const role = input(value);
  return inTransaction(async (tx) => {
    await lockRoles(tx);
    const roles = await rolesIn(tx);
    if (!roles.some((item) => item.id === id)) throw new Error("Role not found.");
    if (roles.some((item) => item.id !== id && item.name.toLowerCase() === role.name.toLowerCase())) throw new Error("That role name already exists.");
    await tx.update(schema.roles).set(roleColumns(role)).where(eq(schema.roles.role_id, id));
    return { id, ...role };
  });
}

export async function deleteRole(id: string) {
  await inTransaction(async (tx) => {
    await lockRoles(tx);
    const [link] = await tx.select({ id: schema.user_roles.role_id }).from(schema.user_roles).where(eq(schema.user_roles.role_id, id)).limit(1);
    if (link) throw new Error("This role is assigned to user accounts. Remove those assignments or set the role inactive.");
    const removed = await tx.delete(schema.roles).where(eq(schema.roles.role_id, id)).returning({ id: schema.roles.role_id });
    if (!removed.length) throw new Error("Role not found.");
  });
}
