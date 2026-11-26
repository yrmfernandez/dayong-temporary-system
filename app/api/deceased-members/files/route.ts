import { canAccessPath, canOverseeDeceased } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { attachDeceasedFile, readDeceasedFile, removeDeceasedFile } from "@/lib/deceased-members";
import { withEncoder } from "@/lib/encoder-context";

const failure = (error: unknown, fallback: string, status = 400) => Response.json({ success: false, message: error instanceof Error ? error.message : fallback }, { status });
const denied = () => failure(null, "You do not have access to Deceased Members.", 403);

/**
 * Files on a Deceased Members record (lib/deceased-members.ts).
 * GET ?id=<file>&download=1: the file, shown in the browser (or saved with download=1); for the clerk who encoded the
 * record and for Administrators and Finance. Read only when opened, never with the list (Supabase egress).
 * POST multipart (claimId, file): attaches one file to one's own record. DELETE { id }: takes a file off it.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/deceased-members")) return denied();
  try {
    const params = new URL(request.url).searchParams;
    const file = await readDeceasedFile({ employeeId: user.employeeId, canOversee: canOverseeDeceased(user) }, params.get("id") ?? "");
    const disposition = params.get("download") === "1" ? "attachment" : "inline";
    return new Response(Buffer.from(file.bytes), { headers: {
      "Content-Type": file.type, "Content-Length": String(file.bytes.length), "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`, "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return failure(error, "Unable to open the file.", 404); }
}

export const POST = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/deceased-members")) return denied();
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) throw new Error("Choose a file to attach.");
    const name = "name" in file ? String((file as File).name) : "file";
    const record = await attachDeceasedFile(user.employeeId, String(form.get("claimId") ?? ""), { name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json({ success: true, record, message: `${name} attached.` });
  } catch (error) { return failure(error, "Unable to attach the file."); }
});

export const DELETE = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/deceased-members")) return denied();
  try {
    const body = await request.json() as Record<string, unknown>;
    const record = await removeDeceasedFile(user.employeeId, String(body.id ?? ""));
    return Response.json({ success: true, record, message: "File removed from the record." });
  } catch (error) { return failure(error, "Unable to remove the file."); }
});
