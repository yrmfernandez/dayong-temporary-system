import { withEncoder } from "@/lib/encoder-context";
import { canTransferMembers, transferCandidates, transferEnrollment } from "@/lib/member-transfer";

export async function GET(request: Request) {
  if (!(await canTransferMembers())) return Response.json({ success: false, message: "Only Administrators and HR Officers can transfer members." }, { status: 403 });
  try {
    const { enrollment, candidates } = await transferCandidates(new URL(request.url).searchParams.get("enrollmentId") ?? "");
    return Response.json({ success: true, branch: enrollment.branch, currentMas: enrollment.mas, candidates });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load employees." }, { status: 400 }); }
}

export const POST = withEncoder(async (request: Request) => {
  if (!(await canTransferMembers())) return Response.json({ success: false, message: "Only Administrators and HR Officers can transfer members." }, { status: 403 });
  try {
    const body = await request.json();
    return Response.json({ success: true, transfer: await transferEnrollment({ enrollmentId: String(body.enrollmentId ?? ""), toEmployeeId: String(body.toEmployeeId ?? ""), reason: String(body.reason ?? "") }) });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to transfer the member." }, { status: 400 }); }
});
