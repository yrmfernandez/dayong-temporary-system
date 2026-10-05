import { asc, eq } from "drizzle-orm";

import { currentDb, encodedBy, schema } from "@/lib/db";
import { createReadableId } from "@/lib/readable-id";

const text = (value: unknown) => String(value ?? "").trim();
const methods = schema.remittance_methods;

export type PaymentMethod = {
  id: string;
  name: string;
  /** Cash is handed over physically; other methods are verified against a bank or e-wallet reference. */
  isCash: boolean;
  requiresReference: boolean;
  status: "active" | "inactive";
};

export async function getPaymentMethods(): Promise<PaymentMethod[]> {
  const rows = await currentDb().select().from(methods).orderBy(asc(methods.remittance_method_id));
  return rows.map((row) => ({
    id: row.remittance_method_id,
    name: text(row.method_name),
    isCash: row.is_cash,
    requiresReference: row.requires_reference,
    status: text(row.status).toLowerCase() === "inactive" ? "inactive" : "active",
  }));
}

export async function findActivePaymentMethod(name: string) {
  const method = (await getPaymentMethods()).find((item) => item.status === "active" && item.name.toLowerCase() === text(name).toLowerCase());
  if (!method) throw new Error("Select an active remittance method.");
  return method;
}

export async function savePaymentMethod(input: Record<string, unknown>) {
  const id = text(input.id), name = text(input.name);
  const isCash = Boolean(input.isCash), requiresReference = !isCash && Boolean(input.requiresReference);
  const status = text(input.status) === "inactive" ? "inactive" : "active";
  if (!name || name.length > 60) throw new Error("Enter a remittance method name of up to 60 characters.");
  const existing = await getPaymentMethods();
  if (existing.some((method) => method.name.toLowerCase() === name.toLowerCase() && method.id !== id)) throw new Error("That remittance method already exists.");
  const values = { method_name: name, is_cash: isCash, requires_reference: requiresReference, status };
  if (id) {
    const updated = await currentDb().update(methods).set(values).where(eq(methods.remittance_method_id, id)).returning({ id: methods.remittance_method_id });
    if (!updated.length) throw new Error("Remittance method not found.");
    return { id, name, isCash, requiresReference, status };
  }
  const created = createReadableId("PMT");
  await currentDb().insert(methods).values({ remittance_method_id: created, ...values, ...encodedBy() });
  return { id: created, name, isCash, requiresReference, status };
}
