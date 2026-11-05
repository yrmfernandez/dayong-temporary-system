"use client";

type Branch = { id: string; name: string };
type Duties = { notClerkBranchIds: string[]; notMasBranchIds: string[] };

const toggled = (list: string[], id: string) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

/**
 * What an Entry Clerk does in each of their branches (owner, November 5, 2026): one can be assigned to a branch only
 * because they have members there, and must then not see what is submitted to it. Shown for an Entry Clerk with two or
 * more branches; nobody else has anything to separate. Rules in lib/employees.ts.
 */
export function BranchDuties({ roles, branches, branchIds, duties, onChange, className = "" }: { roles: string[]; branches: Branch[]; branchIds: string[]; duties: Duties; onChange: (duties: Duties) => void; className?: string }) {
  const assigned = branches.filter((branch) => branchIds.includes(branch.id));
  if (!roles.some((role) => role.trim().toLowerCase() === "entry clerk") || assigned.length < 2) return null;
  return (
    <fieldset className={`space-y-2 rounded-md border p-3 ${className}`}>
      <legend className="px-1 text-sm">Duty in each branch</legend>
      <p className="text-xs text-muted-foreground"><strong>Entry Clerk:</strong> sees and saves what is submitted to that branch, and reports on it. <strong>MAS:</strong> can submit Collections and New Sales there. Untick Entry Clerk where they only have members.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th scope="col" className="p-2 text-left">Branch</th><th scope="col" className="p-2 text-center">Entry Clerk</th><th scope="col" className="p-2 text-center">MAS</th></tr></thead>
          <tbody>{assigned.map((branch) => <tr key={branch.id} className="border-t">
            <td className="p-2">{branch.name}</td>
            <td className="p-2 text-center"><input type="checkbox" aria-label={`Entry Clerk in ${branch.name}`} checked={!duties.notClerkBranchIds.includes(branch.id)} onChange={() => onChange({ ...duties, notClerkBranchIds: toggled(duties.notClerkBranchIds, branch.id) })} /></td>
            <td className="p-2 text-center"><input type="checkbox" aria-label={`MAS in ${branch.name}`} checked={!duties.notMasBranchIds.includes(branch.id)} onChange={() => onChange({ ...duties, notMasBranchIds: toggled(duties.notMasBranchIds, branch.id) })} /></td>
          </tr>)}</tbody>
        </table>
      </div>
    </fieldset>
  );
}
