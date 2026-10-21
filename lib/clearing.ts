import { and, desc, eq, gt, gte, inArray, ne, or, sql } from "drizzle-orm";

import { currentDb, encodedBy, schema } from "@/lib/db";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { CLEARING_COVERS, coveredKinds, DATE_REMITTED_REASON_MIN, type ClearingCovers, type ClearingKind } from "@/lib/clearing-kinds";
import { cashMethodNames, isCashMethod } from "@/lib/entry-batches";
import { createReadableId } from "@/lib/readable-id";
import { manilaNow } from "@/lib/remittance-deadline";

/**
 * Clearing (owner's decision, October 8, 2026). The entry clerk checks a MAS's or employee's physical receipts and bank
 * slips, then lists them here. That moment is when the cash was received:
 *   - New Sales and Collections are saved only for an accountable person cleared for that branch on the batch's Date
 *     Remitted, so encoding cannot bypass the check;
 *   - the clearing time decides the incentive deadline (3:00 PM the day after the OR date), however late the entries
 *     are encoded; without a clearing the encoding time is used (lib/remittance-workflow.ts receivedAtOf);
 *   - a clearing stays Open until that person's entries for the day are sent for approval (Encoded), or it is Removed.
 * A person may be cleared again the same day once their earlier clearing is Encoded (a second handover).
 *
 * Progress (owner, October 9, 2026): each line also shows how far that person's entries have got, worked out from the
 * New Sales and Collections it covers (`withProgress`): Waiting for encoding → Waiting for receipt (in My Entries
 * without a receipt photo) → For approval (sent for remittance approval) → Approved (every entry Remitted), or Returned.
 * A line leaves the page after 11:59 PM of its day only once Approved (or Removed); anything unfinished stays listed.
 *
 * New Sales and Collections apart (owner, October 10, 2026): the clerk ticks what the person is remitting (`covers`:
 * Both, New Sales or Collections). Only the ticked kinds can be encoded for that clearing, and each kind has its own
 * stage, so a returned New Sales batch does not hold back Collections that are right (or the other way round). Cash
 * entries need no receipt photo (lib/entry-batches.ts), so they skip Waiting for receipt.
 *
 * Own clearings only (owner, October 10, 2026): a clerk sees, encodes from and removes only the clearings they made
 * themselves (`clearedBy`, their Employee ID); administrators pass "" and see everyone's. The save check
 * (clearingProblem) still accepts any clearing of that person, branch and day.
 */
const { clearings } = schema;
const text = (value: unknown) => String(value ?? "").trim();
/** "YYYY-MM-DD HH:MM" in Manila for a stored moment. */
const manilaStamp = (value: string | Date | null | undefined) => { if (!value) return ""; const now = manilaNow(new Date(value)); return `${now.date} ${now.time}`; };

export type ClearingStage = "Waiting for encoding" | "Waiting for receipt" | "For approval" | "Returned" | "Approved" | "Removed";
export { CLEARING_COVERS, coveredKinds, type ClearingCovers, type ClearingKind } from "@/lib/clearing-kinds";
type Tally = { total: number; receipt: number; approval: number; returned: number; approved: number };
/** Who approved or returned a kind's entries, and when ("YYYY-MM-DD HH:MM", Manila), one line per person and decision. */
export type ClearingDecision = { status: "Approved" | "Returned"; by: string; at: string };
export type Clearing = {
  id: string; branch: string; employeeId: string; employeeName: string; clearedAt: string; clearedDate: string;
  amount: number | null; notes: string; status: "Open" | "Encoded" | "Removed"; remittanceId: string; closedAt: string; closedReason: string; clearedBy: string;
  /** What the person is remitting: New Sales, Collections or both. */
  covers: ClearingCovers;
  /** Where its entries stand (getClearingPage only): overall (the least advanced kind), and per kind covered. */
  stage?: ClearingStage;
  entries?: Tally;
  kinds?: Array<{ kind: ClearingKind; stage: ClearingStage; entries: Tally; decisions: ClearingDecision[] }>;
  /** getEncodableClearings: the person's operational roles, so Collections can preset Collected by (Collector role → Collector). */
  employeeRoles?: string[];
  /** getEncodableClearings, an Encoded clearing of an earlier day: the kinds still waiting for encoding (only these can be picked). */
  waitingKinds?: ClearingKind[];
};
const toClearing = (row: typeof clearings.$inferSelect): Clearing => ({
  id: row.clearing_id, branch: row.branch, employeeId: row.employee_id, employeeName: text(row.employee_name), clearedAt: manilaStamp(row.cleared_at), clearedDate: text(row.cleared_date),
  amount: row.amount ?? null, notes: text(row.notes), status: (row.status as Clearing["status"]) ?? "Open", remittanceId: text(row.remittance_id), closedAt: manilaStamp(row.closed_at),
  closedReason: text(row.closed_reason), clearedBy: text(row.encoded_by_name),
  covers: (CLEARING_COVERS as string[]).includes(text(row.covers)) ? row.covers as ClearingCovers : "Both",
});

