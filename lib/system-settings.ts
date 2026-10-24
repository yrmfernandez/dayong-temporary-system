import { currentDb, schema } from "@/lib/db";
import { isTodayMode, type TodayMode } from "@/lib/today-mode";

export { isTodayMode, TODAY_MODE_LABELS, TODAY_MODES, type TodayMode } from "@/lib/today-mode";

const text = (value: unknown) => String(value ?? "").trim();
const { system_settings: settingsTable } = schema;

// system_settings: setting_key, value, updated_at, updated_by. One row per key, created on the first save; a missing key
// means the default applies. Company-wide choices an administrator makes in the app, and markers kept by the system
// (attendance days closed, the last nightly run). Read and written directly by key (October 24, 2026; upgrade #6 phase 4).

const TODAY_MODE_KEY = "today_mode";

async function readSettings() {
  const rows = await currentDb().select({ key: settingsTable.setting_key, value: settingsTable.value }).from(settingsTable);
  return new Map(rows.map((row) => [text(row.key), text(row.value)]));
}

/** One company setting, or "" when it has never been saved. */
export async function getSetting(key: string) {
  return (await readSettings()).get(key) ?? "";
}

/** Inserts or updates the one row of the key in one statement, so two saves at once never add a second row. */
export async function saveSetting(key: string, value: string, by: string) {
  const values = { value, updated_at: new Date().toISOString(), updated_by: by };
  await currentDb().insert(settingsTable).values({ setting_key: key, ...values }).onConflictDoUpdate({ target: settingsTable.setting_key, set: values });
}

/** The company's "today" mode; Remittance date unless an administrator chose another. */
export async function getTodayMode(): Promise<TodayMode> {
  const value = (await readSettings()).get(TODAY_MODE_KEY);
  return isTodayMode(value) ? value : "remittance";
}

export async function setTodayMode(mode: unknown, by: string) {
  if (!isTodayMode(mode)) throw new Error("Choose Remittance date, Date encoded, or OR date.");
  await saveSetting(TODAY_MODE_KEY, mode, by);
  return mode;
}
