/** How "today" is counted for New Sales and Collections: the date the cash was remitted, when they were encoded, or their OR date. */
export const TODAY_MODES = ["remittance", "encoded", "or"] as const;
export type TodayMode = (typeof TODAY_MODES)[number];
export const TODAY_MODE_LABELS: Record<TodayMode, string> = { remittance: "Remittance date", encoded: "Date encoded", or: "OR date" };
export const isTodayMode = (value: unknown): value is TodayMode => TODAY_MODES.includes(value as TodayMode);
