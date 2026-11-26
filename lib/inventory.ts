import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { INVENTORY_CONDITIONS, type InventoryCondition, type InventoryItem } from "@/lib/inventory-rules";
import { createReadableId } from "@/lib/readable-id";

/**
 * Inventory (owner, November 26, 2026: "each entry clerks list their inventory and the admin/finance can see it").
 *
 * - An Entry Clerk keeps their own list per branch (their primary branch and the branches they clerk in Employees): name,
 *   category, quantity and unit, condition, an optional low-stock level and unit cost, and a note. Quantity is changed
 *   with + and − on the list; "Mark all as checked" stamps today on every item of a branch after a physical check.
 * - Administrators and Finance see every clerk's items (view only), with filters, totals and items not checked lately.
 * - Removing an item keeps its row (status Removed, with the reason), so nothing listed disappears without a trace; the
 *   Audit Log has every change (attach_audit_triggers in migration 0056).
 */
export { INVENTORY_CATEGORIES, INVENTORY_CONDITIONS, INVENTORY_UNITS, isLowStock, needsAttention, type InventoryCondition, type InventoryItem } from "@/lib/inventory-rules";

const { inventory_items: items } = schema;
const text = (value: unknown) => String(value ?? "").trim();
const same = (a: unknown, b: unknown) => text(a).toLowerCase() === text(b).toLowerCase();

const toItem = (row: typeof items.$inferSelect): InventoryItem => ({
  id: row.item_id, employeeId: row.employee_id, employeeName: text(row.employee_name), branch: row.branch, name: row.name, category: text(row.category),
  quantity: row.quantity, unit: text(row.unit), condition: (INVENTORY_CONDITIONS as readonly string[]).includes(row.condition) ? row.condition as InventoryCondition : "Good",
  minQuantity: row.min_quantity, unitCost: row.unit_cost === null ? null : Number(row.unit_cost), note: text(row.note), lastCheckedOn: text(row.last_checked_on),
  status: row.status === "Removed" ? "Removed" : "Active", removedReason: text(row.removed_reason), removedAt: text(row.removed_at), updatedAt: text(row.updated_at), addedAt: text(row.encoded_at),
});

/** A whole number from 0 to 1,000,000, or an error naming the field; blank gives `blank`. */
function wholeNumber(value: unknown, label: string, blank: number | null): number | null {
  if (value === null || value === undefined || text(value) === "") return blank;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 1_000_000) throw new Error(`${label} must be a whole number from 0.`);
  return number;
}

/** The fields a clerk types, checked. `partial` keeps fields that were not sent (for an edit). */
export function inventoryFields(input: Record<string, unknown>, partial = false) {
  const has = (key: string) => !partial || key in input;
  const fields: Partial<typeof items.$inferInsert> = {};
  if (has("name")) {
    const name = text(input.name).replace(/\s+/g, " ").slice(0, 120);
    if (name.length < 2) throw new Error("Type the item's name.");
    fields.name = name;
  }
  if (has("category")) fields.category = text(input.category).slice(0, 60) || null;
  if (has("quantity")) fields.quantity = wholeNumber(input.quantity, "Quantity", 0) ?? 0;
  if (has("unit")) fields.unit = text(input.unit).slice(0, 30) || null;
  if (has("condition")) {
    const condition = INVENTORY_CONDITIONS.find((item) => same(item, input.condition));
    if (!condition && text(input.condition)) throw new Error(`Condition is one of ${INVENTORY_CONDITIONS.join(", ")}.`);
    fields.condition = condition ?? "Good";
  }
  if (has("minQuantity")) fields.min_quantity = wholeNumber(input.minQuantity, "Low stock level", null);
  if (has("unitCost")) {
    const raw = text(input.unitCost).replace(/,/g, "");
    const cost = raw ? Math.round(Number(raw) * 100) / 100 : null;
    if (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > 9_999_999)) throw new Error("Unit cost must be an amount from 0.");
    fields.unit_cost = cost;
  }
  if (has("note")) fields.note = text(input.note).slice(0, 300) || null;
  return fields;
}

/** The branches a clerk lists inventory for: their primary branch and the branches they clerk (Employees). */
export async function inventoryBranches(employeeId: string) {
  const [employees, branches] = await Promise.all([getEmployees(), getBranches()]);
  const employee = employees.find((item) => item.id === employeeId);
  const assigned = branches.filter((branch) => employee?.clerkBranchIds.includes(branch.id)).map((branch) => branch.name);
  const names = [...new Map([employee?.branch ?? "", ...assigned].map(text).filter(Boolean).map((name) => [name.toLowerCase(), name])).values()];
  return { primary: text(employee?.branch) || names[0] || "", names, name: text(employee?.name) };
}

/** One clerk's items (`employeeId`), or every clerk's; removed ones only when asked. Small table, read whole. */
export async function listInventory(options: { employeeId?: string; includeRemoved?: boolean } = {}): Promise<InventoryItem[]> {
  const where = and(options.employeeId ? eq(items.employee_id, options.employeeId) : undefined, options.includeRemoved ? undefined : eq(items.status, "Active"));
  const rows = await getDb().select().from(items).where(where).orderBy(asc(items.branch), asc(items.name), asc(items.row_seq));
  return rows.map(toItem);
}

