import { userWithPageAccess } from "@/lib/auth-server";
import { refuseOnDayOff } from "@/lib/day-off";
import { approveDropout, listDropouts, rejectDropout, requestDropout, searchDropoutMembers } from "@/lib/dropouts";
import { withEncoder } from "@/lib/encoder-context";
import { canTransferMembers } from "@/lib/member-transfer";

const noStore = { "Cache-Control": "private, no-store" };
const failure = (error: unknown, fallback: string, status = 400) => Response.json({ success: false, message: error instanceof Error ? error.message : fallback }, { status });
const noAccess = () => Response.json({ success: false, message: "You do not have access to Dropouts." }, { status: 403 });

/**
 * Dropouts (lib/dropouts.ts). GET ?q= searches members with an active account in the user's branches; GET without q
 * lists the requests: the user's branches, or every branch for an approver (Administrators, HR Officers and IT, who
 * deactivate accounts on Members), with `canApprove`.
 */
export async function GET(request: Request) {
  const user = await userWithPageAccess("/dropouts");
  if (!user) return noAccess();
  const q = new URL(request.url).searchParams.get("q");
  try {
    if (q !== null) return Response.json({ success: true, members: await searchDropoutMembers(user, q) }, { headers: noStore });
    const canApprove = await canTransferMembers();
    return Response.json({ success: true, canApprove, requests: await listDropouts(user, canApprove ? "review" : "mine") }, { headers: noStore });
  } catch (error) { return failure(error, "Unable to load dropouts.", 500); }
}

/** The clerk asks for a dropout: { memberId, enrollmentIds, reasonType, reason, diedOn? }. */
export const POST = withEncoder(async (request: Request) => {
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const user = await userWithPageAccess("/dropouts");
  if (!user) return noAccess();
  try {
    const result = await requestDropout(user, await request.json());
    return Response.json({ success: true, ...result, message: `Dropout request ${result.id} sent for approval: ${result.count} program(s) of ${result.memberNumber}. Nothing changes until it is approved.` }, { status: 201 });
  } catch (error) { return failure(error, "Unable to send the dropout request."); }
});

/** An approver decides: { id, action: "approve" } or { id, action: "reject", note }. */
export const PATCH = withEncoder(async (request: Request) => {
  const user = await userWithPageAccess("/dropouts");
  if (!user) return noAccess();
  if (!(await canTransferMembers())) return Response.json({ success: false, message: "Only Administrators, HR Officers and IT approve dropouts." }, { status: 403 });
  try {
    const body = await request.json();
    if (body.action === "approve") {
      const result = await approveDropout(String(body.id ?? ""));
      return Response.json({ success: true, ...result, message: `Approved: ${result.memberNumber}'s program(s) are deactivated from today.${result.notes.length ? ` ${result.notes.join(" ")}` : ""}` });
    }
    const result = await rejectDropout(String(body.id ?? ""), String(body.note ?? ""));
    return Response.json({ success: true, ...result, message: "Rejected. The clerk sees your note." });
  } catch (error) { return failure(error, "Unable to decide the dropout request."); }
});
