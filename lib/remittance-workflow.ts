import { createReadableId } from "@/lib/readable-id";
import { COLLECTIONS_RANGE, REMITTANCE_LINKS_RANGE, REMITTANCES_RANGE, SALES_RANGE } from "@/lib/sheet-ranges";
import { getEncoder } from "@/lib/encoder-context";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { headerMatches } from "@/lib/sheet-headers";
import { incentiveDeadline, keepsIncentive, manilaDateOf, manilaNow, validTime } from "@/lib/remittance-deadline";
import { cashCountProblem } from "@/lib/cash-count";

const titles = ["Collections", "Remittances", "Remittance Collections", "Sales"] as const;
// The same ranges the dashboards and reports read, so one cached copy of each sheet serves them all.
const ledgerRanges = { Collections: COLLECTIONS_RANGE, Remittances: REMITTANCES_RANGE, "Remittance Collections": REMITTANCE_LINKS_RANGE, Sales: SALES_RANGE } as const;

/**
 * A MAS turns over Collections and New Sales on separate remittance slips, so every remittance is one kind. Both are
 * "items" owed by an accountable person; each kind keeps its remittance status in its own sheet and columns.
 */
export type RemittanceKind = "Collections" | "New Sales";
const itemSheet = { Collections: { status: 28 }, "New Sales": { status: 35 } } as const;
// Incentive forfeited because the cash came in after the deadline: Collections AM, Sales AR. Remittances AA holds the
// time the cash was received, next to its date in D.
const FORFEIT_COLUMN = { Collections: 38, "New Sales": 43 } as const;
const REMITTANCE_TIME_COLUMN = 26;
// Remittances AB: the bills and coins counted, e.g. "1000x3, 500x1" (lib/cash-count.ts).
const CASH_COUNT_COLUMN = 27;
const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => Number(value ?? 0) || 0;

export type CashCollection = {
  /** Collections (member payments) or New Sales; a remittance contains only one kind. */
  kind: RemittanceKind;
  id: string;
  batchId: string;
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
  remittanceAmount:number;
  /** Incentive taken back when the cash came in after the deadline; already added to remittanceAmount. */
  forfeitedIncentive: number;
  /** When the cash must be received to keep the incentive ("YYYY-MM-DD HH:MM", Manila); blank without a valid OR date. */
  incentiveDeadline: string;
  /** Remittance penalty charged to the accountable MAS/Collector; set on the batch's first Collection only. */
  penalty: number;
  penaltyNote: string;
  /** Fidelity entered with a Collections or New Sales batch (first row only): the employee's own money, added to the remittance. */
  fidelity: number;
  remittanceStatus: string;
  linkedRemittanceId: string;
  daysOutstanding: number;
  collectedBy: string;
  paymentMethod: string;
  paymentReference: string;
};

export type CashRemittance = {
  /** What this slip covers: Collections or New Sales (blank rows written before New Sales remittances are Collections). */
  type: RemittanceKind;
  id: string;
  rowNumber: number;
  branch: string;
  accountableName: string;
  remittanceDate: string;
  /** HH:MM the cash was received; blank on slips saved before times were recorded. */
  remittanceTime: string;
  /** Bills and coins counted when the cash was received; blank for non-cash slips and older slips. */
  cashCount: string;
  status: string;
  submittedAt: string;
  submittedByUserId: string;
  submittedByEmployeeId: string;
  submittedByName: string;
  expectedAmount: number;
  actualAmount: number;
  difference: number;
  accountableEmployeeId: string;
  accountableRole: string;
  collectionCount: number;
  receivedByEmployeeId: string;
  receivedByName: string;
  decisionByName: string;
  decisionAt: string;
  remarks: string;
  decisionReason: string;
  fidelityAmount: number;
  collectionIds: string[];
  /** How the MAS remitted the linked Collections; non-cash methods carry references for verification. */
  paymentMethods: string[];
  paymentReferences: string[];
  /** Penalties charged on the linked items, with what each was for; tracked separately and not part of the expected amount. */
  penaltyAmount: number;
  penaltyNotes: string[];
};

