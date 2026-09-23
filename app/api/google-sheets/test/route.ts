import { NextResponse } from "next/server";

import {
  GOOGLE_SHEET_ID,
  sheets,
} from "@/lib/google-sheets";

export async function GET() {
  try {
    const response = await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      fields: "properties.title,sheets.properties",
    });

    const title =
      response.data.properties?.title ?? "Unknown";

    const sheetNames =
      response.data.sheets
        ?.map((sheet) => sheet.properties?.title)
        .filter(Boolean) ?? [];

    return NextResponse.json({
      success: true,
      message: "Google Sheets connection successful.",
      spreadsheet: title,
      sheets: sheetNames,
    });
  } catch (error: unknown) {
    console.error(
      "Google Sheets connection error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unknown Google Sheets error.";

    return NextResponse.json(
      {
        success: false,
        message,
        error: error,
      },
      { status: 500 },
    );
  }
}