import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { currentDb, schema } from "@/lib/db";
import { DATE_FIELDS, RECORD_KINDS } from "@/lib/record-search-options";

/**
 * Search Records (owner, October 31, 2026): any record by OR number, dates, contact, member, program, branch or MAS,
 * with the filters combined. Collections, New Sales and members are searched together or one kind at a time; each
 * result names the member, so it can be opened in Members, MAM or the Statement of Account.
 *
 * Members (the directory) filters people by member dates; this page finds the records themselves (the receipts and
 * New Sales of a date range, an OR number, a contact number). A MAS only finds their own accounts (lib/member-scope.ts).
 * At least one condition is needed, and each kind returns at most LIMIT rows, newest first.
 */

const { collections, members, member_programs: memberPrograms, programs, sales } = schema;
export const LIMIT = 200;

export type RecordQuery = {
  kind: string; q: string; orNumber: string; dateField: string; dateFrom: string; dateTo: string;
  branch: string; program: string; mas: string; remittanceStatus: string;
};
const text = (value: unknown) => String(value ?? "").trim();
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const like = (value: string) => `%${value.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
const manilaDay = (column: AnyPgColumn) => sql`(${column} at time zone 'Asia/Manila')::date`;
const between = (column: SQL, from: string, to: string) => and(from ? sql`${column} >= ${from}::date` : undefined, to ? sql`${column} <= ${to}::date` : undefined);
/**
 * "Anything" means anything (owner, October 31, 2026): each typed word must appear somewhere in the record, in any of
 * its columns (the whole row as text, so a column added later is searched too) or the member's and program's. Dates are
 * typed as the app shows them ("Oct 27, 2026", "10/27/2026", "Oct 2026") and stored as 2026-10-27, so they are turned
 * into that form; amounts lose their thousands commas (1,500 → 1500); names are typed as shown ("Cruz, Juan D."), so
 * commas and periods are not part of a word. A word of 4 or more digits also matches contact numbers whatever their
 * format ("0917-123 4567", "+63 917…", "09171234567"): only the digits are compared, without a leading 0 or 63.
 */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (value: string | number) => String(value).padStart(2, "0");
export function searchWords(q: string) {
  const month = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  const normalized = q
    .replace(/\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi, (all, name: string, day: string, year: string) => month(name) ? `${year}-${pad(month(name))}-${pad(day)}` : all)
    .replace(/\b([a-z]{3,9})\.?,?\s+(\d{4})\b/gi, (all, name: string, year: string) => month(name) ? `${year}-${pad(month(name))}` : all)
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_all, m: string, d: string, year: string) => `${year}-${pad(m)}-${pad(d)}`)
    .replace(/(\d),(?=\d{3}\b)/g, "$1");
  return normalized.replace(/[,;]+/g, " ").split(/\s+/).map((word) => word.replace(/^\.+|\.+$/g, "")).filter(Boolean).slice(0, 6);
}
export function phoneDigits(word: string) {
  const digits = word.replace(/\D/g, "");
  return digits.length >= 4 && !/^\d{4}-\d{2}(-\d{2})?$/.test(word) && digits.length >= word.replace(/[\s()+.-]/g, "").length ? digits.replace(/^(63|0)/, "") : "";
}
/** `haystack`: every column of the record as one text; `phones`: its contact numbers, compared by digits too. */
const wordMatch = (word: string, haystack: SQL, phones: AnyPgColumn[]) => {
  const digits = phoneDigits(word);
  return or(sql`${haystack} ilike ${like(word)}`, ...(digits ? phones.map((column) => sql`regexp_replace(coalesce(${column}, ''), '\\D', '', 'g') like ${like(digits)}`) : []));
};
const fullName = (surname: unknown, first: unknown, middle?: unknown) => `${text(surname)}, ${text(first)} ${text(middle)}`.trim().replace(/^,\s*$/, "");

export function cleanQuery(input: Partial<Record<keyof RecordQuery, unknown>>): RecordQuery {
  const query = Object.fromEntries((["kind", "q", "orNumber", "dateField", "dateFrom", "dateTo", "branch", "program", "mas", "remittanceStatus"] as const).map((key) => [key, text(input[key]).slice(0, 100)])) as RecordQuery;
  if (!RECORD_KINDS.some(([value]) => value === query.kind)) query.kind = "all";
  if (!DATE_FIELDS.some(([value]) => value === query.dateField)) query.dateField = "";
  if (!validDate(query.dateFrom)) query.dateFrom = "";
  if (!validDate(query.dateTo)) query.dateTo = "";
  return query;
}

/** Runs the search. `onlyMas` limits it to that MAS's accounts (null: everyone's). */
export async function searchRecords(query: RecordQuery, onlyMas: string | null) {
  const dated = query.dateField && (query.dateFrom || query.dateTo) ? query.dateField : "";
  if (!query.q && !query.orNumber && !dated && !query.program && !query.mas && !query.remittanceStatus && !query.branch) throw new Error("Type something to search for, or choose a date range or another filter.");
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) throw new Error("The From date is after the To date.");
  const words = searchWords(query.q);
  const want = (kind: string) => query.kind === "all" || query.kind === kind;
  const masScope = (column: AnyPgColumn) => onlyMas === null ? undefined : sql`lower(trim(${column})) = ${onlyMas.trim().toLowerCase()}`;
  const masFilter = (column: AnyPgColumn) => query.mas ? ilike(column, like(query.mas)) : undefined;
  const branchFilter = (column: AnyPgColumn) => query.branch ? sql`lower(trim(${column})) = ${query.branch.toLowerCase()}` : undefined;
  const db = currentDb();

  // Collections: the posted receipts. Dates: OR date, date remitted, date encoded. No DOI or birthdate.
  const collectionDate = ({ or: sql`${collections.or_date}`, remitted: sql`${collections.date_remitted}`, encoded: manilaDay(collections.created_at) } as Record<string, SQL>)[dated];
  const collectionRows = want("collections") && (!dated || collectionDate) ? await db.select({
    id: collections.collection_id, orNumber: collections.or_number, orDate: collections.or_date, amount: collections.amount_collected, memberId: collections.member_id, memberNumber: collections.member_number,
    surname: members.surname, firstName: members.first_name, middleName: members.middle_name, contact: members.member_contact, programName: programs.program_name,
    nopFrom: collections.nop_from, nopTo: collections.nop_to, monthFrom: collections.month_from, monthTo: collections.month_to, branch: collections.branch, mas: collections.mas,
    collector: collections.accountable_name, role: collections.collected_by_role, dateRemitted: collections.date_remitted, remittanceStatus: collections.remittance_status, status: collections.status, encodedBy: collections.encoded_by_name,
  }).from(collections).leftJoin(members, eq(members.member_id, collections.member_id)).leftJoin(programs, eq(programs.program_id, collections.program_id))
    .where(and(
      ...words.map((word) => wordMatch(word, sql`concat_ws(' ', "collections"::text, "members"::text, ${programs.program_name})`, [members.member_contact, members.claimant_contact])),
      query.orNumber ? ilike(collections.or_number, like(query.orNumber)) : undefined,
      collectionDate ? between(collectionDate, query.dateFrom, query.dateTo) : undefined,
      query.program ? eq(collections.program_id, query.program) : undefined,
      query.remittanceStatus ? eq(collections.remittance_status, query.remittanceStatus) : undefined,
      branchFilter(collections.branch), masFilter(collections.mas), masScope(collections.mas),
    )).orderBy(desc(collections.or_date), desc(collections.created_at)).limit(LIMIT + 1) : [];

  // New Sales. Dates: OR date, date remitted, date encoded, DOI.
  const saleDate = ({ or: sql`${sales.or_date}`, remitted: sql`${sales.date_remitted}`, encoded: manilaDay(sales.date_created), doi: sql`${sales.doi}` } as Record<string, SQL>)[dated];
  const saleRows = want("sales") && (!dated || saleDate) ? await db.select({
    id: sales.sale_id, orNumber: sales.or_number, orDate: sales.or_date, applicationNo: sales.application_no, amount: sales.amount_paid, memberNumber: sales.member_number,
    surname: sales.surname, firstName: sales.first_name, middleName: sales.middle_name, contact: sales.member_contact, programName: programs.program_name, doi: sales.doi,
    branch: sales.branch, mas: sales.mas, dateRemitted: sales.date_remitted, remittanceStatus: sales.remittance_status, dateCreated: sales.date_created, encodedBy: sales.encoded_by_name,
  }).from(sales).leftJoin(programs, eq(programs.program_id, sales.program_id))
    .where(and(
      ...words.map((word) => wordMatch(word, sql`concat_ws(' ', "sales"::text, ${programs.program_name})`, [sales.member_contact, sales.claimant_contact])),
      query.orNumber ? or(ilike(sales.or_number, like(query.orNumber)), ilike(sales.application_no, like(query.orNumber))) : undefined,
      saleDate ? between(saleDate, query.dateFrom, query.dateTo) : undefined,
      query.program ? eq(sales.program_id, query.program) : undefined,
      query.remittanceStatus ? eq(sales.remittance_status, query.remittanceStatus) : undefined,
      branchFilter(sales.branch), masFilter(sales.mas), masScope(sales.mas),
    )).orderBy(desc(sales.date_created)).limit(LIMIT + 1) : [];

  // Members and contacts: name, PH number, contact, claimant contact, address. Date: birthdate. Branch, program and MAS
  // match one of their programs; OR numbers and remittance status do not apply.
  const memberDate = dated === "birthdate" ? sql`${members.birthdate}` : undefined;
  const accountFilter = query.branch || query.program || query.mas || onlyMas !== null;
  const memberRows = want("members") && (!dated || memberDate) && !query.orNumber && !query.remittanceStatus ? await db.select({
    id: members.member_id, number: members.member_number, surname: members.surname, firstName: members.first_name, middleName: members.middle_name, birthdate: members.birthdate,
    contact: members.member_contact, address: members.address, claimant: members.claimant_name, claimantContact: members.claimant_contact, status: members.status,
    programs: sql<string>`(select string_agg(distinct p.program_name, ', ') from member_programs mp join programs p on p.program_id = mp.program_id where mp.member_id = ${members.member_id})`,
  }).from(members)
    .where(and(
      // The member's own columns, or one of their accounts (branch, MAS, status, account ID) with its program's name.
      ...words.map((word) => or(wordMatch(word, sql`"members"::text`, [members.member_contact, members.claimant_contact]),
        sql`exists (select 1 from member_programs mp left join programs p on p.program_id = mp.program_id where mp.member_id = "members"."member_id" and concat_ws(' ', mp::text, p.program_name) ilike ${like(word)})`)),
      memberDate ? between(memberDate, query.dateFrom, query.dateTo) : undefined,
      accountFilter ? sql`exists (select 1 from ${memberPrograms} where ${memberPrograms.member_id} = ${members.member_id}
        ${query.branch ? sql`and lower(trim(${memberPrograms.branch})) = ${query.branch.toLowerCase()}` : sql``}
        ${query.program ? sql`and ${memberPrograms.program_id} = ${query.program}` : sql``}
        ${query.mas ? sql`and ${memberPrograms.mas} ilike ${like(query.mas)}` : sql``}
        ${onlyMas !== null ? sql`and lower(trim(${memberPrograms.mas})) = ${onlyMas.trim().toLowerCase()}` : sql``})` : undefined,
    )).orderBy(members.surname, members.first_name).limit(LIMIT + 1) : [];

  const more = (rows: unknown[]) => rows.length > LIMIT;
  return {
    collections: collectionRows.slice(0, LIMIT).map((row) => ({
      id: row.id, orNumber: text(row.orNumber), orDate: text(row.orDate), amount: Number(row.amount) || 0, memberId: row.memberId, memberNumber: text(row.memberNumber),
      memberName: fullName(row.surname, row.firstName, row.middleName) || text(row.memberNumber), contact: text(row.contact), program: text(row.programName),
      coverage: row.nopFrom ? `NOP ${row.nopFrom}${row.nopTo && row.nopTo !== row.nopFrom ? `-${row.nopTo}` : ""} (${text(row.monthFrom).slice(0, 7)}${text(row.monthTo).slice(0, 7) !== text(row.monthFrom).slice(0, 7) ? ` to ${text(row.monthTo).slice(0, 7)}` : ""})` : "",
      branch: text(row.branch), mas: text(row.mas), collector: text(row.role) === "Collector" ? text(row.collector) : "", dateRemitted: text(row.dateRemitted), remittanceStatus: text(row.remittanceStatus), status: text(row.status), encodedBy: text(row.encodedBy),
    })),
    sales: saleRows.slice(0, LIMIT).map((row) => ({
      id: row.id, orNumber: text(row.orNumber), orDate: text(row.orDate), applicationNo: text(row.applicationNo), amount: Number(row.amount) || 0, memberNumber: text(row.memberNumber),
      memberName: fullName(row.surname, row.firstName, row.middleName) || text(row.memberNumber), contact: text(row.contact), program: text(row.programName), doi: text(row.doi),
      branch: text(row.branch), mas: text(row.mas), dateRemitted: text(row.dateRemitted), remittanceStatus: text(row.remittanceStatus), dateCreated: text(row.dateCreated), encodedBy: text(row.encodedBy),
    })),
    members: memberRows.slice(0, LIMIT).map((row) => ({
      id: row.id, number: row.number, name: fullName(row.surname, row.firstName, row.middleName), birthdate: text(row.birthdate), contact: text(row.contact), address: text(row.address),
      claimant: text(row.claimant), claimantContact: text(row.claimantContact), status: text(row.status), programs: text(row.programs),
    })),
    more: { collections: more(collectionRows), sales: more(saleRows), members: more(memberRows) },
    limit: LIMIT,
  };
}

/** Branches and programs for the filter lists. */
export async function recordSearchOptions() {
  const db = currentDb();
  const [branchRows, programRows] = await Promise.all([
    db.selectDistinct({ name: memberPrograms.branch }).from(memberPrograms).orderBy(memberPrograms.branch),
    db.select({ id: programs.program_id, name: programs.program_name }).from(programs).orderBy(programs.program_name),
  ]);
  return { branches: branchRows.map((row) => text(row.name)).filter(Boolean), programs: programRows.map((row) => ({ id: row.id, name: text(row.name) })) };
}
