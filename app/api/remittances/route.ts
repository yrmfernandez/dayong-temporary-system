import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { createCashRemittance, decideCashRemittance, getRemittanceDashboard } from "@/lib/remittance-workflow";
import { canAccessPath } from "@/lib/access-control";

/**
 * Remittances for the signed-in user: an approver sees everyone's (optionally one Entry Clerk's, ?clerk=), anyone else
 * only what they encoded.
 */
export async function GET(request?: Request) {
  const user=await getSessionUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  if(!canAccessPath(user,"/remittances"))return Response.json({error:"You do not have access to Remittances."},{status:403});
  try {
    const canApprove = await canManageUsers();
    const clerk = canApprove ? (request ? new URL(request.url).searchParams.get("clerk")?.trim() ?? "" : "") : user.employeeId;
    return Response.json({ ...(await getRemittanceDashboard(clerk)), canApprove, clerk });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load Remittances." }, { status: 500 });
  }
}

export const POST = withEncoder(async (request: Request) => {
  try {
    const user=await getSessionUser();
    if(!user||!canAccessPath(user,"/remittances"))return Response.json({error:"You do not have access to Remittances."},{status:403});
    const body = await request.json();
    // Entries reach approval on their own once their receipt photos are attached; approving cash at once is for approvers.
    if (body.cashConfirmed === true && !(await canManageUsers())) return Response.json({ error: "Only an approver can approve a remittance." }, { status: 403 });
    const result = await createCashRemittance({
      collectionIds: Array.isArray(body.collectionIds) ? body.collectionIds : [],
      actualAmount: Number(body.actualAmount), fidelityAmount: Number(body.fidelityAmount ?? 0), remittanceDate: String(body.remittanceDate ?? ""), remittanceTime: String(body.remittanceTime ?? ""), cashCount: String(body.cashCount ?? ""),
      remarks: String(body.remarks ?? ""), cashConfirmed: body.cashConfirmed === true,
    });
    return Response.json({ success: true, remittance: result }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create Remittance." }, { status: 400 });
  }
});

/** Approve or reject one or several slips (remittanceIds), with one reason for all where a reason is needed. */
export const PATCH = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !(await canManageUsers())) return Response.json({ error: "You are not allowed to approve Remittances." }, { status: 403 });
  try {
    const body = await request.json();
    if (!['approve', 'reject'].includes(body.decision)) throw new Error("Choose approve or reject.");
    const normalizedRoles = user.roleNames.map((role) => role.trim().toLowerCase());
    const allowOwnDecision = normalizedRoles.some((role) => role === "administrator" || role === "admin") && normalizedRoles.includes("entry clerk");
    const ids: string[] = Array.isArray(body.remittanceIds) ? body.remittanceIds.map((id: unknown) => String(id ?? "").trim()).filter(Boolean) : [String(body.remittanceId ?? "").trim()].filter(Boolean);
    if (!ids.length) throw new Error("Choose the remittances to decide.");
    const done: string[] = [], failed: string[] = [];
    for (const id of ids) {
      try { await decideCashRemittance(id, body.decision, String(body.reason ?? ""), allowOwnDecision); done.push(id); }
      catch (error) { failed.push(`${id}: ${error instanceof Error ? error.message : "failed"}`); }
    }
    if (!done.length) throw new Error(failed.join(" "));
    return Response.json({ success: true, remittance: ids.length === 1 ? { id: done[0], status: body.decision === "approve" ? "Approved" : "Rejected" } : undefined, done, failed });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to decide Remittance." }, { status: 400 });
  }
});
