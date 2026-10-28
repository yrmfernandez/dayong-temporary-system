/**
 * Old-sheet receipts the import held back (owner, October 28, 2026: "import it using the member corrections"). The
 * import (scripts/migrate-legacy-members.mjs --source-title=Data-Base-Old) holds back a new receipt whose account's
 * history in the database would then have a gap or an overlap, and writes them to backups/legacy-held-new-<stamp>.json.
 * This adds each through Member Corrections' Insert missing receipt (lib/member-corrections.ts insertReceipt): saved
 * Posted and Remitted with no slip, placed among the account's receipts by OR date, which are numbered again; the
 * incentive and company share follow the NOPs, the status is stored again, and the reason is in Record Corrections.
 * Prints row references, account IDs and coverage only (no member names).
 *
 *   npm run prod -- npx tsx --tsconfig tsconfig.json scripts/insert-held-legacy-receipts.mts backups/legacy-held-new-<stamp>.json            preview
 *   npm run prod -- npx tsx --tsconfig tsconfig.json scripts/insert-held-legacy-receipts.mts backups/legacy-held-new-<stamp>.json --apply    save
 *
 * A preview rolls each insert back, so a second receipt on the same account is previewed without the first; saving
 * adds them in OR-date order, each on the history the one before left.
 */
import { readFileSync } from "node:fs";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!file) throw new Error("Pass the backups/legacy-held-new-<stamp>.json file the import wrote.");
const apply = process.argv.includes("--apply");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "unknown";
const { runAsSystem } = await import("../lib/encoder-context");
const { insertReceipt } = await import("../lib/member-corrections");

type Held = { where: string; problem: string; enrollmentId: string; orNumber: string; orDate: string; amount: number; months: number; dateRemitted: string; mas: string; channel: string; reactivation: boolean };
const held = (JSON.parse(readFileSync(file, "utf8")) as Held[])
  .sort((a, b) => a.enrollmentId.localeCompare(b.enrollmentId) || a.orDate.localeCompare(b.orDate));
console.log(`${apply ? "SAVING" : "Preview"} on ${project}: ${held.length} held receipt(s) from ${file}\n`);

const perAccount = new Map<string, number>();
for (const receipt of held) perAccount.set(receipt.enrollmentId, (perAccount.get(receipt.enrollmentId) ?? 0) + 1);
let done = 0, failed = 0, renumbered = 0;
for (const receipt of held) {
  // A Date Remitted before the receipt is a typo: the receipt's date (the October 10 rule).
  const dateRemitted = receipt.dateRemitted && receipt.dateRemitted >= receipt.orDate ? receipt.dateRemitted : receipt.orDate;
  const reason = `Old sheet receipt (2026 DATABASE, ${receipt.where}) held back by the import: ${receipt.problem}`.slice(0, 300);
  try {
    const result = await runAsSystem(() => insertReceipt({
      enrollmentId: receipt.enrollmentId, orNumber: receipt.orNumber, orDate: receipt.orDate, amount: receipt.amount, months: receipt.months,
      collectedByRole: receipt.channel, mas: receipt.mas, dateRemitted, reactivation: receipt.reactivation,
    }, reason, apply));
    const [mine, ...others] = result.receipts;
    const status = result.statuses[0];
    done++; renumbered += others.length;
    console.log(`  ${receipt.where} → ${receipt.enrollmentId}: ${mine.after}; ${others.length} other receipt(s) renumbered; status ${status.before} → ${status.after}${(perAccount.get(receipt.enrollmentId) ?? 0) > 1 ? " (account has several held receipts)" : ""}`);
  } catch (error) {
    failed++;
    console.log(`  ${receipt.where} → ${receipt.enrollmentId}: NOT ${apply ? "saved" : "possible"}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`\n${apply ? "Saved" : "Would save"} ${done} of ${held.length}; ${renumbered} existing receipt(s) ${apply ? "renumbered" : "would be renumbered"}; ${failed} refused.`);
if (!apply) console.log("Preview only: every insert was rolled back. Add --apply to save.");
process.exit(0);
