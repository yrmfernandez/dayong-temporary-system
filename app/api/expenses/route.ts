import { refuseOnDayOff } from "@/lib/day-off";
import { canManageUsers, userWithPageAccess } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { createExpense, getFinanceData, voidFinanceRecord } from "@/lib/finance-data";
import { expensePhotoIds } from "@/lib/receipt-photos";

const denied = () => Response.json({ success: false, message: "You do not have access to Expenses." }, { status: 403 });

export async function GET() {
  if (!(await userWithPageAccess("/expenses"))) return denied();
  try {
    const [data, photoIds] = await Promise.all([getFinanceData(), expensePhotoIds()]);
    // Each expense's receipt photos, for the register's Receipt buttons.
    return Response.json({ success: true, expenses: data.expenses.map((expense) => ({ ...expense, photoIds: photoIds.get(expense.id) ?? [] })), canVoid: await canManageUsers() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load expenses." }, { status: 500 }); }
}

export const POST = withEncoder(async (request: Request) => {
  // Day Off locks the day's entries (lib/day-off.ts).
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  if (!(await userWithPageAccess("/expenses"))) return denied();
  try { return Response.json({ success: true, ...(await createExpense(await request.json())) }, { status: 201 }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save expense." }, { status: 400 }); }
});

export const PATCH = withEncoder(async (request: Request) => {
  // Day Off locks the day's entries (lib/day-off.ts).
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  if (!(await canManageUsers())) return Response.json({ success: false, message: "You are not allowed to void expenses." }, { status: 403 });
  try { const body = await request.json(); await voidFinanceRecord("expense", String(body.id ?? ""), String(body.reason ?? "")); return Response.json({ success: true }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to void expense." }, { status: 400 }); }
});
