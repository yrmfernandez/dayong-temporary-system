import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { createCashTransaction, getFinanceData, voidFinanceRecord } from "@/lib/finance-data";

export async function GET() {
  if (!(await getSessionUser())) return Response.json({ success: false, message: "Not signed in." }, { status: 401 });
  try { const data = await getFinanceData(); return Response.json({ success: true, ledger: data.ledger, canVoid: await canManageUsers() }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load cash ledger." }, { status: 500 }); }
}

export const POST = withEncoder(async (request: Request) => {
  try { return Response.json({ success: true, ...(await createCashTransaction(await request.json())) }, { status: 201 }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save cash transaction." }, { status: 400 }); }
});

export const PATCH = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "You are not allowed to void cash transactions." }, { status: 403 });
  try { const body = await request.json(); await voidFinanceRecord("cash", String(body.id ?? ""), String(body.reason ?? "")); return Response.json({ success: true }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to void cash transaction." }, { status: 400 }); }
});
