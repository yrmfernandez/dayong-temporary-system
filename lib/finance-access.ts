import { getSessionUser } from "@/lib/auth-server";

export async function canUseFinance() {
  const user = await getSessionUser();
  if (!user) return false;
  return user.roleNames.some((role) => ["administrator", "admin", "finance", "ceo", "president"].includes(role.trim().toLowerCase())) || user.permissions.manageUsers;
}
