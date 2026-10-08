import { withEncoder } from "@/lib/encoder-context";
import { canTransferMembers, employeeAccounts, transferCandidates, transferEmployeeAccounts, transferEnrollment } from "@/lib/member-transfer";

// ?enrollmentId= / { enrollmentId }: one account. ?employeeId= / { fromEmployeeId, enrollmentIds }: several of one employee's accounts at once.

export async function GET(request: Request) {
  if (!(await canTransferMembers())) return Response.json({ success: false, message: "Only Administrators and HR Officers can transfer members." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("employeeId")) return Response.json({ success: true, ...(await employeeAccounts(params.get("employeeId") ?? "")) }, { headers: { "Cache-Control": "private, no-store" } });
    const { enrollment, candidates } = await transferCandidates(params.get("enrollmentId") ?? "");
    return Response.json({ success: true, branch: enrollment.branch, currentMas: enrollment.mas, candidates });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load employees." }, { status: 400 }); }
}

export const POST = withEncoder(async (request: Request) => {
  if (!(await canTransferMembers())) return Response.json({ success: false, message: "Only Administrators and HR Officers can transfer members." }, { status: 403 });
  try {
    const body = await request.json();
    if (body.fromEmployeeId) {
      const ids = Array.isArray(body.enrollmentIds) ? body.enrollmentIds.map(String) : [];
      return Response.json({ success: true, result: await transferEmployeeAccounts({ fromEmployeeId: String(body.fromEmployeeId), enrollmentIds: ids, toEmployeeId: String(body.toEmployeeId ?? ""), reason: String(body.reason ?? "") }) });
    }
    return Response.json({ success: true, transfer: await transferEnrollment({ enrollmentId: String(body.enrollmentId ?? ""), toEmployeeId: String(body.toEmployeeId ?? ""), reason: String(body.reason ?? "") }) });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to transfer the member." }, { status: 400 }); }
});
