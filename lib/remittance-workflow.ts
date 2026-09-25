import { getEncoder } from "@/lib/encoder-context";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";

const titles = ["Collections", "Remittances", "Remittance Collections"] as const;
const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => Number(value ?? 0) || 0;

export type CashCollection = {
  id: string;
  rowNumber: number;
  memberNumber: string;
  programId: string;
  branch: string;
  accountableEmployeeId: string;
  accountableName: string;
  accountableRole: string;
  orNumber: string;
  orDate: string;
  amount: number;
  remittanceStatus: string;
  linkedRemittanceId: string;
};

export type CashRemittance = {
  id: string;
  rowNumber: number;
  branch: string;
  accountableName: string;
  remittanceDate: string;
  status: string;
  submittedAt: string;
  submittedByUserId: string;
  submittedByEmployeeId: string;
  submittedByUsername: string;
  expectedAmount: number;
  actualAmount: number;
  difference: number;
  accountableEmployeeId: string;
  accountableRole: string;
  collectionCount: number;
  receivedByEmployeeId: string;
  receivedByName: string;
  decisionByUsername: string;
  decisionAt: string;
  remarks: string;
  rejectionReason: string;
  collectionIds: string[];
};

async function loadLedger() {
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: GOOGLE_SHEET_ID,
    ranges: titles.map((title) => `'${title}'`),
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const rows = Object.fromEntries(titles.map((title, index) => [title, response.data.valueRanges?.[index]?.values ?? []]));
  if (rows.Collections[0]?.[28] !== "Remittance Status" || rows.Remittances[0]?.[12] !== "Difference" || rows["Remittance Collections"][0]?.[0] !== "Remittance Collection ID") {
    throw new Error("Run the remittance workflow sheet migration before using Remittances.");
  }
  const mappings = rows["Remittance Collections"].slice(1).filter((row) => text(row[0])).map((row) => ({
    id: text(row[0]), remittanceId: text(row[1]), collectionId: text(row[2]), amount: number(row[3]), linkedAt: text(row[4]),
  }));
  const collections: CashCollection[] = rows.Collections.slice(1).map((row, index) => ({
    id: text(row[0]), rowNumber: index + 2, memberNumber: text(row[4]), programId: text(row[5]), branch: text(row[6]),
    accountableEmployeeId: text(row[30]), accountableName: text(row[31]) || text(row[7]), accountableRole: text(row[32]) || text(row[25]) || "MAS",
    orNumber: text(row[8]), orDate: text(row[9]), amount: number(row[10]), remittanceStatus: text(row[28]) || "Needs Historical Review", linkedRemittanceId: text(row[29]),
  })).filter((collection) => collection.id && text(rows.Collections[collection.rowNumber - 1]?.[19]).toLowerCase() === "posted");
  const remittances: CashRemittance[] = rows.Remittances.slice(1).map((row, index) => ({
    id: text(row[0]), rowNumber: index + 2, branch: text(row[1]), accountableName: text(row[2]), remittanceDate: text(row[3]), status: text(row[4]) || "Legacy",
    submittedAt: text(row[5]), submittedByUserId: text(row[6]), submittedByEmployeeId: text(row[7]), submittedByUsername: text(row[8]),
    expectedAmount: number(row[10]), actualAmount: number(row[11]), difference: number(row[12]), accountableEmployeeId: text(row[13]), accountableRole: text(row[14]),
    collectionCount: number(row[15]), receivedByEmployeeId: text(row[16]), receivedByName: text(row[17]), decisionByUsername: text(row[20]), decisionAt: text(row[21]),
    remarks: text(row[22]), rejectionReason: text(row[23]), collectionIds: mappings.filter((mapping) => mapping.remittanceId === text(row[0])).map((mapping) => mapping.collectionId),
  })).filter((remittance) => remittance.id);
  return { collections, remittances, mappings };
}

