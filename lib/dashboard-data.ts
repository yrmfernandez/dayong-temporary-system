import type { SessionUser } from "@/lib/auth";
import { todayInManila } from "@/lib/account-rules";
import type { DashboardKind } from "@/lib/access-control";
import { getAttendanceRecordsForDate } from "@/lib/attendance-data";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { getAllLeaveRequests } from "@/lib/leave-data";
import { readUserRows, USERS_RANGE } from "@/lib/users-sheet";
import { buildOperationalReport } from "@/lib/reports";
import { getRemittanceDashboard } from "@/lib/remittance-workflow";
import { getTodayMode, TODAY_MODE_LABELS } from "@/lib/system-settings";
import { getEntriesForDay } from "@/lib/todays-entries";

const text = (value: unknown) => String(value ?? "").trim();
const date = (value: unknown) => text(value).slice(0, 10);
const manilaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });
// Encoded-at stamps are UTC ISO times; entries made after midnight in Manila belong to the Manila date.
const manilaDate = (stamp: string) => /T\d{2}:/.test(stamp) && !Number.isNaN(Date.parse(stamp)) ? manilaDay.format(new Date(stamp)) : date(stamp);
export { dashboardKind, type DashboardKind } from "@/lib/access-control";

const lateStatuses = ["60D", "90D", "120D", "150D"];

