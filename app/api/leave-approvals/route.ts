import { withEncoder } from "@/lib/encoder-context";
import { NextResponse } from "next/server";

import {
  canManageAttendance,
  getSessionUser,
} from "@/lib/auth-server";
import {
  getAllLeaveRequests,
  updateLeaveRequestReview,
} from "@/lib/leave-data";
import {
  recordApprovedLeaveAttendance,
} from "@/lib/attendance-data";

export async function GET() {
  try {
    const allowed =
      await canManageAttendance();

    if (!allowed) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You are not allowed to review leave requests.",
        },
        { status: 403 },
      );
    }

    const requests =
      await getAllLeaveRequests();

    return NextResponse.json({
      success: true,
      requests: requests.map(
        ({ request }) => request,
      ),
    });
  } catch (error) {
    console.error("Load leave approvals error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          "Unable to load leave requests.",
      },
      { status: 500 },
    );
  }
}

export const POST = withEncoder(async function POST(request: Request) {
  try {
    const [allowed, reviewer] = await Promise.all([
      canManageAttendance(),
      getSessionUser(),
    ]);

    if (!allowed || !reviewer) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You are not allowed to review leave requests.",
        },
        { status: 403 },
      );
    }

    const body = await request.json();

    const leaveRequestId =
      typeof body.leaveRequestId === "string"
        ? body.leaveRequestId.trim()
        : "";

    const approvalStatus:
      | "Approved"
      | "Rejected"
      | "" =
      body.approvalStatus === "Approved"
        ? "Approved"
        : body.approvalStatus === "Rejected"
          ? "Rejected"
          : "";

    if (!leaveRequestId || !approvalStatus) {
      return NextResponse.json(
        {
          success: false,
          message:
            "A leave request and valid decision are required.",
        },
        { status: 400 },
      );
    }

    const requests =
      await getAllLeaveRequests();

    const selected = requests.find(
      ({ request: leaveRequest }) =>
        leaveRequest.id === leaveRequestId,
    );

    if (!selected) {
      return NextResponse.json(
        {
          success: false,
          message: "Leave request not found.",
        },
        { status: 404 },
      );
    }

    if (
      selected.request.approvalStatus !==
      "Pending"
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "This leave request has already been reviewed.",
        },
        { status: 409 },
      );
    }

    const timestamp = new Date().toISOString();

    const updatedRequest = {
      ...selected.request,
      approvalStatus,
      reviewedBy: reviewer.employeeId,
      reviewedAt: timestamp,
      updatedAt: timestamp,
    };

    await updateLeaveRequestReview(
      selected.rowNumber,
      updatedRequest,
    );

    if (approvalStatus === "Approved") {
      await recordApprovedLeaveAttendance({
        employeeId: updatedRequest.employeeId,
        leaveType: updatedRequest.leaveType,
        startDate: updatedRequest.startDate,
        endDate: updatedRequest.endDate,
        reason: updatedRequest.reason,
      });
    }

    return NextResponse.json({
      success: true,
      message:
        approvalStatus === "Approved"
          ? "Leave request approved."
          : "Leave request rejected.",
      request: updatedRequest,
    });
  } catch (error) {
    console.error("Review leave request error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to review leave request.",
      },
      { status: 500 },
    );
  }
});
