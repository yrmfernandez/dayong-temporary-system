import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { currentDb, schema, type Queryable } from "@/lib/db";
import { isoDate } from "@/lib/program-age";

/**
 * Double-entry guards. Each Application Number (New Sales) and each OR Number (Collections) is used once in the whole
 * system, and a person already on record is never registered again as a new member. Each check queries the database
 * for just the numbers or people being saved; unique rules in the database stop two racing saves.
 */

/** Compares receipt and form numbers regardless of case, spaces, or dashes: "or-001 23" matches "OR00123". */
export const entryKey = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const nameKey = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** The same person: same surname, first name, and birthdate. Middle names are often abbreviated, so they are ignored. */
export const personKey = (person: { surname?: unknown; firstName?: unknown; birthdate?: unknown }) => {
  const birthdate = isoDate(person.birthdate);
  return nameKey(person.surname) && nameKey(person.firstName) && birthdate ? `${nameKey(person.surname)}|${nameKey(person.firstName)}|${birthdate}` : "";
};

/**
 * Application Numbers already on a New Sale, for the given numbers only, with the sale and member they belong to. The
 * database's unique rule on sales.application_key is the final guard when two saves race.
 */
export async function recordedApplicationNumbers(numbers: unknown[], db: Queryable = currentDb()) {
  const keys = [...new Set(numbers.map(entryKey).filter(Boolean))];
  const used = new Map<string, { saleId: string; memberNumber: string }>();
  if (!keys.length) return used;
  const rows = await db.select({ key: schema.sales.application_key, saleId: schema.sales.sale_id, memberNumber: schema.sales.member_number })
    .from(schema.sales).where(inArray(schema.sales.application_key, keys)).orderBy(asc(schema.sales.legacy_duplicate));
  for (const row of rows) if (row.key && !used.has(row.key)) used.set(row.key, { saleId: row.saleId, memberNumber: row.memberNumber ?? "" });
  return used;
}

/**
 * OR Numbers already on a posted collection, for the given numbers only. A voided collection frees its receipt, so the
 * payment can be encoded again correctly. The database's unique rule on collections.or_key is the final guard.
 */
export async function recordedOrNumbers(numbers: unknown[], db: Queryable = currentDb()) {
  const keys = [...new Set(numbers.map(entryKey).filter(Boolean))];
  const used = new Map<string, { collectionId: string; memberNumber: string }>();
  if (!keys.length) return used;
  const rows = await db.select({ key: schema.collections.or_key, collectionId: schema.collections.collection_id, memberNumber: schema.collections.member_number })
    .from(schema.collections).where(and(inArray(schema.collections.or_key, keys), eq(schema.collections.status, "Posted"))).orderBy(asc(schema.collections.legacy_duplicate));
  for (const row of rows) if (row.key && !used.has(row.key)) used.set(row.key, { collectionId: row.collectionId, memberNumber: row.memberNumber ?? "" });
  return used;
}

/**
 * Members on record keyed by personKey, for the given people only, to stop a returning member being registered again
 * as new. Names compare trimmed, case-insensitive, with runs of spaces as one.
 */
export async function recordedMembersByPerson(people: Array<{ surname?: unknown; firstName?: unknown; birthdate?: unknown }>, db: Queryable = currentDb()) {
  const members = new Map<string, { memberId: string; memberNumber: string; name: string }>();
  const wanted = [...new Map(people.map((person) => [personKey(person), person] as const).filter(([key]) => key)).values()];
  if (!wanted.length) return members;
  const name = (column: AnyPgColumn) => sql`lower(regexp_replace(trim(${column}), '\\s+', ' ', 'g'))`;
  const rows = await db.select({ memberId: schema.members.member_id, memberNumber: schema.members.member_number, surname: schema.members.surname, firstName: schema.members.first_name, birthdate: schema.members.birthdate })
    .from(schema.members)
    .where(sql`(${name(schema.members.surname)}, ${name(schema.members.first_name)}, ${schema.members.birthdate}) in (${sql.join(wanted.map((person) => sql`(${nameKey(person.surname)}, ${nameKey(person.firstName)}, ${isoDate(person.birthdate)}::date)`), sql`, `)})`)
    .orderBy(asc(schema.members.member_number));
  for (const row of rows) {
    const key = personKey(row);
    if (key && !members.has(key)) members.set(key, { memberId: row.memberId, memberNumber: row.memberNumber, name: `${row.firstName.trim()} ${row.surname.trim()}`.trim() });
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
  const [applications, members] = await Promise.all([recordedApplicationNumbers(sales.map((sale) => sale.applicationNo)), recordedMembersByPerson(sales.filter((sale) => !sale.existingMember))]);
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
