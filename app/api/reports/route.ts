import { getSessionUser } from "@/lib/auth-server";
import { getEmployees } from "@/lib/employees";
import { canAccessPath } from "@/lib/access-control";
import { buildOperationalReport } from "@/lib/reports";
import { withEncoder } from "@/lib/encoder-context";
import { addReportRemark, getReportRemarks } from "@/lib/report-remarks";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  // Report Review (/admin-reports) reads the same report, so its viewers (e.g. CEO/President) may load it.
  if (!canAccessPath(user, "/reports") && !canAccessPath(user, "/admin-reports")) return Response.json({ success: false, message: "You do not have access to reports." }, { status: 403 });
  try {
    const query = new URL(request.url).searchParams;
    // Report Review shows only what Entry Clerks encoded, and its encoder filter lists only Entry Clerks.
    const clerks = query.get("scope") === "entry-clerks" ? (await getEmployees()).filter((employee) => employee.roles.some((role) => role.trim().toLowerCase() === "entry clerk")).map((employee) => employee.name).sort() : null;
    const built = await buildOperationalReport(query.get("from") ?? "", query.get("to") ?? "", { branch: query.get("branch") ?? "", programId: query.get("program") ?? "", person: query.get("person") ?? "", encoder: query.get("encoder") ?? "", ...(clerks ? { encoders: clerks } : {}) });
    const report = clerks ? { ...built, options: { ...built.options, encoders: clerks } } : built;
    const remarks = await getReportRemarks(report.from, report.to);
    return Response.json({ success: true, report: { ...report, remarks, generatedBy: user.name } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to generate report." }, { status: 400 }); }
}

export const POST = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || (!canAccessPath(user, "/reports") && !canAccessPath(user, "/admin-reports"))) return Response.json({ success: false, message: "You do not have access to reports." }, { status: 403 });
  try { const body = await request.json(); await addReportRemark({ from: String(body.from ?? ""), to: String(body.to ?? ""), reportType: String(body.reportType ?? ""), scope: String(body.scope ?? "All"), comment: String(body.comment ?? "") }); return Response.json({ success: true, message: "Report remark saved." }, { status: 201 }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save report remark." }, { status: 400 }); }
});
