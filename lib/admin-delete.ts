import { sql, type SQL } from "drizzle-orm";

import type { SessionUser } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/access-control";
import { currentDb, encodedBy, inTransaction, schema, type Queryable } from "@/lib/db";
import { createReadableId } from "@/lib/readable-id";

/**
 * Permanent deletion by an Administrator (October 8, 2026): for test data and records entered by mistake. Everything
 * that belongs to the record goes with it, so nothing is left pointing at a deleted row:
 *   collection  → the collection, its Fidelity rows, receipt-photo links and copy exceptions;
 *   New Sale    → the sale, its beneficiaries, the account it opened (that account's collections and transfers), and the
 *                 member when they have no other account or sale;
 *   member      → the member with every account, New Sale, collection, beneficiary and transfer;
 *   remittance  → the turnover only: its New Sales and collections become Outstanding again, to be turned over anew.
 * A New Sale or collection that is part of a remittance cannot be deleted until that remittance is deleted (its totals
 * would no longer match the cash). Every deleted row is kept in full in the Audit Log (database trigger), and a summary
 * with the reason goes to Record Corrections.
 */
export const DELETE_KINDS = ["collection", "sale", "member", "remittance"] as const;
export type DeleteKind = (typeof DELETE_KINDS)[number];
export const isDeleteKind = (value: unknown): value is DeleteKind => DELETE_KINDS.includes(value as DeleteKind);
export const canDeleteRecords = (user: Pick<SessionUser, "roleNames">) => user.roleNames.some(isAdministratorRole);

const text = (value: unknown) => String(value ?? "").trim();
/** Rows of a raw query: postgres.js returns them as the result itself, PGlite (tests) under .rows. */
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];
const query = async <T,>(db: Queryable, statement: SQL) => rowsOf<T>(await db.execute(statement));
const list = (ids: Iterable<string>) => { const values = [...ids]; return values.length ? sql.join(values.map((id) => sql`${id}`), sql`, `) : sql`null`; };

