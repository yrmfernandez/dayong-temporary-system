import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { getPaymentMethods, savePaymentMethod } from "@/lib/payment-methods";

// Every signed-in user needs the list to encode collections; only administrators change it.
export async function GET() {
  if (!(await getSessionUser())) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  try { return Response.json({ success: true, methods: await getPaymentMethods(), canManage: await canManageUsers() }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load payment methods." }, { status: 500 }); }
}

export const POST = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "Administrator access is required." }, { status: 403 });
  try { return Response.json({ success: true, method: await savePaymentMethod(await request.json()) }, { status: 201 }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save payment method." }, { status: 400 }); }
});
