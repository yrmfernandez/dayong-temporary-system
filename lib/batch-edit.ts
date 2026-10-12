import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { accountState, COLLECTION_CHANNELS, incentiveRoleFor, monthCount, paymentsByEnrollment, validatePayment, validMonth, type AccountPayment } from "@/lib/account-rules";
import { loadAccountData } from "@/lib/account-data";
import { planDeletion } from "@/lib/admin-delete";
import { clearingProblem } from "@/lib/clearing";
import { blockingDateProblem } from "@/lib/date-checks";
import { currentDb, inTransaction, schema, type Transaction } from "@/lib/db";
import { entryKey, recordedApplicationNumbers, recordedOrNumbers } from "@/lib/duplicate-entries";
import { saleBatchKey } from "@/lib/entry-batches";
import { checkBackdate, INCOMPLETE_APPLICATION_MESSAGE, isIncompleteApplicationNumber } from "@/lib/entry-controls";
import { getBranches, getPrograms } from "@/lib/google-sheets-data";
import { normalizeOrNumber, orNumberProblem } from "@/lib/or-number";
import { fixedNewSaleAmount } from "@/lib/program-amount-lock";
import { recordCorrection } from "@/lib/record-corrections";
import { calculateRemittance, calculateSaleIncentive, tiersForBranch } from "@/lib/remittance";
import { findActivePaymentMethod } from "@/lib/remittance-methods";
import { manilaNow } from "@/lib/remittance-deadline";

/**
 * Editing a Returned batch (owner, October 12, 2026). When the approver returns a batch (rejects its remittance slip),
 * the Entry Clerk who encoded it, or an administrator, can fix the whole batch in My Entries: the batch details (Date
 * Remitted, remittance method, reference, collected by, penalty, Fidelity) and every entry (Collections: OR number, OR
 * date, amount, months to; New Sales: application number and date, amount, notes), or remove an entry that should not
 * be there. Members and programs stay as they are: a wrong member is removed and encoded again. Entries keep their IDs,
 * receipt photos and encoder; the same checks as encoding apply, every change is kept in Record Corrections, and the
 * batch stays Returned until the clerk resubmits it.
 */
export type BatchKind = "New Sale" | "Collection";
const text = (value: unknown) => String(value ?? "").trim();
const cents = (value: number) => Math.round(value * 100);
const round = (value: number) => cents(value) / 100;
const day = (value: unknown) => text(value).slice(0, 10);
const manilaDate = (stamp: unknown) => (text(stamp) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(text(stamp))) : "");

type By = { employeeId: string; isAdmin: boolean };

export type EditableBatch = {
  kind: BatchKind;
  branch: string;
  person: string;
  returnReason: string;
  dateRemitted: string;
  paymentMethod: string;
  paymentReference: string;
  collectedBy: string;
  penalty: number;
  penaltyNote: string;
  fidelity: number;
  entries: Array<{
    id: string; memberNumber: string; memberName: string; program: string;
    orNumber: string; orDate: string; amount: number; backdateReason: string;
    // Collections
    monthFrom: string; monthTo: string; nopFrom: number; nopTo: number; basePay: number; flexible: boolean;
    // New Sales
    applicationNumber: string; notes: string;
  }>;
};

const { sales, collections, members, programs, remittances, member_programs: memberPrograms } = schema;

