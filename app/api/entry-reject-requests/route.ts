import { canAccessPath } from "@/lib/access-control";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { refuseOnDayOff } from "@/lib/day-off";
import { withEncoder } from "@/lib/encoder-context";
import { acceptRejectRequest, declineRejectRequest, listRejectRequests, requestReject } from "@/lib/entry-reject-requests";

const noStore = { "Cache-Control": "private, no-store" };
const failure = (error: unknown, fallback: string, status = 400) => Response.json({ success: false, message: error instanceof Error ? error.message : fallback }, { status });

/**
 * Reject requests (lib/entry-reject-requests.ts). GET: the requests, for the approvers of Remittances. POST { entryIds,
 * reason } (a batch) or { entryId, reason }: an Entry Clerk asks for one of their batches to be rejected (My Entries). PATCH { id, action: "accept" } or
 * { id, action: "decline", note }: an approver decides.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/remittances") || !(await canManageUsers())) return failure(null, "Only the approvers of Remittances see reject requests.", 403);
  try { return Response.json({ success: true, requests: await listRejectRequests() }, { headers: noStore }); }
  catch (error) { return failure(error, "Unable to load the reject requests.", 500); }
}

export const POST = withEncoder(async (request: Request) => {
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/my-entries")) return failure(null, "You do not have access to My Entries.", 403);
  try {
    const result = await requestReject(user, await canManageUsers(), await request.json());
    return Response.json({ success: true, ...result, message: `Reject request ${result.id} sent for ${result.batch ? "batch " : ""}${result.entryId}. Nothing changes until an approver accepts it; then the batch comes back to you as Returned.` }, { status: 201 });
  } catch (error) { return failure(error, "Unable to send the reject request."); }
});

export const PATCH = withEncoder(async (request: Request) => {
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const user = await getSessionUser();
  if (!user || !(await canManageUsers())) return failure(null, "Only the approvers of Remittances decide reject requests.", 403);
  try {
    const body = await request.json();
    const id = String(body.id ?? "");
    if (body.action === "accept") {
      // The same own-slip rule as Remittances: an Administrator who is also an Entry Clerk may decide their own slip.
      const roles = user.roleNames.map((role) => role.trim().toLowerCase());
      const allowOwnDecision = roles.some((role) => role === "administrator" || role === "admin") && roles.includes("entry clerk");
      const result = await acceptRejectRequest(id, allowOwnDecision);
      const also = result.alsoAccepted.length ? ` Also accepted with it (same slip): ${result.alsoAccepted.join(", ")}.` : "";
      return Response.json({ success: true, ...result, message: result.alreadyReturned
        ? `Accepted: ${result.remittanceId} was already returned to the clerk.${also}`
        : `Accepted: ${result.remittanceId} is rejected and its batch is back with the clerk as Returned, with the reason.${also}` });
    }
    if (body.action !== "decline") throw new Error("Choose accept or decline.");
    const result = await declineRejectRequest(id, String(body.note ?? ""));
    return Response.json({ success: true, ...result, message: `Declined. ${result.entryId} stays waiting for approval; the clerk sees your note.` });
  } catch (error) { return failure(error, "Unable to decide the reject request."); }
});
