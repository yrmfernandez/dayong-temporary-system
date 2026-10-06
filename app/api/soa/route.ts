import { canManageConfigurationFor } from "@/lib/access-control";
import { userWithPageAccess } from "@/lib/auth-server";
import { getStatementOfAccount, listStatementAccounts, setCollectionHead } from "@/lib/statement-of-account";

// Statement of Account: without an account, the list to choose from; with one, its statement.
// The signed-in user is the "Prepared by" on the printed statement.
export async function GET(request: Request) {
  const user = await userWithPageAccess("/soa");
  if (!user) return Response.json({ success: false, message: "You do not have access to Statements of Account." }, { status: 403 });
  try {
    const enrollmentId = new URL(request.url).searchParams.get("account")?.trim() ?? "";
    if (!enrollmentId) return Response.json({ success: true, accounts: await listStatementAccounts() }, { headers: { "Cache-Control": "private, no-store" } });
    const statement = await getStatementOfAccount(enrollmentId);
    return Response.json({ success: true, statement: { ...statement, signatories: { ...statement.signatories, preparedBy: user.name } }, canSetSignatories: canManageConfigurationFor(user) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to prepare the Statement of Account." }, { status: 400 });
  }
}

// Sets the Collection Department Head printed on every SOA (administrators and IT only).
export async function PATCH(request: Request) {
  const user = await userWithPageAccess("/soa");
  if (!user || !canManageConfigurationFor(user)) return Response.json({ success: false, message: "You are not allowed to change the SOA signatories." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    return Response.json({ success: true, collectionHead: await setCollectionHead(body?.collectionHead, user.name) });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save the Collection Department Head." }, { status: 400 });
  }
}
