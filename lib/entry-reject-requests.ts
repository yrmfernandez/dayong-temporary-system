import { and, desc, eq, gte, inArray, or } from "drizzle-orm";

import type { SessionUser } from "@/lib/auth";
import { currentDb, schema } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { createReadableId } from "@/lib/readable-id";
import { batchReference } from "@/lib/reject-request-batch";
import { decideCashRemittance } from "@/lib/remittance-workflow";

/**
 * Reject requests (owner, November 20, 2026). On My Entries an Entry Clerk asks, with a reason, for one of their entries
 * waiting for approval to be rejected (a mistake seen after the batch went to approval, which the clerk cannot edit).
 * The approvers of Remittances see the requests on its Reject requests tab:
 *   Accept  → the entry's remittance slip is rejected with the clerk's reason, the same as Reject in Remittances, so the
 *             whole batch is Returned to the clerk, who fixes it (or removes the entry) with Edit batch and resubmits.
 *             Other pending requests on the same slip are accepted with it.
 *   Decline → nothing changes; the clerk sees the approver's note on the entry.
 * Only entries Pending Remittance Approval can be asked for: an Outstanding entry has no slip yet, a Returned one can
 * already be edited, and an approved one is corrected in Edit / Corrections.
 */

const { entry_reject_requests: requests, sales, collections, members } = schema;
const text = (value: unknown) => String(value ?? "").trim();
const PENDING = "Pending Remittance Approval";

export type RejectRequest = {
  id: string; kind: "New Sale" | "Collection"; entryId: string; remittanceId: string; branch: string; memberNumber: string; memberName: string;
  reference: string; amount: number; reason: string; status: "Pending" | "Accepted" | "Declined"; requestedAt: string; requestedBy: string;
  reviewedBy: string; reviewedAt: string; reviewNote: string;
  /** The entry's remittance status now (pending requests only), e.g. Returned when the slip was rejected in Remittances meanwhile. */
  entryStatus?: string;
};

function toRequest(row: typeof requests.$inferSelect): RejectRequest {
  return {
    id: row.request_id, kind: row.entry_kind === "New Sale" ? "New Sale" : "Collection", entryId: row.entry_id, remittanceId: row.remittance_id,
    branch: text(row.branch), memberNumber: text(row.member_number), memberName: text(row.member_name), reference: text(row.reference), amount: Number(row.amount ?? 0),
    reason: row.reason, status: row.status === "Accepted" ? "Accepted" : row.status === "Declined" ? "Declined" : "Pending",
    requestedAt: text(row.requested_at), requestedBy: text(row.requested_by_name), reviewedBy: text(row.reviewed_by_name), reviewedAt: text(row.reviewed_at), reviewNote: text(row.review_note),
  };
}

type Entry = { kind: "New Sale" | "Collection"; id: string; status: string; remittanceId: string; encodedBy: string; branch: string; memberNumber: string; memberName: string; reference: string; amount: number;
  /** The collection batch (CBT-…); New Sales keep no batch ID, so "". */
  batchId: string };


/** One New Sale or collection by its ID, with what the request keeps of it. */
async function readEntry(id: string): Promise<Entry | null> {
  const [sale] = await currentDb().select({ id: sales.sale_id, status: sales.remittance_status, remittanceId: sales.linked_remittance_id, encodedBy: sales.encoded_by_employee_id, branch: sales.branch,
    memberNumber: sales.member_number, surname: sales.surname, firstName: sales.first_name, application: sales.application_no, amount: sales.amount_paid }).from(sales).where(eq(sales.sale_id, id));
  if (sale) return { kind: "New Sale", id: sale.id, status: text(sale.status), remittanceId: text(sale.remittanceId), encodedBy: text(sale.encodedBy), branch: text(sale.branch), memberNumber: text(sale.memberNumber),
    memberName: [text(sale.surname), text(sale.firstName)].filter(Boolean).join(", "), reference: sale.application ? `App ${text(sale.application)}` : "", amount: Number(sale.amount ?? 0), batchId: "" };
  const [collection] = await currentDb().select({ id: collections.collection_id, status: collections.remittance_status, remittanceId: collections.linked_remittance_id, encodedBy: collections.encoded_by_employee_id,
    branch: collections.branch, memberNumber: collections.member_number, surname: members.surname, firstName: members.first_name, orNumber: collections.or_number, amount: collections.amount_collected, batchId: collections.collection_batch_id })
    .from(collections).leftJoin(members, eq(members.member_id, collections.member_id)).where(eq(collections.collection_id, id));
  if (collection) return { kind: "Collection", id: collection.id, status: text(collection.status), remittanceId: text(collection.remittanceId), encodedBy: text(collection.encodedBy), branch: text(collection.branch),
    memberNumber: text(collection.memberNumber), memberName: [text(collection.surname), text(collection.firstName)].filter(Boolean).join(", "), reference: collection.orNumber ? `OR ${text(collection.orNumber)}` : "", amount: Number(collection.amount ?? 0), batchId: text(collection.batchId) };
  return null;
}

