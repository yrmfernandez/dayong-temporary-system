import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";

/**
 * Entry Corrections search (owner, October 15, 2026): IT and Administrators find a New Sale or Collection by OR number,
 * application number, member number or name, or record ID, including entries already remitted, so a wrong number an
 * Entry Clerk typed can be fixed (lib/entry-corrections.ts saves the correction with its reason).
 */
export type SearchKind = "all" | "New Sale" | "Collection";
export const isSearchKind = (value: unknown): value is SearchKind => value === "all" || value === "New Sale" || value === "Collection";

export type FoundEntry = {
  kind: "New Sale" | "Collection";
  id: string;
  memberNumber: string;
  memberName: string;
  program: string;
  branch: string;
  /** The MAS or Collector accountable for the cash. */
  person: string;
  orNumber: string;
  orDate: string;
  applicationNumber: string;
  notes: string;
  amount: number;
  remittanceStatus: string;
  remittanceId: string;
  encodedBy: string;
  /** Manila "YYYY-MM-DD HH:MM". */
  encodedAt: string;
  /** On a remittance slip (anything but outstanding or returned): the amount stays as remitted. */
  onRemittance: boolean;
};

export const SEARCH_LIMIT = 100;

const rowsOf = (result: unknown) => (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>;
const text = (value: unknown) => String(value ?? "").trim();

/** Entries matching `query` (at least 2 characters), newest OR date first, at most SEARCH_LIMIT of each kind. */
export async function searchEntries(query: string, kind: SearchKind = "all"): Promise<FoundEntry[]> {
  const needle = query.trim();
  if (needle.length < 2) throw new Error("Type at least 2 characters to search.");
  // Matches anywhere in the field; % and _ typed by the user are taken literally.
  const like = `%${needle.toLowerCase().replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
  // Numbers also match without spaces or punctuation ("12345S" finds "12345 S").
  const key = needle.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const keyLike = key ? `%${key}%` : "";
  const db = getDb();

  const [sales, collections] = await Promise.all([
    kind === "Collection" ? [] : db.execute(sql`
      select s.sale_id as id, coalesce(s.member_number, '') as member_number, trim(coalesce(s.surname, '') || ', ' || coalesce(s.first_name, '')) as member_name,
        coalesce(p.program_name, s.program_id) as program, coalesce(s.branch, '') as branch, coalesce(s.mas, '') as person,
        coalesce(s.or_number, '') as or_number, coalesce(s.or_date::text, '') as or_date, coalesce(s.application_no, '') as application_number,
        coalesce(s.notes, '') as notes, coalesce(s.amount_paid, 0)::float8 as amount, coalesce(s.remittance_status, '') as remittance_status,
        coalesce(s.linked_remittance_id, '') as remittance_id, coalesce(s.encoded_by_name, '') as encoded_by, coalesce(to_char(coalesce(s.encoded_at, s.date_created) at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI'), '') as encoded_at
      from sales s left join programs p on p.program_id = s.program_id
      where lower(coalesce(s.or_number, '')) like ${like} or lower(coalesce(s.application_no, '')) like ${like} or lower(s.sale_id) like ${like}
        or lower(coalesce(s.member_number, '')) like ${like} or lower(coalesce(s.surname, '') || ', ' || coalesce(s.first_name, '')) like ${like}
        or lower(coalesce(s.first_name, '') || ' ' || coalesce(s.surname, '')) like ${like}
        ${keyLike ? sql`or s.application_key like ${keyLike} or upper(regexp_replace(coalesce(s.or_number, ''), '[^A-Za-z0-9]', '', 'g')) like ${keyLike}` : sql``}
      order by s.or_date desc nulls last, s.row_seq desc limit ${SEARCH_LIMIT}`).then(rowsOf),
    kind === "New Sale" ? [] : db.execute(sql`
      select c.collection_id as id, coalesce(c.member_number, m.member_number, '') as member_number, trim(coalesce(m.surname, '') || ', ' || coalesce(m.first_name, '')) as member_name,
        coalesce(p.program_name, c.program_id) as program, coalesce(c.branch, '') as branch, coalesce(nullif(trim(c.accountable_name), ''), c.mas, '') as person,
        coalesce(c.or_number, '') as or_number, coalesce(c.or_date::text, '') as or_date, '' as application_number, '' as notes,
        coalesce(c.amount_collected, 0)::float8 as amount, coalesce(c.remittance_status, '') as remittance_status,
        coalesce(c.linked_remittance_id, '') as remittance_id, coalesce(c.encoded_by_name, '') as encoded_by, coalesce(to_char(coalesce(c.encoded_at, c.created_at) at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI'), '') as encoded_at
      from collections c left join members m on m.member_id = c.member_id left join programs p on p.program_id = c.program_id
      where c.status = 'Posted' and (lower(coalesce(c.or_number, '')) like ${like} or lower(c.collection_id) like ${like}
        or lower(coalesce(c.member_number, m.member_number, '')) like ${like} or lower(coalesce(m.surname, '') || ', ' || coalesce(m.first_name, '')) like ${like}
        or lower(coalesce(m.first_name, '') || ' ' || coalesce(m.surname, '')) like ${like}
        ${keyLike ? sql`or c.or_key like ${keyLike}` : sql``})
      order by c.or_date desc nulls last, c.row_seq desc limit ${SEARCH_LIMIT}`).then(rowsOf),
  ]);

  const entry = (kindOf: FoundEntry["kind"]) => (row: Record<string, unknown>): FoundEntry => {
    const remittanceStatus = text(row.remittance_status);
    return {
      kind: kindOf, id: text(row.id), memberNumber: text(row.member_number), memberName: text(row.member_name).replace(/^,\s*|,\s*$/g, ""),
      program: text(row.program), branch: text(row.branch), person: text(row.person), orNumber: text(row.or_number), orDate: text(row.or_date).slice(0, 10),
      applicationNumber: text(row.application_number), notes: text(row.notes), amount: Number(row.amount) || 0, remittanceStatus,
      remittanceId: text(row.remittance_id), encodedBy: text(row.encoded_by), encodedAt: text(row.encoded_at),
      onRemittance: !["", "Outstanding", "Returned"].includes(remittanceStatus),
    };
  };
  return [...sales.map(entry("New Sale")), ...collections.map(entry("Collection"))]
    .sort((first, second) => second.orDate.localeCompare(first.orDate) || second.encodedAt.localeCompare(first.encodedAt));
}
