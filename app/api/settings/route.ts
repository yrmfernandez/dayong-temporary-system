import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { createSessionToken } from "@/lib/auth";
import { getSessionUser } from "@/lib/auth-server";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";

const blockedPasswords = new Set(["password", "password123", "12345678", "qwerty123", "admin123", "dayong123"]);

export async function PATCH(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ success: false, message: "Please sign in." }, { status: 401 });
  try {
    const body = await request.json();
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : session.username;
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Users!A:H" });
    const rows = response.data.values ?? [];
    const index = rows.slice(1).findIndex((row) => String(row[0] ?? "").trim() === session.userId);
    if (index < 0) throw new Error("User account not found.");
    const row = rows[index + 1];
    if (!(await bcrypt.compare(currentPassword, String(row[4] ?? "")))) return NextResponse.json({ success: false, message: "Current password is incorrect." }, { status: 400 });
    if (!/^[a-z0-9._-]{3,50}$/.test(username)) throw new Error("Username must be 3–50 characters using letters, numbers, periods, underscores, or hyphens.");
    if (rows.slice(1).some((other, otherIndex) => otherIndex !== index && String(other[2] ?? "").trim().toLowerCase() === username)) throw new Error("This username is already in use.");
    if (newPassword && (newPassword.length < 12 || blockedPasswords.has(newPassword.toLowerCase()))) throw new Error("Use a password of at least 12 characters that is not commonly used.");
    const passwordHash = newPassword ? await bcrypt.hash(newPassword, 12) : String(row[4] ?? "");
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "RAW", data: [
      { range: `Users!C${index + 2}`, values: [[username]] },
      { range: `Users!E${index + 2}`, values: [[passwordHash]] },
    ] } });
    const token = await createSessionToken({ ...session, username });
    const result = NextResponse.json({ success: true, username, passwordChanged: Boolean(newPassword) });
    result.cookies.set("dayong_session", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
    return result;
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to update account." }, { status: 400 });
  }
}
