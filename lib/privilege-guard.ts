import { isAdministratorRole } from "@/lib/access-control";
import { canManageUsers } from "@/lib/auth-server";
import { getUserAccounts } from "@/lib/master-data-crud";
import { getRoles } from "@/lib/roles";

/**
 * IT manages accounts and roles, but only an administrator (or a `manage_users` holder) may hand out administrator-level
 * power: the Administrator role, or any role with `manage_users`, which approves remittances and voids finance records.
 * Otherwise an IT account could promote itself. Returns an error message, or "" when the change is allowed.
 */
async function privilegedRoleIds() {
  return new Set((await getRoles()).filter((role) => role.manageUsers || isAdministratorRole(role.name)).map((role) => role.id));
}

export async function guardAccountChange(input: { roleIds?: string[]; accountId?: string }) {
  if (await canManageUsers()) return "";
  const privileged = await privilegedRoleIds();
  if (input.roleIds?.some((id) => privileged.has(id))) return "Only an administrator can assign the Administrator role or a role that manages users.";
  if (input.accountId) {
    const account = (await getUserAccounts()).find((item) => item.id === input.accountId);
    if (account?.roleIds.some((id) => privileged.has(id))) return "Only an administrator can change, reset, or delete an administrator's account.";
  }
  return "";
}

export async function guardRoleChange(input: { roleId?: string; name?: unknown; manageUsers?: unknown }) {
  if (await canManageUsers()) return "";
  if (input.manageUsers === true || (typeof input.name === "string" && isAdministratorRole(input.name))) return "Only an administrator can create or grant the Administrator role or the manage users permission.";
  if (input.roleId && (await privilegedRoleIds()).has(input.roleId)) return "Only an administrator can change or delete the Administrator role or a role that manages users.";
  return "";
}
