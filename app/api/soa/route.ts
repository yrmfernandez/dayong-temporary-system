import { userWithPageAccess } from "@/lib/auth-server";
import { getStatementOfAccount, listStatementAccounts } from "@/lib/statement-of-account";

// Statement of Account: without an account, the list to choose from; with one, its statement.
export async function GET(request: Request) {
  if (!(await userWithPageAccess("/soa"))) return Response.json({ success: false, message: "You do not have access to Statements of Account." }, { status: 403 });
  try {
    const enrollmentId = new URL(request.url).searchParams.get("account")?.trim() ?? "";
    if (!enrollmentId) return Response.json({ success: true, accounts: await listStatementAccounts() }, { headers: { "Cache-Control": "private, no-store" } });
    return Response.json({ success: true, statement: await getStatementOfAccount(enrollmentId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to prepare the Statement of Account." }, { status: 400 });
  }
}
