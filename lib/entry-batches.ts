import { getPaymentMethods } from "@/lib/remittance-methods";

const text = (value: unknown) => String(value ?? "").trim();

/**
 * Batches and cash (owner, October 10, 2026).
 *
 * A receipt photo is attached per saved batch, not per member: a Collections save has its batch ID; New Sales have none
 * stored, so the sales one clerk saved together (same minute, MAS, branch and Date Remitted) form one batch. A New
 * Sales batch is also one remittance slip, like a Collections batch.
 *
 * Cash needs no receipt photo: the clerk counted it at Clearing, so a cash entry goes to Pending Approval as soon as it
 * is saved. Other methods (bank, e-wallet) still need the photo of the slip or transfer.
 */
export function saleBatchKey(sale: { encodedByEmployeeId: string; encodedAt: string; accountableEmployeeId: string; branch: string; dateRemitted: string }) {
  // Imported sales have no encoder; each stays on its own.
  if (!text(sale.encodedByEmployeeId) || !text(sale.encodedAt)) return "";
  return `NS|${text(sale.encodedByEmployeeId)}|${text(sale.encodedAt).slice(0, 16)}|${text(sale.accountableEmployeeId)}|${text(sale.branch).toLowerCase()}|${text(sale.dateRemitted).slice(0, 10)}`;
}

/** Lowercase names of the payment methods that are cash (Master Data → Remittance methods), plus "cash" itself. */
export async function cashMethodNames() {
  const names = new Set(["cash"]);
  for (const method of await getPaymentMethods().catch(() => [])) if (method.isCash) names.add(method.name.toLowerCase());
  return names;
}

/** A blank method is cash (the default on every form). */
export const isCashMethod = (method: string, cashNames: Set<string>) => !text(method) || cashNames.has(text(method).toLowerCase());
