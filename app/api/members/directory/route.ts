import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { deleteMemberRecord, updateMemberRecord } from "@/lib/master-data-crud";
import { sheets, GOOGLE_SHEET_ID } from "@/lib/google-sheets";
import { buildMemberDirectory } from "@/lib/member-directory";
import { accountReport } from "@/lib/account-data";

export async function GET() {
  if (!(await getSessionUser())) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  try {
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: GOOGLE_SHEET_ID,
      ranges: ["'Members'!A:AD", "'Member programs'!A:M", "'Programs'!A:F"],
      valueRenderOption: "FORMATTED_VALUE",
    });
    const tables = response.data.valueRanges ?? [];
    const members = buildMemberDirectory(...[0, 1, 2].map((index) => (tables[index]?.values ?? []).slice(1)) as [unknown[][], unknown[][], unknown[][]]);
    let statusWarning = "";
    try {
      const report = await accountReport();
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
    return Response.json({ success: true, members, statusWarning, canManage: await canManageUsers() }, { headers: { "Cache-Control": "private, no-store" } });
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
