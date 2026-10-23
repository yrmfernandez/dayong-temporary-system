import { getSessionUser } from "@/lib/auth-server";
import { isAdministratorRole } from "@/lib/access-control";
import { withEncoder } from "@/lib/encoder-context";
import { decideIncentive } from "@/lib/incentive-decision";

/**
 * An Administrator keeps or forfeits one entry's incentive, or lets the 3:00 PM rule decide again (owner, October 23,
 * 2026; lib/incentive-decision.ts). Body: { id, decision: "Keep" | "Forfeit" | "", reason }.
 */
export const PATCH = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !user.roleNames.some(isAdministratorRole)) return Response.json({ success: false, message: "Only an Administrator can decide an incentive." }, { status: 403 });
  try {
    const body = await request.json();
    const result = await decideIncentive({ id: String(body.id ?? ""), decision: String(body.decision ?? ""), reason: String(body.reason ?? "") });
    return Response.json({ success: true, result });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save the decision." }, { status: 400 });
  }
});
