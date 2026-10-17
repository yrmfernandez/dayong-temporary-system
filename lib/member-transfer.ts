import { canAccessPath, canCorrectEntriesFor } from "@/lib/access-control";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { desc, eq, inArray, sql } from "drizzle-orm";

import { currentDb, encodedBy, inTransaction, schema, type Transaction } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { createReadableId } from "@/lib/readable-id";

/**
 * Moves program enrollments (accounts) to another employee. From then on their collections belong to the new MAS
 * (Collections require the enrollment's own Branch and MAS); past collections and cash already owed stay with the
 * previous MAS. The enrollment's MAS changes and member_transfers keeps the history with the reason, in one transaction.
 *
 * Any active employee may take them, from any branch (owner, October 14, 2026). Collections and Clearing need the MAS
 * to be assigned to the account's branch, so for accounts in a branch the new MAS is not assigned to, the person
 * transferring chooses each time:
 *   - "keep": the accounts stay in their branch and the new MAS is assigned to it (Employees → branches);
 *   - "move": the accounts move to one of the new MAS's branches (`moveTo`); past entries stay under the old branch.
 * Accounts already in a branch of the new MAS only change MAS.
 */
const text = (value: unknown) => String(value ?? "").trim();

// Administrators and HR Officers may move a member's program enrollment to another employee; IT too, from Edit / Corrections.
export async function canTransferMembers() {
  const user = await getSessionUser();
  if (!user) return false;
  return (await canManageUsers()) || (user.roleNames ?? []).some((role) => ["hr officer", "hr"].includes(role.trim().toLowerCase()))
    || (canCorrectEntriesFor(user) && canAccessPath(user, "/entry-corrections"));
}

async function enrollmentRow(enrollmentId: string) {
  const [row] = await currentDb().select().from(schema.member_programs).where(eq(schema.member_programs.enrollment_id, enrollmentId));
  if (!row) throw new Error("Program enrollment not found.");
  return { memberId: row.member_id, memberNumber: text(row.member_number), programId: row.program_id, branch: text(row.branch), mas: text(row.mas), status: text(row.status) };
}

export type BranchMode = "keep" | "move";
export type TransferCandidate = { employeeId: string; name: string; roles: string[]; branches: string[] };

