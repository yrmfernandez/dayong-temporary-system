import { userWithPageAccess } from "@/lib/auth-server";
import { ownMembersScope } from "@/lib/member-scope";
import { withEncoder } from "@/lib/encoder-context";
import { mamReport, syncAccountStatuses } from "@/lib/account-data";
import { monitoringMonths } from "@/lib/mam-report";
import { todayInManila } from "@/lib/account-rules";

export async function GET(request: Request) {
  const user = await userWithPageAccess("/mam");
  if (!user) return Response.json({ success: false, message: "You do not have access to MAM." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const from = params.get("from") || todayInManila().slice(0, 7);
  const to = params.get("to") || todayInManila().slice(0, 7);
  try { monitoringMonths(from, to); } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Invalid range." }, { status: 400 }); }
  // A MAS sees only their own members.
  try { return Response.json({ success: true, ...await mamReport(from, to, await ownMembersScope(user)) }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load MAM." }, { status: 500 }); }
}
export const POST = withEncoder(async () => {
  if (!(await userWithPageAccess("/mam"))) return Response.json({ success: false, message: "You do not have access to MAM." }, { status: 403 });
  try { await syncAccountStatuses(); return Response.json({ success: true, message: "Current account statuses synchronized." }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to refresh statuses." }, { status: 500 }); }
});
