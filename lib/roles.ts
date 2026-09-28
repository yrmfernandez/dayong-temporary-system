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

export async function createRole(value: Partial<RoleRecord>) {
  const role = input(value), roles = await getRoles();
  if (roles.some((item) => item.name.toLowerCase() === role.name.toLowerCase())) throw new Error("That role name already exists.");
  const actor = getEncoder(), stem = `ROLE-${role.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "CUSTOM"}`;
  let id = stem;
  for (let suffix = 2; roles.some((item) => item.id === id); suffix++) id = `${stem}-${String(suffix).padStart(2, "0")}`;
  await sheets.spreadsheets.values.append({ spreadsheetId: GOOGLE_SHEET_ID, range: RANGE, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [[id, role.name, role.description, role.manageUsers, role.manageAttendance, role.viewAttendanceReports, role.status, actor.userId, actor.employeeId, actor.name, actor.encodedAt, pageCell(role.pages)]] } });
  return { id, ...role };
}

export async function updateRole(id: string, value: Partial<RoleRecord>) {
  const role = input(value), rows = await data(), rowIndex = rows.slice(1).findIndex((row) => text(row[0]) === id);
  if (rowIndex < 0) throw new Error("Role not found.");
  if (rows.slice(1).some((row, index) => index !== rowIndex && text(row[1]).toLowerCase() === role.name.toLowerCase())) throw new Error("That role name already exists.");
  const row = rowIndex + 2;
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "RAW", data: [
    { range: `Roles!B${row}:G${row}`, values: [[role.name, role.description, role.manageUsers, role.manageAttendance, role.viewAttendanceReports, role.status]] },
    { range: `Roles!L${row}`, values: [[pageCell(role.pages)]] },
  ] } });
  return { id, ...role };
}

export async function deleteRole(id: string) {
  const [roles, links] = await Promise.all([data(), sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "'User Roles'!A:B" })]);
  if ((links.data.values ?? []).slice(1).some((row) => text(row[1]) === id)) throw new Error("This role is assigned to user accounts. Remove those assignments or set the role inactive.");
  const rowIndex = roles.slice(1).findIndex((row) => text(row[0]) === id);
  if (rowIndex < 0) throw new Error("Role not found.");
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `Roles!A${rowIndex + 2}:L${rowIndex + 2}`, valueInputOption: "RAW", requestBody: { values: [Array(12).fill("")] } });
}
