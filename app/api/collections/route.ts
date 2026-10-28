import { refuseOnDayOff } from "@/lib/day-off";
import { clearingProblem, dateRemittedReasonProblem, waitingBatchProblem } from "@/lib/clearing";
import { normalizeOrNumber, orNumberProblem } from "@/lib/or-number";
import { submitCashAfterSave } from "@/lib/remittance-workflow";
import { createReadableId } from "@/lib/readable-id";
import { manilaNow } from "@/lib/remittance-deadline";
import { checkBackdate, controlTotalProblem, lateCheckDay, lateEntryReason } from "@/lib/entry-controls";
import { loadWorkCalendar } from "@/lib/work-calendar";
import { blockingDateProblem } from "@/lib/date-checks";
import { currentEncoder, withEncoder } from "@/lib/encoder-context";
import { userWithPageAccess } from "@/lib/auth-server";
import { inTransaction, isUniqueViolation } from "@/lib/db";
import { loadAccountData, commitCollections, type NewCollection } from "@/lib/account-data";
import { accountState, COLLECTION_CHANNELS, incentiveRoleFor, validatePayment, validDate, type AccountPayment } from "@/lib/account-rules";
import { findActivePaymentMethod } from "@/lib/remittance-methods";
import { calculateRemittance, noIncentiveReasonOf, tiersForBranch, withoutIncentive } from "@/lib/remittance";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { entryKey, recordedOrNumbers } from "@/lib/duplicate-entries";

/**
 * The same branch or MAS name, ignoring case and extra spaces: accounts keep the MAS as first encoded (e.g. "Nagliba,
 * Marissa") while the employee and the Clearing pick may be spelled "NAGLIBA, MARISSA" (owner, October 13, 2026).
 */
