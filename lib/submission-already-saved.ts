import { and, eq, inArray, sql } from "drizzle-orm";

import { currentDb, schema } from "@/lib/db";

/**
 * MAS batches whose entries were already saved another way (owner, November 20, 2026). A batch waiting in Submitted by
 * MAS could not be saved (the receipts or applications exist already), not be rejected once marked remitted, and its
 * clearing could not be removed while it waited, so it stayed on Collections, New Sales and Clearing for good. The
 * clerk's list now names the items already saved, and **Already saved** closes the batch once every item is
 * (closeCollectionSubmissionAsSaved, closeSaleSubmissionAsSaved), freeing its clearing (releaseSubmissionClearing).
 *
 * How an item counts as saved:
 *   collection → a posted collection on the same account whose NOP range overlaps the submitted one (the same months
 *                cannot be paid twice);
 *   New Sale   → a sale with the same application number (ignoring spaces and dashes), or, for a card on an existing
 *                member, a sale of that member in the same program.
 */

const text = (value: unknown) => String(value ?? "").trim();
const key = (value: unknown) => text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");

export type SavedItem = { label: string; entryIds: string[] };
/** Per batch: the items already saved (`saved`) and how many items it has (`total`). */
export type AlreadySaved = { saved: SavedItem[]; total: number };

type CollectionItem = { enrollmentId?: unknown; memberName?: unknown; memberNumber?: unknown; programName?: unknown; nopFrom?: unknown; nopTo?: unknown };

/** For each open collection batch, its members already paid for the same months. */
export async function savedCollections(batches: Array<{ id: string; entries: unknown }>): Promise<Map<string, AlreadySaved>> {
  const items = (entries: unknown) => (Array.isArray(entries) ? entries as CollectionItem[] : []);
  const enrollments = [...new Set(batches.flatMap((batch) => items(batch.entries).map((item) => text(item.enrollmentId))).filter(Boolean))];
  const result = new Map<string, AlreadySaved>();
  if (!enrollments.length) return result;
  const { collections } = schema;
  const rows = await currentDb().select({ id: collections.collection_id, enrollmentId: collections.enrollment_id, from: collections.nop_from, to: collections.nop_to })
    .from(collections).where(and(inArray(collections.enrollment_id, enrollments), eq(collections.status, "Posted")));
  for (const batch of batches) {
    const list = items(batch.entries);
    const saved: SavedItem[] = [];
    for (const item of list) {
      const from = Number(item.nopFrom), to = Number(item.nopTo) || from;
      if (!Number.isFinite(from) || from <= 0) continue;
      const ids = rows.filter((row) => row.enrollmentId === text(item.enrollmentId) && row.from != null && Number(row.from) <= to && Number(row.to ?? row.from) >= from).map((row) => row.id);
      if (ids.length) saved.push({ label: `${text(item.memberName) || text(item.memberNumber)}${item.programName ? ` · ${text(item.programName)}` : ""} (NOP ${from}${to !== from ? `-${to}` : ""})`, entryIds: ids });
    }
    if (saved.length) result.set(batch.id, { saved, total: list.length });
  }
  return result;
}

type SaleItem = { applicationNumber?: unknown; member?: { id?: unknown; name?: { surname?: unknown; firstName?: unknown } }; program?: { programId?: unknown; programCode?: unknown } };

/** For each open New Sales batch, its cards already saved as a New Sale. */
export async function savedSales(batches: Array<{ id: string; sales: unknown }>): Promise<Map<string, AlreadySaved>> {
  const cards = (sales: unknown) => (Array.isArray(sales) ? sales as SaleItem[] : []);
  const all = batches.flatMap((batch) => cards(batch.sales));
  const appKeys = [...new Set(all.map((card) => key(card.applicationNumber)).filter(Boolean))];
  const memberIds = [...new Set(all.filter((card) => text(card.program?.programId)).map((card) => text(card.member?.id)).filter(Boolean))];
  const result = new Map<string, AlreadySaved>();
  if (!appKeys.length && !memberIds.length) return result;
  const { sales, members } = schema;
  const [byApplication, byMember] = await Promise.all([
    appKeys.length ? currentDb().select({ id: sales.sale_id, key: sales.application_key }).from(sales).where(inArray(sales.application_key, appKeys)) : Promise.resolve([]),
    memberIds.length ? currentDb().select({ id: sales.sale_id, memberId: members.member_id, programId: sales.program_id }).from(sales)
      .innerJoin(members, sql`${members.member_number} = ${sales.member_number}`).where(inArray(members.member_id, memberIds)) : Promise.resolve([]),
  ]);
  for (const batch of batches) {
    const list = cards(batch.sales);
    const saved: SavedItem[] = [];
    for (const card of list) {
      const app = key(card.applicationNumber);
      const ids = [...new Set([
        ...(app ? byApplication.filter((row) => row.key === app).map((row) => row.id) : []),
        ...(text(card.member?.id) && text(card.program?.programId) ? byMember.filter((row) => row.memberId === text(card.member?.id) && row.programId === text(card.program?.programId)).map((row) => row.id) : []),
      ])];
      const name = [text(card.member?.name?.surname), text(card.member?.name?.firstName)].filter(Boolean).join(", ");
      if (ids.length) saved.push({ label: `${name || "Sale"}${text(card.applicationNumber) ? ` (App ${text(card.applicationNumber)})` : ""}`, entryIds: ids });
    }
    if (saved.length) result.set(batch.id, { saved, total: list.length });
  }
  return result;
}

/** Why a batch cannot be closed as already saved, or "" when every item is. */
export function notAllSaved(found: AlreadySaved | undefined, total: number, page: "Collections" | "New Sales") {
  const count = found?.saved.length ?? 0;
  if (!count) return `Nothing in this batch is saved yet. Open it with Review and save it${page === "Collections" ? "" : " on New Sales"}.`;
  if (count < total) return `Only ${count} of ${total} ${page === "Collections" ? "members are" : "sales are"} already saved (${found!.saved.map((item) => item.label).join("; ")}). Open the batch with Review, remove those, and save the rest.`;
  return "";
}
