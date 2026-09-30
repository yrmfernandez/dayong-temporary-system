import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { isoDate } from "@/lib/program-age";

/**
 * Double-entry guards. Each Application Number (New Sales) and each OR Number (Collections) is used once in the whole
 * system, and a person already on record is never registered again as a new member. Saves run these inside their
 * encoding request, so the reads are fresh rather than cached.
 */

/** Compares receipt and form numbers regardless of case, spaces, or dashes: "or-001 23" matches "OR00123". */
export const entryKey = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const nameKey = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** The same person: same surname, first name, and birthdate. Middle names are often abbreviated, so they are ignored. */
export const personKey = (person: { surname: unknown; firstName: unknown; birthdate: unknown }) => {
  const birthdate = isoDate(person.birthdate);
  return nameKey(person.surname) && nameKey(person.firstName) && birthdate ? `${nameKey(person.surname)}|${nameKey(person.firstName)}|${birthdate}` : "";
};

/** Application Numbers already on a New Sale (Sales AC), with the sale and member they belong to. */
export async function recordedApplicationNumbers() {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Sales!A:AC" });
  const used = new Map<string, { saleId: string; memberNumber: string }>();
  for (const row of (response.data.values ?? []).slice(1)) {
    const key = entryKey(row[28]);
    if (key && !used.has(key)) used.set(key, { saleId: String(row[0] ?? ""), memberNumber: String(row[5] ?? "") });
  }
  return used;
}

/**
 * OR Numbers already on a posted collection (Collections I, status T). A voided collection frees its receipt, so the
 * payment can be encoded again correctly.
 */
export async function recordedOrNumbers() {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Collections!A:T" });
  const used = new Map<string, { collectionId: string; memberNumber: string }>();
  for (const row of (response.data.values ?? []).slice(1)) {
    const key = entryKey(row[8]);
    if (key && String(row[19] ?? "").trim().toLowerCase() === "posted" && !used.has(key)) used.set(key, { collectionId: String(row[0] ?? ""), memberNumber: String(row[4] ?? "") });
  }
  return used;
}

/** Members on record keyed by personKey, to stop a returning member being registered again as new. */
export async function recordedMembersByPerson() {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Members!A:R" });
  const members = new Map<string, { memberId: string; memberNumber: string; name: string }>();
  for (const row of (response.data.values ?? []).slice(1)) {
    const key = personKey({ surname: row[2], firstName: row[3], birthdate: row[6] });
    if (key && !members.has(key)) members.set(key, { memberId: String(row[0] ?? ""), memberNumber: String(row[1] ?? ""), name: `${String(row[3] ?? "").trim()} ${String(row[2] ?? "").trim()}`.trim() });
  }
  return members;
}

type SaleEntry = { existingMember: boolean; memberNumber?: string; surname?: string; firstName?: string; birthdate?: string; applicationNo?: string };

/**
 * The first double entry in a New Sales batch, as a message for the encoder, or "" when there is none: a repeated
 * Application Number (in the batch or already saved), or a person already on record registered again as a new member.
 * Members may enroll in any number of programs: an existing member is selected, and a new member may appear on several
 * sales in one batch (the member is created once; see app/api/sales/route.ts).
 */
export async function newSalesDoubleEntry(sales: SaleEntry[]) {
  const [applications, members] = await Promise.all([recordedApplicationNumbers(), recordedMembersByPerson()]);
  const batchApplications = new Map<string, number>();
  for (const [index, sale] of sales.entries()) {
    const label = `Sale #${index + 1}`;
    const application = entryKey(sale.applicationNo);
    if (application) {
      const earlier = batchApplications.get(application);
      if (earlier) return `${label}: Application Number ${sale.applicationNo} is already used by Sale #${earlier} in this batch.`;
      const saved = applications.get(application);
      if (saved) return `${label}: Application Number ${sale.applicationNo} is already recorded (sale ${saved.saleId}${saved.memberNumber ? ` for member ${saved.memberNumber}` : ""}). This looks like a double entry.`;
      batchApplications.set(application, index + 1);
    }
    if (sale.existingMember) continue;
    const person = personKey({ surname: sale.surname, firstName: sale.firstName, birthdate: sale.birthdate });
    if (!person) continue;
    const onRecord = members.get(person);
    if (onRecord) return `${label}: ${onRecord.name} with this birthdate is already member ${onRecord.memberNumber}. To add another program, type the surname and select the existing member instead of registering them as new.`;
  }
  return "";
}
