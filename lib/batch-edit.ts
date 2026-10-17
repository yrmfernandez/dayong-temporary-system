import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { accountState, COLLECTION_CHANNELS, incentiveRoleFor, monthCount, paymentsByEnrollment, validatePayment, validMonth, type AccountPayment } from "@/lib/account-rules";
import { loadAccountData } from "@/lib/account-data";
import { planDeletion } from "@/lib/admin-delete";
import { clearingProblem } from "@/lib/clearing";
import { DATE_REMITTED_REASON_MIN } from "@/lib/clearing-kinds";
import { blockingDateProblem } from "@/lib/date-checks";
import { currentDb, inTransaction, schema, type Transaction } from "@/lib/db";
import { entryKey, personKey, recordedApplicationNumbers, recordedMembersByPerson, recordedOrNumbers } from "@/lib/duplicate-entries";
import { getEmployees } from "@/lib/employees";
import { saleBatchKey } from "@/lib/entry-batches";
import { checkBackdate, INCOMPLETE_APPLICATION_MESSAGE, isIncompleteApplicationNumber } from "@/lib/entry-controls";
import { getBranches, getPrograms } from "@/lib/google-sheets-data";
import { addBeneficiaries, memberColumns, type MemberDetails } from "@/lib/member-records";
import { ageOn, ageRestrictionError, isoDate } from "@/lib/program-age";
import { normalizeOrNumber, orNumberProblem } from "@/lib/or-number";
import { fixedNewSaleAmount } from "@/lib/program-amount-lock";
import { recordCorrection } from "@/lib/record-corrections";
import { loadWorkCalendar } from "@/lib/work-calendar";
import type { WorkCalendar } from "@/lib/working-days";
import { calculateRemittance, calculateSaleIncentive, tiersForBranch } from "@/lib/remittance";
import { findActivePaymentMethod } from "@/lib/remittance-methods";
import { manilaNow } from "@/lib/remittance-deadline";

/**
 * Editing a Returned batch (owner, October 12, 2026). When the approver returns a batch (rejects its remittance slip),
 * the Entry Clerk who encoded it, or an administrator, can fix the whole batch in My Entries: the batch details (Date
 * Remitted, remittance method, reference, collected by, penalty, Fidelity) and every entry (Collections: OR number, OR
 * date, amount, months to; New Sales: application number and date, amount, notes), or remove an entry that should not
 * be there. A New Sale's details can all be corrected too (owner, October 17, 2026): the member's name, birthdate,
 * birthplace, gender, civil status, contact and address, the claimant, the program (while the account has no
 * collections) and the beneficiaries; the member's record follows. A Collection keeps its member and program: a wrong
 * one is removed and encoded again. Entries keep their IDs,
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
  /** Why the Date Remitted is not the clearing day, when it was changed (owner, October 13, 2026). */
  dateRemittedReason: string;
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
    /** New Sales: everything else on the sale, editable (owner, October 17, 2026). */
    sale?: SaleDetails & { hasCollections: boolean };
  }>;
  /** New Sales: the active programs the sale may move to, with how their amount works. */
  programs?: Array<{ id: string; name: string; rate: number; amount: number; flexible: boolean; amountEditable: boolean }>;
};

export type SaleBeneficiary = { surname: string; firstName: string; middleName: string; birthdate: string; relationship: string };
export type SaleDetails = {
  surname: string; firstName: string; middleName: string; nameExtension: string; birthdate: string; birthplace: string;
  gender: string; civilStatus: string; contactNumber: string; address: string;
  claimantName: string; claimantContact: string; claimantSameAddress: boolean; claimantAddress: string;
  programId: string; beneficiaries: SaleBeneficiary[];
};

