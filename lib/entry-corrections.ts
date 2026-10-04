import { entryKey, recordedApplicationNumbers, recordedOrNumbers } from "@/lib/duplicate-entries";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { manilaNow } from "@/lib/remittance-deadline";
import { recordCorrection } from "@/lib/record-corrections";

const text = (value: unknown) => String(value ?? "").trim();
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/**
 * Administrator correction of a New Sale or Collection, with the reason kept in Record Corrections. OR number and
 * OR date can always be fixed (typos, including imported legacy rows). The amount is money already counted on a
 * remittance slip once the item is linked, so it is corrected only while the item is still outstanding.
 * Sales: AA amount_paid, AB notes, AC application_no, AD or_number, AE or_date. Collections: I or_number, J or_date,
 * K amount_collected. OR fields on a sale are changed only when the request includes them.
 */
export async function correctSaleOrCollection(body: Record<string, unknown>) {
  const id = text(body.id), moduleName = text(body.module), reason = text(body.reason);
  if (!id || !reason) throw new Error("Record and correction reason are required.");
  const isSale = moduleName === "New Sales", sheet = isSale ? "Sales" : moduleName === "Collections" ? "Collections" : "";
  if (!sheet) throw new Error("Only New Sales and Collections can be corrected here.");
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${sheet}'!A:AL`, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
  const rows = response.data.values ?? [], index = rows.slice(1).findIndex((row) => text(row[0]) === id);
  if (index < 0) throw new Error("Record not found.");
  const rowNumber = index + 2, row = rows[index + 1];
  // Returned entries are back with the clerk, so their amount can be corrected before they are resubmitted.
  const onRemittance = !["", "Outstanding", "Returned"].includes(text(row[isSale ? 35 : 28]));
  const today = manilaNow().date;

  const amount = Number(isSale ? body.amountPaid : body.amountCollected);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid amount greater than zero.");
  const currentAmount = Number(row[isSale ? 26 : 10] ?? 0) || 0;
  if (onRemittance && Math.round(amount * 100) !== Math.round(currentAmount * 100)) throw new Error(`This ${isSale ? "New Sale" : "Collection"} is on a Remittance, so its amount is corrected through reconciliation. OR number and OR date can still be fixed.`);

  const changesOr = !isSale || "orNumber" in body || "orDate" in body;
  const orNumber = changesOr ? text(body.orNumber) : text(row[isSale ? 29 : 8]);
  const orDate = changesOr ? text(body.orDate) : text(row[isSale ? 30 : 9]);
  if (changesOr) {
    if (!isSale && !orNumber) throw new Error("OR number is required.");
    if ((!isSale || orDate) && (!validDate(orDate) || orDate > today)) throw new Error("Enter a valid OR date, today or earlier.");
    // Each OR number is one receipt; a correction must not reuse another entry's.
    if (!isSale && entryKey(orNumber) !== entryKey(row[8])) {
      const used = (await recordedOrNumbers()).get(entryKey(orNumber));
      if (used && used.collectionId !== id) throw new Error(`OR Number ${orNumber} is already recorded on collection ${used.collectionId}.`);
    }
  }

  if (isSale) {
    const applicationNumber = text(body.applicationNumber), notes = text(body.notes);
    if (!applicationNumber) throw new Error("Application number is required.");
    if (entryKey(applicationNumber) !== entryKey(row[28])) {
      const used = (await recordedApplicationNumbers()).get(entryKey(applicationNumber));
      if (used && used.saleId !== id) throw new Error(`Application number ${applicationNumber} is already recorded on sale ${used.saleId}.`);
    }
    const before = { applicationNumber: row[28], amountPaid: row[26], notes: row[27], orNumber: row[29], orDate: row[30] };
    const after = { applicationNumber, amountPaid: amount, notes, orNumber, orDate };
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "USER_ENTERED", data: [
      { range: `'Sales'!AA${rowNumber}:AC${rowNumber}`, values: [[amount, notes, applicationNumber]] },
      ...(changesOr ? [{ range: `'Sales'!AD${rowNumber}:AE${rowNumber}`, values: [[orNumber, orDate]] }] : []),
    ] } });
    await recordCorrection(moduleName, id, reason, before, after);
  } else {
    const before = { orNumber: row[8], orDate: row[9], amountCollected: row[10] };
    const after = { orNumber, orDate, amountCollected: amount };
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "USER_ENTERED", data: [{ range: `'Collections'!I${rowNumber}:K${rowNumber}`, values: [[orNumber, orDate, amount]] }] } });
    await recordCorrection(moduleName, id, reason, before, after);
  }
  return { message: `${moduleName} record corrected and audited.` };
}
