import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { desc, eq, inArray, sql } from "drizzle-orm";

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

// ---------------------------------------------------------------- one employee's members, all at once

/** Rows of a raw query: postgres.js returns them as the result itself, PGlite (tests) under .rows. */
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];

export type EmployeeAccount = { enrollmentId: string; memberNumber: string; memberName: string; program: string; branch: string; status: string; accountStatus: string };

/**
 * Every account (enrollment) an employee is the MAS of, and the active employees they can go to, with their branches.
 * Accounts are matched by the employee link, or by name where the link is still empty.
 */
export async function employeeAccounts(employeeIdRaw: string) {
  const employeeId = text(employeeIdRaw);
  const [employees, branches] = await Promise.all([getEmployees(), getBranches()]);
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee) throw new Error("Employee not found.");
  const rows = rowsOf<{ enrollment_id: string; member_number: string; first_name: string; middle_name: string; surname: string; program: string; branch: string; status: string; account_status: string }>(await currentDb().execute(sql`
    select mp.enrollment_id, mp.member_number, m.first_name, m.middle_name, m.surname, coalesce(p.program_name, mp.program_id) as program, mp.branch, mp.status, mp.account_status
    from member_programs mp left join members m on m.member_id = mp.member_id left join programs p on p.program_id = mp.program_id
    where mp.mas_employee_id = ${employeeId} or (mp.mas_employee_id is null and lower(trim(mp.mas)) = lower(trim(${employee.name})))
    order by mp.branch, m.surname, m.first_name`));
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const accounts: EmployeeAccount[] = rows.map((row) => ({
    enrollmentId: row.enrollment_id, memberNumber: text(row.member_number), memberName: [row.first_name, row.middle_name, row.surname].map(text).filter(Boolean).join(" "),
    program: text(row.program), branch: text(row.branch), status: text(row.status), accountStatus: text(row.account_status),
  }));
  const candidates = employees
    .filter((item) => item.id !== employeeId && item.status.toLowerCase() === "active")
    .map((item) => ({ employeeId: item.id, name: item.name, roles: item.roles, branches: item.branchIds.map((id) => branchName.get(id) ?? "").filter(Boolean) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { employee: { id: employee.id, name: employee.name }, accounts, candidates };
}

/**
 * Moves several of one employee's accounts (or all of them) to another active employee, in one transaction, keeping a
 * transfer record for each like a single transfer. Collections need the account's MAS to be assigned to the account's
 * branch, so accounts in branches the new employee is not assigned to are left where they are and reported: assign the
 * branch in Employees first, then transfer them.
 */
export async function transferEmployeeAccounts(input: { fromEmployeeId: string; enrollmentIds: string[]; toEmployeeId: string; reason: string }) {
  const reason = text(input.reason), toEmployeeId = text(input.toEmployeeId);
  if (reason.length < 3 || reason.length > 300) throw new Error("Give the reason for the transfer (3–300 characters).");
  const wanted = new Set(input.enrollmentIds.map(text).filter(Boolean));
  if (!wanted.size) throw new Error("Choose the members to transfer.");
  const { employee, accounts, candidates } = await employeeAccounts(input.fromEmployeeId);
  const target = candidates.find((candidate) => candidate.employeeId === toEmployeeId);
  if (!target) throw new Error("Choose an active employee other than the current one.");
  const chosen = accounts.filter((account) => wanted.has(account.enrollmentId));
  if (chosen.length !== wanted.size) throw new Error("Some of the chosen accounts are no longer this employee's. Reload and try again.");
  const covered = new Set(target.branches.map((branch) => branch.toLowerCase()));
  const movable = chosen.filter((account) => covered.has(account.branch.toLowerCase()));
  const skipped = [...chosen.filter((account) => !covered.has(account.branch.toLowerCase())).reduce((byBranch, account) => byBranch.set(account.branch, (byBranch.get(account.branch) ?? 0) + 1), new Map<string, number>())]
    .map(([branch, count]) => ({ branch, count }));
  if (movable.length) {
    const actor = getEncoder();
    const ids = movable.map((account) => account.enrollmentId);
    await inTransaction(async (tx) => {
      const rows = await tx.select().from(schema.member_programs).where(inArray(schema.member_programs.enrollment_id, ids));
      await tx.update(schema.member_programs).set({ mas: target.name }).where(inArray(schema.member_programs.enrollment_id, ids));
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(schema.member_transfers).values(rows.slice(i, i + 500).map((row) => ({
          transfer_id: createReadableId("MTR"), enrollment_id: row.enrollment_id, member_id: row.member_id, member_number: text(row.member_number), program_id: row.program_id,
          branch: text(row.branch), from_mas: text(row.mas), to_mas: target.name, to_employee_id: target.employeeId, reason: `Transfer of ${employee.name}'s members: ${reason}`,
          encoded_by_user_id: actor.userId, encoded_by_employee_id: actor.employeeId, encoded_by_name: actor.name, encoded_at: actor.encodedAt,
        })));
      }
    });
  }
  return { from: employee.name, to: target.name, moved: movable.length, skipped };
}

/** Transfer history per enrollment, newest first, for the member details view. */
export async function getTransferHistory() {
  const transfers = schema.member_transfers;
  const rows = await currentDb().select().from(transfers).orderBy(desc(transfers.encoded_at));
  return rows.map((row) => ({ enrollmentId: text(row.enrollment_id), fromMas: text(row.from_mas), toMas: text(row.to_mas), reason: text(row.reason), by: text(row.encoded_by_name), at: row.encoded_at ?? "" }));
}
