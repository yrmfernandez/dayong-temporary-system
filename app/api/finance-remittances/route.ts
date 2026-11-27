import { isAdministratorRole, isFinanceFamilyRole } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { decideFinanceRemittance, listFinanceRemittances } from "@/lib/clerk-cash";
import { refuseOnDayOff } from "@/lib/day-off";
import { withEncoder } from "@/lib/encoder-context";
import { formatDate } from "@/lib/date-format";

const noStore = { "Cache-Control": "private, no-store" };
const failure = (error: unknown, fallback: string, status = 400) => Response.json({ success: false, message: error instanceof Error ? error.message : fallback }, { status });
const decides = (roleNames: string[]) => roleNames.some((role) => isAdministratorRole(role) || isFinanceFamilyRole(role));

/**
 * Cash remitted to Finance (owner, November 27, 2026; lib/clerk-cash.ts) for Finance and Administrators: GET lists every
 * clerk's record, waiting ones first; PATCH { id, decision: "confirm" | "reject", note } confirms the amount received or
 * rejects it with a note. The clerk's audit is saved only once every record of its period is confirmed.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user || !decides(user.roleNames)) return failure(null, "Only Finance or an Administrator confirms cash remitted to Finance.", 403);
  try {
    return Response.json({ success: true, remittances: await listFinanceRemittances() }, { headers: noStore });
  } catch (error) { return failure(error, "Unable to load the cash remitted to Finance.", 500); }
}

export const PATCH = withEncoder(async (request: Request) => {
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const user = await getSessionUser();
  if (!user || !decides(user.roleNames)) return failure(null, "Only Finance or an Administrator confirms cash remitted to Finance.", 403);
  try {
    const body = await request.json() as Record<string, unknown>;
    const decision = body.decision === "confirm" ? "confirm" : body.decision === "reject" ? "reject" : null;
    if (!decision) throw new Error("Choose confirm or reject.");
    const item = await decideFinanceRemittance(String(body.id ?? ""), decision, String(body.note ?? ""), { employeeId: user.employeeId, isAdmin: user.roleNames.some(isAdministratorRole) });
    const amount = item.amount.toLocaleString("en-PH", { style: "currency", currency: "PHP" });
    return Response.json({ success: true, message: decision === "confirm"
      ? `Confirmed: ${amount} remitted by ${item.employeeName} on ${formatDate(item.date)}. Their audit for that day can be saved.`
      : `Rejected: ${item.employeeName} sees your note and corrects the amount; it comes back here.` });
  } catch (error) { return failure(error, "Unable to decide the cash remitted to Finance."); }
});
