/**
 * Date rules for New Sales and Collections. Each date on an entry tells part of one story: the receipt is issued (OR or
 * application date), the cash reaches the office (date remitted, and the remittance slip), and the entry is recorded.
 * They must happen in that order and close together. Anything out of order, or far apart, is returned as a warning so
 * it can be shown on the form, on Today's Entries, and in Exceptions. All dates are "YYYY-MM-DD" (Manila).
 */
export const REMIT_LATE_DAYS = 7;
export const ENCODE_LATE_DAYS = 30;

export type DateFacts = {
  /** OR date for a Collection, application date for a New Sale. */
  receiptDate: string;
  receiptLabel?: string;
  dateRemitted?: string;
  /** The date on the remittance slip that covers the entry. */
  slipDate?: string;
  /** When the entry was recorded in the system. */
  recordedOn?: string;
  today?: string;
};

const valid = (value?: string): value is string => Boolean(value) && /^\d{4}-\d{2}-\d{2}$/.test(value!) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const plural = (count: number) => `${count} day${count === 1 ? "" : "s"}`;

export function dateWarnings({ receiptDate, receiptLabel = "OR date", dateRemitted, slipDate, recordedOn, today }: DateFacts) {
  const warnings: string[] = [];
  const receipt = receiptDate.slice(0, 10);
  if (!valid(receipt)) return receiptDate ? [`The ${receiptLabel} "${receiptDate}" is not a valid date.`] : [];
  if (valid(today) && receipt > today) warnings.push(`The ${receiptLabel} ${receipt} is in the future.`);
  if (valid(recordedOn) && receipt > recordedOn) warnings.push(`The ${receiptLabel} ${receipt} is ${plural(days(recordedOn, receipt))} after the entry was recorded (${recordedOn}). A receipt cannot be dated after it was encoded.`);
  if (valid(recordedOn) && days(receipt, recordedOn) > ENCODE_LATE_DAYS) warnings.push(`Encoded ${plural(days(receipt, recordedOn))} after the ${receiptLabel} (${receipt}).`);
  if (valid(dateRemitted)) {
    if (dateRemitted < receipt) warnings.push(`Remitted on ${dateRemitted}, ${plural(days(dateRemitted, receipt))} before the ${receiptLabel} (${receipt}). Cash cannot be remitted before the receipt is issued.`);
    else if (days(receipt, dateRemitted) > REMIT_LATE_DAYS) warnings.push(`Remitted ${plural(days(receipt, dateRemitted))} after the ${receiptLabel} (${receipt}). Cash is due by 10:00 AM the next day.`);
    if (valid(recordedOn) && dateRemitted > recordedOn) warnings.push(`The date remitted ${dateRemitted} is after the entry was recorded (${recordedOn}).`);
    if (valid(today) && dateRemitted > today) warnings.push(`The date remitted ${dateRemitted} is in the future.`);
  }
  if (valid(slipDate)) {
    if (slipDate < receipt) warnings.push(`The remittance slip is dated ${slipDate}, before the ${receiptLabel} (${receipt}).`);
    if (valid(dateRemitted) && Math.abs(days(dateRemitted, slipDate)) > 1) warnings.push(`The entry says remitted on ${dateRemitted}, but its remittance slip is dated ${slipDate}.`);
  }
  return warnings;
}

/** Problems that make an entry impossible, so a save is refused: remitted before the receipt or in the future. */
export function blockingDateProblem({ receiptDate, receiptLabel = "OR date", dateRemitted, today }: DateFacts) {
  if (!valid(receiptDate) || !valid(dateRemitted)) return "";
  if (dateRemitted < receiptDate) return `Date Remitted (${dateRemitted}) cannot be before the ${receiptLabel} (${receiptDate}).`;
  if (valid(today) && dateRemitted > today) return `Date Remitted (${dateRemitted}) cannot be in the future.`;
  return "";
}
