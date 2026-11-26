import { canAccessPath, canOverseeInventory } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { addInventoryItem, INVENTORY_CATEGORIES, INVENTORY_CONDITIONS, INVENTORY_UNITS, inventoryBranches, listInventory, markInventoryChecked, setInventoryItemRemoved, updateInventoryItem } from "@/lib/inventory";
import { manilaToday } from "@/lib/manila-date";

const noStore = { "Cache-Control": "private, no-store" };
const failure = (error: unknown, fallback: string, status = 400) => Response.json({ success: false, message: error instanceof Error ? error.message : fallback }, { status });
const denied = () => failure(null, "You do not have access to Inventory.", 403);

/**
 * Inventory (lib/inventory.ts). GET ?view=mine|all&removed=1: the signed-in clerk's own list with their branches, or,
 * for Administrators and Finance (canOverseeInventory), every clerk's (view only). POST adds an item to one's own list.
 * PATCH { action: "update" | "remove" | "restore" | "check", id, ... } changes one's own items only.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/inventory")) return denied();
  try {
    const params = new URL(request.url).searchParams;
    const canOversee = canOverseeInventory(user);
    const view = canOversee && params.get("view") !== "mine" ? "all" : "mine";
    const includeRemoved = params.get("removed") === "1";
    const [items, own] = await Promise.all([
      listInventory({ employeeId: view === "all" ? "" : user.employeeId, includeRemoved }),
      inventoryBranches(user.employeeId),
    ]);
    return Response.json({
      success: true, view, canOversee, today: manilaToday(), items,
      branches: own.names, primaryBranch: own.primary,
      conditions: INVENTORY_CONDITIONS, categories: INVENTORY_CATEGORIES, units: INVENTORY_UNITS,
    }, { headers: noStore });
  } catch (error) { return failure(error, "Unable to load the inventory.", 500); }
}

export const POST = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/inventory")) return denied();
  try {
    const body = await request.json() as Record<string, unknown>;
    const own = await inventoryBranches(user.employeeId);
    const item = await addInventoryItem({ employeeId: user.employeeId, name: own.name || user.name }, body);
    return Response.json({ success: true, item, message: `${item.name} added to your ${item.branch} inventory.` });
  } catch (error) { return failure(error, "Unable to add the item."); }
});

export const PATCH = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/inventory")) return denied();
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = String(body.id ?? "");
    switch (body.action) {
      case "update": {
        const { action: _action, id: _id, ...fields } = body;
        void _action; void _id;
        const item = await updateInventoryItem(user.employeeId, id, fields);
        return Response.json({ success: true, item, message: `${item.name} saved.` });
      }
      case "remove": {
        const item = await setInventoryItemRemoved(user.employeeId, id, true, String(body.reason ?? ""));
        return Response.json({ success: true, item, message: `${item.name} removed from your list. Show removed items to restore it.` });
      }
      case "restore": {
        const item = await setInventoryItemRemoved(user.employeeId, id, false);
        return Response.json({ success: true, item, message: `${item.name} is back on your list.` });
      }
      case "check": {
        const ids = Array.isArray(body.ids) ? body.ids.map(String) : undefined;
        const count = await markInventoryChecked(user.employeeId, manilaToday(), { branch: String(body.branch ?? ""), ids });
        return Response.json({ success: true, message: `${count} item${count === 1 ? "" : "s"} marked as checked today.` });
      }
      default: throw new Error("Unknown action.");
    }
  } catch (error) { return failure(error, "Unable to save the change."); }
});
