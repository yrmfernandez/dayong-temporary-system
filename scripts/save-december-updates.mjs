/**
 * Saves the two System Updates for December 1, 2026 as DRAFTS: one for Entry Clerks, one for Finance, Finance-Auditor
 * and Administrators. They cover what starts that day: Mark remitted counts the whole handover (method first, then the
 * cash count; migration 0062), the cash on hand carried from confirmed cash counts, bank and e-wallet left out of cash,
 * and the cash position statement on reports. Nobody sees a draft; IT or an Administrator previews it in System Updates
 * and presses Announce on December 1, 2026. Run again, it changes nothing (a draft with the same title is kept as it is).
 *
 *   node scripts/save-december-updates.mjs                 (staging)
 *   npm run prod -- node scripts/save-december-updates.mjs (production)
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
    title: "December 1: Mark remitted counts the whole handover, and your cash on hand is carried",
    summary: "From today, Mark remitted is pressed once for everything a MAS hands over: New Sales and Collections together. It asks how they remitted (Cash, GCash, bank, or part cash and the rest GCash or bank) and you count the cash there, by bill and coin. Saving the batches no longer asks for Cash counted. Your report now starts from the cash you count and Finance confirms, and GCash or bank payments are not counted as cash.",
    audience: ["entry clerk"],
    steps: [
      { text: "This morning, count the cash you hold for your branch and record it on your daily report, Cash count tab. Finance confirms it; from then on your report starts from that cash by itself (no more typing Cash Beg).", path: "/reports/daily" },
      { text: "When a MAS hands over money, press Mark remitted at once on New Sales or Collections → Submitted by MAS. One window lists all their waiting batches in the branch, New Sales and Collections, ticked. Untick a batch they did not pay yet.", path: "/collections" },
      { text: "How did they remit? Press the method. If part is cash and the rest GCash or bank, press Add another method and enter the GCash or bank amount and its reference no.", path: "/collections" },
      { text: "Count the cash: type how many pieces of each bill and coin. The window shows Total received against Expected. If it is short or over, write a note (e.g. MAS to pay Monday); it can still be saved.", path: "/collections" },
      { text: "If the MAS already handed over earlier today, choose New handover now (its own count; now decides the incentive) or Part of the earlier handover (only if you forgot to mark it then; it keeps the earlier time).", path: "/collections" },
      { text: "Then type the OR numbers and details as usual and save each batch. The method is already set and there is no Cash counted to fill in. The short or over of the whole handover is recorded when its last batch is saved.", path: "/new-sales" },
      { text: "On your report, GCash and bank payments are shown as not cash and are not in your cash on hand. The GCash or bank part of a cash handover is listed with your bank records by itself.", path: "/reports/daily" },
    ],
  },
  {
    title: "December 1: cash counts to confirm, and reports show the cash position",
    summary: "From today each Entry Clerk's report starts from the cash they counted and you confirmed, so Remaining Cash on Hand is the real cash held. Confirm their cash counts in Remittances → Cash counts. Reports from December 1 use the cash position statement wording, and GCash and bank payments are left out of cash. A MAS handover is now counted once at Mark remitted, so its short or over comes to Discrepancy once, for New Sales and Collections together.",
    audience: ["finance", "finance-auditor", "administrator"],
    steps: [
      { text: "Open Remittances → Cash counts. For each clerk's cash count, compare it with what the system expected and press Confirm, or reject it so it is counted again. A difference needs a note. Not your own count.", path: "/remittances" },
      { text: "Until a clerk's first count is confirmed, their report says so and uses the typed Cash Beg. Once confirmed, every report from December 1 opens with the cash carried from it.", path: "/remittances" },
      { text: "Clerk reports for periods from December 1 show the cash position statement (Opening cash balance, Cash receipts, and so on). Same figures as before; earlier reports keep the old names.", path: "/reports/daily" },
      { text: "GCash and bank payments are shown as Bank / e-wallet (not cash, not counted) and are left out of cash on hand.", path: "/reports/daily" },
      { text: "Mark remitted now records one handover per MAS for New Sales and Collections, with how it was paid and the cash counted. A short or over shows once in Remittances → Discrepancy, labelled Handover count with the lines received; settle it at approval as before.", path: "/remittances" },
      { text: "The GCash or bank part of a MAS's cash handover appears in the clerk's Bank Deposits as Paid by MAS with handover, with its reference, so cash on hand is the cash counted.", path: "/reports/daily" },
    ],
  },
];

// The limits of the System Updates form (lib/system-updates.ts).
for (const update of updates) {
  if (update.title.length > 120 || update.summary.length > 600 || update.steps.length > 12 || update.steps.some((step) => step.text.length > 400)) throw new Error(`Too long for System Updates: ${update.title}`);
}

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
  console.log("Announce them in System Updates on December 1, 2026, after the code is pushed.");
} finally {
  await sql.end();
}
