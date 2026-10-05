import { sql } from "drizzle-orm";

import { readSheetRows } from "@/lib/sheets-on-db";
import type { CorrectableEntry } from "@/components/entry-correction-form";
import { COLLECTIONS_RANGE, MEMBERS_RANGE, PROGRAMS_RANGE, REMITTANCES_RANGE, SALES_RANGE } from "@/lib/sheet-ranges";
import { monthCount } from "@/lib/account-rules";
import { entryKey, personKey } from "@/lib/duplicate-entries";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { isoDate } from "@/lib/program-age";
import { fixedNewSaleAmount, isTrue } from "@/lib/program-amount-lock";
import { incentiveDeadline, manilaDateOf, manilaNow } from "@/lib/remittance-deadline";
import { dateWarnings } from "@/lib/date-checks";

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => Number(value ?? 0) || 0;
const cents = (value: number) => Math.round(value * 100);
const peso = (value: number) => value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
// Imported rows carry -LEG- in their IDs; they are hidden unless asked for, so new mistakes stand out.
const isLegacy = (id: string) => id.includes("-LEG-");

export const EXCEPTION_CATEGORIES = {
  dates: "Impossible or future dates",
  sequence: "Dates out of order",
  amounts: "Amounts that do not match the program",
  duplicates: "Possible duplicates",
  members: "Members with missing details",
  overdue: "Cash past the incentive deadline",
  backdated: "Late entries to review",
  receipts: "OR numbers without a branch letter",
} as const;
export type ExceptionCategory = keyof typeof EXCEPTION_CATEGORIES;


export type ExceptionItem = {
  category: ExceptionCategory;
  /** Stable key so the page can list and re-render items. */
  key: string;
  recordId: string;
  title: string;
  problem: string;
  date: string;
  legacy: boolean;
  /** Present when the item can be fixed with the correction form. */
  entry?: CorrectableEntry;
  /** Otherwise, where to fix it. */
  href?: string;
};

const LIMIT = 300;

/**
 * Data problems an administrator should look at, found by reading the sheets: nothing is stored. Each item says what
 * is wrong and either opens the correction form or links to the page where it is fixed.
 */
