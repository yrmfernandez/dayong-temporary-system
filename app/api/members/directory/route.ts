import { canAccessPath } from "@/lib/access-control";
import { isOwnAccount, ownMembersScope } from "@/lib/member-scope";
import { canManageUsers, userWithPageAccess } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { deleteMemberRecord, updateMemberRecord } from "@/lib/master-data-crud";
import { loadMemberDirectory } from "@/lib/member-directory-data";
import { accountReport } from "@/lib/account-data";
import { canTransferMembers, getTransferHistory } from "@/lib/member-transfer";

export async function GET() {
  const user = await userWithPageAccess("/members");
  if (!user) return Response.json({ success: false, message: "You do not have access to Members." }, { status: 403 });
  try {
    // A MAS sees only members they handle, and only those programs; only those are loaded.
    const scope = await ownMembersScope(user);
    const everyone = await loadMemberDirectory(scope);
    const members = scope === null ? everyone : everyone
      .map((member) => ({ ...member, enrollments: member.enrollments.filter((enrollment) => isOwnAccount(enrollment.mas, scope)) }))
      .filter((member) => member.enrollments.length > 0);
    let statusWarning = "";
    try {
      const report = await accountReport(scope === null ? {} : { mas: scope });
      const accounts = new Map(report.rows.map((row) => [row.id, row]));
      for (const member of members) for (const enrollment of member.enrollments) {
        const account = accounts.get(enrollment.id);
        enrollment.accountStatus = account && "status" in account ? account.status : account?.error ? "Needs review" : "Not started";
        enrollment.temporarilySuspended = account && "temporarilySuspended" in account ? account.temporarilySuspended : false;
        enrollment.accountError = account?.error;
      }
    } catch {
      statusWarning = "Payment statuses could not be calculated. Check MAM or refresh to retry.";
      for (const member of members) for (const enrollment of member.enrollments) enrollment.accountStatus = "Needs review";
    }
    const [canTransfer, transfers] = await Promise.all([canTransferMembers(), getTransferHistory()]);
    return Response.json({ success: true, members, statusWarning, canManage: await canManageUsers(), canTransfer, transfers, canAddMember: canAccessPath(user, "/new-sales") }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Member directory error:", error);
    return Response.json({ success: false, message: "Unable to load members. Please retry or check the member records." }, { status: 500 });
  }
}

export const PATCH = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "You are not allowed to update members." }, { status: 403 });
  try { const body = await request.json(); const id = typeof body.id === "string" ? body.id.trim() : ""; return Response.json({ success: true, member: await updateMemberRecord(id, { contact: typeof body.contact === "string" ? body.contact : "", status: typeof body.status === "string" ? body.status : "" }) }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to update member." }, { status: 400 }); }
});

export const DELETE = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "You are not allowed to delete members." }, { status: 403 });
  try { const body = await request.json(); const id = typeof body.id === "string" ? body.id.trim() : ""; await deleteMemberRecord(id); return Response.json({ success: true }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to delete member." }, { status: 400 }); }
});
