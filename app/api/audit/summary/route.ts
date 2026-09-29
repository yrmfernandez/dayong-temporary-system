import { canAccessPath } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { getAuditSummary } from "@/lib/daily-audit";

// The approved-audit summary is part of Daily Audit: HR Officers, Finance, and Administrators.
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  if (!canAccessPath(user, "/audit")) return Response.json({ success: false, message: "You do not have access to Daily Audit." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const summary = await getAuditSummary({ from: params.get("from") ?? "", to: params.get("to") ?? "", branch: params.get("branch") ?? "", employeeId: params.get("employeeId") ?? "" });
    return Response.json({ success: true, summary }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load the audit summary." }, { status: 400 }); }
}
