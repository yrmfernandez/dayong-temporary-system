import { appendEncodedRows } from "@/lib/encoder-sheets";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { createReadableId } from "@/lib/readable-id";

const title = "Record Corrections";
export async function ensureCorrectionsSheet() {
  try { await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${title}'!A:K` }); }
  catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : 0;
    if (code !== 400) throw error;
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${title}'!A1:K1`, valueInputOption: "RAW", requestBody: { values: [["correction_id","module","record_id","reason","before_json","after_json","corrected_at","encoded_by_user_id","encoded_by_employee_id","encoded_by_name","encoded_at"]] } });
  }
}
export async function recordCorrection(module: string, recordId: string, reason: string, before: unknown, after: unknown) {
  await ensureCorrectionsSheet();
  await appendEncodedRows({ range: `'${title}'!A:G`, requestBody: { values: [[createReadableId("COR"), module, recordId, reason, JSON.stringify(before), JSON.stringify(after), new Date().toISOString()]] } });
}
