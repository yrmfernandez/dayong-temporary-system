import { canAccessPath } from "@/lib/access-control";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { getReceiptPhoto, saveReceiptPhoto } from "@/lib/receipt-photos";
import { COLLECTIONS_RANGE, SALES_RANGE } from "@/lib/sheet-ranges";

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
    const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: [SALES_RANGE, COLLECTIONS_RANGE], valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
    const [sales, collections] = response.data.valueRanges?.map((range) => range.values ?? []) ?? [];
    // Entry ID → Employee ID of whoever encoded it (Sales AG, Collections W).
    const encoders = new Map([...sales.slice(1).map((row) => [text(row[0]), text(row[32])] as const), ...collections.slice(1).map((row) => [text(row[0]), text(row[22])] as const)]);
    const unknown = entryIds.filter((id) => !encoders.has(id));
    if (unknown.length) throw new Error(`Entry not found: ${unknown.join(", ")}.`);
    if (!(await canManageUsers()) && entryIds.some((id) => encoders.get(id) !== user.employeeId)) throw new Error("You can add receipt photos only to entries you encoded.");
    const saved = await saveReceiptPhoto({ entryIds, dataUrl: text(body.dataUrl), width: Number(body.width), height: Number(body.height) });
    return Response.json({ success: true, ...saved, message: `Receipt photo saved for ${saved.entryIds.length} entr${saved.entryIds.length === 1 ? "y" : "ies"} (${Math.round(saved.sizeBytes / 1000)} KB).` });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save the photo." }, { status: 400 });
  }
});
