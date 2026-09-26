import { getSessionUser } from "@/lib/auth-server";
import { canAccessPath } from "@/lib/access-control";
import { buildOperationalReport } from "@/lib/reports";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  if (!canAccessPath(user, "/reports")) return Response.json({ success: false, message: "You do not have access to reports." }, { status: 403 });
  try {
    const query = new URL(request.url).searchParams;
    const report = await buildOperationalReport(query.get("from") ?? "", query.get("to") ?? "", { branch: query.get("branch") ?? "", programId: query.get("program") ?? "", person: query.get("person") ?? "" });
    return Response.json({ success: true, report: { ...report, generatedBy: user.username } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to generate report." }, { status: 400 }); }
}
