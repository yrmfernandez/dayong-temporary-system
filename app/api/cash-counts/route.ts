import { isAdministratorRole, isFinanceFamilyRole } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { decideCashCount, listCashCounts } from "@/lib/cash-position";
import { cashHeldAtStart } from "@/lib/clerk-report";
import { refuseOnDayOff } from "@/lib/day-off";
import { withEncoder } from "@/lib/encoder-context";

const noStore = { "Cache-Control": "private, no-store" };
const failure = (error: unknown, fallback: string, status = 400) => Response.json({ success: false, message: error instanceof Error ? error.message : fallback }, { status });
const decides = (roleNames: string[]) => roleNames.some((role) => isAdministratorRole(role) || isFinanceFamilyRole(role));

/**
 * Cash counts (lib/cash-position.ts) for Finance and Administrators: GET lists every clerk's, each pending one with the
 * cash the system expected at the start of that day (from the clerk's previous confirmed count), so a shortage or
 * overage shows before confirming. PATCH { id, decision: "confirm" | "reject", note } decides one.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user || !decides(user.roleNames)) return failure(null, "Only Finance or an Administrator confirms cash counts.", 403);
  try {
    const counts = await listCashCounts();
    const withExpected = await Promise.all(counts.map(async (count) => {
      if (count.status !== "Pending") return { ...count, expected: null };
      const held = await cashHeldAtStart(count.employeeId, count.branch, count.date).catch(() => null);
      return { ...count, expected: held ? held.amount : null };
    }));
    return Response.json({ success: true, counts: withExpected }, { headers: noStore });
  } catch (error) { return failure(error, "Unable to load the cash counts.", 500); }
}

export const PATCH = withEncoder(async (request: Request) => {
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const user = await getSessionUser();
  if (!user || !decides(user.roleNames)) return failure(null, "Only Finance or an Administrator confirms cash counts.", 403);
  try {
    const body = await request.json() as Record<string, unknown>;
    const decision = body.decision === "confirm" ? "confirm" : body.decision === "reject" ? "reject" : null;
    if (!decision) throw new Error("Choose confirm or reject.");
    const count = await decideCashCount(String(body.id ?? ""), decision, String(body.note ?? ""), { employeeId: user.employeeId, name: user.name, isAdmin: user.roleNames.some(isAdministratorRole) });
    return Response.json({ success: true, message: decision === "confirm" ? `Confirmed: ${count.employeeName}'s cash count for ${count.branch} on ${count.date}. Their report carries the cash from it.` : `Rejected: ${count.employeeName} sees your note and counts again.` });
  } catch (error) { return failure(error, "Unable to decide the cash count."); }
});
