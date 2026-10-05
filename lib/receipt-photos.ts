import { asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { readPhoto, storePhoto } from "@/lib/photo-storage";
import { createReadableId } from "@/lib/readable-id";

/**
 * Receipt photos for New Sales and Collections. The browser shrinks each photo before upload (grayscale, at most
 * 1280 px, WebP or JPEG) to MAX_PHOTO_BYTES. The file is kept in Supabase Storage (lib/photo-storage.ts, path in
 * storage_path); the receipt_photos row records which entries it covers. Photos saved before the move to Storage may
 * still hold their base64 data in photo_data_1..4 until scripts/move-photos-to-storage.mjs moves them.
 * One photo may cover several entries (one remittance receipt for a batch).
 */
export const MAX_PHOTO_BYTES = 80_000;
const photos = schema.receipt_photos;
const text = (value: unknown) => String(value ?? "").trim();

export type ReceiptPhotoInfo = { photoId: string; entryIds: string[]; sizeBytes: number; uploadedAt: string; uploadedByName: string; uploadedByEmployeeId: string };

/** Every photo's details without the image, oldest first. */
export async function listReceiptPhotos(): Promise<ReceiptPhotoInfo[]> {
  const rows = await getDb().select({ id: photos.photo_id, entryIds: photos.entry_ids, size: photos.size_bytes, at: photos.uploaded_at, by: photos.uploaded_by_name, byId: photos.uploaded_by_employee_id })
    .from(photos).orderBy(asc(photos.row_seq));
  return rows.map((row) => ({ photoId: row.id, entryIds: text(row.entryIds).split(",").map(text).filter(Boolean), sizeBytes: row.size ?? 0, uploadedAt: row.at ?? "", uploadedByEmployeeId: text(row.byId), uploadedByName: text(row.by) }));
}

/** Entry ID → its latest photo. */
export async function photosByEntry() {
  const map = new Map<string, ReceiptPhotoInfo>();
  for (const photo of await listReceiptPhotos()) for (const id of photo.entryIds) map.set(id, photo);
  return map;
}

/** The image as a data URL, for viewing. */
export async function getReceiptPhoto(photoId: string) {
  const [row] = await getDb().select().from(photos).where(eq(photos.photo_id, text(photoId)));
  if (!row) throw new Error("Photo not found.");
  const base64 = row.storage_path ? await readPhoto(row.storage_path)
    : [row.photo_data_1, row.photo_data_2, row.photo_data_3, row.photo_data_4].slice(0, row.chunk_count ?? 0).map(text).join("");
  if (!base64) throw new Error("Photo not found.");
  return { photoId: row.photo_id, entryIds: text(row.entry_ids).split(",").map(text).filter(Boolean), dataUrl: `data:${text(row.mime_type)};base64,${base64}`, uploadedAt: row.uploaded_at ?? "", uploadedByName: text(row.uploaded_by_name) };
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
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error(`The photo is ${Math.round(bytes.length / 1000)} KB; the limit is ${MAX_PHOTO_BYTES / 1000} KB. Take it again closer to the receipt.`);
  const entryIds = [...new Set(input.entryIds.map(text).filter(Boolean))];
  if (!entryIds.length) throw new Error("Choose the entries this receipt is for.");
  const photoId = createReadableId("RCP");
  const path = `${actor.encodedAt.slice(0, 7)}/${photoId}.${mime === "image/webp" ? "webp" : "jpg"}`;
  // The file first: a row never points at a file that was not stored.
  await storePhoto(path, new Uint8Array(bytes), mime);
  await getDb().insert(photos).values({
    photo_id: photoId, entry_ids: entryIds.join(","), mime_type: mime, size_bytes: bytes.length, width: Math.round(input.width) || 0, height: Math.round(input.height) || 0,
    uploaded_at: actor.encodedAt, uploaded_by_employee_id: actor.employeeId, uploaded_by_name: actor.name, storage_path: path,
  });
  return { photoId, sizeBytes: bytes.length, entryIds };
}