/** The Returned entries `ids` name, checked to be one whole batch the user may edit. */
async function returnedBatch(ids: string[], by: By, db = currentDb()) {
  const unique = [...new Set(ids.map(text).filter(Boolean))];
  if (!unique.length) throw new Error("Choose the returned batch to edit.");
  const [saleRows, collectionRows] = await Promise.all([
    db.select().from(sales).where(inArray(sales.sale_id, unique)).orderBy(asc(sales.row_seq)),
    db.select().from(collections).where(inArray(collections.collection_id, unique)).orderBy(asc(collections.row_seq)),
  ]);
  if (saleRows.length && collectionRows.length) throw new Error("A batch is either New Sales or Collections.");
  const rows = saleRows.length ? saleRows : collectionRows;
  if (rows.length !== unique.length) throw new Error("Some entries of this batch were not found. Refresh My Entries.");
  if (rows.some((row) => row.remittance_status !== "Returned")) throw new Error("Only a batch the approver returned can be edited.");
  if (!by.isAdmin && rows.some((row) => row.encoded_by_employee_id !== by.employeeId)) throw new Error("You can edit only batches you encoded.");
  if (saleRows.length) {
    const key = (row: (typeof saleRows)[number]) => saleBatchKey({ encodedByEmployeeId: text(row.encoded_by_employee_id), encodedAt: text(row.encoded_at || row.date_created), accountableEmployeeId: text(row.accountable_employee_id), branch: text(row.branch), dateRemitted: day(row.date_remitted) });
    if (new Set(saleRows.map(key)).size !== 1) throw new Error("These New Sales are not one batch.");
    return { kind: "New Sale" as const, sales: saleRows, collections: [] as typeof collectionRows };
  }
  const batchIds = new Set(collectionRows.map((row) => row.collection_batch_id));
  if (batchIds.size !== 1) throw new Error("These collections are not one batch.");
  // The whole returned batch is edited together.
  const rest = await db.select({ id: collections.collection_id }).from(collections)
    .where(and(eq(collections.collection_batch_id, [...batchIds][0]), eq(collections.remittance_status, "Returned"), eq(collections.status, "Posted")));
  if (rest.some((row) => !unique.includes(row.id))) throw new Error("Open the whole returned batch to edit it. Refresh My Entries.");
  return { kind: "Collection" as const, sales: [] as typeof saleRows, collections: collectionRows };
}

async function returnReason(remittanceId: string | null) {
  if (!remittanceId) return "";
  const [row] = await currentDb().select({ reason: remittances.rejection_reason }).from(remittances).where(eq(remittances.remittance_id, remittanceId));
  return text(row?.reason);
}

/** What the editor shows for a Returned batch. */
export async function getReturnedBatch(ids: string[], by: By): Promise<EditableBatch> {
  const batch = await returnedBatch(ids, by);
  const db = currentDb();
  const blank = { monthFrom: "", monthTo: "", nopFrom: 0, nopTo: 0, basePay: 0, flexible: false, applicationNumber: "", notes: "" };
  if (batch.kind === "New Sale") {
    const rows = batch.sales;
    const programRows = await db.select({ id: programs.program_id, name: programs.program_name, code: programs.program_code }).from(programs).where(inArray(programs.program_id, [...new Set(rows.map((row) => row.program_id))]));
    const programName = new Map(programRows.map((row) => [row.id, text(row.code) || text(row.name)]));
    const first = rows[0];
    return {
      kind: "New Sale", branch: text(first.branch), person: text(first.mas), returnReason: await returnReason(first.linked_remittance_id),
      dateRemitted: day(first.date_remitted), paymentMethod: text(first.payment_method) || "Cash", paymentReference: "", collectedBy: "",
      penalty: rows.reduce((sum, row) => sum + Number(row.penalty_amount ?? 0), 0), penaltyNote: rows.map((row) => text(row.penalty_note)).find(Boolean) ?? "",
      fidelity: rows.reduce((sum, row) => sum + Number(row.fidelity_amount ?? 0), 0),
      entries: rows.map((row) => ({
        ...blank, id: row.sale_id, memberNumber: text(row.member_number), memberName: `${text(row.first_name)} ${text(row.surname)}`.trim(), program: programName.get(row.program_id) ?? row.program_id,
        orNumber: "", orDate: day(row.or_date), amount: Number(row.amount_paid ?? 0), backdateReason: text(row.backdate_reason),
        applicationNumber: text(row.application_no), notes: text(row.notes),
      })),
    };
  }
  const rows = batch.collections;
  const accounts = await db.select({ id: memberPrograms.enrollment_id, surname: members.surname, firstName: members.first_name, program: programs.program_code, programName: programs.program_name, basePay: programs.base_pay, flexible: programs.flexible })
    .from(memberPrograms).innerJoin(members, eq(members.member_id, memberPrograms.member_id)).innerJoin(programs, eq(programs.program_id, memberPrograms.program_id))
    .where(inArray(memberPrograms.enrollment_id, [...new Set(rows.map((row) => row.enrollment_id))]));
  const account = new Map(accounts.map((row) => [row.id, row]));
  const first = rows[0];
  return {
    kind: "Collection", branch: text(first.branch), person: text(first.accountable_name) || text(first.mas), returnReason: await returnReason(first.linked_remittance_id),
    dateRemitted: day(first.date_remitted), paymentMethod: text(first.remittance_method) || "Cash", paymentReference: text(first.payment_reference), collectedBy: text(first.collected_by_role) || "MAS",
    penalty: rows.reduce((sum, row) => sum + Number(row.penalty_amount ?? 0), 0), penaltyNote: rows.map((row) => text(row.penalty_note)).find(Boolean) ?? "",
    fidelity: rows.reduce((sum, row) => sum + Number(row.fidelity_amount ?? 0), 0),
    entries: rows.map((row) => {
      const info = account.get(row.enrollment_id);
      return {
        ...blank, id: row.collection_id, memberNumber: text(row.member_number), memberName: info ? `${text(info.firstName)} ${text(info.surname)}`.trim() : "",
        program: text(info?.program) || text(info?.programName), orNumber: text(row.or_number), orDate: day(row.or_date), amount: Number(row.amount_collected), backdateReason: text(row.backdate_reason),
        monthFrom: text(row.month_from).slice(0, 7), monthTo: text(row.month_to).slice(0, 7), nopFrom: row.nop_from ?? 0, nopTo: row.nop_to ?? 0,
        basePay: Number(info?.basePay ?? 0), flexible: Boolean(info?.flexible),
      };
    }),
  };
}

