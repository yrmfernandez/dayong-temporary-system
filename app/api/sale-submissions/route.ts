import { refuseOnDayOff } from "@/lib/day-off";
import { canAccessPath } from "@/lib/access-control";
import { userWithPageAccess } from "@/lib/auth-server";
import { AlreadyClearedError } from "@/lib/clearing";
import { withEncoder } from "@/lib/encoder-context";
import { listForReview, listMySubmissions, markSaleSubmissionRemitted, masProfile, rejectSaleSubmission, submitSales } from "@/lib/sale-submissions";

const noStore = { "Cache-Control": "private, no-store" };
const failure = (error: unknown, fallback: string, status = 400) => Response.json({ success: false, message: error instanceof Error ? error.message : fallback }, { status });

/**
 * MAS New Sales submissions (lib/sale-submissions.ts).
 * GET ?view=mine: the MAS's branches and submissions (Submit New Sales page).
 * GET ?view=review: submissions waiting in the clerk's branches (New Sales → Submitted by MAS).
 */
export async function GET(request: Request) {
  const view = new URL(request.url).searchParams.get("view");
  if (view === "review") {
    const user = await userWithPageAccess("/new-sales");
    if (!user) return Response.json({ success: false, message: "You do not have access to New Sales." }, { status: 403 });
    try { return Response.json({ success: true, submissions: await listForReview(user) }, { headers: noStore }); }
    catch (error) { return failure(error, "Unable to load MAS submissions.", 500); }
  }
  const user = await userWithPageAccess("/mas-sales");
  if (!user) return Response.json({ success: false, message: "You do not have access to Submit New Sales." }, { status: 403 });
  try {
    const [profile, submissions] = await Promise.all([masProfile(user), listMySubmissions(user)]);
    return Response.json({ success: true, profile, submissions }, { headers: noStore });
  } catch (error) { return failure(error, "Unable to load your submissions."); }
}

/** The MAS submits sale cards (new, or one returned before November 3, 2026). Once submitted only the clerk changes them. */
export const POST = withEncoder(async (request: Request) => {
  // Day Off locks the day's entries (lib/day-off.ts).
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const user = await userWithPageAccess("/mas-sales");
  if (!user) return Response.json({ success: false, message: "You do not have access to Submit New Sales." }, { status: 403 });
  try {
    const result = await submitSales(user, await request.json());
    return Response.json({ success: true, ...result, message: `${result.saleCount} sale${result.saleCount === 1 ? "" : "s"} submitted to the branch clerk.` }, { status: 201 });
  } catch (error) { return failure(error, "Unable to submit the sales."); }
});

/**
 * The clerk, as for collections: { action: "remit", id, handover? } marks a batch remitted now (a Clearing is recorded;
 * 409 ALREADY_CLEARED when the MAS was already cleared today, to ask whether it is the same cash); { id, reason } rejects one.
 */
export const PATCH = withEncoder(async (request: Request) => {
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const user = await userWithPageAccess("/new-sales");
  if (!user) return Response.json({ success: false, message: "You do not have access to New Sales." }, { status: 403 });
  try {
    const body = await request.json();
    if (body.action === "remit") {
      if (!canAccessPath(user, "/clearing")) return Response.json({ success: false, message: "You do not have access to Clearing." }, { status: 403 });
      const handover = body.handover === "same" || body.handover === "new" ? body.handover : "";
      try {
        const done = await markSaleSubmissionRemitted(user, String(body.id ?? ""), handover);
        return Response.json({ success: true, ...done, message: `${done.mas}'s New Sales marked remitted at ${done.remittedAt.slice(11)}. The details can be typed later; this time decides the incentive.` });
      } catch (error) {
        if (error instanceof AlreadyClearedError) return Response.json({ success: false, code: error.code, message: error.message }, { status: 409 });
        throw error;
      }
    }
    return Response.json({ success: true, ...await rejectSaleSubmission(user, String(body.id ?? ""), String(body.reason ?? "")), message: "Rejected. The MAS sees the reason and can submit those sales again." });
  } catch (error) { return failure(error, "Unable to update the submission."); }
});
