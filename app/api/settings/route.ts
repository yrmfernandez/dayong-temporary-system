import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth-server";
import { GOOGLE_SHEET_ID, readingFresh, sheets } from "@/lib/google-sheets";
import { loadUsers, userCell } from "@/lib/users-sheet";

const blockedPasswords = new Set(["password", "password123", "12345678", "qwerty123", "admin123", "dayong123"]);

export async function PATCH(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ success: false, message: "Please sign in." }, { status: 401 });
  try {
    const body = await request.json();
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    // The current password is checked against the live hash, never a cached copy.
    const { columns, users } = await readingFresh(loadUsers);
    // Employee ID remains stable when readable user IDs are migrated. This
    // fallback also repairs password changes from sessions issued before migration.
    const user = users.find((row) => row.id === session.userId)
      ?? users.find((row) => row.employeeId.toUpperCase() === session.employeeId.toUpperCase());
    if (!user) throw new Error("User account not found.");
    if (!user.passwordHash) throw new Error("This account has no password configured. Ask an administrator to reset it.");
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) return NextResponse.json({ success: false, message: "Current password is incorrect." }, { status: 400 });
    if (!newPassword) throw new Error("Enter a new password.");
    if (newPassword.length < 12 || blockedPasswords.has(newPassword.toLowerCase())) throw new Error("Use a password of at least 12 characters that is not commonly used.");
    if (await bcrypt.compare(newPassword, user.passwordHash)) throw new Error("Your new password must be different from your current password.");
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: userCell(columns.passwordHash, user.rowNumber), valueInputOption: "RAW", requestBody: { values: [[passwordHash]] } });
    return NextResponse.json({ success: true, passwordChanged: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to update account." }, { status: 400 });
  }
}
