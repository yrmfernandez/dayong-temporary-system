import { userWithPageAccess } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { listForReview, listMySubmissions, masProfile, returnSubmission, submitSales } from "@/lib/sale-submissions";

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

/** The MAS submits sale cards (new, or an edit of one still waiting or returned). */
export const POST = withEncoder(async (request: Request) => {
  const user = await userWithPageAccess("/mas-sales");
  if (!user) return Response.json({ success: false, message: "You do not have access to Submit New Sales." }, { status: 403 });
  try {
    const result = await submitSales(user, await request.json());
    return Response.json({ success: true, ...result, message: `${result.saleCount} sale${result.saleCount === 1 ? "" : "s"} submitted to the branch clerk.` }, { status: 201 });
  } catch (error) { return failure(error, "Unable to submit the sales."); }
});

/** The clerk returns a submission to the MAS with what to fix. */
export const PATCH = withEncoder(async (request: Request) => {
  const user = await userWithPageAccess("/new-sales");
  if (!user) return Response.json({ success: false, message: "You do not have access to New Sales." }, { status: 403 });
  try {
    const body = await request.json();
    return Response.json({ success: true, ...await returnSubmission(user, String(body.id ?? ""), String(body.reason ?? "")), message: "Returned to the MAS." });
  } catch (error) { return failure(error, "Unable to return the submission."); }
});
