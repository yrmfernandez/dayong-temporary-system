import { getSessionUser } from "@/lib/auth-server";
import { claimFidelity, getFidelityData } from "@/lib/fidelity";
import { withEncoder } from "@/lib/encoder-context";

// ?scope=me always returns only the signed-in employee's own Fidelity (the "My Fidelity" page),
// even for roles that may monitor every MAS.
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  const roles = user.roleNames.map((role) => role.trim().toLowerCase());
  if (!roles.length) return Response.json({ success: false, message: "You do not have access to Fidelity." }, { status: 403 });
  const personal = new URL(request.url).searchParams.get("scope") === "me";
  const canMonitor = roles.some((role) => ["administrator", "admin", "finance", "ceo", "president"].includes(role));
  const viewAll = canMonitor && !personal;
  const canClaim = !personal && roles.some((role) => ["administrator", "admin", "finance"].includes(role));
  try {
    return Response.json(
      { success: true, canViewAll: viewAll, canMonitor, canClaim, currentEmployeeId: user.employeeId, currentName: user.name, ...await getFidelityData(user.employeeId, viewAll) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load Fidelity." }, { status: 500 });
  }
}

export const PATCH = withEncoder(async (request: Request) => {
  const user = await getSessionUser(), roles = user?.roleNames.map((role) => role.trim().toLowerCase()) ?? [];
  if (!user || !roles.some((role) => ["administrator", "admin", "finance"].includes(role))) return Response.json({ success: false, message: "Finance or Administrator access is required to record a claim." }, { status: 403 });
  try {
    const body = await request.json(), result = await claimFidelity(String(body.masEmployeeId ?? ""), String(body.notes ?? ""));
    return Response.json({ success: true, message: `${result.amount.toLocaleString("en-PH", { style: "currency", currency: "PHP" })} Fidelity claim recorded. The MAS balance is reset to zero.` });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to record Fidelity claim." }, { status: 400 });
  }
});
