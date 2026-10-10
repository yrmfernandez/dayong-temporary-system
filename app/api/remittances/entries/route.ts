import { canAccessPath } from "@/lib/access-control";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { getRemittanceEntries } from "@/lib/remittance-workflow";

/** Every entry on one remittance slip (?id=RMT-...): approvers see any slip, an Entry Clerk only slips they encoded. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  if (!canAccessPath(user, "/remittances")) return Response.json({ success: false, message: "You do not have access to Remittances." }, { status: 403 });
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    const result = await getRemittanceEntries(id, (await canManageUsers()) ? "" : user.employeeId);
    return Response.json({ success: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load the entries." }, { status: 400 });
  }
}
