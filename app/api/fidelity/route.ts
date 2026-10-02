import { getSessionUser } from "@/lib/auth-server";
import { getFidelityData, withdrawFidelity } from "@/lib/fidelity";
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

/** Finance or an Administrator records money paid out: an excess withdrawal, or the full release when an employee leaves. */
export const PATCH = withEncoder(async (request: Request) => {
  const user = await getSessionUser(), roles = user?.roleNames.map((role) => role.trim().toLowerCase()) ?? [];
  if (!user || !roles.some((role) => ["administrator", "admin", "finance"].includes(role))) return Response.json({ success: false, message: "Finance or Administrator access is required to record a Fidelity withdrawal." }, { status: 403 });
  try {
    const body = await request.json();
    const result = await withdrawFidelity(String(body.masEmployeeId ?? ""), String(body.kind ?? ""), Number(body.amount), String(body.notes ?? ""));
    return Response.json({ success: true, message: `${result.type} of ${result.amount.toLocaleString("en-PH", { style: "currency", currency: "PHP" })} recorded for ${result.masName}.` });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to record the Fidelity withdrawal." }, { status: 400 });
  }
});