type EntryInput = { id: string; remove?: boolean; orNumber?: string; orDate?: string; amount?: number; monthTo?: string; backdateReason?: string; applicationNumber?: string; notes?: string };
export type BatchEditInput = {
  ids: string[];
  dateRemitted: string; paymentMethod: string; paymentReference?: string; collectedBy?: string;
  penalty?: number; penaltyNote?: string; fidelity?: number;
  entries: EntryInput[];
  note?: string;
};

/** Saves the edited Returned batch. Returns what changed, for the message. */
export async function saveReturnedBatch(input: BatchEditInput, by: By) {
  const batch = await returnedBatch(input.ids, by);
  const today = manilaNow().date;
  const dateRemitted = day(input.dateRemitted);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRemitted)) throw new Error("Enter the Date Remitted.");
  const method = await findActivePaymentMethod(input.paymentMethod);
  const penalty = round(Number(input.penalty) || 0), penaltyNote = text(input.penaltyNote), fidelity = round(Number(input.fidelity) || 0);
  if (!Number.isFinite(penalty) || penalty < 0) throw new Error("The penalty must be zero or a positive amount.");
  if (penalty > 0 && penaltyNote.length < 3) throw new Error("Explain what the penalty is for (at least 3 characters).");
  if (penaltyNote.length > 300) throw new Error("The penalty note must be 300 characters or fewer.");
  if (!Number.isFinite(fidelity) || fidelity < 0) throw new Error("Fidelity must be zero or a positive amount.");
  const changes = new Map(input.entries.map((entry) => [text(entry.id), entry]));
  const rows = batch.kind === "New Sale" ? batch.sales : batch.collections;
  const idOf = (row: (typeof rows)[number]) => ("sale_id" in row ? row.sale_id : row.collection_id);
  const kept = rows.filter((row) => !changes.get(idOf(row))?.remove);
  const removed = rows.filter((row) => changes.get(idOf(row))?.remove);
  if (!kept.length) throw new Error("Keep at least one entry. To drop the whole batch, ask an administrator to delete it.");
  const reason = `Fixed after the approver returned the batch${text(input.note) ? `: ${text(input.note).slice(0, 250)}` : ""}`;
  // Late dates are judged against the day the batch was first encoded, so fixing it later needs no new reason.
  const encodedOn = manilaDate(rows[0].encoded_at) || today;
  const first = rows[0];
  const accountableId = text(first.accountable_employee_id);
  const accountableName = "accountable_name" in first ? text(first.accountable_name) || text(first.mas) : text(first.mas);
  const branchName = text(first.branch);
  if (dateRemitted !== day(first.date_remitted)) {
    const notCleared = await clearingProblem(accountableId, accountableName, branchName, dateRemitted, batch.kind === "New Sale" ? "New Sales" : "Collections");
    if (notCleared) throw new Error(notCleared);
  }
  const branch = (await getBranches()).find((item) => item.name.trim().toLowerCase() === branchName.toLowerCase());
  const corrections: Array<{ module: string; id: string; before: unknown; after: unknown }> = [];

  await inTransaction(async (tx) => {
    // Removed entries leave the rejected slip first, so the usual delete takes them with what belongs to them.
    for (const row of removed) {
      const id = idOf(row);
      const kind = batch.kind === "New Sale" ? "sale" : "collection";
      const plan = await planDeletion(kind, id, tx);
      if (kind === "sale" && plan.ids.collections.length) throw new Error(`${row.member_number}: this account already has collections, so its New Sale cannot be removed here. Ask an administrator.`);
      await removeEntry(tx, kind, id, plan);
      corrections.push({ module: `Delete ${kind}`, id, before: { title: plan.title, deleted: plan.effects }, after: { deleted: true } });
    }
    if (batch.kind === "New Sale") await saveSales(tx, kept as typeof batch.sales, changes, { dateRemitted, method: method.name, penalty, penaltyNote, fidelity, encodedOn, today, branchId: branch?.id ?? "", corrections });
    else await saveCollections(tx, kept as typeof batch.collections, changes, { dateRemitted, method: method.name, reference: text(input.paymentReference), collectedBy: text(input.collectedBy), penalty, penaltyNote, fidelity, encodedOn, today, branchId: branch?.id ?? "", corrections });
  });
  // The saved batch stands even if the correction log cannot be written; the Audit Log has every change as well.
  for (const change of corrections) await recordCorrection(change.module, change.id, reason, change.before, change.after).catch(() => {});
  const edited = corrections.filter((change) => !change.module.startsWith("Delete")).length;
  return `Saved: ${edited} entr${edited === 1 ? "y" : "ies"} changed${removed.length ? `, ${removed.length} removed` : ""}. The batch stays Returned; press Resubmit batch when it is right.`;
}

