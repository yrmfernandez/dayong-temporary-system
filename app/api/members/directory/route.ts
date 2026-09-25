import { getSessionUser } from "@/lib/auth-server";
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
    return Response.json({ success: true, members, statusWarning }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Member directory error:", error);
    return Response.json({ success: false, message: "Unable to load members. Please retry or check the member records." }, { status: 500 });
  }
}
