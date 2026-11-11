import { refuseOnDayOff } from "@/lib/day-off";
import { canAccessPath } from "@/lib/access-control";
import { userWithPageAccess } from "@/lib/auth-server";
import { AlreadyClearedError } from "@/lib/clearing";
import { withEncoder } from "@/lib/encoder-context";
import { listCollectionsForReview, listMyCollectionSubmissions, markCollectionSubmissionRemitted, markRejectionsSeen, myCollectionAccounts, myCollectionDraft, rejectCollectionSubmission, saveCollectionDraft, submitCollections } from "@/lib/collection-submissions";

const noStore = { "Cache-Control": "private, no-store" };
const failure = (error: unknown, fallback: string, status = 400) => Response.json({ success: false, message: error instanceof Error ? error.message : fallback }, { status });
const noAccess = (page: string) => Response.json({ success: false, message: `You do not have access to ${page}.` }, { status: 403 });

/**
 * MAS Collections submissions (lib/collection-submissions.ts).
 * GET ?view=mine: the MAS's branches, their own accounts and their submissions (Submit Collections page); a Collector
 *   adds &collectedBy=Collector for the members assigned to them, &mas=<employee ID> for that person's members instead.
 * GET ?view=review: submissions waiting in the clerk's branches (Collections → Submitted by MAS).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const view = params.get("view");
  if (view === "review") {
    const user = await userWithPageAccess("/collections");
    if (!user) return noAccess("Collections");
    try { return Response.json({ success: true, submissions: await listCollectionsForReview(user) }, { headers: noStore }); }
    catch (error) { return failure(error, "Unable to load MAS submissions.", 500); }
  }
  const user = await userWithPageAccess("/mas-collections");
  if (!user) return noAccess("Submit Collections");
  try {
    const [mine, submissions, draft] = await Promise.all([myCollectionAccounts(user, { collectedBy: params.get("collectedBy") ?? "", memberMasEmployeeId: params.get("mas") ?? "" }), listMyCollectionSubmissions(user), myCollectionDraft(user)]);
    return Response.json({ success: true, ...mine, submissions, draft }, { headers: noStore });
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
    const members = (count: number) => `${count} member${count === 1 ? "" : "s"}`;
    const assigned = result.collectedBy === "Collector" && !result.memberMas;
    const whose = result.collectedBy === "Collector" ? ` ${assigned ? "Your assigned members" : `Members of ${result.memberMas}`}, collected by you as Collector${result.dto ? ", DTO: no incentive, remit the whole amount" : ""}.` : "";
    const message = (result.batches.length === 1
      ? `${members(result.entryCount)} submitted to the ${result.batches[0].branch} clerk.`
      : `Submitted as ${result.batches.length} batches, one per ${assigned ? "branch and MAS" : "branch"}: ${result.batches.map((batch) => `${assigned ? `${batch.branch}, ${batch.memberMas}` : batch.branch} (${members(batch.entryCount)})`).join("; ")}. Remit each at its branch.`) + whose;
    return Response.json({ success: true, ...result, message }, { status: 201 });
  } catch (error) { return failure(error, "Unable to submit the collections."); }
});

/** The batch being filled, saved as it changes; what is left of it after midnight is sent automatically. */
export const PUT = withEncoder(async (request: Request) => {
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const user = await userWithPageAccess("/mas-collections");
  if (!user) return noAccess("Submit Collections");
  try {
    await saveCollectionDraft(user, await request.json());
    return Response.json({ success: true });
  } catch (error) { return failure(error, "Unable to save the batch."); }
});

/**
 * The MAS: { action: "seen" } when their rejected batches came on screen.
 * The clerk: { action: "remit", id, handover? } marks a batch remitted now (a Clearing is recorded; 409 ALREADY_CLEARED
 * when the MAS was already cleared today, to ask whether it is the same cash); { id, reason } rejects one.
 */
export const PATCH = withEncoder(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  if (body.action === "seen") {
    const mas = await userWithPageAccess("/mas-collections");
    if (!mas) return noAccess("Submit Collections");
    try { await markRejectionsSeen(mas); return Response.json({ success: true }); }
    catch (error) { return failure(error, "Unable to update the submissions."); }
  }
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const user = await userWithPageAccess("/collections");
  if (!user) return noAccess("Collections");
  try {
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