const sameName = (a: unknown, b: unknown) => String(a ?? "").trim().replace(/\s+/g, " ").toLowerCase() === String(b ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export async function GET(request: Request) {
  if (!(await userWithPageAccess("/collections"))) return Response.json({ success: false, message: "You do not have access to Collections." }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    const data = await loadAccountData({ memberId: searchParams.get("memberId") ?? "" });
    // A DTO batch takes any account of the branch, whatever its MAS (owner, October 13, 2026).
    const dto = searchParams.get("dto") === "1";
    const matches = data.accounts.filter((a) => a.programId === searchParams.get("programId") && sameName(a.branch, searchParams.get("branch")) && (dto || sameName(a.mas, searchParams.get("mas"))));
    if (matches.length !== 1) return Response.json({ success: false, message: "A unique active program enrollment was not found. A program deactivated for this member takes no collections." }, { status: 404 });
    const account = matches[0];
    const history = data.payments.filter((p) => p.enrollmentId === account.id).sort((a, b) => b.nopTo - a.nopTo);
    return Response.json({ success: true, account: { ...account, ...accountState(account, history) }, history: history.map((p) => ({ ...p, memberId: account.memberId, programId: account.programId, monthOf: p.monthTo, nop: p.nopTo, amountCollected: p.amount })) });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load account." }, { status: 500 }); }
}

export const POST = withEncoder(async (request: Request) => {
  // Day Off locks the day's entries (lib/day-off.ts).
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  if (!(await userWithPageAccess("/collections"))) return Response.json({ success: false, message: "You do not have access to Collections." }, { status: 403 });
  // Nobody encodes from the 3:00 PM cutoff until midnight.
  return saveCollections(request);
});

async function saveCollections(request: Request) {
  let writing = false;
  try {
    const body = await request.json();
    const branch = String(body.branch ?? "").trim();
    /*
     * DTO batch (owner, October 13, 2026): the member paid at the office, often because their MAS resigned or is
     * inactive. The clerk who received the cash is accountable; there is no clearing (the clerk received it directly),
     * any account of the branch may be paid whatever its MAS, the account keeps its MAS on record, and no incentive,
     * penalty or Fidelity applies.
     */
    const dto = body.dto === true;
    const clerk = currentEncoder();
    const mas = dto ? "" : String(body.mas ?? "").trim();
    const accountableEmployeeId = dto ? clerk?.employeeId ?? "" : String(body.accountableEmployeeId ?? "").trim();
    const dateRemitted = String(body.dateRemitted ?? "");
    const autoApproveRemittance = body.autoApproveRemittance === true;
    if (!branch || (!dto && !mas) || !accountableEmployeeId || !validDate(dateRemitted) || !Array.isArray(body.collections) || !body.collections.length) throw new Error(dto ? "Branch, Date Remitted and collections are required; DTO needs a signed-in employee." : "Branch, accountable Collector/MAS, Date Remitted, and collections are required.");
    if (dto && dateRemitted > manilaNow().date) throw new Error("The Date Remitted cannot be in the future.");
    const [employees, branches] = await Promise.all([getEmployees(), getBranches()]);
    const selectedBranch = branches.find((item) => item.name === branch && item.status === "active");
    const accountable = dto
      ? employees.find((employee) => employee.id === accountableEmployeeId && employee.status.toLowerCase() === "active")
      : employees.find((employee) => employee.id === accountableEmployeeId && employee.name === mas && employee.status.toLowerCase() === "active" && selectedBranch && employee.branchIds.includes(selectedBranch.id));
    if (!selectedBranch) throw new Error("Select an active branch.");
    if (!accountable) throw new Error(dto ? "DTO needs your own active employee record: you are accountable for the cash you received." : "Select an active accountable employee assigned to the selected branch.");
    let dateRemittedReason = "";
    if (!dto) {
      // Encoding follows Clearing: the accountable person must be cleared for this branch on the Date Remitted.
      const notCleared = await clearingProblem(accountable.id, accountable.name, selectedBranch.name, dateRemitted, "Collections");
      if (notCleared) throw new Error(notCleared);
      // No second batch while one for the same person and day is waiting for approval (double entries; lib/clearing.ts).
      const waiting = await waitingBatchProblem(accountable.id, accountable.name, selectedBranch.name, dateRemitted, "Collections");
      if (waiting) throw new Error(waiting);
      // A Date Remitted moved off the clearing day (encoding delayed by meetings and the like) needs a reason, kept on each row.
      dateRemittedReason = String(body.dateRemittedReason ?? "").trim().slice(0, 300);
      const reasonProblem = await dateRemittedReasonProblem(accountable.id, selectedBranch.name, dateRemitted, dateRemittedReason, "Collections");
      if (reasonProblem) throw new Error(reasonProblem);
    }
    // Batch-level details: who brought the payments in and how the MAS remitted them.
    const collectedBy = dto ? "DTO" : String(body.collectedBy ?? "").trim();
    // ORC, outright commission (owner, October 13, 2026): set per Collector batch; the Collector earns half of the MAS incentive.
    const orc = !dto && body.orc === true;
    if (orc && collectedBy !== "Collector") throw new Error("ORC (outright commission) applies only when the batch is collected by a Collector.");
    if (!(COLLECTION_CHANNELS as readonly string[]).includes(collectedBy)) throw new Error("Select whether the batch was collected by MAS, Collector, or DTO (Direct to Office).");
    // A Collector brings in payments for the batch's own MAS, so that MAS is the original MAS on record.
    const originalMas = collectedBy === "Collector" ? mas : "";
    const paymentMethod = await findActivePaymentMethod(String(body.paymentMethod ?? ""));
    const paymentReference = String(body.paymentReference ?? "").trim();
    // The reference number is optional (October 8, 2026): the receipt photo attached in My Entries is the proof.
    if (paymentReference.length > 100) throw new Error("The payment reference must be 100 characters or fewer.");
    // A remittance penalty is charged to the accountable MAS/Collector (paid from their own money), not to members.
    // It is added once to the batch's total remittance and stored on the batch's first Collection row.
    const penalty = Math.round((Number(body.penalty) || 0) * 100) / 100;
    const penaltyNote = String(body.penaltyNote ?? "").trim();
    if (!Number.isFinite(penalty) || penalty < 0) throw new Error("The penalty must be zero or a positive amount.");
    if (penalty > 0 && penaltyNote.length < 3) throw new Error("Explain what the penalty is for (at least 3 characters).");
    if (penaltyNote.length > 300) throw new Error("The penalty note must be 300 characters or fewer.");
    if (dto && penalty > 0) throw new Error("A DTO batch has no MAS to charge a penalty to.");
    // Fidelity: the accountable employee's own money handed over with this batch. It has no limit, leaves incentives
    // untouched, and is added to the batch's total remittance.
    const fidelity = Math.round((Number(body.fidelityAmount) || 0) * 100) / 100;
    if (!Number.isFinite(fidelity) || fidelity < 0) throw new Error("Fidelity must be zero or a positive amount.");
    if (dto && fidelity > 0) throw new Error("A DTO batch has no MAS whose Fidelity it could be.");
    if (autoApproveRemittance) {
      // Same rule as Remittances: anyone who can encode may confirm full physical cash; other methods are verified there.
      if (!paymentMethod.isCash) throw new Error(`${paymentMethod.name} payments are verified in Remittances before approval.`);
      // Approval needs a receipt photo, which can only be attached once the collections exist. The Collections form saves
      // the batch, attaches the photo, then approves through Remittances, so approving here would fail after saving.
      throw new Error("Receipt photos are required before a remittance is approved. Save the batch, attach the receipt photo, then approve it.");
    }
    const entries: Array<Record<string, unknown>> = body.collections;
    // Late OR dates skip Sundays and the branch's declared non-working days (lib/working-days.ts).
    const calendar = await loadWorkCalendar(selectedBranch.name);
    const saved = await inTransaction(async (tx) => {
      // The batch's accounts stay locked until it is saved: a concurrent batch for the same account, on any server, waits
      // and then validates against this batch's payments.
      const [data, recordedReceipts] = await Promise.all([
        loadAccountData({ memberPrograms: entries.map((entry) => ({ memberNumber: String(entry.memberNumber ?? "").trim(), programId: String(entry.programId ?? "") })) }, tx, { lock: true }),
        recordedOrNumbers(entries.map((entry) => entry.orNumber), tx),
      ]);
      const payments = [...data.payments];
      // Each OR Number is one receipt for one entry: reusing one, here or in an earlier batch, is a double entry.
      const batchReceipts = new Map<string, string>();
      const touched = new Map<string, typeof data.accounts[number]>();
      const rows: NewCollection[] = [];
      const timestamp = new Date().toISOString();
      const batchId = createReadableId("CBT");
      let grossCents = 0, remittanceCents = 0;
      for (const entry of entries) {
        const matches = data.accounts.filter((a) => a.memberNumber === String(entry.memberNumber ?? "").trim() && a.programId === entry.programId);
        if (matches.length !== 1) throw new Error("A unique active program enrollment was not found. A program deactivated for this member takes no collections.");
        const account = matches[0];
        if (!sameName(account.branch, branch) || (!dto && !sameName(account.mas, mas))) throw new Error(`Collection for ${account.memberNumber} must use its assigned Branch${dto ? "" : " and MAS"}.`);
        // The payment keeps the account's MAS on record; in a DTO batch the clerk is only accountable for the cash.
        const accountMas = dto ? account.mas : mas;
        const input = {
          monthFrom: String(entry.monthFrom ?? ""), monthTo: String(entry.monthTo ?? ""), nopFrom: Number(entry.nopFrom), nopTo: Number(entry.nopTo), amount: Number(entry.amountCollected),
          orDate: String(entry.orDate ?? ""), orNumber: normalizeOrNumber(String(entry.orNumber ?? "")), waiver: String(entry.ifSuspended ?? ""),
          collectedByRole: collectedBy, originalMas,
        };
        // The OR number ends with the branch letter (lib/or-number.ts).
        const orProblem = orNumberProblem(input.orNumber);
        if (orProblem) throw new Error(`Collection for ${account.memberNumber}: ${orProblem}`);
        // Judged from the Date Remitted when it was changed with a reason, which already explains the late encoding.
        const ownReason = String(entry.backdateReason ?? "").trim().slice(0, 300);
        checkBackdate(input.orDate, ownReason, `Collection for ${account.memberNumber}`, lateCheckDay(dateRemitted, dateRemittedReason), calendar);
        const backdateReason = lateEntryReason(input.orDate, ownReason, dateRemittedReason, manilaNow().date, calendar);
        const dateProblem = blockingDateProblem({ receiptDate: input.orDate, dateRemitted, today: manilaNow().date });
        if (dateProblem) throw new Error(`Collection for ${account.memberNumber}: ${dateProblem}`);
        const receipt = entryKey(input.orNumber);
        const recorded = recordedReceipts.get(receipt);
        if (recorded) throw new Error(`OR Number ${input.orNumber} is already recorded (collection ${recorded.collectionId}${recorded.memberNumber ? ` for member ${recorded.memberNumber}` : ""}). Each OR Number is used once.`);
        if (receipt && batchReceipts.has(receipt)) throw new Error(`OR Number ${input.orNumber} is entered twice in this batch (${batchReceipts.get(receipt)} and ${account.memberNumber}). Each OR Number is used once.`);
        if (receipt) batchReceipts.set(receipt, account.memberNumber);
        validatePayment(account, payments, input);
        // Reactivation is per entry: whoever collected earns only 10%; it cannot be in an ORC batch.
        const reactivation = entry.reactivation === "Yes";
        if (orc && reactivation) throw new Error(`Collection for ${account.memberNumber}: a reactivation cannot be in an ORC batch.`);
        const quote = calculateRemittance(account.basePay, tiersForBranch(data.incentives.filter((tier) => tier.programId === account.programId), selectedBranch.id), incentiveRoleFor(collectedBy), input.nopFrom, input.nopTo, input.amount, account.flexible, account.maxMonthlyPayment, { orc, reactivation });
        // No incentive (owner, October 20, 2026): the collector earns nothing on this one; it is remitted whole. A DTO
        // batch earns no incentive anyway.
        const noIncentiveReason = dto ? "" : noIncentiveReasonOf(entry.noIncentive, entry.noIncentiveReason, `Collection for ${account.memberNumber}`);
        const kept = noIncentiveReason ? withoutIncentive(input.amount, quote.remittance) : { remittance: quote.remittance, forfeited: 0 };
        // Client totals are only a preview. Persist the authoritative server calculation.
        grossCents += Math.round(quote.gross * 100);
        remittanceCents += Math.round(kept.remittance * 100);
        const id = createReadableId("COL");
        const payment: AccountPayment = { ...input, id, enrollmentId: account.id, dateRemitted, mas: accountMas };
        payments.push(payment);
        touched.set(account.id, account);
        // Penalty and Fidelity belong to the batch and are stored on its first row. forfeited_incentive is set at
        // remittance (or here, for No incentive); backdate_reason when the OR date is more than a day old; date_remitted is the batch's Date Remitted,
        // so the dates can be checked against each other later.
        const first = !rows.length;
        rows.push({
          collection_id: id, collection_batch_id: batchId, enrollment_id: account.id, member_id: account.memberId, member_number: account.memberNumber, program_id: account.programId,
          branch, mas: accountMas, or_number: input.orNumber, or_date: input.orDate, amount_collected: input.amount, month_from: input.monthFrom, month_to: input.monthTo,
          nop_from: input.nopFrom, nop_to: input.nopTo, reactivation: entry.reactivation === "Yes", transferred: entry.transferred === "Yes",
          suspended: input.waiver || null, original_mas: input.originalMas || null, status: "Posted", created_at: timestamp,
          collected_by_role: input.collectedByRole, remittance_amount: kept.remittance, forfeited_incentive: kept.forfeited > 0 ? kept.forfeited : null, no_incentive_reason: noIncentiveReason || null, remittance_breakdown: quote.breakdown, remittance_status: "Outstanding",
          accountable_employee_id: accountableEmployeeId, accountable_name: dto ? accountable.name : mas, accountable_role: dto ? "DTO" : "MAS", remittance_method: paymentMethod.name, payment_reference: paymentReference || null,
          penalty_amount: first && penalty > 0 ? penalty : null, penalty_note: first && penalty > 0 ? penaltyNote : null, fidelity_amount: first && fidelity > 0 ? fidelity : null,
          backdate_reason: backdateReason || null, date_remitted: dateRemitted, date_remitted_reason: dateRemittedReason || null,
        });
      }
      // The batch's total remittance (server calculation, plus Fidelity) must equal the net total on the turnover sheet.
      const controlProblem = controlTotalProblem(body.controlTotal, (remittanceCents + Math.round(fidelity * 100)) / 100);
      if (controlProblem) throw new Error(controlProblem);
      writing = true;
      await commitCollections(tx, rows, [...touched.values()], payments);
      return { ids: rows.map((row) => row.collection_id), grossCents };
    });
    // Paid in cash: straight to Pending Approval (lib/entry-batches.ts); other methods wait for the receipt photo.
    const slips = await submitCashAfterSave(saved.ids);
    return Response.json({ success: true, collectionIds: saved.ids, slips, grossCollection: saved.grossCents / 100, message: `${saved.ids.length} collection(s) saved${penalty > 0 ? ` with a ${penalty.toLocaleString("en-PH", { style: "currency", currency: "PHP" })} penalty` : ""}. ${slips.length ? `Cash sent for approval: ${slips.join(", ")}.` : "Attach the receipt photo in My Entries to send them for approval."}` }, { status: 201 });
  } catch (error) {
    // Another save used the same OR Number at the same moment; the database's unique rule refused this one.
    if (isUniqueViolation(error, "collections_or_key_unique")) return Response.json({ success: false, message: "One of these OR Numbers was just recorded by another save. Each OR Number is used once; check the receipts and try again." }, { status: 409 });
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save collections." }, { status: writing ? 500 : 400 });
  }
}
