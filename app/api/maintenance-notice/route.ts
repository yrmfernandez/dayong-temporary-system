import { canManageConfigurationFor } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { getMaintenanceNotice, setMaintenanceNotice } from "@/lib/maintenance-notice";

/** The maintenance notice every signed-in user sees (lib/maintenance-notice.ts). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  return Response.json({ success: true, notice: await getMaintenanceNotice() }, { headers: { "Cache-Control": "private, no-store" } });
}

/** IT and administrators turn it on ({ on: true, message }) or off ({ on: false }). */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || !canManageConfigurationFor(user)) return Response.json({ success: false, message: "Only IT and administrators can change the maintenance notice." }, { status: 403 });
  try {
    const body = await request.json() as { on?: unknown; message?: unknown };
    const notice = await setMaintenanceNotice(body.on === true, body.message, user.name);
    return Response.json({ success: true, notice, message: notice.on ? "Everyone now sees the maintenance notice." : "The maintenance notice is off." });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save the notice." }, { status: 400 });
  }
}