export async function getRemittanceDashboard() {
  const ledger = await loadLedger();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const available = ledger.collections.filter((collection) => collection.remittanceStatus === "Outstanding");
  const accountable = ledger.collections.filter((collection) => ["Outstanding", "Pending Remittance Approval"].includes(collection.remittanceStatus));
  const pending = ledger.remittances.filter((remittance) => ["Pending Approval", "Discrepancy"].includes(remittance.status));
  const approvedToday = ledger.remittances.filter((remittance) => remittance.status === "Approved" && remittance.decisionAt.slice(0, 10) === today);
  const accountability = [...new Set(accountable.map((collection) => `${collection.accountableEmployeeId}\u0000${collection.accountableName}\u0000${collection.accountableRole}\u0000${collection.branch}`))].map((key) => {
    const [employeeId, name, role, branch] = key.split("\u0000");
    const owned = accountable.filter((collection) => collection.accountableEmployeeId === employeeId && collection.accountableName === name && collection.branch === branch);
    return { employeeId, name, role, branch, collectionCount: owned.length, outstandingAmount: owned.reduce((sum, collection) => sum + collection.amount, 0) };
  });
  return {
    summary: {
      outstandingAmount: accountable.reduce((sum, collection) => sum + collection.amount, 0), outstandingCount: accountable.length,
      pendingAmount: pending.reduce((sum, remittance) => sum + remittance.expectedAmount, 0), pendingCount: pending.length,
      approvedTodayAmount: approvedToday.reduce((sum, remittance) => sum + remittance.actualAmount, 0), approvedTodayCount: approvedToday.length,
      discrepancyAmount: pending.reduce((sum, remittance) => sum + Math.abs(remittance.difference), 0),
      historicalReviewCount: ledger.collections.filter((collection) => collection.remittanceStatus === "Needs Historical Review").length,
    },
    accountability,
    outstanding: available,
    remittances: ledger.remittances,
  };
}

const cell = (value: string | number) => ({ userEnteredValue: typeof value === "number" ? { numberValue: value } : { stringValue: value } });

async function sheetIds() {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties" });
  const id = (title: string) => {
    const value = metadata.data.sheets?.find((sheet) => sheet.properties?.title === title)?.properties?.sheetId;
    if (value === undefined || value === null) throw new Error(`Missing ${title} sheet.`);
    return value;
  };
  return { collections: id("Collections"), remittances: id("Remittances"), mappings: id("Remittance Collections") };
}

export async function createCashRemittance(input: { collectionIds: string[]; actualAmount: number; remittanceDate: string; receivedByName?: string; remarks?: string }) {
  const actor = getEncoder();
  const ledger = await loadLedger();
  const ids = [...new Set(input.collectionIds.map(text).filter(Boolean))];
  if (!ids.length) throw new Error("Select at least one outstanding Collection.");
  const selected = ids.map((id) => ledger.collections.find((collection) => collection.id === id));
  if (selected.some((collection) => !collection)) throw new Error("One or more selected Collections no longer exist.");
  const collections = selected as CashCollection[];
  if (collections.some((collection) => collection.remittanceStatus !== "Outstanding" || collection.linkedRemittanceId)) throw new Error("One or more selected Collections are no longer outstanding. Refresh and try again.");
  const owner = collections[0];
  if (collections.some((collection) => collection.accountableName !== owner.accountableName || collection.accountableEmployeeId !== owner.accountableEmployeeId || collection.branch !== owner.branch)) {
    throw new Error("A Remittance can only contain Collections for one accountable person and branch.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.remittanceDate)) throw new Error("Enter a valid remittance date.");
  if (!Number.isFinite(input.actualAmount) || input.actualAmount < 0) throw new Error("Enter the actual amount received.");
  const expected = Math.round(collections.reduce((sum, collection) => sum + collection.amount, 0) * 100) / 100;
  const actual = Math.round(input.actualAmount * 100) / 100;
  const difference = Math.round((actual - expected) * 100) / 100;
  const status = difference === 0 ? "Pending Approval" : "Discrepancy";
  const id = `REM-${crypto.randomUUID()}`;
  const timestamp = actor.encodedAt;
  const identity = [actor.userId, actor.employeeId, actor.username, timestamp];
  const row = [id, owner.branch, owner.accountableName, input.remittanceDate, status, timestamp, ...identity, expected, actual, difference,
    owner.accountableEmployeeId, owner.accountableRole, collections.length, actor.employeeId, text(input.receivedByName) || actor.username, "", "", "", "", text(input.remarks), ""];
  const sheet = await sheetIds();
  const requests = [
    { appendCells: { sheetId: sheet.remittances, rows: [{ values: row.map(cell) }], fields: "userEnteredValue" } },
    ...collections.map((collection) => ({ appendCells: { sheetId: sheet.mappings, rows: [{ values: [`RCL-${crypto.randomUUID()}`, id, collection.id, collection.amount, timestamp, ...identity].map(cell) }], fields: "userEnteredValue" } })),
    ...collections.map((collection) => ({ updateCells: { range: { sheetId: sheet.collections, startRowIndex: collection.rowNumber - 1, endRowIndex: collection.rowNumber, startColumnIndex: 28, endColumnIndex: 30 }, rows: [{ values: [cell("Pending Remittance Approval"), cell(id)] }], fields: "userEnteredValue" } })),
  ];
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { requests } });
  return { id, status, expectedAmount: expected, actualAmount: actual, difference };
}

