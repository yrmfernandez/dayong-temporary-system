import { asc, eq } from "drizzle-orm";

import { currentDb, encodedBy, inTransaction, schema } from "@/lib/db";
import { isTrue } from "@/lib/program-amount-lock";
import { writeProgramIncentives } from "@/lib/program-incentive-store";
import { getEmployees } from "@/lib/employees";
import { EMPLOYEE_ID_FORMAT_MESSAGE, isEmployeeIdFormat } from "@/lib/employee-id";
import { appendEncodedRows } from "@/lib/encoder-sheets";
import { parsePageAccess } from "@/lib/roles";
import { normalizeAgeRestriction, type AgeRestriction } from "@/lib/program-age";
import { normalizeSaleIncentive } from "@/lib/remittance";
import { normalizeMonthlyMaximum } from "@/lib/program-payment-limit.mjs";
import { assertUsernameColumnRemoved, loadUsers, readUserRows, USERS_RANGE } from "@/lib/users-sheet";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";

// Branches, programs and incentive tiers are in the database. Sign-in accounts (Users, Roles, User Roles) are read
// through the Sheets-style layer (lib/google-sheets.ts), which is answered by the database too.
// Members, enrollments, New Sales and beneficiaries moved to the database: lib/member-records.ts.

/* =========================================================
   PROGRAMS
========================================================= */

export type ProgramSheetData = {
  id: string;
  code: string;
  name: string;
  basePay: number;
  status: "active" | "inactive";
  description: string;
  registrationFeeRequired: boolean;
  registrationAmount: number;
  payBalanceTotal: number;
} & AgeRestriction;

export type BranchSheetData = {
  id: string;
  name: string;
  territory: string;
  barangay: string;
  cityMunicipality: string;
  province: string;
  country: string;
  postalCode: string;
  contactNumber: string;
  email: string;
  dateOpened: string;
  dateClosed: string;
  status: "active" | "inactive";
};

const { branches: branchTable, programs: programTable, program_incentives: incentiveTable } = schema;
const clean = (value: string | null | undefined) => (value ?? "").trim();

/** Highest number already used after `prefix-` among the IDs, plus one, padded to 4 digits: BR-0027, DP-0055. */
function nextId(prefix: string, ids: string[]) {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const highest = ids.reduce((max, id) => { const match = pattern.exec(id); return match ? Math.max(max, Number(match[1])) : max; }, 0);
  return `${prefix}-${String(highest + 1).padStart(4, "0")}`;
}

/* =========================================================
   BRANCHES
========================================================= */

const toBranch = (row: typeof branchTable.$inferSelect): BranchSheetData => ({
  id: row.branch_id, name: clean(row.branch_name_code), territory: clean(row.territory), barangay: clean(row.barangay),
  cityMunicipality: clean(row.city_municipality), province: clean(row.province), country: clean(row.country), postalCode: clean(row.postal_code),
  contactNumber: clean(row.contact_number), email: clean(row.email), dateOpened: row.date_opened ?? "", dateClosed: row.date_closed ?? "",
  status: clean(row.status).toLowerCase() === "inactive" ? "inactive" : "active",
});

export async function getBranches(): Promise<BranchSheetData[]> {
  return (await currentDb().select().from(branchTable).orderBy(asc(branchTable.branch_id))).map(toBranch);
}

export async function createBranch(data: {
  name: string;
  territory: string;
  barangay: string;
  cityMunicipality: string;
  province: string;
  country: string;
  postalCode: string;
  contactNumber: string;
  email: string;
  dateOpened: string;
  dateClosed: string;
  status: "active" | "inactive";
}): Promise<BranchSheetData> {
  const ids = (await currentDb().select({ id: branchTable.branch_id }).from(branchTable)).map((row) => row.id);
  const [row] = await currentDb().insert(branchTable).values({
    branch_id: nextId("BR", ids), branch_name_code: data.name.trim(), territory: data.territory.trim() || null, barangay: data.barangay.trim() || null,
    city_municipality: data.cityMunicipality.trim() || null, province: data.province.trim() || null, country: data.country.trim() || null,
    postal_code: data.postalCode.trim() || null, contact_number: data.contactNumber.trim() || null, email: data.email.trim() || null,
    date_opened: data.dateOpened.trim() || null, date_closed: data.dateClosed.trim() || null, status: data.status === "inactive" ? "inactive" : "active",
    ...encodedBy(),
  }).returning();
  return toBranch(row);
}

/* =========================================================
   PROGRAM INCENTIVES
========================================================= */

export type ProgramIncentiveSheetData = {
  id: string;
  programId: string;
  branchId?: string;
  role: "MAS" | "Collector";
  fromMonth: number;
  toMonth: number;
  incentiveType:
    | "fixed"
    | "percentage";
  markUp: number;
  incentiveAmount: number;
};

