import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => Number(value ?? 0) || 0;
const round = (value: number) => Math.round(value * 100) / 100;

export type ReportLine = { date: string; branch: string; programId: string; programName: string; person: string; role: string; accounts: number; gross: number; masCommission: number; collectorCommission: number; incentives: number; fidelity: number; net: number; expectedRemittance: number };
export type ReportSummary = { accounts: number; gross: number; masCommission: number; collectorCommission: number; incentives: number; fidelity: number; net: number; expenses: number; expectedRemittance: number; actualRemittance: number; deposits: number; difference: number };

function summarize(lines: ReportLine[], expenses: number, actualRemittance: number, deposits: number): ReportSummary {
  const total = (key: keyof ReportLine) => round(lines.reduce((sum, line) => sum + Number(line[key] ?? 0), 0));
  const net = total("net");
  const expectedRemittance = round(net - expenses);
  return { accounts: total("accounts"), gross: total("gross"), masCommission: total("masCommission"), collectorCommission: total("collectorCommission"), incentives: total("incentives"), fidelity: total("fidelity"), net, expenses: round(expenses), expectedRemittance, actualRemittance: round(actualRemittance), deposits: round(deposits), difference: round(expectedRemittance - actualRemittance) };
}

function aggregate(lines: ReportLine[], key: (line: ReportLine) => string) {
  const groups = new Map<string, ReportLine>();
  for (const line of lines) {
    const id = key(line); const current = groups.get(id);
    if (!current) { groups.set(id, { ...line }); continue; }
    current.accounts += line.accounts; current.gross += line.gross; current.masCommission += line.masCommission;
    current.collectorCommission += line.collectorCommission; current.incentives += line.incentives;
    current.fidelity += line.fidelity; current.net += line.net; current.expectedRemittance += line.expectedRemittance;
  }
  return [...groups.values()].map((line) => Object.fromEntries(Object.entries(line).map(([key, value]) => [key, typeof value === "number" ? round(value) : value])) as ReportLine);
}

export async function buildOperationalReport(from: string, to: string, filters: { branch?: string; programId?: string; person?: string } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error("Choose a valid report date range.");
  const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: ["'Sales'!A:AQ", "'Collections'!A:AG", "'Programs'!A:F", "'Remittances'!A:X", "'Expenses'!A:Q", "'Cash Transactions'!A:P"], valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
  const [sales, collections, programs, remittances, expenses, cash] = response.data.valueRanges?.map((range) => range.values ?? []) ?? [];
  const programNames = new Map(programs.slice(1).map((row) => [text(row[0]), text(row[2]) || text(row[1])]));
  const inRange = (date: string) => date >= from && date <= to;
  const matches = (branch: string, programId: string, person: string) => (!filters.branch || branch === filters.branch) && (!filters.programId || programId === filters.programId) && (!filters.person || person === filters.person);
  const salesLines: ReportLine[] = sales.slice(1).filter((row) => text(row[0])).map((row) => {
    const date = text(row[1]).slice(0, 10), branch = text(row[2]), person = text(row[3]), programId = text(row[33]), gross = number(row[38]);
    return { date, branch, programId, programName: programNames.get(programId) || programId, person, role: "MAS", accounts: 1, gross, masCommission: 0, collectorCommission: 0, incentives: 0, fidelity: 0, net: gross, expectedRemittance: gross };
  }).filter((line) => inRange(line.date) && matches(line.branch, line.programId, line.person));
  const collectionLines: ReportLine[] = collections.slice(1).filter((row) => text(row[0]) && text(row[19]).toLowerCase() === "posted").map((row) => {
    const date = text(row[9]).slice(0, 10), branch = text(row[6]), programId = text(row[5]), person = text(row[31]) || text(row[7]), role = text(row[32]) || text(row[25]) || "MAS", gross = number(row[10]), expected = number(row[26]) || gross;
    const incentives = Math.max(0, round(gross - expected));
    return { date, branch, programId, programName: programNames.get(programId) || programId, person, role, accounts: 1, gross, masCommission: role.toLowerCase() === "collector" ? 0 : incentives, collectorCommission: role.toLowerCase() === "collector" ? incentives : 0, incentives, fidelity: 0, net: expected, expectedRemittance: expected };
  }).filter((line) => inRange(line.date) && matches(line.branch, line.programId, line.person));
  const postedExpenses = expenses.slice(1).filter((row) => text(row[0]) && text(row[11]).toLowerCase() === "posted" && inRange(text(row[1]).slice(0, 10)) && (!filters.branch || text(row[7]) === filters.branch)).reduce((sum, row) => sum + number(row[4]), 0);
  const approvedRemittances = remittances.slice(1).filter((row) => text(row[0]) && text(row[4]) === "Approved" && inRange(text(row[3]).slice(0, 10)) && (!filters.branch || text(row[1]) === filters.branch)).reduce((sum, row) => sum + number(row[11]), 0);
  const deposits = cash.slice(1).filter((row) => text(row[0]) && text(row[2]) === "inflow" && text(row[3]).toLowerCase().includes("deposit") && text(row[10]).toLowerCase() === "posted" && inRange(text(row[1]).slice(0, 10)) && (!filters.branch || text(row[6]) === filters.branch)).reduce((sum, row) => sum + number(row[5]), 0);
  const allLines = [...salesLines, ...collectionLines];
  return {
    from, to, generatedAt: new Date().toISOString(), filters,
    options: { branches: [...new Set(allLines.map((line) => line.branch).filter(Boolean))].sort(), programs: [...new Map(allLines.filter((line) => line.programId).map((line) => [line.programId, line.programName])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), people: [...new Set(allLines.map((line) => line.person).filter(Boolean))].sort() },
    sales: aggregate(salesLines, (line) => `${line.date}\0${line.person}\0${line.branch}\0${line.programId}`),
    collections: aggregate(collectionLines, (line) => `${line.date}\0${line.person}\0${line.branch}\0${line.programId}\0${line.role}`),
    byDay: aggregate(allLines, (line) => line.date).sort((a, b) => a.date.localeCompare(b.date)),
    byBranch: aggregate(allLines, (line) => line.branch || "Unassigned").sort((a, b) => a.branch.localeCompare(b.branch)),
    byProgram: aggregate(allLines, (line) => line.programId || "Unassigned").sort((a, b) => a.programName.localeCompare(b.programName)),
    summary: summarize(allLines, postedExpenses, approvedRemittances, deposits),
    notes: ["Fidelity Bond is shown as zero because no Fidelity Bond source field or transaction sheet is configured.", "New Sales incentives are shown as zero because no approved sales-incentive rule is stored; Collection incentives use gross less the saved remittance amount."]
  };
}
