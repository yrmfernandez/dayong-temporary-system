import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { columnName } from "@/lib/encoder-schema";
import { canonicalHeader } from "@/lib/sheet-headers";

// Users columns are located by header so reads survive the removal of the legacy username column.
export const USERS_RANGE = "Users!A:Z";

const fields = {
  id: ["user_id"],
  employeeId: ["employee_id"],
  fullName: ["full_name"],
  passwordHash: ["password_hash"],
  status: ["status"],
  createdAt: ["created_at", "date_created"],
  roleId: ["role_id", "primary_role_id"],
} as const;

export type UserColumns = Record<keyof typeof fields, number> & { legacyUsername: number };

export type UserRecord = {
  rowNumber: number;
  id: string;
  employeeId: string;
  fullName: string;
  passwordHash: string;
  status: string;
  createdAt: string;
  roleId: string;
};

const text = (value: unknown) => String(value ?? "").trim();

// Layout written by npm run sheets:employee-login; used when a sheet has no header row yet.
const standardColumns: UserColumns = { id: 0, employeeId: 1, fullName: 2, passwordHash: 3, status: 4, createdAt: 5, roleId: 6, legacyUsername: -1 };

export function userColumns(header: unknown[]): UserColumns {
  const names = header.map(canonicalHeader);
  if (!names.some(Boolean)) return standardColumns;
  const columns = Object.fromEntries(Object.entries(fields).map(([key, aliases]) => {
    const index = names.findIndex((name) => (aliases as readonly string[]).includes(name));
    if (index < 0) throw new Error(`The Users sheet is missing its ${aliases[0]} column.`);
    return [key, index];
  })) as Record<keyof typeof fields, number>;
  return { ...columns, legacyUsername: names.indexOf("username") };
}

export function readUserRows(rows: unknown[][]) {
  const columns = userColumns(rows[0] ?? []);
  const users: UserRecord[] = rows.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    id: text(row[columns.id]),
    employeeId: text(row[columns.employeeId]),
    fullName: text(row[columns.fullName]),
    passwordHash: text(row[columns.passwordHash]),
    status: text(row[columns.status]).toLowerCase(),
    createdAt: text(row[columns.createdAt]),
    roleId: text(row[columns.roleId]),
  })).filter((user) => user.id);
  return { columns, users };
}

export async function loadUsers() {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: USERS_RANGE });
  return readUserRows(response.data.values ?? []);
}

export const userCell = (column: number, rowNumber: number) => `Users!${columnName(column + 1)}${rowNumber}`;

export function assertUsernameColumnRemoved(columns: UserColumns) {
  if (columns.legacyUsername >= 0) throw new Error("Run npm run sheets:employee-login -- --apply to remove the legacy username column before creating accounts.");
}