export type CreateProgramData = {
  /** The program's category (Program Categories). Blank = uncategorized. */
  categoryId?: string;
  /** Flexible payments: basePay is the minimum monthly payment, and incentives and coverage follow the amount paid. */
  flexible?: boolean;
  maxMonthlyPayment?: unknown;
  /** Whether encoders may type the amount on a New Sale / a Collection. False locks it to the program's amount. */
  newSaleAmountEditable?: boolean;
  collectionAmountEditable?: boolean;
  saleIncentiveType?: unknown;
  saleIncentiveAmount?: unknown;
  code: string;
  name: string;
  basePay: number;

  incentiveTiers: Array<{
    role: "MAS" | "Collector";
    fromMonth: number;
    toMonth: number;
    incentiveType:
      | "fixed"
      | "percentage";
    markUp: number;
    incentiveAmount: number;
    branchId?: string;
  }>;

  description: string;
  status: "active" | "inactive";
  registrationFeeRequired: boolean;
  registrationAmount: number;
  payBalanceTotal: number;
  // Raw form values; normalizeAgeRestriction validates them before saving.
  ageRestricted?: unknown;
  minAge?: unknown;
  maxAge?: unknown;
};

const toIncentive = (row: typeof incentiveTable.$inferSelect) => ({
  id: row.incentive_id,
  programId: row.program_id,
  role: clean(row.role).toLowerCase() === "collector" ? ("Collector" as const) : ("MAS" as const),
  fromMonth: row.from_month !== null && row.from_month >= 1 ? row.from_month : 1,
  toMonth: row.to_month !== null && row.to_month >= 1 ? row.to_month : 1,
  incentiveType: clean(row.incentive_type).toLowerCase() === "fixed" ? ("fixed" as const) : ("percentage" as const),
  // 0 is a valid mark-up and a valid incentive.
  markUp: row.mark_up ?? 0,
  incentiveAmount: row.incentive_amount ?? 0,
  // Blank for the base tiers, else the branch the tier is for.
  branchId: clean(row.branch_id),
  // Only the Collector earns in this period.
  nonCommissionable: row.non_commissionable === true,
});

/** Incentive tiers of one program, or of every program. */
export async function getProgramIncentives(programId?: string) {
  const id = clean(programId);
  const rows = await currentDb().select().from(incentiveTable).where(id ? eq(incentiveTable.program_id, id) : undefined).orderBy(asc(incentiveTable.from_month));
  return rows.map(toIncentive);
}

export async function addProgramIncentive(incentive: ProgramIncentiveSheetData) {
  const fromMonth = Number(incentive.fromMonth), toMonth = Number(incentive.toMonth), markUp = Number(incentive.markUp), incentiveAmount = Number(incentive.incentiveAmount);
  await currentDb().insert(incentiveTable).values({
    incentive_id: incentive.id, program_id: incentive.programId, role: incentive.role,
    from_month: Number.isFinite(fromMonth) && fromMonth >= 1 ? fromMonth : 1,
    to_month: Number.isFinite(toMonth) && toMonth >= 1 ? toMonth : 999999,
    incentive_type: incentive.incentiveType, mark_up: Number.isFinite(markUp) ? markUp : 0, incentive_amount: Number.isFinite(incentiveAmount) ? incentiveAmount : 0,
    branch_id: clean(incentive.branchId) || null, ...encodedBy(),
  });
}

/* =========================================================
   PROGRAMS
========================================================= */

const toProgram = (row: typeof programTable.$inferSelect) => {
  const ageRestricted = row.age_restricted;
  const saleIncentiveType = clean(row.new_sale_incentive_type);
  return {
    id: row.program_id,
    code: clean(row.program_code),
    name: clean(row.program_name),
    basePay: row.base_pay ?? 0,
    status: clean(row.status).toLowerCase() === "inactive" ? ("inactive" as const) : ("active" as const),
    description: row.description ?? "",
    registrationFeeRequired: row.registration_fee_required,
    registrationAmount: row.registration_amount ?? 0,
    payBalanceTotal: row.pay_balance_total ?? 0,
    ageRestricted,
    minAge: ageRestricted ? row.min_age : null,
    maxAge: ageRestricted ? row.max_age : null,
    // New Sale incentive for programs with a registration fee.
    saleIncentiveType: (["fixed", "percentage"].includes(saleIncentiveType) ? saleIncentiveType : "") as "fixed" | "percentage" | "",
    saleIncentiveAmount: row.new_sale_incentive_amount ?? 0,
    categoryId: clean(row.category_id),
    // False locks the amount to the program's own (lib/program-amount-lock.ts).
    newSaleAmountEditable: row.new_sale_amount_editable,
    collectionAmountEditable: row.collection_amount_editable,
    // Flexible payments: basePay is the minimum monthly payment; amounts follow what is paid.
    flexible: row.flexible,
    maxMonthlyPayment: row.max_monthly_payment ?? null,
  };
};

