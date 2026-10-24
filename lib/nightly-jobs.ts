import { syncAccountStatuses } from "@/lib/account-data";
import { closeFinishedAttendanceDays } from "@/lib/auto-absence";
import { runAsSystem } from "@/lib/encoder-context";
import { findExceptions } from "@/lib/exceptions";
import { getSetting, saveSetting } from "@/lib/system-settings";

/**
 * Nightly jobs (owner, October 24, 2026; upgrade #2). Until now these ran only when someone opened a page, so the
 * dashboards could show stale figures. Vercel Cron calls /api/cron/nightly once a night after midnight Manila
 * (vercel.json); IT can also run it from System Health. Each step runs even if an earlier one failed, and the result
 * is kept in System Settings (`nightly_last_run`) for System Health.
 *
 * 1. Attendance: records the system absences (and carried-over No attendance needed) for finished days.
 * 2. Account statuses: stores each account's current status (Active, 60D, Suspended, Forfeited, ...) where it changed.
 * 3. Exceptions: counts the data problems, so IT sees the number without opening the page (nothing is changed).
 */
export const NIGHTLY_KEY = "nightly_last_run";

export type NightlyStep = { name: string; ok: boolean; detail: string; ms: number };
export type NightlyRun = { startedAt: string; finishedAt: string; trigger: string; ok: boolean; steps: NightlyStep[] };

// The attendance step closes at most 62 days a call; a few calls catch up a long gap.
const MAX_ABSENCE_ROUNDS = 6;

async function step(name: string, work: () => Promise<string>): Promise<NightlyStep> {
  const started = Date.now();
  try { return { name, ok: true, detail: await work(), ms: Date.now() - started }; }
  catch (error) {
    console.error(`Nightly job "${name}" failed:`, error);
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error), ms: Date.now() - started };
  }
}

export function runNightlyJobs(trigger: string) {
  return runAsSystem(async () => {
    const startedAt = new Date().toISOString();
    const steps: NightlyStep[] = [];
    steps.push(await step("Attendance: system absences", async () => {
      let recorded = 0;
      for (let round = 0; round < MAX_ABSENCE_ROUNDS; round++) {
        const added = await closeFinishedAttendanceDays();
        recorded += added;
        if (!added) break;
      }
      return recorded ? `${recorded} day record${recorded === 1 ? "" : "s"} added for days without a clock-in.` : "No finished day left to close.";
    }));
    steps.push(await step("Account statuses", async () => {
      const report = await syncAccountStatuses();
      const changed = report.rows.filter((row) => "status" in row && row.status !== row.storedStatus).length;
      return `${changed.toLocaleString("en-PH")} of ${report.rows.length.toLocaleString("en-PH")} accounts changed status.`;
    }));
    steps.push(await step("Exceptions", async () => {
      const { categories } = await findExceptions();
      const total = categories.reduce((sum, category) => sum + category.total, 0);
      return total ? `${total.toLocaleString("en-PH")} to review (${categories.filter((category) => category.total).map((category) => `${category.label} ${category.total}`).join(", ")}).` : "None.";
    }));
    const run: NightlyRun = { startedAt, finishedAt: new Date().toISOString(), trigger, ok: steps.every((item) => item.ok), steps };
    await saveSetting(NIGHTLY_KEY, JSON.stringify(run), "System").catch((error) => console.error("Nightly jobs: could not save the result.", error));
    return run;
  });
}

export async function lastNightlyRun(): Promise<NightlyRun | null> {
  try { return JSON.parse(await getSetting(NIGHTLY_KEY) || "null") as NightlyRun | null; }
  catch { return null; }
}