async function removeEntry(tx: Transaction, kind: "sale" | "collection", id: string, plan: Awaited<ReturnType<typeof planDeletion>>) {
  const { members: memberIds, enrollments, sales: saleIds, collections: collectionIds } = plan.ids;
  const list = (values: string[]) => (values.length ? sql.join(values.map((value) => sql`${value}`), sql`, `) : sql`null`);
  if (kind === "collection") {
    await tx.execute(sql`delete from remittance_collections where collection_id = ${id}`);
    await tx.execute(sql`delete from fidelity where collection_id = ${id}`);
  }
  await tx.execute(sql`delete from beneficiaries where sale_id in (${list(saleIds)}) or member_id in (${list(memberIds)})`);
  await tx.execute(sql`delete from member_transfers where enrollment_id in (${list(enrollments)}) or member_id in (${list(memberIds)})`);
  await tx.execute(sql`delete from collections where collection_id in (${list(collectionIds)})`);
  await tx.execute(sql`delete from sales where sale_id in (${list(saleIds)})`);
  await tx.execute(sql`delete from member_programs where enrollment_id in (${list(enrollments)})`);
  await tx.execute(sql`delete from members where member_id in (${list(memberIds)})`);
  const entryIds = [...collectionIds, ...saleIds];
  await tx.execute(sql`delete from copy_exceptions where record_id in (${list([...entryIds, ...enrollments, ...memberIds])})`);
  // Receipt photos list the entries they show; a photo left with none is removed.
  const photos = await tx.execute(sql`select photo_id, entry_ids from receipt_photos where string_to_array(replace(coalesce(entry_ids, ''), ' ', ''), ',') && array[${list(entryIds)}]::text[]`);
  for (const photo of (Array.isArray(photos) ? photos : (photos as { rows?: unknown[] }).rows ?? []) as Array<{ photo_id: string; entry_ids: string }>) {
    const remaining = text(photo.entry_ids).split(",").map(text).filter((entry) => entry && !entryIds.includes(entry));
    if (remaining.length) await tx.execute(sql`update receipt_photos set entry_ids = ${remaining.join(",")} where photo_id = ${photo.photo_id}`);
    else await tx.execute(sql`delete from receipt_photos where photo_id = ${photo.photo_id}`);
  }
}

type Common = { dateRemitted: string; method: string; penalty: number; penaltyNote: string; fidelity: number; encodedOn: string; today: string; branchId: string; corrections: Array<{ module: string; id: string; before: unknown; after: unknown }> };

