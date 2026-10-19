import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/lib/db";

/**
 * Why a remittance slip is short or over (owner, October 19, 2026: the discrepancies could not be opened). Read-only.
 *
 * The slip's expected amount is the company share of each entry when it was linked (remittance_collections.amount)
 * plus any Fidelity; the actual amount is the cash or deposit recorded. A difference comes from one of two places:
 *   - the actual amount recorded was not the expected one when the slip was made (cash short or over); or
 *   - the expected or actual amount changed after the slip was made, for example a correction that changed an entry's
 *     program or NOPs, so its company share and the slip followed (followSlip in lib/entry-edit.ts).
 * The Audit Log keeps every change to the slip and its lines with who and when; Record Corrections keeps the reason.
 */
const text = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown) => Number(value ?? 0) || 0;
const round = (value: number) => Math.round(value * 100) / 100;
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];
const query = async <T,>(statement: SQL) => rowsOf<T>(await getDb().execute(statement));
const list = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

export type DiscrepancyChange = {
  at: string; by: string; what: "Expected" | "Actual" | "Fidelity" | "Entry share";
  from: number; to: number; entryId: string; orNumber: string; reason: string;
};
export type DiscrepancyBreakdown = {
  id: string; status: string; type: string; createdAt: string; receivedAt: string; cashCount: string; remarks: string;
  expected: number; actual: number; difference: number; fidelity: number;
  /** What the slip expected and recorded when it was made, before the changes below. */
  expectedAtStart: number; actualAtStart: number;
  entries: Array<{ id: string; kind: "Collection" | "New Sale"; orNumber: string; memberNumber: string; amount: number; shareOnSlip: number; shareNow: number }>;
  changes: DiscrepancyChange[];
  /** Plain-language causes, most important first. */
  causes: string[];
};

