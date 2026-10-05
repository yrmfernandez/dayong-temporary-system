import { asc, eq } from "drizzle-orm";

import { currentDb, encodedBy, inTransaction, schema, type Transaction } from "@/lib/db";
import { sheets, GOOGLE_SHEET_ID } from "@/lib/google-sheets";
import { EMPLOYEE_ID_FORMAT_MESSAGE, isEmployeeIdFormat } from "@/lib/employee-id";

// Employees and their branch assignments are in the database. Sign-in accounts (Users) are still in Google Sheets until
// they move, so Employee ID clashes and linked accounts are checked there too.

export const employmentStatuses = ["active", "inactive", "resigned"] as const;
export type EmploymentStatus = (typeof employmentStatuses)[number];
const normalizeRoleName = (role: string) => role === "Admin" ? "Administrator" : role === "HR" ? "HR Officer" : role;

type EmployeeRow = {
  id: string; name: string; branch: string; roles: string[]; status: string;
  contact: string; email: string; dateHired: string; createdAt: string;
};

const clean = (value: string | null | undefined) => (value ?? "").trim();
const { employees: employeeTable, employee_branches: assignmentTable } = schema;

async function getEmployeeBranchAssignments() {
  const rows = await currentDb().select().from(assignmentTable);
  return rows.map((row) => ({ id: row.assignment_id, employeeId: row.employee_id, branchId: row.branch_id }));
}

async function getEmployeeRows(): Promise<EmployeeRow[]> {
  const rows = await currentDb().select().from(employeeTable).orderBy(asc(employeeTable.employee_id));
  return rows.map((row) => ({
    id: row.employee_id, name: clean(row.full_name), branch: clean(row.primary_branch),
    roles: clean(row.operational_roles).split(",").map((role) => normalizeRoleName(role.trim())).filter(Boolean),
    status: clean(row.employment_status).toLowerCase(), contact: clean(row.contact_number),
    email: clean(row.email), dateHired: row.date_hired ?? "", createdAt: row.created_at ?? "",
  }));
}

/** Replaces an employee's branch assignments (inside the caller's transaction). */
async function writeAssignments(tx: Transaction, employeeId: string, branchIds: string[]) {
  await tx.delete(assignmentTable).where(eq(assignmentTable.employee_id, employeeId));
  if (branchIds.length) await tx.insert(assignmentTable).values(branchIds.map((branchId, index) => ({ assignment_id: `EBA-${employeeId}-${Date.now()}-${index + 1}`, employee_id: employeeId, branch_id: branchId, ...encodedBy() })));
}

