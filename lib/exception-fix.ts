/**
 * What the Fix button on Exceptions opens for each kind of issue (owner, November 6, 2026). It used to open the same quick
 * correction form for everything, so an amount issue on a remitted entry showed the amount locked, and a date-order issue
 * had no Date Remitted to change.
 *
 *   fullEdit: the Edit / Corrections editor (lib/entry-edit.ts). Amounts need it: remitted entries can change there, with
 *     months paid and the program, and the incentive and slip follow. Dates out of order need its Date Remitted.
 *   Otherwise the quick form (lib/entry-corrections.ts), which also corrects old records whose account history does not
 *     pass the account rules; the full editor would refuse a number fix on those.
 *   fields: what the form shows first; the rest stays behind Show all fields.
 */
export type EntryField = "account" | "applicationNumber" | "orNumber" | "orDate" | "doiTime" | "amount" | "months" | "dateRemitted" | "paymentMethod" | "notes";
type FixCategory = "dates" | "sequence" | "amounts" | "duplicates" | "backdated" | "receipts" | "incomplete" | "shared";

const FIXES: Record<FixCategory, { fullEdit: boolean; fields: (isSale: boolean) => EntryField[] }> = {
  dates: { fullEdit: false, fields: () => ["orDate"] },
  backdated: { fullEdit: false, fields: () => ["orDate"] },
  sequence: { fullEdit: true, fields: () => ["orDate", "dateRemitted"] },
  amounts: { fullEdit: true, fields: () => ["account", "amount", "months"] },
  receipts: { fullEdit: false, fields: () => ["orNumber"] },
  incomplete: { fullEdit: false, fields: () => ["applicationNumber"] },
  duplicates: { fullEdit: false, fields: (isSale) => [isSale ? "applicationNumber" : "orNumber"] },
  shared: { fullEdit: false, fields: (isSale) => [isSale ? "applicationNumber" : "orNumber"] },
};

/** `canEdit`: the user may use Edit / Corrections; without it everything opens in the quick form. */
export function exceptionFix(category: string, kind: "New Sale" | "Collection", canEdit: boolean) {
  const fix = FIXES[category as FixCategory];
  if (!fix) return { fullEdit: false, fields: undefined };
  return { fullEdit: fix.fullEdit && canEdit, fields: fix.fields(kind === "New Sale") };
}
