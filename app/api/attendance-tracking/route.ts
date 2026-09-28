import { getSessionUser } from "@/lib/auth-server";
import { getAttendanceRecordsForRange } from "@/lib/attendance-data";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  const roles = user.roleNames.map((role) => role.trim().toLowerCase());
  const allowed = roles.some((role) => ["administrator", "admin", "hr officer", "hr", "finance"].includes(role)) || user.permissions.manageAttendance || user.permissions.viewAttendanceReports;
  if (!allowed) return Response.json({ success: false, message: "Attendance tracking access is required." }, { status: 403 });

  try {
    const params = new URL(request.url).searchParams;
    const from = params.get("from")?.trim() ?? "";
    const to = params.get("to")?.trim() ?? "";
    const employeeId = params.get("employeeId")?.trim() ?? "";
    if (!validDate(from) || !validDate(to) || from > to) throw new Error("Choose a valid attendance date range.");
    const rangeDays = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000;
    if (rangeDays > 366) throw new Error("Attendance tracking is limited to 367 days per view.");

    const [employees, branches, records] = await Promise.all([getEmployees(), getBranches(), getAttendanceRecordsForRange(from, to)]);
    const branchNames = new Map(branches.map((branch) => [branch.id, `${branch.name}${branch.territory ? ` · ${branch.territory}` : ""}`]));
    const availableEmployees = employees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      roles: employee.roles,
      status: employee.status,
      branches: employee.branchIds.map((id) => branchNames.get(id) ?? id),
    })).sort((first, second) => first.name.localeCompare(second.name));
    if (employeeId && !availableEmployees.some((employee) => employee.id === employeeId)) throw new Error("Select a registered employee.");
    const filtered = employeeId ? records.filter((record) => record.employeeId === employeeId) : records;
    return Response.json({ success: true, from, to, employeeId, employees: availableEmployees, records: filtered }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load attendance tracking." }, { status: 400 });
  }
}
