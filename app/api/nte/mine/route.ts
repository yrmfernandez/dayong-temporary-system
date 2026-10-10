import { getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { acknowledgeNte, explainNte, listMyNtes } from "@/lib/nte";

/** My Notices: every signed-in employee sees only their own Notices to Explain, confirms receipt and explains. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  try { return Response.json({ success: true, ...await listMyNtes(user.employeeId) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load your notices." }, { status: 500 }); }
}

export const PATCH = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user?.employeeId) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  try {
    const body = await request.json();
    const id = String(body.id ?? "");
    if (body.action === "acknowledge") return Response.json({ success: true, ...await acknowledgeNte(id, user.employeeId) });
    if (body.action === "explain") return Response.json({ success: true, ...await explainNte(id, user.employeeId, String(body.explanation ?? "")), message: "Your explanation was sent." });
    return Response.json({ success: false, message: "Unknown action." }, { status: 400 });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save." }, { status: 400 }); }
});
