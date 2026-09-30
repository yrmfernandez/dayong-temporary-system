import { userWithPageAccess } from "@/lib/auth-server";
import { memberMam } from "@/lib/account-data";

/** The collapsible MAM on the Members page: one member's program accounts, month by month. */
export async function GET(request: Request) {
  if (!(await userWithPageAccess("/members", "/mam"))) return Response.json({ success: false, message: "You do not have access to member accounts." }, { status: 403 });
  const memberId = new URL(request.url).searchParams.get("memberId")?.trim() ?? "";
  if (!memberId) return Response.json({ success: false, message: "Choose a member." }, { status: 400 });
  try { return Response.json({ success: true, ...await memberMam(memberId) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load this member's MAM." }, { status: 500 }); }
}
