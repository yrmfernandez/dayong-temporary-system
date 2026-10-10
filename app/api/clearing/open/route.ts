import { canAccessPath } from "@/lib/access-control";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { getEncodableClearings } from "@/lib/clearing";

/** People in Clearing that New Sales and Collections can encode for (components/clearing-picker.tsx): the clerk's own clearings; administrators see everyone's. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  if (!["/new-sales", "/collections", "/clearing"].some((path) => canAccessPath(user, path))) return Response.json({ success: false, message: "You do not have access to Clearing." }, { status: 403 });
  try { return Response.json({ success: true, clearings: await getEncodableClearings((await canManageUsers()) ? "" : user.employeeId) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (failure) { return Response.json({ success: false, message: failure instanceof Error ? failure.message : "Unable to load Clearing." }, { status: 500 }); }
}
