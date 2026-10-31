import { refuseOnDayOff } from "@/lib/day-off";
import { canAccessPath } from "@/lib/access-control";
import { userWithPageAccess } from "@/lib/auth-server";
import { AlreadyClearedError } from "@/lib/clearing";
import { withEncoder } from "@/lib/encoder-context";
import { listCollectionsForReview, listMyCollectionSubmissions, markCollectionSubmissionRemitted, myCollectionAccounts, rejectCollectionSubmission, submitCollections } from "@/lib/collection-submissions";

const noStore = { "Cache-Control": "private, no-store" };
const failure = (error: unknown, fallback: string, status = 400) => Response.json({ success: false, message: error instanceof Error ? error.message : fallback }, { status });
const noAccess = (page: string) => Response.json({ success: false, message: `You do not have access to ${page}.` }, { status: 403 });

/**
 * MAS Collections submissions (lib/collection-submissions.ts).
 * GET ?view=mine: the MAS's branches, their own accounts and their submissions (Submit Collections page).
 * GET ?view=review: submissions waiting in the clerk's branches (Collections → Submitted by MAS).
 */
export async function GET(request: Request) {
  const view = new URL(request.url).searchParams.get("view");
  if (view === "review") {
    const user = await userWithPageAccess("/collections");
    if (!user) return noAccess("Collections");
    try { return Response.json({ success: true, submissions: await listCollectionsForReview(user) }, { headers: noStore }); }
    catch (error) { return failure(error, "Unable to load MAS submissions.", 500); }
  }
  const user = await userWithPageAccess("/mas-collections");
  if (!user) return noAccess("Submit Collections");
  try {
    const [mine, submissions] = await Promise.all([myCollectionAccounts(user), listMyCollectionSubmissions(user)]);
    return Response.json({ success: true, ...mine, submissions }, { headers: noStore });
  } catch (error) { return failure(error, "Unable to load your members."); }
}

/** The MAS submits a new batch. Once submitted only the clerk changes it (lib/collection-submissions.ts). */
export const POST = withEncoder(async (request: Request) => {
  // Day Off locks the day's entries (lib/day-off.ts).
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const user = await userWithPageAccess("/mas-collections");
  if (!user) return noAccess("Submit Collections");
  try {
    const result = await submitCollections(user, await request.json());
    return Response.json({ success: true, ...result, message: `${result.entryCount} member${result.entryCount === 1 ? "" : "s"} submitted to the branch clerk.` }, { status: 201 });
  } catch (error) { return failure(error, "Unable to submit the collections."); }
});

/**
 * The clerk: { action: "remit", id, handover? } marks a batch remitted now (a Clearing is recorded; 409 ALREADY_CLEARED
 * when the MAS was already cleared today, to ask whether it is the same cash); { id, reason } rejects one.
 */
export const PATCH = withEncoder(async (request: Request) => {
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const user = await userWithPageAccess("/collections");
  if (!user) return noAccess("Collections");
  try {
    const body = await request.json();
    if (body.action === "remit") {
      if (!canAccessPath(user, "/clearing")) return noAccess("Clearing");
      const handover = body.handover === "same" || body.handover === "new" ? body.handover : "";
      try {
        const done = await markCollectionSubmissionRemitted(user, String(body.id ?? ""), handover);
        return Response.json({ success: true, ...done, message: `${done.mas}'s batch marked remitted at ${done.remittedAt.slice(11)}. The OR numbers can be typed later; this time decides the incentive.` });
      } catch (error) {
        if (error instanceof AlreadyClearedError) return Response.json({ success: false, code: error.code, message: error.message }, { status: 409 });
        throw error;
      }
    }
    return Response.json({ success: true, ...await rejectCollectionSubmission(user, String(body.id ?? ""), String(body.reason ?? "")), message: "Rejected. The MAS sees the reason and can submit those members again." });
  } catch (error) { return failure(error, "Unable to reject the submission."); }
});

