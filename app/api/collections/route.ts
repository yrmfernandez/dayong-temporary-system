import { createReadableId } from "@/lib/readable-id";
import { withEncoder } from "@/lib/encoder-context";
import { getSessionUser } from "@/lib/auth-server";
import { loadAccountData, commitCollections } from "@/lib/account-data";
import { accountState, COLLECTION_CHANNELS, incentiveRoleFor, validatePayment, validDate, type AccountPayment } from "@/lib/account-rules";
import { findActivePaymentMethod } from "@/lib/payment-methods";
import { calculateRemittance } from "@/lib/remittance";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { createCashRemittance } from "@/lib/remittance-workflow";

export async function GET(request: Request) {
  if (!(await getSessionUser())) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
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
    const originalMas = String(body.originalMasOfficerName ?? "").trim();
    const paymentMethod = await findActivePaymentMethod(String(body.paymentMethod ?? ""));
    const paymentReference = String(body.paymentReference ?? "").trim();
    if (paymentMethod.requiresReference && !paymentReference) throw new Error(`Enter the ${paymentMethod.name} reference number.`);
    if (paymentReference.length > 100) throw new Error("The payment reference must be 100 characters or fewer.");
    if (autoApproveRemittance) {
      // Same rule as Remittances: anyone who can encode may confirm full physical cash; other methods are verified there.
      if (!paymentMethod.isCash) throw new Error(`${paymentMethod.name} payments are verified in Remittances before approval.`);
      if (!Number.isFinite(cashReceived) || cashReceived < 0) throw new Error("Enter the complete cash amount received.");
    }
    const data = await loadAccountData();
    const payments = [...data.payments];
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
        input.collectedByRole, quote.remittance, JSON.stringify(quote.breakdown), "Outstanding", "", accountableEmployeeId, mas, "MAS", paymentMethod.name, paymentReference]);
    }
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
    return Response.json({ success: true, collectionIds: rows.map((row) => String(row[0])), grossCollection: grossCents / 100, message: `${rows.length} collection(s) saved. The cash remains outstanding until an approved remittance covers it.` }, { status: 201 });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save collections." }, { status: writing ? 500 : 400 }); }
});
