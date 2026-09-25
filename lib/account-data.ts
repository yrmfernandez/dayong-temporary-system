import { sheets, GOOGLE_SHEET_ID } from "@/lib/google-sheets";
import { accountState, type Account, type AccountPayment, todayInManila } from "@/lib/account-rules";
import { getEncoder } from "@/lib/encoder-context";
import { encoderHeaders } from "@/lib/encoder-schema";
import type { IncentiveTier } from "@/lib/remittance";
import { buildMamReport } from "@/lib/mam-report";
import { headerMatches } from "@/lib/sheet-headers";

const titles = ["Member programs", "Members", "Programs", "Collections", "Remittances", "Sales", "Program Incentives"];
export function sheetDate(value: unknown): string {
  if (typeof value === "number") return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000).toISOString().slice(0, 10);
  return String(value ?? "").trim().slice(0, 10);
}
const str = (value: unknown) => String(value ?? "").trim();

export async function loadAccountData() {
  const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID,
    ranges: titles.map((title) => `'${title}'`), valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER" });
  const tables = Object.fromEntries(titles.map((title, i) => [title, response.data.valueRanges?.[i]?.values ?? []]));
  if (!headerMatches(tables["Member programs"][0]?.[18], "Account Status") || !headerMatches(tables.Collections[0]?.[25], "Collected By Role")) throw new Error("Run the account-status migration before using Collections or MAM.");
  if (!headerMatches(tables.Collections[0]?.[26], "Remittance Amount") || !headerMatches(tables.Collections[0]?.[27], "Remittance Breakdown") || !headerMatches(tables.Remittances[0]?.[10], "Gross Collection") || !headerMatches(tables.Remittances[0]?.[11], "Total Remittance")) throw new Error("Run the account-status migration to add remittance totals before using Collections or MAM.");
  for (const [title, offset] of [["Member programs", 14], ["Collections", 21], ["Remittances", 6]] as const) {
    if (encoderHeaders.some((header, index) => !headerMatches(tables[title][0]?.[offset + index], header))) throw new Error(`${title} encoder headers changed. Review the sheet before saving.`);
  }
  const programs = new Map(tables.Programs.slice(1).map((r) => [str(r[0]), { name: str(r[2]), basePay: Number(r[3]) }]));
  const members = new Map(tables.Members.slice(1).map((r) => [str(r[0]), `${str(r[2])}, ${str(r[3])} ${str(r[4])}`.trim()]));
  const accounts = tables["Member programs"].slice(1).map((r, i) => ({
    id: str(r[0]), memberId: str(r[1]), memberNumber: str(r[2]), programId: str(r[3]), doi: sheetDate(r[4]),
    branch: str(r[5]), mas: str(r[6]), basePay: programs.get(str(r[3]))?.basePay ?? 0, storedStatus: str(r[18]), rowNumber: i + 2,
    memberName: members.get(str(r[1])) ?? str(r[2]), programName: programs.get(str(r[3]))?.name ?? str(r[3]),
  })).filter((a) => a.id);
  if (new Set(accounts.map((a) => a.id)).size !== accounts.length) throw new Error("Duplicate enrollment IDs need review.");
  const payments: AccountPayment[] = tables.Collections.slice(1).filter((r) => str(r[0]) && str(r[19]).toLowerCase() === "posted").map((r) => ({
    id: str(r[0]), enrollmentId: str(r[2]), orDate: sheetDate(r[9]), orNumber: str(r[8]), monthFrom: sheetDate(r[11]).slice(0, 7), monthTo: sheetDate(r[12]).slice(0, 7),
    nopFrom: Number(r[13]), nopTo: Number(r[14]), amount: Number(r[10]), dateRemitted: sheetDate(r[9]), mas: str(r[7]),
  }));
  const sales = tables.Sales.slice(1).map((r) => ({ memberNumber: str(r[5]), programId: str(r[33]), applicationNumber: str(r[40]), registrationFee: Number(r[37]) || 0 }));
  const incentives = tables["Program Incentives"].slice(1).filter((r) => str(r[0])).map((r) => ({
    id: str(r[0]), programId: str(r[1]), role: str(r[2]) as IncentiveTier["role"], fromMonth: Number(r[3]), toMonth: Number(r[4]),
    incentiveType: str(r[5]) as IncentiveTier["incentiveType"], markUp: Number(r[6]), incentiveAmount: Number(r[7]),
  }));
  return { accounts, payments, sales, incentives };
}

export async function accountReport() {
  const data = await loadAccountData();
  const today = todayInManila();
  const rows = data.accounts.filter((a) => !a.doi || a.doi <= today).map((account) => {
    try {
      const state = accountState(account, data.payments, today);
      const sale = data.sales.find((s) => s.memberNumber === account.memberNumber && s.programId === account.programId);
      return { ...account, ...state, applicationNumber: sale?.applicationNumber ?? "", registrationFee: sale?.registrationFee ?? 0, error: "" };
    } catch (error) { return { ...account, error: error instanceof Error ? error.message : "Review account data." }; }
  });
  return { today, month: today.slice(0, 7), rows };
}

export async function mamReport(from?: string, to?: string) {
  const today = todayInManila();
  return buildMamReport(await loadAccountData(), from || today.slice(0, 7), to || today.slice(0, 7), today);
}

export async function syncAccountStatuses() {
  getEncoder();
  const report = await accountReport();
  const data = report.rows.flatMap((row) => "status" in row && row.status !== row.storedStatus ? [{ range: `'Member programs'!S${row.rowNumber}`, values: [[row.status]] }] : []);
  if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "RAW", data } });
  return report;
}

export async function commitCollections(collectionRows: (string | number)[][], accounts: (Account & { rowNumber: number })[], payments: AccountPayment[]) {
  const actor = getEncoder();
  const identity = [actor.userId, actor.employeeId, actor.username, actor.encodedAt];
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties" });
  const id = (title: string) => {
    const found = metadata.data.sheets?.find((sheet) => sheet.properties?.title === title)?.properties?.sheetId;
    if (found === undefined || found === null) throw new Error(`Missing ${title} sheet.`);
    return found;
  };
  const cell = (value: string | number) => ({ userEnteredValue: typeof value === "number" ? { numberValue: value } : { stringValue: value } });
  const requests = [
    { appendCells: { sheetId: id("Collections"), rows: collectionRows.map((r) => ({ values: [...r.slice(0, 21), ...identity, ...r.slice(21)].map(cell) })), fields: "userEnteredValue" } },
    ...accounts.map((account) => ({ updateCells: {
      range: { sheetId: id("Member programs"), startRowIndex: account.rowNumber - 1, endRowIndex: account.rowNumber, startColumnIndex: 18, endColumnIndex: 19 },
      rows: [{ values: [cell(accountState(account, payments).status)] }], fields: "userEnteredValue",
    } })),
  ];
  // Commit collections and resulting member-account statuses atomically.
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { requests } });
}
