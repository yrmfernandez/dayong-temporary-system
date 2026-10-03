import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { isTodayMode, type TodayMode } from "@/lib/today-mode";

export { isTodayMode, TODAY_MODE_LABELS, TODAY_MODES, type TodayMode } from "@/lib/today-mode";

const SHEET = "System Settings";
const text = (value: unknown) => String(value ?? "").trim();

// System Settings!A:D: setting_key, value, updated_at, updated_by. One row per key, created on the first save.
// Company-wide choices an administrator makes in the app; a missing sheet or key means the default applies.

const TODAY_MODE_KEY = "today_mode";

async function readSettings() {
  try {
    const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEET}'!A:B` })).data.values ?? [];
    return new Map(rows.slice(1).map((row) => [text(row[0]), text(row[1])]));
  } catch (error) {
    // A missing sheet is a 400 "Unable to parse range": nothing has been saved yet.
    if (typeof error === "object" && error && "code" in error && Number(error.code) === 400) return new Map<string, string>();
    throw error;
  }
}

async function saveSetting(key: string, value: string, by: string) {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties.title" });
  if (!metadata.data.sheets?.some((sheet) => sheet.properties?.title === SHEET)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: SHEET, gridProperties: { frozenRowCount: 1 } } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEET}'!A1:D1`, valueInputOption: "RAW", requestBody: { values: [["setting_key", "value", "updated_at", "updated_by"]] } });
  }
  const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEET}'!A:A` })).data.values ?? [];
  const index = rows.findIndex((row, position) => position > 0 && text(row[0]) === key);
  const values = [[key, value, new Date().toISOString(), by]];
  if (index < 0) await sheets.spreadsheets.values.append({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEET}'!A:D`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values } });
  else await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEET}'!A${index + 1}:D${index + 1}`, valueInputOption: "RAW", requestBody: { values } });
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
