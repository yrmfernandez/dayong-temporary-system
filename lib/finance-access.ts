import { canManageUsers, userWithPageAccess } from "@/lib/auth-server";

// Finance options (branches and cash accounts) serve every finance page and Settings → Organization,
// so opening any finance page, or managing users, is enough.
export async function canUseFinance() {
  return Boolean(await userWithPageAccess("/expenses", "/cash-transactions", "/vendor-payables", "/commissions", "/payroll")) || canManageUsers();
}
