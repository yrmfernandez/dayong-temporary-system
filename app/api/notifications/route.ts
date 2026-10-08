import { getSessionUser } from "@/lib/auth-server";
import { getNotificationCounts } from "@/lib/notifications";

/** Sidebar numbers: how many things wait for the signed-in user on each page they may open (lib/notifications.ts). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  try {
    return Response.json({ success: true, counts: await getNotificationCounts(user) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load notifications." }, { status: 500 });
  }
}
