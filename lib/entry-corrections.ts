import { eq } from "drizzle-orm";

import { inTransaction, schema } from "@/lib/db";
import { entryKey, recordedApplicationNumbers, recordedOrNumbers } from "@/lib/duplicate-entries";
import { manilaNow } from "@/lib/remittance-deadline";
import { recordCorrection } from "@/lib/record-corrections";
import { isDigitsOnlyOrNumber, normalizeOrNumber, orNumberProblem } from "@/lib/or-number";
import { NO_LETTER_NOTE } from "@/lib/or-no-letter";

const text = (value: unknown) => String(value ?? "").trim();
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/**
 * Administrator correction of a New Sale or Collection, with the reason kept in Record Corrections. OR number and
 * OR date can always be fixed (typos, including imported legacy rows). The amount is money already counted on a
 * remittance slip once the item is linked, so it is corrected only while the item is still outstanding. OR fields on a
 * sale are changed only when the request includes them.
 *
 * The entry is read and updated by ID in one transaction that locks it (upgrade #6), so a slip created at the same moment
 * cannot slip past the "not on a Remittance" check, and the update never lands on another row.
 */
export async function correctSaleOrCollection(body: Record<string, unknown>) {
  const id = text(body.id), moduleName = text(body.module), reason = text(body.reason);
  if (!id || !reason) throw new Error("Record and correction reason are required.");
  const isSale = moduleName === "New Sales";
  if (!isSale && moduleName !== "Collections") throw new Error("Only New Sales and Collections can be corrected here.");
  const today = manilaNow().date;
  const amount = Number(isSale ? body.amountPaid : body.amountCollected);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid amount greater than zero.");

  const outcome = await inTransaction(async (tx) => {
    const [row] = isSale
      ? await tx.select({ status: schema.sales.remittance_status, amount: schema.sales.amount_paid, orNumber: schema.sales.or_number, orDate: schema.sales.or_date, applicationNumber: schema.sales.application_no, notes: schema.sales.notes })
        .from(schema.sales).where(eq(schema.sales.sale_id, id)).for("update")
      : await tx.select({ status: schema.collections.remittance_status, amount: schema.collections.amount_collected, orNumber: schema.collections.or_number, orDate: schema.collections.or_date, applicationNumber: schema.collections.or_number, notes: schema.collections.or_number })
        .from(schema.collections).where(eq(schema.collections.collection_id, id)).for("update");
    if (!row) throw new Error("Record not found.");
    // Returned entries are back with the clerk, so their amount can be corrected before they are resubmitted.
    const onRemittance = !["", "Outstanding", "Returned"].includes(text(row.status));
    if (onRemittance && Math.round(amount * 100) !== Math.round((Number(row.amount) || 0) * 100)) throw new Error(`This ${isSale ? "New Sale" : "Collection"} is on a Remittance, so its amount is corrected through reconciliation. OR number and OR date can still be fixed.`);

    const changesOr = !isSale || "orNumber" in body || "orDate" in body;
    const orNumber = changesOr ? (isSale ? text(body.orNumber) : normalizeOrNumber(text(body.orNumber))) : text(row.orNumber);
    const orDate = changesOr ? text(body.orDate) : text(row.orDate);
    if (changesOr) {
      if (!isSale && !orNumber) throw new Error("OR number is required.");
      // A corrected OR number ends with its branch letter too (lib/or-number.ts); an unchanged old one may stay as it is.
      // `orNoLetter`: an Administrator confirmed the receipt has no letter (the route checks who ticked it).
      const problem = orNumberProblem(orNumber, { noLetter: body.orNoLetter === true });
      if (!isSale && entryKey(orNumber) !== entryKey(row.orNumber) && problem) throw new Error(problem);
      if ((!isSale || orDate) && (!validDate(orDate) || orDate > today)) throw new Error("Enter a valid OR date, today or earlier.");
      // Each OR number is one receipt; a correction must not reuse another entry's.
      if (!isSale && entryKey(orNumber) !== entryKey(row.orNumber)) {
        const used = (await recordedOrNumbers([orNumber], tx)).get(entryKey(orNumber));
        if (used && used.collectionId !== id) throw new Error(`OR Number ${orNumber} is already recorded on collection ${used.collectionId}.`);
      }
    }

    if (isSale) {
      const applicationNumber = text(body.applicationNumber), notes = text(body.notes);
      if (!applicationNumber) throw new Error("Application number is required.");
      if (entryKey(applicationNumber) !== entryKey(row.applicationNumber)) {
        const used = (await recordedApplicationNumbers([applicationNumber], tx)).get(entryKey(applicationNumber));
        if (used && used.saleId !== id) throw new Error(`Application number ${applicationNumber} is already recorded on sale ${used.saleId}.`);
      }
      await tx.update(schema.sales).set({ amount_paid: amount, notes: notes || null, application_no: applicationNumber, ...(changesOr ? { or_number: orNumber || null, or_date: orDate || null } : {}) })
        .where(eq(schema.sales.sale_id, id));
      return { before: { applicationNumber: row.applicationNumber, amountPaid: row.amount, notes: row.notes, orNumber: row.orNumber, orDate: row.orDate }, after: { applicationNumber, amountPaid: amount, notes, orNumber, orDate } };
    }
    await tx.update(schema.collections).set({ or_number: orNumber, or_date: orDate, amount_collected: amount }).where(eq(schema.collections.collection_id, id));
    const confirmed = body.orNoLetter === true && isDigitsOnlyOrNumber(orNumber) && entryKey(orNumber) !== entryKey(row.orNumber);
    return { before: { orNumber: row.orNumber, orDate: row.orDate, amountCollected: row.amount }, after: { orNumber, orDate, amountCollected: amount, ...(confirmed ? { orNumberNote: NO_LETTER_NOTE } : {}) } };
  });
  await recordCorrection(moduleName, id, reason, outcome.before, outcome.after);
  return { message: `${moduleName} record corrected and audited.` };
}
