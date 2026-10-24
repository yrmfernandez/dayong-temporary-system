import { and, desc, eq } from "drizzle-orm";

import { currentDb, encodedBy, schema } from "@/lib/db";

/*
 * Leave requests, read and written directly in leave_requests by ID (owner, October 24, 2026; upgrade #6). A review
 * changes the request only while it is still Pending, so two reviewers deciding at once cannot both go through.
 */
const { leave_requests: leaveTable } = schema;
const text = (value: unknown) => String(value ?? "").trim();

export type LeaveApprovalStatus =
  | "Pending"
  | "Approved"
  | "Rejected"
  | "Cancelled";

export type LeaveRequest = {
  id: string;
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  approvalStatus: LeaveApprovalStatus;
  reviewedBy: string;
  reviewedAt: string;
  createdAt: string;
  updatedAt: string;
};

function readApprovalStatus(
  value: unknown,
): LeaveApprovalStatus {
  const status = String(value ?? "")
    .trim()
    .toLowerCase();

  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "cancelled") return "Cancelled";

  return "Pending";
}

const toRequest = (row: typeof leaveTable.$inferSelect): LeaveRequest => ({
  id: row.leave_request_id, employeeId: text(row.employee_id), leaveType: text(row.leave_type), startDate: text(row.start_date), endDate: text(row.end_date), reason: text(row.reason),
  approvalStatus: readApprovalStatus(row.approval_status), reviewedBy: text(row.reviewed_by), reviewedAt: text(row.reviewed_at), createdAt: text(row.created_at), updatedAt: text(row.updated_at),
});

export async function getLeaveRequestsForEmployee(
  employeeId: string,
): Promise<LeaveRequest[]> {
  return (await currentDb().select().from(leaveTable).where(eq(leaveTable.employee_id, employeeId)).orderBy(desc(leaveTable.created_at))).map(toRequest);
}

export async function addLeaveRequest(
  request: LeaveRequest,
) {
  await currentDb().insert(leaveTable).values({
    leave_request_id: request.id, employee_id: request.employeeId, leave_type: request.leaveType || null, start_date: request.startDate || null, end_date: request.endDate || null, reason: request.reason || null,
    approval_status: request.approvalStatus, reviewed_by: request.reviewedBy || null, reviewed_at: request.reviewedAt || null, created_at: request.createdAt || null, updated_at: request.updatedAt || null, ...encodedBy(),
  });
}

/** Every request, newest first. `rowNumber` is the row's database sequence, kept for callers that pass it back. */
export async function getAllLeaveRequests(): Promise<
  Array<{
    request: LeaveRequest;
    rowNumber: number;
  }>
> {
  return (await currentDb().select().from(leaveTable).orderBy(desc(leaveTable.created_at))).map((row) => ({ request: toRequest(row), rowNumber: row.row_seq }));
}

/** Saves the review by the request's ID, only while it is still Pending; refused when someone reviewed it meanwhile. */
export async function updateLeaveRequestReview(
  _rowNumber: number,
  request: LeaveRequest,
) {
  void _rowNumber;
  const updated = await currentDb().update(leaveTable).set({ approval_status: request.approvalStatus, reviewed_by: request.reviewedBy || null, reviewed_at: request.reviewedAt || null, updated_at: request.updatedAt || null })
    .where(and(eq(leaveTable.leave_request_id, request.id), eq(leaveTable.approval_status, "Pending"))).returning({ id: leaveTable.leave_request_id });
  if (!updated.length) throw new Error("This leave request has already been reviewed.");
}
