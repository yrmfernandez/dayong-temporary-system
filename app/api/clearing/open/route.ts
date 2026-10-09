import { canAccessPath } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { getEncodableClearings } from "@/lib/clearing";

/** People in Clearing that New Sales and Collections can encode for (components/clearing-picker.tsx). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  if (!["/new-sales", "/collections", "/clearing"].some((path) => canAccessPath(user, path))) return Response.json({ success: false, message: "You do not have access to Clearing." }, { status: 403 });
  try { return Response.json({ success: true, clearings: await getEncodableClearings() }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (failure) { return Response.json({ success: false, message: failure instanceof Error ? failure.message : "Unable to load Clearing." }, { status: 500 }); }
}
