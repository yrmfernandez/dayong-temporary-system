import { canAccessPath } from "@/lib/access-control";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { auditedEmployees } from "@/lib/daily-audit";
import { manilaNow } from "@/lib/remittance-deadline";
import { getEntriesForRange } from "@/lib/todays-entries";

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * What an Entry Clerk encoded from `from` to `to` (by the date encoded), with each entry's receipt photo. A clerk sees
 * only their own entries; administrators may choose a clerk (?employeeId=).
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/my-entries")) return Response.json({ success: false, message: "You do not have access to My Entries." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const today = manilaNow().date;
    const from = params.get("from") || today, to = params.get("to") || from;
    if (!validDate(from) || !validDate(to) || from > to) throw new Error("Choose a valid date range.");
    const isAdmin = await canManageUsers();
    const clerks = isAdmin ? await auditedEmployees() : [];
    const employeeId = isAdmin ? params.get("employeeId") || user.employeeId : user.employeeId;
    const { entries, sales, collections } = await getEntriesForRange(from, to, "encoded", { encodedBy: employeeId });
    return Response.json({
      success: true, from, to, today, employeeId, isAdmin, clerks: clerks.map((clerk) => ({ employeeId: clerk.employeeId, name: clerk.name })),
      entries, sales, collections, withPhoto: entries.filter((entry) => entry.photoId).length,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load your entries." }, { status: 400 });
  }
}
