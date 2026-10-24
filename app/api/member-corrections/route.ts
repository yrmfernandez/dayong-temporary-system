import { canAccessPath, canCorrectEntriesFor } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { refuseOnDayOff } from "@/lib/day-off";
import { withEncoder } from "@/lib/encoder-context";
import { fixCoverage, getMemberForCorrection, insertReceipt, mergeMembers, moveReceipts, searchMembers, sharedPrograms, splitMember } from "@/lib/member-corrections";

/** IT and Administrators with the Member Corrections page (Roles → Page access may take it away). */
async function allowedUser() {
  const user = await getSessionUser();
  return user && canCorrectEntriesFor(user) && canAccessPath(user, "/member-corrections") ? user : null;
}
const denied = () => Response.json({ success: false, message: "IT or Administrator access is required." }, { status: 403 });

/** ?q= searches members; ?member= loads one with its accounts and receipts; ?keep=&other= lists programs both have. */
export async function GET(request: Request) {
  if (!(await allowedUser())) return denied();
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("member")) return Response.json({ success: true, ...(await getMemberForCorrection(params.get("member") ?? "")) }, { headers: { "Cache-Control": "private, no-store" } });
    if (params.get("keep") && params.get("other")) return Response.json({ success: true, shared: await sharedPrograms(params.get("keep") ?? "", params.get("other") ?? "") });
    return Response.json({ success: true, members: await searchMembers(params.get("q") ?? "") }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load." }, { status: 400 });
  }
}

/**
 * { tool, input, reason, apply }: tool is coverage, move, merge, split or insert. Without apply it is a preview: the
 * repair is worked out and rolled back (lib/member-corrections.ts).
 */
export const POST = withEncoder(async (request: Request) => {
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  if (!(await allowedUser())) return denied();
  try {
    const body = await request.json() as { tool?: string; input?: Record<string, unknown>; reason?: string; apply?: boolean };
    const input = (body.input ?? {}) as never, reason = String(body.reason ?? ""), apply = body.apply === true;
    const tools = { coverage: fixCoverage, move: moveReceipts, merge: mergeMembers, split: splitMember, insert: insertReceipt } as const;
    const tool = tools[body.tool as keyof typeof tools];
    if (!tool) throw new Error("Choose a correction.");
    return Response.json({ success: true, result: await tool(input, reason, apply) });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to work out the correction." }, { status: 400 });
  }
});
