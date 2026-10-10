import { sql, type SQL } from "drizzle-orm";

import { canAccessPath } from "@/lib/access-control";
import { todayInManila } from "@/lib/account-rules";
import type { SessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { countOpenClearings } from "@/lib/clearing";
import { listForReview } from "@/lib/sale-submissions";

/**
 * Numbers shown beside sidebar pages (October 8, 2026): how many things wait for this user there. Only pages the user
 * may open are counted; a page with nothing waiting is left out.
 *   /leave-approvals    leave requests not yet approved, rejected or cancelled
 *   /remittances        approvers (manage users): remittances Pending Approval or with a Discrepancy;
 *                       everyone else: their own New Sales and collections returned to them (slip rejected)
 *   /my-entries         their own entries still Outstanding without a receipt photo (a photo sends them for approval)
 *   /new-sales          New Sales submitted by MAS waiting to be saved, in the clerk's branches
 *   /mas-sales          the MAS's own submissions returned to them
 *   /attendance-reviews absences the system recorded in the last 7 days that nobody has confirmed or changed yet
 *   /clearing           MAS and employees the user cleared (administrators: anyone's) whose entries are not yet sent for approval
 *   /my-notices         the user's own Notices to Explain in force that they have not confirmed or not yet explained
 *   /employees          administrators: employees' explanations on Notices to Explain not yet marked reviewed
 */
export type NotificationCounts = Record<string, number>;

const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];
const countOf = async (query: SQL) => Number(rowsOf<{ count: number }>(await getDb().execute(query))[0]?.count ?? 0);
const isApprover = (user: SessionUser) => Boolean(user.permissions.manageUsers) || user.roleNames.some((role) => ["administrator", "admin"].includes(role.trim().toLowerCase()));

export async function getNotificationCounts(user: SessionUser): Promise<NotificationCounts> {
  const can = (path: string) => canAccessPath(user, path);
  const me = user.employeeId;
  const tasks: Array<[string, Promise<number>]> = [];
  // An entry with a receipt photo lists its ID in receipt_photos.entry_ids (comma-separated).
  const noPhoto = (id: SQL) => sql`not exists (select 1 from receipt_photos p where ${id} = any(string_to_array(replace(coalesce(p.entry_ids, ''), ' ', ''), ',')))`;

  if (can("/leave-approvals")) tasks.push(["/leave-approvals", countOf(sql`select count(*)::int as count from leave_requests
    where lower(trim(coalesce(approval_status, ''))) not in ('approved', 'rejected', 'cancelled')`)]);
  if (can("/remittances")) tasks.push(["/remittances", isApprover(user)
    ? countOf(sql`select count(*)::int as count from remittances where status in ('Pending Approval', 'Discrepancy')`)
    : countOf(sql`select (select count(*) from collections where encoded_by_employee_id = ${me} and remittance_status = 'Returned' and lower(coalesce(status, '')) = 'posted')
        + (select count(*) from sales where encoded_by_employee_id = ${me} and remittance_status = 'Returned') as count`)]);
  if (can("/my-entries") && me) tasks.push(["/my-entries", countOf(sql`select
      (select count(*) from collections c where c.encoded_by_employee_id = ${me} and c.remittance_status = 'Outstanding' and lower(coalesce(c.status, '')) = 'posted' and ${noPhoto(sql`c.collection_id`)})
    + (select count(*) from sales s where s.encoded_by_employee_id = ${me} and s.remittance_status = 'Outstanding' and ${noPhoto(sql`s.sale_id`)}) as count`)]);
  if (can("/new-sales")) tasks.push(["/new-sales", listForReview(user).then((list) => list.length).catch(() => 0)]);
  if (can("/mas-sales") && me) tasks.push(["/mas-sales", countOf(sql`select count(*)::int as count from sale_submissions where mas_employee_id = ${me} and status = 'Returned'`)]);
  if (can("/clearing")) tasks.push(["/clearing", countOpenClearings(isApprover(user) ? "" : me)]);
  const today = todayInManila();
  if (me) tasks.push(["/my-notices", countOf(sql`select count(*)::int as count from notices_to_explain
    where employee_id = ${me} and status = 'Active' and expires_on >= ${today}::date and (acknowledged_at is null or explanation is null)`)]);
  if (can("/employees") && isApprover(user)) tasks.push(["/employees", countOf(sql`select count(*)::int as count from notices_to_explain
    where status <> 'Withdrawn' and explanation is not null and reviewed_at is null`)]);
  if (can("/attendance-reviews")) {
    const since = new Date(Date.parse(`${todayInManila()}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
    tasks.push(["/attendance-reviews", countOf(sql`select count(*)::int as count from attendance
      where attendance_status = 'Absent' and coalesce(notes, '') like 'Absent by system%' and attendance_date >= ${since}::date`)]);
  }

  const counts: NotificationCounts = {};
  const results = await Promise.allSettled(tasks.map(([, task]) => task));
  // A failing count leaves that page without a number (logged for IT), never the sidebar without its links.
  results.forEach((result, index) => {
    if (result.status === "fulfilled") { if (result.value > 0) counts[tasks[index][0]] = result.value; }
    else console.error(`Notification count for ${tasks[index][0]} failed:`, result.reason);
  });
  return counts;
}
