import { createEmployeeAccount, getActiveAccountRoles } from "@/lib/google-sheets-data";
import { generateOneTimePassword, hashOneTimePassword, oneTimePasswordExpiry } from "@/lib/passwords";

const normalizeRole = (value: string) => value.trim().toLowerCase().replace(/^admin$/, "administrator").replace(/^hr$/, "hr officer");

/** Account roles whose names match an employee's roles. Employee roles are chosen from the Roles page, so all match. */
export function accountRoleIdsFor(employeeRoles: string[], roles: Array<{ id: string; name: string }>) {
  return roles.filter((role) => employeeRoles.some((employeeRole) => normalizeRole(employeeRole) === normalizeRole(role.name))).map((role) => role.id);
}

/**
 * Creates a sign-in account with a one-time password, which IT hands to the person; they choose their own at first sign-in. Roles default to those matching the employee's operational
 * roles; when none match (e.g. a role deactivated since) no account is made and the reason is returned instead.
 */
export async function createDefaultAccount(employee: { id: string; name: string; roles: string[] }, roleIds?: string[]) {
  const ids = roleIds?.length ? roleIds : accountRoleIdsFor(employee.roles, await getActiveAccountRoles());
  if (!ids.length) {
    return { created: false as const, reason: `No account role matches ${employee.roles.join(", ") || "the employee's roles"}. Create the account in User Accounts and choose its roles.` };
  }
  const oneTimePassword = generateOneTimePassword(), issuedAt = Date.now();
  const account = await createEmployeeAccount({ employeeId: employee.id, fullName: employee.name, passwordHash: await hashOneTimePassword(oneTimePassword, issuedAt), roleIds: ids });
  return { created: true as const, userId: account.id, roleIds: account.roleIds, oneTimePassword, expiresAt: oneTimePasswordExpiry(issuedAt) };
}
