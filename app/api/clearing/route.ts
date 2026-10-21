import { refuseOnDayOff } from "@/lib/day-off";
import { canAccessPath } from "@/lib/access-control";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { addClearing, editClearing, getClearingPage, getDayEndReview, removeClearing, settleDayEnd } from "@/lib/clearing";
import { withEncoder } from "@/lib/encoder-context";

/** Clearing (lib/clearing.ts): GET the day's list; POST { branch, employeeId, covers, amount?, notes? } clears; PATCH { id, reason } removes; PATCH { action: "edit", id, branch, employeeId, covers } corrects it. */
async function allowed() {
  const user = await getSessionUser();
  if (!user) return { error: Response.json({ success: false, message: "Please sign in." }, { status: 401 }) };
  if (!canAccessPath(user, "/clearing")) return { error: Response.json({ success: false, message: "You do not have access to Clearing." }, { status: 403 }) };
  // A clerk sees and removes only the clearings they made; administrators see everyone's (lib/clearing.ts).
  return { user, clearedBy: (await canManageUsers()) ? "" : user.employeeId };
}

export async function GET(request?: Request) {
  const { error, clearedBy, user } = await allowed();
  if (error) return error;
  // ?review=1: the clerk's own earlier lines to keep or clear (day-end review, lib/clearing.ts).
  if (request && new URL(request.url).searchParams.get("review") === "1") {
    try { return Response.json({ success: true, review: await getDayEndReview(user.employeeId) }, { headers: { "Cache-Control": "private, no-store" } }); }
    catch (failure) { return Response.json({ success: false, message: failure instanceof Error ? failure.message : "Unable to load the review." }, { status: 500 }); }
  }
  try { return Response.json({ success: true, ...(await getClearingPage(clearedBy)) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (failure) { return Response.json({ success: false, message: failure instanceof Error ? failure.message : "Unable to load Clearing." }, { status: 500 }); }
}

export const POST = withEncoder(async (request: Request) => {
  // Day Off locks the day's entries (lib/day-off.ts).
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const { error } = await allowed();
  if (error) return error;
  try {
    const body = await request.json();
    const cleared = await addClearing({ branch: String(body.branch ?? ""), employeeId: String(body.employeeId ?? ""), amount: body.amount, notes: body.notes, covers: body.covers });
    return Response.json({ success: true, message: `${cleared.employeeName} cleared for ${cleared.branch} at ${cleared.clearedAt.slice(11)}. Their ${cleared.covers === "Both" ? "New Sales and Collections" : cleared.covers} for today can now be encoded.`, cleared });
  } catch (failure) { return Response.json({ success: false, message: failure instanceof Error ? failure.message : "Unable to clear." }, { status: 400 }); }
});

export const PATCH = withEncoder(async (request: Request) => {
  // Day Off locks the day's entries (lib/day-off.ts).
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const { error, clearedBy, user } = await allowed();
  if (error) return error;
  try {
    const body = await request.json();
    if (body.action === "day-end") {
      const done = await settleDayEnd({ keep: body.keep, clear: body.clear }, { employeeId: user.employeeId, name: user.name });
      const cleared = done.removed + done.narrowed;
      return Response.json({ success: true, message: `${cleared ? `${cleared} cleared from your list${done.narrowed ? ` (${done.narrowed} keep their encoded entries)` : ""}` : "Nothing cleared"}${done.kept ? `; ${done.kept} kept` : ""}.` });
    }
    if (body.action === "edit") {
      const edited = await editClearing({ id: String(body.id ?? ""), branch: String(body.branch ?? ""), employeeId: String(body.employeeId ?? ""), covers: body.covers }, clearedBy);
      return Response.json({ success: true, message: `Clearing updated: ${edited.employeeName}, ${edited.branch}, ${edited.covers === "Both" ? "New Sales and Collections" : `${edited.covers} only`}.` });
    }
    await removeClearing({ id: String(body.id ?? ""), reason: String(body.reason ?? "") }, clearedBy);
    return Response.json({ success: true, message: "Clearing removed." });
  } catch (failure) { return Response.json({ success: false, message: failure instanceof Error ? failure.message : "Unable to remove the clearing." }, { status: 400 }); }
});