/** Why an entry cannot be asked to be rejected (or rejected now), or "" when it can. */
function notRejectable(entry: Entry) {
  if (entry.status === PENDING && entry.remittanceId) return "";
  if (entry.status === "Returned") return "This batch was already returned to you: press Edit batch to fix or remove the entry, then Resubmit batch.";
  if (entry.status === "Remitted") return "This entry was already approved. Ask an Administrator to correct it in Edit / Corrections.";
  return "Only an entry waiting for approval can be asked to be rejected. A batch not yet sent goes to approval once it is ready.";
}

/**
 * The clerk asks for a whole batch to be rejected (owner, November 23, 2026: the button is on the batch, not on each
 * entry; accepting returns the whole batch anyway): { entryIds, reason } with the batch's entries waiting for approval.
 * One request per slip (a batch is normally one slip), kept on its first entry with "Batch CBT-… · N entries" as the
 * reference and the batch total, so accepting it rejects that slip as before. Refused when any entry already has a
 * request waiting.
 */
async function requestBatchReject(user: SessionUser, isAdmin: boolean, entryIds: string[], reason: string) {
  const entries: Entry[] = [];
  for (const entryId of entryIds) {
    const entry = await readEntry(entryId);
    if (!entry) throw new Error(`Entry ${entryId} not found.`);
    if (!isAdmin && entry.encodedBy !== user.employeeId) throw new Error("You can ask only for batches you encoded.");
    const why = notRejectable(entry);
    if (why) throw new Error(`${entry.id}: ${why}`);
    entries.push(entry);
  }
  // A waiting request on any of these entries, or on their slip (a batch request is kept on the batch's first entry).
  const [open] = await currentDb().select({ id: requests.request_id }).from(requests).where(and(eq(requests.status, "Pending"),
    or(inArray(requests.entry_id, entries.map((entry) => entry.id)), inArray(requests.remittance_id, [...new Set(entries.map((entry) => entry.remittanceId))]))));
  if (open) throw new Error(`This batch already has reject request ${open.id}, waiting for the approver.`);
  const bySlip = new Map<string, Entry[]>();
  for (const entry of entries) bySlip.set(entry.remittanceId, [...(bySlip.get(entry.remittanceId) ?? []), entry]);
  const actor = getEncoder();
  const ids: string[] = [];
  for (const [slip, list] of bySlip) {
    const first = list[0], id = createReadableId("REJ");
    await currentDb().insert(requests).values({
      request_id: id, entry_kind: first.kind, entry_id: first.id, remittance_id: slip, branch: first.branch || null, member_number: null, member_name: null,
      reference: batchReference(first.batchId || slip, list.length), amount: Math.round(list.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100, reason, status: "Pending",
      requested_at: actor.encodedAt, requested_by_employee_id: actor.employeeId, requested_by_name: actor.name,
      encoded_by_user_id: actor.userId, encoded_by_employee_id: actor.employeeId, encoded_by_name: actor.name, encoded_at: actor.encodedAt,
    });
    ids.push(id);
  }
  return { id: ids.join(", "), entryId: entries[0].batchId || entries[0].remittanceId, batch: true };
}

/**
 * The clerk asks for an entry to be rejected: { entryId, reason }, or a whole batch: { entryIds, reason }. Only their
 * own entries, unless an administrator.
 */
export async function requestReject(user: SessionUser, isAdmin: boolean, input: { entryId?: unknown; entryIds?: unknown; reason?: unknown }) {
  const entryId = text(input.entryId), reason = text(input.reason);
  const entryIds = Array.isArray(input.entryIds) ? [...new Set(input.entryIds.map(text).filter(Boolean))] : [];
  if (reason.length < 5 || reason.length > 300) throw new Error(`Say why the ${entryIds.length ? "batch" : "entry"} should be rejected (5–300 characters), e.g. wrong member, wrong amount, encoded twice.`);
  if (entryIds.length) return requestBatchReject(user, isAdmin, entryIds, reason);
  if (!entryId) throw new Error("Choose the entry.");
  const entry = await readEntry(entryId);
  if (!entry) throw new Error("Entry not found.");
  if (!isAdmin && entry.encodedBy !== user.employeeId) throw new Error("You can ask only for entries you encoded.");
  const why = notRejectable(entry);
  if (why) throw new Error(why);
  const [open] = await currentDb().select({ id: requests.request_id }).from(requests).where(and(eq(requests.entry_id, entry.id), eq(requests.status, "Pending")));
  if (open) throw new Error(`This entry already has reject request ${open.id}, waiting for the approver.`);
  const actor = getEncoder();
  const id = createReadableId("REJ");
  await currentDb().insert(requests).values({
    request_id: id, entry_kind: entry.kind, entry_id: entry.id, remittance_id: entry.remittanceId, branch: entry.branch || null, member_number: entry.memberNumber || null,
    member_name: entry.memberName || null, reference: entry.reference || null, amount: entry.amount, reason, status: "Pending", requested_at: actor.encodedAt,
    requested_by_employee_id: actor.employeeId, requested_by_name: actor.name,
    encoded_by_user_id: actor.userId, encoded_by_employee_id: actor.employeeId, encoded_by_name: actor.name, encoded_at: actor.encodedAt,
  });
  return { id, entryId: entry.id, batch: false };
}

/** Every pending request and the decided ones of the last 30 days, newest first, for the approvers. */
export async function listRejectRequests(): Promise<RejectRequest[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const rows = await currentDb().select().from(requests).where(or(eq(requests.status, "Pending"), gte(requests.requested_at, since))).orderBy(desc(requests.row_seq)).limit(300);
  const list = rows.map(toRequest);
  const pendingIds = list.filter((item) => item.status === "Pending").map((item) => item.entryId);
  if (pendingIds.length) {
    const [saleRows, collectionRows] = await Promise.all([
      currentDb().select({ id: sales.sale_id, status: sales.remittance_status }).from(sales).where(inArray(sales.sale_id, pendingIds)),
      currentDb().select({ id: collections.collection_id, status: collections.remittance_status }).from(collections).where(inArray(collections.collection_id, pendingIds)),
    ]);
    const status = new Map([...saleRows, ...collectionRows].map((row) => [row.id, text(row.status)]));
    for (const item of list) if (item.status === "Pending") item.entryStatus = status.get(item.entryId) ?? "Removed";
  }
  return list;
}

/** The latest request of each of these entries (for My Entries). */
export async function latestRequestsFor(entryIds: string[]): Promise<Record<string, RejectRequest>> {
  const ids = [...new Set(entryIds.map(text).filter(Boolean))];
  if (!ids.length) return {};
  const rows = await currentDb().select().from(requests).where(inArray(requests.entry_id, ids)).orderBy(requests.row_seq);
  return Object.fromEntries(rows.map((row) => [row.entry_id, toRequest(row)]));
}

/**
 * Accepts a pending request: the entry's slip is rejected with the clerk's reason (decideCashRemittance, the same rules
 * as Reject in Remittances), unless it was already returned. Pending requests on the same slip are accepted with it.
 */
export async function acceptRejectRequest(id: string, allowOwnDecision: boolean) {
  const [row] = await currentDb().select().from(requests).where(eq(requests.request_id, text(id)));
  if (!row) throw new Error("Reject request not found.");
  if (row.status !== "Pending") throw new Error(`This request was already ${row.status.toLowerCase()}.`);
  const entry = await readEntry(row.entry_id);
  if (!entry) throw new Error(`${row.entry_id} no longer exists. Decline the request.`);
  const alreadyReturned = entry.status === "Returned" && entry.remittanceId === row.remittance_id;
  if (!alreadyReturned) {
    if (entry.status === "Remitted") throw new Error(`${entry.id} was already approved on ${entry.remittanceId}. Undo that approval in Remittances first, or decline the request and correct the entry in Edit / Corrections.`);
    if (entry.status !== PENDING || entry.remittanceId !== row.remittance_id) throw new Error(`${entry.id} is no longer waiting for approval on ${row.remittance_id} (now ${entry.status || "not set"}). Decline the request.`);
    await decideCashRemittance(row.remittance_id, "reject", `Reject request ${row.request_id} (${entry.id}, asked by ${text(row.requested_by_name) || "the clerk"}): ${row.reason}`, allowOwnDecision);
  }
  const actor = getEncoder();
  const closed = await currentDb().update(requests).set({ status: "Accepted", reviewed_by_name: actor.name, reviewed_at: actor.encodedAt })
    .where(and(eq(requests.remittance_id, row.remittance_id), eq(requests.status, "Pending"))).returning({ id: requests.request_id });
  return { id: row.request_id, entryId: entry.id, remittanceId: row.remittance_id, alreadyReturned, alsoAccepted: closed.map((item) => item.id).filter((item) => item !== row.request_id) };
}

/** Declines a pending request with a note the clerk sees; nothing else changes. */
export async function declineRejectRequest(id: string, note: string) {
  if (text(note).length < 3) throw new Error("Give the reason for declining it (at least 3 characters).");
  const actor = getEncoder();
  const updated = await currentDb().update(requests).set({ status: "Declined", review_note: text(note).slice(0, 300), reviewed_by_name: actor.name, reviewed_at: actor.encodedAt })
    .where(and(eq(requests.request_id, text(id)), eq(requests.status, "Pending"))).returning({ id: requests.request_id, entryId: requests.entry_id });
  if (!updated.length) throw new Error("This request was already decided.");
  return updated[0];
}
