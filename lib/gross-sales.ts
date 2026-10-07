import { asc, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

/**
 * The entries behind the dashboards' Gross Sales figure, by the same rule as lib/executive-analytics.ts:
 *   New Sales: amount paid + penalty, counted on the Manila date the sale was created;
 *   Collections: amount collected of posted collections, counted on their OR date.
 * Read straight from the database for the chosen dates only.
 */
export type GrossSalesEntry = {
  kind: "New Sale" | "Collection"; id: string; date: string; branch: string; person: string; memberNumber: string; memberName: string;
  program: string; reference: string; amount: number; penalty: number;
};

const round = (value: number) => Math.round(value * 100) / 100;
const text = (value: unknown) => String(value ?? "").trim();

export async function getGrossSalesEntries(from: string, to: string) {
  const db = getDb();
  const s = schema.sales, c = schema.collections, p = schema.programs, m = schema.members;
  const saleDate = sql<string>`((${s.date_created})::timestamptz at time zone 'Asia/Manila')::date::text`;
  const [sales, collections] = await Promise.all([
    db.select({ id: s.sale_id, date: saleDate, branch: s.branch, person: s.mas, memberNumber: s.member_number, surname: s.surname, firstName: s.first_name,
      program: sql<string>`coalesce(nullif(${p.program_name}, ''), ${p.program_code}, ${s.program_id})`, reference: s.application_no, amountPaid: s.amount_paid, penalty: s.penalty_amount })
      .from(s).leftJoin(p, sql`${p.program_id} = ${s.program_id}`)
      .where(sql`${s.date_created} is not null and ${saleDate} between ${from} and ${to}`).orderBy(asc(saleDate), asc(s.row_seq)),
    db.select({ id: c.collection_id, date: sql<string>`${c.or_date}::text`, branch: c.branch, person: sql<string>`coalesce(nullif(${c.accountable_name}, ''), ${c.mas})`,
      memberNumber: c.member_number, surname: m.surname, firstName: m.first_name,
      program: sql<string>`coalesce(nullif(${p.program_name}, ''), ${p.program_code}, ${c.program_id})`, reference: c.or_number, amount: c.amount_collected })
      .from(c).leftJoin(p, sql`${p.program_id} = ${c.program_id}`).leftJoin(m, sql`${m.member_id} = ${c.member_id}`)
      .where(sql`lower(trim(${c.status})) = 'posted' and ${c.or_date} between ${from}::date and ${to}::date`).orderBy(asc(c.or_date), asc(c.row_seq)),
  ]);
  const name = (row: { surname: string | null; firstName: string | null }) => [text(row.firstName), text(row.surname)].filter(Boolean).join(" ");
  const entries: GrossSalesEntry[] = [
    ...sales.map((row) => ({ kind: "New Sale" as const, id: row.id, date: row.date, branch: text(row.branch), person: text(row.person), memberNumber: text(row.memberNumber), memberName: name(row),
      program: text(row.program), reference: text(row.reference), amount: round(Number(row.amountPaid ?? 0) + Number(row.penalty ?? 0)), penalty: round(Number(row.penalty ?? 0)) })),
    ...collections.map((row) => ({ kind: "Collection" as const, id: row.id, date: row.date, branch: text(row.branch), person: text(row.person), memberNumber: text(row.memberNumber), memberName: name(row),
      program: text(row.program), reference: text(row.reference), amount: round(Number(row.amount ?? 0)), penalty: 0 })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

  const total = (rows: GrossSalesEntry[]) => round(rows.reduce((sum, row) => sum + row.amount, 0));
  const newSales = entries.filter((row) => row.kind === "New Sale"), collected = entries.filter((row) => row.kind === "Collection");
  const branches = [...new Set(entries.map((row) => row.branch || "No branch"))].map((branch) => {
    const rows = entries.filter((row) => (row.branch || "No branch") === branch);
    return { branch, newSales: total(rows.filter((row) => row.kind === "New Sale")), collections: total(rows.filter((row) => row.kind === "Collection")), total: total(rows), count: rows.length };
  }).sort((a, b) => b.total - a.total);
  return {
    from, to, entries, branches,
    totals: { gross: total(entries), newSales: total(newSales), newSaleCount: newSales.length, penalties: round(newSales.reduce((sum, row) => sum + row.penalty, 0)), collections: total(collected), collectionCount: collected.length },
  };
}
export type GrossSalesBreakdown = Awaited<ReturnType<typeof getGrossSalesEntries>>;

/** Entries matching a search (every word), a type and a branch ("No branch" for blank). */
export function filterGrossSales(entries: GrossSalesEntry[], { q = "", kind = "", branch = "" }: { q?: string; kind?: string; branch?: string }) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((row) => (!kind || row.kind === kind) && (!branch || (row.branch || "No branch") === branch)
    && words.every((word) => `${row.reference} ${row.memberNumber} ${row.memberName} ${row.program} ${row.person} ${row.branch} ${row.id}`.toLowerCase().includes(word)));
}