const { sales, collections, members, programs, remittances, member_programs: memberPrograms, beneficiaries } = schema;

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
    const [programList, beneficiaryRows, accounts] = await Promise.all([
      getPrograms(),
      db.select().from(beneficiaries).where(inArray(beneficiaries.sale_id, rows.map((row) => row.sale_id))).orderBy(asc(beneficiaries.row_seq)),
      db.select({ memberNumber: memberPrograms.member_number, programId: memberPrograms.program_id, paid: sql<number>`(select count(*)::int from collections c where c.enrollment_id = ${memberPrograms.enrollment_id})` })
        .from(memberPrograms).where(inArray(memberPrograms.member_number, [...new Set(rows.map((row) => text(row.member_number)))])),
    ]);
    const details = (row: (typeof rows)[number]): SaleDetails & { hasCollections: boolean } => ({
      ...saleDetailsOf(row, beneficiaryRows.filter((item) => item.sale_id === row.sale_id).map(beneficiaryOf)),
      hasCollections: accounts.some((account) => text(account.memberNumber) === text(row.member_number) && account.programId === row.program_id && Number(account.paid) > 0),
    });
    return {
      programs: programList.filter((program) => program.status === "active" || rows.some((row) => row.program_id === program.id))
        .map((program) => ({ id: program.id, name: program.name, rate: Number(program.basePay) || 0, amount: fixedNewSaleAmount(program), flexible: Boolean(program.flexible), amountEditable: Boolean(program.newSaleAmountEditable) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      kind: "New Sale", branch: text(first.branch), person: text(first.mas), returnReason: await returnReason(first.linked_remittance_id),
      dateRemitted: day(first.date_remitted), dateRemittedReason: text(first.date_remitted_reason), paymentMethod: text(first.payment_method) || "Cash", paymentReference: "", collectedBy: "",
      penalty: rows.reduce((sum, row) => sum + Number(row.penalty_amount ?? 0), 0), penaltyNote: rows.map((row) => text(row.penalty_note)).find(Boolean) ?? "",
      fidelity: rows.reduce((sum, row) => sum + Number(row.fidelity_amount ?? 0), 0),
      entries: rows.map((row) => ({
        ...blank, id: row.sale_id, memberNumber: text(row.member_number), memberName: `${text(row.first_name)} ${text(row.surname)}`.trim(), program: programName.get(row.program_id) ?? row.program_id,
        orNumber: "", orDate: day(row.or_date), amount: Number(row.amount_paid ?? 0), backdateReason: text(row.backdate_reason),
        applicationNumber: text(row.application_no), notes: text(row.notes), sale: details(row),
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
    dateRemitted: day(first.date_remitted), dateRemittedReason: text(first.date_remitted_reason), paymentMethod: text(first.remittance_method) || "Cash", paymentReference: text(first.payment_reference), collectedBy: text(first.collected_by_role) || "MAS",
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

type EntryInput = { id: string; remove?: boolean; orNumber?: string; orDate?: string; amount?: number; monthTo?: string; backdateReason?: string; applicationNumber?: string; notes?: string; sale?: Partial<SaleDetails> };
export type BatchEditInput = {
  ids: string[];
  dateRemitted: string; dateRemittedReason?: string; paymentMethod: string; paymentReference?: string; collectedBy?: string;
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
  // A changed Date Remitted needs a clearing that covers it and the reason it was changed (owner, October 13, 2026);
  // otherwise each row keeps the reason it has.
  let dateRemittedReason: string | null = null;
  // A DTO batch (paid at the office, the receiving clerk accountable) has no clearing to check.
  const dtoBatch = "accountable_role" in first && text(first.accountable_role) === "DTO";
  if (dateRemitted !== day(first.date_remitted)) {
    if (dtoBatch && dateRemitted > today) throw new Error("The Date Remitted cannot be in the future.");
    const notCleared = dtoBatch ? "" : await clearingProblem(accountableId, accountableName, branchName, dateRemitted, batch.kind === "New Sale" ? "New Sales" : "Collections");
    if (notCleared) throw new Error(notCleared);
    dateRemittedReason = text(input.dateRemittedReason).slice(0, 300);
    if (dateRemittedReason.length < DATE_REMITTED_REASON_MIN) throw new Error("Enter the reason the Date Remitted was changed.");
  }
  const branch = (await getBranches()).find((item) => item.name.trim().toLowerCase() === branchName.toLowerCase());
  const corrections: Array<{ module: string; id: string; before: unknown; after: unknown }> = [];
  const calendar = await loadWorkCalendar(branchName);

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
    if (batch.kind === "New Sale") await saveSales(tx, kept as typeof batch.sales, changes, { calendar, dateRemitted, dateRemittedReason, method: method.name, penalty, penaltyNote, fidelity, encodedOn, today, branchId: branch?.id ?? "", corrections });
    else await saveCollections(tx, kept as typeof batch.collections, changes, { calendar, dateRemitted, dateRemittedReason, method: method.name, reference: text(input.paymentReference), collectedBy: text(input.collectedBy), penalty, penaltyNote, fidelity, encodedOn, today, branchId: branch?.id ?? "", corrections });
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

type Common = { calendar: WorkCalendar; dateRemitted: string; dateRemittedReason: string | null; method: string; penalty: number; penaltyNote: string; fidelity: number; encodedOn: string; today: string; branchId: string; corrections: Array<{ module: string; id: string; before: unknown; after: unknown }> };

type SaleRow = typeof sales.$inferSelect;
const beneficiaryOf = (item: typeof beneficiaries.$inferSelect): SaleBeneficiary => ({ surname: text(item.surname), firstName: text(item.first_name), middleName: text(item.middle_name), birthdate: isoDate(item.birthdate), relationship: text(item.relationship) });

/** The details a New Sale was saved with, as the editor shows them. */
function saleDetailsOf(row: SaleRow, saleBeneficiaries: SaleBeneficiary[]): SaleDetails {
  return {
    surname: text(row.surname), firstName: text(row.first_name), middleName: text(row.middle_name), nameExtension: text(row.name_extension), birthdate: isoDate(row.birthdate),
    birthplace: text(row.birthplace), gender: text(row.gender), civilStatus: text(row.civil_status), contactNumber: text(row.member_contact), address: text(row.address),
    claimantName: text(row.claimant_name), claimantContact: text(row.claimant_contact), claimantSameAddress: Boolean(row.claimant_same_address), claimantAddress: text(row.claimant_address),
    programId: row.program_id, beneficiaries: saleBeneficiaries,
  };
}

/** The edited details with the clerk's values cleaned up; anything not sent keeps what the sale has. */
function editedDetails(current: SaleDetails, given: Partial<SaleDetails> | undefined): SaleDetails {
  if (!given) return current;
  const pick = (key: Exclude<keyof SaleDetails, "claimantSameAddress" | "beneficiaries">) => (given[key] === undefined ? current[key] : text(given[key]));
  const next: SaleDetails = {
    surname: pick("surname"), firstName: pick("firstName"), middleName: pick("middleName"), nameExtension: pick("nameExtension"), birthdate: pick("birthdate"),
    birthplace: pick("birthplace"), gender: pick("gender"), civilStatus: pick("civilStatus"), contactNumber: pick("contactNumber"), address: pick("address"),
    claimantName: pick("claimantName"), claimantContact: pick("claimantContact"), claimantSameAddress: given.claimantSameAddress ?? current.claimantSameAddress, claimantAddress: pick("claimantAddress"),
    programId: pick("programId"),
    beneficiaries: given.beneficiaries === undefined ? current.beneficiaries : given.beneficiaries.map((item) => ({ surname: text(item.surname), firstName: text(item.firstName), middleName: text(item.middleName), birthdate: text(item.birthdate), relationship: text(item.relationship) })),
  };
  if (next.claimantSameAddress) next.claimantAddress = next.address;
  return next;
}

const memberDetailsOf = (details: SaleDetails, today: string): MemberDetails => ({
  surname: details.surname, firstName: details.firstName, middleName: details.middleName, nameExtension: details.nameExtension, birthdate: details.birthdate, birthplace: details.birthplace,
  gender: details.gender, age: details.birthdate ? String(ageOn(details.birthdate, today) ?? "") : "", civilStatus: details.civilStatus, contactNumber: details.contactNumber, addressHouse: details.address,
  claimantName: details.claimantName, claimantContact: details.claimantContact, claimantSameAsMember: details.claimantSameAddress ? "Yes" : "No", claimantAddressHouse: details.claimantAddress,
});

/** Philippine mobile numbers compared without spaces, dashes or +63; blank when there is no usable number. */
function phoneKey(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("63")) digits = `0${digits.slice(2)}`;
  return digits.length >= 10 ? digits : "";
}

async function saveSales(tx: Transaction, rows: SaleRow[], changes: Map<string, EntryInput>, common: Common) {
  const programList = await getPrograms();
  const used = await recordedApplicationNumbers(rows.map((row) => changes.get(row.sale_id)?.applicationNumber ?? row.application_no), tx);
  const inBatch = new Map<string, string>();
  const ids = rows.map((row) => row.sale_id);
  const [beneficiaryRows, memberRows, employees] = await Promise.all([
    tx.select().from(beneficiaries).where(inArray(beneficiaries.sale_id, ids)).orderBy(asc(beneficiaries.row_seq)),
    tx.select({ memberId: members.member_id, memberNumber: members.member_number }).from(members).where(inArray(members.member_number, [...new Set(rows.map((row) => text(row.member_number)))])),
    getEmployees(),
  ]);
  const employeeContacts = new Map(employees.map((employee) => [phoneKey(employee.contact), employee] as const).filter(([key]) => key));
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
    checkBackdate(orDate, backdateReason, label, common.encodedOn, common.calendar);

    // The sale's details: member, claimant, program and beneficiaries (owner, October 17, 2026).
    const current = saleDetailsOf(row, beneficiaryRows.filter((item) => item.sale_id === row.sale_id).map(beneficiaryOf));
    const details = editedDetails(current, change.sale);
    const memberId = memberRows.find((item) => text(item.memberNumber) === text(row.member_number))?.memberId ?? "";
    if (!details.surname || !details.firstName) throw new Error(`${label}: the member's surname and first name are required.`);
    if (!details.address) throw new Error(`${label}: the member's complete address is required.`);
    if (details.birthdate && (!/^\d{4}-\d{2}-\d{2}$/.test(details.birthdate) || details.birthdate > common.today)) throw new Error(`${label}: enter a valid birthdate, today or earlier.`);
    for (const [who, value, before] of [["Member", details.contactNumber, current.contactNumber], ["Claimant", details.claimantContact, current.claimantContact]] as const) {
      if (phoneKey(value) === phoneKey(before) && text(value) === text(before)) continue;
      if (!/^09\d{9}$/.test(value.replace(/\D/g, ""))) throw new Error(`${label}: ${who} contact number must use the Philippine mobile format 09XX XXX XXXX.`);
      const employee = employeeContacts.get(phoneKey(value));
      if (employee) throw new Error(`${label}: ${who} contact number ${value} belongs to employee ${employee.name} (${employee.id}). Use the member's or claimant's own number.`);
    }
    if (details.beneficiaries.length > 20) throw new Error(`${label}: at most 20 beneficiaries.`);
    if (details.beneficiaries.some((item) => !item.surname || !item.firstName || !item.relationship)) throw new Error(`${label}: each beneficiary needs a surname, first name, and relationship.`);
    if (details.beneficiaries.some((item) => item.birthdate && (!/^\d{4}-\d{2}-\d{2}$/.test(item.birthdate) || item.birthdate > common.today))) throw new Error(`${label}: enter a valid beneficiary birthdate, today or earlier.`);
    // A changed name or birthdate must not make this member a copy of another member already on record.
    if (personKey(details) && personKey(details) !== personKey(current)) {
      const onRecord = (await recordedMembersByPerson([details], tx)).get(personKey(details));
      if (onRecord && onRecord.memberId !== memberId) throw new Error(`${label}: ${onRecord.name} with this birthdate is already member ${onRecord.memberNumber}. Remove this entry and encode the sale for that member instead.`);
    }
    const programChanged = details.programId !== row.program_id;
    const program = programList.find((item) => item.id === details.programId);
    if (!program) throw new Error(`${label}: choose a program.`);
    // The account (this member in the sale's program); its DOI follows the application date while it has no collections.
    const [account] = await tx.select({ id: memberPrograms.enrollment_id }).from(memberPrograms).where(and(eq(memberPrograms.member_number, text(row.member_number)), eq(memberPrograms.program_id, row.program_id)));
    const [paid] = account ? await tx.select({ n: sql<number>`count(*)::int` }).from(collections).where(eq(collections.enrollment_id, account.id)) : [{ n: 0 }];
    const hasCollections = Boolean(Number(paid?.n));
    if (programChanged) {
      if (program.status !== "active") throw new Error(`${label}: ${program.name} is not active.`);
      if (hasCollections) throw new Error(`${label}: this account already has collections, so its program cannot change here. Ask an administrator (Edit / Corrections).`);
      const [taken] = await tx.select({ id: memberPrograms.enrollment_id }).from(memberPrograms).where(and(eq(memberPrograms.member_number, text(row.member_number)), eq(memberPrograms.program_id, program.id)));
      if (taken) throw new Error(`${label}: this member already has ${program.name}.`);
    }
    if (programChanged || details.birthdate !== current.birthdate) {
      const ageError = ageRestrictionError(program, details.birthdate, common.today);
      if (ageError) throw new Error(`${label}: ${ageError}`);
    }
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label}: enter a valid amount paid.`);
    if (program.flexible && cents(amount) < cents(fixedNewSaleAmount(program))) throw new Error(`${label}: ${program.name} needs at least ${fixedNewSaleAmount(program)}.`);
    if (!program.flexible && !program.newSaleAmountEditable && cents(amount) !== cents(fixedNewSaleAmount(program))) throw new Error(`${label}: ${program.name} has a fixed amount of ${fixedNewSaleAmount(program)}.`);
    const quote = calculateSaleIncentive({ ...program, incentiveTiers: tiersForBranch(program.incentiveTiers, common.branchId) }, amount);
    let doi = day(row.doi);
    if (account && !hasCollections && orDate && orDate !== day(row.or_date) && doi === day(row.or_date)) { doi = orDate; writes.push(() => tx.update(memberPrograms).set({ doi: orDate }).where(eq(memberPrograms.enrollment_id, account.id))); }
    const registration = { registration_fee: program.registrationFeeRequired, registration_amount: program.registrationFeeRequired ? program.registrationAmount : 0 };
    const firstRow = index === 0;
    const memberAfter = memberColumns(memberDetailsOf(details, common.today)), memberBefore = memberColumns(memberDetailsOf(current, common.today));
    const after = {
      application_no: applicationNumber, or_date: orDate || null, doi: doi || null, amount_paid: amount, notes: notes || null, backdate_reason: backdateReason || null,
      date_remitted: common.dateRemitted, date_remitted_reason: common.dateRemittedReason ?? (row.date_remitted_reason || null), payment_method: common.method, mas_incentive: quote.incentive, remittance_amount: quote.remittance,
      penalty_amount: firstRow && common.penalty > 0 ? common.penalty : null, penalty_note: firstRow && common.penalty > 0 ? common.penaltyNote : null,
      fidelity_amount: firstRow && common.fidelity > 0 ? common.fidelity : null,
      program_id: details.programId, ...(programChanged ? registration : {}), ...memberAfter,
    };
    const before = {
      application_no: row.application_no, or_date: day(row.or_date) || null, doi: day(row.doi) || null, amount_paid: Number(row.amount_paid ?? 0), notes: row.notes || null, backdate_reason: row.backdate_reason || null,
      date_remitted: day(row.date_remitted), date_remitted_reason: row.date_remitted_reason || null, payment_method: row.payment_method, mas_incentive: Number(row.mas_incentive ?? 0), remittance_amount: Number(row.remittance_amount ?? 0),
      penalty_amount: row.penalty_amount === null ? null : Number(row.penalty_amount), penalty_note: row.penalty_note || null, fidelity_amount: row.fidelity_amount === null ? null : Number(row.fidelity_amount),
      program_id: row.program_id, ...(programChanged ? { registration_fee: row.registration_fee, registration_amount: row.registration_amount === null ? null : Number(row.registration_amount) } : {}), ...memberBefore,
    };
    const beneficiariesChanged = JSON.stringify(details.beneficiaries) !== JSON.stringify(current.beneficiaries);
    if (JSON.stringify(before) === JSON.stringify(after) && !beneficiariesChanged) continue;
    writes.push(() => tx.update(sales).set(after).where(eq(sales.sale_id, row.sale_id)));
    writes.push(() => tx.update(memberPrograms).set({ amount_paid: amount, remittance_method: common.method, ...(programChanged ? { program_id: details.programId, ...registration } : {}) })
      .where(and(eq(memberPrograms.member_number, text(row.member_number)), eq(memberPrograms.program_id, row.program_id))));
    // The member's record follows the details the clerk changed on this sale; others on the record stay.
    const memberChanges = Object.fromEntries(Object.entries(memberAfter).filter(([column, value]) => value !== memberBefore[column as keyof typeof memberBefore]));
    if (memberId && Object.keys(memberChanges).length) writes.push(() => tx.update(members).set(memberChanges).where(eq(members.member_id, memberId)));
    if (memberId && beneficiariesChanged) {
      writes.push(() => tx.delete(beneficiaries).where(eq(beneficiaries.sale_id, row.sale_id)));
      writes.push(() => addBeneficiaries(memberId, row.sale_id, details.beneficiaries.map((item) => ({ ...item, age: item.birthdate ? ageOn(item.birthdate, common.today) : null }))));
    }
    common.corrections.push({ module: "New Sales", id: row.sale_id, before: { ...before, ...(beneficiariesChanged ? { beneficiaries: current.beneficiaries } : {}) }, after: { ...after, ...(beneficiariesChanged ? { beneficiaries: details.beneficiaries } : {}) } });
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
    checkBackdate(orDate, backdateReason, label, common.encodedOn, common.calendar);
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
    // ORC and reactivation stay as encoded: ORC from the saved breakdown (set per batch), reactivation per entry.
    const orc = common.collectedBy === "Collector" && Array.isArray(row.remittance_breakdown) && (row.remittance_breakdown as Array<{ orc?: boolean }>).some((item) => item?.orc === true);
    const quote = calculateRemittance(account.basePay, tiersForBranch(data.incentives.filter((tier) => tier.programId === account.programId), common.branchId), incentiveRoleFor(common.collectedBy), nopFrom, nopTo, amount, account.flexible, account.maxMonthlyPayment, { orc, reactivation: row.reactivation === true });
    payments = [...payments, { id: row.collection_id, enrollmentId: account.id, orDate, orNumber, monthFrom, monthTo, nopFrom, nopTo, amount, dateRemitted: common.dateRemitted, mas: text(row.mas) }];
    const firstRow = row === rows[0];
    const after = {
      or_number: orNumber, or_date: orDate, amount_collected: amount, month_to: monthTo, nop_to: nopTo, backdate_reason: backdateReason || null,
      date_remitted: common.dateRemitted, date_remitted_reason: common.dateRemittedReason ?? (row.date_remitted_reason || null), remittance_method: common.method, payment_reference: common.reference || null, collected_by_role: common.collectedBy,
      original_mas: common.collectedBy === "Collector" ? text(row.mas) : null, remittance_amount: quote.remittance, remittance_breakdown: quote.breakdown,
      penalty_amount: firstRow && common.penalty > 0 ? common.penalty : null, penalty_note: firstRow && common.penalty > 0 ? common.penaltyNote : null,
      fidelity_amount: firstRow && common.fidelity > 0 ? common.fidelity : null,
    };
    const before = {
      or_number: row.or_number, or_date: day(row.or_date), amount_collected: Number(row.amount_collected), month_to: text(row.month_to).slice(0, 7), nop_to: row.nop_to, backdate_reason: row.backdate_reason || null,
      date_remitted: day(row.date_remitted), date_remitted_reason: row.date_remitted_reason || null, remittance_method: row.remittance_method, payment_reference: row.payment_reference || null, collected_by_role: row.collected_by_role,
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
