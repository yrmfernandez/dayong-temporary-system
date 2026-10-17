import { withEncoder } from "@/lib/encoder-context";
import { branchChangeOptions, canTransferMembers, changeEnrollmentsBranch, employeeAccounts, employeeBranchOptions, transferCandidates, transferEmployeeAccounts, transferEnrollment } from "@/lib/member-transfer";

// ?enrollmentId= / { enrollmentId }: one account. ?employeeId= / { fromEmployeeId, enrollmentIds }: several of one employee's accounts at once.
// &branches=1 / { mode: "branch", enrollmentIds, branch }: accounts to another branch, same MAS (October 17, 2026).

export async function GET(request: Request) {
  if (!(await canTransferMembers())) return Response.json({ success: false, message: "Only Administrators, HR Officers and IT can transfer members." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const withBranches = Boolean(params.get("branches"));
    if (params.get("employeeId")) {
      const employeeId = params.get("employeeId") ?? "";
      const [accounts, branches] = await Promise.all([employeeAccounts(employeeId), withBranches ? employeeBranchOptions(employeeId) : Promise.resolve({})]);
      return Response.json({ success: true, ...accounts, ...branches }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (withBranches) { const { enrollment, masBranches, branches } = await branchChangeOptions(params.get("enrollmentId") ?? ""); return Response.json({ success: true, branch: enrollment.branch, currentMas: enrollment.mas, masBranches, branches }); }
    const { enrollment, candidates } = await transferCandidates(params.get("enrollmentId") ?? "");
    return Response.json({ success: true, branch: enrollment.branch, currentMas: enrollment.mas, candidates });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load employees." }, { status: 400 }); }
}

export const POST = withEncoder(async (request: Request) => {
  if (!(await canTransferMembers())) return Response.json({ success: false, message: "Only Administrators, HR Officers and IT can transfer members." }, { status: 403 });
  try {
    const body = await request.json();
    const ids = Array.isArray(body.enrollmentIds) ? body.enrollmentIds.map(String) : [];
    if (body.mode === "branch") return Response.json({ success: true, change: await changeEnrollmentsBranch({ enrollmentIds: body.enrollmentId ? [String(body.enrollmentId)] : ids, branch: String(body.branch ?? ""), reason: String(body.reason ?? "") }) });
    // Accounts outside the new MAS's branches: "keep" their branch (the MAS is assigned to it) or "move" to `moveTo`.
    const branchChoice = { branchMode: String(body.branchMode ?? ""), moveTo: String(body.moveTo ?? "") };
    if (body.fromEmployeeId) {
      return Response.json({ success: true, result: await transferEmployeeAccounts({ fromEmployeeId: String(body.fromEmployeeId), enrollmentIds: ids, toEmployeeId: String(body.toEmployeeId ?? ""), reason: String(body.reason ?? ""), ...branchChoice }) });
    }
    return Response.json({ success: true, transfer: await transferEnrollment({ enrollmentId: String(body.enrollmentId ?? ""), toEmployeeId: String(body.toEmployeeId ?? ""), reason: String(body.reason ?? ""), ...branchChoice }) });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to transfer the member." }, { status: 400 }); }
});