async function loadLedger() {
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: GOOGLE_SHEET_ID,
    ranges: titles.map((title) => ledgerRanges[title]),
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const rows = Object.fromEntries(titles.map((title, index) => [title, response.data.valueRanges?.[index]?.values ?? []]));
  if (!headerMatches(rows.Collections[0]?.[28], "Remittance Status") || !headerMatches(rows.Remittances[0]?.[12], "Difference") || !headerMatches(rows["Remittance Collections"][0]?.[0], "Remittance Collection ID")) {
    throw new Error("Run the remittance workflow sheet migration before using Remittances.");
  }
  if (!headerMatches(rows.Collections[0]?.[FORFEIT_COLUMN.Collections], "forfeited_incentive") || !headerMatches(rows.Sales[0]?.[FORFEIT_COLUMN["New Sales"]], "forfeited_incentive") || !headerMatches(rows.Remittances[0]?.[REMITTANCE_TIME_COLUMN], "time_remitted") || !headerMatches(rows.Remittances[0]?.[CASH_COUNT_COLUMN], "cash_count")) {
    throw new Error("Run npm run sheets:remittance-deadline -- --apply before using Remittances.");
  }
  const mappings = rows["Remittance Collections"].slice(1).filter((row) => text(row[0])).map((row) => ({
    id: text(row[0]), remittanceId: text(row[1]), collectionId: text(row[2]), amount: number(row[3]), linkedAt: text(row[4]),
  }));
  const collections: CashCollection[] = rows.Collections.slice(1).map((row, index) => ({
    kind: "Collections" as const, id: text(row[0]), batchId: text(row[1]), rowNumber: index + 2, memberNumber: text(row[4]), programId: text(row[5]), branch: text(row[6]),
    accountableEmployeeId: text(row[30]), accountableName: text(row[31]) || text(row[7]), accountableRole: text(row[32]) || text(row[25]) || "MAS",
    orNumber: text(row[8]), orDate: text(row[9]), amount: number(row[10]), remittanceAmount:number(row[26]), forfeitedIncentive: number(row[FORFEIT_COLUMN.Collections]), incentiveDeadline: incentiveDeadline(text(row[9])), remittanceStatus: text(row[28]) || "Needs Historical Review", linkedRemittanceId: text(row[29]),
    collectedBy: text(row[25]), paymentMethod: text(row[33]) || "Cash", paymentReference: text(row[34]), penalty: number(row[35]), penaltyNote: text(row[36]), fidelity: number(row[37]),
    daysOutstanding: Math.max(0, Math.floor((Date.now() - new Date(`${text(row[9])}T00:00:00Z`).getTime()) / 86400000)) || 0,
  })).filter((collection) => collection.id && text(rows.Collections[collection.rowNumber - 1]?.[19]).toLowerCase() === "posted");
  // New Sales are owed by the sale's MAS (Sales AJ status, AK linked remittance, AL accountable ID). AP holds the company's
  // share after the MAS's New Sale incentive (AO); sales saved before incentives existed owe the full amount paid.
  // AQ is the batch's MAS Fidelity, on its first sale.
  // A New Sale has no OR; its date is the Manila date it was created (date_created is a UTC stamp).
  const saleDate = (row: unknown[]) => text(row[30]) || manilaDateOf(text(row[1]));
  const sales: CashCollection[] = rows.Sales.slice(1).map((row, index) => ({
    kind: "New Sales" as const, id: text(row[0]), batchId: "", rowNumber: index + 2, memberNumber: text(row[5]), programId: text(row[21]), branch: text(row[2]),
    accountableEmployeeId: text(row[37]), accountableName: text(row[3]), accountableRole: "MAS",
    orNumber: text(row[29]) || (text(row[28]) ? `App ${text(row[28])}` : ""), orDate: saleDate(row), amount: number(row[26]), remittanceAmount: text(row[41]) === "" ? number(row[26]) : number(row[41]),
    forfeitedIncentive: number(row[FORFEIT_COLUMN["New Sales"]]), incentiveDeadline: incentiveDeadline(saleDate(row)),
    remittanceStatus: text(row[35]) || "Needs Historical Review", linkedRemittanceId: text(row[36]),
    collectedBy: "MAS", paymentMethod: text(row[23]) || "Cash", paymentReference: "", penalty: number(row[38]), penaltyNote: text(row[39]), fidelity: number(row[42]),
    daysOutstanding: Math.max(0, Math.floor((Date.now() - new Date(`${saleDate(row)}T00:00:00Z`).getTime()) / 86400000)) || 0,
  })).filter((sale) => sale.id);
  collections.push(...sales);
  const remittances: CashRemittance[] = rows.Remittances.slice(1).map((row, index) => ({
    id: text(row[0]), rowNumber: index + 2, branch: text(row[1]), accountableName: text(row[2]), remittanceDate: text(row[3]), remittanceTime: text(row[REMITTANCE_TIME_COLUMN]), cashCount: text(row[CASH_COUNT_COLUMN]), status: text(row[4]) || "Legacy",
    submittedAt: text(row[5]), submittedByUserId: text(row[6]), submittedByEmployeeId: text(row[7]), submittedByName: text(row[8]),
    expectedAmount: number(row[10]), actualAmount: number(row[11]), difference: number(row[12]), accountableEmployeeId: text(row[13]), accountableRole: text(row[14]),
    collectionCount: number(row[15]), receivedByEmployeeId: text(row[16]), receivedByName: text(row[17]), decisionByName: text(row[20]), decisionAt: text(row[21]),
    remarks: text(row[22]), decisionReason: text(row[23]), fidelityAmount: number(row[24]), type: (text(row[25]) === "New Sales" ? "New Sales" : "Collections") as RemittanceKind, collectionIds: mappings.filter((mapping) => mapping.remittanceId === text(row[0])).map((mapping) => mapping.collectionId), paymentMethods: [], paymentReferences: [], penaltyAmount: 0, penaltyNotes: [],
  })).filter((remittance) => remittance.id);
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  for (const remittance of remittances) {
    const linked = remittance.collectionIds.map((id) => byId.get(id)).filter((item): item is CashCollection => Boolean(item));
    remittance.paymentMethods = [...new Set(linked.map((item) => item.paymentMethod))];
    remittance.paymentReferences = [...new Set(linked.map((item) => item.paymentReference).filter(Boolean))];
    remittance.penaltyAmount = Math.round(linked.reduce((sum, item) => sum + item.penalty, 0) * 100) / 100;
    remittance.penaltyNotes = linked.filter((item) => item.penalty > 0).map((item) => item.penaltyNote);
  }
  return { collections, remittances, mappings };
}

