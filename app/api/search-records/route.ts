import { userWithPageAccess } from "@/lib/auth-server";
import { ownMembersScope } from "@/lib/member-scope";
import { cleanQuery, recordSearchOptions, searchRecords } from "@/lib/record-search";

/**
 * Search Records (lib/record-search.ts). GET ?options=1 gives the branches and programs; otherwise the query string is
 * the search: kind, q, orNumber, dateField, dateFrom, dateTo, branch, program, mas, remittanceStatus.
 */
export async function GET(request: Request) {
  const user = await userWithPageAccess("/search-records");
  if (!user) return Response.json({ success: false, message: "You do not have access to Search Records." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const headers = { "Cache-Control": "private, no-store" };
  try {
    if (params.get("options") === "1") return Response.json({ success: true, ...await recordSearchOptions() }, { headers });
    const query = cleanQuery(Object.fromEntries(params.entries()));
    return Response.json({ success: true, ...await searchRecords(query, await ownMembersScope(user)) }, { headers });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to search." }, { status: 400 });
  }
}