async function saveSales(tx: Transaction, rows: Array<typeof sales.$inferSelect>, changes: Map<string, EntryInput>, common: Common) {
  const programList = await getPrograms();
  const used = await recordedApplicationNumbers(rows.map((row) => changes.get(row.sale_id)?.applicationNumber ?? row.application_no), tx);
  const inBatch = new Map<string, string>();
  const ids = rows.map((row) => row.sale_id);
  // Every entry is checked before anything is written.
  const writes: Array<() => Promise<unknown>> = [];
  // Application numbers are unique: clear the batch's changed ones first, so two entries can swap numbers.
  for (const row of rows) {
    const next = changes.get(row.sale_id)?.applicationNumber;
    if (next !== undefined && entryKey(next) !== entryKey(row.application_no)) await tx.update(sales).set({ application_no: `${row.sale_id}-editing` }).where(eq(sales.sale_id, row.sale_id));
  }
  for (const [index, row] of rows.entries()) {
    const change = changes.get(row.sale_id) ?? { id: row.sale_id };
    const label = `${row.member_number || `Sale #${index + 1}`}`;
    const applicationNumber = text(change.applicationNumber ?? row.application_no);
    const orDate = day(change.orDate ?? row.or_date);
    const amount = round(Number(change.amount ?? row.amount_paid));
    const notes = text(change.notes ?? row.notes);
    const backdateReason = text(change.backdateReason ?? row.backdate_reason).slice(0, 300);
    if (!applicationNumber) throw new Error(`${label}: the Application Number is required.`);
    if (isIncompleteApplicationNumber(applicationNumber)) throw new Error(`${label}: ${INCOMPLETE_APPLICATION_MESSAGE}`);
    const key = entryKey(applicationNumber);
    const other = used.get(key);
    if (other && !ids.includes(other.saleId)) throw new Error(`${label}: Application number ${applicationNumber} is already recorded on sale ${other.saleId}.`);
    if (inBatch.has(key)) throw new Error(`${label}: Application number ${applicationNumber} is entered twice in this batch.`);
    inBatch.set(key, row.sale_id);
    // Blank is allowed, as when encoding (older sales have none).
    if (orDate && (!/^\d{4}-\d{2}-\d{2}$/.test(orDate) || orDate > common.today)) throw new Error(`${label}: enter a valid application date, today or earlier.`);
    const dateProblem = blockingDateProblem({ receiptDate: orDate, receiptLabel: "application date", dateRemitted: common.dateRemitted, today: common.today });
    if (dateProblem) throw new Error(`${label}: ${dateProblem}`);
    checkBackdate(orDate, backdateReason, label, common.encodedOn);
    const program = programList.find((item) => item.id === row.program_id);
    if (!program || !Number.isFinite(amount) || amount < 0) throw new Error(`${label}: enter a valid amount paid.`);
    if (program.flexible && cents(amount) < cents(fixedNewSaleAmount(program))) throw new Error(`${label}: ${program.name} needs at least ${fixedNewSaleAmount(program)}.`);
    if (!program.flexible && !program.newSaleAmountEditable && cents(amount) !== cents(fixedNewSaleAmount(program))) throw new Error(`${label}: ${program.name} has a fixed amount of ${fixedNewSaleAmount(program)}.`);
    const quote = calculateSaleIncentive({ ...program, incentiveTiers: tiersForBranch(program.incentiveTiers, common.branchId) }, amount);
    // The New Sale is the account's first month, so its DOI follows the application date while the account has no collections.
    let doi = day(row.doi);
    if (orDate && orDate !== day(row.or_date) && doi === day(row.or_date)) {
      const [account] = await tx.select({ id: memberPrograms.enrollment_id }).from(memberPrograms).where(and(eq(memberPrograms.member_number, text(row.member_number)), eq(memberPrograms.program_id, row.program_id)));
      const [paid] = account ? await tx.select({ n: sql<number>`count(*)::int` }).from(collections).where(eq(collections.enrollment_id, account.id)) : [{ n: 0 }];
      if (account && !Number(paid?.n)) { doi = orDate; writes.push(() => tx.update(memberPrograms).set({ doi: orDate }).where(eq(memberPrograms.enrollment_id, account.id))); }
    }
    const firstRow = index === 0;
    const after = {
      application_no: applicationNumber, or_date: orDate || null, doi: doi || null, amount_paid: amount, notes: notes || null, backdate_reason: backdateReason || null,
      date_remitted: common.dateRemitted, payment_method: common.method, mas_incentive: quote.incentive, remittance_amount: quote.remittance,
      penalty_amount: firstRow && common.penalty > 0 ? common.penalty : null, penalty_note: firstRow && common.penalty > 0 ? common.penaltyNote : null,
      fidelity_amount: firstRow && common.fidelity > 0 ? common.fidelity : null,
    };
    const before = {
      application_no: row.application_no, or_date: day(row.or_date) || null, doi: day(row.doi) || null, amount_paid: Number(row.amount_paid ?? 0), notes: row.notes || null, backdate_reason: row.backdate_reason || null,
      date_remitted: day(row.date_remitted), payment_method: row.payment_method, mas_incentive: Number(row.mas_incentive ?? 0), remittance_amount: Number(row.remittance_amount ?? 0),
      penalty_amount: row.penalty_amount === null ? null : Number(row.penalty_amount), penalty_note: row.penalty_note || null, fidelity_amount: row.fidelity_amount === null ? null : Number(row.fidelity_amount),
    };
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    writes.push(() => tx.update(sales).set(after).where(eq(sales.sale_id, row.sale_id)));
    writes.push(() => tx.update(memberPrograms).set({ amount_paid: amount, remittance_method: common.method }).where(and(eq(memberPrograms.member_number, text(row.member_number)), eq(memberPrograms.program_id, row.program_id))));
    common.corrections.push({ module: "New Sales", id: row.sale_id, before, after });
  }
  for (const write of writes) await write();
}

