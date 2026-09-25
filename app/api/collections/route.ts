import { withEncoder } from "@/lib/encoder-context";
import { getSessionUser } from "@/lib/auth-server";
import { loadAccountData, commitCollections } from "@/lib/account-data";
import { accountState, validatePayment, validDate, type AccountPayment } from "@/lib/account-rules";
import { calculateRemittance } from "@/lib/remittance";
import { getEmployees } from "@/lib/employees";
import { getActiveMasStaff } from "@/lib/google-sheets-data";

export async function GET(request: Request) {
  if (!(await getSessionUser())) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const data = await loadAccountData();
    const matches = data.accounts.filter((a) => a.memberId === searchParams.get("memberId") && a.programId === searchParams.get("programId"));
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
    if (!branch || !mas || !accountableEmployeeId || !validDate(dateRemitted) || !Array.isArray(body.collections) || !body.collections.length) throw new Error("Branch, accountable Collector/MAS, Date Remitted, and collections are required.");
    const employees = await getEmployees();
    const accountable = employees.find((employee) => employee.id === accountableEmployeeId && employee.name === mas && employee.status.toLowerCase() === "active");
    const selectableLegacyMas = accountable ? false : (await getActiveMasStaff()).some((employee) => employee.employeeId === accountableEmployeeId && employee.fullName === mas);
    if (!accountable && !selectableLegacyMas) throw new Error("Select an active accountable Collector/MAS from the list.");
    const data = await loadAccountData();
    const payments = [...data.payments];
    const touched = new Map<string, typeof data.accounts[number]>();
    const rows: (string | number)[][] = [];
    const timestamp = new Date().toISOString();
    let grossCents = 0;
    for (const entry of body.collections) {
      const matches = data.accounts.filter((a) => a.memberNumber === String(entry.memberNumber ?? "").trim() && a.programId === entry.programId);
      if (matches.length !== 1) throw new Error("A unique program enrollment was not found.");
      const account = matches[0];
      if (account.branch !== branch) throw new Error(`Collection for ${account.memberNumber} must use its assigned Branch.`);
      const input = {
        monthFrom: String(entry.monthFrom ?? ""), monthTo: String(entry.monthTo ?? ""), nopFrom: Number(entry.nopFrom), nopTo: Number(entry.nopTo), amount: Number(entry.amountCollected),
        orDate: String(entry.orDate ?? ""), orNumber: String(entry.orNumber ?? "").trim(), waiver: String(entry.ifSuspended ?? ""),
        collectedByRole: String(entry.collectedByRole ?? ""), originalMas: String(entry.originalMasOfficerName ?? "").trim(),
      };
      if (accountable && !accountable.roles.includes(input.collectedByRole)) throw new Error(`${mas} is not registered with the ${input.collectedByRole} operational role.`);
      if (!accountable && input.collectedByRole !== "MAS") throw new Error("Legacy staff records can only be used as MAS until their Employees record is reviewed.");
      if (input.collectedByRole === "MAS" && account.mas !== mas) throw new Error(`Collection for ${account.memberNumber} must use its assigned MAS.`);
      validatePayment(account, payments, input);
      const quote = calculateRemittance(account.basePay, data.incentives.filter((tier) => tier.programId === account.programId), input.collectedByRole, input.nopFrom, input.nopTo);
      // Client totals are only a preview. Persist the authoritative server calculation.
      grossCents += Math.round(quote.gross * 100);
      const id = `COL-${crypto.randomUUID()}`;
      const payment: AccountPayment = { ...input, id, enrollmentId: account.id, dateRemitted, mas };
      payments.push(payment);
      touched.set(account.id, account);
      rows.push([id, "", account.id, account.memberId, account.memberNumber, account.programId, branch, mas,
        input.orNumber, input.orDate, input.amount, input.monthFrom, input.monthTo, input.nopFrom, input.nopTo,
        entry.reactivation === "Yes" ? "Yes" : "No", entry.transferred === "Yes" ? "Yes" : "No", input.waiver, input.originalMas, "Posted", timestamp,
        input.collectedByRole, quote.remittance, JSON.stringify(quote.breakdown), "Outstanding", "", accountableEmployeeId, mas, input.collectedByRole]);
    }
    writing = true;
    await commitCollections(rows, [...touched.values()], payments);
    return Response.json({ success: true, grossCollection: grossCents / 100, message: `${rows.length} collection(s) saved. The cash remains outstanding until an approved remittance covers it.` }, { status: 201 });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save collections." }, { status: writing ? 500 : 400 }); }
});
