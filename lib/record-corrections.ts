import { currentDb, encodedBy, schema } from "@/lib/db";
import { createReadableId } from "@/lib/readable-id";

/**
 * Record Corrections: why a record was changed, with its values before and after. Saved directly in record_corrections
 * (October 24, 2026; upgrade #6), in the caller's transaction when there is one.
 */
export async function recordCorrection(module: string, recordId: string, reason: string, before: unknown, after: unknown) {
  await currentDb().insert(schema.record_corrections).values({
    correction_id: createReadableId("COR") + Math.random().toString(36).slice(2, 5).toUpperCase(), module, record_id: recordId, reason,
    before_json: before ?? null, after_json: after ?? null, corrected_at: new Date().toISOString(), ...encodedBy(),
  });
}
