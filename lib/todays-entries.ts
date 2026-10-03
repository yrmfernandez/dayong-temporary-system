import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { COLLECTIONS_RANGE, MEMBERS_RANGE, PROGRAMS_RANGE, REMITTANCES_RANGE, SALES_RANGE } from "@/lib/sheet-ranges";
import { incentiveDeadline, manilaDateOf } from "@/lib/remittance-deadline";
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
};

/**
 * New Sales and posted Collections for one day, where the day is when they were encoded, their OR date, or the date
 * the office received the cash on a remittance slip (rejected slips are unlinked, so they do not count).
 */
export async function getEntriesForDay(date: string, mode: TodayMode, person = "") {
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: GOOGLE_SHEET_ID,
    ranges: [SALES_RANGE, COLLECTIONS_RANGE, REMITTANCES_RANGE, PROGRAMS_RANGE, MEMBERS_RANGE],
    valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING",
  });
  const [sales, collections, remittances, programs, members] = response.data.valueRanges?.map((range) => range.values ?? []) ?? [];
  const programNames = new Map(programs.slice(1).map((row) => [text(row[0]), text(row[2]) || text(row[1])]));
  const memberNames = new Map(members.slice(1).map((row) => [text(row[0]), `${text(row[3])} ${text(row[2])}`.trim()]));
  const slips = new Map(remittances.slice(1).filter((row) => text(row[0])).map((row) => [text(row[0]), text(row[26]) ? `${text(row[3])} ${text(row[26])}` : text(row[3])]));

  const entry = (values: Omit<DayEntry, "remittedAt" | "onRemittance" | "incentiveDeadline">): DayEntry => ({
    ...values, remittedAt: slips.get(values.remittanceId) ?? "", onRemittance: !["", "Outstanding"].includes(values.remittanceStatus), incentiveDeadline: incentiveDeadline(values.orDate),
  });
  const all: DayEntry[] = [
    ...sales.slice(1).filter((row) => text(row[0])).map((row) => {
      const amount = number(row[26]), remittance = text(row[41]) === "" ? amount : number(row[41]);
      return entry({
        kind: "New Sale", id: text(row[0]), memberNumber: text(row[5]), memberName: `${text(row[7])} ${text(row[6])}`.trim(),
        program: programNames.get(text(row[21])) || text(row[21]), branch: text(row[2]), person: text(row[3]),
        orNumber: text(row[29]), orDate: text(row[30]).slice(0, 10) || manilaDateOf(text(row[1])), applicationNumber: text(row[28]), notes: text(row[27]),
        amount, incentive: Math.max(0, round(amount - remittance)), forfeitedIncentive: number(row[43]),
        remittanceStatus: text(row[35]), remittanceId: text(row[36]), encodedBy: text(row[33]), encodedAt: manilaTime(text(row[34]) || text(row[1])),
      });
    }),
    ...collections.slice(1).filter((row) => text(row[0]) && text(row[19]).toLowerCase() === "posted").map((row) => {
      const amount = number(row[10]);
      return entry({
        kind: "Collection", id: text(row[0]), memberNumber: text(row[4]), memberName: memberNames.get(text(row[3])) ?? "",
        program: programNames.get(text(row[5])) || text(row[5]), branch: text(row[6]), person: text(row[31]) || text(row[7]),
        orNumber: text(row[8]), orDate: text(row[9]).slice(0, 10), applicationNumber: "", notes: "",
        amount, incentive: Math.max(0, round(amount - number(row[26]))), forfeitedIncentive: number(row[38]),
        remittanceStatus: text(row[28]), remittanceId: text(row[29]), encodedBy: text(row[23]), encodedAt: manilaTime(text(row[24]) || text(row[20])),
      });
    }),
  ];
  const dayOf = (item: DayEntry) => (mode === "encoded" ? item.encodedAt : mode === "or" ? item.orDate : item.remittedAt).slice(0, 10);
  const entries = all.filter((item) => dayOf(item) === date && (!person || item.person.toLowerCase() === person.toLowerCase()))
    .sort((first, second) => second.encodedAt.localeCompare(first.encodedAt));
  const total = (kind: DayEntry["kind"]) => {
    const items = entries.filter((item) => item.kind === kind);
    return { count: items.length, amount: round(items.reduce((sum, item) => sum + item.amount, 0)), incentives: round(items.reduce((sum, item) => sum + item.incentive, 0)), forfeited: round(items.reduce((sum, item) => sum + item.forfeitedIncentive, 0)) };
  };
  return { entries, sales: total("New Sale"), collections: total("Collection") };
}
