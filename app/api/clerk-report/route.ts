import { refuseOnDayOff } from "@/lib/day-off";
import { canAccessPath } from "@/lib/access-control";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { buildClerkReport } from "@/lib/clerk-report";
import { asAuditPeriod, auditedEmployees, clerkAuditView, clerkItemDay, periodSpan, reportLockProblem, type AuditPeriod } from "@/lib/daily-audit";
import { getEmployees } from "@/lib/employees";
import { manilaNow } from "@/lib/remittance-deadline";
import { getReportRemarks } from "@/lib/report-remarks";
import { addDeposit, editDeposit, saveCashBeg, saveReportNotes, voidDeposit } from "@/lib/clerk-cash";
import { depositDayProblem } from "@/lib/deposit-day";
import { withEncoder } from "@/lib/encoder-context";
import { createExpense, deleteExpense, editExpense } from "@/lib/finance-data";
import { getBranches } from "@/lib/google-sheets-data";
import { expensePhotoIds, expensePhotosFrom, saveExpensePhotos } from "@/lib/receipt-photos";
import { createFidelitySlip, editFidelitySlip, voidFidelitySlip } from "@/lib/remittance-workflow";

const text = (value: unknown) => String(value ?? "").trim();
const same = (a: unknown, b: unknown) => text(a).toLowerCase() === text(b).toLowerCase();

/**
 * Reports are per branch (owner, October 13, 2026): a clerk assigned to several branches gets each branch's report.
 * The branches a clerk can choose are their primary branch and the branches they are assigned to in Employees (owner:
 * only the assigned ones; entries encoded for another branch show under All branches).
 */
async function clerkBranches(employeeId: string) {
  const [employees, branches] = await Promise.all([getEmployees(), getBranches()]);
  const employee = employees.find((item) => item.id === employeeId);
  const assigned = branches.filter((branch) => employee?.branchIds.includes(branch.id)).map((branch) => branch.name);
  const names = [...new Map([employee?.branch ?? "", ...assigned].map(text).filter(Boolean).map((name) => [name.toLowerCase(), name])).values()];
  return { primary: employee?.branch ?? "", names, active: branches.filter((branch) => branch.status === "active").map((branch) => branch.name) };
}

