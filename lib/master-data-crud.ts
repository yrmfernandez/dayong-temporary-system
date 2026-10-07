import { eq, sql } from "drizzle-orm";

import { currentDb, inTransaction, schema } from "@/lib/db";
import { getPrograms, programColumns } from "@/lib/google-sheets-data";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { generateOneTimePassword, hashOneTimePassword, oneTimePasswordExpiry } from "@/lib/passwords";
import { appendEncodedRows } from "@/lib/encoder-sheets";
import { deleteRowsWhere } from "@/lib/sheet-rows";
import { loadUsers, userCell } from "@/lib/users-sheet";
import { type StoredTier, validateIncentiveTiers, writeProgramIncentives } from "@/lib/program-incentive-store";

const text = (value: unknown) => String(value ?? "").trim();

async function rows(range: string) {
  return (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range })).data.values ?? [];
}

/** Whether any program enrollment matches `condition` (enrollments live in the database). */
async function hasEnrollments(condition: ReturnType<typeof sql>) {
  const [row] = await currentDb().select({ found: sql<number>`1` }).from(schema.member_programs).where(condition).limit(1);
  return Boolean(row);
}

export type ProgramInput = { flexible?: boolean; maxMonthlyPayment?: unknown; code: string; name: string; basePay: number; status: "active" | "inactive"; description: string; categoryId?: string; newSaleAmountEditable?: boolean; collectionAmountEditable?: boolean; registrationFeeRequired: boolean; registrationAmount: number; payBalanceTotal: number; saleIncentiveType?: unknown; saleIncentiveAmount?: unknown; ageRestricted?: unknown; minAge?: unknown; maxAge?: unknown; incentiveTiers: StoredTier[] };

export async function updateProgramRecord(id: string, input: ProgramInput) {
  if (!input.code || !input.name || !Number.isFinite(input.basePay) || input.basePay <= 0 || !input.incentiveTiers.length) throw new Error("Complete the program and incentive details.");
  if (!Number.isFinite(input.registrationAmount) || input.registrationAmount < 0 || !Number.isFinite(input.payBalanceTotal) || input.payBalanceTotal < 0) throw new Error("Registration and total amount payable cannot be negative.");
  if (input.registrationFeeRequired && input.registrationAmount <= 0) throw new Error("Enter the required registration amount.");
  const columns = programColumns(input);
  await validateIncentiveTiers(input.incentiveTiers, input.basePay);
  // The program and its tiers change together.
  await inTransaction(async (tx) => {
    const updated = await tx.update(schema.programs).set(columns).where(eq(schema.programs.program_id, id)).returning({ id: schema.programs.program_id });
    if (!updated.length) throw new Error("Record not found.");
    await writeProgramIncentives(id, input.incentiveTiers);
  });
  return { id };
}

/**
 * Settings that can be set on several programs at once (Programs → Edit selected). Only the keys present change;
 * code, name, base pay, total payable and incentive tiers stay per program.
 */
export type ProgramBulkChanges = {
  categoryId?: string;
  status?: "active" | "inactive";
  newSaleAmountEditable?: boolean;
  collectionAmountEditable?: boolean;
  flexible?: boolean;
  /** null = no maximum. Applies to flexible programs only. */
  maxMonthlyPayment?: number | null;
  registration?: { required: boolean; amount: number };
  age?: { restricted: boolean; minAge: number | null; maxAge: number | null };
  saleIncentive?: { type: "" | "fixed" | "percentage"; amount: number };
};

/**
 * Applies the same changes to every listed program in one transaction: each program is checked with the same rules as
 * a single edit (programColumns), and if any of them fails nothing is saved. Incentive tiers are not touched.
 */
