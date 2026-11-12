import { getRealSessionUser, getSessionUser } from "@/lib/auth-server";
import { getMaintenanceNotice } from "@/lib/maintenance-notice";
import { getNotificationCounts } from "@/lib/notifications";
import { nextUnseenUpdate } from "@/lib/system-updates";

/** Sidebar numbers: how many things wait for the signed-in user on each page they may open (lib/notifications.ts). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  try {
    // With the maintenance notice IT turned on, if any (lib/maintenance-notice.ts), shown at the top of every page.
    // And the System Update not seen yet, for its pop-up (lib/system-updates.ts, November 12, 2026).
    const [counts, maintenance, update] = await Promise.all([getNotificationCounts(user), getMaintenanceNotice(), nextUnseenUpdate((await getRealSessionUser()) ?? user).catch(() => null)]);
    return Response.json({ success: true, counts, maintenance, update }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load notifications." }, { status: 500 });
  }
}
