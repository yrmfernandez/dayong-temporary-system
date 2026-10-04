import { canAccessPath } from "@/lib/access-control";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { buildClerkReport } from "@/lib/clerk-report";
import { asAuditPeriod, auditedEmployees, periodSpan } from "@/lib/daily-audit";
import { getEmployees } from "@/lib/employees";
import { manilaNow } from "@/lib/remittance-deadline";
import { getReportRemarks } from "@/lib/report-remarks";
import { addDeposit, saveReportNotes, voidDeposit } from "@/lib/clerk-cash";
import { withEncoder } from "@/lib/encoder-context";
import { createExpense } from "@/lib/finance-data";

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
    // Only the clerk records expenses, deposits and notes, on their own report.
    const isOwn = report.encoder.employeeId === user.employeeId;
    return Response.json({ success: true, report, remarks, canChoose, isOwn, clerks: clerks.map((clerk) => ({ employeeId: clerk.employeeId, name: clerk.name, branch: clerk.branch })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to build the report." }, { status: 400 });
  }
}

/**
 * What a clerk records on their own report: an expense (saved in Expenses for their branch, so Finance sees it), a
 * cash deposit to the bank, voiding a mistaken deposit, and the report's notes. Always for the signed-in clerk.
 */
export const POST = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/reports")) return Response.json({ success: false, message: "You do not have access to reports." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const employees = await getEmployees();
    const me = employees.find((employee) => employee.id === user.employeeId);
    const clerk = { employeeId: user.employeeId, name: me?.name || user.name, branch: me?.branch || "" };
    switch (body.action) {
      case "add-expense": {
        if (!clerk.branch) throw new Error("No primary branch is set for you. Ask an administrator to set it in Employees.");
        const saved = await createExpense({ ...body, branch: clerk.branch, paidBy: "Cash on Hand", paymentMethod: "Cash" });
        return Response.json({ success: true, message: `Expense ${saved.id} saved.` });
      }
      case "add-deposit": {
        const saved = await addDeposit(body, clerk);
        return Response.json({ success: true, message: `Deposit ${saved.id} saved.` });
      }
      case "void-deposit":
        await voidDeposit(String(body.id ?? ""), String(body.reason ?? ""), { employeeId: user.employeeId, isAdmin: await canManageUsers() });
        return Response.json({ success: true, message: "Deposit voided." });
      case "save-notes": {
        const kind = asAuditPeriod(body.kind);
        await saveReportNotes(user.employeeId, kind, periodSpan(kind, String(body.date ?? "")).start, body);
        return Response.json({ success: true, message: "Report notes saved." });
      }
      default:
        return Response.json({ success: false, message: "Unknown report action." }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save." }, { status: 400 });
  }
});
