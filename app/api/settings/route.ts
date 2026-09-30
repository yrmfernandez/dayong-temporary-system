import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth-server";
import { GOOGLE_SHEET_ID, readingFresh, sheets } from "@/lib/google-sheets";
import { createSessionToken, serializeSessionCookie, sessionMaxAge } from "@/lib/auth";
import { isWeakPassword, MIN_PASSWORD_LENGTH } from "@/lib/default-password";
import { checkPassword, hashPassword } from "@/lib/passwords";
import { passwordStamp } from "@/lib/session-account";
import { loadUsers, userCell } from "@/lib/users-sheet";

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
    if (!(await checkPassword(currentPassword, user.passwordHash)).matches) return NextResponse.json({ success: false, message: "Current password is incorrect." }, { status: 400 });
    if (!newPassword) throw new Error("Enter a new password.");
    if (isWeakPassword(newPassword)) throw new Error(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters that is not commonly used or the default password.`);
    if ((await checkPassword(newPassword, user.passwordHash)).matches) throw new Error("Your new password must be different from your current password.");
    const passwordHash = await hashPassword(newPassword);
    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: userCell(columns.passwordHash, user.rowNumber), valueInputOption: "RAW", requestBody: { values: [[passwordHash]] } });
    // Sessions carry a fingerprint of the password, so other devices signed in with the old one are signed out on
    // their next recheck; this device receives a session for the new password and leaves the change-password lock.
    const token = await createSessionToken({ ...session, mustChangePassword: false, passwordStamp: passwordStamp(passwordHash), checkedAt: Date.now() });
    const response = NextResponse.json({ success: true, passwordChanged: true });
    response.headers.append("Set-Cookie", serializeSessionCookie(token, sessionMaxAge(session)));
    return response;
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to update account." }, { status: 400 });
  }
}
