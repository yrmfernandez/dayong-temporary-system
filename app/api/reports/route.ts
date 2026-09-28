import { getSessionUser } from "@/lib/auth-server";
import { canAccessPath } from "@/lib/access-control";
import { buildOperationalReport } from "@/lib/reports";
import { withEncoder } from "@/lib/encoder-context";
import { addReportRemark, getReportRemarks } from "@/lib/report-remarks";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  if (!canAccessPath(user, "/reports")) return Response.json({ success: false, message: "You do not have access to reports." }, { status: 403 });
  try {
    const query = new URL(request.url).searchParams;
    const report = await buildOperationalReport(query.get("from") ?? "", query.get("to") ?? "", { branch: query.get("branch") ?? "", programId: query.get("program") ?? "", person: query.get("person") ?? "", encoder: query.get("encoder") ?? "" });
    const remarks = await getReportRemarks(report.from, report.to);
    return Response.json({ success: true, report: { ...report, remarks, generatedBy: user.name } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to generate report." }, { status: 400 }); }
}

export const POST = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/reports")) return Response.json({ success: false, message: "You do not have access to reports." }, { status: 403 });
  try { const body = await request.json(); await addReportRemark({ from: String(body.from ?? ""), to: String(body.to ?? ""), reportType: String(body.reportType ?? ""), scope: String(body.scope ?? "All"), comment: String(body.comment ?? "") }); return Response.json({ success: true, message: "Report remark saved." }, { status: 201 }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save report remark." }, { status: 400 }); }
});
