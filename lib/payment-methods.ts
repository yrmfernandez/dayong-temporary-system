import { appendEncodedRows } from "@/lib/encoder-sheets";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { createReadableId } from "@/lib/readable-id";

// 'Payment Methods'!A:E business columns, then encoder identity (npm run sheets:payment-methods).
const RANGE = "'Payment Methods'!A:E";
const text = (value: unknown) => String(value ?? "").trim();
const bool = (value: unknown) => ["true", "yes", "1"].includes(text(value).toLowerCase());

export type PaymentMethod = {
  id: string;
  name: string;
  /** Cash is handed over physically; other methods are verified against a bank or e-wallet reference. */
  isCash: boolean;
  requiresReference: boolean;
  status: "active" | "inactive";
};

async function rows() {
  return (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: RANGE })).data.values ?? [];
}

export async function getPaymentMethods(): Promise<PaymentMethod[]> {
  let data: unknown[][];
  try { data = await rows(); } catch { throw new Error("Run npm run sheets:payment-methods -- --apply to create the Payment Methods sheet."); }
  return data.slice(1).filter((row) => text(row[0])).map((row) => ({
    id: text(row[0]),
    name: text(row[1]),
    isCash: bool(row[2]),
    requiresReference: bool(row[3]),
    status: text(row[4]).toLowerCase() === "inactive" ? "inactive" : "active",
  }));
}

export async function findActivePaymentMethod(name: string) {
  const method = (await getPaymentMethods()).find((item) => item.status === "active" && item.name.toLowerCase() === text(name).toLowerCase());
  if (!method) throw new Error("Select an active way of payment.");
  return method;
}

export async function savePaymentMethod(input: Record<string, unknown>) {
  const id = text(input.id), name = text(input.name);
  const isCash = Boolean(input.isCash), requiresReference = !isCash && Boolean(input.requiresReference);
  const status = text(input.status) === "inactive" ? "inactive" : "active";
  if (!name || name.length > 60) throw new Error("Enter a payment method name of up to 60 characters.");
  const existing = await getPaymentMethods();
  if (existing.some((method) => method.name.toLowerCase() === name.toLowerCase() && method.id !== id)) throw new Error("That payment method already exists.");
  const values = [name, isCash, requiresReference, status];
  if (id) {
    const index = (await rows()).slice(1).findIndex((row) => text(row[0]) === id);
    if (index < 0) throw new Error("Payment method not found.");
    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'Payment Methods'!B${index + 2}:E${index + 2}`, valueInputOption: "RAW", requestBody: { values: [values] } });
    return { id, name, isCash, requiresReference, status };
  }
  const created = createReadableId("PMT");
  await appendEncodedRows({ range: RANGE, requestBody: { values: [[created, ...values]] } });
  return { id: created, name, isCash, requiresReference, status };
}