/** Users!B: Employee IDs of sign-in accounts (still in Google Sheets). */
async function accountEmployeeIds() {
  return ((await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Users!A:B" })).data.values ?? []).slice(1).map((row) => String(row[1] ?? "").trim());
}

export async function getEmployees() {
  const [employees, assignments] = await Promise.all([getEmployeeRows(), getEmployeeBranchAssignments()]);
  return employees.map((employee) => ({
    id: employee.id, name: employee.name, branch: employee.branch, roles: employee.roles,
    status: employee.status, contact: employee.contact, email: employee.email,
    dateHired: employee.dateHired, createdAt: employee.createdAt,
    branchIds: assignments.filter((assignment) => assignment.employeeId === employee.id).map((assignment) => assignment.branchId),
  }));
}

/**
 * The primary branch (Employees column C, `primary_branch`) is chosen from the employee's assigned branches. It is
 * where they clock in and the branch shown first everywhere. With a single assigned branch it is that branch.
 */
function readPrimaryBranch(body: Record<string, unknown>, branchIds: string[], branches: Array<{ id: string; name: string }>) {
  const chosen = typeof body.primaryBranchId === "string" ? body.primaryBranchId.trim() : "";
  const primaryId = chosen || (branchIds.length === 1 ? branchIds[0] : "");
  if (!primaryId) throw new Error("Choose the primary branch.");
  if (!branchIds.includes(primaryId)) throw new Error("The primary branch must be one of the assigned branches.");
  return branches.find((branch) => branch.id === primaryId)?.name ?? "";
}

function readRoles(body: Record<string, unknown>) {
  const source = Array.isArray(body.roles) ? body.roles : typeof body.role === "string" ? [body.role] : [];
  return [...new Set(source.map((role) => typeof role === "string" ? role.trim() : "").filter(Boolean))];
}

function readBranchIds(body: Record<string, unknown>) {
  return [...new Set((Array.isArray(body.branchIds) ? body.branchIds : []).map((id) => typeof id === "string" ? id.trim() : "").filter(Boolean))];
}

/**
 * Next company-format Employee ID (PREFIX-YYYY-NNNN): the most used prefix, the current Manila year,
 * and one more than the highest number already issued with that prefix and year.
 */
export function suggestEmployeeId(existingIds: string[], year = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric" }).format(new Date())) {
  const parsed = existingIds.map((id) => /^([A-Z]{2,5})-(\d{4})-(\d{4})$/.exec(id.trim().toUpperCase())).filter((match): match is RegExpExecArray => Boolean(match));
  const counts = new Map<string, number>();
  parsed.forEach((match) => counts.set(match[1], (counts.get(match[1]) ?? 0) + 1));
  const prefix = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "MD";
  const highest = parsed.filter((match) => match[1] === prefix && match[2] === year).reduce((max, match) => Math.max(max, Number(match[3])), 0);
  return `${prefix}-${year}-${String(highest + 1).padStart(4, "0")}`;
}

export async function getNextEmployeeId() {
  const [employees, accounts] = await Promise.all([getEmployeeRows(), accountEmployeeIds()]);
  return suggestEmployeeId([...employees.map((employee) => employee.id), ...accounts]);
}

export async function registerEmployee(body: Record<string, unknown>, validRoles: string[], branches: Array<{ id: string; name: string }>) {
  const text = (key: string) => typeof body[key] === "string" ? (body[key] as string).trim() : "";
  const id=text("employeeId").toUpperCase(),name = text("name"), branchIds = readBranchIds(body), roles = readRoles(body), contact = text("contact"), email = text("email"), dateHired = text("dateHired");
  if(!isEmployeeIdFormat(id))throw new Error(EMPLOYEE_ID_FORMAT_MESSAGE);
  if (!name || name.length > 150) throw new Error("Enter a full name of up to 150 characters.");
  if (!branchIds.length || branchIds.some((id) => !branches.some((branch) => branch.id === id))) throw new Error("Select at least one active registered branch.");
  if (!roles.length) throw new Error("Select at least one operational role.");
  if (roles.some((role) => !validRoles.includes(role))) throw new Error("One or more operational roles are invalid.");
  if (contact.length > 50 || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error("Check the contact number and email.");
  if (dateHired && (!/^\d{4}-\d{2}-\d{2}$/.test(dateHired) || !Number.isFinite(Date.parse(dateHired)) || new Date(dateHired).toISOString().slice(0, 10) !== dateHired)) throw new Error("Enter a valid date hired.");
  const [employees, accounts] = await Promise.all([getEmployeeRows(), accountEmployeeIds()]);
  const ids = [...employees.map((e) => e.id.toUpperCase()), ...accounts.map((value) => value.toUpperCase())];
  if(ids.includes(id))throw new Error("This Employee ID already exists.");
  const primaryBranch = readPrimaryBranch(body, branchIds, branches);
  // The employee and their branch assignments are saved together.
  await inTransaction(async (tx) => {
    await tx.insert(employeeTable).values({ employee_id: id, full_name: name, primary_branch: primaryBranch || null, operational_roles: roles.join(", "), employment_status: "active", contact_number: contact || null, email: email || null, date_hired: dateHired || null, created_at: new Date().toISOString(), ...encodedBy() });
    await writeAssignments(tx, id, branchIds);
  });
  return { id, name, roles, primaryBranch };
}

export async function updateEmployee(employeeId: string, body: Record<string, unknown>, validRoles: string[], branches: Array<{ id: string; name: string }>) {
  const employee = (await getEmployeeRows()).find((item) => item.id === employeeId);
  if (!employee) throw new Error("Employee not found.");
  const text = (key: string) => typeof body[key] === "string" ? (body[key] as string).trim() : "";
  const name = text("name"), status = text("status").toLowerCase(), roles = readRoles(body), branchIds = readBranchIds(body);
  if (!name || name.length > 150) throw new Error("Enter a valid full name.");
  if (!employmentStatuses.includes(status as EmploymentStatus)) throw new Error("Select active, inactive, or resigned.");
  if (!roles.length || roles.some((role) => !validRoles.includes(role))) throw new Error("Select valid operational roles.");
  if (!branchIds.length || branchIds.some((id) => !branches.some((branch) => branch.id === id))) throw new Error("Select valid branch assignments.");
  const primaryBranch = readPrimaryBranch(body, branchIds, branches);
  const contact = text("contact"), email = text("email"), dateHired = text("dateHired");
  if (contact.length > 50 || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error("Check the contact number and email.");
  if (dateHired && (!/^\d{4}-\d{2}-\d{2}$/.test(dateHired) || !Number.isFinite(Date.parse(dateHired)))) throw new Error("Enter a valid date hired.");
  // The details and the branch assignments change together.
  await inTransaction(async (tx) => {
    await tx.update(employeeTable).set({ full_name: name, primary_branch: primaryBranch || null, operational_roles: roles.join(", "), employment_status: status, contact_number: contact || null, email: email || null, date_hired: dateHired || null }).where(eq(employeeTable.employee_id, employeeId));
    await writeAssignments(tx, employeeId, branchIds);
  });
  return { id: employeeId, name, roles };
}

/** Rewrites only the register's roles (column D), used to follow a change made to the sign-in account's roles. */
export async function setEmployeeRoles(employeeId: string, roles: string[]) {
  const updated = await currentDb().update(employeeTable).set({ operational_roles: roles.join(", ") }).where(eq(employeeTable.employee_id, employeeId)).returning({ id: employeeTable.employee_id });
  return updated.length > 0;
}

export async function updateEmployeeStatus(employeeId: string, status: string) {
  if (!employmentStatuses.includes(status as EmploymentStatus)) throw new Error("Select active, inactive, or resigned.");
  const updated = await currentDb().update(employeeTable).set({ employment_status: status }).where(eq(employeeTable.employee_id, employeeId)).returning({ id: employeeTable.employee_id });
  if (!updated.length) throw new Error("Employee not found.");
  return { id: employeeId, status };
}

export async function deleteEmployee(employeeId: string) {
  const [employeeRows, accounts] = await Promise.all([getEmployeeRows(), accountEmployeeIds()]);
  if (!employeeRows.some((item) => item.id === employeeId)) throw new Error("Employee not found.");
  if (accounts.includes(employeeId)) throw new Error("This employee has a linked user account. Deactivate or remove that account before deleting the employee.");
  // Their branch assignments go with them; anything else that names them (accounts, collections) blocks the delete.
  await inTransaction(async (tx) => {
    await tx.delete(assignmentTable).where(eq(assignmentTable.employee_id, employeeId));
    await tx.delete(employeeTable).where(eq(employeeTable.employee_id, employeeId));
  });
  return { id: employeeId };
}
