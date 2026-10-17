import { setAccountActive } from "@/lib/account-deactivation";
import { withEncoder } from "@/lib/encoder-context";
import { canTransferMembers } from "@/lib/member-transfer";

/**
 * Deactivate or reactivate one member's program (lib/account-deactivation.ts): { enrollmentId, active, reason }.
 * Administrators, HR Officers and IT, the same people who transfer members.
 */
export const POST = withEncoder(async (request: Request) => {
  if (!(await canTransferMembers())) return Response.json({ success: false, message: "Only Administrators, HR Officers and IT can deactivate or reactivate a member's program." }, { status: 403 });
  try {
    const body = await request.json();
    const result = await setAccountActive({ enrollmentId: String(body.enrollmentId ?? ""), active: body.active === true, reason: String(body.reason ?? "") });
    return Response.json({ success: true, ...result });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to change the program." }, { status: 400 });
  }
});
