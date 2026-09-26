import bcrypt from "bcryptjs";
import { appendEncodedRows } from "@/lib/encoder-sheets";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";

const text = (value: unknown) => String(value ?? "").trim();

async function rows(range: string) {
  return (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range })).data.values ?? [];
}

function findRow(data: unknown[][], id: string) {
  const index = data.slice(1).findIndex((row) => text(row[0]) === id);
  if (index < 0) throw new Error("Record not found.");
  return index + 2;
}

async function clearRows(sheet: string, width: string, rowNumbers: number[]) {
  if (!rowNumbers.length) return;
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "RAW", data: rowNumbers.map((row) => ({ range: `'${sheet}'!A${row}:${width}${row}`, values: [[...Array(columnCount(width))].map(() => "")] })) } });
}

function columnCount(name: string) {
  return [...name].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);
}

export type ProgramInput = { code: string; name: string; basePay: number; status: "active" | "inactive"; description: string; incentiveTiers: Array<{ role: "MAS" | "Collector"; fromMonth: number; toMonth: number; incentiveType: "fixed" | "percentage"; markUp: number; incentiveAmount: number }> };

export async function updateProgramRecord(id: string, input: ProgramInput) {
  const [programs, incentives] = await Promise.all([rows("Programs!A:F"), rows("'Program Incentives'!A:H")]);
  const rowNumber = findRow(programs, id);
  if (!input.code || !input.name || !Number.isFinite(input.basePay) || input.basePay <= 0 || !input.incentiveTiers.length) throw new Error("Complete the program and incentive details.");
  for (const tier of input.incentiveTiers) {
    if (!Number.isInteger(tier.fromMonth) || !Number.isInteger(tier.toMonth) || tier.fromMonth < 1 || tier.toMonth < tier.fromMonth) throw new Error("Enter valid whole-month incentive ranges.");
    if (!Number.isFinite(tier.markUp) || tier.markUp < 0 || tier.markUp > input.basePay || !Number.isFinite(tier.incentiveAmount) || tier.incentiveAmount < 0 || (tier.incentiveType === "percentage" && tier.incentiveAmount > 100)) throw new Error("Enter valid mark-up and incentive amounts.");
  }
  if (input.incentiveTiers.some((tier, index) => input.incentiveTiers.some((other, otherIndex) => index !== otherIndex && tier.role === other.role && tier.fromMonth <= other.toMonth && other.fromMonth <= tier.toMonth))) throw new Error("Incentive tiers for the same role cannot overlap.");
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `Programs!A${rowNumber}:F${rowNumber}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[id, input.code, input.name, input.basePay, input.status, input.description]] } });
  await clearRows("Program Incentives", "L", incentives.slice(1).map((row, index) => text(row[1]) === id ? index + 2 : 0).filter(Boolean));
  await appendEncodedRows({ range: "'Program Incentives'!A:H", requestBody: { values: input.incentiveTiers.map((tier) => [crypto.randomUUID(), id, tier.role, tier.fromMonth, tier.toMonth, tier.incentiveType, tier.markUp, tier.incentiveAmount]) } });
  return { id };
}

export async function deleteProgramRecord(id: string) {
  const [programs, incentives, enrollments] = await Promise.all([rows("Programs!A:F"), rows("'Program Incentives'!A:H"), rows("'Member programs'!A:D")]);
  if (enrollments.slice(1).some((row) => text(row[3]) === id)) throw new Error("This program has member enrollments. Set it to inactive instead of deleting it.");
  await clearRows("Programs", "J", [findRow(programs, id)]);
  await clearRows("Program Incentives", "L", incentives.slice(1).map((row, index) => text(row[1]) === id ? index + 2 : 0).filter(Boolean));
}

export type BranchInput = { name: string; territory: string; barangay: string; cityMunicipality: string; province: string; country: string; postalCode: string; contactNumber: string; email: string; dateOpened: string; dateClosed: string; status: "active" | "inactive" };

export async function updateBranchRecord(id: string, input: BranchInput) {
  const branches = await rows("Branches!A:M");
  const rowNumber = findRow(branches, id);
  if (!input.name || !input.territory) throw new Error("Branch name and territory are required.");
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `Branches!A${rowNumber}:M${rowNumber}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[id, input.name, input.territory, input.barangay, input.cityMunicipality, input.province, input.country, input.postalCode, input.contactNumber, input.email, input.dateOpened, input.dateClosed, input.status]] } });
  return { id };
}

