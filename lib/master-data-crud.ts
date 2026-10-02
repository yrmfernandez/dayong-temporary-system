import { createReadableId } from "@/lib/readable-id";
import { generateOneTimePassword, hashOneTimePassword, oneTimePasswordExpiry } from "@/lib/passwords";
import { appendEncodedRows } from "@/lib/encoder-sheets";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { deleteRowsById, deleteRowsWhere } from "@/lib/sheet-rows";
import { loadUsers, userCell } from "@/lib/users-sheet";
import { ageRestrictionCells, normalizeAgeRestriction } from "@/lib/program-age";
import { normalizeSaleIncentive } from "@/lib/remittance";
import { type StoredTier, validateIncentiveTiers, writeProgramIncentives } from "@/lib/program-incentive-store";

const text = (value: unknown) => String(value ?? "").trim();

async function rows(range: string) {
  return (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range })).data.values ?? [];
}

function findRow(data: unknown[][], id: string) {
  const index = data.slice(1).findIndex((row) => text(row[0]) === id);
  if (index < 0) throw new Error("Record not found.");
  return index + 2;
}


export type ProgramInput = { code: string; name: string; basePay: number; status: "active" | "inactive"; description: string; categoryId?: string; registrationFeeRequired: boolean; registrationAmount: number; payBalanceTotal: number; saleIncentiveType?: unknown; saleIncentiveAmount?: unknown; ageRestricted?: unknown; minAge?: unknown; maxAge?: unknown; incentiveTiers: StoredTier[] };

export async function updateProgramRecord(id: string, input: ProgramInput) {
  const programs = await rows("Programs!A:F");
  const rowNumber = findRow(programs, id);
  if (!input.code || !input.name || !Number.isFinite(input.basePay) || input.basePay <= 0 || !input.incentiveTiers.length) throw new Error("Complete the program and incentive details.");
  if (!Number.isFinite(input.registrationAmount) || input.registrationAmount < 0 || !Number.isFinite(input.payBalanceTotal) || input.payBalanceTotal < 0) throw new Error("Registration and pay-the-balance amounts cannot be negative.");
  if (input.registrationFeeRequired && input.registrationAmount <= 0) throw new Error("Enter the required registration amount.");
  const ageRestriction = normalizeAgeRestriction(input);
  const saleIncentive = normalizeSaleIncentive(input);
  await validateIncentiveTiers(input.incentiveTiers, input.basePay);
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `Programs!A${rowNumber}:F${rowNumber}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[id, input.code, input.name, input.basePay, input.status, input.description]] } });
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `Programs!K${rowNumber}:S${rowNumber}`, valueInputOption: "RAW", requestBody: { values: [[input.registrationFeeRequired ? "Yes" : "No", input.registrationAmount, input.payBalanceTotal, ...ageRestrictionCells(ageRestriction), saleIncentive.saleIncentiveType, saleIncentive.saleIncentiveType ? saleIncentive.saleIncentiveAmount : "", text(input.categoryId)]] } });
  await writeProgramIncentives(id, input.incentiveTiers);
  return { id };
}

export async function deleteProgramRecord(id: string) {
  const [programs, enrollments] = await Promise.all([rows("Programs!A:F"), rows("'Member programs'!A:D")]);
  if (enrollments.slice(1).some((row) => text(row[3]) === id)) throw new Error("This program has member enrollments. Set it to inactive instead of deleting it.");
  findRow(programs, id);
  await deleteRowsWhere("Program Incentives", (row) => text(row[1]) === id);
  await deleteRowsById("Programs", [id]);
}

export type BranchInput = { name: string; territory: string; barangay: string; cityMunicipality: string; province: string; country: string; postalCode: string; contactNumber: string; email: string; dateOpened: string; dateClosed: string; status: "active" | "inactive" };

export async function updateBranchRecord(id: string, input: BranchInput) {
  const branches = await rows("Branches!A:M");
  const rowNumber = findRow(branches, id);
  if (!input.name || !input.territory) throw new Error("Branch name and territory are required.");
  if (branches.slice(1).some((row) => text(row[0]) !== id && text(row[1]).toLowerCase() === input.name.trim().toLowerCase())) {
    throw new Error(`Another branch is already named "${input.name.trim()}". Branch names must be unique because records store the branch name.`);
  }
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `Branches!A${rowNumber}:M${rowNumber}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[id, input.name, input.territory, input.barangay, input.cityMunicipality, input.province, input.country, input.postalCode, input.contactNumber, input.email, input.dateOpened, input.dateClosed, input.status]] } });
  return { id };
}

export async function deleteBranchRecord(id: string) {
  const [branches, assignments, enrollments] = await Promise.all([rows("Branches!A:M"), rows("'Employee Branches'!A:C"), rows("'Member programs'!A:G")]);
  const branch = branches[findRow(branches, id) - 1];
  const name = text(branch[1]);
  if (assignments.slice(1).some((row) => text(row[2]) === id) || enrollments.slice(1).some((row) => text(row[5]) === name)) throw new Error("This branch is assigned to employees or member enrollments. Set it to inactive instead of deleting it.");
  await deleteRowsById("Branches", [id]);
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
  const members = await rows("Members!A:R");
  const rowNumber = findRow(members, id);
  const status = input.status.trim();
  if (!status) throw new Error("Member status is required.");
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "USER_ENTERED", data: [
    { range: `Members!L${rowNumber}`, values: [[input.contact.trim()]] },
    { range: `Members!R${rowNumber}`, values: [[status]] },
  ] } });
  return { id };
}

export async function deleteMemberRecord(id: string) {
  const [members, enrollments] = await Promise.all([rows("Members!A:R"), rows("'Member programs'!A:B")]);
  if (enrollments.slice(1).some((row) => text(row[1]) === id)) throw new Error("This member has program enrollments and transaction history. Update the member status instead of deleting the record.");
  findRow(members, id);
  await deleteRowsById("Members", [id]);
}
