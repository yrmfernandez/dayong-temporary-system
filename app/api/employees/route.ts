import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { deleteEmployee, getEmployees, registerEmployee, updateEmployee, updateEmployeeStatus } from "@/lib/employees";
import { getActiveAccountRoles, getBranches } from "@/lib/google-sheets-data";

export async function GET() {
  if (!(await getSessionUser())) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  try {
    const [employees, branches, accountRoles, canManage] = await Promise.all([getEmployees(), getBranches(), getActiveAccountRoles(), canManageUsers()]);
    const operationalRoles = [...new Set([...accountRoles.map((role) => role.name), "Collector"])].sort();
    return Response.json({ success: true, employees, branches: branches.filter((branch) => branch.status === "active"), operationalRoles, canRegister: canManage, canManage }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Employee directory error:", error);
    return Response.json({ success: false, message: "Unable to load employees. Check the Employees sheet setup." }, { status: 500 });
  }
}
export const POST = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "You are not allowed to register employees." }, { status: 403 });
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid employee details.");
    const [branches, accountRoles] = await Promise.all([getBranches(), getActiveAccountRoles()]);
    const validRoles = [...new Set([...accountRoles.map((role) => role.name), "Collector"])];
    return Response.json({ success: true, employee: await registerEmployee(body, validRoles, branches.filter((branch) => branch.status === "active").map(({ id, name }) => ({ id, name }))) }, { status: 201 });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to register employee." }, { status: 400 }); }
});

export const PATCH = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "You are not allowed to update employees." }, { status: 403 });
  try {
    const body = await request.json();
    const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
    const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
    if (typeof body.name === "string") {
      const [branches, accountRoles] = await Promise.all([getBranches(), getActiveAccountRoles()]);
      const validRoles = [...new Set([...accountRoles.map((role) => role.name), "Collector"])];
      return Response.json({ success: true, employee: await updateEmployee(employeeId, body, validRoles, branches.filter((branch) => branch.status === "active").map(({ id, name }) => ({ id, name }))) });
    }
    return Response.json({ success: true, employee: await updateEmployeeStatus(employeeId, status) });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to update employee." }, { status: 400 }); }
});

export const DELETE = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "You are not allowed to delete employees." }, { status: 403 });
  try {
    const body = await request.json();
    const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
    return Response.json({ success: true, employee: await deleteEmployee(employeeId) });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to delete employee." }, { status: 400 }); }
});
