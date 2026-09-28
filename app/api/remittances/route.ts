import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { createCashRemittance, decideCashRemittance, getRemittanceDashboard } from "@/lib/remittance-workflow";
import { canAccessPath } from "@/lib/access-control";

export async function GET() {
  const user=await getSessionUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  if(!canAccessPath(user,"/remittances"))return Response.json({error:"You do not have access to Remittances."},{status:403});
  try {
    return Response.json(await getRemittanceDashboard());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load Remittances." }, { status: 500 });
  }
}

export const POST = withEncoder(async (request: Request) => {
  try {
    const user=await getSessionUser();
    if(!user||!canAccessPath(user,"/remittances"))return Response.json({error:"You do not have access to Remittances."},{status:403});
    const body = await request.json();
    const result = await createCashRemittance({
      collectionIds: Array.isArray(body.collectionIds) ? body.collectionIds : [],
      actualAmount: Number(body.actualAmount), fidelityAmount: Number(body.fidelityAmount ?? 0), remittanceDate: String(body.remittanceDate ?? ""),
      remarks: String(body.remarks ?? ""),
    });
    return Response.json({ success: true, remittance: result }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create Remittance." }, { status: 400 });
  }
});

export const PATCH = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !(await canManageUsers())) return Response.json({ error: "You are not allowed to approve Remittances." }, { status: 403 });
  try {
    const body = await request.json();
    if (!['approve', 'reject'].includes(body.decision)) throw new Error("Choose approve or reject.");
    const normalizedRoles = user.roleNames.map((role) => role.trim().toLowerCase());
    const allowOwnDecision = normalizedRoles.some((role) => role === "administrator" || role === "admin") && normalizedRoles.includes("entry clerk");
    const result = await decideCashRemittance(String(body.remittanceId ?? ""), body.decision, String(body.reason ?? ""), allowOwnDecision);
    return Response.json({ success: true, remittance: result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to decide Remittance." }, { status: 400 });
  }
});
