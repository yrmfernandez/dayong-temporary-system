/**
 * Moves receipt photos still held in the database (photo_data_1..4) into Supabase Storage, bucket "receipts", then
 * clears that data from the row. Safe to rerun: only rows without a storage path are moved.
 *
 *   node scripts/move-photos-to-storage.mjs          dry run: counts only
 *   node scripts/move-photos-to-storage.mjs --apply  move
 *
 * Uses DIRECT_DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_KEY: staging from .env.local, or production when set in
 * the shell.
 */
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const BUCKET = "receipts";
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, onnotice: () => {} });
const storage = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } }).storage;
const project = /https:\/\/([a-z0-9]+)\.supabase/.exec(process.env.SUPABASE_URL ?? "")?.[1] ?? "unknown";
const databaseRef = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "";
try {
  if (databaseRef !== project) throw new Error(`SUPABASE_URL (${project}) and DIRECT_DATABASE_URL (${databaseRef}) are different projects.`);
  const rows = await sql`select photo_id, mime_type, uploaded_at, chunk_count, photo_data_1, photo_data_2, photo_data_3, photo_data_4 from receipt_photos where storage_path is null and coalesce(chunk_count, 0) > 0 order by row_seq`;
  console.log(`Supabase project: ${project}. Photos still in the database: ${rows.length}.`);
  if (!apply) { console.log("Dry run. Nothing was moved. Add --apply to move them."); }
  else {
    const { data: bucket } = await storage.getBucket(BUCKET);
    if (!bucket) { const { error } = await storage.createBucket(BUCKET, { public: false }); if (error && !/already exists/i.test(error.message)) throw error; }
    let moved = 0;
    for (const row of rows) {
      const base64 = [row.photo_data_1, row.photo_data_2, row.photo_data_3, row.photo_data_4].slice(0, row.chunk_count).join("");
      const month = (row.uploaded_at ? new Date(row.uploaded_at).toISOString() : new Date().toISOString()).slice(0, 7);
      const path = `${month}/${row.photo_id}.${row.mime_type === "image/webp" ? "webp" : "jpg"}`;
      const { error } = await storage.from(BUCKET).upload(path, Buffer.from(base64, "base64"), { contentType: row.mime_type, upsert: true });
      if (error) throw new Error(`${row.photo_id}: ${error.message}`);
      await sql`update receipt_photos set storage_path = ${path}, chunk_count = null, photo_data_1 = null, photo_data_2 = null, photo_data_3 = null, photo_data_4 = null where photo_id = ${row.photo_id}`;
      moved++;
    }
    console.log(`Moved ${moved} photo(s) to Storage.`);
  }
} finally {
  await sql.end();
}
