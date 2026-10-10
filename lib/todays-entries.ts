import { sql, type SQL } from "drizzle-orm";

import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { PROGRAMS_RANGE, REMITTANCES_RANGE } from "@/lib/sheet-ranges";
import { readSheetRows } from "@/lib/sheets-on-db";
import { incentiveDeadline, manilaDateOf, manilaNow } from "@/lib/remittance-deadline";
import { dateWarnings } from "@/lib/date-checks";
import { photosByEntry } from "@/lib/receipt-photos";
import { cashMethodNames, isCashMethod, saleBatchKey } from "@/lib/entry-batches";
import type { TodayMode } from "@/lib/today-mode";

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => Number(value ?? 0) || 0;
const round = (value: number) => Math.round(value * 100) / 100;
const manilaStamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
// Encoded-at values are UTC ISO stamps; shown and compared as Manila "YYYY-MM-DD HH:MM".
const manilaTime = (stamp: string) => {
  if (!/T\d{2}:/.test(stamp) || Number.isNaN(Date.parse(stamp))) return stamp.slice(0, 16);
  const parts = manilaStamp.formatToParts(new Date(stamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
};
// Only a real timestamp (as the remittance ledger reads it) makes a New Sales batch key.
const isoManila = (stamp: string) => (/T\d{2}:/.test(stamp) && !Number.isNaN(Date.parse(stamp)) ? manilaTime(stamp) : "");

export type DayEntry = {
  kind: "New Sale" | "Collection";
  id: string;
  memberNumber: string;
  memberName: string;
  program: string;
  branch: string;
  /** The MAS or Collector accountable for the cash. */
  person: string;
  orNumber: string;
  orDate: string;
  applicationNumber: string;
  notes: string;
  amount: number;
  /** Incentive the person keeps (zero once forfeited). */
  incentive: number;
  forfeitedIncentive: number;
  incentiveDeadline: string;
  remittanceStatus: string;
  remittanceId: string;
  /** "YYYY-MM-DD HH:MM" (or just the date on older slips) the cash was received; blank until remitted. */
  remittedAt: string;
  encodedBy: string;
  encodedAt: string;
  /** Amounts can only be corrected before the item is on a remittance slip. */
  onRemittance: boolean;
  /** The Date Remitted on the entry (Collections AO, Sales E); blank when not recorded. */
  dateRemitted: string;
  /** Date the entry was recorded (created), Manila. */
  recordedOn: string;
  /** Dates that are out of order or far apart (lib/date-checks.ts). */
  warnings: string[];
  /** Everything worth knowing about the entry, as label and value, for the View panel. Blank values are left out. */
  details: Array<[string, string]>;
  /** Who encoded it (blank on imported rows). */
  encodedByEmployeeId: string;
  /** Figures for reports: company share, Fidelity and penalty on this entry. */
  remittanceAmount: number;
  fidelity: number;
  penalty: number;
  /** The receipt photo attached to this entry, if any. */
  photoId: string;
  /** The saved batch it belongs to (Collections batch ID, or the New Sales saved together; lib/entry-batches.ts); blank on imported rows. */
  batchId: string;
  /** How it was paid; cash needs no receipt photo (counted at Clearing). */
  paymentMethod: string;
  cash: boolean;
  /** Why the approver returned it (rejected its remittance); blank unless Returned. */
  returnReason: string;
};

/**
 * New Sales and posted Collections for one day, where the day is when they were encoded, their OR date, or the date
 * the office received the cash on a remittance slip (rejected slips are unlinked, so they do not count).
 */
export async function getEntriesForDay(date: string, mode: TodayMode, person = "") {
  return getEntriesForRange(date, date, mode, { person });
}

/**
 * New Sales and posted Collections whose day (by `mode`) falls from `from` to `to`, optionally only one MAS/Collector's
 * (`person`) or only what one employee encoded (`encodedBy`, an Employee ID).
 */
/**
 * The database narrows Sales and Collections to the rows that can match before anything is converted: the encoder,
 * the person accountable, and the date the mode uses (one day of margin each side for the Manila day). The exact
 * filters below still decide, so this only has to keep every row that could match.
 */
function prefilter(kind: "sales" | "collections", from: string, to: string, mode: TodayMode, person: string, encodedBy: string) {
  const conditions: SQL[] = [];
  const low = sql`(${from}::date - 1)`, high = sql`(${to}::date + 1)`;
  if (encodedBy) conditions.push(sql`encoded_by_employee_id = ${encodedBy}`);
  if (person) conditions.push(kind === "sales" ? sql`lower(trim(mas)) = ${person.toLowerCase()}` : sql`lower(trim(coalesce(nullif(trim(accountable_name), ''), mas))) = ${person.toLowerCase()}`);
  const created = kind === "sales" ? sql`coalesce(encoded_at, date_created)` : sql`coalesce(encoded_at, created_at)`;
  if (from > "2000-01-01" || mode !== "encoded") {
    if (mode === "encoded") conditions.push(sql`(${created})::date between ${low} and ${high}`);
    else if (mode === "or") conditions.push(kind === "sales" ? sql`coalesce(or_date, (date_created)::date) between ${low} and ${high}` : sql`or_date between ${low} and ${high}`);
    else conditions.push(sql`(date_remitted between ${low} and ${high} or linked_remittance_id in (select remittance_id from remittances where date_remitted between ${low} and ${high}))`);
  } else conditions.push(sql`(${created})::date <= ${high}`);
  return conditions.length ? sql.join(conditions, sql` and `) : sql`true`;
}

export async function getEntriesForRange(from: string, to: string, mode: TodayMode, { person = "", encodedBy = "" }: { person?: string; encodedBy?: string } = {}) {
  const [sales, collections, response] = await Promise.all([
    readSheetRows("Sales", prefilter("sales", from, to, mode, person, encodedBy)),
    readSheetRows("Collections", prefilter("collections", from, to, mode, person, encodedBy)),
    sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: [REMITTANCES_RANGE, PROGRAMS_RANGE], valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" }),
  ]);
  const [remittances, programs] = response.data.valueRanges?.map((range) => range.values ?? []) ?? [];
  // Member names only for the members on these collections.
  const memberIds = [...new Set(collections.slice(1).map((row) => text(row[3])).filter(Boolean))];
  const members = memberIds.length ? await readSheetRows("Members", sql`member_id in (${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)})`) : [[]];
  const [photos, cashNames] = await Promise.all([photosByEntry(), cashMethodNames()]);
  const programNames = new Map(programs.slice(1).map((row) => [text(row[0]), text(row[2]) || text(row[1])]));
  const memberNames = new Map(members.slice(1).map((row) => [text(row[0]), `${text(row[3])} ${text(row[2])}`.trim()]));
  const slipRows = new Map(remittances.slice(1).filter((row) => text(row[0])).map((row) => [text(row[0]), row]));
  const slipStamp = (id: string) => { const row = slipRows.get(id); return row ? `${text(row[3])}${text(row[26]) ? ` ${text(row[26])}` : ""}` : ""; };
  const peso = (value: number) => value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });
  const money = (value: unknown) => (text(value) === "" ? "" : peso(number(value)));
  const today = manilaNow().date;

  type Base = Omit<DayEntry, "remittedAt" | "onRemittance" | "incentiveDeadline" | "warnings" | "photoId" | "returnReason" | "cash">;
  const entry = (values: Base): DayEntry => {
    const slipDate = text(slipRows.get(values.remittanceId)?.[3]).slice(0, 10);
    return {
      ...values,
      // The office received the cash on the remittance slip's date; without a slip, the Date Remitted on the entry.
      remittedAt: values.remittanceStatus === "Returned" ? "" : slipStamp(values.remittanceId) || values.dateRemitted,
      onRemittance: !["", "Outstanding", "Returned"].includes(values.remittanceStatus),
      returnReason: values.remittanceStatus === "Returned" ? text(slipRows.get(values.remittanceId)?.[23]) : "",
      incentiveDeadline: incentiveDeadline(values.orDate),
      warnings: dateWarnings({ receiptDate: values.orDate, receiptLabel: values.kind === "New Sale" ? "application date" : "OR date", dateRemitted: values.dateRemitted, slipDate, recordedOn: values.recordedOn, today }),
      details: values.details.filter(([, value]) => value !== ""),
      photoId: photos.get(values.id)?.photoId ?? "",
      cash: isCashMethod(values.paymentMethod, cashNames),
    };
  };
  const all: DayEntry[] = [
    ...sales.slice(1).filter((row) => text(row[0])).map((row) => {
      const amount = number(row[26]), remittance = text(row[41]) === "" ? amount : number(row[41]);
      const memberName = `${text(row[7])} ${text(row[6])}`.trim(), orDate = text(row[30]).slice(0, 10) || manilaDateOf(text(row[1]));
      const dateRemitted = text(row[4]).slice(0, 10), recordedOn = manilaDateOf(text(row[1]));
      return entry({
        kind: "New Sale", id: text(row[0]), memberNumber: text(row[5]), memberName,
        program: programNames.get(text(row[21])) || text(row[21]), branch: text(row[2]), person: text(row[3]),
        orNumber: text(row[29]), orDate, applicationNumber: text(row[28]), notes: text(row[27]),
        amount, incentive: Math.max(0, round(amount - remittance)), forfeitedIncentive: number(row[43]),
        remittanceStatus: text(row[35]), remittanceId: text(row[36]), encodedBy: text(row[33]), encodedAt: manilaTime(text(row[34]) || text(row[1])),
        dateRemitted, recordedOn, encodedByEmployeeId: text(row[32]), remittanceAmount: remittance, fidelity: number(row[42]), penalty: number(row[38]),
        paymentMethod: text(row[23]) || "Cash",
        // Same key as the remittance ledger (lib/remittance-workflow.ts), so the photo and the slip cover the same sales.
        batchId: saleBatchKey({ encodedByEmployeeId: text(row[32]), encodedAt: isoManila(text(row[34]) || text(row[1])), accountableEmployeeId: text(row[37]), branch: text(row[2]), dateRemitted }),
        details: [
          ["Sale ID", text(row[0])], ["Member", [memberName, text(row[5])].filter(Boolean).join(" · ")],
          ["Program", programNames.get(text(row[21])) || text(row[21])], ["Branch", text(row[2])], ["MAS", text(row[3])],
          ["Application no.", text(row[28])], ["Application date", orDate], ["DOI", text(row[22]).slice(0, 10)],
          ["Date remitted", dateRemitted], ["Payment method", text(row[23])],
          ["Registration fee", /^yes$/i.test(text(row[24])) ? money(row[25]) : ""], ["Amount paid", peso(amount)],
          ["MAS incentive", peso(Math.max(0, round(amount - remittance)))], ["Company share (to remit)", peso(remittance)],
          ["Forfeited incentive", number(row[43]) ? peso(number(row[43])) : ""],
          ["Penalty", number(row[38]) ? `${peso(number(row[38]))}${text(row[39]) ? ` · ${text(row[39])}` : ""}` : ""],
          ["Fidelity", number(row[42]) ? peso(number(row[42])) : ""],
          ["Remittance status", text(row[35])], ["Remittance slip", text(row[36]) ? `${text(row[36])} · received ${slipStamp(text(row[36]))}` : ""],
          ["Notes", text(row[27])], ["Late-entry reason", text(row[44])],
          ["Recorded on", recordedOn], ["Encoded by", `${text(row[33]) || "Not recorded"} · ${manilaTime(text(row[34]) || text(row[1]))}`],
        ],
      });
    }),
    ...collections.slice(1).filter((row) => text(row[0]) && text(row[19]).toLowerCase() === "posted").map((row) => {
      // A blank company share (imported rows) means no incentive was recorded, not that all of it was incentive.
      const amount = number(row[10]), remittance = text(row[26]) === "" ? amount : number(row[26]);
      const memberName = memberNames.get(text(row[3])) ?? "", orDate = text(row[9]).slice(0, 10);
      const dateRemitted = text(row[40]).slice(0, 10), recordedOn = manilaDateOf(text(row[20]) || text(row[24]));
      const months = text(row[11]) === text(row[12]) ? text(row[11]) : `${text(row[11])} to ${text(row[12])}`;
      const nop = text(row[13]) === text(row[14]) ? text(row[13]) : `${text(row[13])} to ${text(row[14])}`;
      return entry({
        kind: "Collection", id: text(row[0]), memberNumber: text(row[4]), memberName,
        program: programNames.get(text(row[5])) || text(row[5]), branch: text(row[6]), person: text(row[31]) || text(row[7]),
        orNumber: text(row[8]), orDate, applicationNumber: "", notes: "",
        amount, incentive: Math.max(0, round(amount - remittance)), forfeitedIncentive: number(row[38]),
        remittanceStatus: text(row[28]), remittanceId: text(row[29]), encodedBy: text(row[23]), encodedAt: manilaTime(text(row[24]) || text(row[20])),
        dateRemitted, recordedOn, encodedByEmployeeId: text(row[22]), remittanceAmount: remittance, fidelity: number(row[37]), penalty: number(row[35]),
        paymentMethod: text(row[33]) || "Cash", batchId: text(row[1]),
        details: [
          ["Collection ID", text(row[0])], ["Batch", text(row[1])], ["Member", [memberName, text(row[4])].filter(Boolean).join(" · ")],
          ["Program", programNames.get(text(row[5])) || text(row[5])], ["Branch", text(row[6])], ["MAS", text(row[7])],
          ["Accountable for the cash", [text(row[31]), text(row[32])].filter(Boolean).join(" · ")], ["Collected by", text(row[25])],
          ["OR number", text(row[8])], ["OR date", orDate], ["Date remitted", dateRemitted || "Not recorded"],
          ["Months covered", months], ["NOP", nop], ["Amount collected", peso(amount)],
          ["Company share (to remit)", peso(remittance)], ["Incentive", peso(Math.max(0, round(amount - remittance)))],
          ["Forfeited incentive", number(row[38]) ? peso(number(row[38])) : ""],
          ["Penalty", number(row[35]) ? `${peso(number(row[35]))}${text(row[36]) ? ` · ${text(row[36])}` : ""}` : ""],
          ["Fidelity", number(row[37]) ? peso(number(row[37])) : ""],
          ["Payment method", [text(row[33]), text(row[34]) && `ref ${text(row[34])}`].filter(Boolean).join(" · ")],
          ["Remittance status", text(row[28])], ["Remittance slip", text(row[29]) ? `${text(row[29])} · received ${slipStamp(text(row[29]))}` : ""],
          ["Reactivation", text(row[15]) === "Yes" ? "Yes" : ""], ["Transferred", text(row[16]) === "Yes" ? "Yes" : ""],
          ["If suspended", text(row[17])], ["Original MAS", text(row[18])], ["Late-entry reason", text(row[39])],
          ["Recorded on", recordedOn], ["Encoded by", `${text(row[23]) || "Not recorded"} · ${manilaTime(text(row[24]) || text(row[20]))}`],
        ],
      });
    }),
  ];
  const dayOf = (item: DayEntry) => (mode === "encoded" ? item.encodedAt : mode === "or" ? item.orDate : item.remittedAt).slice(0, 10);
  const entries = all.filter((item) => dayOf(item) >= from && dayOf(item) <= to && (!person || item.person.toLowerCase() === person.toLowerCase()) && (!encodedBy || item.encodedByEmployeeId === encodedBy))
    .sort((first, second) => second.encodedAt.localeCompare(first.encodedAt));
  const total = (kind: DayEntry["kind"]) => {
    const items = entries.filter((item) => item.kind === kind);
    return { count: items.length, amount: round(items.reduce((sum, item) => sum + item.amount, 0)), incentives: round(items.reduce((sum, item) => sum + item.incentive, 0)), forfeited: round(items.reduce((sum, item) => sum + item.forfeitedIncentive, 0)) };
  };
  return { entries, sales: total("New Sale"), collections: total("Collection") };
}
