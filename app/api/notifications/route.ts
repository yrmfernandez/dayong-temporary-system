import { getSessionUser } from "@/lib/auth-server";
import { getMaintenanceNotice } from "@/lib/maintenance-notice";
import { getNotificationCounts } from "@/lib/notifications";

/** Sidebar numbers: how many things wait for the signed-in user on each page they may open (lib/notifications.ts). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  try {
    // With the maintenance notice IT turned on, if any (lib/maintenance-notice.ts), shown at the top of every page.
    const [counts, maintenance] = await Promise.all([getNotificationCounts(user), getMaintenanceNotice()]);
    return Response.json({ success: true, counts, maintenance }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load notifications." }, { status: 500 });
  }
}
