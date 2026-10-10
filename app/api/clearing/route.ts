import { canAccessPath } from "@/lib/access-control";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { addClearing, getClearingPage, removeClearing } from "@/lib/clearing";
import { withEncoder } from "@/lib/encoder-context";

/** Clearing (lib/clearing.ts): GET the day's list; POST { branch, employeeId, covers, amount?, notes? } clears; PATCH { id, reason } removes. */
async function allowed() {
  const user = await getSessionUser();
  if (!user) return { error: Response.json({ success: false, message: "Please sign in." }, { status: 401 }) };
  if (!canAccessPath(user, "/clearing")) return { error: Response.json({ success: false, message: "You do not have access to Clearing." }, { status: 403 }) };
  // A clerk sees and removes only the clearings they made; administrators see everyone's (lib/clearing.ts).
  return { user, clearedBy: (await canManageUsers()) ? "" : user.employeeId };
}

export async function GET() {
  const { error, clearedBy } = await allowed();
  if (error) return error;
  try { return Response.json({ success: true, ...(await getClearingPage(clearedBy)) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (failure) { return Response.json({ success: false, message: failure instanceof Error ? failure.message : "Unable to load Clearing." }, { status: 500 }); }
}

export const POST = withEncoder(async (request: Request) => {
  const { error } = await allowed();
  if (error) return error;
  try {
    const body = await request.json();
    const cleared = await addClearing({ branch: String(body.branch ?? ""), employeeId: String(body.employeeId ?? ""), amount: body.amount, notes: body.notes, covers: body.covers });
    return Response.json({ success: true, message: `${cleared.employeeName} cleared for ${cleared.branch} at ${cleared.clearedAt.slice(11)}. Their ${cleared.covers === "Both" ? "New Sales and Collections" : cleared.covers} for today can now be encoded.`, cleared });
  } catch (failure) { return Response.json({ success: false, message: failure instanceof Error ? failure.message : "Unable to clear." }, { status: 400 }); }
});

export const PATCH = withEncoder(async (request: Request) => {
  const { error, clearedBy } = await allowed();
  if (error) return error;
  try {
    const body = await request.json();
    await removeClearing({ id: String(body.id ?? ""), reason: String(body.reason ?? "") }, clearedBy);
    return Response.json({ success: true, message: "Clearing removed." });
  } catch (failure) { return Response.json({ success: false, message: failure instanceof Error ? failure.message : "Unable to remove the clearing." }, { status: 400 }); }
});
