import { canAccessPath } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { buildClerkReport } from "@/lib/clerk-report";
import { asAuditPeriod, auditedEmployees } from "@/lib/daily-audit";
import { getEmployees } from "@/lib/employees";
import { manilaNow } from "@/lib/remittance-deadline";
import { getReportRemarks } from "@/lib/report-remarks";

/**
 * An Entry Clerk's report (?kind=daily|weekly|monthly|yearly&date=YYYY-MM-DD). A clerk always gets their own. People
 * who review reports (Report Review or Audits access) may choose any Entry Clerk with ?employeeId=.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !["/reports", "/admin-reports", "/audit"].some((path) => canAccessPath(user, path))) return Response.json({ success: false, message: "You do not have access to reports." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const kind = asAuditPeriod(params.get("kind"));
    const date = params.get("date")?.trim() || manilaNow().date;
    const canChoose = canAccessPath(user, "/admin-reports") || canAccessPath(user, "/audit");
    const clerks = canChoose ? await auditedEmployees() : [];
    const requested = canChoose ? params.get("employeeId")?.trim() || clerks[0]?.employeeId || user.employeeId : user.employeeId;
    const employee = clerks.find((clerk) => clerk.employeeId === requested) ?? (await getEmployees()).map((item) => ({ employeeId: item.id, name: item.name, branch: item.branch })).find((item) => item.employeeId === requested);
    const report = await buildClerkReport(kind, date, employee ?? { employeeId: user.employeeId, name: user.name });
    // Remarks left on this clerk's report for the same period.
    const remarks = (await getReportRemarks(report.from, report.to)).filter((remark) => remark.scope === report.encoder.name);
    return Response.json({ success: true, report, remarks, canChoose, clerks: clerks.map((clerk) => ({ employeeId: clerk.employeeId, name: clerk.name, branch: clerk.branch })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to build the report." }, { status: 400 });
  }
}
