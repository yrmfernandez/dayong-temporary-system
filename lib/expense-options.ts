// Choices on the company's expense entry form. Shared by the Expenses page and the server so both validate alike.
// The company's expense accounts (owner, October 22, 2026); "Others" must say what it is.
export const EXPENSE_ACCOUNTS = [
  "CBA (Cash Burial Assistance)", "Allowances", "Services MAS incentives", "Services Tie-up", "Vehicle Maintenance", "Transportation",
  "Permit/License", "Office Supplies", "Gasoline", "Professional Fee", "ORC", "Sales incentives", "Collections incentives",
  "Office Rental", "Monthly Bills", "Interment", "Funeral Supplies/stocks", "Preservation", "Pull-out", "Forms/Receipt",
  "Vehicle Registration", "Medical Assistance", "SSS", "Philhealth", "Embalming Supplies", "Casket Procurement",
  "Office Maintenance/renovations", "Others",
] as const;
/** Cash Burial Assistance names the member or deceased member it is for, saved as the payee (owner, October 20, 2026). */
export const BURIAL_ACCOUNT = "CBA (Cash Burial Assistance)";
/** The choice that must be specified: "Other", or "Others" for expense accounts. */
export const isOtherChoice = (choice: string) => choice === "Other" || choice === "Others";
export const EXPENSE_ATTACHMENTS = ["Voucher", "Invoice", "Receipt", "MC Minutes", "Other"] as const;
export const EXPENSE_APPROVERS = ["VP Finance", "CEO/President", "Other"] as const;

const text = (value: unknown) => String(value ?? "").trim();

/** A choice from `options`, where "Other" (or "Others") must say what it is and is saved as "Other: <detail>" ("Others: <detail>"). */
export function choiceWithOther(options: readonly string[], value: unknown, detail: unknown, label: string) {
  const choice = text(value), other = text(detail).slice(0, 100);
  if (!options.includes(choice)) throw new Error(`Select the ${label}.`);
  if (!isOtherChoice(choice)) return choice;
  if (!other) throw new Error(`Specify the other ${label}.`);
  return `${choice}: ${other}`;
}

/** The attachment checklist, saved as a comma-separated list; "Other" must say what the document is. */
export function attachmentList(values: unknown, otherDetail: unknown) {
  const chosen = Array.isArray(values) ? [...new Set(values.map(text))] : [];
  if (chosen.some((value) => !(EXPENSE_ATTACHMENTS as readonly string[]).includes(value))) throw new Error("Select valid attachments.");
  return chosen.map((value) => value === "Other" ? choiceWithOther(EXPENSE_ATTACHMENTS, value, otherDetail, "attachment") : value)
    .sort((a, b) => EXPENSE_ATTACHMENTS.findIndex((item) => a.startsWith(item)) - EXPENSE_ATTACHMENTS.findIndex((item) => b.startsWith(item)))
    .join(", ");
}

/** Rules every expense follows (owner, October 20, 2026): a receipt number, and the member's name for Cash Burial Assistance. */
export function expenseNumbers(account: string, receiptNumber: unknown, memberName: unknown) {
  const receipt = text(receiptNumber).slice(0, 100), member = text(memberName).slice(0, 150);
  if (!receipt) throw new Error("Enter the receipt number.");
  if (account === BURIAL_ACCOUNT && !member) throw new Error("Enter the name of the member or deceased member for Cash Burial Assistance.");
  return { receipt, member };
}