/** Active employees, with their branches (primary first), other than `exceptName` / `exceptId`. */
async function activeCandidates(except: { name?: string; id?: string }) {
  const [employees, branches] = await Promise.all([getEmployees(), getBranches()]);
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const candidates: TransferCandidate[] = employees
    .filter((item) => item.status.toLowerCase() === "active" && item.id !== except.id && item.name !== except.name)
    .map((item) => {
      const assigned = item.branchIds.map((id) => branchName.get(id) ?? "").filter(Boolean);
      return { employeeId: item.id, name: item.name, roles: item.roles, branches: [...new Set([item.branch, ...assigned].filter((name) => name && assigned.some((other) => same(other, name))))] };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { candidates, branches };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Active employees from any branch, other than the enrollment's current MAS. */
export async function transferCandidates(enrollmentId: string) {
  const enrollment = await enrollmentRow(enrollmentId);
  const { candidates } = await activeCandidates({ name: enrollment.mas });
  return { enrollment, candidates };
}

type AccountRow = typeof schema.member_programs.$inferSelect;

/**
 * Moves the rows to the target inside the transaction, following the branch choice for accounts outside the target's
 * branches; returns what changed per branch. Throws when the choice is missing or the destination is not the target's.
 */
async function applyTransfer(tx: Transaction, rows: AccountRow[], target: TransferCandidate, choice: { branchMode?: string; moveTo?: string }, reasonOf: (row: AccountRow) => string) {
  const outside = rows.filter((row) => !target.branches.some((branch) => same(branch, text(row.branch))));
  const mode = choice.branchMode === "keep" || choice.branchMode === "move" ? choice.branchMode : "";
  const moveTo = target.branches.find((branch) => same(branch, text(choice.moveTo)));
  if (outside.length && !mode) throw new Error(`${target.name} is not assigned to ${[...new Set(outside.map((row) => text(row.branch)))].join(", ")}. Choose whether the accounts keep their branch or move to ${target.name}'s branch.`);
  if (outside.length && mode === "move" && !moveTo) throw new Error(`Choose one of ${target.name}'s branches to move the accounts to.`);
  const branches = await getBranches();
  const assigned: string[] = [];
  if (outside.length && mode === "keep") {
    // Assign the new MAS to each branch first, so the database links the accounts to this employee (link_employee_id).
    for (const name of [...new Set(outside.map((row) => text(row.branch)))]) {
      const branch = branches.find((item) => same(item.name, name));
      if (!branch) throw new Error(`Branch ${name} is not in Branches; the accounts cannot keep it.`);
      await tx.insert(schema.employee_branches).values({ assignment_id: `EBA-${target.employeeId}-${Date.now()}-${assigned.length + 1}`, employee_id: target.employeeId, branch_id: branch.id, ...encodedBy() }).onConflictDoNothing();
      assigned.push(branch.name);
    }
  }
  const moving = new Set(mode === "move" ? outside.map((row) => row.enrollment_id) : []);
  const stay = rows.filter((row) => !moving.has(row.enrollment_id)).map((row) => row.enrollment_id);
  if (stay.length) await tx.update(schema.member_programs).set({ mas: target.name }).where(inArray(schema.member_programs.enrollment_id, stay));
  if (moving.size) await tx.update(schema.member_programs).set({ mas: target.name, branch: moveTo }).where(inArray(schema.member_programs.enrollment_id, [...moving]));
  const actor = getEncoder();
  const records = rows.map((row) => ({
    transfer_id: createReadableId("MTR"), enrollment_id: row.enrollment_id, member_id: row.member_id, member_number: text(row.member_number), program_id: row.program_id,
    branch: text(row.branch), from_mas: text(row.mas), to_mas: target.name, to_employee_id: target.employeeId,
    reason: `${reasonOf(row)}${moving.has(row.enrollment_id) ? ` (branch ${text(row.branch)} → ${moveTo})` : ""}`.slice(0, 500),
    encoded_by_user_id: actor.userId, encoded_by_employee_id: actor.employeeId, encoded_by_name: actor.name, encoded_at: actor.encodedAt,
  }));
  for (let i = 0; i < records.length; i += 500) await tx.insert(schema.member_transfers).values(records.slice(i, i + 500));
  return { assigned, movedBranch: moving.size, moveTo: moving.size ? moveTo ?? "" : "" };
}

export async function transferEnrollment(input: { enrollmentId: string; toEmployeeId: string; reason: string; branchMode?: string; moveTo?: string }) {
  const enrollmentId = text(input.enrollmentId), toEmployeeId = text(input.toEmployeeId), reason = text(input.reason);
  if (reason.length < 3 || reason.length > 300) throw new Error("Give the reason for the transfer (3–300 characters).");
  const { enrollment, candidates } = await transferCandidates(enrollmentId);
  const target = candidates.find((candidate) => candidate.employeeId === toEmployeeId);
  if (!target) throw new Error("Choose an active employee (not the current MAS).");
  const id = createReadableId("MTR");
  const result = await inTransaction(async (tx) => {
    const rows = await tx.select().from(schema.member_programs).where(eq(schema.member_programs.enrollment_id, enrollmentId));
    return applyTransfer(tx, rows, target, input, () => reason);
  });
  return { id, enrollmentId, fromMas: enrollment.mas, toMas: target.name, ...result };
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
  const employees = await getEmployees();
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee) throw new Error("Employee not found.");
  const rows = rowsOf<{ enrollment_id: string; member_number: string; first_name: string; middle_name: string; surname: string; program: string; branch: string; status: string; account_status: string }>(await currentDb().execute(sql`
    select mp.enrollment_id, mp.member_number, m.first_name, m.middle_name, m.surname, coalesce(p.program_name, mp.program_id) as program, mp.branch, mp.status, mp.account_status
    from member_programs mp left join members m on m.member_id = mp.member_id left join programs p on p.program_id = mp.program_id
    where mp.mas_employee_id = ${employeeId} or (mp.mas_employee_id is null and lower(trim(mp.mas)) = lower(trim(${employee.name})))
    order by mp.branch, m.surname, m.first_name`));
  const accounts: EmployeeAccount[] = rows.map((row) => ({
    enrollmentId: row.enrollment_id, memberNumber: text(row.member_number), memberName: [row.first_name, row.middle_name, row.surname].map(text).filter(Boolean).join(" "),
    program: text(row.program), branch: text(row.branch), status: text(row.status), accountStatus: text(row.account_status),
  }));
  const { candidates } = await activeCandidates({ id: employeeId });
  return { employee: { id: employee.id, name: employee.name }, accounts, candidates };
}

/**
 * Moves several of one employee's accounts (or all of them) to another active employee, from any branch, in one
 * transaction, keeping a transfer record for each like a single transfer. Accounts in branches the new employee is not
 * assigned to keep their branch (the employee is assigned to it) or move to the employee's branch, as chosen.
 */
export async function transferEmployeeAccounts(input: { fromEmployeeId: string; enrollmentIds: string[]; toEmployeeId: string; reason: string; branchMode?: string; moveTo?: string }) {
  const reason = text(input.reason), toEmployeeId = text(input.toEmployeeId);
  if (reason.length < 3 || reason.length > 300) throw new Error("Give the reason for the transfer (3–300 characters).");
  const wanted = new Set(input.enrollmentIds.map(text).filter(Boolean));
  if (!wanted.size) throw new Error("Choose the members to transfer.");
  const { employee, accounts, candidates } = await employeeAccounts(input.fromEmployeeId);
  const target = candidates.find((candidate) => candidate.employeeId === toEmployeeId);
  if (!target) throw new Error("Choose an active employee other than the current one.");
  const chosen = accounts.filter((account) => wanted.has(account.enrollmentId));
  if (chosen.length !== wanted.size) throw new Error("Some of the chosen accounts are no longer this employee's. Reload and try again.");
  const ids = chosen.map((account) => account.enrollmentId);
  const result = await inTransaction(async (tx) => {
    const rows = await tx.select().from(schema.member_programs).where(inArray(schema.member_programs.enrollment_id, ids));
    return applyTransfer(tx, rows, target, input, () => `Transfer of ${employee.name}'s members: ${reason}`);
  });
  return { from: employee.name, to: target.name, moved: ids.length, ...result };
}

/** Transfer history per enrollment, newest first, for the member details view. */
export async function getTransferHistory() {
  const transfers = schema.member_transfers;
  const rows = await currentDb().select().from(transfers).orderBy(desc(transfers.encoded_at));
  return rows.map((row) => ({ enrollmentId: text(row.enrollment_id), fromMas: text(row.from_mas), toMas: text(row.to_mas), reason: text(row.reason), by: text(row.encoded_by_name), at: row.encoded_at ?? "" }));
}

// ---------------------------------------------------------------- same MAS, another branch

/** Active branch names, sorted, and a map from branch ID to name. */
async function activeBranchNames() {
  const branches = await getBranches();
  return {
    branches,
    names: branches.filter((branch) => branch.status === "active").map((branch) => branch.name).sort((a, b) => a.localeCompare(b)),
    nameOf: new Map(branches.map((branch) => [branch.id, branch.name])),
  };
}

/** The active branches an account can move to (all but its own) and its MAS's branches, for Change branch. */
export async function branchChangeOptions(enrollmentId: string) {
  const enrollment = await enrollmentRow(enrollmentId);
  const [{ names, nameOf }, employees, [row]] = await Promise.all([activeBranchNames(), getEmployees(),
    currentDb().select({ masId: schema.member_programs.mas_employee_id }).from(schema.member_programs).where(eq(schema.member_programs.enrollment_id, enrollmentId))]);
  const mas = employees.find((item) => item.id === row?.masId) ?? employees.find((item) => enrollment.mas && same(item.name, enrollment.mas));
  return {
    enrollment,
    masBranches: mas ? mas.branchIds.map((id) => nameOf.get(id) ?? "").filter(Boolean) : [],
    branches: names.filter((name) => !same(name, enrollment.branch)),
  };
}

/** Every active branch and the employee's own branches, for moving several of one MAS's accounts (Edit / Corrections). */
export async function employeeBranchOptions(employeeId: string) {
  const [{ names, nameOf }, employees] = await Promise.all([activeBranchNames(), getEmployees()]);
  const employee = employees.find((item) => item.id === text(employeeId));
  return { branches: names, masBranches: employee ? employee.branchIds.map((id) => nameOf.get(id) ?? "").filter(Boolean) : [] };
}

/**
 * Moves accounts to another branch, keeping their MAS (owner, October 17, 2026): one from Members → Transfer, or
 * several of one MAS's from Edit / Corrections → Move between branches. Future collections are recorded in the new
 * branch; past collections, sales and cash already owed stay under the old one. Collections and Clearing need the MAS
 * assigned to the account's branch, so a MAS not yet assigned to the new branch is assigned to it here. Accounts
 * already in that branch are skipped. Each moved account gets a member_transfers record (same MAS on both sides) with
 * the reason, all in one transaction.
 */
export async function changeEnrollmentsBranch(input: { enrollmentIds: string[]; branch: string; reason: string }) {
  const reason = text(input.reason);
  if (reason.length < 3 || reason.length > 300) throw new Error("Give the reason for the branch change (3–300 characters).");
  const ids = [...new Set(input.enrollmentIds.map(text).filter(Boolean))];
  if (!ids.length) throw new Error("Choose the accounts to move.");
  const [{ branches, names, nameOf }, employees] = await Promise.all([activeBranchNames(), getEmployees()]);
  const to = names.find((name) => same(name, text(input.branch)));
  if (!to) throw new Error("Choose an active branch.");
  const branchId = branches.find((branch) => same(branch.name, to))?.id ?? "";
  const actor = getEncoder();
  return inTransaction(async (tx) => {
    const rows = await tx.select().from(schema.member_programs).where(inArray(schema.member_programs.enrollment_id, ids));
    if (rows.length !== ids.length) throw new Error("Some of the chosen accounts were not found. Reload and try again.");
    const moving = rows.filter((row) => !same(text(row.branch), to));
    if (!moving.length) throw new Error(`The chosen account${ids.length === 1 ? " is" : "s are"} already in ${to}.`);
    // The MAS of each account (by its link, else its name); those not yet assigned to the new branch are assigned.
    const masOf = (row: AccountRow) => employees.find((item) => item.id === row.mas_employee_id) ?? employees.find((item) => text(row.mas) && same(item.name, text(row.mas)));
    const assigned: string[] = [];
    for (const mas of new Map(moving.map((row) => masOf(row)).filter((item) => item !== undefined).map((item) => [item.id, item])).values()) {
      if (mas.branchIds.some((id) => same(nameOf.get(id) ?? "", to))) continue;
      await tx.insert(schema.employee_branches).values({ assignment_id: `EBA-${mas.id}-${Date.now()}-${assigned.length + 1}`, employee_id: mas.id, branch_id: branchId, ...encodedBy() }).onConflictDoNothing();
      assigned.push(mas.name);
    }
    // The database re-links branch_id from the new name (trigger fill_links); the MAS and its link stay.
    await tx.update(schema.member_programs).set({ branch: to }).where(inArray(schema.member_programs.enrollment_id, moving.map((row) => row.enrollment_id)));
    const records = moving.map((row) => ({
      transfer_id: createReadableId("MTR"), enrollment_id: row.enrollment_id, member_id: row.member_id, member_number: text(row.member_number), program_id: row.program_id,
      branch: text(row.branch), from_mas: text(row.mas), to_mas: text(row.mas), to_employee_id: masOf(row)?.id ?? null,
      reason: `Branch ${text(row.branch) || "none"} → ${to}: ${reason}`.slice(0, 500),
      encoded_by_user_id: actor.userId, encoded_by_employee_id: actor.employeeId, encoded_by_name: actor.name, encoded_at: actor.encodedAt,
    }));
    for (let i = 0; i < records.length; i += 500) await tx.insert(schema.member_transfers).values(records.slice(i, i + 500));
    return { to, moved: moving.length, skipped: rows.length - moving.length, from: [...new Set(moving.map((row) => text(row.branch) || "none"))], mas: [...new Set(moving.map((row) => text(row.mas)).filter(Boolean))], assigned };
  });
}
