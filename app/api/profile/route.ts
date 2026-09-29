import { getSessionUser } from "@/lib/auth-server";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { loadUsers } from "@/lib/users-sheet";

// The signed-in person's own profile: their employee record, branches, and login account. Never includes the password hash.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  try {
    const [employees, branches, { users }] = await Promise.all([getEmployees(), getBranches(), loadUsers()]);
    const account = users.find((item) => item.id === user.userId);
    // The Users row is authoritative for which employee a login belongs to (a session may predate an ID change).
    const signInId = account?.employeeId || user.employeeId;
    const byEmployeeId = employees.find((item) => item.id === signInId);
    // If the IDs disagree, fall back to the one employee with the same name so the profile still shows, and flag it.
    const sameName = byEmployeeId ? [] : employees.filter((item) => item.name.trim().toLowerCase() === (account?.fullName || user.name).trim().toLowerCase());
    const employee = byEmployeeId ?? (sameName.length === 1 ? sameName[0] : undefined);
    const byId = new Map(branches.map((branch) => [branch.id, branch]));
    // Branch assignments are the source of truth; older records may only have the primary branch column.
    const assigned = employee ? employee.branchIds.map((id) => ({ id, name: byId.get(id)?.name ?? id, territory: byId.get(id)?.territory ?? "" })) : [];
    const primary = employee && !assigned.length && employee.branch ? branches.find((branch) => branch.name === employee.branch) : undefined;
    return Response.json({
      success: true,
      profile: {
        name: employee?.name || user.name,
        employeeId: signInId,
        userId: user.userId,
        accountRoles: user.roleNames.length ? user.roleNames : user.roles,
        permissions: user.permissions,
        accountStatus: account?.status || "active",
        accountCreatedAt: account?.createdAt ?? "",
        // Set when the sign-in's Employee ID does not match an employee record (shown so an administrator can fix it).
        employeeLinkIssue: !byEmployeeId ? (employee ? `Your sign-in Employee ID ${signInId} does not match your employee record ${employee.id}.` : `No employee record has the Employee ID ${signInId}.`) : "",
        // Null when the login has no matching employee record (e.g. a system account).
        employee: employee ? {
          id: employee.id,
          operationalRoles: employee.roles,
          employmentStatus: employee.status,
          contact: employee.contact,
          email: employee.email,
          dateHired: employee.dateHired,
          // Primary branch (Employees column C) first, then the other assignments.
          branches: assigned.length ? [...assigned].sort((a, b) => Number(b.name === employee.branch) - Number(a.name === employee.branch)) : primary ? [{ id: primary.id, name: primary.name, territory: primary.territory }] : employee.branch ? [{ id: "", name: employee.branch, territory: "" }] : [],
          primaryBranch: employee.branch || assigned[0]?.name || "",
        } : null,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load your profile." }, { status: 500 });
  }
}
