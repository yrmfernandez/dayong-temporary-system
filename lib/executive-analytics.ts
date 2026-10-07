import { addMonths, todayInManila } from "@/lib/account-rules";
import { sql } from "drizzle-orm";

import { PROGRAMS_RANGE, REMITTANCES_RANGE } from "@/lib/sheet-ranges";
import { readSheetRows } from "@/lib/sheets-on-db";
import { getCompanyTargets } from "@/lib/company-targets";
import { manilaDateOf } from "@/lib/remittance-deadline";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => Number(value ?? 0) || 0;
const round = (value: number) => Math.round(value * 100) / 100;
const day = (value: unknown) => text(value).slice(0, 10);
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export const executivePeriods = {
  mtd: { label: "Month to date", months: 1, compare: "vs same days last month" },
  qtd: { label: "Quarter to date", months: 3, compare: "vs same point last quarter" },
  ytd: { label: "Year to date", months: 12, compare: "vs same point last year" },
  "12m": { label: "Last 12 months", months: 12, compare: "vs the 12 months before" },
} as const;
export type ExecutivePeriod = keyof typeof executivePeriods;
export const isExecutivePeriod = (value: unknown): value is ExecutivePeriod => typeof value === "string" && value in executivePeriods;

type Sale = { date: string; branch: string; programId: string; mas: string; amount: number; incentive: number; paymentMode: string; age: number | null; gender: string };
type Collection = { date: string; branch: string; programId: string; person: string; amount: number; remitted: number };
export type Ranked = { key: string; label: string; accounts: number; amount: number; previous: number; share: number };
export type TrendPoint = { month: string; label: string; sales: number; collections: number; accounts: number };

