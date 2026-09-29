import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { appendEncodedRows } from "@/lib/encoder-sheets";
import { getEmployees } from "@/lib/employees";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { getBranches } from "@/lib/google-sheets-data";
import { createReadableId } from "@/lib/readable-id";

/**
 * Moves one program enrollment to another employee in the same branch. From then on its collections belong to the new
 * MAS (Collections require the enrollment's own Branch and MAS); past collections and cash already owed stay with the
 * previous MAS. Member programs G (mas) changes, and "Member Transfers" keeps the history with the reason.
 */
const text = (value: unknown) => String(value ?? "").trim();

// Administrators and HR Officers may move a member's program enrollment to another employee in the same branch.
export async function canTransferMembers() {
  const user = await getSessionUser();
  if (!user) return false;
  return (await canManageUsers()) || (user.roleNames ?? []).some((role) => ["hr officer", "hr"].includes(role.trim().toLowerCase()));
}

async function enrollmentRow(enrollmentId: string) {
  const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "'Member programs'!A:N" })).data.values ?? [];
  const index = rows.slice(1).findIndex((row) => text(row[0]) === enrollmentId);
  if (index < 0) throw new Error("Program enrollment not found.");
  const row = rows[index + 1];
  return { rowNumber: index + 2, memberId: text(row[1]), memberNumber: text(row[2]), programId: text(row[3]), branch: text(row[5]), mas: text(row[6]), status: text(row[12]) };
}

/** Active employees assigned to the enrollment's branch, other than its current MAS. */
export async function transferCandidates(enrollmentId: string) {
  const [enrollment, employees, branches] = await Promise.all([enrollmentRow(enrollmentId), getEmployees(), getBranches()]);
  const branch = branches.find((item) => item.name === enrollment.branch);
  const candidates = employees
    .filter((employee) => employee.status.toLowerCase() === "active" && branch && employee.branchIds.includes(branch.id) && employee.name !== enrollment.mas)
    .map((employee) => ({ employeeId: employee.id, name: employee.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { enrollment, candidates };
}

export async function transferEnrollment(input: { enrollmentId: string; toEmployeeId: string; reason: string }) {
  const enrollmentId = text(input.enrollmentId), toEmployeeId = text(input.toEmployeeId), reason = text(input.reason);
  if (reason.length < 3 || reason.length > 300) throw new Error("Give the reason for the transfer (3–300 characters).");
  const { enrollment, candidates } = await transferCandidates(enrollmentId);
  const target = candidates.find((candidate) => candidate.employeeId === toEmployeeId);
  if (!target) throw new Error(`Choose an active employee assigned to ${enrollment.branch || "the enrollment's branch"} (not the current MAS).`);
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'Member programs'!G${enrollment.rowNumber}`, valueInputOption: "RAW", requestBody: { values: [[target.name]] } });
  const id = createReadableId("MTR");
  await appendEncodedRows({ range: "'Member Transfers'!A:J", valueInputOption: "RAW", requestBody: { values: [[id, enrollmentId, enrollment.memberId, enrollment.memberNumber, enrollment.programId, enrollment.branch, enrollment.mas, target.name, target.employeeId, reason]] } });
  return { id, enrollmentId, fromMas: enrollment.mas, toMas: target.name };
}

/** Transfer history per enrollment, newest first, for the member details view. */
export async function getTransferHistory() {
  try {
    const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "'Member Transfers'!A:N" })).data.values ?? [];
    return rows.slice(1).filter((row) => text(row[0])).map((row) => ({ enrollmentId: text(row[1]), fromMas: text(row[6]), toMas: text(row[7]), reason: text(row[9]), by: text(row[12]).replace(/^'/, ""), at: text(row[13]) }))
      .sort((a, b) => b.at.localeCompare(a.at));
  } catch { return []; }
}
