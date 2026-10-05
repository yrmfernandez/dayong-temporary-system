import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { desc, eq } from "drizzle-orm";

import { currentDb, inTransaction, schema } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { createReadableId } from "@/lib/readable-id";

/**
 * Moves one program enrollment to another employee in the same branch. From then on its collections belong to the new
 * MAS (Collections require the enrollment's own Branch and MAS); past collections and cash already owed stay with the
 * previous MAS. The enrollment's MAS changes and member_transfers keeps the history with the reason, in one transaction.
 */
const text = (value: unknown) => String(value ?? "").trim();

// Administrators and HR Officers may move a member's program enrollment to another employee in the same branch.
export async function canTransferMembers() {
  const user = await getSessionUser();
  if (!user) return false;
  return (await canManageUsers()) || (user.roleNames ?? []).some((role) => ["hr officer", "hr"].includes(role.trim().toLowerCase()));
}

async function enrollmentRow(enrollmentId: string) {
  const [row] = await currentDb().select().from(schema.member_programs).where(eq(schema.member_programs.enrollment_id, enrollmentId));
  if (!row) throw new Error("Program enrollment not found.");
  return { memberId: row.member_id, memberNumber: text(row.member_number), programId: row.program_id, branch: text(row.branch), mas: text(row.mas), status: text(row.status) };
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
  const id = createReadableId("MTR");
  const actor = getEncoder();
  await inTransaction(async (tx) => {
    await tx.update(schema.member_programs).set({ mas: target.name }).where(eq(schema.member_programs.enrollment_id, enrollmentId));
    await tx.insert(schema.member_transfers).values({
      transfer_id: id, enrollment_id: enrollmentId, member_id: enrollment.memberId, member_number: enrollment.memberNumber, program_id: enrollment.programId,
      branch: enrollment.branch, from_mas: enrollment.mas, to_mas: target.name, to_employee_id: target.employeeId, reason,
      encoded_by_user_id: actor.userId, encoded_by_employee_id: actor.employeeId, encoded_by_name: actor.name, encoded_at: actor.encodedAt,
    });
  });
  return { id, enrollmentId, fromMas: enrollment.mas, toMas: target.name };
}

/** Transfer history per enrollment, newest first, for the member details view. */
export async function getTransferHistory() {
  const transfers = schema.member_transfers;
  const rows = await currentDb().select().from(transfers).orderBy(desc(transfers.encoded_at));
  return rows.map((row) => ({ enrollmentId: text(row.enrollment_id), fromMas: text(row.from_mas), toMas: text(row.to_mas), reason: text(row.reason), by: text(row.encoded_by_name), at: row.encoded_at ?? "" }));
}