async function ownItem(id: string, employeeId: string) {
  const [row] = await getDb().select().from(items).where(eq(items.item_id, text(id)));
  if (!row) throw new Error("Item not found. Refresh the list.");
  if (row.employee_id !== employeeId) throw new Error("Only the clerk who listed this item changes it.");
  return row;
}

/** A clerk adds an item to their list for one of their branches. The same name in the same branch is refused. */
export async function addInventoryItem(clerk: { employeeId: string; name: string }, input: Record<string, unknown>) {
  const fields = inventoryFields(input);
  const { names, primary } = await inventoryBranches(clerk.employeeId);
  const branch = names.find((name) => same(name, input.branch)) ?? (text(input.branch) ? "" : primary);
  if (!branch) throw new Error(names.length ? "Choose one of your branches." : "You have no branch yet. Ask an administrator to set your branch in Employees.");
  const existing = await getDb().select({ id: items.item_id, name: items.name, branch: items.branch }).from(items)
    .where(and(eq(items.employee_id, clerk.employeeId), eq(items.status, "Active")));
  const duplicate = existing.find((row) => same(row.name, fields.name) && same(row.branch, branch));
  if (duplicate) throw new Error(`${duplicate.name} is already on your ${branch} list. Change its quantity there instead.`);
  const actor = getEncoder();
  const id = createReadableId("INV");
  await getDb().insert(items).values({
    ...fields, item_id: id, employee_id: clerk.employeeId, employee_name: clerk.name, branch, name: fields.name!, quantity: fields.quantity ?? 0, condition: fields.condition ?? "Good",
    status: "Active", last_checked_on: null, updated_at: actor.encodedAt,
    encoded_by_user_id: actor.userId, encoded_by_employee_id: actor.employeeId, encoded_by_name: actor.name, encoded_at: actor.encodedAt,
  });
  return toItem((await getDb().select().from(items).where(eq(items.item_id, id)))[0]);
}

/** A clerk edits their own active item: any of the typed fields, or only the quantity (+ and −). */
export async function updateInventoryItem(employeeId: string, id: string, input: Record<string, unknown>) {
  const row = await ownItem(id, employeeId);
  if (row.status !== "Active") throw new Error("This item was removed. Restore it first.");
  const fields = inventoryFields(input, true);
  if (fields.name && !same(fields.name, row.name)) {
    const others = await getDb().select({ id: items.item_id, name: items.name, branch: items.branch }).from(items).where(and(eq(items.employee_id, employeeId), eq(items.status, "Active")));
    if (others.some((other) => other.id !== row.item_id && same(other.name, fields.name) && same(other.branch, row.branch))) throw new Error(`${fields.name} is already on your ${row.branch} list.`);
  }
  const [saved] = await getDb().update(items).set({ ...fields, updated_at: getEncoder().encodedAt }).where(eq(items.item_id, row.item_id)).returning();
  return toItem(saved);
}

/** Removes an item from the clerk's list, with the reason (kept), or restores a removed one. */
export async function setInventoryItemRemoved(employeeId: string, id: string, removed: boolean, reason = "") {
  const row = await ownItem(id, employeeId);
  const actor = getEncoder();
  if (removed) {
    if (row.status === "Removed") throw new Error("This item is already removed.");
    if (text(reason).length < 3) throw new Error("Say why the item is removed (used up, disposed, transferred...).");
    const [saved] = await getDb().update(items).set({ status: "Removed", removed_reason: text(reason).slice(0, 200), removed_at: actor.encodedAt, updated_at: actor.encodedAt }).where(eq(items.item_id, row.item_id)).returning();
    return toItem(saved);
  }
  if (row.status === "Active") throw new Error("This item is already on your list.");
  const active = await getDb().select({ name: items.name, branch: items.branch }).from(items).where(and(eq(items.employee_id, employeeId), eq(items.status, "Active")));
  if (active.some((other) => same(other.name, row.name) && same(other.branch, row.branch))) throw new Error(`${row.name} is already on your ${row.branch} list again.`);
  const [saved] = await getDb().update(items).set({ status: "Active", removed_reason: null, removed_at: null, updated_at: actor.encodedAt }).where(eq(items.item_id, row.item_id)).returning();
  return toItem(saved);
}

/** After a physical check, stamps `today` on the clerk's active items of a branch (or the given items). Returns how many. */
export async function markInventoryChecked(employeeId: string, today: string, options: { branch?: string; ids?: string[] } = {}) {
  const mine = await getDb().select({ id: items.item_id, branch: items.branch }).from(items).where(and(eq(items.employee_id, employeeId), eq(items.status, "Active")));
  const wanted = new Set((options.ids ?? []).map(text));
  const ids = mine.filter((row) => (wanted.size ? wanted.has(row.id) : !text(options.branch) || same(row.branch, options.branch))).map((row) => row.id);
  if (!ids.length) throw new Error("No item to mark as checked.");
  await getDb().update(items).set({ last_checked_on: today }).where(inArray(items.item_id, ids));
  return ids.length;
}