export async function getPrograms() {
  const [programRows, incentives] = await Promise.all([
    currentDb().select().from(programTable).orderBy(asc(programTable.program_id)),
    getProgramIncentives(),
  ]);
  return programRows.map((row) => ({
    ...toProgram(row),
    incentiveTiers: incentives.filter((incentive) => incentive.programId === row.program_id).sort((a, b) => a.fromMonth - b.fromMonth),
  }));
}

/** The program columns a create or an edit writes (everything but the ID and encoder). */
export function programColumns(data: Pick<CreateProgramData, "code" | "name" | "basePay" | "status" | "description" | "registrationFeeRequired" | "registrationAmount" | "payBalanceTotal" | "categoryId" | "newSaleAmountEditable" | "collectionAmountEditable" | "saleIncentiveType" | "saleIncentiveAmount" | "ageRestricted" | "minAge" | "maxAge" | "flexible" | "maxMonthlyPayment">) {
  const age = normalizeAgeRestriction(data);
  const saleIncentive = normalizeSaleIncentive(data);
  return {
    program_code: data.code.trim(), program_name: data.name.trim(), base_pay: Number(data.basePay) || 0, status: data.status === "inactive" ? "inactive" : "active",
    description: data.description.trim() || null, registration_fee_required: Boolean(data.registrationFeeRequired), registration_amount: Number(data.registrationAmount) || 0,
    pay_balance_total: Number(data.payBalanceTotal) || 0, age_restricted: age.ageRestricted, min_age: age.minAge, max_age: age.maxAge,
    max_monthly_payment: normalizeMonthlyMaximum(data),
    new_sale_incentive_type: saleIncentive.saleIncentiveType || null, new_sale_incentive_amount: saleIncentive.saleIncentiveType ? saleIncentive.saleIncentiveAmount : null,
    category_id: clean(data.categoryId) || null, new_sale_amount_editable: isTrue(data.newSaleAmountEditable), collection_amount_editable: isTrue(data.collectionAmountEditable), flexible: isTrue(data.flexible),
  };
}

/** Saves a new program (DP-0001, DP-0002, …) and its incentive tiers in one transaction. */
export async function createProgram(data: CreateProgramData) {
  return inTransaction(async (tx) => {
    const ids = (await tx.select({ id: programTable.program_id }).from(programTable)).map((row) => row.id);
    const [row] = await tx.insert(programTable).values({ program_id: nextId("DP", ids), ...programColumns(data), ...encodedBy() }).returning();
    // Base tiers (blank branch) and branch-specific tiers.
    await writeProgramIncentives(row.program_id, data.incentiveTiers);
    return { ...toProgram(row), incentiveTiers: await getProgramIncentives(row.program_id) };
  });
}

export type LoginRole = {
  id: string;
  name: string;
  manageUsers: boolean;
  manageAttendance: boolean;
  viewAttendanceReports: boolean;
  pages: string[] | null;
};

export type LoginUserData = {
  id: string;
  employeeId: string;
  fullName: string;
  passwordHash: string;
  roles: LoginRole[];
};

export type AttendanceEmployee = {
  employeeId: string;
  fullName: string;
};


function isEnabled(value: unknown) {
  return ["true", "yes", "1"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

export async function getLoginUserByEmployeeId(
  employeeId: string,
): Promise<LoginUserData | null> {
  const normalizedId = employeeId.trim().toUpperCase();
  if (!normalizedId) return null;

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: GOOGLE_SHEET_ID,
    ranges: [USERS_RANGE, "Roles!A:L", "'User Roles'!A:B"],
  });
  const { users } = readUserRows(response.data.valueRanges?.[0]?.values ?? []);
  const roles = response.data.valueRanges?.[1]?.values ?? [];
  const userRoles = response.data.valueRanges?.[2]?.values ?? [];

  const user = users.find((row) => row.employeeId.toUpperCase() === normalizedId && row.status === "active");
  if (!user) return null;

  const assignedRoleIds = new Set(
    userRoles
      .slice(1)
      .filter((row) => String(row[0] ?? "").trim() === user.id)
      .map((row) => String(row[1] ?? "").trim())
      .filter(Boolean),
  );

  const uniqueRoleIds = new Set<string>();
  const assignedRoles = roles
    .slice(1)
    .filter((row) => {
      const roleId = String(row[0] ?? "").trim();
      const status = String(row[6] ?? "").trim().toLowerCase();
      const allowed = assignedRoleIds.has(roleId) && status === "active" && !uniqueRoleIds.has(roleId);
      if (allowed) uniqueRoleIds.add(roleId);
      return allowed;
    })
    .map((row): LoginRole => ({
      id: String(row[0] ?? "").trim(),
      name: String(row[1] ?? "").trim(),
      manageUsers: isEnabled(row[3]),
      manageAttendance: isEnabled(row[4]),
      viewAttendanceReports: isEnabled(row[5]),
      pages: parsePageAccess(row[11]),
    }));

  return {
    id: user.id,
    employeeId: user.employeeId,
    fullName: user.fullName,
    passwordHash: user.passwordHash,
    roles: assignedRoles,
  };
}