/** Active employees assigned to the branch (every active employee when no branch), for a Fidelity entry's MAS. */
async function masChoices(branchName: string) {
  const [employees, branches] = await Promise.all([getEmployees(), getBranches()]);
  const branch = branches.find((item) => same(item.name, branchName));
  return employees.filter((employee) => employee.status.toLowerCase() === "active" && (!branch || employee.branchIds.includes(branch.id)))
    .map((employee) => ({ id: employee.id, name: employee.name })).sort((a, b) => a.name.localeCompare(b.name));
}

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
    const clerk = employee ?? { employeeId: user.employeeId, name: user.name };
    // ?branch=NAME for one branch, ?branch=all for every branch (Audits); by default the clerk's primary branch.
    const own = await clerkBranches(clerk.employeeId);
    const asked = params.get("branch")?.trim() ?? "";
    const branch = asked.toLowerCase() === "all" ? "" : asked || own.primary || own.names[0] || "";
    const report = await buildClerkReport(kind, date, { ...clerk, branch: own.primary || ("branch" in clerk ? clerk.branch : "") }, branch);
    const branchChoices = [...new Map([...own.names, ...(branch ? [branch] : [])].map((name) => [name.toLowerCase(), name])).values()];
    // Remarks left on this clerk's report for the same period.
    const remarks = (await getReportRemarks(report.from, report.to)).filter((remark) => remark.scope === report.encoder.name);
    // Only the clerk records expenses, deposits and notes, on their own report.
    const isOwn = report.encoder.employeeId === user.employeeId;
    // The audit of this report, so the clerk knows it is approved and its findings (owner, October 27, 2026).
    const audit = await clerkAuditView(report.encoder.employeeId, kind, report.from);
    return Response.json({ success: true, report, remarks, canChoose, isOwn, audit, branch: branch || "all", branchChoices, masChoices: isOwn ? await masChoices(branch) : [], clerks: clerks.map((clerk) => ({ employeeId: clerk.employeeId, name: clerk.name, branch: clerk.branch })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to build the report." }, { status: 400 });
  }
}

/**
 * The days a report action changes, for the audit lock: an expense falls on the day it is recorded (today, or the day an
 * existing one was recorded), a deposit or Fidelity slip on its date (both the old and the new date when edited), notes
 * and Cash Beg on their own period. "" when nothing locks the action.
 */
async function lockedBy(body: Record<string, unknown>, employeeId: string) {
  const days: Array<[string, AuditPeriod]> = [];
  const id = text(body.id), action = text(body.action);
  if (action === "add-expense") days.push([manilaNow().date, "daily"]);
  if (action === "edit-expense" || action === "delete-expense") days.push([await clerkItemDay("expense", id), "daily"]);
  if (action === "add-deposit" || action === "add-fidelity") days.push([text(body.date), "daily"]);
  if (action === "edit-deposit" || action === "edit-fidelity") days.push([text(body.date), "daily"]);
  if (["edit-deposit", "void-deposit"].includes(action)) days.push([await clerkItemDay("deposit", id), "daily"]);
  if (["edit-fidelity", "void-fidelity"].includes(action)) days.push([await clerkItemDay("fidelity", id), "daily"]);
  if (action === "save-notes" || action === "save-cash-beg") {
    const kind = asAuditPeriod(body.kind);
    days.push([periodSpan(kind, text(body.date)).start, kind]);
  }
  for (const [day, from] of days) {
    const problem = await reportLockProblem(employeeId, day, from);
    if (problem) return problem;
  }
  return "";
}

/**
 * What a clerk records on their own report: an expense (saved in Expenses for their branch, so Finance sees it), a
 * cash deposit to the bank, voiding a mistaken deposit, and the report's notes. Always for the signed-in clerk.
 */
export const POST = withEncoder(async (request: Request) => {
  // Day Off locks the day's entries (lib/day-off.ts).
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/reports")) return Response.json({ success: false, message: "You do not have access to reports." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const employees = await getEmployees();
    const me = employees.find((employee) => employee.id === user.employeeId);
    // The branch whose report the clerk is on: an active branch, else their primary branch.
    const { active } = await clerkBranches(user.employeeId);
    const chosen = active.find((name) => same(name, body.branch)) ?? "";
    const clerk = { employeeId: user.employeeId, name: me?.name || user.name, branch: chosen || me?.branch || "" };
    // An approved report is locked for the clerk until an Administrator allows editing it (lib/daily-audit.ts).
    const locked = await lockedBy(body, user.employeeId);
    if (locked) throw new Error(locked);
    switch (body.action) {
      case "add-expense": {
        if (!clerk.branch) throw new Error("Choose the branch of the report, or ask an administrator to set your primary branch in Employees.");
        // At least one photo of the receipt (owner, October 21, 2026).
        const saved = await createExpense({ ...body, branch: clerk.branch, paidBy: "Cash on Hand", paymentMethod: "Cash" });
        return Response.json({ success: true, message: `Expense ${saved.id} saved with ${saved.photos} receipt photo${saved.photos === 1 ? "" : "s"}.` });
      }
      case "add-deposit": {
        const dayProblem = depositDayProblem(body);
        if (dayProblem) throw new Error(dayProblem);
        const saved = await addDeposit(body, clerk);
        return Response.json({ success: true, message: `Deposit ${saved.id} saved.` });
      }
      // Fidelity handed in after the MAS's entries were encoded: its own slip, approved in Remittances (October 13, 2026).
      case "add-fidelity":
      case "edit-fidelity": {
        if (!clerk.branch) throw new Error("Choose the branch of the report.");
        const mas = employees.find((employee) => employee.id === text(body.masEmployeeId));
        if (!mas) throw new Error("Choose the MAS whose Fidelity this is.");
        const input = { masEmployeeId: mas.id, masName: mas.name, amount: Number(body.amount), date: text(body.date), remarks: text(body.remarks) };
        if (body.action === "add-fidelity") {
          const saved = await createFidelitySlip({ ...input, branch: clerk.branch });
          return Response.json({ success: true, message: `Fidelity ${saved.id} saved; it counts in ${mas.name}'s Fidelity once approved in Remittances.` });
        }
        await editFidelitySlip(text(body.id), input, { employeeId: user.employeeId, isAdmin: await canManageUsers() });
        return Response.json({ success: true, message: "Fidelity updated." });
      }
      case "void-fidelity":
        await voidFidelitySlip(text(body.id), text(body.reason), { employeeId: user.employeeId, isAdmin: await canManageUsers() });
        return Response.json({ success: true, message: "Fidelity voided." });
      case "edit-expense": {
        // More receipt photos may be added; an expense saved before photos were required gets one when it is edited.
        const id = text(body.id), photos = expensePhotosFrom(body.photos);
        if (!photos.length && !(await expensePhotoIds()).get(id)?.length) throw new Error("Attach a photo of the receipt.");
        await editExpense(id, body, { employeeId: user.employeeId, isAdmin: await canManageUsers() });
        await saveExpensePhotos(id, photos);
        return Response.json({ success: true, message: photos.length ? `Expense updated; ${photos.length} receipt photo${photos.length === 1 ? "" : "s"} added.` : "Expense updated." });
      }
      case "delete-expense":
        await deleteExpense(String(body.id ?? ""), String(body.reason ?? ""), { employeeId: user.employeeId, isAdmin: await canManageUsers() });
        return Response.json({ success: true, message: "Expense deleted." });
      case "edit-deposit": {
        const dayProblem = depositDayProblem(body);
        if (dayProblem) throw new Error(dayProblem);
        await editDeposit(String(body.id ?? ""), body, { employeeId: user.employeeId, isAdmin: await canManageUsers() });
        return Response.json({ success: true, message: "Deposit updated." });
      }
      case "void-deposit":
        await voidDeposit(String(body.id ?? ""), String(body.reason ?? ""), { employeeId: user.employeeId, isAdmin: await canManageUsers() });
        return Response.json({ success: true, message: "Deposit voided." });
      case "save-notes": {
        const kind = asAuditPeriod(body.kind);
        await saveReportNotes(user.employeeId, kind, periodSpan(kind, String(body.date ?? "")).start, body, chosen);
        return Response.json({ success: true, message: "Report notes saved." });
      }
      case "save-cash-beg": {
        // The clerk's own report only: the Cash Beg they received for this period, with the reason (lib/clerk-cash.ts).
        const kind = asAuditPeriod(body.kind);
        await saveCashBeg(user.employeeId, kind, periodSpan(kind, String(body.date ?? "")).start, body, chosen);
        return Response.json({ success: true, message: body.cashBeg === "" || body.cashBeg === null ? "Cash Beg cleared." : "Cash Beg saved." });
      }
      default:
        return Response.json({ success: false, message: "Unknown report action." }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save." }, { status: 400 });
  }
});
