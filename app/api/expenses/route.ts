import { getSessionUser, canManageUsers } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { createExpense, getFinanceData, voidFinanceRecord } from "@/lib/finance-data";

export async function GET() {
  if (!(await getSessionUser())) return Response.json({ success: false, message: "Not signed in." }, { status: 401 });
  try {
    const data = await getFinanceData();
    return Response.json({ success: true, expenses: data.expenses, canVoid: await canManageUsers() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load expenses." }, { status: 500 }); }
}

export const POST = withEncoder(async (request: Request) => {
  try { return Response.json({ success: true, ...(await createExpense(await request.json())) }, { status: 201 }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save expense." }, { status: 400 }); }
});

export const PATCH = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "You are not allowed to void expenses." }, { status: 403 });
  try { const body = await request.json(); await voidFinanceRecord("expense", String(body.id ?? ""), String(body.reason ?? "")); return Response.json({ success: true }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to void expense." }, { status: 400 }); }
});
