import {
  GOOGLE_SHEET_ID,
  sheets,
} from "@/lib/google-sheets";

const LEAVE_REQUESTS_SHEET =
  "Leave Requests";

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

export async function getLeaveRequestsForEmployee(
  employeeId: string,
): Promise<LeaveRequest[]> {
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `'${LEAVE_REQUESTS_SHEET}'!A:K`,
    });

  return (response.data.values ?? [])
    .slice(1)
    .filter(
      (row) =>
        String(row[1] ?? "").trim() === employeeId,
    )
    .map((row) => ({
      id: String(row[0] ?? "").trim(),
      employeeId: String(row[1] ?? "").trim(),
      leaveType: String(row[2] ?? "").trim(),
      startDate: String(row[3] ?? "").trim(),
      endDate: String(row[4] ?? "").trim(),
      reason: String(row[5] ?? "").trim(),
      approvalStatus: readApprovalStatus(row[6]),
      reviewedBy: String(row[7] ?? "").trim(),
      reviewedAt: String(row[8] ?? "").trim(),
      createdAt: String(row[9] ?? "").trim(),
      updatedAt: String(row[10] ?? "").trim(),
    }))
    .sort((first, second) =>
      second.createdAt.localeCompare(first.createdAt),
    );
}

export async function addLeaveRequest(
  request: LeaveRequest,
) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `'${LEAVE_REQUESTS_SHEET}'!A:K`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        request.id,
        request.employeeId,
        request.leaveType,
        request.startDate,
        request.endDate,
        request.reason,
        request.approvalStatus,
        request.reviewedBy,
        request.reviewedAt,
        request.createdAt,
        request.updatedAt,
      ]],
    },
  });
}

function mapLeaveRequestRow(
  row: string[],
): LeaveRequest {
  return {
    id: String(row[0] ?? "").trim(),
    employeeId: String(row[1] ?? "").trim(),
    leaveType: String(row[2] ?? "").trim(),
    startDate: String(row[3] ?? "").trim(),
    endDate: String(row[4] ?? "").trim(),
    reason: String(row[5] ?? "").trim(),
    approvalStatus: readApprovalStatus(row[6]),
    reviewedBy: String(row[7] ?? "").trim(),
    reviewedAt: String(row[8] ?? "").trim(),
    createdAt: String(row[9] ?? "").trim(),
    updatedAt: String(row[10] ?? "").trim(),
  };
}

export async function getAllLeaveRequests(): Promise<
  Array<{
    request: LeaveRequest;
    rowNumber: number;
  }>
> {
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `'${LEAVE_REQUESTS_SHEET}'!A:K`,
    });

  return (response.data.values ?? [])
    .slice(1)
    .filter(
      (row) =>
        String(row[0] ?? "").trim() !== "",
    )
    .map((row, index) => ({
      request: mapLeaveRequestRow(row),
      rowNumber: index + 2,
    }))
    .sort((first, second) =>
      second.request.createdAt.localeCompare(
        first.request.createdAt,
      ),
    );
}

export async function updateLeaveRequestReview(
  rowNumber: number,
  request: LeaveRequest,
) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `'${LEAVE_REQUESTS_SHEET}'!A${rowNumber}:K${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        request.id,
        request.employeeId,
        request.leaveType,
        request.startDate,
        request.endDate,
        request.reason,
        request.approvalStatus,
        request.reviewedBy,
        request.reviewedAt,
        request.createdAt,
        request.updatedAt,
      ]],
    },
  });
}