export async function findExceptions({ includeLegacy = false } = {}) {
  // Without old (-LEG-) data, only accounts with new entries are loaded, each with its whole history (the sequence
  // checks compare an account's payments); the imported accounts alone are about 59,000 collections.
  // OR numbers without a branch letter are always listed, old data included.
  const newOnly = sql`(enrollment_id in (select enrollment_id from collections where collection_id not like '%-LEG-%') or trim(or_number) ~ '^[0-9]+$')`;
  const [collections, sales, response] = await Promise.all([
    includeLegacy ? sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: COLLECTIONS_RANGE, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" }).then((result) => result.data.values ?? []) : readSheetRows("Collections", newOnly),
    includeLegacy ? sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: SALES_RANGE, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" }).then((result) => result.data.values ?? []) : readSheetRows("Sales", sql`sale_id not like '%-LEG-%'`),
    sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: [PROGRAMS_RANGE, MEMBERS_RANGE, REMITTANCES_RANGE], valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" }),
  ]);
  const [programs, members, remittances] = response.data.valueRanges?.map((range) => range.values ?? []) ?? [];
  const now = manilaNow(), today = now.date, nowStamp = `${now.date} ${now.time}`;
  const programById = new Map(programs.slice(1).filter((row) => text(row[0])).map((row) => [text(row[0]), {
    name: text(row[2]) || text(row[1]), basePay: number(row[3]), registrationFeeRequired: /^yes$/i.test(text(row[10])) || row[10] === true,
    registrationAmount: number(row[11]), payBalanceTotal: number(row[12]), newSaleAmountEditable: isTrue(row[19]), flexible: isTrue(row[21]),
  }]));
  const items: ExceptionItem[] = [];
  const add = (item: ExceptionItem) => { if (includeLegacy || !item.legacy) items.push(item); };

  const posted = collections.slice(1).filter((row) => text(row[0]) && text(row[19]).toLowerCase() === "posted");
  const collectionEntry = (row: unknown[]): CorrectableEntry => ({
    kind: "Collection", id: text(row[0]), orNumber: text(row[8]), orDate: text(row[9]).slice(0, 10), amount: number(row[10]),
    applicationNumber: "", notes: "", onRemittance: !["", "Outstanding"].includes(text(row[28])),
  });
  const saleEntry = (row: unknown[]): CorrectableEntry => ({
    kind: "New Sale", id: text(row[0]), orNumber: text(row[29]), orDate: text(row[30]).slice(0, 10), amount: number(row[26]),
    applicationNumber: text(row[28]), notes: text(row[27]), onRemittance: !["", "Outstanding"].includes(text(row[35])),
  });
  const collectionTitle = (row: unknown[]) => `Collection ${text(row[0])} · member ${text(row[4]) || "?"} · ${programById.get(text(row[5]))?.name ?? text(row[5])}`;
  const saleTitle = (row: unknown[]) => `New Sale ${text(row[0])} · ${`${text(row[7])} ${text(row[6])}`.trim() || "?"} · ${programById.get(text(row[21]))?.name ?? text(row[21])}`;

  // Dates that cannot be right: not a real date, in the future, or before the company could have issued it.
  for (const row of posted) {
    const date = text(row[9]).slice(0, 10);
    if (!validDay(date) || date > today || date < "2000-01-01") add({ category: "dates", key: `dates-${text(row[0])}`, recordId: text(row[0]), title: collectionTitle(row), problem: `OR date "${text(row[9]) || "blank"}" is ${!validDay(date) ? "not a valid date" : date > today ? "in the future" : "too far in the past"}.`, date, legacy: isLegacy(text(row[0])), entry: collectionEntry(row) });
    // Each branch's receipts carry its letter (e.g. "12345 S"). Those the letter fix could not settle with certainty
    // (scripts/fix-or-letters.mjs) are listed for staff, old data included, so they are corrected one by one.
    if (/^\d+$/.test(text(row[8]))) add({ category: "receipts", key: `receipts-${text(row[0])}`, recordId: text(row[0]), title: collectionTitle(row), problem: `OR number "${text(row[8])}" has no branch letter. Check the receipt and correct it (for example "${text(row[8])} S").`, date, legacy: false, entry: collectionEntry(row) });
  }
  for (const row of sales.slice(1).filter((item) => text(item[0]))) {
    const date = text(row[30]).slice(0, 10);
    if (date && (!validDay(date) || date > today || date < "2000-01-01")) add({ category: "dates", key: `dates-${text(row[0])}`, recordId: text(row[0]), title: saleTitle(row), problem: `Application date "${text(row[30])}" is ${!validDay(date) ? "not a valid date" : date > today ? "in the future" : "too far in the past"}.`, date, legacy: isLegacy(text(row[0])), entry: saleEntry(row) });
  }

  // Dates that are each possible but do not fit together: a receipt dated after it was recorded, cash remitted before
  // the receipt or long after it, a slip dated differently from the entry. Invalid and future receipt dates are listed
  // above under dates, so they are not repeated here.
  const slipDates = new Map(remittances.slice(1).filter((row) => text(row[0])).map((row) => [text(row[0]), text(row[3]).slice(0, 10)]));
  const inSequence = (warning: string) => !/^The (OR|application) date .* (is in the future|is not a valid date)/.test(warning);
  for (const row of posted) {
    const warnings = dateWarnings({ receiptDate: text(row[9]).slice(0, 10), dateRemitted: text(row[40]).slice(0, 10), slipDate: slipDates.get(text(row[29])), recordedOn: manilaDateOf(text(row[20]) || text(row[24])), today }).filter(inSequence);
    if (warnings.length) add({ category: "sequence", key: `sequence-${text(row[0])}`, recordId: text(row[0]), title: collectionTitle(row), problem: warnings.join(" "), date: text(row[9]).slice(0, 10), legacy: isLegacy(text(row[0])), entry: collectionEntry(row) });
  }
  for (const row of sales.slice(1).filter((item) => text(item[0]))) {
    const warnings = dateWarnings({ receiptDate: text(row[30]).slice(0, 10), receiptLabel: "application date", dateRemitted: text(row[4]).slice(0, 10), slipDate: slipDates.get(text(row[36])), recordedOn: manilaDateOf(text(row[1])), today }).filter(inSequence);
    if (warnings.length) add({ category: "sequence", key: `sequence-${text(row[0])}`, recordId: text(row[0]), title: saleTitle(row), problem: warnings.join(" "), date: text(row[30]).slice(0, 10), legacy: isLegacy(text(row[0])), entry: saleEntry(row) });
  }

  // Amounts: a collection must be whole installments, or more only when it pays the program off exactly.
  const byEnrollment = new Map<string, unknown[][]>();
  for (const row of posted) byEnrollment.set(text(row[2]), [...(byEnrollment.get(text(row[2])) ?? []), row]);
  for (const rows of byEnrollment.values()) {
    let paid = 0;
    for (const row of [...rows].sort((a, b) => number(a[13]) - number(b[13]))) {
      const program = programById.get(text(row[5])), amount = number(row[10]);
      paid += cents(amount);
      if (!program?.basePay || !/^\d{4}-\d{2}$/.test(text(row[11])) || !/^\d{4}-\d{2}$/.test(text(row[12]))) continue;
      const months = monthCount(text(row[11]), text(row[12])), expected = cents(program.basePay) * months;
      if (months < 1) continue;
      const short = cents(amount) < expected, overButNotPayoff = cents(amount) > expected && !(program.payBalanceTotal && paid === cents(program.payBalanceTotal));
      if (short || overButNotPayoff) add({ category: "amounts", key: `amounts-${text(row[0])}`, recordId: text(row[0]), title: collectionTitle(row), problem: `${peso(amount)} for ${months} month${months === 1 ? "" : "s"}; the program expects ${peso(expected / 100)}${overButNotPayoff ? " (more is allowed only when it pays the program off exactly)" : ""}.`, date: text(row[9]).slice(0, 10), legacy: isLegacy(text(row[0])), entry: collectionEntry(row) });
    }
  }
  // A New Sale on a program with a locked amount must be its fixed amount.
  for (const row of sales.slice(1).filter((item) => text(item[0]))) {
    const program = programById.get(text(row[21]));
    if (!program || program.newSaleAmountEditable || program.flexible) continue;
    const fixed = fixedNewSaleAmount(program);
    if (fixed > 0 && cents(number(row[26])) !== cents(fixed)) add({ category: "amounts", key: `amounts-${text(row[0])}`, recordId: text(row[0]), title: saleTitle(row), problem: `Amount paid ${peso(number(row[26]))}; ${program.name} is fixed at ${peso(fixed)}.`, date: manilaDateOf(text(row[1])), legacy: isLegacy(text(row[0])), entry: saleEntry(row) });
  }

  // Duplicates: one OR number per posted collection, one application number per sale, one record per person.
  const seen = (rows: unknown[][], keyOf: (row: unknown[]) => string, report: (row: unknown[], first: unknown[]) => void) => {
    const first = new Map<string, unknown[]>();
    for (const row of rows) { const key = keyOf(row); if (!key) continue; const earlier = first.get(key); if (earlier) report(row, earlier); else first.set(key, row); }
  };
  seen(posted, (row) => entryKey(row[8]), (row, first) => add({ category: "duplicates", key: `dup-or-${text(row[0])}`, recordId: text(row[0]), title: collectionTitle(row), problem: `OR number ${text(row[8])} is also on collection ${text(first[0])}. Each receipt is used once.`, date: text(row[9]).slice(0, 10), legacy: isLegacy(text(row[0])) && isLegacy(text(first[0])), entry: collectionEntry(row) }));
  seen(sales.slice(1).filter((row) => text(row[0])), (row) => entryKey(row[28]), (row, first) => add({ category: "duplicates", key: `dup-app-${text(row[0])}`, recordId: text(row[0]), title: saleTitle(row), problem: `Application number ${text(row[28])} is also on sale ${text(first[0])}.`, date: manilaDateOf(text(row[1])), legacy: isLegacy(text(row[0])) && isLegacy(text(first[0])), entry: saleEntry(row) }));
  seen(members.slice(1).filter((row) => text(row[0])), (row) => personKey({ surname: row[2], firstName: row[3], birthdate: row[6] }), (row, first) => add({ category: "duplicates", key: `dup-member-${text(row[0])}`, recordId: text(row[0]), title: `Member ${text(row[1]) || text(row[0])} · ${text(row[3])} ${text(row[2])}`, problem: `Same name and birthdate as member ${text(first[1]) || text(first[0])}. They may be the same person registered twice.`, date: "", legacy: isLegacy(text(row[0])) && isLegacy(text(first[0])), href: `/members?search=${encodeURIComponent(text(row[1]) || text(row[0]))}` }));

  // Members without the details needed to identify them or reach their claimant.
  for (const row of members.slice(1).filter((item) => text(item[0]) && !/deceased|inactive/i.test(text(item[17])))) {
    const missing = [!isoDate(row[6]) && "birthdate", !text(row[11]) && "contact number", !text(row[12]) && "address"].filter(Boolean);
    if (missing.length) add({ category: "members", key: `member-${text(row[0])}`, recordId: text(row[0]), title: `Member ${text(row[1]) || text(row[0])} · ${text(row[3])} ${text(row[2])}`, problem: `Missing ${missing.join(", ")}.`, date: "", legacy: isLegacy(text(row[0])), href: `/members?search=${encodeURIComponent(text(row[1]) || text(row[0]))}` });
  }

  // Cash still with staff after the incentive deadline: the incentive is lost once it is remitted.
  for (const row of posted.filter((item) => text(item[28]) === "Outstanding")) {
    const deadline = incentiveDeadline(text(row[9]));
    if (deadline && deadline < nowStamp) add({ category: "overdue", key: `overdue-${text(row[0])}`, recordId: text(row[0]), title: `${collectionTitle(row)} · ${text(row[31]) || text(row[7])}`, problem: `${peso(number(row[10]))} not remitted; the incentive deadline was ${deadline}.`, date: text(row[9]).slice(0, 10), legacy: isLegacy(text(row[0])), href: "/remittances" });
  }
  for (const row of sales.slice(1).filter((item) => text(item[0]) && text(item[35]) === "Outstanding")) {
    const deadline = incentiveDeadline(text(row[30]) || manilaDateOf(text(row[1])));
    if (deadline && deadline < nowStamp) add({ category: "overdue", key: `overdue-${text(row[0])}`, recordId: text(row[0]), title: `${saleTitle(row)} · ${text(row[3])}`, problem: `${peso(number(row[26]))} not remitted; the incentive deadline was ${deadline}.`, date: text(row[30]).slice(0, 10), legacy: isLegacy(text(row[0])), href: "/remittances" });
  }

  // Entries saved with a late date in the last 30 days, with the reason given, for an administrator to review.
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
  for (const row of posted) if (text(row[39]) && manilaDateOf(text(row[24])) >= since) add({ category: "backdated", key: `late-${text(row[0])}`, recordId: text(row[0]), title: collectionTitle(row), problem: `OR date ${text(row[9]).slice(0, 10)} encoded on ${manilaDateOf(text(row[24]))} by ${text(row[23]) || "?"}. Reason: ${text(row[39])}`, date: text(row[9]).slice(0, 10), legacy: false, entry: collectionEntry(row) });
  for (const row of sales.slice(1)) if (text(row[0]) && text(row[44]) && manilaDateOf(text(row[34])) >= since) add({ category: "backdated", key: `late-${text(row[0])}`, recordId: text(row[0]), title: saleTitle(row), problem: `Application date ${text(row[30]).slice(0, 10)} encoded on ${manilaDateOf(text(row[34]))} by ${text(row[33]) || "?"}. Reason: ${text(row[44])}`, date: text(row[30]).slice(0, 10), legacy: false, entry: saleEntry(row) });

  const categories = (Object.keys(EXCEPTION_CATEGORIES) as ExceptionCategory[]).map((category) => {
    const all = items.filter((item) => item.category === category).sort((a, b) => b.date.localeCompare(a.date));
    return { category, label: EXCEPTION_CATEGORIES[category], total: all.length, items: all.slice(0, LIMIT) };
  });
  return { categories, limit: LIMIT, includeLegacy };
}