/** Only the clearings this employee made; "" for everyone's (administrators). */
const mine = (clearedBy: string) => (text(clearedBy) ? eq(clearings.encoded_by_employee_id, text(clearedBy)) : undefined);

/** Days back the Clearing page looks for unfinished lines. */
const UNFINISHED_DAYS = 60;
const addDays = (date: string, count: number) => new Date(Date.parse(`${date}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);

/**
 * Adds each clearing's stage from the entries it covers. An entry (New Sale or Collection of that accountable person
 * and branch, of a kind the clearing covers) belongs to the latest such clearing made on or after its Date Remitted
 * and, when the encoding time is known, no later than it was encoded. Each kind's stage is its least advanced entry's:
 * Returned, Waiting for receipt, For approval, then Approved; a covered kind with no entry yet is Waiting for encoding.
 * The line's stage is its least advanced kind's.
 */
export async function withProgress(list: Clearing[]): Promise<Clearing[]> {
  const live = list.filter((item) => item.status !== "Removed");
  if (!live.length) return list.map((item) => ({ ...item, stage: item.status === "Removed" ? "Removed" : "Waiting for encoding" }));
  const ids = [...new Set(live.map((item) => item.employeeId))];
  const latest = live.map((item) => item.clearedDate).sort().at(-1)!;
  const earliest = addDays(live.map((item) => item.clearedDate).sort()[0], -UNFINISHED_DAYS);
  const { collections, sales, receipt_photos: photos } = schema;
  const [collectionRows, saleRows, photoRows, cashNames] = await Promise.all([
    currentDb().select({ id: collections.collection_id, employeeId: collections.accountable_employee_id, branch: collections.branch, dateRemitted: collections.date_remitted, status: collections.remittance_status, encodedAt: collections.encoded_at, method: collections.remittance_method, remittanceId: collections.linked_remittance_id })
      // DTO collections (accountable: the receiving clerk) belong to no clearing, even when that clerk was cleared too.
      .from(collections).where(and(inArray(collections.accountable_employee_id, ids), sql`lower(coalesce(${collections.status}, '')) = 'posted'`, sql`coalesce(${collections.accountable_role}, '') <> 'DTO'`, gte(collections.date_remitted, earliest), sql`${collections.date_remitted} <= ${latest}`)),
    currentDb().select({ id: sales.sale_id, employeeId: sql<string>`coalesce(${sales.accountable_employee_id}, ${sales.mas_employee_id})`, branch: sales.branch, dateRemitted: sales.date_remitted, status: sales.remittance_status, encodedAt: sales.encoded_at, method: sales.payment_method, remittanceId: sales.linked_remittance_id })
      .from(sales).where(and(or(inArray(sales.accountable_employee_id, ids), inArray(sales.mas_employee_id, ids)), gte(sales.date_remitted, earliest), sql`${sales.date_remitted} <= ${latest}`)),
    currentDb().select({ entryIds: photos.entry_ids }).from(photos).where(sql`${photos.uploaded_at} >= ${`${earliest}T00:00:00+08:00`}`),
    cashMethodNames(),
  ]);
  const photographed = new Set(photoRows.flatMap((row) => text(row.entryIds).split(",").map(text)).filter(Boolean));
  const empty = (): Tally => ({ total: 0, receipt: 0, approval: 0, returned: 0, approved: 0 });
  const counts = new Map(live.map((item) => [item.id, { "New Sales": empty(), Collections: empty() } as Record<ClearingKind, Tally>]));
  // The slips of approved and returned entries, per clearing and kind, to show who decided them (owner, October 13, 2026).
  const slips = new Map(live.map((item) => [item.id, { "New Sales": new Set<string>(), Collections: new Set<string>() } as Record<ClearingKind, Set<string>>]));
  const key = (value: string) => text(value).toLowerCase();
  const tagged = [...collectionRows.map((row) => ({ ...row, kind: "Collections" as const })), ...saleRows.map((row) => ({ ...row, kind: "New Sales" as const }))];
  for (const entry of tagged) {
    const dateRemitted = text(entry.dateRemitted), encodedAt = manilaStamp(entry.encodedAt as string | Date | null);
    const owner = live.filter((item) => item.employeeId === entry.employeeId && coveredKinds(item.covers).includes(entry.kind) && key(item.branch) === key(entry.branch ?? "") && item.clearedDate >= dateRemitted && (!encodedAt || item.clearedAt <= encodedAt))
      .sort((a, b) => b.clearedAt.localeCompare(a.clearedAt))[0];
    if (!owner) continue;
    const tally = counts.get(owner.id)![entry.kind];
    const status = text(entry.status);
    tally.total++;
    if ((status === "Remitted" || status === "Returned") && text(entry.remittanceId)) slips.get(owner.id)![entry.kind].add(text(entry.remittanceId));
    if (status === "Remitted") tally.approved++;
    else if (status === "Returned") tally.returned++;
    // Cash needs no receipt photo: it waits only for approval.
    else if (status === "Outstanding" && !photographed.has(entry.id) && !isCashMethod(text(entry.method), cashNames)) tally.receipt++;
    else tally.approval++;
  }
  const slipIds = [...new Set([...slips.values()].flatMap((byKind) => [...byKind["New Sales"], ...byKind.Collections]))];
  const decided = new Map((slipIds.length ? await currentDb().select({ id: schema.remittances.remittance_id, status: schema.remittances.status, by: schema.remittances.decision_by_name, at: schema.remittances.decision_at })
    .from(schema.remittances).where(inArray(schema.remittances.remittance_id, slipIds)) : []).map((row) => [row.id, row]));
  const decisionsOf = (ids: Set<string>): ClearingDecision[] => {
    const list = new Map<string, ClearingDecision>();
    for (const id of ids) {
      const slip = decided.get(id);
      if (!slip || !["Approved", "Rejected"].includes(text(slip.status))) continue;
      const decision = { status: text(slip.status) === "Approved" ? "Approved" as const : "Returned" as const, by: text(slip.by) || "—", at: manilaStamp(slip.at as string | Date | null) };
      const key = `${decision.status}|${decision.by}`;
      // One line per person and decision, with their latest time.
      if (!list.has(key) || list.get(key)!.at < decision.at) list.set(key, decision);
    }
    return [...list.values()].sort((a, b) => a.at.localeCompare(b.at));
  };
  const stageOf = (entries: Tally): ClearingStage => !entries.total ? "Waiting for encoding" : entries.returned ? "Returned" : entries.receipt ? "Waiting for receipt" : entries.approval ? "For approval" : "Approved";
  const order: ClearingStage[] = ["Returned", "Waiting for encoding", "Waiting for receipt", "For approval", "Approved"];
  return list.map((item) => {
    if (item.status === "Removed") return { ...item, stage: "Removed" as const };
    const byKind = counts.get(item.id)!;
    const kinds = coveredKinds(item.covers).map((kind) => ({ kind, stage: stageOf(byKind[kind]), entries: byKind[kind], decisions: decisionsOf(slips.get(item.id)![kind]) }));
    const entries = kinds.reduce((sum, part) => ({ total: sum.total + part.entries.total, receipt: sum.receipt + part.entries.receipt, approval: sum.approval + part.entries.approval, returned: sum.returned + part.entries.returned, approved: sum.approved + part.entries.approved }), empty());
    const stage = kinds.map((part) => part.stage).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
    return { ...item, stage, entries, kinds };
  });
}

/**
 * Day-end review (owner, October 21, 2026). After 11:59 PM a day's clearing lines are done; the first time the clerk
 * opens the system on a later day they are asked, for each of their own earlier lines still listed, to keep it or clear
 * it (clerks often tick New Sales and Collections when only one of them comes). Clearing a line takes it off the
 * Clearing list without touching what was encoded:
 *   - nothing encoded: the clearing is Removed;
 *   - something encoded: it keeps only the kinds that have entries (so it stays the evidence of when that cash was
 *     received) and stops taking new encoding (Open becomes Encoded); the kinds with nothing encoded are dropped.
 * The choice is kept in closed_reason: "Cleared from the list …" hides the line; "Kept on the list <date>" asks again
 * the next day while it is still unfinished.
 */
export const LIST_CLEARED = "Cleared from the list";
const KEPT = "Kept on the list";
const listCleared = (item: Pick<Clearing, "closedReason">) => item.closedReason.startsWith(LIST_CLEARED);

export type DayEndLine = { id: string; branch: string; employeeName: string; clearedDate: string; covers: ClearingCovers; kinds: Array<{ kind: ClearingKind; stage: ClearingStage; encoded: number }> };

/** The clerk's own lines of earlier days still on the Clearing list and not yet answered today. */
export async function getDayEndReview(employeeId: string): Promise<DayEndLine[]> {
  if (!text(employeeId)) return [];
  const today = manilaNow().date;
  const rows = await currentDb().select().from(clearings).where(and(eq(clearings.encoded_by_employee_id, text(employeeId)), ne(clearings.status, "Removed"),
    sql`${clearings.cleared_date} < ${today}`, gte(clearings.cleared_date, addDays(today, -UNFINISHED_DAYS))));
  const listed = (await withProgress(rows.map(toClearing))).filter((item) => item.stage !== "Approved" && !listCleared(item) && item.closedReason !== `${KEPT} ${today}`);
  return listed.sort((a, b) => a.clearedAt.localeCompare(b.clearedAt)).map((item) => ({
    id: item.id, branch: item.branch, employeeName: item.employeeName, clearedDate: item.clearedDate, covers: item.covers,
    kinds: (item.kinds ?? []).map((part) => ({ kind: part.kind, stage: part.stage, encoded: part.entries.total })),
  }));
}

/** Saves the clerk's day-end answers: lines to keep (asked again tomorrow) and lines to clear from the list. */
export async function settleDayEnd(input: { keep?: unknown; clear?: unknown }, by: { employeeId: string; name: string }) {
  const ids = (value: unknown) => [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))];
  const keep = ids(input.keep), clear = ids(input.clear).filter((id) => !keep.includes(id));
  const pending = new Map((await getDayEndReview(by.employeeId)).map((line) => [line.id, line]));
  const unknown = [...keep, ...clear].filter((id) => !pending.has(id));
  if (unknown.length) throw new Error("Some lines are no longer waiting for an answer. Reload and try again.");
  const today = manilaNow().date, now = new Date().toISOString();
  if (keep.length) await currentDb().update(clearings).set({ closed_reason: `${KEPT} ${today}` }).where(and(inArray(clearings.clearing_id, keep), ne(clearings.status, "Removed")));
  let removed = 0, narrowed = 0;
  for (const id of clear) {
    const line = pending.get(id)!;
    const encoded = line.kinds.filter((part) => part.encoded > 0).map((part) => part.kind);
    const note = `${LIST_CLEARED} by ${by.name} on ${today}`;
    if (!encoded.length) {
      await currentDb().update(clearings).set({ status: "Removed", closed_at: now, closed_reason: `${note}: nothing was encoded` }).where(eq(clearings.clearing_id, id));
      removed++;
      continue;
    }
    const covers: ClearingCovers = encoded.length === 2 ? "Both" : encoded[0];
    const dropped = coveredKinds(line.covers).filter((kind) => !encoded.includes(kind));
    const [row] = await currentDb().select({ status: clearings.status, closedAt: clearings.closed_at }).from(clearings).where(eq(clearings.clearing_id, id));
    await currentDb().update(clearings).set({
      covers, status: row?.status === "Open" ? "Encoded" : row?.status ?? "Encoded", closed_at: row?.closedAt ?? now,
      closed_reason: `${note}: kept for the encoded ${encoded.join(" and ")}${dropped.length ? `; ${dropped.join(" and ")} not encoded` : ""}`,
    }).where(eq(clearings.clearing_id, id));
    narrowed++;
  }
  return { kept: keep.length, removed, narrowed };
}

/**
 * The Clearing page: today's clearings, and earlier ones not yet Approved (up to 60 days back), each with its progress;
 * with the branches and their people. An earlier day's line leaves once Approved or Removed, or once the clerk cleared
 * it from the list at day end (getDayEndReview).
 */
export async function getClearingPage(clearedBy = "") {
  const today = manilaNow().date;
  const [rows, branches, employees] = await Promise.all([
    currentDb().select().from(clearings).where(and(mine(clearedBy), or(eq(clearings.cleared_date, today), and(ne(clearings.status, "Removed"), gte(clearings.cleared_date, addDays(today, -UNFINISHED_DAYS)))))).orderBy(desc(clearings.cleared_at)),
    getBranches(), getEmployees(),
  ]);
  const listed = (await withProgress(rows.map(toClearing))).filter((item) => item.clearedDate === today || (item.stage !== "Approved" && !listCleared(item)));
  return {
    today,
    clearings: listed,
    branches: branches.filter((branch) => branch.status === "active").map((branch) => ({ id: branch.id, name: branch.name })),
    employees: employees.filter((employee) => employee.status.toLowerCase() === "active").map((employee) => ({ id: employee.id, name: employee.name, roles: employee.roles, branchIds: employee.branchIds })),
  };
}

/**
 * Clearings New Sales and Collections can encode for: every Open one, today's Encoded ones (a second batch), and an
 * earlier day's Encoded one while a kind it covers is still waiting for encoding (owner, October 13, 2026). Sending one
 * kind for approval marks the whole clearing Encoded, so a person cleared for both who had only their Collections
 * encoded dropped out of New Sales the next day; now they stay listed there until their New Sales are encoded.
 */
export async function getEncodableClearings(clearedBy = "") {
  const today = manilaNow().date;
  const rows = await currentDb().select().from(clearings)
    .where(and(mine(clearedBy), or(eq(clearings.status, "Open"), and(eq(clearings.status, "Encoded"), gte(clearings.cleared_date, addDays(today, -UNFINISHED_DAYS))))))
    .orderBy(desc(clearings.cleared_at));
  const roles = new Map((await getEmployees()).map((employee) => [employee.id, employee.roles]));
  const list = rows.map(toClearing).map((item) => ({ ...item, employeeRoles: roles.get(item.employeeId) ?? [] }));
  const earlier = list.filter((item) => item.status === "Encoded" && item.clearedDate !== today);
  const progress = new Map((await withProgress(earlier)).map((item) => [item.id, item]));
  return list.flatMap((item) => {
    if (item.status === "Open" || item.clearedDate === today) return [item];
    const waitingKinds = (progress.get(item.id)?.kinds ?? []).filter((part) => part.stage === "Waiting for encoding").map((part) => part.kind);
    return waitingKinds.length ? [{ ...item, waitingKinds }] : [];
  });
}

/** Lists a MAS or employee as cleared now, for one branch. */
export async function addClearing(input: { branch: string; employeeId: string; amount?: unknown; notes?: unknown; covers?: unknown }) {
  const branchName = text(input.branch), employeeId = text(input.employeeId), notes = text(input.notes);
  const covers = (text(input.covers) || "Both") as ClearingCovers;
  if (!CLEARING_COVERS.includes(covers)) throw new Error("Choose what is being remitted: New Sales, Collections or both.");
  const amountText = text(input.amount), amount = amountText ? Number(amountText) : null;
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new Error("The amount must be zero or a positive number.");
  if (notes.length > 300) throw new Error("Notes must be 300 characters or fewer.");
  const [branches, employees] = await Promise.all([getBranches(), getEmployees()]);
  const branch = branches.find((item) => item.name === branchName && item.status === "active");
  const employee = employees.find((item) => item.id === employeeId && item.status.toLowerCase() === "active");
  if (!branch) throw new Error("Choose the branch.");
  if (!employee) throw new Error("Choose an active MAS or employee.");
  if (!employee.branchIds.includes(branch.id)) throw new Error(`${employee.name} is not assigned to ${branch.name}. Add the branch in Employees → Edit first.`);
  const now = new Date(), day = manilaNow(now).date;
  // One Open clearing per person, branch, day and kind (owner, October 13, 2026): someone cleared for New Sales only can
  // still be cleared for Collections the same day, and the other way round.
  const open = await currentDb().select({ id: clearings.clearing_id, covers: clearings.covers }).from(clearings)
    .where(and(eq(clearings.employee_id, employee.id), eq(clearings.branch, branch.name), eq(clearings.cleared_date, day), eq(clearings.status, "Open")));
  const overlap = open.flatMap((row) => coveredKinds((CLEARING_COVERS as string[]).includes(text(row.covers)) ? row.covers as ClearingCovers : "Both")).filter((kind) => coveredKinds(covers).includes(kind));
  if (overlap.length) throw new Error(`${employee.name} is already cleared for ${[...new Set(overlap)].join(" and ")} in ${branch.name} today and not yet encoded.`);
  const id = createReadableId("CLR");
  await currentDb().insert(clearings).values({
    clearing_id: id, branch: branch.name, employee_id: employee.id, employee_name: employee.name, cleared_at: now.toISOString(), cleared_date: day,
    amount, notes: notes || null, status: "Open", covers, ...encodedBy(),
  });
  return { id, employeeName: employee.name, branch: branch.name, clearedAt: manilaStamp(now), covers };
}

/** Takes an Open clearing off the list (listed by mistake), with the reason. */
export async function removeClearing(input: { id: string; reason: string }, clearedBy = "") {
  const id = text(input.id), reason = text(input.reason);
  if (reason.length < 3 || reason.length > 300) throw new Error("Give the reason for removing it (3–300 characters).");
  const updated = await currentDb().update(clearings).set({ status: "Removed", closed_at: new Date().toISOString(), closed_reason: reason })
    .where(and(eq(clearings.clearing_id, id), eq(clearings.status, "Open"), mine(clearedBy))).returning({ id: clearings.clearing_id });
  if (!updated.length) throw new Error(clearedBy ? "Only an Open clearing you made can be removed." : "Only an Open clearing can be removed.");
  return { id };
}

/**
 * Corrects a clearing listed by mistake (owner, October 14, 2026): what is being remitted, the branch, the MAS /
 * employee. The branch and person change only while nothing is encoded for the clearing (like removing it); a kind can
 * be unticked only when none of its entries are encoded. Same checks as a new clearing (active branch, active person
 * assigned to it, no second open clearing of a kind the same day). Own clearings only, unless an administrator.
 */
export async function editClearing(input: { id: string; branch: string; employeeId: string; covers: unknown }, clearedBy = "") {
  const [row] = await currentDb().select().from(clearings).where(and(eq(clearings.clearing_id, text(input.id)), mine(clearedBy)));
  if (!row || row.status === "Removed") throw new Error(clearedBy ? "Only a clearing you made can be edited." : "Clearing not found.");
  const covers = (text(input.covers) || "Both") as ClearingCovers;
  if (!CLEARING_COVERS.includes(covers)) throw new Error("Choose what is being remitted: New Sales, Collections or both.");
  const [branches, employees] = await Promise.all([getBranches(), getEmployees()]);
  const branch = branches.find((item) => item.name === text(input.branch) && item.status === "active");
  const employee = employees.find((item) => item.id === text(input.employeeId) && item.status.toLowerCase() === "active");
  if (!branch) throw new Error("Choose the branch.");
  if (!employee) throw new Error("Choose an active MAS or employee.");
  if (!employee.branchIds.includes(branch.id)) throw new Error(`${employee.name} is not assigned to ${branch.name}. Add the branch in Employees → Edit first.`);
  const [progress] = await withProgress([toClearing(row)]);
  const encoded = (kind: ClearingKind) => progress.kinds?.find((part) => part.kind === kind)?.entries.total ?? 0;
  const movesPerson = employee.id !== row.employee_id || branch.name.trim().toLowerCase() !== text(row.branch).toLowerCase();
  if (movesPerson && (row.status !== "Open" || (progress.entries?.total ?? 0) > 0)) throw new Error("The branch and MAS can be changed only before anything is encoded for this clearing.");
  const current = (CLEARING_COVERS as string[]).includes(text(row.covers)) ? row.covers as ClearingCovers : "Both";
  for (const kind of coveredKinds(current).filter((item) => !coveredKinds(covers).includes(item))) {
    if (encoded(kind) > 0) throw new Error(`${kind} are already encoded on this clearing, so keep ${kind} ticked.`);
  }
  // No second open clearing of a kind for the same person, branch and day (as when clearing).
  const others = await currentDb().select({ id: clearings.clearing_id, covers: clearings.covers }).from(clearings)
    .where(and(eq(clearings.employee_id, employee.id), eq(clearings.branch, branch.name), eq(clearings.cleared_date, text(row.cleared_date)), eq(clearings.status, "Open"), ne(clearings.clearing_id, row.clearing_id)));
  const overlap = others.flatMap((item) => coveredKinds((CLEARING_COVERS as string[]).includes(text(item.covers)) ? item.covers as ClearingCovers : "Both")).filter((kind) => coveredKinds(covers).includes(kind));
  if (overlap.length) throw new Error(`${employee.name} is already cleared for ${[...new Set(overlap)].join(" and ")} in ${branch.name} that day.`);
  await currentDb().update(clearings).set({ branch: branch.name, employee_id: employee.id, employee_name: employee.name, covers }).where(eq(clearings.clearing_id, row.clearing_id));
  return { id: row.clearing_id, employeeName: employee.name, branch: branch.name, covers };
}

/** The same branch, ignoring case and outer spaces. */
const sameBranch = (branch: string) => sql`lower(trim(${clearings.branch})) = ${text(branch).toLowerCase()}`;

/**
 * Clearings that cover a batch of these people, branch and Date Remitted: one made that day (Open, or Encoded for an
 * earlier handover the same day), or one still Open from a later day (cleared today for cash remitted yesterday).
 */
const covering = (employeeIds: string[], branch: string, dateRemitted: string, kind?: ClearingKind) => and(
  inArray(clearings.employee_id, employeeIds.map(text)), sameBranch(branch), ne(clearings.status, "Removed"),
  kind ? inArray(clearings.covers, ["Both", kind]) : undefined,
  or(eq(clearings.cleared_date, text(dateRemitted)), and(eq(clearings.status, "Open"), gt(clearings.cleared_date, text(dateRemitted)))),
);

/** Which of these employees (same name, for example) is cleared for the branch and Date Remitted, or "". */
export async function clearedEmployee(employeeIds: string[], branch: string, dateRemitted: string, kind?: ClearingKind) {
  const ids = employeeIds.map(text).filter(Boolean);
  if (!ids.length) return "";
  const [row] = await currentDb().select({ id: clearings.employee_id }).from(clearings).where(covering(ids, branch, dateRemitted, kind)).orderBy(desc(clearings.cleared_at)).limit(1);
  return row?.id ?? "";
}

/**
 * A later day's Encoded clearing of this person and branch whose `kind` is still waiting for encoding (owner, October 13,
 * 2026). Sending one kind for approval marks a clearing for both Encoded, so after SUYMAN, NELSON's Collections (Date
 * Remitted moved to the day before, an entry clerks' meeting) went for approval, his New Sales for that day were refused:
 * an earlier Date Remitted was covered only while the clearing was Open. Same per-kind check as getEncodableClearings.
 */
async function waitingLaterClearing(employeeId: string, branch: string, dateRemitted: string, kind: ClearingKind) {
  const rows = await currentDb().select().from(clearings).where(and(
    eq(clearings.employee_id, text(employeeId)), sameBranch(branch), eq(clearings.status, "Encoded"), inArray(clearings.covers, ["Both", kind]),
    gt(clearings.cleared_date, text(dateRemitted)), sql`${clearings.cleared_date} <= ${addDays(text(dateRemitted), UNFINISHED_DAYS)}`,
  ));
  if (!rows.length) return false;
  return (await withProgress(rows.map(toClearing))).some((item) => item.kinds?.some((part) => part.kind === kind && part.stage === "Waiting for encoding"));
}

/**
 * Why a batch cannot be saved yet, or "" when its accountable person is cleared for the branch on the Date Remitted
 * (see `covering`). The message says when and where they were cleared instead, so a wrong Date Remitted or branch is
 * easy to spot.
 */
export async function clearingProblem(employeeId: string, employeeName: string, branch: string, dateRemitted: string, kind?: ClearingKind) {
  // Tests about other rules treat everyone as cleared (scripts/test-encoder-tracking.cjs); the clearing test turns this off.
  if ((globalThis as { dayongClearingNotRequired?: boolean }).dayongClearingNotRequired) return "";
  if (await clearedEmployee([employeeId], branch, dateRemitted, kind)) return "";
  if (kind && await waitingLaterClearing(employeeId, branch, dateRemitted, kind)) return "";
  const others = await currentDb().select({ branch: clearings.branch, day: clearings.cleared_date, status: clearings.status, covers: clearings.covers }).from(clearings)
    .where(and(eq(clearings.employee_id, text(employeeId)), ne(clearings.status, "Removed"), gte(clearings.cleared_date, manilaNow(new Date(Date.now() - 7 * 86400000)).date)))
    .orderBy(desc(clearings.cleared_at)).limit(3);
  const seen = others.length ? ` They are cleared ${others.map((row) => `for ${row.branch} on ${row.day} (${row.covers === "Both" ? "New Sales and Collections" : `${row.covers} only`}, ${row.status})`).join(", ")}; check the branch, the Date Remitted and what was ticked in Clearing.` : "";
  return `${employeeName || employeeId} is not in Clearing for ${kind ? `${kind} in ` : ""}${branch} on ${dateRemitted}.${seen || " Check their receipts and bank slips, list them in Clearing, then encode."}`;
}

/**
 * Why a batch cannot be saved yet, or "" (owner, October 16, 2026: double entries). While an earlier batch of the same
 * kind for this person, branch and Date Remitted is still waiting (Outstanding or Pending Approval) or Returned, another
 * one is refused: the clerk could otherwise encode the same receipts again from the same clearing. A new clearing of the
 * person made after that batch was encoded is another handover, so it is allowed. Only batches encoded in this system
 * count (imported entries have no encoder); DTO batches (paid at the office) are not limited.
 */
export async function waitingBatchProblem(employeeId: string, employeeName: string, branch: string, dateRemitted: string, kind: ClearingKind) {
  if ((globalThis as { dayongClearingNotRequired?: boolean }).dayongClearingNotRequired) return "";
  const waiting = sql`('Outstanding', 'Pending Remittance Approval', 'Returned')`;
  const query = kind === "Collections"
    ? sql`select count(*)::int as n, coalesce(sum(amount_collected), 0)::float8 as total, max(encoded_at) as last, min(encoded_by_name) as clerk, string_agg(distinct remittance_status, ', ') as statuses
        from collections where accountable_employee_id = ${text(employeeId)} and lower(trim(branch)) = ${text(branch).toLowerCase()} and date_remitted = ${text(dateRemitted)}::date
          and status = 'Posted' and remittance_status in ${waiting} and coalesce(encoded_by_employee_id, '') <> '' and coalesce(collected_by_role, '') <> 'DTO'`
    : sql`select count(*)::int as n, coalesce(sum(amount_paid), 0)::float8 as total, max(encoded_at) as last, min(encoded_by_name) as clerk, string_agg(distinct remittance_status, ', ') as statuses
        from sales where accountable_employee_id = ${text(employeeId)} and lower(trim(branch)) = ${text(branch).toLowerCase()} and date_remitted = ${text(dateRemitted)}::date
          and remittance_status in ${waiting} and coalesce(encoded_by_employee_id, '') <> ''`;
  const rows = await currentDb().execute(query);
  const [row] = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<{ n: number; total: number; last: string | Date | null; clerk: string | null; statuses: string | null }>;
  if (!Number(row?.n) || !row?.last) return "";
  const last = row.last instanceof Date ? row.last.toISOString() : String(row.last);
  const [newer] = await currentDb().select({ id: clearings.clearing_id }).from(clearings).where(and(
    eq(clearings.employee_id, text(employeeId)), sameBranch(branch), ne(clearings.status, "Removed"), inArray(clearings.covers, ["Both", kind]),
    sql`${clearings.cleared_at} > ${last}::timestamptz`,
  )).limit(1);
  if (newer) return "";
  const peso = Number(row.total).toLocaleString("en-PH", { style: "currency", currency: "PHP" });
  const returned = text(row.statuses).includes("Returned");
  return `${employeeName || employeeId} already has a ${kind} batch for ${branch} on ${dateRemitted} that is ${returned ? "returned or " : ""}waiting for approval (${row.n} entr${Number(row.n) === 1 ? "y" : "ies"}, ${peso}, encoded by ${text(row.clerk) || "a clerk"} at ${manilaStamp(last).slice(11)}). Saving again would enter the same receipts twice. ${returned ? "Fix a returned batch in My Entries → Edit batch. " : ""}If this is another handover, clear ${employeeName || "them"} again in Clearing first.`;
}

/**
 * Why a batch cannot be saved yet, or "": a Date Remitted that is not a day the person was cleared (an earlier day an
 * Open clearing covers) needs a reason, since encoding can wait for meetings and the like (owner, October 13, 2026).
 */
export async function dateRemittedReasonProblem(employeeId: string, branch: string, dateRemitted: string, reason: string, kind?: ClearingKind) {
  if ((globalThis as { dayongClearingNotRequired?: boolean }).dayongClearingNotRequired) return "";
  if (text(reason).length >= DATE_REMITTED_REASON_MIN) return "";
  const [sameDay] = await currentDb().select({ id: clearings.clearing_id }).from(clearings).where(and(
    eq(clearings.employee_id, text(employeeId)), sameBranch(branch), ne(clearings.status, "Removed"),
    kind ? inArray(clearings.covers, ["Both", kind]) : undefined, eq(clearings.cleared_date, text(dateRemitted)),
  )).limit(1);
  return sameDay ? "" : `The Date Remitted ${dateRemitted} is not the day they were cleared. Enter the reason the Date Remitted was changed.`;
}

/**
 * When the cash of a batch was received: the latest clearing of that person, branch and day at or before `encodedAt`
 * ("YYYY-MM-DD HH:MM"), else their earliest that day; "" when there is none. A later-day clearing that covered an
 * earlier Date Remitted remains evidence of receipt after it becomes Encoded; that status only limits new encoding.
 */
export async function clearedAt(employeeId: string, branch: string, day: string, encodedAt = "", kind?: ClearingKind) {
  const rows = await currentDb().select({ at: clearings.cleared_at }).from(clearings)
    .where(and(
      eq(clearings.employee_id, text(employeeId)), sameBranch(branch), ne(clearings.status, "Removed"),
      kind ? inArray(clearings.covers, ["Both", kind]) : undefined,
      or(eq(clearings.cleared_date, text(day)), encodedAt ? and(
        gt(clearings.cleared_date, text(day)),
        sql`${clearings.cleared_at} <= ${`${encodedAt.slice(0, 10)}T${encodedAt.slice(11, 16)}:59.999+08:00`}::timestamptz`,
      ) : undefined),
    ))
    .orderBy(clearings.cleared_at);
  const stamps = rows.map((row) => manilaStamp(row.at)).filter(Boolean);
  if (!stamps.length) return "";
  return (encodedAt ? stamps.filter((stamp) => stamp <= encodedAt).at(-1) : undefined) ?? stamps[0];
}

/** Marks a person's Open clearings covering the branch and day as Encoded once their entries are sent for approval. */
export async function closeClearings(employeeId: string, branch: string, day: string, remittanceId: string, kind?: ClearingKind) {
  if (!text(employeeId) || !text(day)) return 0;
  const updated = await currentDb().update(clearings).set({ status: "Encoded", remittance_id: remittanceId, closed_at: new Date().toISOString() })
    .where(and(covering([employeeId], branch, day, kind), eq(clearings.status, "Open")))
    .returning({ id: clearings.clearing_id });
  return updated.length;
}

/** Open clearings, for the sidebar number on Clearing. */
export async function countOpenClearings(clearedBy = "") {
  const [row] = await currentDb().select({ count: sql<number>`count(*)::int` }).from(clearings).where(and(eq(clearings.status, "Open"), mine(clearedBy)));
  return Number(row?.count ?? 0);
}