/** The incentive the accountable person keeps on an item (amount less the company remittance). */
const incentiveOf = (item: Pick<CashCollection, "amount" | "remittanceAmount">) => Math.max(0, Math.round((item.amount - item.remittanceAmount) * 100) / 100);

/** True when cash received at `receivedAt` ("YYYY-MM-DD HH:MM") is too late to keep this item's incentive. */
export const forfeitsIncentive = (item: Pick<CashCollection, "amount" | "remittanceAmount" | "orDate">, receivedAt: string) => incentiveOf(item) > 0 && !keepsIncentive(item.orDate, receivedAt);

/**
 * What the accountable person must turn over for one item: the company remittance, or the full amount once the
 * incentive deadline has passed. A batch's Fidelity is added on top of it; a penalty is tracked separately.
 */
export const amountDue = (collection: Pick<CashCollection, "amount" | "remittanceAmount" | "orDate">, receivedAt = "") =>
  receivedAt && forfeitsIncentive(collection, receivedAt) ? collection.amount : collection.remittanceAmount;

export async function getRemittanceDashboard() {
  const ledger = await loadLedger();
  const now = manilaNow(), today = now.date, at = `${now.date} ${now.time}`;
  const available = ledger.collections.filter((collection) => collection.remittanceStatus === "Outstanding");
  const accountable = ledger.collections.filter((collection) => ["Outstanding", "Pending Remittance Approval"].includes(collection.remittanceStatus));
  const pending = ledger.remittances.filter((remittance) => ["Pending Approval", "Discrepancy"].includes(remittance.status));
  const approvedToday = ledger.remittances.filter((remittance) => remittance.status === "Approved" && remittance.decisionAt.slice(0, 10) === today);
  const accountability = [...new Set(accountable.map((collection) => `${collection.accountableEmployeeId}\u0000${collection.accountableName}\u0000${collection.accountableRole}\u0000${collection.branch}`))].map((key) => {
    const [employeeId, name, role, branch] = key.split("\u0000");
    const owned = accountable.filter((collection) => collection.accountableEmployeeId === employeeId && collection.accountableName === name && collection.branch === branch);
    return { employeeId, name, role, branch, collectionCount: owned.length, outstandingAmount: owned.reduce((sum, collection) => sum + amountDue(collection, at) + collection.fidelity, 0) };
  });
  return {
    summary: {
      outstandingAmount: accountable.reduce((sum, collection) => sum + amountDue(collection, at) + collection.fidelity, 0), outstandingCount: accountable.length,
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
  return { collections: id("Collections"), sales: id("Sales"), remittances: id("Remittances"), mappings: id("Remittance Collections") };
}

/** Sets an item's remittance status and linked remittance ID in its own sheet (Collections AC:AD, Sales AJ:AK). */
function statusUpdate(sheet: Awaited<ReturnType<typeof sheetIds>>, item: CashCollection, status: string, remittanceId: string) {
  const column = itemSheet[item.kind].status;
  return { updateCells: { range: { sheetId: item.kind === "New Sales" ? sheet.sales : sheet.collections, startRowIndex: item.rowNumber - 1, endRowIndex: item.rowNumber, startColumnIndex: column, endColumnIndex: column + 2 }, rows: [{ values: [cell(status), cell(remittanceId)] }], fields: "userEnteredValue" } };
}

/**
 * Moves an item's incentive into the company remittance (forfeited > 0), or gives it back (forfeited = 0, restoring
 * `remittanceAmount`). Collections: AA remittance_amount, AM forfeited_incentive. Sales: AO mas_incentive, AP
 * remittance_amount, AR forfeited_incentive. Reports, commissions and payroll read the incentive as amount less
 * remittance_amount, so they follow automatically.
 */
function forfeitUpdate(sheet: Awaited<ReturnType<typeof sheetIds>>, item: CashCollection, remittanceAmount: number, forfeited: number) {
  const sheetId = item.kind === "New Sales" ? sheet.sales : sheet.collections;
  const range = (start: number, end: number) => ({ sheetId, startRowIndex: item.rowNumber - 1, endRowIndex: item.rowNumber, startColumnIndex: start, endColumnIndex: end });
  const forfeitCell = forfeited > 0 ? cell(forfeited) : cell("");
  return item.kind === "New Sales"
    ? [
      { updateCells: { range: range(40, 42), rows: [{ values: [cell(Math.round((item.amount - remittanceAmount) * 100) / 100), cell(remittanceAmount)] }], fields: "userEnteredValue" } },
      { updateCells: { range: range(FORFEIT_COLUMN["New Sales"], FORFEIT_COLUMN["New Sales"] + 1), rows: [{ values: [forfeitCell] }], fields: "userEnteredValue" } },
    ]
    : [
      { updateCells: { range: range(26, 27), rows: [{ values: [cell(remittanceAmount)] }], fields: "userEnteredValue" } },
      { updateCells: { range: range(FORFEIT_COLUMN.Collections, FORFEIT_COLUMN.Collections + 1), rows: [{ values: [forfeitCell] }], fields: "userEnteredValue" } },
    ];
}

export const CASH_IN_FULL_NOTE = "Cash received in full and confirmed during encoding.";

export async function createCashRemittance(input: { collectionIds: string[]; actualAmount: number; fidelityAmount: number; remittanceDate: string; remittanceTime: string; cashCount?: string; remarks?: string; cashConfirmed?: boolean }) {
  const actor = getEncoder();
  const ledger = await loadLedger();
  const ids = [...new Set(input.collectionIds.map(text).filter(Boolean))];
  if (!ids.length) throw new Error("Select at least one outstanding Collection or New Sale.");
  const selected = ids.map((id) => ledger.collections.find((collection) => collection.id === id));
  if (selected.some((collection) => !collection)) throw new Error("One or more selected items no longer exist.");
  const collections = selected as CashCollection[];
  const kind = collections[0].kind;
  if (collections.some((collection) => collection.kind !== kind)) throw new Error("Collections and New Sales are remitted on separate slips. Select only one kind.");
  if (collections[0].batchId) {
    const completeBatch = ledger.collections.filter((collection) => collection.batchId === collections[0].batchId && collection.remittanceStatus === "Outstanding");
    if (collections.some((collection) => collection.batchId !== collections[0].batchId) || completeBatch.length !== collections.length || completeBatch.some((collection) => !ids.includes(collection.id))) throw new Error("One Collection save is one Remittance. Select every Collection card from the same saved batch.");
  }
  if (collections.some((collection) => collection.remittanceStatus !== "Outstanding" || collection.linkedRemittanceId)) throw new Error("One or more selected Collections are no longer outstanding. Refresh and try again.");
  const owner = collections[0];
  if (collections.some((collection) => collection.accountableName !== owner.accountableName || collection.accountableEmployeeId !== owner.accountableEmployeeId || collection.branch !== owner.branch)) {
    throw new Error("A Remittance can only contain Collections for one accountable person and branch.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.remittanceDate)) throw new Error("Enter a valid remittance date.");
  if (!validTime(input.remittanceTime)) throw new Error("Enter the time the cash was received.");
  // The time the cash was actually handed over decides the incentive, so a slip encoded late can still record it.
  const now = manilaNow(), receivedAt = `${input.remittanceDate} ${input.remittanceTime}`;
  if (receivedAt > `${now.date} ${now.time}`) throw new Error("The time received cannot be in the future.");
  if (collections.some((collection) => /^\d{4}-\d{2}-\d{2}/.test(collection.orDate) && input.remittanceDate < collection.orDate.slice(0, 10))) throw new Error("The remittance date cannot be before the OR date.");
  if (!Number.isFinite(input.actualAmount) || input.actualAmount < 0) throw new Error("Enter the actual amount received.");
  if (!Number.isFinite(input.fidelityAmount) || input.fidelityAmount < 0) throw new Error("Fidelity must be zero or a positive amount.");
  const encodedFidelity = Math.round(collections.reduce((sum, item) => sum + item.fidelity, 0) * 100) / 100;
  if (encodedFidelity > 0 && input.fidelityAmount > 0 && Math.round(input.fidelityAmount * 100) !== Math.round(encodedFidelity * 100)) throw new Error("Fidelity for this batch was entered when it was encoded and is already recorded.");
  const fidelityAmount = encodedFidelity || input.fidelityAmount;
  // Fidelity is the accountable employee's own money: it has no limit and is added to the cash expected.
  if (fidelityAmount > 0 && !owner.accountableEmployeeId) throw new Error("Fidelity needs an accountable employee on record.");
  // Cash received after the deadline carries no incentive: the full amount is remitted.
  const forfeits = collections.filter((collection) => forfeitsIncentive(collection, receivedAt));
  const forfeitedTotal = Math.round(forfeits.reduce((sum, collection) => sum + incentiveOf(collection), 0) * 100) / 100;
  const due = new Map(collections.map((collection) => [collection.id, amountDue(collection, receivedAt)]));
  const expected = Math.round((collections.reduce((sum, collection) => sum + (due.get(collection.id) ?? 0), 0) + fidelityAmount) * 100) / 100;
  const actual = Math.round(input.actualAmount * 100) / 100;
  const cashCount = text(input.cashCount);
  const countProblem = cashCountProblem(cashCount, actual);
  if (countProblem) throw new Error(countProblem);
  const difference = Math.round((actual - expected) * 100) / 100;
  // Confirmed full cash is created and approved in one atomic write by whoever received it.
  if (input.cashConfirmed && difference !== 0) throw new Error("Cash received in full requires the actual amount to equal the expected amount.");
  const approved = Boolean(input.cashConfirmed);
  // The Remittances sheet itself shows any penalty and Fidelity on the batch. Fidelity is part of the expected amount; a penalty is not.
  const penalized = collections.filter((collection) => collection.penalty > 0);
  const penaltyText = penalized.map((collection) => `Penalty ${collection.penalty.toLocaleString("en-PH", { style: "currency", currency: "PHP" })} (separate from remittance): ${collection.penaltyNote}`).join("; ");
  const fidelityText = fidelityAmount > 0 ? `Fidelity ${fidelityAmount.toLocaleString("en-PH", { style: "currency", currency: "PHP" })} (employee's own money), included in the expected amount` : "";
  const forfeitText = forfeits.length ? `Incentive forfeited on ${forfeits.length} item${forfeits.length === 1 ? "" : "s"} (${forfeitedTotal.toLocaleString("en-PH", { style: "currency", currency: "PHP" })}): cash received after 10:00 AM the day after the OR date` : "";
  const remarks = [text(input.remarks), penaltyText, fidelityText, forfeitText].filter(Boolean).join(" | ");
  const status = approved ? "Approved" : difference === 0 ? "Pending Approval" : "Discrepancy";
  const id = createReadableId("REM");
  const timestamp = actor.encodedAt;
  const identity = [actor.userId, actor.employeeId, actor.name, timestamp];
  const decision = approved ? [actor.userId, actor.employeeId, actor.name, timestamp] : ["", "", "", ""];
  const row = [id, owner.branch, owner.accountableName, input.remittanceDate, status, timestamp, ...identity, expected, actual, difference,
    owner.accountableEmployeeId, owner.accountableRole, collections.length, actor.employeeId, actor.name, ...decision, remarks, approved ? CASH_IN_FULL_NOTE : "", Math.round(fidelityAmount*100)/100, kind, input.remittanceTime, cashCount];
  const sheet = await sheetIds();
  const requests = [
    { appendCells: { sheetId: sheet.remittances, rows: [{ values: row.map(cell) }], fields: "userEnteredValue" } },
    ...collections.map((collection) => ({ appendCells: { sheetId: sheet.mappings, rows: [{ values: [createReadableId("RCL"), id, collection.id, due.get(collection.id) ?? collection.remittanceAmount, timestamp, ...identity].map(cell) }], fields: "userEnteredValue" } })),
    ...collections.map((collection) => statusUpdate(sheet, collection, approved ? "Remitted" : "Pending Remittance Approval", id)),
    ...forfeits.flatMap((collection) => forfeitUpdate(sheet, collection, collection.amount, incentiveOf(collection))),
  ];
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { requests } });
  return { id, type: kind, status, expectedAmount: expected, actualAmount: actual, difference, fidelityAmount: Math.round(fidelityAmount*100)/100, forfeitedCount: forfeits.length, forfeitedAmount: forfeitedTotal };
}

export async function decideCashRemittance(remittanceId: string, decision: "approve" | "reject", reason = "", allowOwnDecision = false) {
  const actor = getEncoder();
  const ledger = await loadLedger();
  const remittance = ledger.remittances.find((item) => item.id === remittanceId);
  if (!remittance) throw new Error("Remittance not found.");
  if (!["Pending Approval", "Discrepancy"].includes(remittance.status)) throw new Error("Only pending or discrepancy Remittances can be decided.");
  if (!allowOwnDecision && remittance.submittedByUserId === actor.userId) throw new Error("The submitting user cannot approve or reject the same Remittance.");
  if (decision === "reject" && !text(reason)) throw new Error("A rejection reason is required.");
  if (decision === "approve" && remittance.difference !== 0 && !text(reason)) throw new Error("Explain how the remittance discrepancy was resolved before approval.");
  const linked = remittance.collectionIds.map((id) => ledger.collections.find((collection) => collection.id === id));
  if (!linked.length || linked.some((collection) => !collection)) throw new Error("The Remittance links are incomplete.");
  if (decision === "approve" && linked.some((collection) => collection?.linkedRemittanceId !== remittance.id || collection.remittanceStatus !== "Pending Remittance Approval")) {
    throw new Error(`A linked ${remittance.type === "New Sales" ? "New Sale" : "Collection"} changed before approval. Refresh and investigate it.`);
  }
  const sheet = await sheetIds();
  const timestamp = actor.encodedAt;
  const status = decision === "approve" ? "Approved" : "Rejected";
  const requests = [
    { updateCells: { range: { sheetId: sheet.remittances, startRowIndex: remittance.rowNumber - 1, endRowIndex: remittance.rowNumber, startColumnIndex: 4, endColumnIndex: 5 }, rows: [{ values: [cell(status)] }], fields: "userEnteredValue" } },
    { updateCells: { range: { sheetId: sheet.remittances, startRowIndex: remittance.rowNumber - 1, endRowIndex: remittance.rowNumber, startColumnIndex: 18, endColumnIndex: 24 }, rows: [{ values: [actor.userId, actor.employeeId, actor.name, timestamp, remittance.remarks, text(reason)].map(cell) }], fields: "userEnteredValue" } },
    ...linked.map((collection) => statusUpdate(sheet, collection!, decision === "approve" ? "Remitted" : "Outstanding", decision === "approve" ? remittance.id : "")),
    // A rejected slip gives forfeited incentives back; the next slip decides again from its own time received.
    ...(decision === "reject" ? linked.filter((collection) => collection!.forfeitedIncentive > 0).flatMap((collection) => forfeitUpdate(sheet, collection!, Math.round((collection!.amount - collection!.forfeitedIncentive) * 100) / 100, 0)) : []),
  ];
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { requests } });
  return { id: remittance.id, status };
}
