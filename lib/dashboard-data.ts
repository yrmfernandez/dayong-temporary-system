import type { SessionUser } from "@/lib/auth";
import { todayInManila } from "@/lib/account-rules";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { buildOperationalReport } from "@/lib/reports";
import { getRemittanceDashboard } from "@/lib/remittance-workflow";

const text = (value: unknown) => String(value ?? "").trim();
const date = (value: unknown) => text(value).slice(0, 10);
export type DashboardKind = "admin" | "executive" | "hr" | "finance" | "entry" | "it" | "mas";

export async function getDashboardData(user: SessionUser) {
  const today = todayInManila();
  const from = `${today.slice(0, 7)}-01`;
  const roles = user.roleNames.map((role) => role.trim().toLowerCase());
  const kind: DashboardKind = roles.some((role) => ["administrator", "admin"].includes(role)) ? "admin" : roles.some((role) => ["ceo", "president"].includes(role)) ? "executive" : roles.includes("finance") ? "finance" : roles.some((role) => ["hr", "hr officer"].includes(role)) ? "hr" : roles.some((role) => ["it", "it clerk"].includes(role)) ? "it" : roles.includes("entry clerk") ? "entry" : "mas";
  const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: ["'Employees'!A:M", "'Users'!A:L", "'Branches'!A:Q", "'Members'!A:AH", "'Programs'!A:J", "'Member programs'!A:S", "'Sales'!A:AU", "'Collections'!A:AG"], valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
  const [employees, users, branches, members, programs, enrollments, sales, collections] = response.data.valueRanges?.map((item) => item.values ?? []) ?? [];
  const employee = employees.slice(1).find((row) => text(row[0]) === user.employeeId);
  const employeeName = text(employee?.[1]) || user.username;
  const own = kind === "mas" ? { person: employeeName } : {};
  const [monthReport, remittance] = await Promise.all([buildOperationalReport(from, today, own), getRemittanceDashboard()]);
  const todaySales = monthReport.sales.filter((row) => row.date === today), todayCollections = monthReport.collections.filter((row) => row.date === today);
  const todayActivity = { salesAccounts: todaySales.reduce((sum, row) => sum + row.accounts, 0), salesGross: todaySales.reduce((sum, row) => sum + row.gross, 0), collectionAccounts: todayCollections.reduce((sum, row) => sum + row.accounts, 0), collectionGross: todayCollections.reduce((sum, row) => sum + row.gross, 0) };
  const activeEmployees = employees.slice(1).filter((row) => text(row[0]) && text(row[4]).toLowerCase() === "active");
  const branchStats = [...new Set(activeEmployees.map((row) => text(row[2])).filter(Boolean))].map((branch) => { const staff = activeEmployees.filter((row) => text(row[2]) === branch); return { branch, employees: staff.length, mas: staff.filter((row) => text(row[3]).toLowerCase().includes("mas")).length, collectors: staff.filter((row) => text(row[3]).toLowerCase().includes("collector")).length }; });
  const programNames = new Map(programs.slice(1).map((row) => [text(row[0]), text(row[2]) || text(row[1])]));
  const memberNames = new Map(members.slice(1).map((row) => [text(row[0]), `${text(row[3])} ${text(row[2])}`.trim()]));
  const portfolio = enrollments.slice(1).filter((row) => text(row[0]) && text(row[12]).toLowerCase() === "active" && text(row[6]).toLowerCase() === employeeName.toLowerCase()).slice(0, 8).map((row) => ({ member: memberNames.get(text(row[1])) || text(row[2]), program: programNames.get(text(row[3])) || text(row[3]), branch: text(row[5]), status: text(row[18]) || text(row[12]), doi: date(row[4]) }));
  const recent = [...sales.slice(1).filter((row) => text(row[0])).map((row) => ({ id: text(row[0]), stamp: text(row[46]) || text(row[1]), name: `${text(row[7])} ${text(row[6])}`.trim(), program: programNames.get(text(row[33])) || text(row[33]), type: "New Sale", amount: Number(row[38]) || 0, status: "Saved", encoder: text(row[44]) })), ...collections.slice(1).filter((row) => text(row[0])).map((row) => ({ id: text(row[0]), stamp: text(row[24]) || text(row[9]), name: text(row[4]), program: programNames.get(text(row[5])) || text(row[5]), type: "Collection", amount: Number(row[10]) || 0, status: text(row[28]) || text(row[19]), encoder: text(row[22]) }))].filter((row) => kind !== "entry" || row.encoder === user.employeeId).sort((a, b) => b.stamp.localeCompare(a.stamp)).slice(0, 8);
  return { kind, today, employeeName, monthReport, todayActivity, remittance, recent, portfolio, branchStats, counts: { employees: employees.slice(1).filter((row) => text(row[0])).length, activeEmployees: activeEmployees.length, mas: activeEmployees.filter((row) => text(row[3]).toLowerCase().includes("mas")).length, collectors: activeEmployees.filter((row) => text(row[3]).toLowerCase().includes("collector")).length, users: users.slice(1).filter((row) => text(row[0]) && text(row[5]).toLowerCase() === "active").length, branches: branches.slice(1).filter((row) => text(row[0]) && text(row[12]).toLowerCase() === "active").length, members: members.slice(1).filter((row) => text(row[0])).length, programs: programs.slice(1).filter((row) => text(row[0]) && text(row[4]).toLowerCase() === "active").length }, encodedToday: recent.filter((row) => date(row.stamp) === today).length };
}
