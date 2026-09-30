import { createReadableId } from "@/lib/readable-id";
import { withEncoder } from "@/lib/encoder-context";
import { userWithPageAccess } from "@/lib/auth-server";
import { withWriteLock } from "@/lib/google-sheets";
import { loadAccountData, commitCollections } from "@/lib/account-data";
import { accountState, COLLECTION_CHANNELS, incentiveRoleFor, validatePayment, validDate, type AccountPayment } from "@/lib/account-rules";
import { findActivePaymentMethod } from "@/lib/remittance-methods";
import { calculateRemittance } from "@/lib/remittance";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { createCashRemittance } from "@/lib/remittance-workflow";
import { FIDELITY_CAP, getFidelityData } from "@/lib/fidelity";
import { entryKey, recordedOrNumbers } from "@/lib/duplicate-entries";

export async function GET(request: Request) {
  if (!(await userWithPageAccess("/collections"))) return Response.json({ success: false, message: "You do not have access to Collections." }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    const data = await loadAccountData();
    const matches = data.accounts.filter((a) => a.memberId === searchParams.get("memberId") && a.programId === searchParams.get("programId") && a.branch === searchParams.get("branch") && a.mas === searchParams.get("mas"));
    if (matches.length !== 1) return Response.json({ success: false, message: "A unique program enrollment was not found." }, { status: 404 });
    const account = matches[0];
    const history = data.payments.filter((p) => p.enrollmentId === account.id).sort((a, b) => b.nopTo - a.nopTo);
    return Response.json({ success: true, account: { ...account, ...accountState(account, history) }, history: history.map((p) => ({ ...p, memberId: account.memberId, programId: account.programId, monthOf: p.monthTo, nop: p.nopTo, amountCollected: p.amount })) });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load account." }, { status: 500 }); }
}

export const POST = withEncoder(async (request: Request) => {
  if (!(await userWithPageAccess("/collections"))) return Response.json({ success: false, message: "You do not have access to Collections." }, { status: 403 });
  // One collection batch at a time per server: validation reads the latest payments, so a concurrent batch for the
  // same account cannot slip in between that check and the write.
  return withWriteLock("collections", () => saveCollections(request));
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
    const cashReceived = Number(body.cashReceived);
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
    // MAS Fidelity set aside from this batch's incentives: it lowers the MAS's incentive and is added to the remittance.
    const fidelity = Math.round((Number(body.fidelityAmount) || 0) * 100) / 100;
    if (!Number.isFinite(fidelity) || fidelity < 0) throw new Error("Fidelity must be zero or a positive amount.");
    if (fidelity > 0 && collectedBy === "Collector") throw new Error("Fidelity comes from the MAS incentive; a Collector batch has none.");
    if (autoApproveRemittance) {
      // Same rule as Remittances: anyone who can encode may confirm full physical cash; other methods are verified there.
      if (!paymentMethod.isCash) throw new Error(`${paymentMethod.name} payments are verified in Remittances before approval.`);
      if (!Number.isFinite(cashReceived) || cashReceived < 0) throw new Error("Enter the complete cash amount received.");
    }
    const [data, recordedReceipts] = await Promise.all([loadAccountData(), recordedOrNumbers()]);
    const payments = [...data.payments];
    // Each OR Number is one receipt for one entry: reusing one, here or in an earlier batch, is a double entry.
    const batchReceipts = new Map<string, string>();
    const touched = new Map<string, typeof data.accounts[number]>();
    const rows: (string | number)[][] = [];
    const timestamp = new Date().toISOString();
    const batchId = createReadableId("CBT");
    let grossCents = 0;
    for (const entry of body.collections) {
      const matches = data.accounts.filter((a) => a.memberNumber === String(entry.memberNumber ?? "").trim() && a.programId === entry.programId);
      if (matches.length !== 1) throw new Error("A unique program enrollment was not found.");
      const account = matches[0];
      if (account.branch !== branch || account.mas !== mas) throw new Error(`Collection for ${account.memberNumber} must use its assigned Branch and MAS.`);
      const input = {
        monthFrom: String(entry.monthFrom ?? ""), monthTo: String(entry.monthTo ?? ""), nopFrom: Number(entry.nopFrom), nopTo: Number(entry.nopTo), amount: Number(entry.amountCollected),
        orDate: String(entry.orDate ?? ""), orNumber: String(entry.orNumber ?? "").trim(), waiver: String(entry.ifSuspended ?? ""),
        collectedByRole: collectedBy, originalMas,
      };
      const receipt = entryKey(input.orNumber);
      const recorded = recordedReceipts.get(receipt);
      if (recorded) throw new Error(`OR Number ${input.orNumber} is already recorded (collection ${recorded.collectionId}${recorded.memberNumber ? ` for member ${recorded.memberNumber}` : ""}). Each OR Number is used once.`);
      if (receipt && batchReceipts.has(receipt)) throw new Error(`OR Number ${input.orNumber} is entered twice in this batch (${batchReceipts.get(receipt)} and ${account.memberNumber}). Each OR Number is used once.`);
      if (receipt) batchReceipts.set(receipt, account.memberNumber);
      validatePayment(account, payments, input);
      const quote = calculateRemittance(account.basePay, data.incentives.filter((tier) => tier.programId === account.programId), incentiveRoleFor(collectedBy), input.nopFrom, input.nopTo, input.amount);
      // Client totals are only a preview. Persist the authoritative server calculation.
      grossCents += Math.round(quote.gross * 100);
      const id = createReadableId("COL");
      const payment: AccountPayment = { ...input, id, enrollmentId: account.id, dateRemitted, mas };
      payments.push(payment);
      touched.set(account.id, account);
      rows.push([id, batchId, account.id, account.memberId, account.memberNumber, account.programId, branch, mas,
        input.orNumber, input.orDate, input.amount, input.monthFrom, input.monthTo, input.nopFrom, input.nopTo,
        entry.reactivation === "Yes" ? "Yes" : "No", entry.transferred === "Yes" ? "Yes" : "No", input.waiver, input.originalMas, "Posted", timestamp,
        input.collectedByRole, quote.remittance, JSON.stringify(quote.breakdown), "Outstanding", "", accountableEmployeeId, mas, "MAS", paymentMethod.name, paymentReference,
        !rows.length && penalty > 0 ? penalty : "", !rows.length && penalty > 0 ? penaltyNote : "", !rows.length && fidelity > 0 ? fidelity : ""]);
    }
    if (fidelity > 0) {
      const incentives = rows.reduce((sum, row) => sum + Math.round((Number(row[10]) - Number(row[22])) * 100), 0) / 100;
      if (fidelity > incentives) throw new Error(`Fidelity cannot exceed the batch's total incentives of ${incentives.toLocaleString("en-PH", { style: "currency", currency: "PHP" })}.`);
      const account = (await getFidelityData(accountableEmployeeId, true)).accounts.find((item) => item.masEmployeeId === accountableEmployeeId);
      const remaining = Math.max(0, Math.round((FIDELITY_CAP - (account?.approved ?? 0) - (account?.pending ?? 0)) * 100) / 100);
      if (fidelity > remaining) throw new Error(`Fidelity can be at most ${remaining.toLocaleString("en-PH", { style: "currency", currency: "PHP" })} for this MAS (the ${FIDELITY_CAP.toLocaleString("en-PH", { style: "currency", currency: "PHP" })} limit).`);
    }
    // Penalty and Fidelity are tracked separately and are not part of the remittance.
    const expectedRemittance = rows.reduce((sum, row) => sum + Math.round(Number(row[22]) * 100), 0) / 100;
    if (autoApproveRemittance && Math.round(cashReceived * 100) !== Math.round(expectedRemittance * 100)) {
      throw new Error(`Cash received must equal the calculated remittance of ${expectedRemittance.toLocaleString("en-PH", { style: "currency", currency: "PHP" })}.`);
    }
    writing = true;
    await commitCollections(rows, [...touched.values()], payments);
    if (autoApproveRemittance) {
      const remittance = await createCashRemittance({ collectionIds: rows.map((row) => String(row[0])), actualAmount: cashReceived, fidelityAmount: 0, remittanceDate: dateRemitted, remarks: "Cash received in full during collection encoding.", cashConfirmed: true });
      return Response.json({ success: true, collectionIds: rows.map((row) => String(row[0])), grossCollection: grossCents / 100, remittanceId: remittance.id, message: `${rows.length} collection(s) saved and Remittance ${remittance.id} approved.` }, { status: 201 });
    }
    return Response.json({ success: true, collectionIds: rows.map((row) => String(row[0])), grossCollection: grossCents / 100, message: `${rows.length} collection(s) saved${penalty > 0 ? ` with a ${penalty.toLocaleString("en-PH", { style: "currency", currency: "PHP" })} penalty` : ""}. The cash remains outstanding until an approved remittance covers it.` }, { status: 201 });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save collections." }, { status: writing ? 500 : 400 }); }
}