export type DeletionPlan = {
  kind: DeleteKind; id: string; title: string;
  /** What goes, in plain words, e.g. ["1 member", "2 accounts", "14 collections"]. */
  effects: string[];
  /** Why it cannot be deleted yet; empty when it can. */
  blockers: string[];
  ids: { members: string[]; enrollments: string[]; sales: string[]; collections: string[]; remittances: string[] };
};
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Works out everything a deletion takes, without changing anything. */
export async function planDeletion(kind: DeleteKind, idRaw: string, db: Queryable = currentDb()): Promise<DeletionPlan> {
  const id = text(idRaw);
  if (!id) throw new Error("Choose the record to delete.");
  const members = new Set<string>(), enrollments = new Set<string>(), sales = new Set<string>(), collections = new Set<string>(), remittances = new Set<string>();
  let title = "";

  if (kind === "collection") {
    const [row] = await query<{ or_number: string; member_number: string }>(db, sql`select or_number, member_number from collections where collection_id = ${id}`);
    if (!row) throw new Error("Collection not found.");
    collections.add(id); title = `Collection ${id} (OR ${text(row.or_number) || "none"}, member ${text(row.member_number)})`;
  } else if (kind === "sale") {
    const [row] = await query<{ member_number: string; program_id: string; application_no: string }>(db, sql`select member_number, program_id, application_no from sales where sale_id = ${id}`);
    if (!row) throw new Error("New Sale not found.");
    sales.add(id); title = `New Sale ${id} (application ${text(row.application_no) || "none"}, member ${text(row.member_number)})`;
    // The account the sale opened: the member's enrollment in the sale's program.
    const accounts = await query<{ enrollment_id: string; member_id: string }>(db, sql`select enrollment_id, member_id from member_programs where member_number = ${row.member_number} and program_id = ${row.program_id}`);
    for (const account of accounts) enrollments.add(account.enrollment_id);
    const [member] = await query<{ member_id: string }>(db, sql`select member_id from members where member_number = ${row.member_number}`);
    if (member) {
      const [others] = await query<{ accounts: number; sales: number }>(db, sql`select
        (select count(*)::int from member_programs where member_id = ${member.member_id} and enrollment_id not in (${list(enrollments)})) as accounts,
        (select count(*)::int from sales where member_number = ${row.member_number} and sale_id <> ${id}) as sales`);
      if (!others.accounts && !others.sales) members.add(member.member_id);
    }
  } else if (kind === "member") {
    const [row] = await query<{ member_number: string }>(db, sql`select member_number from members where member_id = ${id}`);
    if (!row) throw new Error("Member not found.");
    members.add(id); title = `Member ${text(row.member_number)}`;
    for (const account of await query<{ enrollment_id: string }>(db, sql`select enrollment_id from member_programs where member_id = ${id}`)) enrollments.add(account.enrollment_id);
    for (const sale of await query<{ sale_id: string }>(db, sql`select sale_id from sales where member_number = ${row.member_number}`)) sales.add(sale.sale_id);
  } else {
    const [row] = await query<{ status: string; mas: string; date_remitted: string }>(db, sql`select status, mas, date_remitted::text as date_remitted from remittances where remittance_id = ${id}`);
    if (!row) throw new Error("Remittance not found.");
    remittances.add(id); title = `Remittance ${id} (${text(row.mas)}, ${text(row.date_remitted)}, ${text(row.status)})`;
  }
  // The accounts' and members' collections go with them.
  if (enrollments.size || members.size) {
    for (const row of await query<{ collection_id: string }>(db, sql`select collection_id from collections where enrollment_id in (${list(enrollments)}) or member_id in (${list(members)})`)) collections.add(row.collection_id);
  }

  const blockers: string[] = [];
  const effects: string[] = [];
  if (kind === "remittance") {
    const [linked] = await query<{ sales: number; collections: number; fidelity: number }>(db, sql`select
      (select count(*)::int from sales where linked_remittance_id = ${id}) as sales,
      (select count(*)::int from collections where linked_remittance_id = ${id} or collection_id in (select collection_id from remittance_collections where remittance_id = ${id})) as collections,
      (select count(*)::int from fidelity where remittance_id = ${id}) as fidelity`);
    effects.push("1 remittance");
    if (linked.sales || linked.collections) effects.push(`${plural(linked.sales, "New Sale")} and ${plural(linked.collections, "collection")} become Outstanding again (not deleted)`);
    if (linked.fidelity) effects.push(plural(linked.fidelity, "Fidelity row"));
  } else {
    // Entries already turned over: the remittance must go first, or its totals would no longer match the cash.
    const onRemittance = await query<{ remittance_id: string; count: number }>(db, sql`select remittance_id, count(*)::int as count from (
      select linked_remittance_id as remittance_id from sales where sale_id in (${list(sales)}) and linked_remittance_id is not null
      union all select linked_remittance_id from collections where collection_id in (${list(collections)}) and linked_remittance_id is not null
      union all select remittance_id from remittance_collections where collection_id in (${list(collections)})) linked group by remittance_id`);
    for (const row of onRemittance) blockers.push(`${plural(row.count, "entry", "entries")} ${row.count === 1 ? "is" : "are"} part of remittance ${row.remittance_id}. Delete that remittance first (Remittances), then delete this.`);
    const [extra] = await query<{ beneficiaries: number; transfers: number; fidelity: number }>(db, sql`select
      (select count(*)::int from beneficiaries where sale_id in (${list(sales)}) or member_id in (${list(members)})) as beneficiaries,
      (select count(*)::int from member_transfers where enrollment_id in (${list(enrollments)}) or member_id in (${list(members)})) as transfers,
      (select count(*)::int from fidelity where collection_id in (${list(collections)})) as fidelity`);
    if (members.size) effects.push(plural(members.size, "member"));
    if (enrollments.size) effects.push(plural(enrollments.size, "account"));
    if (sales.size) effects.push(plural(sales.size, "New Sale"));
    if (collections.size) effects.push(plural(collections.size, "collection"));
    if (extra.beneficiaries) effects.push(plural(extra.beneficiaries, "beneficiary", "beneficiaries"));
    if (extra.transfers) effects.push(plural(extra.transfers, "transfer record"));
    if (extra.fidelity) effects.push(plural(extra.fidelity, "Fidelity row"));
    if (kind === "sale" && !members.size) effects.push("the member stays (they have another account or sale)");
  }
  return { kind, id, title, effects, blockers, ids: { members: [...members], enrollments: [...enrollments], sales: [...sales], collections: [...collections], remittances: [...remittances] } };
}

