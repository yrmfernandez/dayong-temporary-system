import { getSessionUser } from "@/lib/auth-server";
import { canAccessPath } from "@/lib/access-control";
import { withEncoder } from "@/lib/encoder-context";
import {
  addPayrollAdjustment, approvePayrollRun, createPayrollRun, getPayrollOverview, getPayrollRun,
  payPayrollRun, recalculatePayrollRun, removePayrollAdjustment, savePayProfile, voidPayrollRun,
} from "@/lib/payroll";

const normalized = (roles: string[]) => roles.map((role) => role.trim().toLowerCase());
const isAdministrator = (roles: string[]) => roles.some((role) => role === "administrator" || role === "admin");
// Anyone who can open the Payroll page may review it; only Finance and Administrators run it.
const canManage = (roles: string[]) => isAdministrator(roles) || roles.includes("finance");

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  const roles = normalized(user.roleNames);
  if (!canAccessPath(user, "/payroll")) return Response.json({ success: false, message: "You do not have access to Payroll." }, { status: 403 });
  try {
    const runId = new URL(request.url).searchParams.get("runId");
    const body = runId ? await getPayrollRun(runId) : await getPayrollOverview();
    return Response.json({ success: true, canManage: canManage(roles), currentUserId: user.userId, isAdministrator: isAdministrator(roles), ...body }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load payroll." }, { status: 500 });
  }
}

export const POST = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  const roles = normalized(user?.roleNames ?? []);
  if (!user || !canManage(roles)) return Response.json({ success: false, message: "Finance or Administrator access is required to change payroll." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const runId = String(body.runId ?? "");
    switch (body.action) {
      case "saveProfile": return Response.json({ success: true, ...await savePayProfile(body) });
      case "create": return Response.json({ success: true, ...await createPayrollRun(body) }, { status: 201 });
      case "recalculate": return Response.json({ success: true, ...await recalculatePayrollRun(runId, body) });
      case "addAdjustment": return Response.json({ success: true, ...await addPayrollAdjustment(runId, body) }, { status: 201 });
      case "removeAdjustment": return Response.json({ success: true, ...await removePayrollAdjustment(runId, String(body.adjustmentId ?? "")) });
      case "approve": return Response.json({ success: true, ...await approvePayrollRun(runId, isAdministrator(roles)) });
      case "pay": return Response.json({ success: true, ...await payPayrollRun(runId, body) });
      case "void": return Response.json({ success: true, ...await voidPayrollRun(runId, String(body.reason ?? "")) });
      default: throw new Error("Unknown payroll action.");
    }
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to update payroll." }, { status: 400 });
  }
});
