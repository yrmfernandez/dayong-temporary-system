import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-server";
import {
  addLeaveRequest,
  getLeaveRequestsForEmployee,
} from "@/lib/leave-data";

const leaveTypes = new Set([
  "Vacation Leave",
  "Sick Leave",
  "Emergency Leave",
  "Maternity Leave",
  "Paternity Leave",
  "Bereavement Leave",
  "Other",
]);

export async function GET() {
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "Not signed in.",
        },
        { status: 401 },
      );
    }

    const requests =
      await getLeaveRequestsForEmployee(
        user.employeeId,
      );

    return NextResponse.json({
      success: true,
      requests,
    });
  } catch (error) {
    console.error("Load leave requests error:", error);

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

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "Not signed in.",
        },
        { status: 401 },
      );
    }

    const body = await request.json();

    const leaveType =
      typeof body.leaveType === "string"
        ? body.leaveType.trim()
        : "";

    const startDate =
      typeof body.startDate === "string"
        ? body.startDate.trim()
        : "";

    const endDate =
      typeof body.endDate === "string"
        ? body.endDate.trim()
        : "";

    const reason =
      typeof body.reason === "string"
        ? body.reason.trim()
        : "";

    if (!leaveTypes.has(leaveType)) {
      return NextResponse.json(
        {
          success: false,
          message: "Select a valid leave type.",
        },
        { status: 400 },
      );
    }

    if (!startDate || !endDate) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Leave start and end dates are required.",
        },
        { status: 400 },
      );
    }

    if (endDate < startDate) {
      return NextResponse.json(
        {
          success: false,
          message:
            "End date cannot be before start date.",
        },
        { status: 400 },
      );
    }

    if (!reason) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Provide a reason for the leave request.",
        },
        { status: 400 },
      );
    }

    const timestamp = new Date().toISOString();

    const leaveRequest = {
      id: `LR-${crypto.randomUUID()}`,
      employeeId: user.employeeId,
      leaveType,
      startDate,
      endDate,
      reason,
      approvalStatus: "Pending" as const,
      reviewedBy: "",
      reviewedAt: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await addLeaveRequest(leaveRequest);

    return NextResponse.json(
      {
        success: true,
        message:
          "Leave request submitted for approval.",
        request: leaveRequest,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Create leave request error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to submit leave request.",
      },
      { status: 500 },
    );
  }
}