/** Deletes the record and everything that belongs to it, in one transaction. Administrators only (checked by the route). */
export async function deleteRecord(kind: DeleteKind, id: string, reasonRaw: string) {
  const reason = text(reasonRaw);
  if (reason.length < 3 || reason.length > 300) throw new Error("Give the reason for deleting (3–300 characters).");
  return inTransaction(async (tx) => {
    const plan = await planDeletion(kind, id, tx);
    if (plan.blockers.length) throw new Error(plan.blockers.join(" "));
    const { members, enrollments, sales, collections, remittances } = plan.ids;
    if (kind === "remittance") {
      const remittance = sql`${plan.id}`;
      await tx.execute(sql`update sales set linked_remittance_id = null, remittance_status = 'Outstanding' where linked_remittance_id = ${remittance}`);
      await tx.execute(sql`update collections set linked_remittance_id = null, remittance_status = 'Outstanding'
        where linked_remittance_id = ${remittance} or collection_id in (select collection_id from remittance_collections where remittance_id = ${remittance})`);
      await tx.execute(sql`delete from remittance_collections where remittance_id = ${remittance}`);
      await tx.execute(sql`delete from fidelity where remittance_id = ${remittance}`);
      await tx.execute(sql`delete from remittances where remittance_id in (${list(remittances)})`);
    } else {
      // Children first, so no row is left pointing at a deleted one.
      await tx.execute(sql`delete from beneficiaries where sale_id in (${list(sales)}) or member_id in (${list(members)})`);
      await tx.execute(sql`delete from member_transfers where enrollment_id in (${list(enrollments)}) or member_id in (${list(members)})`);
      await tx.execute(sql`delete from fidelity where collection_id in (${list(collections)})`);
      await tx.execute(sql`delete from collections where collection_id in (${list(collections)})`);
      await tx.execute(sql`delete from sales where sale_id in (${list(sales)})`);
      await tx.execute(sql`delete from member_programs where enrollment_id in (${list(enrollments)})`);
      await tx.execute(sql`delete from members where member_id in (${list(members)})`);
      const entryIds = [...collections, ...sales];
      if (entryIds.length) {
        await tx.execute(sql`delete from copy_exceptions where record_id in (${list([...entryIds, ...enrollments, ...members])})`);
        // Receipt photos list the entries they show; a photo left with none is removed.
        const photos = await query<{ photo_id: string; entry_ids: string }>(tx, sql`select photo_id, entry_ids from receipt_photos where string_to_array(replace(coalesce(entry_ids, ''), ' ', ''), ',') && array[${list(entryIds)}]::text[]`);
        for (const photo of photos) {
          const remaining = text(photo.entry_ids).split(",").map(text).filter((entry) => entry && !entryIds.includes(entry));
          if (remaining.length) await tx.execute(sql`update receipt_photos set entry_ids = ${remaining.join(",")} where photo_id = ${photo.photo_id}`);
          else await tx.execute(sql`delete from receipt_photos where photo_id = ${photo.photo_id}`);
        }
      }
    }
    await tx.insert(schema.record_corrections).values({
      correction_id: createReadableId("COR"), module: `Delete ${kind}`, record_id: plan.id, reason,
      before_json: { title: plan.title, deleted: plan.effects, ids: plan.ids }, after_json: { deleted: true }, corrected_at: new Date().toISOString(), ...encodedBy(),
    });
    return plan;
  });
}
