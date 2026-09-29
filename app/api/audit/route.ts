import { canAccessPath } from "@/lib/access-control";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { AUDIT_RESULTS, decideDailyAudit, getDailyAudits, saveDailyAudit } from "@/lib/daily-audit";
import { withEncoder } from "@/lib/encoder-context";

// HR Officers, Finance, and Administrators prepare and edit Daily Audits; only Administrators approve or reopen them.
async function access() {
  const user = await getSessionUser();
  if (!user) return { user: null, canView: false, canApprove: false };
  return { user, canView: canAccessPath(user, "/audit"), canApprove: await canManageUsers() };
}

export async function GET(request: Request) {
  const { user, canView, canApprove } = await access();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  if (!canView) return Response.json({ success: false, message: "You do not have access to Daily Audit." }, { status: 403 });
  try {
    const date = new URL(request.url).searchParams.get("date") ?? "";
    return Response.json({ success: true, date, audits: await getDailyAudits(date), results: AUDIT_RESULTS, canApprove }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load audits." }, { status: 400 }); }
}

export const POST = withEncoder(async (request: Request) => {
  const { canView } = await access();
  if (!canView) return Response.json({ success: false, message: "You do not have access to Daily Audit." }, { status: 403 });
  try {
    const body = await request.json();
    return Response.json({ success: true, audit: await saveDailyAudit({ date: String(body.date ?? ""), employeeId: String(body.employeeId ?? ""), findings: String(body.findings ?? ""), result: String(body.result ?? "") }) });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save the audit." }, { status: 400 }); }
});

export const PATCH = withEncoder(async (request: Request) => {
  const { canApprove } = await access();
  if (!canApprove) return Response.json({ success: false, message: "Only an Administrator can approve or reopen an audit." }, { status: 403 });
  try {
    const body = await request.json();
    const decision = body.decision === "reopen" ? "reopen" : body.decision === "approve" ? "approve" : null;
    if (!decision) throw new Error("Choose approve or reopen.");
    return Response.json({ success: true, audit: await decideDailyAudit({ date: String(body.date ?? ""), employeeId: String(body.employeeId ?? ""), decision, reason: String(body.reason ?? "") }) });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to update the audit." }, { status: 400 }); }
});
