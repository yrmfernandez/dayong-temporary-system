import { inArray } from "drizzle-orm";

import { canAccessPath } from "@/lib/access-control";
import { getDb, schema } from "@/lib/db";
import { resubmitReturned, submitReadyEntries } from "@/lib/remittance-workflow";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { getReceiptPhoto, saveReceiptPhoto } from "@/lib/receipt-photos";

const text = (value: unknown) => String(value ?? "").trim();
// Pages where receipt photos are shown; anyone who can open one of them may view a photo.
const VIEWING_PAGES = ["/my-entries", "/todays-entries", "/remittances", "/audit", "/admin-reports", "/reports", "/exceptions"];

/** One receipt photo as a data URL (?photoId=RCP-...). */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !VIEWING_PAGES.some((path) => canAccessPath(user, path))) return Response.json({ success: false, message: "You do not have access to receipt photos." }, { status: 403 });
  try {
    const photo = await getReceiptPhoto(new URL(request.url).searchParams.get("photoId")?.trim() ?? "");
    return Response.json({ success: true, ...photo }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Photo not found." }, { status: 404 });
  }
}

/**
 * Attaches one compressed receipt photo to one or more New Sales / Collections. The Entry Clerk who encoded every one
 * of the entries may attach it; administrators may attach to any entry.
 */
export const POST = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !["/my-entries", "/todays-entries"].some((path) => canAccessPath(user, path))) return Response.json({ success: false, message: "You do not have access to add receipt photos." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const entryIds = Array.isArray(body.entryIds) ? body.entryIds.map(text).filter(Boolean) : [];
    // Only these entries, not the whole Sales and Collections tables (reading all 60,000 collections took about 8 seconds
    // on every upload; October 10, 2026).
    const { sales, collections } = schema;
    const [saleRows, collectionRows] = entryIds.length ? await Promise.all([
      getDb().select({ id: sales.sale_id, by: sales.encoded_by_employee_id, status: sales.remittance_status }).from(sales).where(inArray(sales.sale_id, entryIds)),
      getDb().select({ id: collections.collection_id, by: collections.encoded_by_employee_id, status: collections.remittance_status }).from(collections).where(inArray(collections.collection_id, entryIds)),
    ]) : [[], []];
    const found = [...saleRows, ...collectionRows];
    // Entry ID → Employee ID of whoever encoded it.
    const encoders = new Map(found.map((row) => [row.id, text(row.by)] as const));
    const unknown = entryIds.filter((id) => !encoders.has(id));
    if (unknown.length) throw new Error(`Entry not found: ${unknown.join(", ")}.`);
    if (!(await canManageUsers()) && entryIds.some((id) => encoders.get(id) !== user.employeeId)) throw new Error("You can add receipt photos only to entries you encoded.");
    const saved = await saveReceiptPhoto({ entryIds, dataUrl: text(body.dataUrl), width: Number(body.width), height: Number(body.height) });
    // With the photo attached, entries that now have everything go to Pending Approval on their own; a Returned entry
    // given a new photo is resubmitted.
    const statuses = new Map(found.map((row) => [row.id, text(row.status)] as const));
    const returned = entryIds.filter((id) => statuses.get(id) === "Returned");
    let slips: string[] = [];
    try {
      if (returned.length) slips = await resubmitReturned(returned, { employeeId: user.employeeId, isAdmin: await canManageUsers() });
      slips = [...slips, ...(await submitReadyEntries(entryIds.filter((id) => !returned.includes(id))))];
    } catch (error) {
      console.error("Receipt photo saved, but the entries could not be submitted for approval.", error);
    }
    return Response.json({ success: true, ...saved, slips, message: `Receipt photo saved for ${saved.entryIds.length} entr${saved.entryIds.length === 1 ? "y" : "ies"} (${Math.round(saved.sizeBytes / 1000)} KB).${slips.length ? ` Sent for approval: ${slips.join(", ")}.` : ""}` });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save the photo." }, { status: 400 });
  }
});
