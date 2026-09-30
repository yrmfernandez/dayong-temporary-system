import { canManageEmployees, getSessionUser, userWithPageAccess } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { deleteEmployee, getEmployees, getNextEmployeeId, registerEmployee, updateEmployee, updateEmployeeStatus } from "@/lib/employees";
import { getActiveAccountRoles, getBranches } from "@/lib/google-sheets-data";
import { getUserAccounts } from "@/lib/master-data-crud";
import { accountRoleIdsFor, createDefaultAccount, DEFAULT_PASSWORD } from "@/lib/employee-accounts";
import { guardAccountChange } from "@/lib/privilege-guard";

export async function GET() {
  if (!(await getSessionUser())) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  // The directory serves the Employees page and the Commissions employee picker.
  if (!(await userWithPageAccess("/employees", "/commissions"))) return Response.json({ success: false, message: "You do not have access to Employees." }, { status: 403 });
  try {
    const [employees, branches, accountRoles, accounts, canManage] = await Promise.all([getEmployees(), getBranches(), getActiveAccountRoles(),getUserAccounts(), canManageEmployees()]);
    const nextEmployeeId = canManage ? await getNextEmployeeId() : "";
    // Every role comes from the Roles page, so a role an administrator adds is offered here straight away.
    const operationalRoles = [...new Set(accountRoles.map((role) => role.name))].sort();
    return Response.json({ success: true, employees:employees.map(employee=>({...employee,roleIds:accounts.find(account=>account.employeeId===employee.id)?.roleIds??[],primaryBranchId:branches.find(branch=>branch.name===employee.branch&&employee.branchIds.includes(branch.id))?.id??employee.branchIds[0]??"",hasAccount:accounts.some(account=>account.employeeId===employee.id)})), branches: branches.filter((branch) => branch.status === "active"), operationalRoles, accountRoles, canRegister: canManage, nextEmployeeId, canManage }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Employee directory error:", error);
    return Response.json({ success: false, message: "Unable to load employees. Check the Employees sheet setup." }, { status: 500 });
  }
}
export const POST = withEncoder(async (request: Request) => {
  if (!(await canManageEmployees())) return Response.json({ success: false, message: "You are not allowed to register employees." }, { status: 403 });
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid employee details.");
    const [branches, accountRoles] = await Promise.all([getBranches(), getActiveAccountRoles()]);
    const validRoles = [...new Set(accountRoles.map((role) => role.name))];
    const employee = await registerEmployee(body, validRoles, branches.filter((branch) => branch.status === "active").map(({ id, name }) => ({ id, name })));
    // Every new employee gets a sign-in account straight away, with the default password.
    let account: { created: boolean; reason?: string; defaultPassword?: string };
    try {
      // HR and IT may register anyone, but an account with administrator-level roles needs an administrator.
      const denied = await guardAccountChange({ roleIds: accountRoleIdsFor(employee.roles, accountRoles) });
      if (denied) return Response.json({ success: true, employee, account: { created: false, reason: `The employee was registered. ${denied} Ask an administrator to create this account.` } }, { status: 201 });
      const result = await createDefaultAccount(employee);
      account = result.created ? { created: true, defaultPassword: DEFAULT_PASSWORD } : { created: false, reason: result.reason };
    } catch (error) {
      account = { created: false, reason: `The employee was registered, but the account could not be created: ${error instanceof Error ? error.message : "unknown error"}. Create it in User Accounts.` };
    }
    return Response.json({ success: true, employee, account }, { status: 201 });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to register employee." }, { status: 400 }); }
});

export const PATCH = withEncoder(async (request: Request) => {
  if (!(await canManageEmployees())) return Response.json({ success: false, message: "You are not allowed to update employees." }, { status: 403 });
  try {
    const body = await request.json();
    const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
    const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
    if (typeof body.name === "string") {
      const [branches, accountRoles] = await Promise.all([getBranches(), getActiveAccountRoles()]);
      const validRoles = [...new Set(accountRoles.map((role) => role.name))];
      return Response.json({ success: true, employee: await updateEmployee(employeeId, body, validRoles, branches.filter((branch) => branch.status === "active").map(({ id, name }) => ({ id, name }))) });
    }
    return Response.json({ success: true, employee: await updateEmployeeStatus(employeeId, status) });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to update employee." }, { status: 400 }); }
});

export const DELETE = withEncoder(async (request: Request) => {
  if (!(await canManageEmployees())) return Response.json({ success: false, message: "You are not allowed to delete employees." }, { status: 403 });
  try {
    const body = await request.json();
    const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
    return Response.json({ success: true, employee: await deleteEmployee(employeeId) });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to delete employee." }, { status: 400 }); }
});
