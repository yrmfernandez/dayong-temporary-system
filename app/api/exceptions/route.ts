import { canManageUsers } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { correctSaleOrCollection } from "@/lib/entry-corrections";
import { findExceptions } from "@/lib/exceptions";

/** Data problems for administrators; ?legacy=1 includes imported records. */
export async function GET(request: Request) {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "Administrator access is required." }, { status: 403 });
  try {
    const includeLegacy = new URL(request.url).searchParams.get("legacy") === "1";
    return Response.json({ success: true, ...(await findExceptions({ includeLegacy })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to check for exceptions." }, { status: 500 });
  }
}

/** Fixes a New Sale or Collection from the list; the reason is kept in Record Corrections. */
export const PATCH = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "Administrator access is required." }, { status: 403 });
  try {
    return Response.json({ success: true, ...(await correctSaleOrCollection(await request.json())) });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to correct the entry." }, { status: 400 });
  }
});