const at = (value: unknown) => text(value) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(text(value))).replace(",", "") : "";
const peso = (value: number) => `₱${Math.abs(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The breakdown of one slip. `clerkId` (an Entry Clerk's own view) refuses a slip they did not encode. */
export async function getDiscrepancyBreakdown(remittanceId: string, clerkId = ""): Promise<DiscrepancyBreakdown> {
  const id = text(remittanceId);
  const [slip] = await query<Record<string, unknown>>(sql`select remittance_id, coalesce(status, '') as status, coalesce(remittance_type, '') as type, created_at, coalesce(date_remitted::text, '') as date_remitted,
      coalesce(time_remitted, '') as time_remitted, coalesce(cash_count, '') as cash_count, coalesce(remarks, '') as remarks, coalesce(gross_collection, 0)::float8 as expected,
      coalesce(total_remittance, 0)::float8 as actual, coalesce(fidelity_amount, 0)::float8 as fidelity
    from remittances where remittance_id = ${id}`);
  if (!slip) throw new Error("Remittance not found.");
  const links = await query<{ link_id: string; entry_id: string; share: number }>(sql`select remittance_collection_id as link_id, collection_id as entry_id, coalesce(amount, 0)::float8 as share
    from remittance_collections where remittance_id = ${id} order by row_seq`);
  const entryIds = links.map((link) => link.entry_id);
  const entries = entryIds.length ? await query<{ id: string; kind: "Collection" | "New Sale"; or_number: string; member_number: string; amount: number; share: number; encoder: string }>(sql`
      select collection_id as id, 'Collection' as kind, coalesce(or_number, '') as or_number, coalesce(member_number, '') as member_number, coalesce(amount_collected, 0)::float8 as amount,
        coalesce(remittance_amount, 0)::float8 as share, coalesce(encoded_by_employee_id, '') as encoder from collections where collection_id in (${list(entryIds)})
      union all select sale_id, 'New Sale', coalesce(nullif(or_number, ''), 'App ' || coalesce(application_no, '')), coalesce(member_number, ''), coalesce(amount_paid, 0)::float8,
        coalesce(remittance_amount, amount_paid, 0)::float8, coalesce(encoded_by_employee_id, '') from sales where sale_id in (${list(entryIds)})`) : [];
  if (clerkId && !entries.some((entry) => entry.encoder === clerkId)) throw new Error("You can only view remittances you encoded.");
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const linkEntry = new Map(links.map((link) => [link.link_id, link.entry_id]));

  // Every later change to the slip's amounts and to its lines, oldest first.
  const audit = await query<{ logged_at: string; table_name: string; record_id: string; changes_json: Record<string, { from: unknown; to: unknown }> | null; user_name: string | null }>(sql`
    select logged_at, table_name, record_id, changes_json, user_name from audit_log
    where action = 'update' and ((table_name = 'remittances' and record_id = ${id})${links.length ? sql` or (table_name = 'remittance_collections' and record_id in (${list(links.map((link) => link.link_id))}))` : sql``})
    order by logged_at, row_seq`);
  const corrections = entryIds.length ? await query<{ record_id: string; reason: string; corrected_at: string }>(sql`select record_id, coalesce(reason, '') as reason, corrected_at from record_corrections
    where record_id in (${list(entryIds)}) order by corrected_at`) : [];
  // The correction behind an entry's change: the one on that entry closest in time (they are saved in the same minute).
  const reasonFor = (entryId: string, loggedAt: string) => {
    const time = new Date(loggedAt).getTime();
    const near = corrections.filter((item) => item.record_id === entryId).map((item) => ({ ...item, gap: Math.abs(new Date(item.corrected_at).getTime() - time) })).sort((a, b) => a.gap - b.gap)[0];
    return near && near.gap < 10 * 60 * 1000 ? near.reason : "";
  };
  const changes: DiscrepancyChange[] = [];
  let lastEntry = "";
  for (const row of audit) {
    const change = row.changes_json ?? {};
    const by = text(row.user_name) || "system / script";
    if (row.table_name === "remittance_collections" && change.amount) {
      lastEntry = linkEntry.get(row.record_id) ?? "";
      changes.push({ at: at(row.logged_at), by, what: "Entry share", from: num(change.amount.from), to: num(change.amount.to), entryId: lastEntry, orNumber: byId.get(lastEntry)?.or_number ?? "", reason: reasonFor(lastEntry, row.logged_at) });
    }
    if (row.table_name !== "remittances") continue;
    const columns: Array<[string, DiscrepancyChange["what"]]> = [["gross_collection", "Expected"], ["total_remittance", "Actual"], ["fidelity_amount", "Fidelity"]];
    for (const [column, what] of columns) {
      if (!change[column]) continue;
      // An expected change right after an entry's share changed is that entry's correction following the slip.
      const entryId = what === "Expected" ? lastEntry : "";
      changes.push({ at: at(row.logged_at), by, what, from: num(change[column].from), to: num(change[column].to), entryId, orNumber: byId.get(entryId)?.or_number ?? "", reason: entryId ? reasonFor(entryId, row.logged_at) : "" });
    }
    lastEntry = "";
  }

  const expected = num(slip.expected), actual = num(slip.actual), fidelity = num(slip.fidelity);
  const first = (what: DiscrepancyChange["what"], now: number) => changes.find((item) => item.what === what)?.from ?? now;
  const expectedAtStart = first("Expected", expected), actualAtStart = first("Actual", actual);
  const rows = links.map((link) => {
    const entry = byId.get(link.entry_id);
    return { id: link.entry_id, kind: entry?.kind ?? "Collection", orNumber: entry?.or_number ?? "", memberNumber: entry?.member_number ?? "", amount: entry?.amount ?? 0, shareOnSlip: link.share, shareNow: entry?.share ?? 0 };
  });

  const causes: string[] = [];
  const startGap = round(actualAtStart - expectedAtStart);
  if (startGap) causes.push(`When the slip was made, the amount recorded (${peso(actualAtStart)}) was ${startGap < 0 ? "short" : "over"} the expected ${peso(expectedAtStart)} by ${peso(startGap)}.`);
  else if (changes.length) causes.push(`The slip balanced when it was made (${peso(expectedAtStart)} expected and recorded).`);
  for (const item of changes.filter((change) => change.what !== "Entry share")) {
    const delta = round(item.to - item.from);
    if (!delta) continue;
    const entry = item.entryId ? ` because entry ${item.entryId}${item.orNumber ? ` (OR ${item.orNumber})` : ""} was corrected${item.reason ? `: "${item.reason}"` : ""}` : "";
    causes.push(`${item.at}: the ${item.what.toLowerCase()} amount went ${delta > 0 ? "up" : "down"} by ${peso(delta)} (${peso(item.from)} → ${peso(item.to)})${entry}, by ${item.by}.`);
  }
  const linked = round(rows.reduce((sum, row) => sum + row.shareOnSlip, 0) + fidelity);
  if (round(linked - expected)) causes.push(`The entries' shares on the slip plus Fidelity come to ${peso(linked)}, not the expected ${peso(expected)}: the slip's lines and its total disagree.`);
  const drift = rows.filter((row) => round(row.shareNow - row.shareOnSlip));
  if (drift.length) causes.push(`${drift.length} entr${drift.length === 1 ? "y's" : "ies'"} company share now differs from the slip (${drift.map((row) => `${row.id}: ${peso(row.shareOnSlip)} on the slip, ${peso(row.shareNow)} now`).join("; ")}).`);
  if (!causes.length) causes.push(round(actual - expected) ? `No change was recorded since the slip was made: the amount recorded was ${round(actual - expected) < 0 ? "short" : "over"} from the start.` : "The slip balances.");

  return {
    id, status: text(slip.status), type: text(slip.type), createdAt: at(slip.created_at), receivedAt: `${text(slip.date_remitted)}${text(slip.time_remitted) ? ` ${text(slip.time_remitted)}` : ""}`,
    cashCount: text(slip.cash_count), remarks: text(slip.remarks), expected, actual, difference: round(actual - expected), fidelity,
    expectedAtStart, actualAtStart, entries: rows, changes, causes,
  };
}
