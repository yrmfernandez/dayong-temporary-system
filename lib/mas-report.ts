import { isMasFamilyRole, isMasOfficerRole, masReportSeesEveryBranch } from "@/lib/access-control";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { masReportRows } from "@/lib/mas-report-rows";
import { getEntriesForRange } from "@/lib/todays-entries";

/**
 * MAS Report (owner, November 16, 2026): what each MAS of a branch sold and collected in a period, for the branch's
 * MAS-Officer, in the paper report's layout (lib/mas-report-rows.ts). Entries count by the date they were encoded, as
 * in the clerk's report, so the two agree.
 *
 * A MAS-Officer sees only the branches where they are officer (Employees → Duty in each branch → Officer). Anyone else
 * who can open the page (Administrators, executives, Finance, HR, IT, or a role given the page in Roles) sees every
 * active branch.
 */

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The branches the user may report on, by name, sorted. */
export async function reportBranches(user: { employeeId: string; roleNames: string[] }) {
  const [branches, employees] = await Promise.all([getBranches(), getEmployees()]);
  const active = branches.filter((branch) => branch.status === "active");
  if (masReportSeesEveryBranch(user.roleNames)) return active.map((branch) => branch.name).sort();
  const me = employees.find((employee) => employee.id === user.employeeId);
  const mine = new Set(me?.officerBranchIds ?? []);
  return active.filter((branch) => mine.has(branch.id)).map((branch) => branch.name).sort();
}

export async function buildMasReport({ from, to, branch }: { from: string; to: string; branch: string }) {
  const [branches, employees, { entries }] = await Promise.all([
    getBranches(), getEmployees(),
    getEntriesForRange(from, to, "encoded", { branches: [branch] }),
  ]);
  const branchId = branches.find((item) => same(item.name, branch))?.id ?? "";
  // The MAS of the branch: active employees holding MAS or MAS-Officer with the branch ticked as MAS.
  const staff = employees
    .filter((employee) => employee.status === "active" && employee.roles.some(isMasFamilyRole) && employee.masBranchIds.includes(branchId))
    .map((employee) => ({ employeeId: employee.id, name: employee.name }));
  // The branch's officer(s): active MAS-Officers with the branch ticked as officer, for the report's Officer's name.
  const officers = employees.filter((employee) => employee.status === "active" && employee.roles.some(isMasOfficerRole) && employee.officerBranchIds.includes(branchId)).map((employee) => employee.name);
  const inBranch = entries.filter((entry) => same(entry.branch, branch));
  return { branch, from, to, officers, ...masReportRows(inBranch, staff), entryCount: inBranch.length };
}
