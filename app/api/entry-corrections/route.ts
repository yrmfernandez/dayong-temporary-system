import { canAccessPath, canCorrectEntriesFor } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { correctSaleOrCollection } from "@/lib/entry-corrections";
import { isSearchKind, SEARCH_LIMIT, searchEntries } from "@/lib/entry-search";

/** IT and Administrators with the Entry Corrections page (Roles → Page access may take it away). */
async function allowedUser() {
  const user = await getSessionUser();
  return user && canCorrectEntriesFor(user) && canAccessPath(user, "/entry-corrections") ? user : null;
}

/**
 * Entry Corrections (owner, October 15, 2026): search New Sales and Collections, remitted ones included
 * (lib/entry-search.ts), and correct a typed number with a reason (lib/entry-corrections.ts, Record Corrections).
 */
export async function GET(request: Request) {
  if (!(await allowedUser())) return Response.json({ success: false, message: "IT or Administrator access is required." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind") ?? "all";
    const entries = await searchEntries(params.get("q") ?? "", isSearchKind(kind) ? kind : "all");
    return Response.json({ success: true, entries, limit: SEARCH_LIMIT }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to search entries." }, { status: 400 });
  }
}

export const PATCH = withEncoder(async (request: Request) => {
  if (!(await allowedUser())) return Response.json({ success: false, message: "IT or Administrator access is required." }, { status: 403 });
  try {
    return Response.json({ success: true, ...(await correctSaleOrCollection(await request.json())) });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to correct the entry." }, { status: 400 });
  }
});
