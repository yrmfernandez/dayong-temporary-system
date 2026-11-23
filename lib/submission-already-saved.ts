import { and, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";

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

/** An item of the batch already saved: its label, the saved entries, and its place in the batch (`index`). */
export type SavedItem = { label: string; entryIds: string[]; index?: number };
/**
 * A collection that may be a batch member's payment encoded on another account, or with other NOPs (owner, November 23,
 * 2026: CSUB-20261115121536-XADI's payment was encoded on the other member of a pair who always pay together).
 */
export type PossibleCollection = { id: string; enrollmentId: string; memberNumber: string; orNumber: string; orDate: string; nop: string; amount: number; sameMember: boolean };
/** A batch member not found on their own account, with the collections that may be their payment. */
export type PossibleItem = { label: string; index: number; amount: number; orDate: string; candidates: PossibleCollection[] };
/** Per batch: the items already saved (`saved`), how many items it has (`total`), and (collections) the rest's possible matches. */
export type AlreadySaved = { saved: SavedItem[]; total: number; possible?: PossibleItem[] };

type CollectionItem = { enrollmentId?: unknown; memberId?: unknown; memberName?: unknown; memberNumber?: unknown; programName?: unknown; nopFrom?: unknown; nopTo?: unknown; amount?: unknown; orDate?: unknown };
const collectionItems = (entries: unknown) => (Array.isArray(entries) ? entries as CollectionItem[] : []);
const collectionLabel = (item: CollectionItem) => {
  const from = Number(item.nopFrom), to = Number(item.nopTo) || from;
  return `${text(item.memberName) || text(item.memberNumber)}${item.programName ? ` · ${text(item.programName)}` : ""} (NOP ${from}${to !== from ? `-${to}` : ""})`;
};
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * For each open collection batch, its members already paid for the same months, and for the others the collections that
 * may be their payment saved another way: by the batch's MAS (as MAS or accountable), the same amount, an OR dated from 3
 * days before to 10 days after the submitted OR date, and not claimed by another MAS batch. The clerk confirms one with
 * Already encoded: close batch (closeCollectionSubmissionAsSaved).
 */
export async function savedCollections(batches: Array<{ id: string; entries: unknown; masEmployeeId?: string }>): Promise<Map<string, AlreadySaved>> {
  const enrollments = [...new Set(batches.flatMap((batch) => collectionItems(batch.entries).map((item) => text(item.enrollmentId))).filter(Boolean))];
  const result = new Map<string, AlreadySaved>();
  if (!enrollments.length) return result;
  const { collections, collection_submissions: submissions } = schema;
  const rows = await currentDb().select({ id: collections.collection_id, enrollmentId: collections.enrollment_id, from: collections.nop_from, to: collections.nop_to })
    .from(collections).where(and(inArray(collections.enrollment_id, enrollments), eq(collections.status, "Posted")));
  const unmatched: Array<{ batch: (typeof batches)[number]; item: CollectionItem; index: number }> = [];
  for (const batch of batches) {
    const list = collectionItems(batch.entries);
    const saved: SavedItem[] = [];
    list.forEach((item, index) => {
      const from = Number(item.nopFrom), to = Number(item.nopTo) || from;
      const ids = Number.isFinite(from) && from > 0
        ? rows.filter((row) => row.enrollmentId === text(item.enrollmentId) && row.from != null && Number(row.from) <= to && Number(row.to ?? row.from) >= from).map((row) => row.id) : [];
      if (ids.length) saved.push({ label: collectionLabel(item), entryIds: ids, index });
      else unmatched.push({ batch, item, index });
    });
    result.set(batch.id, { saved, total: list.length, possible: [] });
  }
  // The rest: what the same MAS has saved for the same amount around the OR date, on any account.
  const people = [...new Set(unmatched.map(({ batch }) => text(batch.masEmployeeId)).filter(Boolean))];
  const days = unmatched.map(({ item }) => text(item.orDate).slice(0, 10)).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort();
  const amounts = [...new Set(unmatched.map(({ item }) => Number(item.amount)).filter((amount) => amount > 0))];
  if (people.length && days.length && amounts.length) {
    const [candidates, claimedRows] = await Promise.all([
      currentDb().select({ id: collections.collection_id, enrollmentId: collections.enrollment_id, memberId: collections.member_id, memberNumber: collections.member_number,
        orNumber: collections.or_number, orDate: collections.or_date, from: collections.nop_from, to: collections.nop_to, amount: collections.amount_collected,
        mas: collections.mas_employee_id, accountable: collections.accountable_employee_id })
        .from(collections).where(and(eq(collections.status, "Posted"), or(inArray(collections.mas_employee_id, people), inArray(collections.accountable_employee_id, people)),
          inArray(collections.amount_collected, amounts), gte(collections.or_date, shiftDay(days[0], -3)), lte(collections.or_date, shiftDay(days.at(-1)!, 10)))),
      currentDb().select({ ids: submissions.collection_ids }).from(submissions).where(and(eq(submissions.status, "Saved"), isNotNull(submissions.collection_ids))),
    ]);
    const claimed = new Set(claimedRows.flatMap((row) => text(row.ids).split(",").map(text)).filter(Boolean));
    for (const { batch, item, index } of unmatched) {
      const day = text(item.orDate).slice(0, 10), amount = Number(item.amount), person = text(batch.masEmployeeId);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !(amount > 0)) continue;
      const list = candidates.filter((row) => !claimed.has(row.id) && Number(row.amount) === amount && (row.mas === person || row.accountable === person)
        && text(row.orDate).slice(0, 10) >= shiftDay(day, -3) && text(row.orDate).slice(0, 10) <= shiftDay(day, 10))
        .map((row) => ({ id: row.id, enrollmentId: text(row.enrollmentId), memberNumber: text(row.memberNumber), orNumber: text(row.orNumber), orDate: text(row.orDate).slice(0, 10),
          nop: row.to && Number(row.to) !== Number(row.from) ? `${row.from}-${row.to}` : text(row.from), amount: Number(row.amount), sameMember: text(row.memberId) === text(item.memberId) }));
      result.get(batch.id)!.possible!.push({ label: collectionLabel(item), index, amount, orDate: day, candidates: list });
    }
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