function periodRange(period: ExecutivePeriod, today: string) {
  const [year, month] = today.split("-").map(Number);
  const startMonth = period === "mtd" ? month : period === "qtd" ? Math.floor((month - 1) / 3) * 3 + 1 : period === "ytd" ? 1 : 0;
  const from = period === "12m" ? addMonths(`${today.slice(0, 7)}-01`, -11) : `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const shift = executivePeriods[period].months;
  return { from, to: today, previousFrom: addMonths(from, -shift), previousTo: addMonths(today, -shift) };
}

const change = (current: number, previous: number) => previous ? round(((current - previous) / previous) * 100) : null;

function rank<T>(rows: T[], previousRows: T[], key: (row: T) => string, amount: (row: T) => number, label: (key: string) => string = (value) => value) {
  const groups = new Map<string, Ranked>();
  for (const row of rows) {
    const id = key(row) || "Unassigned";
    const group = groups.get(id) ?? { key: id, label: label(id), accounts: 0, amount: 0, previous: 0, share: 0 };
    group.accounts += 1; group.amount += amount(row);
    groups.set(id, group);
  }
  for (const row of previousRows) {
    const id = key(row) || "Unassigned";
    const group = groups.get(id);
    if (group) group.previous += amount(row);
  }
  const total = [...groups.values()].reduce((sum, group) => sum + group.amount, 0);
  return [...groups.values()].map((group) => ({ ...group, amount: round(group.amount), previous: round(group.previous), share: total ? round((group.amount / total) * 100) : 0 })).sort((a, b) => b.amount - a.amount || b.accounts - a.accounts);
}

const ageBands: Array<[string, number, number]> = [["Under 18", 0, 17], ["18–29", 18, 29], ["30–44", 30, 44], ["45–59", 45, 59], ["60+", 60, 200]];
const accountGroups: Array<[string, string[]]> = [["Current", ["NS", "U", "ADV", "PAID"]], ["60 days", ["60D"]], ["90 days", ["90D"]], ["120+ days", ["120D", "150D"]], ["Forfeited", ["FORFEITED"]]];
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Company-wide sales analytics for the CEO / President dashboard (and, with financeOnly, the Finance dashboard's
 * figures). Sales and Collections are read only from the earliest date the view uses, not their whole history:
 * the previous period, the year's targets and the 12-month trend for the executive view; just the selected period for
 * Finance, which shows only the finance and cash figures and so also skips members, enrollments and programs.
 */
export async function getExecutiveAnalytics(period: ExecutivePeriod, { financeOnly = false }: { financeOnly?: boolean } = {}) {
  const today = todayInManila();
  const range = periodRange(period, today);
  const since = financeOnly ? range.from : [range.previousFrom, `${today.slice(0, 4)}-01-01`, addMonths(`${today.slice(0, 7)}-01`, -11)].sort()[0];
  const ledgerRanges = ["'Expenses'!A:Q", REMITTANCES_RANGE, "'Cash Transactions'!A:P", "'Cash Accounts'!A:E", "'Payroll Runs'!A:X", "'Payroll Lines'!A:X", "'Vendor Payables'!A:O"];
  const catalogRanges = financeOnly ? [] : [PROGRAMS_RANGE, "'Member programs'!A:S", "'Branches'!A:M", "'Members'!A:A"];
  const [salesRows, collectionRows, response, targets] = await Promise.all([
    // A sale's date is its Manila date, which can be the day after its UTC date: one day of margin.
    readSheetRows("Sales", sql`date_created >= (${since}::date - 1)`),
    // Only the columns used below (the remittance breakdown alone is most of each row).
    readSheetRows("Collections", sql`or_date >= ${since}::date`, { only: ["collection_id", "program_id", "branch", "mas", "or_date", "amount_collected", "status", "remittance_amount", "accountable_name"] }),
    sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: [...ledgerRanges, ...catalogRanges], valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" }),
    getCompanyTargets(),
  ]);
  const values = response.data.valueRanges?.map((item) => item.values ?? []) ?? [];
  const [expenseRows, remittanceRows, cashRows, cashAccountRows, payrollRunRows, payrollLineRows, payableRows] = values;
  const [programRows = [], enrollmentRows = [], branchRows = [], memberRows = []] = values.slice(ledgerRanges.length);

  const programNames = new Map(programRows.slice(1).filter((row) => text(row[0])).map((row) => [text(row[0]), text(row[2]) || text(row[1]) || text(row[0])]));
  const branchNames = new Map(branchRows.slice(1).filter((row) => text(row[0])).map((row) => [text(row[0]), text(row[1]) || text(row[0])]));
  const programLabel = (id: string) => programNames.get(id) ?? id;
  const branchLabel = (value: string) => branchNames.get(value) ?? value;

  // A sale counts on its Manila date (date_created is stored in UTC; before 8:00 AM Manila it is still the previous UTC day).
  const sales: Sale[] = salesRows.slice(1).filter((row) => text(row[0]) && validDay(manilaDateOf(text(row[1])))).map((row) => {
    const age = Number.parseInt(text(row[13]), 10);
    return { date: manilaDateOf(text(row[1])), branch: branchLabel(text(row[2])), programId: text(row[21]), mas: text(row[3]), amount: number(row[26]) + number(row[38]), incentive: text(row[41]) === "" ? 0 : Math.max(0, number(row[26]) - number(row[41])), paymentMode: text(row[23]) || "Not recorded", age: Number.isFinite(age) && age >= 0 && age < 130 ? age : null, gender: text(row[12]) };
  });
  const collections: Collection[] = collectionRows.slice(1).filter((row) => text(row[0]) && text(row[19]).toLowerCase() === "posted" && validDay(day(row[9]))).map((row) => ({
    date: day(row[9]), branch: branchLabel(text(row[6])), programId: text(row[5]), person: text(row[31]) || text(row[7]), amount: number(row[10]), remitted: number(row[26]) || number(row[10]),
  }));

  const within = (from: string, to: string) => <T extends { date: string }>(row: T) => row.date >= from && row.date <= to;
  const current = within(range.from, range.to), previous = within(range.previousFrom, range.previousTo);
  const periodSales = sales.filter(current), previousSales = sales.filter(previous);
  const periodCollections = collections.filter(current), previousCollections = collections.filter(previous);
  const sum = <T,>(rows: T[], value: (row: T) => number) => round(rows.reduce((total, row) => total + value(row), 0));

  const salesGross = sum(periodSales, (row) => row.amount), previousSalesGross = sum(previousSales, (row) => row.amount);
  const collectionGross = sum(periodCollections, (row) => row.amount), previousCollectionGross = sum(previousCollections, (row) => row.amount);
  const inPeriod = (date: string) => date >= range.from && date <= range.to;
  // Agent commissions: incentives kept on Collections and on New Sales (Sales AO/AP).
  const agentIncentives = (salesRows: Sale[], collectionRows: Collection[]) => round(sum(salesRows, (row) => row.incentive) + sum(collectionRows, (row) => Math.max(0, row.amount - row.remitted)));
  const commissions = agentIncentives(periodSales, periodCollections);
  const postedExpenses = expenseRows.slice(1).filter((row) => text(row[0]) && text(row[11]).toLowerCase() === "posted");
  const expenses = round(postedExpenses.filter((row) => inPeriod(day(row[1]))).reduce((total, row) => total + number(row[4]), 0));
  // Paid payroll by pay date. Commission inside payroll is left out: agent incentives are already deducted to reach Net Sales.
  const payrollCommission = new Map<string, number>();
  for (const row of payrollLineRows.slice(1)) if (text(row[0]) && (text(row[23]) || "active") === "active") payrollCommission.set(text(row[1]), (payrollCommission.get(text(row[1])) ?? 0) + number(row[20]));
  const payroll = round(payrollRunRows.slice(1).filter((row) => text(row[0]) && text(row[4]) === "Paid" && inPeriod(day(row[3]))).reduce((total, row) => total + Math.max(0, number(row[9]) - (payrollCommission.get(text(row[0])) ?? 0)), 0));
  const vendorBills = round(payableRows.slice(1).filter((row) => text(row[0]) && !/void|cancel/i.test(text(row[10])) && inPeriod(day(row[1]))).reduce((total, row) => total + number(row[6]), 0));
  const grossSales = round(salesGross + collectionGross), netSales = round(grossSales - commissions);
  const operatingCosts = round(payroll + expenses + vendorBills), ebitda = round(netSales - operatingCosts);

  // Cash position from the ledger: opening balances, approved remittances in, posted expenses out, manual movements.
  const cashMoves: Array<{ date: string; amount: number }> = [
    ...remittanceRows.slice(1).filter((row) => text(row[0]) && text(row[4]) === "Approved").map((row) => ({ date: day(row[3]), amount: number(row[11]) })),
    ...postedExpenses.map((row) => ({ date: day(row[1]), amount: -number(row[4]) })),
    ...cashRows.slice(1).filter((row) => text(row[0]) && (text(row[10]) || "Posted").toLowerCase() === "posted").map((row) => ({ date: day(row[1]), amount: text(row[2]) === "outflow" ? -number(row[5]) : number(row[5]) })),
  ];
  const openingCash = cashAccountRows.slice(1).filter((row) => text(row[0]) && text(row[4]).toLowerCase() !== "inactive").reduce((total, row) => total + number(row[3]), 0);
  const cashOnHand = round(openingCash + cashMoves.filter((move) => move.date <= today).reduce((total, move) => total + move.amount, 0));
  // Burn over the three complete months before this one.
  const burnFrom = addMonths(`${today.slice(0, 7)}-01`, -3), burnTo = `${today.slice(0, 7)}-01`;
  const burnMoves = cashMoves.filter((move) => move.date >= burnFrom && move.date < burnTo);
  const monthlyOutflow = round(Math.abs(burnMoves.filter((move) => move.amount < 0).reduce((total, move) => total + move.amount, 0)) / 3);
  const monthlyInflow = round(burnMoves.filter((move) => move.amount > 0).reduce((total, move) => total + move.amount, 0) / 3);
  const netBurn = round(monthlyOutflow - monthlyInflow);

  // Recurring dues: the monthly program rate of every active account that still owes installments.
  const basePay = new Map(programRows.slice(1).filter((row) => text(row[0])).map((row) => [text(row[0]), number(row[3])]));
  const paying = enrollmentRows.slice(1).filter((row) => text(row[0]) && text(row[12]).toLowerCase() === "active" && !["PAID", "FORFEITED"].includes(text(row[18]).toUpperCase()));
  const monthlyDues = round(paying.reduce((total, row) => total + (basePay.get(text(row[3])) ?? 0), 0));

  // Targets for the current quarter and year, measured on Gross Sales to date and paced by elapsed days.
  const quarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1, year = today.slice(0, 4);
  const dayMs = 86400000, time = (date: string) => Date.parse(`${date}T00:00:00Z`);
  const progress = (key: string, label: string, start: string, end: string) => {
    const achieved = sum([...sales, ...collections].filter((row) => row.date >= start && row.date <= today), (row) => row.amount);
    const accounts = sales.filter((row) => row.date >= start && row.date <= today).length;
    const target = targets.get(key), fraction = Math.min(1, Math.max(0, (time(today) - time(start) + dayMs) / (time(end) - time(start) + dayMs)));
    return { key, label, start, end, achieved, accounts, target: target?.grossSales ?? 0, accountsTarget: target?.newAccounts ?? 0, notes: target?.notes ?? "", elapsed: round(fraction * 100), projected: fraction ? round(achieved / fraction) : 0 };
  };
  const quarterStart = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01`;
  const quarterEnd = new Date(Date.UTC(Number(year), quarter * 3, 0)).toISOString().slice(0, 10);
  const approved = remittanceRows.slice(1).filter((row) => text(row[0]) && text(row[4]) === "Approved" && day(row[3]) >= range.from && day(row[3]) <= range.to);
  const actualRemittance = round(approved.reduce((total, row) => total + number(row[11]), 0));
  const expectedRemittance = round(approved.reduce((total, row) => total + number(row[10]), 0));
  const pendingRemittances = remittanceRows.slice(1).filter((row) => text(row[0]) && ["Pending Approval", "Discrepancy"].includes(text(row[4])));

  // Twelve calendar months ending this month, independent of the selected period.
  const firstMonth = addMonths(`${today.slice(0, 7)}-01`, -11).slice(0, 7);
  const trend: TrendPoint[] = Array.from({ length: 12 }, (_, index) => {
    const month = addMonths(`${firstMonth}-01`, index).slice(0, 7);
    const monthSales = sales.filter((row) => row.date.startsWith(month));
    const label = new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    return { month, label, sales: sum(monthSales, (row) => row.amount), collections: sum(collections.filter((row) => row.date.startsWith(month)), (row) => row.amount), accounts: monthSales.length };
  });

  const activeEnrollments = enrollmentRows.slice(1).filter((row) => text(row[0]) && text(row[12]).toLowerCase() === "active");
  const accountHealth = accountGroups.map(([label, codes]) => ({ label, count: activeEnrollments.filter((row) => codes.includes((text(row[18]) || "NS").toUpperCase())).length }));
  const tracked = accountHealth.reduce((total, group) => total + group.count, 0);
  const healthByProgram = rank(activeEnrollments, [], (row) => text(row[3]), () => 0, programLabel).map((group) => {
    const rows = activeEnrollments.filter((row) => (text(row[3]) || "Unassigned") === group.key);
    const late = rows.filter((row) => ["60D", "90D", "120D", "150D", "FORFEITED"].includes(text(row[18]).toUpperCase())).length;
    return { label: group.label, active: rows.length, late, lateRate: rows.length ? round((late / rows.length) * 100) : 0 };
  }).sort((a, b) => b.active - a.active);

  const ages = periodSales.filter((row) => row.age !== null);
  const genders = rank(periodSales.filter((row) => row.gender), [], (row) => row.gender.charAt(0).toUpperCase() + row.gender.slice(1).toLowerCase(), () => 1);

  return {
    period, periodLabel: executivePeriods[period].label, compareLabel: executivePeriods[period].compare, ...range, today,
    kpis: {
      grossSales: { value: grossSales, change: change(grossSales, previousSalesGross + previousCollectionGross) },
      netSales: { value: netSales, change: change(netSales, previousSalesGross + previousCollectionGross - agentIncentives(previousSales, previousCollections)) },
      salesGross: { value: salesGross, change: change(salesGross, previousSalesGross) },
      newAccounts: { value: periodSales.length, change: change(periodSales.length, previousSales.length) },
      averageSale: { value: periodSales.length ? round(salesGross / periodSales.length) : 0, change: change(periodSales.length ? salesGross / periodSales.length : 0, previousSales.length ? previousSalesGross / previousSales.length : 0) },
      collectionGross: { value: collectionGross, change: change(collectionGross, previousCollectionGross) },
      collectionCount: periodCollections.length,
      activeAccounts: activeEnrollments.length,
      members: memberRows.slice(1).filter((row) => text(row[0])).length,
      currentRate: tracked ? round((accountHealth[0].count / tracked) * 100) : 0,
    },
    finance: { grossSales, netSales, commissions, payroll, expenses, vendorBills, operatingCosts, ebitda, margin: grossSales ? round((ebitda / grossSales) * 100) : null, expectedRemittance, actualRemittance, gap: round(expectedRemittance - actualRemittance), pendingCount: pendingRemittances.length, pendingAmount: round(pendingRemittances.reduce((total, row) => total + number(row[10]), 0)) },
    cash: { onHand: cashOnHand, monthlyOutflow, monthlyInflow, netBurn, runwayMonths: netBurn > 0 ? round(cashOnHand / netBurn) : null, coverMonths: monthlyOutflow > 0 ? round(cashOnHand / monthlyOutflow) : null },
    recurring: { monthly: monthlyDues, annual: round(monthlyDues * 12), accounts: paying.length },
    targets: [progress(`${year}-Q${quarter}`, `Q${quarter} ${year}`, quarterStart, quarterEnd), progress(year, `Year ${year}`, `${year}-01-01`, `${year}-12-31`)],
    trend,
    programs: rank(periodSales, previousSales, (row) => row.programId, (row) => row.amount, programLabel),
    programCollections: rank(periodCollections, previousCollections, (row) => row.programId, (row) => row.amount, programLabel),
    branches: rank([...periodSales, ...periodCollections], [...previousSales, ...previousCollections], (row) => row.branch, (row) => row.amount).map((branch) => ({ ...branch, sales: sum(periodSales.filter((row) => (row.branch || "Unassigned") === branch.key), (row) => row.amount), newAccounts: periodSales.filter((row) => (row.branch || "Unassigned") === branch.key).length, collections: sum(periodCollections.filter((row) => (row.branch || "Unassigned") === branch.key), (row) => row.amount) })),
    salesPeople: rank(periodSales, previousSales, (row) => row.mas, (row) => row.amount).slice(0, 10),
    collectors: rank(periodCollections, previousCollections, (row) => row.person, (row) => row.amount).slice(0, 10),
    paymentModes: rank(periodSales, [], (row) => row.paymentMode, (row) => row.amount),
    weekdays: weekdays.map((label, index) => { const rows = periodSales.filter((row) => new Date(`${row.date}T00:00:00Z`).getUTCDay() === index); return { label, accounts: rows.length, amount: sum(rows, (row) => row.amount) }; }),
    ageBands: ageBands.map(([label, min, max]) => ({ label, accounts: ages.filter((row) => row.age! >= min && row.age! <= max).length })),
    genders,
    accountHealth, trackedAccounts: tracked, healthByProgram,
  };
}
export type ExecutiveAnalytics = Awaited<ReturnType<typeof getExecutiveAnalytics>>;
