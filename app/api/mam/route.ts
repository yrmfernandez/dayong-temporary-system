import { userWithPageAccess } from "@/lib/auth-server";
import { ownMembersScope } from "@/lib/member-scope";
import { withEncoder } from "@/lib/encoder-context";
import { mamReport, syncAccountStatuses } from "@/lib/account-data";
import { monitoringMonths } from "@/lib/mam-report";
import { todayInManila } from "@/lib/account-rules";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { listMembersInBranch } from "@/lib/member-records";

/**
 * MAM, chosen in order: branch, then a MAS or employee assigned to it, then a member. Only the chosen accounts are
 * loaded. `?options=1` gives the branches and employees; `?members=1&branch=&mas=` the members for the dropdown.
 * A MAS user sees only their own members, with or without a branch.
 */
export async function GET(request: Request) {
  const user = await userWithPageAccess("/mam");
  if (!user) return Response.json({ success: false, message: "You do not have access to MAM." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const value = (key: string) => (params.get(key) ?? "").trim();
  try {
    const onlyMas = await ownMembersScope(user);
    if (params.get("options") === "1") {
      const [branches, employees] = await Promise.all([getBranches(), getEmployees()]);
      return Response.json({
        success: true, ownMembersOnly: onlyMas !== null,
        branches: branches.filter((branch) => branch.status === "active").map((branch) => ({ id: branch.id, name: branch.name })),
        staff: onlyMas !== null ? [] : employees.filter((employee) => employee.status === "active").map((employee) => ({ employeeId: employee.id, fullName: employee.name, branchIds: employee.branchIds })),
      });
    }
    if (params.get("members") === "1") {
      return Response.json({ success: true, members: await listMembersInBranch(value("branch"), onlyMas ?? value("mas")) });
    }
    const from = value("from") || todayInManila().slice(0, 7);
    const to = value("to") || todayInManila().slice(0, 7);
    try { monitoringMonths(from, to); } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Invalid range." }, { status: 400 }); }
    // Everyone except a MAS chooses a branch first, so a report never loads every account in the company.
    if (onlyMas === null && !value("branch")) return Response.json({ success: false, needsBranch: true, message: "Choose a branch to load MAM." }, { status: 400 });
    return Response.json({ success: true, ...await mamReport(from, to, onlyMas, { branch: value("branch"), mas: value("mas"), memberId: value("member") }) });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load MAM." }, { status: 500 }); }
}
export const POST = withEncoder(async () => {
  if (!(await userWithPageAccess("/mam"))) return Response.json({ success: false, message: "You do not have access to MAM." }, { status: 403 });
  try { await syncAccountStatuses(); return Response.json({ success: true, message: "Current account statuses synchronized." }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to refresh statuses." }, { status: 500 }); }
});
