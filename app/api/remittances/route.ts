import { getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { createCashRemittance, decideCashRemittance, getRemittanceDashboard } from "@/lib/remittance-workflow";

export async function GET() {
  if (!(await getSessionUser())) return Response.json({ error: "Please sign in." }, { status: 401 });
  try {
    return Response.json(await getRemittanceDashboard());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load Remittances." }, { status: 500 });
  }
}

export const POST = withEncoder(async (request: Request) => {
  try {
    const body = await request.json();
    const result = await createCashRemittance({
      collectionIds: Array.isArray(body.collectionIds) ? body.collectionIds : [],
      actualAmount: Number(body.actualAmount), remittanceDate: String(body.remittanceDate ?? ""),
      receivedByName: String(body.receivedByName ?? ""), remarks: String(body.remarks ?? ""),
    });
    return Response.json({ success: true, remittance: result }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create Remittance." }, { status: 400 });
  }
});

export const PATCH = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user?.permissions.manageUsers) return Response.json({ error: "You are not allowed to approve Remittances." }, { status: 403 });
  try {
    const body = await request.json();
    if (!['approve', 'reject'].includes(body.decision)) throw new Error("Choose approve or reject.");
    const result = await decideCashRemittance(String(body.remittanceId ?? ""), body.decision, String(body.reason ?? ""));
    return Response.json({ success: true, remittance: result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to decide Remittance." }, { status: 400 });
  }
});
