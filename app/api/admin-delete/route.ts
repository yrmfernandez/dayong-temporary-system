import { getSessionUser } from "@/lib/auth-server";
import { canDeleteRecords, deleteRecord, isDeleteKind, planDeletion } from "@/lib/admin-delete";
import { withEncoder } from "@/lib/encoder-context";

/** GET ?kind=&id=: what deleting the record would remove (nothing changes). POST { kind, id, reason, confirm: "DELETE" }: delete it. */
async function administrator() {
  const user = await getSessionUser();
  if (!user) return { error: Response.json({ success: false, message: "Please sign in." }, { status: 401 }) };
  if (!canDeleteRecords(user)) return { error: Response.json({ success: false, message: "Only an Administrator can delete records." }, { status: 403 }) };
  return { user };
}

export async function GET(request: Request) {
  const { error } = await administrator();
  if (error) return error;
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  if (!isDeleteKind(kind)) return Response.json({ success: false, message: "Unknown record type." }, { status: 400 });
  try {
    return Response.json({ success: true, plan: await planDeletion(kind, params.get("id") ?? "") }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (failure) {
    return Response.json({ success: false, message: failure instanceof Error ? failure.message : "Unable to check the record." }, { status: 400 });
  }
}

export const POST = withEncoder(async (request: Request) => {
  const { error } = await administrator();
  if (error) return error;
  try {
    const body = await request.json();
    if (!isDeleteKind(body.kind)) throw new Error("Unknown record type.");
    if (body.confirm !== "DELETE") throw new Error("Type DELETE to confirm.");
    const plan = await deleteRecord(body.kind, String(body.id ?? ""), String(body.reason ?? ""));
    return Response.json({ success: true, message: `Deleted: ${plan.effects.join(", ")}.`, plan });
  } catch (failure) {
    return Response.json({ success: false, message: failure instanceof Error ? failure.message : "Unable to delete the record." }, { status: 400 });
  }
});
