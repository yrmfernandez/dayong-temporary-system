import { createReadableId } from "@/lib/readable-id";
import { ENTRY_CLOSED_MESSAGE, entryClosed, manilaNow } from "@/lib/remittance-deadline";
import { checkBackdate, controlTotalProblem } from "@/lib/entry-controls";
import { blockingDateProblem } from "@/lib/date-checks";
import { withEncoder } from "@/lib/encoder-context";
import { userWithPageAccess } from "@/lib/auth-server";
import { inTransaction, isUniqueViolation } from "@/lib/db";
import { loadAccountData, commitCollections, type NewCollection } from "@/lib/account-data";
import { accountState, COLLECTION_CHANNELS, incentiveRoleFor, validatePayment, validDate, type AccountPayment } from "@/lib/account-rules";
import { findActivePaymentMethod } from "@/lib/remittance-methods";
import { calculateRemittance, tiersForBranch } from "@/lib/remittance";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { entryKey, recordedOrNumbers } from "@/lib/duplicate-entries";

export async function GET(request: Request) {
  if (!(await userWithPageAccess("/collections"))) return Response.json({ success: false, message: "You do not have access to Collections." }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    const data = await loadAccountData({ memberId: searchParams.get("memberId") ?? "" });
    const matches = data.accounts.filter((a) => a.programId === searchParams.get("programId") && a.branch === searchParams.get("branch") && a.mas === searchParams.get("mas"));
    if (matches.length !== 1) return Response.json({ success: false, message: "A unique program enrollment was not found." }, { status: 404 });
    const account = matches[0];
    const history = data.payments.filter((p) => p.enrollmentId === account.id).sort((a, b) => b.nopTo - a.nopTo);
    return Response.json({ success: true, account: { ...account, ...accountState(account, history) }, history: history.map((p) => ({ ...p, memberId: account.memberId, programId: account.programId, monthOf: p.monthTo, nop: p.nopTo, amountCollected: p.amount })) });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load account." }, { status: 500 }); }
}

export const POST = withEncoder(async (request: Request) => {
  if (!(await userWithPageAccess("/collections"))) return Response.json({ success: false, message: "You do not have access to Collections." }, { status: 403 });
  // Nobody encodes from the 3:00 PM cutoff until midnight.
  if (entryClosed()) return Response.json({ success: false, message: ENTRY_CLOSED_MESSAGE }, { status: 403 });
  return saveCollections(request);
});

async function saveCollections(request: Request) {
  let writing = false;
  try {
    const body = await request.json();
    const branch = String(body.branch ?? "").trim();
    const mas = String(body.mas ?? "").trim();
    const accountableEmployeeId = String(body.accountableEmployeeId ?? "").trim();
    const dateRemitted = String(body.dateRemitted ?? "");
    const autoApproveRemittance = body.autoApproveRemittance === true;
    if (!branch || !mas || !accountableEmployeeId || !validDate(dateRemitted) || !Array.isArray(body.collections) || !body.collections.length) throw new Error("Branch, accountable Collector/MAS, Date Remitted, and collections are required.");
    const [employees, branches] = await Promise.all([getEmployees(), getBranches()]);
    const selectedBranch = branches.find((item) => item.name === branch && item.status === "active");
    const accountable = employees.find((employee) => employee.id === accountableEmployeeId && employee.name === mas && employee.status.toLowerCase() === "active" && selectedBranch && employee.branchIds.includes(selectedBranch.id));
    if (!selectedBranch || !accountable) throw new Error("Select an active accountable employee assigned to the selected branch.");
    // Batch-level details: who brought the payments in and how the MAS remitted them.
    const collectedBy = String(body.collectedBy ?? "").trim();
    if (!(COLLECTION_CHANNELS as readonly string[]).includes(collectedBy)) throw new Error("Select whether the batch was collected by MAS, Collector, or DTO (Direct to Office).");
    // A Collector brings in payments for the batch's own MAS, so that MAS is the original MAS on record.
    const originalMas = collectedBy === "Collector" ? mas : "";
    const paymentMethod = await findActivePaymentMethod(String(body.paymentMethod ?? ""));
    const paymentReference = String(body.paymentReference ?? "").trim();
    if (paymentMethod.requiresReference && !paymentReference) throw new Error(`Enter the ${paymentMethod.name} reference number.`);
    if (paymentReference.length > 100) throw new Error("The payment reference must be 100 characters or fewer.");
    // A remittance penalty is charged to the accountable MAS/Collector (paid from their own money), not to members.
    // It is added once to the batch's total remittance and stored on the batch's first Collection row.
    const penalty = Math.round((Number(body.penalty) || 0) * 100) / 100;
    const penaltyNote = String(body.penaltyNote ?? "").trim();
    if (!Number.isFinite(penalty) || penalty < 0) throw new Error("The penalty must be zero or a positive amount.");
    if (penalty > 0 && penaltyNote.length < 3) throw new Error("Explain what the penalty is for (at least 3 characters).");
    if (penaltyNote.length > 300) throw new Error("The penalty note must be 300 characters or fewer.");
    // Fidelity: the accountable employee's own money handed over with this batch. It has no limit, leaves incentives
    // untouched, and is added to the batch's total remittance.
    const fidelity = Math.round((Number(body.fidelityAmount) || 0) * 100) / 100;
    if (!Number.isFinite(fidelity) || fidelity < 0) throw new Error("Fidelity must be zero or a positive amount.");
    // The batch must add up to the total the MAS wrote on the turnover sheet.
    const controlProblem = controlTotalProblem(body.controlTotal, body.collections.map((entry: Record<string, unknown>) => Number(entry.amountCollected) || 0));
    if (controlProblem) throw new Error(controlProblem);
    if (autoApproveRemittance) {
      // Same rule as Remittances: anyone who can encode may confirm full physical cash; other methods are verified there.
      if (!paymentMethod.isCash) throw new Error(`${paymentMethod.name} payments are verified in Remittances before approval.`);
      // Approval needs a receipt photo, which can only be attached once the collections exist. The Collections form saves
      // the batch, attaches the photo, then approves through Remittances, so approving here would fail after saving.
      throw new Error("Receipt photos are required before a remittance is approved. Save the batch, attach the receipt photo, then approve it.");
    }
    const entries: Array<Record<string, unknown>> = body.collections;
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
      let grossCents = 0;
      for (const entry of entries) {
        const matches = data.accounts.filter((a) => a.memberNumber === String(entry.memberNumber ?? "").trim() && a.programId === entry.programId);
        if (matches.length !== 1) throw new Error("A unique program enrollment was not found.");
        const account = matches[0];
        if (account.branch !== branch || account.mas !== mas) throw new Error(`Collection for ${account.memberNumber} must use its assigned Branch and MAS.`);
        const input = {
          monthFrom: String(entry.monthFrom ?? ""), monthTo: String(entry.monthTo ?? ""), nopFrom: Number(entry.nopFrom), nopTo: Number(entry.nopTo), amount: Number(entry.amountCollected),
          orDate: String(entry.orDate ?? ""), orNumber: String(entry.orNumber ?? "").trim(), waiver: String(entry.ifSuspended ?? ""),
          collectedByRole: collectedBy, originalMas,
        };
        const backdateReason = String(entry.backdateReason ?? "").trim().slice(0, 300);
        checkBackdate(input.orDate, backdateReason, `Collection for ${account.memberNumber}`);
        const dateProblem = blockingDateProblem({ receiptDate: input.orDate, dateRemitted, today: manilaNow().date });
        if (dateProblem) throw new Error(`Collection for ${account.memberNumber}: ${dateProblem}`);
        const receipt = entryKey(input.orNumber);
        const recorded = recordedReceipts.get(receipt);
        if (recorded) throw new Error(`OR Number ${input.orNumber} is already recorded (collection ${recorded.collectionId}${recorded.memberNumber ? ` for member ${recorded.memberNumber}` : ""}). Each OR Number is used once.`);
        if (receipt && batchReceipts.has(receipt)) throw new Error(`OR Number ${input.orNumber} is entered twice in this batch (${batchReceipts.get(receipt)} and ${account.memberNumber}). Each OR Number is used once.`);
        if (receipt) batchReceipts.set(receipt, account.memberNumber);
        validatePayment(account, payments, input);
        const quote = calculateRemittance(account.basePay, tiersForBranch(data.incentives.filter((tier) => tier.programId === account.programId), selectedBranch.id), incentiveRoleFor(collectedBy), input.nopFrom, input.nopTo, input.amount, account.flexible, account.maxMonthlyPayment);
        // Client totals are only a preview. Persist the authoritative server calculation.
        grossCents += Math.round(quote.gross * 100);
        const id = createReadableId("COL");
        const payment: AccountPayment = { ...input, id, enrollmentId: account.id, dateRemitted, mas };
        payments.push(payment);
        touched.set(account.id, account);
        // Penalty and Fidelity belong to the batch and are stored on its first row. forfeited_incentive is set at
        // remittance; backdate_reason when the OR date is more than a day old; date_remitted is the batch's Date Remitted,
        // so the dates can be checked against each other later.
        const first = !rows.length;
        rows.push({
          collection_id: id, collection_batch_id: batchId, enrollment_id: account.id, member_id: account.memberId, member_number: account.memberNumber, program_id: account.programId,
          branch, mas, or_number: input.orNumber, or_date: input.orDate, amount_collected: input.amount, month_from: input.monthFrom, month_to: input.monthTo,
          nop_from: input.nopFrom, nop_to: input.nopTo, reactivation: entry.reactivation === "Yes", transferred: entry.transferred === "Yes",
          suspended: input.waiver || null, original_mas: input.originalMas || null, status: "Posted", created_at: timestamp,
          collected_by_role: input.collectedByRole, remittance_amount: quote.remittance, remittance_breakdown: quote.breakdown, remittance_status: "Outstanding",
          accountable_employee_id: accountableEmployeeId, accountable_name: mas, accountable_role: "MAS", remittance_method: paymentMethod.name, payment_reference: paymentReference || null,
          penalty_amount: first && penalty > 0 ? penalty : null, penalty_note: first && penalty > 0 ? penaltyNote : null, fidelity_amount: first && fidelity > 0 ? fidelity : null,
          backdate_reason: backdateReason || null, date_remitted: dateRemitted,
        });
      }
      writing = true;
      await commitCollections(tx, rows, [...touched.values()], payments);
      return { ids: rows.map((row) => row.collection_id), grossCents };
    });
    return Response.json({ success: true, collectionIds: saved.ids, grossCollection: saved.grossCents / 100, message: `${saved.ids.length} collection(s) saved${penalty > 0 ? ` with a ${penalty.toLocaleString("en-PH", { style: "currency", currency: "PHP" })} penalty` : ""}. The cash remains outstanding until an approved remittance covers it.` }, { status: 201 });
  } catch (error) {
    // Another save used the same OR Number at the same moment; the database's unique rule refused this one.
    if (isUniqueViolation(error, "collections_or_key_unique")) return Response.json({ success: false, message: "One of these OR Numbers was just recorded by another save. Each OR Number is used once; check the receipts and try again." }, { status: 409 });
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save collections." }, { status: writing ? 500 : 400 });
  }
}
