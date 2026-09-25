import { getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { mamReport, syncAccountStatuses } from "@/lib/account-data";
import { monitoringMonths } from "@/lib/mam-report";
import { todayInManila } from "@/lib/account-rules";

export async function GET(request: Request) {
  if (!(await getSessionUser())) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const from = params.get("from") || todayInManila().slice(0, 7);
  const to = params.get("to") || todayInManila().slice(0, 7);
  try { monitoringMonths(from, to); } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Invalid range." }, { status: 400 }); }
  try { return Response.json({ success: true, ...await mamReport(from, to) }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load MAM." }, { status: 500 }); }
}
export const POST = withEncoder(async () => {
  try { await syncAccountStatuses(); return Response.json({ success: true, message: "Current account statuses synchronized." }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to refresh statuses." }, { status: 500 }); }
});