export type AccountRole = {
  id: string;
  name: string;
};

export type CreateEmployeeAccountData = {
  employeeId?: string;
  fullName: string;
  passwordHash: string;
  roleIds: string[];
};

export async function getActiveAccountRoles(): Promise<
  AccountRole[]
> {
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "Roles!A:G",
    });

  const roles = (response.data.values ?? [])
    .slice(1)
    .filter((row) => {
      const status = String(row[6] ?? "")
        .trim()
        .toLowerCase();

      return (
        String(row[0] ?? "").trim() !== "" &&
        status === "active"
      );
    })
    .map((row) => ({
      id: String(row[0] ?? "").trim(),
      name: String(row[1] ?? "").trim(),
    }));
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const role of roles) {
    if (ids.has(role.id)) throw new Error(`Duplicate role ID ${role.id}. Run the roles migration before assigning accounts.`);
    const name=role.name.trim().toLowerCase();
    if(names.has(name))throw new Error(`Duplicate role name ${role.name}. Keep one canonical role before assigning accounts.`);
    ids.add(role.id);
    names.add(name);
  }
  return roles;
}

export async function createEmployeeAccount(
  data: CreateEmployeeAccountData,
) {
  const employeeId = (data.employeeId ?? "").trim().toUpperCase();
  const fullName = data.fullName.trim();

  if (!fullName) throw new Error("Full name is required.");
  if (!data.passwordHash) throw new Error("Password hash is required.");
  if (data.roleIds.length === 0) throw new Error("Select at least one role.");

  const [{ columns, users }, activeRoles] = await Promise.all([loadUsers(), getActiveAccountRoles()]);
  assertUsernameColumnRemoved(columns);

  if (!isEmployeeIdFormat(employeeId)) throw new Error(EMPLOYEE_ID_FORMAT_MESSAGE);
  // The Employee ID is the sign-in identifier, so each may hold only one account.
  if (users.some((user) => user.employeeId.toUpperCase() === employeeId)) throw new Error("This Employee ID already has a user account.");

  const activeRoleIds = new Set(activeRoles.map((role) => role.id));
  const roleIds = [...new Set(data.roleIds.map((roleId) => roleId.trim()).filter(Boolean))];
  if (roleIds.some((roleId) => !activeRoleIds.has(roleId))) throw new Error("One or more selected roles are invalid or inactive.");

  const highestUserNumber = users.reduce((highest, user) => {
    const match = /^USR-(\d+)$/.exec(user.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  const userId = `USR-${String(highestUserNumber + 1).padStart(4, "0")}`;
  const createdAt = new Date().toISOString().split("T")[0];

  const row: string[] = [];
  row[columns.id] = userId;
  row[columns.employeeId] = employeeId;
  row[columns.fullName] = fullName;
  row[columns.passwordHash] = data.passwordHash;
  row[columns.status] = "active";
  row[columns.createdAt] = createdAt;
  row[columns.roleId] = roleIds[0];

  await appendEncodedRows({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Users!A:G",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [Array.from(row, (value) => value ?? "")] },
  });

  await appendEncodedRows({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "User Roles!A:B",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: roleIds.map((roleId) => [userId, roleId]) },
  });

  return { id: userId, employeeId, fullName, roleIds };
}

export async function getActiveAttendanceEmployees(): Promise<
  AttendanceEmployee[]
> {
  const legacy = (await loadUsers()).users
    .filter((user) => user.status === "active")
    .map((user) => ({ employeeId: user.employeeId, fullName: user.fullName }))
    .filter((employee) => employee.employeeId !== "")
    .sort((first, second) =>
      first.fullName.localeCompare(second.fullName),
    );
  const employees = await getEmployees();
  const reviewed = new Set(employees.filter((e) => e.status).map((e) => e.id));
  const registered = employees.filter((e) => e.status.toLowerCase() === "active").map((e) => ({ employeeId: e.id, fullName: e.name }));
  return [...new Map([...legacy.filter((e) => !reviewed.has(e.employeeId)), ...registered].map((e) => [e.employeeId, e])).values()].sort((a, b) => a.fullName.localeCompare(b.fullName));

}
