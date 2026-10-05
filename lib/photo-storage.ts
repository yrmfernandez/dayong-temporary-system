import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Receipt photo files in Supabase Storage: a private bucket, read and written only by the server with the secret key
 * (SUPABASE_URL, SUPABASE_SERVICE_KEY). Tests set globalThis.dayongTestStorage to an in-memory Map instead.
 */
export const PHOTO_BUCKET = "receipts";
const shared = globalThis as typeof globalThis & { dayongStorage?: SupabaseClient; dayongBucketReady?: Promise<void>; dayongTestStorage?: Map<string, { bytes: Uint8Array; type: string }> };

function client() {
  if (shared.dayongStorage) return shared.dayongStorage;
  const url = (process.env.SUPABASE_URL ?? "").trim(), key = (process.env.SUPABASE_SERVICE_KEY ?? "").trim();
  if (!url || !key) throw new Error("Photo storage is not configured: set SUPABASE_URL and SUPABASE_SERVICE_KEY.");
  shared.dayongStorage = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return shared.dayongStorage;
}

/** Creates the private bucket the first time it is needed. */
function bucketReady() {
  shared.dayongBucketReady ??= (async () => {
    const storage = client().storage;
    const { data } = await storage.getBucket(PHOTO_BUCKET);
    if (data) return;
    const { error } = await storage.createBucket(PHOTO_BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw new Error(`Unable to prepare photo storage: ${error.message}`);
  })().catch((error) => { shared.dayongBucketReady = undefined; throw error; });
  return shared.dayongBucketReady;
}

export async function storePhoto(path: string, bytes: Uint8Array, type: string) {
  if (shared.dayongTestStorage) { shared.dayongTestStorage.set(path, { bytes, type }); return; }
  await bucketReady();
  const { error } = await client().storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (error) throw new Error(`Unable to store the photo: ${error.message}`);
}

/** The file as base64, for the data URL the viewer shows. */
export async function readPhoto(path: string) {
  if (shared.dayongTestStorage) {
    const file = shared.dayongTestStorage.get(path);
    if (!file) throw new Error("Photo not found.");
    return Buffer.from(file.bytes).toString("base64");
  }
  const { data, error } = await client().storage.from(PHOTO_BUCKET).download(path);
  if (error || !data) throw new Error("Photo not found.");
  return Buffer.from(await data.arrayBuffer()).toString("base64");
}
