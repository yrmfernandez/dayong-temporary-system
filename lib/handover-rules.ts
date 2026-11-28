import { cashCountsProblem, cashCountsText, cashCountTotal, cleanCashCounts, paymentReferenceProblem, type CashCounts } from "@/lib/entry-controls";
import { toCents } from "@/lib/money";

/**
 * One handover, counted at Mark remitted (owner, November 28, 2026; from December 1, 2026). A MAS hands over New Sales
 * and Collections together, sometimes part in cash and the rest by GCash or bank. The clerk presses Mark remitted once:
 * the window lists every batch the MAS is waiting to remit in the branch, asks how it was remitted (one line per method)
 * and counts the cash by denomination. The short or over is worked out once for the whole handover, when its last batch
 * is saved (lib/mas-handover.ts). These rules are shared by the window and the server.
 */
export const HANDOVER_START = "2026-12-01";
export const HANDOVER_NOTE_MIN = 5;
export const HANDOVER_NOTE_MAX = 200;

/** A method line: Cash (counted by denomination, `counts`) or a bank / e-wallet payment with its reference. */
export type HandoverLine = { method: string; cash: boolean; amount: number; reference: string; counts?: Record<string, number> };
export type HandoverMethod = { name: string; isCash: boolean; requiresReference: boolean };

const text = (value: unknown) => String(value ?? "").trim();
const peso = (value: number) => value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });

/** True on and after December 1, 2026 (Manila day), when Mark remitted asks for the method and the count (tests move the day). */
export const handoverCountOn = (today: string) => today >= ((globalThis as { dayongHandoverStart?: string }).dayongHandoverStart ?? HANDOVER_START);

/**
 * Checks the lines typed in the window against the active remittance methods and returns them clean, or the problem.
 * One line per method, at most one cash line; cash is the total of the pieces counted (never typed); a bank or e-wallet
 * line needs its amount and reference no.
 */
export function cleanHandoverLines(input: unknown, methods: HandoverMethod[]): { lines: HandoverLine[]; problem: string } {
  const raw = Array.isArray(input) ? input as Array<Record<string, unknown>> : [];
  if (!raw.length) return { lines: [], problem: "Choose how the MAS remitted: Cash, GCash, bank and so on." };
  if (raw.length > 6) return { lines: [], problem: "Six methods at most in one handover." };
  const lines: HandoverLine[] = [];
  for (const item of raw) {
    const method = methods.find((entry) => entry.name.toLowerCase() === text(item.method).toLowerCase());
    if (!method) return { lines: [], problem: `${text(item.method) || "That method"} is not an active remittance method (Master Data → Remittance methods).` };
    if (lines.some((line) => line.method.toLowerCase() === method.name.toLowerCase())) return { lines: [], problem: `${method.name} is listed twice. Put it on one line.` };
    if (method.isCash) {
      if (lines.some((line) => line.cash)) return { lines: [], problem: "Only one cash line: count all the cash together." };
      const counts = (item.counts && typeof item.counts === "object" ? item.counts : {}) as CashCounts;
      const problem = cashCountsProblem(counts);
      if (problem) return { lines: [], problem };
      const amount = cashCountTotal(counts);
      if (!(amount > 0)) return { lines: [], problem: "Count the cash: type how many pieces of each bill and coin." };
      lines.push({ method: method.name, cash: true, amount, reference: "", counts: cleanCashCounts(counts) });
    } else {
      const amount = toCents(Number(item.amount)) / 100;
      if (!Number.isFinite(amount) || amount <= 0) return { lines: [], problem: `Enter the ${method.name} amount.` };
      const reference = text(item.reference);
      // Bank and e-wallet always need the reference, as on a bank batch: it goes to Bank Deposits.
      const problem = paymentReferenceProblem(reference, method.name);
      if (problem) return { lines: [], problem };
      lines.push({ method: method.name, cash: false, amount, reference });
    }
  }
  return { lines, problem: "" };
}

/** Everything handed over, in pesos. */
export const handoverReceived = (lines: HandoverLine[]) => lines.reduce((cents, line) => cents + toCents(line.amount), 0) / 100;

/** The cash part only. */
export const handoverCash = (lines: HandoverLine[]) => lines.filter((line) => line.cash).reduce((cents, line) => cents + toCents(line.amount), 0) / 100;

/** "Cash ₱3,000.00 (₱1,000×2, ₱500×2) · GCash ₱2,220.00 ref 1234567". */
export const handoverText = (lines: HandoverLine[]) => lines.map((line) => line.cash
  ? `${line.method} ${peso(line.amount)}${line.counts && cashCountsText(line.counts) ? ` (${cashCountsText(line.counts)})` : ""}`
  : `${line.method} ${peso(line.amount)}${line.reference ? ` ref ${line.reference}` : ""}`).join(" · ");

/**
 * How the batches of the handover are saved: paid by one bank or e-wallet method only, with that method and reference
 * (as a bank batch is today: Bank Deposits non-cash record, receipt photo). Otherwise as cash; any bank or e-wallet
 * line is then recorded in Bank Deposits as money forwarded to the bank, so cash on hand is the cash counted.
 */
export function handoverBatchMethod(lines: HandoverLine[], cashName = "Cash") {
  if (lines.length === 1 && !lines[0].cash) return { method: lines[0].method, reference: lines[0].reference, cash: false };
  return { method: lines.find((line) => line.cash)?.method ?? cashName, reference: "", cash: true };
}

/** Adds lines to a handover's lines (Part of the earlier handover): the same method is added together, cash pieces too. */
export function mergeHandoverLines(earlier: HandoverLine[], more: HandoverLine[]) {
  const merged: HandoverLine[] = earlier.map((line) => ({ ...line, counts: line.counts ? { ...line.counts } : undefined }));
  for (const line of more) {
    const same = merged.find((item) => item.method.toLowerCase() === line.method.toLowerCase() && (item.cash || item.reference === line.reference));
    if (!same) { merged.push({ ...line }); continue; }
    same.amount = (toCents(same.amount) + toCents(line.amount)) / 100;
    if (same.cash && line.counts) {
      const counts = { ...(same.counts ?? {}) };
      for (const [key, pieces] of Object.entries(line.counts)) counts[key] = (counts[key] ?? 0) + pieces;
      same.counts = counts;
    }
  }
  return merged;
}

/** Lines stored on a clearing, read back safely. */
export function storedHandoverLines(value: unknown): HandoverLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: Record<string, unknown>) => ({
    method: text(item?.method), cash: item?.cash === true, amount: Number(item?.amount) || 0, reference: text(item?.reference),
    counts: item?.counts && typeof item.counts === "object" ? item.counts as Record<string, number> : undefined,
  })).filter((line) => line.method);
}

/** The note kept with the handover's short or over (lib/turnover-variance.ts): starts with Handover, see varianceSource. */
export const handoverVarianceNote = (clearingId: string, lines: HandoverLine[], expected: number, kinds: string, note: string) =>
  `Handover ${clearingId}: received ${peso(handoverReceived(lines))} (${handoverText(lines)}) for ${kinds}, expected ${peso(expected)}${text(note) ? `: ${text(note)}` : ""}`.slice(0, 300);
