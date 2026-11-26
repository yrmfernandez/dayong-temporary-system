/**
 * Saves the two System Updates for Inventory (November 26, 2026) as DRAFTS: one for Entry Clerks, one for Finance,
 * Finance-Auditor and Administrators. Nobody sees a draft; IT or an Administrator previews it in System Updates and
 * presses Announce after migration 0056 is on production and the code is pushed. Run again, it changes nothing (a draft
 * with the same title is kept as it is).
 *
 *   node scripts/save-inventory-updates.mjs                 (staging)
 *   npm run prod -- node scripts/save-inventory-updates.mjs (production)
 */
import nextEnv from "@next/env";
import crypto from "node:crypto";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";

const updates = [
  {
    title: "New: Inventory, your own list of branch supplies",
    summary: "Inventory is a new section in your menu. List what you keep for your branch (receipt booklets, forms, supplies, equipment) with how many and their condition. Use + and − when you use or receive some, and Mark all as checked today after you count everything. Finance and the Administrators see your list.",
    audience: ["entry clerk"],
    steps: [
      { text: "Open Inventory in your menu (its own section).", path: "/inventory" },
      { text: "Under Add an item, type the item name, set the quantity with − and +, then the unit, category and condition, and press Add item. The form stays ready for the next item.", path: "/inventory" },
      { text: "Optional: press More details for the branch (if you have more than one), a low stock alert (e.g. alert at 5), the unit cost and a note such as a serial number.", path: "/inventory" },
      { text: "When you use or receive some, tap − or + on the item, or type the new number. It saves by itself.", path: "/inventory" },
      { text: "If an item gets damaged or lost, change its condition on the row. If it is used up or given away, press the trash icon and say why; it can be restored from Show removed.", path: "/inventory" },
      { text: "After counting everything, press Mark all as checked today. Please check your list at least once a month.", path: "/inventory" },
    ],
  },
  {
    title: "New: Inventory of every Entry Clerk",
    summary: "Inventory is a new section in your menu. It shows every Entry Clerk's list of branch supplies and equipment, by branch and clerk: quantity, condition, low stock, value and when it was last checked. View only; each clerk keeps their own list. You can filter and download it as CSV.",
    audience: ["finance", "finance-auditor", "administrator"],
    steps: [
      { text: "Open Inventory in your menu (its own section). Every clerk's items are grouped by branch and clerk.", path: "/inventory" },
      { text: "Filter by branch, clerk or category, or search an item. Needs attention shows low stock and items not in good condition; Not checked lately shows lists not checked in 30 days.", path: "/inventory" },
      { text: "Click a tile at the top (Need attention, Not checked) to filter by it. Tick Show removed to see removed items and why.", path: "/inventory" },
      { text: "Press Download CSV to save what is shown.", path: "/inventory" },
    ],
  },
];

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  console.log(`Supabase project: ${project}`);
  const now = new Date().toISOString();
  for (const update of updates) {
    const [existing] = await sql`select update_id, status from system_updates where title = ${update.title} limit 1`;
    if (existing) { console.log(`Kept: ${existing.update_id} (${existing.status}) ${update.title}`); continue; }
    const stamp = now.replace(/\D/g, "").slice(0, 14), id = `UPD-${stamp}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    await sql`insert into system_updates (update_id, title, summary, steps, audience, status, created_at, updated_at, encoded_by_name, encoded_at)
      values (${id}, ${update.title}, ${update.summary}, ${sql.json(update.steps)}, ${sql.json(update.audience)}, 'Draft', ${now}, ${now}, 'System (script)', ${now})`;
    console.log(`Saved draft: ${id} for ${update.audience.join(", ")}: ${update.title}`);
  }
  console.log("Announce them in System Updates after migration 0056 is on production and the code is pushed.");
} finally {
  await sql.end();
}