export async function updateProgramsBulk(ids: string[], changes: ProgramBulkChanges) {
  const unique = [...new Set(ids.map(text).filter(Boolean))];
  if (!unique.length) throw new Error("Select at least one program.");
  if (!Object.keys(changes).length) throw new Error("Choose at least one setting to change.");
  const programs = (await getPrograms()).filter((program) => unique.includes(program.id));
  if (programs.length !== unique.length) throw new Error("Some selected programs no longer exist. Reload the page.");
  const updates = programs.map((program) => {
    const merged = {
      ...program,
      ...(changes.categoryId !== undefined && { categoryId: changes.categoryId }),
      ...(changes.status && { status: changes.status }),
      ...(changes.newSaleAmountEditable !== undefined && { newSaleAmountEditable: changes.newSaleAmountEditable }),
      ...(changes.collectionAmountEditable !== undefined && { collectionAmountEditable: changes.collectionAmountEditable }),
      ...(changes.flexible !== undefined && { flexible: changes.flexible }),
      ...(changes.maxMonthlyPayment !== undefined && { maxMonthlyPayment: changes.maxMonthlyPayment }),
      ...(changes.registration && { registrationFeeRequired: changes.registration.required, registrationAmount: changes.registration.required ? changes.registration.amount : 0 }),
      ...(changes.age && { ageRestricted: changes.age.restricted, minAge: changes.age.minAge, maxAge: changes.age.maxAge }),
      ...(changes.saleIncentive && { saleIncentiveType: changes.saleIncentive.type, saleIncentiveAmount: changes.saleIncentive.amount }),
    };
    try {
      if (merged.registrationFeeRequired && !(Number(merged.registrationAmount) > 0)) throw new Error("Enter the required registration amount.");
      return { id: program.id, columns: programColumns(merged) };
    } catch (error) {
      throw new Error(`${program.code || program.id}: ${error instanceof Error ? error.message : "Invalid settings."}`);
    }
  });
  await inTransaction(async (tx) => {
    for (const { id, columns } of updates) await tx.update(schema.programs).set(columns).where(eq(schema.programs.program_id, id));
  });
  return { updated: updates.length };
}

export async function deleteProgramRecord(id: string) {
  if (await hasEnrollments(sql`${schema.member_programs.program_id} = ${id}`)) throw new Error("This program has member enrollments. Set it to inactive instead of deleting it.");
  await inTransaction(async (tx) => {
    await tx.delete(schema.program_incentives).where(eq(schema.program_incentives.program_id, id));
    const removed = await tx.delete(schema.programs).where(eq(schema.programs.program_id, id)).returning({ id: schema.programs.program_id });
    if (!removed.length) throw new Error("Record not found.");
  });
}

export type BranchInput = { name: string; territory: string; barangay: string; cityMunicipality: string; province: string; country: string; postalCode: string; contactNumber: string; email: string; dateOpened: string; dateClosed: string; status: "active" | "inactive" };

export async function updateBranchRecord(id: string, input: BranchInput) {
  if (!input.name || !input.territory) throw new Error("Branch name and territory are required.");
  const db = currentDb();
  const [clash] = await db.select({ id: schema.branches.branch_id }).from(schema.branches).where(sql`${schema.branches.branch_id} <> ${id} and lower(trim(${schema.branches.branch_name_code})) = ${input.name.trim().toLowerCase()}`).limit(1);
  if (clash) throw new Error(`Another branch is already named "${input.name.trim()}". Branch names must be unique because records store the branch name.`);
  const optional = (value: string) => value.trim() || null;
  const updated = await db.update(schema.branches).set({
    branch_name_code: input.name.trim(), territory: optional(input.territory), barangay: optional(input.barangay), city_municipality: optional(input.cityMunicipality),
    province: optional(input.province), country: optional(input.country), postal_code: optional(input.postalCode), contact_number: optional(input.contactNumber),
    email: optional(input.email), date_opened: optional(input.dateOpened), date_closed: optional(input.dateClosed), status: input.status,
  }).where(eq(schema.branches.branch_id, id)).returning({ id: schema.branches.branch_id });
  if (!updated.length) throw new Error("Record not found.");
  return { id };
}

export async function deleteBranchRecord(id: string) {
  const db = currentDb();
  const [branch] = await db.select().from(schema.branches).where(eq(schema.branches.branch_id, id));
  if (!branch) throw new Error("Record not found.");
  const [assigned] = await db.select({ id: schema.employee_branches.assignment_id }).from(schema.employee_branches).where(eq(schema.employee_branches.branch_id, id)).limit(1);
  if (assigned || await hasEnrollments(sql`trim(${schema.member_programs.branch}) = ${branch.branch_name_code.trim()}`)) throw new Error("This branch is assigned to employees or member enrollments. Set it to inactive instead of deleting it.");
  await db.delete(schema.branches).where(eq(schema.branches.branch_id, id));
}

