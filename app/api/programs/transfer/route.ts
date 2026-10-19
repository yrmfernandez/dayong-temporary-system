import { getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { canMovePrograms, programTargets, programTransferOptions, transferProgramAccounts } from "@/lib/program-transfer";

/**
 * Programs → Transfer members (lib/program-transfer.ts), administrators, and IT from Edit / Corrections: GET ?program=ID lists the program's
 * accounts and the programs they can move to (&targets=1: only the programs, for Members → Transfer of one account);
 * POST { from, to, enrollmentIds | all, removeWhenEmpty, reason } moves them.
 */
async function allowed() {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  if (!(await canMovePrograms())) return Response.json({ success: false, message: "Only administrators and IT move members between programs." }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  const refused = await allowed();
  if (refused) return refused;
  const params = new URL(request.url).searchParams;
  try { return Response.json({ success: true, ...await (params.get("targets") ? programTargets(params.get("program") ?? "") : programTransferOptions(params.get("program") ?? "")) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load the program." }, { status: 400 }); }
}

export const POST = withEncoder(async (request: Request) => {
  const refused = await allowed();
  if (refused) return refused;
  try {
    const body = await request.json() as Record<string, unknown>;
    const result = await transferProgramAccounts({
      fromProgramId: String(body.from ?? ""), toProgramId: String(body.to ?? ""), all: body.all === true,
      enrollmentIds: Array.isArray(body.enrollmentIds) ? body.enrollmentIds.map(String) : [], removeWhenEmpty: body.removeWhenEmpty === true, reason: String(body.reason ?? ""),
    });
    const parts = [`${result.moved} moved`, result.merged ? `${result.merged} merged into the member's existing ${result.to} account` : "", result.left.length ? `${result.left.length} left as they are` : "", result.repriced ? `${result.repriced} entr${result.repriced === 1 ? "y" : "ies"} with the new program's incentives` : "", result.unpriced ? `${result.unpriced} kept their incentives because ${result.to} has no incentive tiers for them (set them in Programs, then use Edit / Corrections)` : ""].filter(Boolean);
    const removal = result.removal === "deleted" ? ` ${result.from} was deleted.` : result.removal === "inactive" ? ` ${result.from} still has records, so it was set inactive.` : "";
    return Response.json({ success: true, ...result, message: `${result.from} → ${result.to}: ${parts.join(", ")}.${removal}` });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to move the accounts." }, { status: 400 }); }
});
