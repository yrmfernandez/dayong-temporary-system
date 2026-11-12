import { getRealSessionUser, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { navPageChoices } from "@/lib/navigation";
import { allUpdates, canManageUpdatesFor, deleteUpdate, markUpdateSeen, saveUpdate, setAnnounced, updateRoleChoices, updatesForUser } from "@/lib/system-updates";

const fail = (error: unknown, fallback: string, status = 400) => Response.json({ success: false, message: error instanceof Error ? error.message : fallback }, { status });

/**
 * System Updates (lib/system-updates.ts). GET: the announced updates for the signed-in user; IT and Administrators also
 * get every update (drafts too), the roles and the pages a step can open.
 */
export async function GET() {
  const [user, real] = await Promise.all([getSessionUser(), getRealSessionUser()]);
  if (!user || !real) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  try {
    // The updates follow all the user's roles, whatever workspace is open; the page buttons follow the open one.
    const updates = await updatesForUser({ ...user, roleNames: real.roleNames });
    const manage = canManageUpdatesFor(user);
    return Response.json({
      success: true, updates, canManage: manage,
      ...(manage ? { all: await allUpdates(), roles: await updateRoleChoices(), pages: navPageChoices() } : {}),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return fail(error, "Unable to load the updates.", 500); }
}

/** IT saves an update: a new draft ({ title, summary, steps, audience }), or changes to one ({ id, ... }). */
export const POST = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !canManageUpdatesFor(user)) return Response.json({ success: false, message: "Only IT and administrators write system updates." }, { status: 403 });
  try {
    const update = await saveUpdate(await request.json());
    return Response.json({ success: true, update, message: update.status === "Announced" ? "Update changed. Those who saw it are not shown the pop-up again." : "Draft saved. Announce it when it is ready." });
  } catch (error) { return fail(error, "Unable to save the update."); }
});

/**
 * { action: "seen" | "opened", id }: the user closed the pop-up or opened the update. IT: { action: "announce" |
 * "withdraw" | "delete", id }.
 */
export const PATCH = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  try {
    const body = await request.json() as { action?: unknown; id?: unknown };
    const action = String(body.action ?? ""), id = String(body.id ?? "");
    if (action === "seen" || action === "opened") { await markUpdateSeen(user.userId, id, action === "opened"); return Response.json({ success: true }); }
    if (!canManageUpdatesFor(user)) return Response.json({ success: false, message: "Only IT and administrators announce system updates." }, { status: 403 });
    if (action === "announce") return Response.json({ success: true, update: await setAnnounced(id, true, user.name), message: "Announced. Everyone it is for gets the pop-up on their next page or within two minutes." });
    if (action === "withdraw") return Response.json({ success: true, update: await setAnnounced(id, false, user.name), message: "Taken back to a draft: it no longer shows to anyone." });
    if (action === "delete") { await deleteUpdate(id); return Response.json({ success: true, message: "Draft deleted." }); }
    throw new Error("Choose announce, take back or delete.");
  } catch (error) { return fail(error, "Unable to update."); }
});
