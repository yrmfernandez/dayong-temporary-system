/** Inventory rules shared by the page and the server (lib/inventory.ts); no database here. */
export const INVENTORY_CONDITIONS = ["Good", "Needs repair", "Damaged", "Missing"] as const;
export type InventoryCondition = (typeof INVENTORY_CONDITIONS)[number];
/** Offered as suggestions; any category may be typed. */
export const INVENTORY_CATEGORIES = ["Office supplies", "Forms & receipts", "Equipment", "Furniture", "Cleaning", "Other"];
export const INVENTORY_UNITS = ["pcs", "box", "pack", "ream", "booklet", "set", "unit", "bottle"];

export type InventoryItem = {
  id: string; employeeId: string; employeeName: string; branch: string; name: string; category: string; quantity: number; unit: string;
  condition: InventoryCondition; minQuantity: number | null; unitCost: number | null; note: string; lastCheckedOn: string;
  status: "Active" | "Removed"; removedReason: string; removedAt: string; updatedAt: string; addedAt: string;
};

/** Whether an item needs attention: not in good condition, or at or below its low-stock level. */
export function needsAttention(item: Pick<InventoryItem, "condition" | "quantity" | "minQuantity">) {
  return item.condition !== "Good" || isLowStock(item);
}
export const isLowStock = (item: Pick<InventoryItem, "quantity" | "minQuantity">) => item.minQuantity !== null && item.quantity <= item.minQuantity;

/** Days after which an item not checked is flagged on the overview. */
export const CHECK_EVERY_DAYS = 30;
/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
/** Never checked, or last checked more than CHECK_EVERY_DAYS before `today`. */
export const checkOverdue = (lastCheckedOn: string, today: string) => !lastCheckedOn || daysBetween(lastCheckedOn, today) > CHECK_EVERY_DAYS;
