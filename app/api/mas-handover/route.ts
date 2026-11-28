import { canAccessPath } from "@/lib/access-control";
import { userWithPageAccess } from "@/lib/auth-server";
import { refuseOnDayOff } from "@/lib/day-off";
import { withEncoder } from "@/lib/encoder-context";
import { handoverOptions, handoverSummary, markHandover } from "@/lib/mas-handover";

const noStore = { "Cache-Control": "private, no-store" };
const failure = (error: unknown, fallback: string, status = 400) => Response.json({ success: false, message: error instanceof Error ? error.message : fallback }, { status });

/** An Entry Clerk who reviews MAS batches (New Sales or Collections) and may clear, as Mark remitted records a clearing. */
async function clerk() {
  const user = await userWithPageAccess("/collections") ?? await userWithPageAccess("/new-sales");
  return user && canAccessPath(user, "/clearing") ? user : null;
}

/**
 * One handover per Mark remitted (lib/mas-handover.ts; owner, November 28, 2026; from December 1, 2026).
 * GET ?employeeId=&branchId=: what the Mark remitted window lists (the MAS's waiting batches of both kinds, today's
 *   handovers, the remittance methods). GET ?clearingId=: the handover shown on the encoding form.
 */
export async function GET(request: Request) {
  const user = await clerk();
  if (!user) return Response.json({ success: false, message: "You do not have access to Mark remitted." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  try {
    if (params.get("clearingId")) return Response.json({ success: true, handover: await handoverSummary(params.get("clearingId") ?? "") }, { headers: noStore });
    return Response.json({ success: true, ...await handoverOptions(user, params.get("employeeId") ?? "", params.get("branchId") ?? "") }, { headers: noStore });
  } catch (error) { return failure(error, "Unable to load the handover."); }
}

/** { employeeId, branchId, batchIds, lines, note, handover: "new" | earlier clearing ID } marks the batches remitted now. */
export const POST = withEncoder(async (request: Request) => {
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const user = await clerk();
  if (!user) return Response.json({ success: false, message: "You do not have access to Mark remitted." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const done = await markHandover(user, body);
    const what = done.kinds.join(" and ");
    const short = done.estimate ? ` ${done.estimate < 0 ? "Short" : "Over"} by ${Math.abs(done.estimate).toLocaleString("en-PH", { style: "currency", currency: "PHP" })} for now: recorded when the last batch is saved.` : "";
    return Response.json({ success: true, ...done, message: `${done.mas}'s ${what} marked remitted at ${done.remittedAt.slice(11)} (${done.batches} batch${done.batches === 1 ? "" : "es"}, one handover). This time decides the incentive; the details can be typed later.${short}` });
  } catch (error) { return failure(error, "Unable to mark it remitted."); }
});
