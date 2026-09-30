// Choices on the company's expense entry form. Shared by the Expenses page and the server so both validate alike.
export const EXPENSE_ACCOUNTS = [
  "Transportation", "Meals/Snacks", "Electric Bill", "Water Bill", "Internet/Load", "Monthly Office Rent", "Bank Fee/Charge",
  "Cash Burial Assistance", "Allowance", "Office Supplies", "Cash Advance", "Miscellaneous", "Other",
] as const;
export const EXPENSE_ATTACHMENTS = ["Voucher", "Invoice", "Receipt", "MC Minutes", "Other"] as const;
export const EXPENSE_APPROVERS = ["VP Finance", "CEO/President", "Other"] as const;

const text = (value: unknown) => String(value ?? "").trim();

/** A choice from `options`, where "Other" must say what it is and is saved as "Other: <detail>". */
export function choiceWithOther(options: readonly string[], value: unknown, detail: unknown, label: string) {
  const choice = text(value), other = text(detail).slice(0, 100);
  if (!options.includes(choice)) throw new Error(`Select the ${label}.`);
  if (choice !== "Other") return choice;
  if (!other) throw new Error(`Specify the other ${label}.`);
  return `Other: ${other}`;
}

/** The attachment checklist, saved as a comma-separated list; "Other" must say what the document is. */
export function attachmentList(values: unknown, otherDetail: unknown) {
  const chosen = Array.isArray(values) ? [...new Set(values.map(text))] : [];
  if (chosen.some((value) => !(EXPENSE_ATTACHMENTS as readonly string[]).includes(value))) throw new Error("Select valid attachments.");
  return chosen.map((value) => value === "Other" ? choiceWithOther(EXPENSE_ATTACHMENTS, value, otherDetail, "attachment") : value)
    .sort((a, b) => EXPENSE_ATTACHMENTS.findIndex((item) => a.startsWith(item)) - EXPENSE_ATTACHMENTS.findIndex((item) => b.startsWith(item)))
    .join(", ");
}
