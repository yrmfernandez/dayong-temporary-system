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
import { PROGRAMS_RANGE } from "@/lib/sheet-ranges";
import { countSheetRows, readSheetRows } from "@/lib/sheets-on-db";
import { sql } from "drizzle-orm";

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
  // Large sheets use the shared ranges (lib/sheet-ranges.ts), so the report, remittances and today's counts below reuse
  // this read instead of fetching Collections again. Member programs is only needed for the MAS portfolio.
  // Sales, Collections and Members are not read whole: recent activity takes the newest rows in the user's scope, and
  // the member count and portfolio names come from the database directly (below).
  const ranges = ["'Employees'!A:M", ...(kind === "admin" ? [USERS_RANGE, "'Branches'!A:Q"] : []), ...(needsSales ? [PROGRAMS_RANGE] : []), ...(kind === "mas" ? ["'Member programs'!A:S"] : [])];
  const unique = [...new Set(ranges)];
  const read = (list: string[]) => sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: list, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
  // Start everything that does not depend on who the user is at once, instead of one step after another.
  const mainRead = read(unique);
  const todayModeRead = needsSales ? getTodayMode() : Promise.resolve("remittance" as const);
  const remittanceRead = needsSales && (kind === "admin" || kind === "entry") ? getRemittanceDashboard() : Promise.resolve(null);
  // Their errors surface in the Promise.all below; this only stops an early failure from leaving them unhandled.
  for (const pending of [mainRead, todayModeRead, remittanceRead]) pending.catch(() => undefined);
  // MAS and Collector dashboards are scoped to the person, so their name comes first (a small, cached read).
  const employeeRows = (await read(["'Employees'!A:M"])).data.valueRanges?.[0]?.values ?? [];
  const personName = text(employeeRows.slice(1).find((row) => text(row[0]) === user.employeeId)?.[1]) || user.name;
  const scope = kind === "mas" || kind === "collector" ? { person: personName } : {};
  const reportRead = needsSales ? buildOperationalReport(from, today, scope) : Promise.resolve(null);
  const entriesRead = needsSales ? todayModeRead.then((mode) => getEntriesForDay(today, mode, "person" in scope ? scope.person : "")) : Promise.resolve(null);
  const [response, todayMode, monthReport, remittance, todayEntries] = await Promise.all([mainRead, todayModeRead, reportRead, remittanceRead, entriesRead]);
  const byRange = new Map(unique.map((range, index) => [range, response.data.valueRanges?.[index]?.values ?? []]));
  const sheet = (range: string) => byRange.get(range) ?? [];
  const employees = sheet("'Employees'!A:M"), programs = sheet(PROGRAMS_RANGE), enrollments = sheet("'Member programs'!A:S");
  // Recent activity: the newest sales and collections in this user's scope.
  const lowerName = personName.toLowerCase();
  const salesScope = kind === "entry" ? sql`encoded_by_employee_id = ${user.employeeId}` : kind === "mas" || kind === "collector" ? sql`lower(trim(mas)) = ${lowerName}` : sql`true`;
  const collectionsScope = kind === "entry" ? sql`encoded_by_employee_id = ${user.employeeId}` : kind === "mas" || kind === "collector" ? sql`lower(trim(coalesce(nullif(trim(accountable_name), ''), mas))) = ${lowerName}` : sql`true`;
  const [sales, collections, memberCount] = needsSales
    ? await Promise.all([readSheetRows("Sales", salesScope, { latest: 40 }), readSheetRows("Collections", collectionsScope, { latest: 40 }), kind === "admin" ? countSheetRows("Members") : Promise.resolve(0)])
    : [[[]], [[]], kind === "admin" ? await countSheetRows("Members") : 0];

  const employee = employees.slice(1).find((row) => text(row[0]) === user.employeeId);
  const employeeName = text(employee?.[1]) || user.name;
  const own = (value: unknown) => text(value).toLowerCase() === employeeName.toLowerCase();
  const activeEmployees = employees.slice(1).filter((row) => text(row[0]) && text(row[4]).toLowerCase() === "active");
  const hasRole = (row: unknown[], role: string) => text(row[3]).toLowerCase().split(",").map((item) => item.trim()).includes(role);
  const branchStats = [...new Set(activeEmployees.map((row) => text(row[2])).filter(Boolean))].sort().map((branch) => { const staff = activeEmployees.filter((row) => text(row[2]) === branch); return { branch, employees: staff.length, mas: staff.filter((row) => hasRole(row, "mas")).length, collectors: staff.filter((row) => hasRole(row, "collector")).length }; });
  const counts = { employees: employees.slice(1).filter((row) => text(row[0])).length, activeEmployees: activeEmployees.length, mas: activeEmployees.filter((row) => hasRole(row, "mas")).length, collectors: activeEmployees.filter((row) => hasRole(row, "collector")).length, users: kind === "admin" ? readUserRows(sheet(USERS_RANGE)).users.filter((row) => row.status === "active").length : 0, branches: sheet("'Branches'!A:Q").slice(1).filter((row) => text(row[0]) && text(row[12]).toLowerCase() === "active").length, members: memberCount, programs: programs.slice(1).filter((row) => text(row[0]) && text(row[4]).toLowerCase() === "active").length, portfolio: 0 };

  // Sales and collection activity above is scoped to the person for MAS and Collector dashboards. "Today" follows the
  // company setting (remittance date unless an administrator chose encoded or OR date).
  const todayActivity = { salesAccounts: todayEntries?.sales.count ?? 0, salesGross: todayEntries?.sales.amount ?? 0, collectionAccounts: todayEntries?.collections.count ?? 0, collectionGross: todayEntries?.collections.amount ?? 0, basis: TODAY_MODE_LABELS[todayMode] };

  const programNames = new Map(programs.slice(1).map((row) => [text(row[0]), text(row[2]) || text(row[1])]));
  const portfolioRows = kind === "mas" ? enrollments.slice(1).filter((row) => text(row[0]) && text(row[12]).toLowerCase() === "active" && own(row[6])) : [];
  // Names only for the members in this MAS's portfolio.
  const portfolioIds = [...new Set(portfolioRows.map((row) => text(row[1])).filter(Boolean))];
  const members = portfolioIds.length ? await readSheetRows("Members", sql`member_id in (${sql.join(portfolioIds.map((id) => sql`${id}`), sql`, `)})`) : [[]];
  const memberNames = new Map(members.slice(1).map((row) => [text(row[0]), `${text(row[3])} ${text(row[2])}`.trim()]));
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