export async function deleteBranchRecord(id: string) {
  const [branches, assignments, enrollments] = await Promise.all([rows("Branches!A:M"), rows("'Employee Branches'!A:C"), rows("'Member programs'!A:G")]);
  const branch = branches[findRow(branches, id) - 1];
  const name = text(branch[1]);
  if (assignments.slice(1).some((row) => text(row[2]) === id) || enrollments.slice(1).some((row) => text(row[5]) === name)) throw new Error("This branch is assigned to employees or member enrollments. Set it to inactive instead of deleting it.");
  await clearRows("Branches", "Q", [findRow(branches, id)]);
}

export async function getUserAccounts() {
  const [users, roles, links] = await Promise.all([rows("Users!A:H"), rows("Roles!A:G"), rows("'User Roles'!A:B")]);
  const roleNames = new Map(roles.slice(1).map((row) => [text(row[0]), text(row[1])]));
  return users.slice(1).filter((row) => text(row[0])).map((row) => ({ id: text(row[0]), employeeId: text(row[1]), username: text(row[2]), fullName: text(row[3]), status: text(row[5]), createdAt: text(row[6]), roleIds: links.slice(1).filter((link) => text(link[0]) === text(row[0])).map((link) => text(link[1])), roles: links.slice(1).filter((link) => text(link[0]) === text(row[0])).map((link) => roleNames.get(text(link[1])) || text(link[1])) }));
}

export async function updateUserAccount(id: string, input: { username: string; status: string; roleIds: string[]; password?: string }) {
  const [users, roles, links] = await Promise.all([rows("Users!A:H"), rows("Roles!A:G"), rows("'User Roles'!A:B")]);
  const rowNumber = findRow(users, id);
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,50}$/.test(username)) throw new Error("Enter a valid username.");
  if (users.slice(1).some((row, index) => index + 2 !== rowNumber && text(row[2]).toLowerCase() === username)) throw new Error("This username is already in use.");
  const activeRoleIds = new Set(roles.slice(1).filter((row) => text(row[6]).toLowerCase() === "active").map((row) => text(row[0])));
  const roleIds = [...new Set(input.roleIds.map(text).filter(Boolean))];
  if (!roleIds.length || roleIds.some((roleId) => !activeRoleIds.has(roleId))) throw new Error("Select valid active roles.");
  const status = input.status === "inactive" ? "inactive" : "active";
  const data = [{ range: `Users!C${rowNumber}`, values: [[username]] }, { range: `Users!F${rowNumber}`, values: [[status]] }];
  if (input.password) {
    if (input.password.length < 12) throw new Error("Temporary password must contain at least 12 characters.");
    data.push({ range: `Users!E${rowNumber}`, values: [[await bcrypt.hash(input.password, 12)]] });
  }
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "RAW", data } });
  await clearRows("User Roles", "F", links.slice(1).map((row, index) => text(row[0]) === id ? index + 2 : 0).filter(Boolean));
  await appendEncodedRows({ range: "'User Roles'!A:B", requestBody: { values: roleIds.map((roleId) => [id, roleId]) } });
  return { id };
}

export async function deleteUserAccount(id: string, actorUserId: string) {
  if (id === actorUserId) throw new Error("You cannot delete your own signed-in account.");
  const [users, links] = await Promise.all([rows("Users!A:H"), rows("'User Roles'!A:B")]);
  await clearRows("Users", "L", [findRow(users, id)]);
  await clearRows("User Roles", "F", links.slice(1).map((row, index) => text(row[0]) === id ? index + 2 : 0).filter(Boolean));
}

export async function updateMemberRecord(id: string, input: { contact: string; status: string }) {
  const members = await rows("Members!A:AD");
  const rowNumber = findRow(members, id);
  const status = input.status.trim();
  if (!status) throw new Error("Member status is required.");
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "USER_ENTERED", data: [
    { range: `Members!L${rowNumber}`, values: [[input.contact.trim()]] },
    { range: `Members!AD${rowNumber}`, values: [[status]] },
  ] } });
  return { id };
}

export async function deleteMemberRecord(id: string) {
  const [members, enrollments] = await Promise.all([rows("Members!A:AD"), rows("'Member programs'!A:B")]);
  if (enrollments.slice(1).some((row) => text(row[1]) === id)) throw new Error("This member has program enrollments and transaction history. Update the member status instead of deleting the record.");
  await clearRows("Members", "AH", [findRow(members, id)]);
}
