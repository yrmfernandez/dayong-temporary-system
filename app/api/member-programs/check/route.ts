import { NextResponse } from "next/server";

import {
  findMemberByNumber,
  findMemberProgramEnrollment,
} from "@/lib/google-sheets-data";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const memberNumber =
      searchParams.get("memberNumber")?.trim() ?? "";

    const programId =
      searchParams.get("programId")?.trim() ?? "";

    if (!memberNumber) {
      return NextResponse.json(
        {
          success: false,
          message: "Member number is required.",
        },
        { status: 400 },
      );
    }

    if (!programId) {
      return NextResponse.json(
        {
          success: false,
          message: "Program is required.",
        },
        { status: 400 },
      );
    }

    const member = await findMemberByNumber(memberNumber);

    if (!member) {
      return NextResponse.json(
        {
          success: false,
          message: `Member ${memberNumber} could not be found.`,
        },
        { status: 404 },
      );
    }

    const enrollment = await findMemberProgramEnrollment(
      member.memberNumber,
      programId,
    );

    if (enrollment) {
      return NextResponse.json({
        success: true,
        enrolled: true,
        message:
          `Member ${member.memberNumber} is already enrolled in program ${programId}.`,
        enrollmentId: enrollment.enrollmentId,
        memberNumber: member.memberNumber,
        programId,
      });
    }

    return NextResponse.json({
      success: true,
      enrolled: false,
      message: "This program is available for this member.",
      memberNumber: member.memberNumber,
      programId,
    });
  } catch (error) {
    console.error("Member program check error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to check program enrollment.",
      },
      { status: 500 },
    );
  }
}
