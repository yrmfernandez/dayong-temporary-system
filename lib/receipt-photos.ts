import { getEncoder } from "@/lib/encoder-context";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { createReadableId } from "@/lib/readable-id";

/**
 * Receipt photos for New Sales and Collections, kept in the "Receipt Photos" sheet because the system stores everything
 * in Google Sheets. To keep that small, the browser shrinks each photo before upload (grayscale, at most 1280 px, WebP
 * or JPEG) to MAX_PHOTO_BYTES; it is stored as base64 text split across cells (a cell holds at most 50,000 characters).
 * One photo may cover several entries (one remittance receipt for a batch).
 *
 * Receipt Photos columns: A photo_id, B entry_ids (comma separated), C mime_type, D size_bytes, E width, F height,
 * G uploaded_at, H uploaded_by_employee_id, I uploaded_by_name, J chunk_count, K:N photo_data_1..4.
 * Only A:J are read to know which entries have a photo; the data columns are read one photo at a time.
 */
export const MAX_PHOTO_BYTES = 80_000;
const SHEET = "Receipt Photos";
const CHUNK = 45_000;
const MAX_CHUNKS = 4;
const HEADERS = ["photo_id", "entry_ids", "mime_type", "size_bytes", "width", "height", "uploaded_at", "uploaded_by_employee_id", "uploaded_by_name", "chunk_count", "photo_data_1", "photo_data_2", "photo_data_3", "photo_data_4"];
const text = (value: unknown) => String(value ?? "").trim();

export type ReceiptPhotoInfo = { photoId: string; entryIds: string[]; sizeBytes: number; uploadedAt: string; uploadedByName: string; uploadedByEmployeeId: string };

async function sheetExists() {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties.title" });
  return Boolean(metadata.data.sheets?.some((sheet) => sheet.properties?.title === SHEET));
}

async function ensureSheet() {
  if (await sheetExists()) return;
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: SHEET, gridProperties: { frozenRowCount: 1, columnCount: HEADERS.length } } } }] } });
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEET}'!A1:N1`, valueInputOption: "RAW", requestBody: { values: [HEADERS] } });
}

/** Every photo's details without the image data, newest last. A missing sheet means no photos yet. */
export async function listReceiptPhotos(): Promise<ReceiptPhotoInfo[]> {
  if (!(await sheetExists())) return [];
  const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEET}'!A:J` })).data.values ?? [];
  return rows.slice(1).filter((row) => text(row[0])).map((row) => ({
    photoId: text(row[0]), entryIds: text(row[1]).split(",").map(text).filter(Boolean), sizeBytes: Number(row[3]) || 0,
    uploadedAt: text(row[6]), uploadedByEmployeeId: text(row[7]), uploadedByName: text(row[8]),
  }));
}

/** Entry ID → its latest photo. */
export async function photosByEntry() {
  const map = new Map<string, ReceiptPhotoInfo>();
  for (const photo of await listReceiptPhotos()) for (const id of photo.entryIds) map.set(id, photo);
  return map;
}

/** The image as a data URL, for viewing. */
export async function getReceiptPhoto(photoId: string) {
  if (!(await sheetExists())) throw new Error("Photo not found.");
  const ids = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEET}'!A:A` })).data.values ?? [];
  const index = ids.findIndex((row, position) => position > 0 && text(row[0]) === photoId);
  if (index < 0) throw new Error("Photo not found.");
  const row = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEET}'!A${index + 1}:N${index + 1}` })).data.values?.[0] ?? [];
  const chunks = Number(row[9]) || 0;
  return { photoId, entryIds: text(row[1]).split(",").map(text).filter(Boolean), dataUrl: `data:${text(row[2])};base64,${row.slice(10, 10 + chunks).map(text).join("")}`, uploadedAt: text(row[6]), uploadedByName: text(row[8]) };
}

/**
 * Saves one compressed photo for the given entries. Entries that already had a photo now point to this one; a photo no
 * longer used by any entry is not deleted (the record of what was uploaded stays), but it is never shown again.
 */
export async function saveReceiptPhoto(input: { entryIds: string[]; dataUrl: string; width: number; height: number }) {
  const actor = getEncoder();
  const match = /^data:(image\/(?:webp|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(input.dataUrl);
  if (!match) throw new Error("The photo must be a compressed WebP or JPEG image.");
  const [, mime, base64] = match;
  const sizeBytes = Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (sizeBytes > MAX_PHOTO_BYTES) throw new Error(`The photo is ${Math.round(sizeBytes / 1000)} KB; the limit is ${MAX_PHOTO_BYTES / 1000} KB. Take it again closer to the receipt.`);
  const entryIds = [...new Set(input.entryIds.map(text).filter(Boolean))];
  if (!entryIds.length) throw new Error("Choose the entries this receipt is for.");
  const chunks: string[] = [];
  for (let start = 0; start < base64.length; start += CHUNK) chunks.push(base64.slice(start, start + CHUNK));
  if (chunks.length > MAX_CHUNKS) throw new Error("The photo is too large.");
  await ensureSheet();
  const photoId = createReadableId("RCP");
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEET}'!A:N`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[photoId, entryIds.join(","), mime, sizeBytes, Math.round(input.width) || 0, Math.round(input.height) || 0, actor.encodedAt, actor.employeeId, actor.name, chunks.length, ...chunks]] },
  });
  return { photoId, sizeBytes, entryIds };
}