/** Data for the operational dashboards (admin, HR, entry, MAS, collector). Each role reads only what it shows. */
export async function getDashboardData(user: SessionUser, kind: DashboardKind) {
  const today = todayInManila();
  const from = `${today.slice(0, 7)}-01`;
  const needsSales = ["admin", "entry", "mas", "collector"].includes(kind);
  const ranges = ["'Employees'!A:M", ...(kind === "admin" ? [USERS_RANGE, "'Branches'!A:Q", "'Members'!A:V"] : []), ...(needsSales ? ["'Programs'!A:J", "'Member programs'!A:S", "'Sales'!A:AI", "'Collections'!A:AG", "'Members'!A:V"] : [])];
  const unique = [...new Set(ranges)];
  const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: unique, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
  const byRange = new Map(unique.map((range, index) => [range, response.data.valueRanges?.[index]?.values ?? []]));
  const sheet = (range: string) => byRange.get(range) ?? [];
  const employees = sheet("'Employees'!A:M"), members = sheet("'Members'!A:V"), programs = sheet("'Programs'!A:J"), enrollments = sheet("'Member programs'!A:S"), sales = sheet("'Sales'!A:AI"), collections = sheet("'Collections'!A:AG");

  const employee = employees.slice(1).find((row) => text(row[0]) === user.employeeId);
  const employeeName = text(employee?.[1]) || user.name;
  const own = (value: unknown) => text(value).toLowerCase() === employeeName.toLowerCase();
  const activeEmployees = employees.slice(1).filter((row) => text(row[0]) && text(row[4]).toLowerCase() === "active");
  const hasRole = (row: unknown[], role: string) => text(row[3]).toLowerCase().split(",").map((item) => item.trim()).includes(role);
  const branchStats = [...new Set(activeEmployees.map((row) => text(row[2])).filter(Boolean))].sort().map((branch) => { const staff = activeEmployees.filter((row) => text(row[2]) === branch); return { branch, employees: staff.length, mas: staff.filter((row) => hasRole(row, "mas")).length, collectors: staff.filter((row) => hasRole(row, "collector")).length }; });
  const counts = { employees: employees.slice(1).filter((row) => text(row[0])).length, activeEmployees: activeEmployees.length, mas: activeEmployees.filter((row) => hasRole(row, "mas")).length, collectors: activeEmployees.filter((row) => hasRole(row, "collector")).length, users: kind === "admin" ? readUserRows(sheet(USERS_RANGE)).users.filter((row) => row.status === "active").length : 0, branches: sheet("'Branches'!A:Q").slice(1).filter((row) => text(row[0]) && text(row[12]).toLowerCase() === "active").length, members: members.slice(1).filter((row) => text(row[0])).length, programs: programs.slice(1).filter((row) => text(row[0]) && text(row[4]).toLowerCase() === "active").length, portfolio: 0 };

  // Sales and collection activity, scoped to the person for MAS and Collector dashboards.
  const scope = kind === "mas" ? { person: employeeName } : kind === "collector" ? { person: employeeName } : {};
  // "Today" follows the company setting (remittance date unless an administrator chose encoded or OR date).
  const todayMode = needsSales ? await getTodayMode() : "remittance";
  const [monthReport, remittance, todayEntries] = needsSales ? await Promise.all([buildOperationalReport(from, today, scope), kind === "admin" || kind === "entry" ? getRemittanceDashboard() : Promise.resolve(null), getEntriesForDay(today, todayMode, scope.person ?? "")]) : [null, null, null];
  const todayActivity = { salesAccounts: todayEntries?.sales.count ?? 0, salesGross: todayEntries?.sales.amount ?? 0, collectionAccounts: todayEntries?.collections.count ?? 0, collectionGross: todayEntries?.collections.amount ?? 0, basis: TODAY_MODE_LABELS[todayMode] };

  const programNames = new Map(programs.slice(1).map((row) => [text(row[0]), text(row[2]) || text(row[1])]));
  const memberNames = new Map(members.slice(1).map((row) => [text(row[0]), `${text(row[3])} ${text(row[2])}`.trim()]));
  const portfolioRows = kind === "mas" ? enrollments.slice(1).filter((row) => text(row[0]) && text(row[12]).toLowerCase() === "active" && own(row[6])) : [];
  counts.portfolio = portfolioRows.length;
  const describe = (row: unknown[]) => ({ member: memberNames.get(text(row[1])) || text(row[2]), program: programNames.get(text(row[3])) || text(row[3]), branch: text(row[5]), status: text(row[18]) || "NS", doi: date(row[4]) });
  const portfolio = portfolioRows.slice(0, 8).map(describe);
  const followUp = portfolioRows.filter((row) => lateStatuses.includes(text(row[18]).toUpperCase())).sort((a, b) => lateStatuses.indexOf(text(b[18]).toUpperCase()) - lateStatuses.indexOf(text(a[18]).toUpperCase())).slice(0, 10).map(describe);
  const portfolioHealth = ["NS", "U", "ADV", ...lateStatuses, "FORFEITED"].map((status) => ({ status, count: portfolioRows.filter((row) => (text(row[18]) || "NS").toUpperCase() === status).length })).filter((item) => item.count);

  const activity = !needsSales ? [] : [
    ...sales.slice(1).filter((row) => text(row[0])).map((row) => ({ id: text(row[0]), stamp: text(row[34]) || text(row[1]), name: `${text(row[7])} ${text(row[6])}`.trim(), program: programNames.get(text(row[21])) || text(row[21]), type: "New Sale", amount: Number(row[26]) || 0, status: "Saved", encoder: text(row[32]), person: text(row[3]) })),
    ...collections.slice(1).filter((row) => text(row[0])).map((row) => ({ id: text(row[0]), stamp: text(row[24]) || text(row[9]), name: text(row[4]), program: programNames.get(text(row[5])) || text(row[5]), type: "Collection", amount: Number(row[10]) || 0, status: text(row[28]) || text(row[19]), encoder: text(row[22]), person: text(row[31]) || text(row[7]) })),
  ].filter((row) => kind === "entry" ? row.encoder === user.employeeId : kind === "mas" || kind === "collector" ? own(row.person) : true)
    .sort((a, b) => b.stamp.localeCompare(a.stamp));
  const recent = activity.slice(0, 8);

  // HR: today's attendance and leave requests waiting for a decision.
  let people = null;
  if (kind === "hr") {
    const [records, leaves] = await Promise.all([getAttendanceRecordsForDate(today), getAllLeaveRequests()]);
    const byEmployee = new Map(records.map((record) => [record.employeeId, record]));
    const names = new Map(activeEmployees.map((row) => [text(row[0]), text(row[1])]));
    const present = records.filter((record) => record.status === "Present" && record.timeIn);
    const pendingLeaves = leaves.filter(({ request }) => request.approvalStatus === "Pending").map(({ request }) => ({ ...request, name: names.get(request.employeeId) || request.employeeId }));
    people = {
      present: present.length, late: present.filter((record) => record.lateMinutes > 0).length, onLeave: records.filter((record) => record.status === "Leave").length,
      absent: records.filter((record) => record.status === "Absent" || record.status === "AWOL").length,
      notClockedIn: activeEmployees.filter((row) => !byEmployee.has(text(row[0]))).length,
      lateList: present.filter((record) => record.lateMinutes > 0).sort((a, b) => b.lateMinutes - a.lateMinutes).slice(0, 8).map((record) => ({ name: names.get(record.employeeId) || record.employeeId, branch: record.branch, timeIn: record.timeIn, lateMinutes: record.lateMinutes })),
      pendingLeaves: pendingLeaves.slice(0, 8), pendingLeaveCount: pendingLeaves.length,
    };
  }

  return { kind, today, employeeName, monthReport, todayActivity, remittance, recent, portfolio, followUp, portfolioHealth, branchStats, counts, people, encodedToday: activity.filter((row) => manilaDate(row.stamp) === today).length };
}
export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