async function saveCollections(tx: Transaction, rows: Array<typeof collections.$inferSelect>, changes: Map<string, EntryInput>, common: Common & { reference: string; collectedBy: string }) {
  if (!(COLLECTION_CHANNELS as readonly string[]).includes(common.collectedBy)) throw new Error("Select whether the batch was collected by MAS, Collector, or DTO (Direct to Office).");
  if (common.reference.length > 100) throw new Error("The payment reference must be 100 characters or fewer.");
  const ids = rows.map((row) => row.collection_id);
  const data = await loadAccountData({ enrollmentIds: [...new Set(rows.map((row) => row.enrollment_id))] }, tx, { lock: true });
  const orNumbers = rows.map((row) => normalizeOrNumber(text(changes.get(row.collection_id)?.orNumber ?? row.or_number)));
  const recorded = await recordedOrNumbers(orNumbers, tx);
  // The other payments of these accounts; the batch's own are checked again one by one, in NOP order.
  let payments: AccountPayment[] = data.payments.filter((payment) => !ids.includes(payment.id));
  const ordered = [...rows].sort((a, b) => (a.nop_from ?? 0) - (b.nop_from ?? 0));
  const inBatch = new Map<string, string>();
  const updates: Array<{ row: (typeof rows)[number]; after: Record<string, unknown>; before: Record<string, unknown> }> = [];
  for (const row of ordered) {
    const change = changes.get(row.collection_id) ?? { id: row.collection_id };
    const account = data.accounts.find((item) => item.id === row.enrollment_id);
    if (!account) throw new Error(`${row.member_number}: the account was not found.`);
    const label = `Collection for ${row.member_number}`;
    const orNumber = normalizeOrNumber(text(change.orNumber ?? row.or_number));
    const orDate = day(change.orDate ?? row.or_date);
    const amount = round(Number(change.amount ?? row.amount_collected));
    const backdateReason = text(change.backdateReason ?? row.backdate_reason).slice(0, 300);
    const monthFrom = text(row.month_from).slice(0, 7);
    const monthTo = text(change.monthTo ?? row.month_to).slice(0, 7);
    if (!validMonth(monthTo) || monthTo < monthFrom) throw new Error(`${label}: choose the last month paid (${monthFrom} or later).`);
    const count = monthCount(monthFrom, monthTo);
    const nopFrom = row.nop_from ?? 0, nopTo = nopFrom + count - 1;
    if (entryKey(orNumber) !== entryKey(row.or_number)) {
      const problem = orNumberProblem(orNumber);
      if (problem) throw new Error(`${label}: ${problem}`);
    }
    const used = recorded.get(entryKey(orNumber));
    if (used && !ids.includes(used.collectionId)) throw new Error(`OR Number ${orNumber} is already recorded (collection ${used.collectionId}). Each OR Number is used once.`);
    if (inBatch.has(entryKey(orNumber))) throw new Error(`OR Number ${orNumber} is entered twice in this batch.`);
    inBatch.set(entryKey(orNumber), row.collection_id);
    checkBackdate(orDate, backdateReason, label, common.encodedOn);
    const dateProblem = blockingDateProblem({ receiptDate: orDate, dateRemitted: common.dateRemitted, today: common.today });
    if (dateProblem) throw new Error(`${label}: ${dateProblem}`);
    const paymentChanged = cents(amount) !== cents(Number(row.amount_collected)) || monthTo !== text(row.month_to).slice(0, 7) || orDate !== day(row.or_date);
    if (paymentChanged) {
      // A later payment of the account was built on this one, so its months and amount stay as they are.
      // Another entry of this batch for the same account counts too.
      const later = data.payments.find((payment) => payment.enrollmentId === account.id && payment.id !== row.collection_id && payment.nopFrom > nopFrom);
      if (later && (cents(amount) !== cents(Number(row.amount_collected)) || monthTo !== text(row.month_to).slice(0, 7))) throw new Error(`${label}: OR ${later.orNumber} was recorded after it, so its months and amount cannot change here. Ask an administrator.`);
      if (!later) {
        const before = payments.filter((payment) => payment.enrollmentId === account.id && payment.nopFrom < nopFrom);
        validatePayment(account, [...payments.filter((payment) => payment.enrollmentId !== account.id), ...before],
          { monthFrom, monthTo, nopFrom, nopTo, amount, orDate, orNumber, waiver: text(row.suspended), collectedByRole: common.collectedBy, originalMas: text(row.original_mas) }, common.today);
      }
    }
    const quote = calculateRemittance(account.basePay, tiersForBranch(data.incentives.filter((tier) => tier.programId === account.programId), common.branchId), incentiveRoleFor(common.collectedBy), nopFrom, nopTo, amount, account.flexible, account.maxMonthlyPayment);
    payments = [...payments, { id: row.collection_id, enrollmentId: account.id, orDate, orNumber, monthFrom, monthTo, nopFrom, nopTo, amount, dateRemitted: common.dateRemitted, mas: text(row.mas) }];
    const firstRow = row === rows[0];
    const after = {
      or_number: orNumber, or_date: orDate, amount_collected: amount, month_to: monthTo, nop_to: nopTo, backdate_reason: backdateReason || null,
      date_remitted: common.dateRemitted, remittance_method: common.method, payment_reference: common.reference || null, collected_by_role: common.collectedBy,
      original_mas: common.collectedBy === "Collector" ? text(row.mas) : null, remittance_amount: quote.remittance, remittance_breakdown: quote.breakdown,
      penalty_amount: firstRow && common.penalty > 0 ? common.penalty : null, penalty_note: firstRow && common.penalty > 0 ? common.penaltyNote : null,
      fidelity_amount: firstRow && common.fidelity > 0 ? common.fidelity : null,
    };
    const before = {
      or_number: row.or_number, or_date: day(row.or_date), amount_collected: Number(row.amount_collected), month_to: text(row.month_to).slice(0, 7), nop_to: row.nop_to, backdate_reason: row.backdate_reason || null,
      date_remitted: day(row.date_remitted), remittance_method: row.remittance_method, payment_reference: row.payment_reference || null, collected_by_role: row.collected_by_role,
      original_mas: row.original_mas || null, remittance_amount: Number(row.remittance_amount ?? 0), remittance_breakdown: row.remittance_breakdown,
      penalty_amount: row.penalty_amount === null ? null : Number(row.penalty_amount), penalty_note: row.penalty_note || null, fidelity_amount: row.fidelity_amount === null ? null : Number(row.fidelity_amount),
    };
    updates.push({ row, after, before });
  }
  // Each OR number is unique among posted collections: clear the batch's own first, so two entries can swap numbers.
  const changedOr = updates.filter((update) => entryKey(update.after.or_number) !== entryKey(update.row.or_number));
  for (const update of changedOr) await tx.update(collections).set({ or_number: `${update.row.collection_id}-editing` }).where(eq(collections.collection_id, update.row.collection_id));
  for (const { row, after, before } of updates) {
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    await tx.update(collections).set(after).where(eq(collections.collection_id, row.collection_id));
    const { remittance_breakdown: _before, ...beforeShown } = before;
    const { remittance_breakdown: _after, ...afterShown } = after;
    void _before; void _after;
    common.corrections.push({ module: "Collections", id: row.collection_id, before: beforeShown, after: afterShown });
  }
  // Account statuses follow the corrected payments.
  const byEnrollment = paymentsByEnrollment(payments);
  for (const account of data.accounts) {
    const status = accountState(account, byEnrollment.get(account.id) ?? []).status;
    if (status !== account.storedStatus) await tx.update(memberPrograms).set({ account_status: status }).where(eq(memberPrograms.enrollment_id, account.id));
  }
}