export async function decideCashRemittance(remittanceId: string, decision: "approve" | "reject", reason = "") {
  const actor = getEncoder();
  const ledger = await loadLedger();
  const remittance = ledger.remittances.find((item) => item.id === remittanceId);
  if (!remittance) throw new Error("Remittance not found.");
  if (!["Pending Approval", "Discrepancy"].includes(remittance.status)) throw new Error("Only pending or discrepancy Remittances can be decided.");
  if (remittance.submittedByUserId === actor.userId) throw new Error("The submitting user cannot approve or reject the same Remittance.");
  if (decision === "reject" && !text(reason)) throw new Error("A rejection reason is required.");
  const linked = remittance.collectionIds.map((id) => ledger.collections.find((collection) => collection.id === id));
  if (!linked.length || linked.some((collection) => !collection)) throw new Error("The Remittance collection links are incomplete.");
  if (decision === "approve" && linked.some((collection) => collection?.linkedRemittanceId !== remittance.id || collection.remittanceStatus !== "Pending Remittance Approval")) {
    throw new Error("A linked Collection changed before approval. Refresh and investigate it.");
  }
  const sheet = await sheetIds();
  const timestamp = actor.encodedAt;
  const status = decision === "approve" ? "Approved" : "Rejected";
  const requests = [
    { updateCells: { range: { sheetId: sheet.remittances, startRowIndex: remittance.rowNumber - 1, endRowIndex: remittance.rowNumber, startColumnIndex: 4, endColumnIndex: 5 }, rows: [{ values: [cell(status)] }], fields: "userEnteredValue" } },
    { updateCells: { range: { sheetId: sheet.remittances, startRowIndex: remittance.rowNumber - 1, endRowIndex: remittance.rowNumber, startColumnIndex: 18, endColumnIndex: 24 }, rows: [{ values: [actor.userId, actor.employeeId, actor.username, timestamp, remittance.remarks, decision === "reject" ? text(reason) : ""].map(cell) }], fields: "userEnteredValue" } },
    ...linked.map((collection) => ({ updateCells: { range: { sheetId: sheet.collections, startRowIndex: collection!.rowNumber - 1, endRowIndex: collection!.rowNumber, startColumnIndex: 28, endColumnIndex: 30 }, rows: [{ values: [cell(decision === "approve" ? "Remitted" : "Outstanding"), cell(decision === "approve" ? remittance.id : "")] }], fields: "userEnteredValue" } })),
  ];
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { requests } });
  return { id: remittance.id, status };
}
