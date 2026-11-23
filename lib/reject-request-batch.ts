// A reject request for a whole batch (owner, November 23, 2026) keeps "Batch CBT-… · 5 entries" as its reference (the
// slip's ID for New Sales, which keep no batch ID). Pure, so My Entries and the Reject requests tab can read it too.

/** The reference a batch request keeps. */
export const batchReference = (batchId: string, count: number) => `Batch ${batchId} · ${count} entr${count === 1 ? "y" : "ies"}`;

/** The batch a request is for, or null for an older request on one entry. */
export function batchOf(request: { reference: string }) {
  const match = /^Batch (\S+) · (\d+) entr(?:y|ies)$/.exec(request.reference);
  return match ? { batchId: match[1], count: Number(match[2]) } : null;
}
