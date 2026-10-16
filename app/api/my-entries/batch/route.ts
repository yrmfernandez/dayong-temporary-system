import { refuseOnDayOff } from "@/lib/day-off";
import { canAccessPath } from "@/lib/access-control";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { getReturnedBatch, saveReturnedBatch, type BatchEditInput } from "@/lib/batch-edit";
import { isUniqueViolation } from "@/lib/db";
import { withEncoder } from "@/lib/encoder-context";

/**
 * A Returned batch in My Entries: GET ?ids=… loads it for the editor, POST saves the clerk's fixes (lib/batch-edit.ts).
 * The clerk who encoded it, or an administrator.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/my-entries")) return Response.json({ success: false, message: "You do not have access to My Entries." }, { status: 403 });
  try {
    const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",");
    const batch = await getReturnedBatch(ids, { employeeId: user.employeeId, isAdmin: await canManageUsers() });
    return Response.json({ success: true, batch }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to open the batch." }, { status: 400 });
  }
}

export const POST = withEncoder(async (request: Request) => {
  // Day Off locks the day's entries (lib/day-off.ts).
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/my-entries")) return Response.json({ success: false, message: "You do not have access to My Entries." }, { status: 403 });
  try {
    const body = await request.json() as BatchEditInput;
    if (!Array.isArray(body.ids) || !Array.isArray(body.entries)) throw new Error("Choose the returned batch to edit.");
    const message = await saveReturnedBatch(body, { employeeId: user.employeeId, isAdmin: await canManageUsers() });
    return Response.json({ success: true, message });
  } catch (error) {
    if (isUniqueViolation(error, "collections_or_key_unique")) return Response.json({ success: false, message: "One of these OR Numbers was just recorded by another save. Check the receipts and try again." }, { status: 409 });
    if (isUniqueViolation(error, "sales_application_key_unique")) return Response.json({ success: false, message: "One of these Application Numbers was just recorded by another save. Check and try again." }, { status: 409 });
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save the batch." }, { status: 400 });
  }
});
