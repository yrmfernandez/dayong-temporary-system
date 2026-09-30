import { NextResponse } from "next/server";

import { canManageAccounts } from "@/lib/auth-server";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";

// Connection check for administrators and IT. API routes skip the sign-in proxy, so this must check access itself.
export async function GET() {
  if (!(await canManageAccounts())) return NextResponse.json({ success: false, message: "Administrator or IT access is required." }, { status: 403 });
  try {
    const response = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "properties.title,sheets.properties" });
    return NextResponse.json({
      success: true,
      message: "Google Sheets connection successful.",
      spreadsheet: response.data.properties?.title ?? "Unknown",
      sheets: response.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean) ?? [],
    });
  } catch (error: unknown) {
    console.error("Google Sheets connection error:", error);
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unknown Google Sheets error." }, { status: 500 });
  }
}
