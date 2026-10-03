import { userWithPageAccess } from "@/lib/auth-server";
import { ownMembersScope } from "@/lib/member-scope";
import { memberMam } from "@/lib/account-data";

/** The collapsible MAM on the Members page: one member's program accounts, month by month. */
export async function GET(request: Request) {
  const user = await userWithPageAccess("/members", "/mam");
  if (!user) return Response.json({ success: false, message: "You do not have access to member accounts." }, { status: 403 });
  const memberId = new URL(request.url).searchParams.get("memberId")?.trim() ?? "";
  if (!memberId) return Response.json({ success: false, message: "Choose a member." }, { status: 400 });
  // A MAS sees only the accounts they handle; another MAS's member shows nothing.
  try { return Response.json({ success: true, ...await memberMam(memberId, await ownMembersScope(user)) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load this member's MAM." }, { status: 500 }); }
}
