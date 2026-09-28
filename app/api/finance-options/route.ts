import { withEncoder } from "@/lib/encoder-context";
import { canUseFinance } from "@/lib/finance-access";
import { getCashAccounts, saveCashAccount } from "@/lib/finance-operations";
import { getBranches } from "@/lib/google-sheets-data";

export async function GET() {
  if (!(await canUseFinance())) return Response.json({ success: false, message: "Finance access is required." }, { status: 403 });
  try { return Response.json({ success: true, branches: (await getBranches()).filter((branch) => branch.status === "active"), accounts: await getCashAccounts() }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load finance settings." }, { status: 500 }); }
}
export const POST = withEncoder(async (request: Request) => {
  if (!(await canUseFinance())) return Response.json({ success: false, message: "Finance access is required." }, { status: 403 });
  try { return Response.json({ success: true, account: await saveCashAccount(await request.json()) }, { status: 201 }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save cash account." }, { status: 400 }); }
});
