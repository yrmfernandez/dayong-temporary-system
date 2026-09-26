import { sheets, GOOGLE_SHEET_ID } from "@/lib/google-sheets";
import { appendEncodedRows } from "@/lib/encoder-sheets";

export const employmentStatuses = ["active", "inactive", "resigned"] as const;
export type EmploymentStatus = (typeof employmentStatuses)[number];
const normalizeRoleName = (role: string) => role === "Admin" ? "Administrator" : role === "HR" ? "HR Officer" : role;

type EmployeeRow = {
  rowNumber: number; id: string; name: string; branch: string; roles: string[]; status: string;
  contact: string; email: string; dateHired: string; createdAt: string;
};

type EmployeeBranchAssignment = { rowNumber: number; id: string; employeeId: string; branchId: string };

async function getEmployeeBranchAssignments(): Promise<EmployeeBranchAssignment[]> {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "'Employee Branches'!A:C" });
  return (response.data.values ?? []).slice(1).map((row, index) => ({ rowNumber: index + 2, id: String(row[0] ?? "").trim(), employeeId: String(row[1] ?? "").trim(), branchId: String(row[2] ?? "").trim() })).filter((row) => row.id && row.employeeId && row.branchId);
}

async function getEmployeeRows(): Promise<EmployeeRow[]> {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "'Employees'!A:I" });
  return (response.data.values ?? []).slice(1).map((r, index) => ({
    rowNumber: index + 2,
    id: String(r[0] ?? "").trim(), name: String(r[1] ?? "").trim(), branch: String(r[2] ?? "").trim(),
    roles: String(r[3] ?? "").split(",").map((s) => normalizeRoleName(s.trim())).filter(Boolean),
    status: String(r[4] ?? "").trim().toLowerCase(), contact: String(r[5] ?? "").trim(),
    email: String(r[6] ?? "").trim(), dateHired: String(r[7] ?? "").trim(), createdAt: String(r[8] ?? "").trim(),
  })).filter((employee) => employee.id);
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

function readRoles(body: Record<string, unknown>) {
  const source = Array.isArray(body.roles) ? body.roles : typeof body.role === "string" ? [body.role] : [];
  return [...new Set(source.map((role) => typeof role === "string" ? role.trim() : "").filter(Boolean))];
}

function readBranchIds(body: Record<string, unknown>) {
  return [...new Set((Array.isArray(body.branchIds) ? body.branchIds : []).map((id) => typeof id === "string" ? id.trim() : "").filter(Boolean))];
}

export async function registerEmployee(body: Record<string, unknown>, validRoles: string[], branches: Array<{ id: string; name: string }>) {
  const text = (key: string) => typeof body[key] === "string" ? (body[key] as string).trim() : "";
  const name = text("name"), branchIds = readBranchIds(body), roles = readRoles(body), contact = text("contact"), email = text("email"), dateHired = text("dateHired");
  if (!name || name.length > 150) throw new Error("Enter a full name of up to 150 characters.");
  if (!branchIds.length || branchIds.some((id) => !branches.some((branch) => branch.id === id))) throw new Error("Select at least one active registered branch.");
  if (!roles.length) throw new Error("Select at least one operational role.");
  if (roles.some((role) => !validRoles.includes(role))) throw new Error("One or more operational roles are invalid.");
  if (contact.length > 50 || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error("Check the contact number and email.");
  if (dateHired && (!/^\d{4}-\d{2}-\d{2}$/.test(dateHired) || !Number.isFinite(Date.parse(dateHired)) || new Date(dateHired).toISOString().slice(0, 10) !== dateHired)) throw new Error("Enter a valid date hired.");
  const [employees, users] = await Promise.all([getEmployees(), sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Users!A:B" })]);
  const ids = [...employees.map((e) => e.id), ...(users.data.values ?? []).slice(1).map((r) => String(r[1] ?? ""))];
  const next = ids.reduce((max, id) => /^DPE-\d{4}$/.test(id) ? Math.max(max, Number(id.slice(4))) : max, 0) + 1;
  if (next > 9999) throw new Error("Employee ID capacity reached.");
  const id = `DPE-${String(next).padStart(4, "0")}`;
  const primaryBranch = branches.find((branch) => branch.id === branchIds[0])?.name ?? "";
  await appendEncodedRows({ range: "Employees!A:I", requestBody: { values: [[id, name, primaryBranch, roles.join(", "), "active", contact, email, dateHired, new Date().toISOString()].map((v) => `'${v}`)] } });
  await appendEncodedRows({ range: "'Employee Branches'!A:C", requestBody: { values: branchIds.map((branchId, index) => [`EBA-${id}-${String(index + 1).padStart(2, "0")}`, id, branchId]) } });
  return { id };
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
  const assignments = await getEmployeeBranchAssignments();
  const old = assignments.filter((assignment) => assignment.employeeId === employeeId);
  const primaryBranch = branches.find((branch) => branch.id === branchIds[0])?.name ?? "";
  const contact = text("contact"), email = text("email"), dateHired = text("dateHired");
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'Employees'!A${employee.rowNumber}:I${employee.rowNumber}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[employee.id, name, primaryBranch, roles.join(", "), status, contact, email, dateHired, employee.createdAt]] } });
  if (old.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "RAW", data: old.map((assignment) => ({ range: `'Employee Branches'!A${assignment.rowNumber}:G${assignment.rowNumber}`, values: [Array(7).fill("")] })) } });
  await appendEncodedRows({ range: "'Employee Branches'!A:C", requestBody: { values: branchIds.map((branchId, index) => [`EBA-${employeeId}-${Date.now()}-${index + 1}`, employeeId, branchId]) } });
  return { id: employeeId };
}

export async function updateEmployeeStatus(employeeId: string, status: string) {
  if (!employmentStatuses.includes(status as EmploymentStatus)) throw new Error("Select active, inactive, or resigned.");
  const employee = (await getEmployeeRows()).find((item) => item.id === employeeId);
  if (!employee) throw new Error("Employee not found.");
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'Employees'!E${employee.rowNumber}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[status]] } });
  return { id: employeeId, status };
}

export async function deleteEmployee(employeeId: string) {
  const [employeeRows, usersResponse] = await Promise.all([
    getEmployeeRows(),
    sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Users!A:B" }),
  ]);
  const employee = employeeRows.find((item) => item.id === employeeId);
  if (!employee) throw new Error("Employee not found.");
  const linkedAccount = (usersResponse.data.values ?? []).slice(1).some((row) => String(row[1] ?? "").trim() === employeeId);
  if (linkedAccount) throw new Error("This employee has a linked user account. Deactivate or remove that account before deleting the employee.");
  const assignments = (await getEmployeeBranchAssignments()).filter((assignment) => assignment.employeeId === employeeId);
  if (assignments.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "RAW", data: assignments.map((assignment) => ({ range: `'Employee Branches'!A${assignment.rowNumber}:G${assignment.rowNumber}`, values: [Array(7).fill("")] })) } });
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'Employees'!A${employee.rowNumber}:M${employee.rowNumber}`, valueInputOption: "RAW", requestBody: { values: [Array(13).fill("")] } });
  return { id: employeeId };
}
