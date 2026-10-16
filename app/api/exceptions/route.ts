import { refuseOnDayOff } from "@/lib/day-off";
import { pageTicked } from "@/lib/access-control";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { correctSaleOrCollection } from "@/lib/entry-corrections";
import { findExceptions } from "@/lib/exceptions";

/** Data problems for administrators, and to read for any role with Exceptions ticked in Roles; ?legacy=1 includes imported records. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  const canFix = await canManageUsers();
  if (!canFix && !(user && pageTicked(user, "/exceptions"))) return Response.json({ success: false, message: "Administrator access is required." }, { status: 403 });
  try {
    const includeLegacy = new URL(request.url).searchParams.get("legacy") === "1";
    return Response.json({ success: true, canFix, ...(await findExceptions({ includeLegacy })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to check for exceptions." }, { status: 500 });
  }
}

/** Fixes a New Sale or Collection from the list; the reason is kept in Record Corrections. */
export const PATCH = withEncoder(async (request: Request) => {
  // Day Off locks the day's entries (lib/day-off.ts).
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  if (!(await canManageUsers())) return Response.json({ success: false, message: "Administrator access is required." }, { status: 403 });
  try {
    return Response.json({ success: true, ...(await correctSaleOrCollection(await request.json())) });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to correct the entry." }, { status: 400 });
  }
});
