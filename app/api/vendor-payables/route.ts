import { userWithPageAccess } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { createVendorPayable, getVendorPayables, payVendorPayable } from "@/lib/finance-operations";

const denied = () => Response.json({ success: false, message: "You do not have access to Vendor Payables." }, { status: 403 });
const allowed = () => userWithPageAccess("/vendor-payables");

export async function GET() {
  if (!(await allowed())) return denied();
  try { return Response.json({ success: true, payables: await getVendorPayables() }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load payables." }, { status: 500 }); }
}

export const POST = withEncoder(async (request: Request) => {
  if (!(await allowed())) return denied();
  try { return Response.json({ success: true, ...await createVendorPayable(await request.json()) }, { status: 201 }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to create payable." }, { status: 400 }); }
});

export const PATCH = withEncoder(async (request: Request) => {
  if (!(await allowed())) return denied();
  try { const body = await request.json(); return Response.json({ success: true, ...await payVendorPayable(String(body.id ?? ""), body.amount, body.account) }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to record payment." }, { status: 400 }); }
});
