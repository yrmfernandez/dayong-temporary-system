import { canManageUsers } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { issueNte, listNtes, withdrawNte } from "@/lib/nte";

/** Notices to Explain: administrators only. */
export async function GET() {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "Only administrators manage Notices to Explain." }, { status: 403 });
  try { return Response.json({ success: true, ...await listNtes() }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load notices." }, { status: 500 }); }
}

export const POST = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "Only administrators issue Notices to Explain." }, { status: 403 });
  try { return Response.json({ success: true, ...await issueNte(await request.json()), message: "Notice to Explain issued." }, { status: 201 }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to issue the notice." }, { status: 400 }); }
});

export const PATCH = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "Only administrators withdraw Notices to Explain." }, { status: 403 });
  try { const body = await request.json(); return Response.json({ success: true, ...await withdrawNte(String(body.id ?? ""), String(body.reason ?? "")), message: "Notice withdrawn." }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to withdraw the notice." }, { status: 400 }); }
});
