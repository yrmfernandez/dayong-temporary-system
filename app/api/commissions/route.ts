import { userWithPageAccess } from "@/lib/auth-server";
import { getEarnedCommissions } from "@/lib/earned-commissions";
import { withEncoder } from "@/lib/encoder-context";
import { createCommission, getCommissions, payCommissionDirectly } from "@/lib/finance-operations";
import { manilaToday, validDate } from "@/lib/manila-date";

const denied = () => Response.json({ success: false, message: "You do not have access to Commissions." }, { status: 403 });
const allowed = () => userWithPageAccess("/commissions");

// The register, plus what each commission earner actually earned in the chosen period (default: this month).
export async function GET(request: Request) {
  if (!(await allowed())) return denied();
  try {
    const params = new URL(request.url).searchParams;
    const today = manilaToday();
    const from = validDate(params.get("from") ?? "") ? params.get("from")! : `${today.slice(0, 7)}-01`;
    const to = validDate(params.get("to") ?? "") ? params.get("to")! : today;
    if (from > to) throw new Error("Choose a valid period.");
    const [commissions, earned] = await Promise.all([getCommissions(), getEarnedCommissions(from, to)]);
    return Response.json({ success: true, from, to, commissions, earned }, { headers: { "Cache-Control": "private, no-store" } });
  }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load commissions." }, { status: 500 }); }
}

export const POST = withEncoder(async (request: Request) => {
  if (!(await allowed())) return denied();
  try { return Response.json({ success: true, ...await createCommission(await request.json()) }, { status: 201 }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to create commission." }, { status: 400 }); }
});

export const PATCH = withEncoder(async (request: Request) => {
  if (!(await allowed())) return denied();
  try { const body = await request.json(); return Response.json({ success: true, ...await payCommissionDirectly(String(body.id ?? ""), { referenceNumber: body.referenceNumber, account: body.account, branch: body.branch, date: body.date }) }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to pay commission." }, { status: 400 }); }
});
