import { userWithPageAccess } from "@/lib/auth-server";
import { memberStanding } from "@/lib/account-data";

/** Suspended or forfeited programs of an existing member, shown as a warning on New Sales before enrolling them again. */
export async function GET(request: Request) {
  if (!(await userWithPageAccess("/new-sales"))) return Response.json({ success: false, message: "You do not have access to New Sales." }, { status: 403 });
  const memberId = new URL(request.url).searchParams.get("memberId")?.trim() ?? "";
  if (!memberId) return Response.json({ success: false, message: "Choose a member." }, { status: 400 });
  try { return Response.json({ success: true, programs: await memberStanding(memberId) }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to check this member's accounts." }, { status: 500 }); }
}
