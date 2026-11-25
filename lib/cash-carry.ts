// When the clerk report starts carrying the real cash on hand (owner, November 24, 2026; lib/cash-position.ts). Pure, so
// the report's page can use it too.

/** From this day a report starts with the cash held (from Finance-confirmed cash counts) and bank / e-wallet is not cash. */
export const CARRY_START = "2026-12-01";

/** The day before a YYYY-MM-DD date. */
export const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