export async function getUserAccounts() {
  const [{ users }, roles, links] = await Promise.all([loadUsers(), rows("Roles!A:G"), rows("'User Roles'!A:B")]);
  const roleNames = new Map(roles.slice(1).map((row) => [text(row[0]), text(row[1])]));
  return users.map((user) => {
    const linkedRoleIds = links.slice(1).filter((link) => text(link[0]) === user.id).map((link) => text(link[1])).filter(Boolean);
    // Sign-in reads only User Roles, so show exactly those. Users.role_id is a legacy primary-role cell; it is shown only
    // for an account with no links, and editing would otherwise silently grant it.
    const roleIds = [...new Set(linkedRoleIds.length ? linkedRoleIds : [user.roleId].filter(Boolean))];
    return { id: user.id, employeeId: user.employeeId, fullName: user.fullName, status: user.status || "active", createdAt: user.createdAt, primaryRoleId: user.roleId || roleIds[0] || "", roleIds, roles: roleIds.map((roleId) => roleNames.get(roleId) || roleId) };
  });
}

export async function updateUserAccount(id: string, input: { status: string; roleIds: string[] }) {
  const [{ columns, users }, roles] = await Promise.all([loadUsers(), rows("Roles!A:G")]);
  const user = users.find((row) => row.id === id);
  if (!user) throw new Error("Record not found.");
  const activeRoleIds = new Set(roles.slice(1).filter((row) => text(row[6]).toLowerCase() === "active").map((row) => text(row[0])));
  const roleIds = [...new Set(input.roleIds.map(text).filter(Boolean))];
  if (!roleIds.length || roleIds.some((roleId) => !activeRoleIds.has(roleId))) throw new Error("Select valid active roles.");
  const status = input.status === "inactive" ? "inactive" : "active";
  const data = [{ range: userCell(columns.status, user.rowNumber), values: [[status]] }, { range: userCell(columns.roleId, user.rowNumber), values: [[roleIds[0]]] }];
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "RAW", data } });
  await deleteRowsWhere("User Roles", (row) => text(row[0]) === id);
  await appendEncodedRows({ range: "'User Roles'!A:B", requestBody: { values: roleIds.map((roleId) => [id, roleId]) } });
  return { id };
}

/**
 * Replaces the account's password with a new one-time password for IT to hand over. Sessions signed in with the old
 * password end at their next recheck (lib/session-account.ts).
 */
export async function resetUserPassword(id: string) {
  const { columns, users } = await loadUsers();
  const user = users.find((row) => row.id === id);
  if (!user) throw new Error("Record not found.");
  if (user.status !== "active") throw new Error("Reactivate the account before resetting its password.");
  const oneTimePassword = generateOneTimePassword(), issuedAt = Date.now();
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: userCell(columns.passwordHash, user.rowNumber), valueInputOption: "RAW", requestBody: { values: [[await hashOneTimePassword(oneTimePassword, issuedAt)]] } });
  return { id, employeeId: user.employeeId, fullName: user.fullName, oneTimePassword, expiresAt: oneTimePasswordExpiry(issuedAt) };
}

export async function deleteUserAccount(id: string, actorUserId: string) {
  if (id === actorUserId) throw new Error("You cannot delete your own signed-in account.");
  const { columns, users } = await loadUsers();
  if (!users.some((row) => row.id === id)) throw new Error("Record not found.");
  await deleteRowsWhere("User Roles", (row) => text(row[0]) === id);
  await deleteRowsWhere("Users", (row) => text(row[columns.id]) === id);
}

export async function updateMemberRecord(id: string, input: { contact: string; status: string }) {
  const status = input.status.trim();
  if (!status) throw new Error("Member status is required.");
  const updated = await currentDb().update(schema.members).set({ member_contact: input.contact.trim() || null, status }).where(eq(schema.members.member_id, id)).returning({ id: schema.members.member_id });
  if (!updated.length) throw new Error("Record not found.");
  return { id };
}

/** Removes a member with no program enrollments; one with enrollments has history and is set inactive instead. */
export async function deleteMemberRecord(id: string) {
  if (await hasEnrollments(sql`${schema.member_programs.member_id} = ${id}`)) throw new Error("This member has program enrollments and transaction history. Update the member status instead of deleting the record.");
  const removed = await currentDb().delete(schema.members).where(eq(schema.members.member_id, id)).returning({ id: schema.members.member_id });
  if (!removed.length) throw new Error("Record not found.");
}
